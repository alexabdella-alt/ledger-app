// ─────────────────────────────────────────────────────────────────────────────
// C576 — REPORTS SAY WHAT EACH ONE IS FOR, IN AN OWNER'S WORDS.
//
// Reports opened on eleven tabs named the way an accountant names them — "P&L", "KPIs", a
// trial balance labelled "All account balances" with Debit/Credit columns — and a toggle
// reading "Accrual / Cash" with nothing to say what either meant. An owner had a plain
// paragraph at the top (U4) and then a wall of vocabulary. Now: a line saying where to
// start, a line under the tabs saying what the open report answers, the toggle in words,
// and the trial balance kept for the accountant's seat, where it is a working tool.
// ─────────────────────────────────────────────────────────────────────────────

export const REPORTS_PURPOSE = "Pick a report below. Start with Profit & Loss to see whether you made money.";

const TABS = [
  ["pl", "Profit & Loss"], ["balance", "Balance Sheet"], ["trial", "All account balances"],
  ["araging", "Money owed to you"], ["apaging", "Bills to pay"], ["kpis", "Key numbers"],
  ["vendor", "By Vendor"], ["gl", "By Category"], ["cashflow", "Cash Flow"], ["project", "By Project"],
  ["monthly", "Monthly Reports"],
];
// The accountant's working tools — not hidden from them, just not put in front of an owner.
const REVIEWER_ONLY = new Set(["trial"]);

export function reportTabsFor({ reviewer = false } = {}) {
  return TABS.filter(([id]) => reviewer || !REVIEWER_ONLY.has(id));
}

// What each report answers. One sentence, no accounting terms.
export const REPORT_GUIDE = {
  pl: "Money in versus money out for the dates you pick — the bottom line is your profit (or loss).",
  balance: "What the business owns and what it owes, on one day. What's left over is what the business is worth on paper.",
  trial: "Every category's running balance — the accountant's check that everything adds up.",
  araging: "Customers who haven't paid you yet, grouped by how late they are.",
  apaging: "Bills you haven't paid yet, grouped by how soon or how late they're due.",
  kpis: "The handful of numbers that tell you how the business is doing at a glance.",
  vendor: "How much you spent with each vendor.",
  gl: "How much went into each category — where the money goes.",
  cashflow: "Where your cash came from and where it went, which can differ from profit when bills and invoices are still unpaid.",
  project: "Money in and out for each project you've tagged.",
  monthly: "A saved summary for each month, kept as it was when the month closed.",
};

export const BASIS_LABELS = {
  accrual: { button: "When billed", subtitle: "Counted when billed" },
  cash: { button: "When paid", subtitle: "Counted when paid" },
};
export const BASIS_EXPLAINER = "\"When billed\" counts a sale or a bill on its invoice date. \"When paid\" counts it on the day the money actually moved. Your accountant may ask for either.";
