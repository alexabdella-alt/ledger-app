// supabase/functions/billing/index.ts
//
// C771 — opens Stripe's hosted pages for a company: Checkout (choose a plan) and the Billing Portal
// (card, plan, cancel, invoices). Card details never touch Shadow. Called by the app with the signed-in
// user's JWT; only the company's OWNER or an ADMIN may open either. Until the Stripe secret is set it
// answers { error: "not_configured" } and the app says billing isn't switched on.
//
// Secrets (set by the operator in Supabase → Edge Functions → Secrets — never in the repo, never pasted
// into a chat): STRIPE_SECRET_KEY, STRIPE_PRICE_STARTER, STRIPE_PRICE_PRO.
// Deploy: supabase functions deploy billing --project-ref hhhuvoycumjzcjbawwff   (JWT verification ON)

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { priceIdFor, checkoutFields, formBody, safeReturnUrl, PLAN_IDS } from "../_shared/billingCore.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const env = {
  STRIPE_SECRET_KEY: Deno.env.get("STRIPE_SECRET_KEY") || "",
  STRIPE_PRICE_STARTER: Deno.env.get("STRIPE_PRICE_STARTER") || "",
  STRIPE_PRICE_PRO: Deno.env.get("STRIPE_PRICE_PRO") || "",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function stripe(path: string, fields?: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: fields ? "POST" : "GET",
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: fields ? formBody(fields) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data && data.error && data.error.message) || `Stripe ${res.status}`);
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json(405, { error: "method" });
  if (!env.STRIPE_SECRET_KEY) return json(200, { error: "not_configured" });

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: { user }, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !user) return json(401, { error: "unauthorized", message: "Please sign in again." });

  let body: { action?: string; plan?: string; companyId?: string; returnUrl?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: "bad_request" }); }
  const companyId = String(body.companyId || "");
  if (!companyId) return json(400, { error: "bad_request" });

  // Only the owner or an admin of THIS company changes its billing.
  const { data: member } = await admin.from("company_users").select("role").eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "admin"].includes(String(member.role))) return json(403, { error: "forbidden", message: "Only the owner or an admin can change the plan." });

  const { data: rows } = await admin.from("subscriptions").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(1);
  let sub = (rows || [])[0] || null;
  const returnUrl = safeReturnUrl(body.returnUrl);

  try {
    if (body.action === "portal") {
      if (!sub || !sub.stripe_customer_id) return json(400, { error: "no_customer", message: "Choose a plan first — then you can manage billing here." });
      const portal = await stripe("billing_portal/sessions", { customer: sub.stripe_customer_id, return_url: `${returnUrl}/` });
      return json(200, { url: portal.url });
    }
    if (body.action === "checkout") {
      const plan = String(body.plan || "");
      if (!PLAN_IDS.includes(plan)) return json(400, { error: "bad_plan" });
      const priceId = priceIdFor(plan, env);
      if (!priceId) return json(200, { error: "not_configured" });
      let customerId = sub && sub.stripe_customer_id;
      if (!customerId) {
        const { data: co } = await admin.from("companies").select("name").eq("id", companyId).maybeSingle();
        const customer = await stripe("customers", { email: user.email || "", name: (co && co.name) || "", "metadata[company_id]": companyId });
        customerId = customer.id;
        if (sub) await admin.from("subscriptions").update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }).eq("id", sub.id);
        else { const { data: ins } = await admin.from("subscriptions").insert({ company_id: companyId, plan: "trial", status: "trialing", stripe_customer_id: customerId }).select("*").single(); sub = ins; }
      }
      const session = await stripe("checkout/sessions", checkoutFields({ priceId, customerId, companyId, returnUrl, trialEndsAt: sub && sub.status === "trialing" ? sub.trial_ends_at : null }));
      return json(200, { url: session.url });
    }
    return json(400, { error: "bad_action" });
  } catch (e) {
    console.error("[billing]", (e as Error).message);
    return json(502, { error: "stripe", message: "Couldn't reach our payment provider just now — please try again." });
  }
});
