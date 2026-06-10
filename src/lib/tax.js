// Client-side tax planning helpers. All estimates use simplified federal
// planning rates — no state tax, no credits. See disclaimer in TaxView.

import { FED_TAX_RATE, SE_TAX_RATE } from "./constants";
import { computeRevenue, computeExpenses, computeNetIncome } from "./reports";
export const FED_RATE = FED_TAX_RATE;   // simplified flat federal planning rate
export const SE_RATE = SE_TAX_RATE;     // self-employment (Social Security + Medicare)

// Year-to-date P&L — flows through the canonical layer so taxable net income equals
// the P&L / dashboard / AI net income for the same year (all 5xxx–8xxx expenses).
export function ytdNetIncome(invoices, year = new Date().getFullYear()) {
  const range = { from: `${year}-01-01`, to: `${year}-12-31` };
  return {
    revenue: computeRevenue(invoices, range),
    expenses: computeExpenses(invoices, range),
    net: computeNetIncome(invoices, range),
  };
}

// Estimated federal + SE tax for the year. estPaid = estimated payments already made.
export function taxEstimate(invoices, year = new Date().getFullYear(), estPaid = 0) {
  const { revenue, expenses, net } = ytdNetIncome(invoices, year);
  const taxableNet = Math.max(0, net);
  const seTax = taxableNet * SE_RATE;
  const federal = taxableNet * FED_RATE;
  const total = federal + seTax;
  const paid = Number(estPaid) || 0;
  return { revenue, expenses, net, taxableNet, federal, seTax, total, estPaid: paid, owed: Math.max(0, total - paid), quarterly: total / 4 };
}

// All recurring federal deadlines, resolved to their next occurrence from `now`.
export function getTaxDeadlines(now = new Date()) {
  const defs = [
    { m: 0, d: 15, label: "Q4 estimated tax payment", plain: "Pay your 4th-quarter estimated taxes for last year", form: "Form 1040-ES", url: "https://www.irs.gov/payments", est: true },
    { m: 0, d: 31, label: "W-2s & 1099s to recipients", plain: "Send W-2s and 1099-NEC forms to your employees and contractors", form: "W-2 / 1099-NEC", url: "https://www.irs.gov/forms-pubs/about-form-1099-nec" },
    { m: 1, d: 28, label: "1099s to IRS (paper filing)", plain: "File your 1099s with the IRS if you're filing on paper", form: "Form 1096 / 1099", url: "https://www.irs.gov/forms-pubs/about-form-1096" },
    { m: 2, d: 15, label: "S-Corp & Partnership returns", plain: "File your S-Corp (1120-S) or Partnership (1065) tax return", form: "Form 1120-S / 1065", url: "https://www.irs.gov/forms-pubs/about-form-1120-s" },
    { m: 2, d: 31, label: "1099s to IRS (e-filing)", plain: "File your 1099s with the IRS electronically", form: "Form 1099", url: "https://www.irs.gov/filing/e-file-forms-1099-with-iris" },
    { m: 3, d: 15, label: "Personal return + Q1 estimated", plain: "File your individual return (1040) and pay 1st-quarter estimated taxes", form: "Form 1040 / 1040-ES", url: "https://www.irs.gov/payments", est: true },
    { m: 5, d: 16, label: "Q2 estimated tax payment", plain: "Pay your 2nd-quarter estimated taxes", form: "Form 1040-ES", url: "https://www.irs.gov/payments", est: true },
    { m: 8, d: 15, label: "Q3 estimated + extended business returns", plain: "Pay 3rd-quarter estimated taxes; extended S-Corp/Partnership returns are also due", form: "Form 1040-ES / 1120-S / 1065", url: "https://www.irs.gov/payments", est: true },
    { m: 9, d: 15, label: "Extended personal return", plain: "File your extended individual return (1040)", form: "Form 1040", url: "https://www.irs.gov/forms-pubs/about-form-1040" },
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return defs
    .map(def => {
      let year = now.getFullYear();
      let date = new Date(year, def.m, def.d);
      if (date < today) { year += 1; date = new Date(year, def.m, def.d); }
      const days = Math.round((date - today) / 86400000);
      return { ...def, key: `${def.m}-${def.d}`, date, year, days, color: days <= 14 ? "#D92D20" : days <= 30 ? "#DC6803" : "#039855" };
    })
    .sort((a, b) => a.date - b.date);
}

// The soonest deadline within `withinDays` (for the Home alert). null if none.
export function nextUrgentDeadline(now = new Date(), withinDays = 30) {
  return getTaxDeadlines(now).find(d => d.days <= withinDays && d.days >= 0) || null;
}

// The 12 authoritative deduction categories, keyed to the company's GL accounts by
// system_role so totals follow renamed/renumbered accounts. Each category sums the
// CURRENT CALENDAR YEAR's posted entries for that account, excluding voided AND
// soft-deleted entries. Travel & Entertainment (6400) is reported at 50% per the
// meals-deductibility rule. This is the SAME GL-code/date/filter logic the AI is
// instructed to use when asked "what can I write off?", so the tracker and the chat
// always report identical numbers.
//
// Role → account (default COA): salaries_wages 6000, rent_occupancy 6100,
// utilities 6200, marketing_advertising 6300, travel_entertainment 6400 (×50%),
// technology_software 6500, office_supplies 6600, insurance 6700,
// professional_services 6800, depreciation_amortization 6900,
// miscellaneous_expense 7100, interest_expense 8000.
export function deductionBreakdown(invoices, year = new Date().getFullYear(), getAccountByRole = null) {
  // Identical scope to the AI / reporting: this calendar year, not voided, not soft-deleted.
  const inScope = i =>
    i.status !== "voided" && i.status !== "deleted" && !i.deleted_at &&
    String(i.date || "").startsWith(String(year));
  const sumCode = code => !code ? 0 : (invoices || [])
    .filter(i => inScope(i) && String(i.gl_code || "") === String(code))
    .reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const acct = role => getAccountByRole ? getAccountByRole(role) : null;
  const sumRole = role => sumCode(acct(role)?.code);
  const hintRole = role => { const a = acct(role); return a ? `${a.name} (${a.code})` : ""; };

  const CATEGORIES = [
    { key: "salaries",     label: "Salaries & wages",                          role: "salaries_wages" },
    { key: "rent",         label: "Rent & occupancy",                          role: "rent_occupancy" },
    { key: "utilities",    label: "Utilities",                                 role: "utilities" },
    { key: "marketing",    label: "Marketing & advertising",                   role: "marketing_advertising" },
    { key: "travel",       label: "Travel & entertainment (meals at 50%)",     role: "travel_entertainment", rate: 0.5 },
    { key: "software",     label: "Technology & software",                     role: "technology_software" },
    { key: "supplies",     label: "Office supplies & de minimis equipment",    role: "office_supplies" },
    { key: "insurance",    label: "Insurance",                                 role: "insurance" },
    { key: "proservices",  label: "Professional services (legal, accounting)", role: "professional_services" },
    { key: "depreciation", label: "Depreciation & amortization",               role: "depreciation_amortization" },
    { key: "misc",         label: "Other / miscellaneous",                     role: "miscellaneous_expense" },
    { key: "interest",     label: "Interest expense",                          role: "interest_expense" },
  ];

  const cats = CATEGORIES.map(c => {
    const raw = sumRole(c.role);
    const amount = c.rate ? raw * c.rate : raw;
    return { key: c.key, label: c.label, amount, raw, categorized: raw > 0, hint: hintRole(c.role) };
  });

  // Not auto-categorized from the ledger — surfaced as prompts only (zero amount,
  // so they never affect the deductible total).
  const prompts = [
    { key: "homeoffice", label: "Home office", amount: 0, categorized: false, ask: true, hint: "Tell us if you work from home" },
    { key: "health", label: "Health insurance premiums", amount: 0, categorized: false, ask: true, hint: "Tag these so we can track them" },
    { key: "retirement", label: "Retirement (SEP-IRA, Solo 401k)", amount: 0, categorized: false, ask: true, hint: "Tag contributions to track them" },
  ];

  return [...cats, ...prompts];
}
