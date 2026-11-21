// supabase/functions/stripe-webhook/index.ts
//
// C771 — Stripe tells Shadow what happened (subscribed, renewed, payment failed, cancelled), and this
// writes the company's `subscriptions` row. The ONLY writer of that row once migration 102 is applied.
//
// ★ Stripe cannot send a Supabase JWT, so this one function is deployed WITHOUT JWT verification —
//   its security is Stripe's signature instead: every request is rejected unless its Stripe-Signature
//   header is a valid HMAC of the body under STRIPE_WEBHOOK_SECRET, sent within five minutes.
//   (CLAUDE.md's "never --no-verify-jwt" is about ai-proxy, which spends money on a caller's behalf;
//   this endpoint only accepts signed facts from Stripe.)
//
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO.
// Deploy: supabase functions deploy stripe-webhook --project-ref hhhuvoycumjzcjbawwff --no-verify-jwt
// Stripe Dashboard → Developers → Webhooks → endpoint https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/stripe-webhook
//   with the events in HANDLED_EVENTS.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyStripeSignature, subscriptionPatch, companyOf, HANDLED_EVENTS } from "../_shared/billingCore.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const env = {
  STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY") || "",
  STRIPE_WEBHOOK_SECRET: Deno.env.get("STRIPE_WEBHOOK_SECRET") || "",
  STRIPE_PRICE_STARTER: Deno.env.get("STRIPE_PRICE_STARTER") || "",
  STRIPE_PRICE_PRO: Deno.env.get("STRIPE_PRICE_PRO") || "",
};

async function getSubscription(id: string) {
  const res = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
  if (!res.ok) throw new Error(`Stripe ${res.status}`);
  return await res.json();
}

serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const raw = await req.text();
  const ok = await verifyStripeSignature(raw, req.headers.get("stripe-signature") || "", env.STRIPE_WEBHOOK_SECRET);
  if (!ok) return new Response("bad signature", { status: 400 });

  let event: { type?: string; data?: { object?: Record<string, unknown> } } = {};
  try { event = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  if (!HANDLED_EVENTS.includes(String(event.type))) return new Response("ignored", { status: 200 });

  const obj = (event.data && event.data.object) || {};
  try {
    // Every handled event leads back to a subscription; read it fresh from Stripe so the row is the truth, not the event's snapshot.
    let subId: string | null = null;
    if (String(event.type).startsWith("customer.subscription.")) subId = String(obj.id || "");
    else if (event.type === "checkout.session.completed") subId = (obj.subscription as string) || null;
    else if (String(event.type).startsWith("invoice.")) subId = (obj.subscription as string) || ((obj.parent as any)?.subscription_details?.subscription ?? null);
    if (!subId) return new Response("no subscription", { status: 200 });

    const sub = await getSubscription(subId);
    const companyId = companyOf(sub) || companyOf(obj);
    if (!companyId) { console.error("[stripe-webhook] no company on", subId); return new Response("no company", { status: 200 }); }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const patch = subscriptionPatch(sub, env);
    const { data: rows } = await admin.from("subscriptions").select("id").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1);
    const existing = (rows || [])[0];
    const { error } = existing
      ? await admin.from("subscriptions").update(patch).eq("id", existing.id)
      : await admin.from("subscriptions").insert({ company_id: companyId, ...patch });
    if (error) { console.error("[stripe-webhook] write failed", error.message); return new Response("write failed", { status: 500 }); }   // Stripe retries
    await admin.from("audit_log").insert({ company_id: companyId, action: "billing_updated", detail: `Plan ${patch.plan} · ${patch.status} (Stripe ${event.type})`, performed_by: "Stripe" }).then(() => {}, () => {});
    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[stripe-webhook]", (e as Error).message);
    return new Response("error", { status: 500 });   // Stripe retries with backoff
  }
});
