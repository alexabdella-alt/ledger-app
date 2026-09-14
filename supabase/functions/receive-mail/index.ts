// supabase/functions/receive-mail/index.ts — O82, email first (docs/EMAIL_CHANNEL_SPEC_O82.md §2)
//
// Resend's webhook endpoint. Two jobs:
//   1. `email.received`  — a message arrived at a company's docs-<token>@in.<domain> address.
//      Store the raw message as a document (the audit record), one `document_intake` row per
//      readable attachment (bytes stored FIRST — the O97 ordering the drain requires), one
//      `inbound_messages` row, and send the receipt. NOTHING IS BOOKED HERE. The pipeline
//      lives in the client; the drain picks these rows up when the company is next opened
//      (spec §3.1). A copy of the pipeline in this file would be the ·3a two-implementations
//      shape, and the repo has paid for that three times.
//   2. `email.delivered` / `email.bounced` / `email.complained` / `email.delivery_delayed`
//      — move an `outbound_messages` row's status. This is the ONLY writer of that column;
//      members have no UPDATE policy on the table (090), so "delivered" can never be typed in.
//
// ★ EVERY DECISION IS IN `_shared/mailChannel.js` — the sender wall, the counters, what an
//   attachment becomes, the receipt sentence — and the client imports the same file. This
//   function is I/O around those decisions and owns no rule of its own.
//
// ★ THE WEBHOOK IS SIGNED (Svix headers) AND AN UNSIGNED REQUEST IS REFUSED. Without this, a
//   stranger who learns the endpoint can post "an email arrived from the owner" and the
//   sender wall (which trusts From:) is worthless.
//
// Secrets (project-level, set once, survive deploys): RESEND_API_KEY, RESEND_WEBHOOK_SECRET,
// MAIL_DOMAIN (e.g. "shadowcfo.com"), SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
//
// Deploy: supabase functions deploy receive-mail --project-ref hhhuvoycumjzcjbawwff --no-verify-jwt
//   ★ `--no-verify-jwt` IS CORRECT HERE AND ONLY HERE: Resend has no Supabase session. The
//   Svix signature is this function's authentication. (`ai-proxy` must NEVER be deployed so.)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  inboundTokenOf, planInboundMessage, receiptCopy, replyBodyOf, INBOUND_STATUS,
} from "../_shared/mailChannel.js";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_WEBHOOK_SECRET = Deno.env.get("RESEND_WEBHOOK_SECRET")!;
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API = "https://api.resend.com";

const ok = (body: unknown = { ok: true }, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// ── Svix signature (Resend signs every webhook this way) ─────────────────────
// signed content = `${svix-id}.${svix-timestamp}.${rawBody}`; secret is base64 after `whsec_`;
// header carries one or more `v1,<base64 hmac>`. Timestamp older than 5 minutes is refused
// (replay). Constant-time compare.
async function verifySvix(req: Request, rawBody: string): Promise<boolean> {
  const id = req.headers.get("svix-id"), ts = req.headers.get("svix-timestamp"), sig = req.headers.get("svix-signature");
  if (!id || !ts || !sig) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const secret = Uint8Array.from(atob(RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${rawBody}`)));
  const expected = btoa(String.fromCharCode(...mac));
  const given = sig.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
  return given.some((g) => g.length === expected.length && timingSafeEqual(g, expected));
}
function timingSafeEqual(a: string, b: string) { let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

// ── Resend inbound API (isolated so a URL change is one edit) ───────────────
// ★ CONFIRM AGAINST RESEND'S CURRENT DOCS BEFORE THE FIRST DEPLOY: the receiving endpoints
//   and the attachment shape (`download_url` vs inline `content`) are the two things most
//   likely to differ from what is written here. Criterion 1 in the spec is the test.
async function resendGet(path: string) {
  const r = await fetch(`${RESEND_API}${path}`, { headers: { Authorization: `Bearer ${RESEND_API_KEY}` } });
  if (!r.ok) throw new Error(`resend ${path} → ${r.status}`);
  return r.json();
}
async function fetchReceived(emailId: string) { return resendGet(`/emails/receiving/${emailId}`); }
async function fetchAttachmentBytes(emailId: string, att: any): Promise<Uint8Array> {
  if (att.download_url) {
    const r = await fetch(att.download_url); if (!r.ok) throw new Error(`attachment download → ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const a = await resendGet(`/emails/receiving/${emailId}/attachments/${att.id}`);
  if (a.download_url) { const r = await fetch(a.download_url); return new Uint8Array(await r.arrayBuffer()); }
  if (a.content) return Uint8Array.from(atob(a.content), (c) => c.charCodeAt(0));
  throw new Error("attachment has neither download_url nor content");
}
async function sha256Hex(bytes: Uint8Array) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...h].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sendMail({ from, to, subject, text, replyTo }: { from: string; to: string; subject: string; text: string; replyTo?: string }) {
  const r = await fetch(`${RESEND_API}/emails`, {
    method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text, reply_to: replyTo }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`resend send → ${r.status} ${j?.message || ""}`);
  return j.id as string;
}
const safeName = (n: string) => (n || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);

serve(async (req) => {
  if (req.method !== "POST") return ok({ error: "POST only" }, 405);
  const raw = await req.text();
  if (!(await verifySvix(req, raw))) return ok({ error: "bad signature" }, 401);
  const evt = JSON.parse(raw);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // ── 2. delivery events → outbound status (the only writer) ─────────────────
  if (evt.type !== "email.received") {
    const map: Record<string, string> = { "email.delivered": "delivered", "email.bounced": "bounced", "email.complained": "bounced" };
    const status = map[evt.type];
    if (status && evt.data?.email_id) {
      await admin.from("outbound_messages").update({ status, error: evt.type === "email.delivered" ? null : evt.type })
        .eq("provider_message_id", evt.data.email_id).select("id");
    }
    return ok();
  }

  // ── 1. an inbound message ───────────────────────────────────────────────────
  const d = evt.data || {};
  const emailId: string = d.email_id || d.id;
  const toList: string[] = Array.isArray(d.to) ? d.to : [d.to].filter(Boolean);
  const to = toList.find((t) => inboundTokenOf(t)) || toList[0] || "";
  const token = inboundTokenOf(to);
  // An address we do not have is answered 200 and ignored — never an error that tells a
  // prober which tokens exist.
  if (!token) return ok({ ignored: "no token" });

  const { data: channel } = await admin.from("company_channels").select("*").eq("inbound_token", token).maybeSingle();
  if (!channel) return ok({ ignored: "unknown token" });
  const companyId = channel.company_id;

  // Idempotent: the provider redelivers.
  const { data: dup } = await admin.from("inbound_messages").select("id").eq("provider", "resend").eq("provider_message_id", emailId).maybeSingle();
  if (dup) return ok({ duplicate: dup.id });

  // Two plain reads rather than a PostgREST embed — the embed syntax is the one thing in
  // this file a typo would make silently return nothing, and "no members" would then read
  // as "refuse everyone". `public.users` mirrors auth.users' email via the sync trigger.
  const { data: memberRows } = await admin.from("company_users").select("user_id").eq("company_id", companyId).not("accepted_at", "is", null);
  const ids = (memberRows || []).map((r: any) => r.user_id).filter(Boolean);
  const { data: userRows } = ids.length ? await admin.from("users").select("email").in("id", ids) : { data: [] };
  const memberEmails = (userRows || []).map((r: any) => r.email).filter(Boolean);

  const full = await fetchReceived(emailId).catch(() => null);
  const attachmentsMeta = (full?.attachments || d.attachments || []).map((a: any) => ({
    id: a.id, filename: a.filename || a.name || "attachment", contentType: a.content_type || a.contentType || "", size: Number(a.size || 0), download_url: a.download_url,
  }));
  const now = new Date().toISOString();
  const plan = planInboundMessage({
    from: d.from, to, subject: d.subject || "", attachments: attachmentsMeta,
    memberEmails, allowedSenders: channel.allowed_senders || [], counters: channel, now,
  });

  // Charge the counters only when the plan charged them (accepted / reply / no_attachments).
  if (plan.counters !== channel) {
    await admin.from("company_channels").update({ ...plan.counters, updated_at: now }).eq("company_id", companyId).select("company_id");
  }

  // The raw message is ALWAYS stored — the audit record exists for a refused sender too, and
  // it is what a person looks at before allowing them.
  const rawPath = `${companyId}/email/${Date.now()}_${safeName(emailId)}.json`;
  const rawJson = JSON.stringify({ event: evt, received: full }, null, 0);
  let rawDocId: string | null = null;
  {
    const up = await admin.storage.from("documents").upload(rawPath, new Blob([rawJson], { type: "application/json" }), { contentType: "application/json", upsert: false });
    if (!up.error) {
      const ins = await admin.from("documents").insert({
        company_id: companyId, name: `email ${d.subject || emailId}.json`, mime_type: "application/json", document_type: "other",
        storage_path: rawPath, file_size_bytes: rawJson.length, tags: ["email-source"], content_hash: await sha256Hex(new TextEncoder().encode(rawJson)),
      }).select("id").single();
      rawDocId = ins.data?.id || null;
    }
  }

  const intakeIds: string[] = [];
  let saved = 0, kept = 0;
  if (plan.status === INBOUND_STATUS.ACCEPTED) {
    for (const [i, item] of plan.intake.entries()) {
      const meta = attachmentsMeta[i];
      let bytes: Uint8Array;
      try { bytes = await fetchAttachmentBytes(emailId, meta); } catch (e) { console.error("[receive-mail] attachment fetch failed", e); continue; }
      const hash = await sha256Hex(bytes);
      const path = `${companyId}/${Date.now()}_${safeName(item.filename)}`;
      // Bytes FIRST (O97): a row that says "received" over bytes that were never stored is
      // the O133 shape.
      const up = await admin.storage.from("documents").upload(path, new Blob([bytes], { type: item.contentType }), { contentType: item.contentType, upsert: false });
      if (up.error) { console.error("[receive-mail] upload failed", up.error); continue; }
      // C193 dedupe: identical bytes already in the library link to the existing row.
      const { data: existing } = await admin.from("documents").select("id").eq("company_id", companyId).eq("content_hash", hash).maybeSingle();
      let docId = existing?.id || null;
      if (!docId) {
        const ins = await admin.from("documents").insert({
          company_id: companyId, name: item.filename, mime_type: item.contentType, document_type: "other",   // the pipeline stamps the real type once it reads the file (C300)
          storage_path: path, file_size_bytes: bytes.length, tags: ["by-email"], content_hash: hash,
        }).select("id").single();
        if (ins.error) { console.error("[receive-mail] documents insert failed", ins.error); continue; }
        docId = ins.data.id;
      } else {
        await admin.storage.from("documents").remove([path]).catch(() => {});
      }
      if (!item.process) { kept++; continue; }
      // The same row a drop creates — same table, same status machine, same drain.
      const ins = await admin.from("document_intake").insert({
        company_id: companyId, filename: item.filename, content_hash: hash, source: "email", status: "received",
        document_id: docId, detail: `by email from ${d.from}${d.subject ? ` — "${d.subject}"` : ""}`,
      }).select("id").single();
      if (ins.error) { console.error("[receive-mail] intake insert failed", ins.error); continue; }
      intakeIds.push(ins.data.id); saved++;
    }
  }

  // A reply: land the text on the message it answers (spec §4.3). Evidence, not an action.
  let replyToOutboundId: string | null = null, replyText: string | null = null;
  if (plan.status === INBOUND_STATUS.REPLY && plan.replyToken) {
    const { data: out } = await admin.from("outbound_messages").select("id, related_intake_id").eq("reply_token", plan.replyToken).eq("company_id", companyId).maybeSingle();
    if (out) {
      replyToOutboundId = out.id; replyText = replyBodyOf(full?.text || d.text || "");
      await admin.from("outbound_messages").update({ answered_at: now }).eq("id", out.id).select("id");
      if (out.related_intake_id && replyText) {
        const { data: row } = await admin.from("document_intake").select("detail").eq("id", out.related_intake_id).maybeSingle();
        await admin.from("document_intake").update({ detail: `${row?.detail || ""}\nOwner replied by email: ${replyText}`.trim(), updated_at: now })
          .eq("id", out.related_intake_id).select("id");
      }
    }
  }

  const ins = await admin.from("inbound_messages").insert({
    company_id: companyId, provider: "resend", provider_message_id: emailId, from_email: String(d.from || ""), to_email: to,
    subject: d.subject || null, received_at: now, raw_document_id: rawDocId, attachment_count: attachmentsMeta.length,
    intake_ids: intakeIds, status: plan.status, reply_to_outbound_id: replyToOutboundId, reply_text: replyText,
    detail: plan.limitHit ? `rate limited (${plan.limitHit})` : null,
  }).select("id").single();
  if (ins.error) { console.error("[receive-mail] inbound_messages insert failed", ins.error); return ok({ error: "record failed" }, 500); }

  // The receipt — derived from what was CREATED, never from the payload (spec §7.5).
  if (plan.status === INBOUND_STATUS.ACCEPTED || plan.status === INBOUND_STATUS.NO_ATTACHMENTS) {
    const copy = receiptCopy({ saved, kept, companyName: channel.from_name || "" });
    try {
      const fromName = channel.from_name ? `${channel.from_name} via Shadow` : "Shadow";
      const providerId = await sendMail({ from: `${fromName} <bookkeeper@${MAIL_DOMAIN}>`, to: String(d.from), subject: copy.subject, text: copy.body, replyTo: to });
      await admin.from("outbound_messages").insert({
        company_id: companyId, kind: "receipt", to_email: String(d.from), subject: copy.subject, body_text: copy.body,
        reply_token: crypto.randomUUID().replace(/-/g, "").slice(0, 24), related_inbound_id: ins.data.id,
        status: "sent", provider: "resend", provider_message_id: providerId, sent_at: new Date().toISOString(),
      }).select("id");
    } catch (e) { console.error("[receive-mail] receipt send failed", e); }
  }
  return ok({ id: ins.data.id, status: plan.status, saved, kept });
});
