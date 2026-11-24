// ═════════════════════════════════════════════════════════════════════════════
// C771 — PLAN & BILLING. Stripe's hosted pages do the money (Checkout to subscribe, the Billing
// Portal to change card / plan / cancel); Stripe tells our server what happened (the
// `stripe-webhook` edge function), which writes the company's `subscriptions` row; the app reads
// that row. Pure here: what the row means for the owner, in words, and whether the company is
// read-only.
//
// ★ ENFORCEMENT IS OFF UNTIL BILLING IS SWITCHED ON. Every company was given a trial row (14 days until C773)
// at creation (CompanySetup) and nothing ever ended it — so the test companies' trials expired
// months ago. Locking on that data would lock everyone the moment this shipped. `BILLING_ENFORCED`
// stays false until Stripe is live and existing companies have been given a fair trial; until then
// the page and the countdown show, and nothing is locked.
// ═════════════════════════════════════════════════════════════════════════════
export const BILLING_ENFORCED = false;
// ★ C773 — THE FREE TRIAL IS 30 DAYS (operator, 2026-11-24: "a full 30 days, they need a month"). The
// database trigger (migration 103) and CompanySetup use the same number; the Terms say the same.
export const TRIAL_DAYS = 30;

// The plans an owner can choose (C772 — priced and defined 2026-11-21 with the operator, checked
// against market rates: Starter matches AI-run "done for you" tiers (~$99); Pro undercuts human-
// bookkeeper services ($300+ plus software) with nothing else to buy). Prices live in Stripe too —
// keep the two in step. The ids match the table's CHECK.
//
// ★ THE SPLIT IS WHERE THE OPERATOR'S TIME GOES. Starter is kept automatically; our team steps in
// only when something can't be answered automatically — no monthly review. Pro is the monthly review
// and close. A $99 client who also got a monthly human check would cost more time than it pays.
export const PLAN_SPEND_LIMIT = 25000;            // monthly business spending these prices cover
export const QUOTE_CONTACT_EMAIL = "";            // set when there's an inbox for quotes; until then the line has no link
export const PLANS = [
  { id: "starter", name: "Starter", price: 99,
    blurb: "Your books kept for you, automatically.",
    includes: [
      "Receipts, bills and bank statements read and recorded for you",
      "Bank accounts matched automatically",
      "Reports, tax estimates and deadlines",
      "The assistant, any time",
      "Our team steps in when something can't be answered automatically",
    ] },
  { id: "pro", name: "Pro", price: 279,
    blurb: "Everything in Starter, reviewed and closed by our accounting team.",
    includes: [
      "Everything in Starter",
      "A monthly review and close of your books by our accounting team",
      "Every account checked against your bank, every month",
      "Year-end books ready for whoever files your taxes",
      "Your questions answered by our team",
    ] },
];
export const PLANS_EXCLUDE = "Not included in either plan: filing tax returns, payroll, and catching up past years (a one-time catch-up is quoted separately).";
export const sizeLimitCopy = (limit = PLAN_SPEND_LIMIT) => `For businesses spending up to $${limit.toLocaleString("en-US")} a month. Bigger business? Contact us for a quote.`;

const DAY = 86400000;
const daysUntil = (iso, now) => {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  return Math.ceil((t - now.getTime()) / DAY);
};

// What a subscription row means. `kind`:
//   trial    — trialing, days left
//   expired  — a trial that has run out with no paid plan
//   active   — paying
//   past_due — a payment failed; Stripe is retrying
//   canceled — canceled
//   none     — no row (or not loaded)
export function billingState(sub, { now = new Date() } = {}) {
  if (!sub) return { kind: "none", readOnly: false };
  const status = String(sub.status || "");
  const plan = PLANS.find((p) => p.id === sub.plan) || null;
  if (status === "active") return { kind: "active", plan, renews: sub.current_period_end || null, readOnly: false };
  if (status === "past_due") return { kind: "past_due", plan, readOnly: false };
  if (status === "canceled") return { kind: "canceled", plan, readOnly: true };
  // trialing (or a legacy row with plan "trial")
  const left = daysUntil(sub.trial_ends_at, now);
  if (left == null) return { kind: "trial", daysLeft: null, readOnly: false };
  if (left <= 0) return { kind: "expired", daysLeft: 0, readOnly: true };
  return { kind: "trial", daysLeft: left, readOnly: false };
}

// Read-only only when billing is switched on, and never for our own team.
export function isReadOnly(state, { enforced = BILLING_ENFORCED, reviewer = false } = {}) {
  return !!enforced && !reviewer && !!(state && state.readOnly);
}

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export function billingHeadline(state) {
  switch (state && state.kind) {
    case "trial": return state.daysLeft == null ? "You're on the free trial." : `Free trial — ${plural(state.daysLeft, "day")} left.`;
    case "expired": return "Your free trial has ended.";
    case "active": return `You're on ${state.plan ? state.plan.name : "a paid plan"}.`;
    case "past_due": return "Your last payment didn't go through.";
    case "canceled": return "Your plan is canceled.";
    default: return "No plan yet.";
  }
}
export function billingSub(state) {
  switch (state && state.kind) {
    case "trial": return "Everything works during the trial. Choose a plan any time — you won't be charged until the trial ends.";
    case "expired": return "You can still see and download everything. Choose a plan to keep adding documents.";
    case "active": return "Change your card, switch plans, cancel, or download invoices in Manage billing.";
    case "past_due": return "Update your card in Manage billing — your books keep working while Stripe tries again.";
    case "canceled": return "You can still see and download everything. Choose a plan to start again.";
    default: return "Choose a plan to get started.";
  }
}

// The Home reminder: from 3 days before the trial ends, and after it has.
export function trialReminder(state) {
  if (!state) return null;
  if (state.kind === "trial" && state.daysLeft != null && state.daysLeft <= 3) {
    return { text: `Your free trial ends in ${plural(state.daysLeft, "day")} — choose a plan to keep everything running.`, urgent: false };
  }
  if (state.kind === "expired") return { text: "Your free trial has ended — choose a plan to keep adding documents.", urgent: true };
  if (state.kind === "past_due") return { text: "Your last payment didn't go through — update your card to keep your plan.", urgent: true };
  return null;
}

export const READ_ONLY_UPLOAD_COPY = "Your free trial has ended, so new documents can't be added. Everything you have is still here — choose a plan in Settings → Plan & billing to keep going.";
export const BILLING_OFF_COPY = "Billing isn't switched on yet — nothing to pay for now.";
