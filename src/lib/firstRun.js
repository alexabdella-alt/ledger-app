// ─────────────────────────────────────────────────────────────────────────────
// C583 — THE FIRST FIVE MINUTES, IN AN OWNER'S WORDS.
//
// C572–C580 went through every screen behind the login. The screens BEFORE it — sign-up,
// naming the company — and the first-run checklist were never held to the same bar, and
// they are where a new owner decides whether this is for them. The sign-in page told a
// café owner that Shadow "codes the GL, books the entry", offers "burn rate, runway, or a
// P&L", and is "Tenant-isolated (RLS) · ASC 842 compliant". These are the words, and the
// small decisions, those screens now share — pure, so a test can read them.
// ─────────────────────────────────────────────────────────────────────────────

// What the sign-in page says the product does. No accounting terms (a test checks).
export const AUTH_TAGLINE = "Shadow does your bookkeeping, watches the numbers, and tells you what matters — before you have to ask.";
export const AUTH_FEATURES = [
  ["Drop it in, and it's done", "A bill, a receipt, a bank statement — drop it in. We read it, file it under the right category, and tell you why."],
  ["Ask in plain English", "“What did I spend on software this year?” “Who owes me money?” Answers come from your real numbers."],
  ["Ready for your accountant", "Every change is recorded, so your accountant can review your books and sign off each month."],
];
// ★ ONLY WHAT IS VERIFIED (§11's hard rule for the client-facing story): tenant isolation was
// audited table by table; the audit trail exists. "ASC 842 compliant" was a compliance claim
// nobody has certified, on the first screen a stranger reads — gone.
export const AUTH_FOOTER = "Your books are private to your company · Every change is recorded";

export const AUTH_HEADINGS = {
  login:  { title: "Welcome back", sub: "Sign in to your books." },
  signup: { title: "Get started", sub: "Create your account — it takes about a minute." },
  reset:  { title: "Reset your password", sub: "Enter your email and we'll send you a secure reset link." },
};

// How an invite names the role. The banner said "as a member" for an accountant and for a
// view-only teammate alike — the two people for whom the difference matters most.
export function inviteRoleLabel(role) {
  switch (String(role || "").toLowerCase()) {
    case "admin": return "an admin";
    case "accountant": return "their accountant";
    case "viewer": return "a view-only member";
    case "owner": return "an owner";
    default: return "a member";
  }
}

// What is wrong with the form, said BEFORE the request — or null. An empty sign-in went to
// the server and came back as "That email and password don't match", which is not what
// happened.
export const PASSWORD_MIN = 6;
export function authFormProblem({ mode = "login", email = "", password = "" } = {}) {
  const e = String(email || "").trim();
  if (!e) return "Enter your email address first.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "That doesn't look like an email address — check it and try again.";
  if (mode === "reset") return null;
  if (!password) return mode === "signup" ? `Choose a password — at least ${PASSWORD_MIN} characters.` : "Enter your password.";
  if (mode === "signup" && String(password).length < PASSWORD_MIN) return `Password must be at least ${PASSWORD_MIN} characters.`;
  return null;
}

// After a sign-up that needs the email confirmed.
export const confirmEmailCopy = (email) =>
  `Almost there — we've sent a confirmation link to ${String(email || "your email").trim()}. Click it, then sign in here. (Check spam if you don't see it.)`;

// The company-naming screen. `first` = the person has no company yet.
export function companySetupCopy({ first = true } = {}) {
  return first
    ? { title: "What's your business called?", sub: "This is the name on your books and on invoices you send. You can change it later in Settings.", button: "Continue →", busy: "Setting up your books…" }
    : { title: "Add another business", sub: "Each business keeps its own separate books. You can switch between them from the top of the screen.", button: "Create →", busy: "Setting up its books…" };
}
export const COMPANY_NAME_PLACEHOLDER = "e.g. Riverside Bakery";

// The first-run checklist's two setup steps. (Upload and starting balances: lib/onboarding.js.)
export const CHECKLIST_COPY = {
  biz:  { label: "Tell us about your business", hint: "What kind of business it is — so we set up the right categories. About 20 seconds." },
  // C586 — optional. We already created one account ("Primary Checking"); this is for naming it,
  // or adding a second, so a statement lands in the right one.
  bank: { label: "Name your bank account", hint: "We've set one up for you. Rename it or add another in Settings → Your business — worth doing if you have more than one account or a credit card" },
};
export const BUSINESS_MODAL_INTRO = "Three quick questions. They set up the right categories and tax dates for your kind of business — you can change them later in Settings.";
export const BUSINESS_SAVE_HINT = "Pick a business type to continue.";

// The upload box.
export const DROPZONE_COPY = {
  title: "Drop anything here",
  dragging: "Release to upload",
  sub: "Bills, receipts, bank statements, contracts — we read it and file it in your books",
  choose: "or click to choose files from your computer or phone",
  reading: "READING YOUR FILES…",
};
