// supabase/functions/send-mail/index.ts — O82, email first (docs/EMAIL_CHANNEL_SPEC_O82.md §4)
//
// The ONLY path that sends mail from the app. Holds the Resend key the way `ai-proxy` holds
// the Anthropic key; the browser never sees it. Authenticated by the caller's Supabase JWT
// and their membership of the company the message is about.
//
// ★ EVERY SEND IS A ROW BEFORE THE PROVIDER IS CALLED, and the row's status is what the
//   screen reports: `queued` → `sent` (provider accepted) → `delivered` | `bounced` (the
//   webhook in `receive-mail`). A message we cannot prove was sent is reported as not sent —
//   C194's rule applied to mail. Members cannot insert or update this table directly (090).
//
// ★ WHO MAY BE WRITTEN TO. `question`, `report` and `digest` go only to a MEMBER of the
//   company — our domain must not become a relay. `invoice` goes to the customer on the
//   posted A/R invoice, and only if that invoice belongs to the caller's company.
//
// Body: { companyId, kind, to, subject, text, related: { intakeId? | anomalyId? | arInvoiceId? },
//         attachments?: [{ filename, contentType, content /* base64 */ }] }
//
// Deploy: supabase functions deploy send-mail --project-ref hhhuvoycumjzcjbawwff   (JWT ON)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { inboundAddress, replyTokenTag, isReplyToken } from "../_shared/mailChannel.js";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const MAIL_DOMAIN = Deno.env.get("MAIL_DOMAIN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status: number) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json" } });

const KINDS = new Set(["receipt", "question", "invoice", "report", "digest"]);
const MEMBER_ONLY_KINDS = new Set(["question", "report", "digest"]);
const newToken = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 24);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing authorization." }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !user) return json({ error: "Invalid or expired session." }, 401);

    const body = await req.json().catch(() => ({}));
    const { companyId, kind, to, subject, text, related = {}, attachments = [] } = body || {};
    if (!companyId || !KINDS.has(kind) || !to || !subject || !text) return json({ error: "companyId, kind, to, subject and text are required." }, 400);

    // Membership — the caller must be an accepted member of the company the message is about.
    const { data: membership } = await admin.from("company_users").select("role").eq("company_id", companyId).eq("user_id", user.id).not("accepted_at", "is", null).maybeSingle();
    if (!membership) return json({ error: "Not a member of this company." }, 403);

    // Recipient rules (§4.1): our domain is not a relay.
    const toNorm = String(to).trim().toLowerCase();
    if (MEMBER_ONLY_KINDS.has(kind)) {
      const { data: members } = await admin.from("company_users").select("user_id").eq("company_id", companyId).not("accepted_at", "is", null);
      const ids = (members || []).map((m: any) => m.user_id);
      const { data: users } = ids.length ? await admin.from("users").select("email").in("id", ids) : { data: [] };
      const ok = (users || []).some((u: any) => String(u.email || "").toLowerCase() === toNorm);
      if (!ok) return json({ error: "A question or report can only be sent to a member of the company." }, 403);
    }
    if (kind === "invoice") {
      if (!related.arInvoiceId) return json({ error: "An invoice email needs the posted invoice it is about." }, 400);
      const { data: inv } = await admin.from("ar_invoices").select("id, company_id").eq("id", related.arInvoiceId).maybeSingle();
      if (!inv || inv.company_id !== companyId) return json({ error: "That invoice is not in this company." }, 403);
    }

    const { data: channel } = await admin.from("company_channels").select("inbound_token, from_name").eq("company_id", companyId).maybeSingle();
    const replyTo = channel?.inbound_token ? inboundAddress(channel.inbound_token, MAIL_DOMAIN) : undefined;
    const token = newToken();
    if (!isReplyToken(token)) return json({ error: "token mint failed" }, 500);
    // A question carries its token in the subject so the reply lands on it (§4.3).
    const fullSubject = kind === "question" ? `${subject} ${replyTokenTag(token)}` : subject;

    // ── 1. the row, BEFORE the provider ──────────────────────────────────────
    const ins = await admin.from("outbound_messages").insert({
      company_id: companyId, kind, to_email: toNorm, subject: fullSubject, body_text: text, reply_token: token,
      related_intake_id: related.intakeId || null, related_anomaly_id: related.anomalyId || null,
      related_ar_invoice_id: related.arInvoiceId || null, status: "queued", provider: "resend", created_by: user.id,
    }).select("id").single();
    if (ins.error) return json({ error: `could not record the message: ${ins.error.message}` }, 500);
    const rowId = ins.data.id;

    // ── 2. the provider ─────────────────────────────────────────────────────
    const fromName = channel?.from_name ? `${channel.from_name} via Shadow` : "Shadow";
    const payload: any = { from: `${fromName} <bookkeeper@${MAIL_DOMAIN}>`, to: toNorm, subject: fullSubject, text, reply_to: replyTo };
    if (Array.isArray(attachments) && attachments.length) {
      payload.attachments = attachments.slice(0, 5).map((a: any) => ({ filename: String(a.filename || "attachment"), content: String(a.content || "") }));
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      await admin.from("outbound_messages").update({ status: "failed", error: `${r.status} ${j?.message || ""}`.trim() }).eq("id", rowId).select("id");
      return json({ ok: false, id: rowId, status: "failed", error: "The email provider refused the message. It is recorded, and it was not sent." }, 502);
    }
    const upd = await admin.from("outbound_messages").update({ status: "sent", provider_message_id: j.id, sent_at: new Date().toISOString() }).eq("id", rowId).select("id");
    if (upd.error || !(upd.data || []).length) {
      // The provider took it and we could not record that. Say so — the screen must not
      // claim "sent" over a row that still reads queued.
      return json({ ok: false, id: rowId, status: "queued", error: "Sent, but we couldn't record it as sent." }, 500);
    }
    return json({ ok: true, id: rowId, status: "sent", providerMessageId: j.id }, 200);
  } catch (e) {
    return json({ error: (e as Error)?.message || "send failed" }, 500);
  }
});
