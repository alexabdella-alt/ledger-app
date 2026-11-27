// ─────────────────────────────────────────────────────────────────────────────
// C771 — BILLING, THE PURE PART (shared by the `billing` and `stripe-webhook` edge functions, and
// imported by vitest). No network, no Deno globals beyond WebCrypto (present in Deno and Node 20+).
//
//   • which Stripe price is which plan (from the function's environment — prices live in Stripe);
//   • what a Stripe subscription means for our `subscriptions` row (status mapped onto the table's
//     CHECK: active | trialing | past_due | canceled);
//   • the Checkout Session's form fields — the company rides as client_reference_id AND as
//     subscription metadata, so every later event can find its company;
//   • the return address, allow-listed (an open redirect would let anyone bounce a signed-in user
//     through our Stripe flow to a site of their choosing);
//   • Stripe's webhook signature, checked (HMAC-SHA256 over "timestamp.body", within 5 minutes).
// ─────────────────────────────────────────────────────────────────────────────

export const PLAN_IDS = ["starter", "pro"];

export function priceIdFor(plan, env = {}) {
  if (plan === "starter") return env.STRIPE_PRICE_STARTER || null;
  if (plan === "pro") return env.STRIPE_PRICE_PRO || null;
  return null;
}
export function planForPrice(priceId, env = {}) {
  if (priceId && priceId === env.STRIPE_PRICE_STARTER) return "starter";
  if (priceId && priceId === env.STRIPE_PRICE_PRO) return "pro";
  return null;
}

// Stripe's subscription status → the table's four values.
export function statusFromStripe(s) {
  switch (String(s || "")) {
    case "active": return "active";
    case "trialing": return "trialing";
    case "past_due":
    case "unpaid":
    case "incomplete": return "past_due";
    case "canceled":
    case "incomplete_expired":
    case "paused": return "canceled";
    default: return "past_due";
  }
}

const iso = (unix) => (Number.isFinite(Number(unix)) && Number(unix) > 0 ? new Date(Number(unix) * 1000).toISOString() : null);

// The row patch for a Stripe subscription object.
export function subscriptionPatch(sub = {}, env = {}) {
  const item = (sub.items && sub.items.data && sub.items.data[0]) || {};
  const priceId = (item.price && item.price.id) || null;
  return {
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : (sub.customer && sub.customer.id) || null,
    stripe_subscription_id: sub.id || null,
    plan: planForPrice(priceId, env) || "starter",
    status: statusFromStripe(sub.status),
    trial_ends_at: iso(sub.trial_end),
    current_period_start: iso(item.current_period_start ?? sub.current_period_start),
    current_period_end: iso(item.current_period_end ?? sub.current_period_end),
    updated_at: new Date().toISOString(),
  };
}

// The company a Stripe object belongs to: subscription metadata first, then the session's reference.
export function companyOf(obj = {}) {
  return (obj.metadata && obj.metadata.company_id) || obj.client_reference_id || null;
}

const ALLOWED_RETURN = /^https:\/\/(www\.)?shadowcfo\.org$|^https:\/\/ledger-app-five\.vercel\.app$|^http:\/\/localhost(:\d+)?$/;
export function safeReturnUrl(url) {
  const u = String(url || "").replace(/\/+$/, "");
  return ALLOWED_RETURN.test(u) ? u : "https://www.shadowcfo.org";
}

// Checkout Session fields (Stripe's REST API takes form encoding). A trial the company still has is
// carried over — Stripe needs a trial end at least 48 hours away, so a shorter remainder is dropped.
export function checkoutFields({ priceId, customerId, companyId, returnUrl, trialEndsAt = null, now = new Date(), automaticTax = false }) {
  const base = safeReturnUrl(returnUrl);
  const f = {
    mode: "subscription",
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    customer: customerId,
    client_reference_id: companyId,
    "subscription_data[metadata][company_id]": companyId,
    success_url: `${base}/?billing=success`,
    cancel_url: `${base}/?billing=cancel`,
    allow_promotion_codes: "true",
    // ★ C774 — the billing address is collected at checkout and saved on the customer, so it is already
    // there the day sales tax is switched on.
    billing_address_collection: "required",
    "customer_update[address]": "auto",
    "customer_update[name]": "auto",
  };
  // ★ C775 — STRIPE TAX IS OFF UNTIL THE OPERATOR SWITCHES IT ON (secret STRIPE_AUTOMATIC_TAX=on, after
  // Stripe Tax is set up with a registration). Asking for automatic tax before Stripe Tax is activated
  // makes Stripe refuse to open checkout at all — a broken Subscribe button, not a missing tax line.
  if (automaticTax) f["automatic_tax[enabled]"] = "true";
  const t = Date.parse(trialEndsAt || "");
  if (Number.isFinite(t) && t - now.getTime() > 48 * 3600 * 1000) f["subscription_data[trial_end]"] = String(Math.floor(t / 1000));
  return f;
}

export function formBody(fields = {}) {
  return Object.entries(fields).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

// Stripe-Signature: "t=1700000000,v1=abc…,v1=…". Valid when one v1 equals HMAC-SHA256(secret, `${t}.${body}`)
// and t is within `tolerance` seconds of now.
export async function verifyStripeSignature(body, header, secret, { now = Date.now(), tolerance = 300 } = {}) {
  if (!body || !header || !secret) return false;
  const parts = String(header).split(",").map((p) => p.trim().split("="));
  const t = Number((parts.find(([k]) => k === "t") || [])[1]);
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - t) > tolerance) return false;
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await globalThis.crypto.subtle.sign("HMAC", key, enc.encode(`${t}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return sigs.some((s) => s.length === hex.length && timingSafeEqual(s, hex));
}
function timingSafeEqual(a, b) {
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// The events that change a company's plan.
export const HANDLED_EVENTS = ["checkout.session.completed", "customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted", "invoice.payment_failed", "invoice.paid"];
