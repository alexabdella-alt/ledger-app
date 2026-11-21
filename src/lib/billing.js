// ═════════════════════════════════════════════════════════════════════════════
// C771 — PLAN & BILLING. Stripe's hosted pages do the money (Checkout to subscribe, the Billing
// Portal to change card / plan / cancel); Stripe tells our server what happened (the
// `stripe-webhook` edge function), which writes the company's `subscriptions` row; the app reads
// that row. Pure here: what the row means for the owner, in words, and whether the company is
// read-only.
//
// ★ ENFORCEMENT IS OFF UNTIL BILLING IS SWITCHED ON. Every company was given a 14-day trial row
// at creation (CompanySetup) and nothing ever ended it — so the test companies' trials expired
// months ago. Locking on that data would lock everyone the moment this shipped. `BILLING_ENFORCED`
// stays false until Stripe is live and existing companies have been given a fair trial; until then
// the page and the countdown show, and nothing is locked.
// ═════════════════════════════════════════════════════════════════════════════
export const BILLING_ENFORCED = false;

// The plans an owner can choose. Prices live in Stripe (the checkout shows them); `price` here is
// display only and is filled in once the operator sets them. The ids match the table's CHECK.
export const PLANS = [
  { id: "starter", name: "Starter", price: null, blurb: "Your books kept for you: uploads read and recorded, bank matching, reports and tax estimates." },
  { id: "pro", name: "Pro", price: null, blurb: "Everything in Starter, plus monthly review by our accounting team." },
];

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
