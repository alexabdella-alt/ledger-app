// ★ C771 — PLAN & BILLING: Stripe's hosted pages do the money; a webhook writes the company's row;
// the app reads it. Locking stays OFF until billing is switched on.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { renderViewHtml } from "./helpers/renderView.jsx";
import BillingView from "../src/components/views/BillingView.jsx";
import { billingState, isReadOnly, trialReminder, billingHeadline, BILLING_ENFORCED, PLANS } from "../src/lib/billing.js";
import { homeWaitingList, WAIT } from "../src/lib/homeWaiting.js";
import { statusFromStripe, subscriptionPatch, checkoutFields, safeReturnUrl, verifyStripeSignature, companyOf, priceIdFor, planForPrice } from "../supabase/functions/_shared/billingCore.js";

const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n) => new Date(NOW.getTime() + n * 86400000).toISOString();

describe("C771 — what a subscription means", () => {
  it("★★★ trial / expired / active / past due / canceled / none", () => {
    expect(billingState({ status: "trialing", trial_ends_at: days(5) }, { now: NOW })).toMatchObject({ kind: "trial", daysLeft: 5, readOnly: false });
    expect(billingState({ status: "trialing", trial_ends_at: days(-1) }, { now: NOW })).toMatchObject({ kind: "expired", readOnly: true });
    expect(billingState({ status: "active", plan: "pro", current_period_end: days(30) }, { now: NOW })).toMatchObject({ kind: "active", readOnly: false });
    expect(billingState({ status: "past_due", plan: "starter" }, { now: NOW })).toMatchObject({ kind: "past_due", readOnly: false });
    expect(billingState({ status: "canceled" }, { now: NOW })).toMatchObject({ kind: "canceled", readOnly: true });
    expect(billingState(null)).toMatchObject({ kind: "none", readOnly: false });
  });
  it("★★★ NOTHING is locked until billing is switched on — and our own team never is", () => {
    expect(BILLING_ENFORCED).toBe(false);
    const expired = billingState({ status: "trialing", trial_ends_at: days(-30) }, { now: NOW });
    expect(isReadOnly(expired)).toBe(false);
    expect(isReadOnly(expired, { enforced: true })).toBe(true);
    expect(isReadOnly(expired, { enforced: true, reviewer: true })).toBe(false);
  });
  it("★★ the Home reminder: from 3 days out, and after", () => {
    expect(trialReminder(billingState({ status: "trialing", trial_ends_at: days(10) }, { now: NOW }))).toBeNull();
    expect(trialReminder(billingState({ status: "trialing", trial_ends_at: days(3) }, { now: NOW }))).toMatchObject({ urgent: false, text: "Your free trial ends in 3 days — choose a plan to keep everything running." });
    expect(trialReminder(billingState({ status: "trialing", trial_ends_at: days(-1) }, { now: NOW }))).toMatchObject({ urgent: true });
    const items = homeWaitingList({ trial: { text: "x", urgent: true } });
    expect(items[0]).toMatchObject({ id: "trial", urgency: WAIT.NOW, actions: [{ kind: "nav", label: "Choose a plan", view: "billing" }] });
  });
  it("★ plain headline", () => {
    expect(billingHeadline(billingState({ status: "trialing", trial_ends_at: days(1) }, { now: NOW }))).toBe("Free trial — 1 day left.");
    expect(billingHeadline({ kind: "active", plan: PLANS[1] })).toBe("You're on Pro.");
  });
});

describe("C771 — the page", () => {
  const ctx = (extra) => ({ subscription: { status: "trialing", trial_ends_at: days(9) }, startCheckout: () => {}, openBillingPortal: () => {}, isOwner: true, ...extra });
  it("★★ on a trial: the status and a 'Choose' button per plan; no Manage billing yet", () => {
    const h = renderViewHtml(BillingView, ctx()).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
    expect(h).toContain('data-billing-status="trial"');
    for (const p of PLANS) expect(h).toContain(`data-billing-choose="${p.id}"`);
    expect(h).not.toContain("data-billing-portal");
  });
  it("★★ paying: Manage billing, no plan picker", () => {
    const h = renderViewHtml(BillingView, ctx({ subscription: { status: "active", plan: "starter", current_period_end: days(20) } }));
    expect(h).toContain("data-billing-portal");
    expect(h).not.toContain("data-billing-plans");
  });
  it("★ a view-only teammate sees the status, not the buttons", () => {
    const h = renderViewHtml(BillingView, ctx({ isOwner: false, isAdmin: false }));
    expect(h).not.toContain("data-billing-choose");
    expect(h).toContain("Only the owner or an admin can change the plan.");
  });
  it("★★ wired: the route, the Settings row, the upload lock (behind the switch), the Home reminder", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toContain('{view==="billing" && <BillingView />}');
    expect(app).toContain("if (isReadOnly(billingState(subscription), { reviewer: !!navSeat?.isReviewerSeat })) { showNotification(READ_ONLY_UPLOAD_COPY");
    expect(readFileSync("src/lib/nav.js", "utf8")).toContain('["billing", "Plan & billing"]');
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toContain("trial: cockpit ? null : trialReminder(billingStateNow),");
  });
});

describe("C771 — the server's pure part", () => {
  const env = { STRIPE_PRICE_STARTER: "price_s", STRIPE_PRICE_PRO: "price_p" };
  it("★★ Stripe statuses map onto the table's four", () => {
    expect(["active", "trialing", "past_due", "unpaid", "incomplete", "canceled", "incomplete_expired", "paused"].map(statusFromStripe))
      .toEqual(["active", "trialing", "past_due", "past_due", "past_due", "canceled", "canceled", "canceled"]);
  });
  it("★★ prices ↔ plans from the environment; a subscription becomes the row patch", () => {
    expect(priceIdFor("pro", env)).toBe("price_p");
    expect(planForPrice("price_s", env)).toBe("starter");
    const p = subscriptionPatch({ id: "sub_1", customer: "cus_1", status: "active", trial_end: null, items: { data: [{ price: { id: "price_p" }, current_period_start: 1763640000, current_period_end: 1766232000 }] } }, env);
    expect(p).toMatchObject({ stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", plan: "pro", status: "active", trial_ends_at: null });
    expect(p.current_period_end).toBe(new Date(1766232000 * 1000).toISOString());
    expect(companyOf({ metadata: { company_id: "co1" } })).toBe("co1");
    expect(companyOf({ client_reference_id: "co2" })).toBe("co2");
  });
  it("★★★ checkout carries the company, keeps a trial with 48h+ left, and only returns to our own sites", () => {
    const f = checkoutFields({ priceId: "price_s", customerId: "cus_1", companyId: "co1", returnUrl: "https://www.shadowcfo.org", trialEndsAt: days(5), now: NOW });
    expect(f).toMatchObject({ mode: "subscription", client_reference_id: "co1", "subscription_data[metadata][company_id]": "co1", success_url: "https://www.shadowcfo.org/?billing=success" });
    // C774 — Stripe Tax on, with the billing address collected and saved on the customer
    expect(f).toMatchObject({ "automatic_tax[enabled]": "true", billing_address_collection: "required", "customer_update[address]": "auto" });
    expect(f["subscription_data[trial_end]"]).toBe(String(Math.floor(Date.parse(days(5)) / 1000)));
    expect(checkoutFields({ priceId: "p", customerId: "c", companyId: "co", returnUrl: "x", trialEndsAt: days(1), now: NOW })["subscription_data[trial_end]"]).toBeUndefined();
    expect(safeReturnUrl("https://evil.example.com")).toBe("https://www.shadowcfo.org");
    expect(safeReturnUrl("http://localhost:5173/")).toBe("http://localhost:5173");
  });
  it("★★★ a webhook is accepted only with a valid, recent Stripe signature", async () => {
    const secret = "whsec_test"; const body = '{"type":"invoice.paid"}'; const t = Math.floor(NOW.getTime() / 1000);
    const sig = crypto.createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, { now: NOW.getTime() })).toBe(true);
    expect(await verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret, { now: NOW.getTime() })).toBe(false);   // tampered
    expect(await verifyStripeSignature(body, `t=${t},v1=${sig}`, "whsec_other", { now: NOW.getTime() })).toBe(false); // wrong secret
    expect(await verifyStripeSignature(body, `t=${t - 600},v1=${crypto.createHmac("sha256", secret).update(`${t - 600}.${body}`).digest("hex")}`, secret, { now: NOW.getTime() })).toBe(false);   // too old
    expect(await verifyStripeSignature(body, "", secret)).toBe(false);
  });
  it("★★ the functions: owner/admin only, not configured until the secret exists, the webhook checks signatures first", () => {
    const b = readFileSync("supabase/functions/billing/index.ts", "utf8");
    expect(b).toContain('if (!env.STRIPE_SECRET_KEY) return json(200, { error: "not_configured" });');
    expect(b).toContain('["owner", "admin"].includes(String(member.role))');
    const w = readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");
    expect(w.indexOf("verifyStripeSignature(raw")).toBeLessThan(w.indexOf("JSON.parse(raw)"));
  });
});

describe("C771 — migration 102 (held)", () => {
  const m = readFileSync("supabase/migrations/102_subscriptions_stripe_only.sql", "utf8");
  it("★★★ members keep reading; nobody signed in can write; a new company still gets its trial", () => {
    for (const p of ["subscriptions_insert", "subscriptions_update", "subscriptions_delete"]) expect(m).toContain(`drop policy if exists ${p} on public.subscriptions;`);
    expect(m).toContain("revoke insert, update, delete on public.subscriptions from anon, authenticated;");
    expect(m).not.toMatch(/drop policy if exists (sub_select|subscriptions_select)/);
    expect(m).toContain("create trigger companies_start_trial after insert on public.companies");
  });
});
