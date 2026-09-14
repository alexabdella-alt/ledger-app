// ─────────────────────────────────────────────────────────────────────────────
// THE EMAIL CHANNEL, CLIENT SIDE (O82, C351). docs/EMAIL_CHANNEL_SPEC_O82.md §5–§6.
//
// Thin I/O around the SAME decisions the receiver uses (`supabase/functions/_shared/
// mailChannel.js`) — the address format, which attachments are readable, the sentence for an
// unknown sender. Nothing here decides anything the receiver would decide differently.
//
// Every function takes the client as an argument (the `shadowIo` / `intakeDrainIo` shape) so
// it can be exercised with a stub, and every one DEGRADES when the tables do not exist yet:
// migrations 088–090 are unapplied at the time of writing, and a screen that throws on a
// missing table is the C246 class.
// ─────────────────────────────────────────────────────────────────────────────
import { getAuthHeaders } from "./supabase";
import { SEND_MAIL_URL } from "./constants";
import { classifyAttachment, isInboundToken } from "../../supabase/functions/_shared/mailChannel.js";

const TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function mintInboundToken(len = 12) {
  const bytes = new Uint8Array(len);
  (globalThis.crypto || {}).getRandomValues?.(bytes);
  let t = "";
  for (let i = 0; i < len; i++) t += TOKEN_ALPHABET[(bytes[i] ?? Math.floor(Math.random() * 36)) % 36];
  return t;
}

// The channel row, or the member-facing status view when the caller cannot read the token.
// Returns { ok, channel, status } — `ok:false` means "we could not ask", which every caller
// renders as "not available", never as "no channel" (O98).
export async function loadMailChannel(supabase, companyId) {
  if (!supabase || !companyId) return { ok: false, channel: null, status: null };
  try {
    const full = await supabase.from("company_channels").select("*").eq("company_id", companyId).maybeSingle();
    if (!full.error && full.data) return { ok: true, channel: full.data, status: null };
    const view = await supabase.from("company_channel_status").select("*").eq("company_id", companyId).maybeSingle();
    if (view.error) return { ok: false, channel: null, status: null, error: view.error.message };
    return { ok: true, channel: null, status: view.data || null };
  } catch (e) {
    return { ok: false, channel: null, status: null, error: e?.message || String(e) };
  }
}

export async function createMailChannel(supabase, { companyId, fromName = null, token = mintInboundToken() } = {}) {
  if (!isInboundToken(token)) return { ok: false, error: "bad token" };
  const { data, error } = await supabase.from("company_channels")
    .insert({ company_id: companyId, inbound_token: token, from_name: fromName || null })
    .select("*").single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, channel: data };
}

export async function addAllowedSender(supabase, { companyId, current = [], email }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e.includes("@")) return { ok: false, error: "That doesn't look like an email address." };
  const next = [...new Set([...(current || []).map((x) => String(x).toLowerCase()), e])];
  // `company_channels` is keyed on company_id (no `id`), so `checkedRowUpdate` cannot address
  // it; this is the same checked shape by hand — `.select()` so zero rows is a failure.
  const { data, error } = await supabase.from("company_channels").update({ allowed_senders: next, updated_at: new Date().toISOString() }).eq("company_id", companyId).select("company_id");
  if (error || !(data || []).length) return { ok: false, error: error?.message || "no row updated" };
  return { ok: true, allowedSenders: next };
}

export async function loadHeldInbound(supabase, companyId) {
  if (!supabase || !companyId) return { ok: false, rows: [] };
  try {
    const { data, error } = await supabase.from("inbound_messages").select("*")
      .eq("company_id", companyId).eq("status", "unknown_sender").order("received_at", { ascending: false }).limit(20);
    if (error) return { ok: false, rows: [], error: error.message };
    return { ok: true, rows: data || [] };
  } catch (e) { return { ok: false, rows: [], error: e?.message || String(e) }; }
}

// ★ RELEASING A HELD MESSAGE (spec §2.2): allow the sender, then create the intake rows the
// receiver deliberately did NOT create — one per readable stored attachment, `source: email`,
// with `document_id` set so the drain picks them up. The readability rule is the receiver's
// own (`classifyAttachment`), so a file the receiver would have skipped is skipped here too.
export async function releaseInboundMessage(supabase, { companyId, message, allowedSenders = [] }) {
  const allow = await addAllowedSender(supabase, { companyId, current: allowedSenders, email: message.from_email });
  if (!allow.ok) return allow;
  const ids = message.attachment_document_ids || [];
  let docs = [];
  if (ids.length) {
    const { data } = await supabase.from("documents").select("id, name, mime_type, file_size_bytes").in("id", ids);
    docs = data || [];
  }
  const intakeIds = [];
  for (const d of docs) {
    const c = classifyAttachment({ filename: d.name, contentType: d.mime_type, size: d.file_size_bytes });
    if (!c.process) continue;
    const { data, error } = await supabase.from("document_intake").insert({
      company_id: companyId, filename: d.name, source: "email", status: "received", document_id: d.id,
      detail: `by email from ${message.from_email}${message.subject ? ` — "${message.subject}"` : ""} (allowed by you)`,
    }).select("id").single();
    if (!error && data?.id) intakeIds.push(data.id);
  }
  const upd = await supabase.from("inbound_messages").update({ status: "accepted", intake_ids: intakeIds, detail: "released after the sender was allowed" })
    .eq("id", message.id).eq("company_id", companyId).select("id");
  if (upd.error || !(upd.data || []).length) return { ok: false, error: upd.error?.message || "message not updated", intakeIds };
  return { ok: true, intakeIds, allowedSenders: allow.allowedSenders };
}

export async function ignoreInboundMessage(supabase, { companyId, message }) {
  const upd = await supabase.from("inbound_messages").update({ status: "ignored" }).eq("id", message.id).eq("company_id", companyId).select("id");
  if (upd.error || !(upd.data || []).length) return { ok: false, error: upd.error?.message || "message not updated" };
  return { ok: true };
}

// Sends through the edge function; the browser never holds the provider key. The result is
// the function's own verdict — `{ ok, id, status }` — and a caller may say "sent" only when
// `ok` is true (C194: a success sentence is gated on the record, not on the click).
export async function sendMailViaFunction({ companyId, kind, to, subject, text, related = {}, attachments = [] } = {}, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl(SEND_MAIL_URL, {
      method: "POST", headers: getAuthHeaders(),
      body: JSON.stringify({ companyId, kind, to, subject, text, related, attachments }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: j?.status || "failed", error: j?.error || `send-mail → ${res.status}` };
    return { ok: !!j.ok, id: j.id, status: j.status, error: j.error || null };
  } catch (e) {
    return { ok: false, status: "failed", error: e?.message || String(e) };
  }
}
