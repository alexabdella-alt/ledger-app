// Client-side tax planning helpers. All estimates use simplified federal
// planning rates — no state tax, no credits. See disclaimer in TaxView.

import { FED_TAX_RATE, SE_TAX_RATE } from "./constants";
import { computeRevenue, computeExpenses, computeNetIncome } from "./reports";
import { scheduleCBreakdown, federalEstimate, PERSONAL_RETURN_ITEMS, taxDepreciationFor } from "./taxGuidance.js";
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
// ★ C678 — BY CURRENT RULES (lib/taxGuidance.js): the profit is what's left after the DEDUCTIBLE
// share of spending (half of meals and all of entertainment, fines and income tax stay taxable),
// less a home office; self-employment tax on 92.35% of it with the Social Security wage cap,
// half of it deductible, the 20% qualified business income deduction; a C corporation pays a
// flat 21% and no self-employment tax. Was: a flat 25% + 15.3% on book profit.
export function taxEstimate(invoices, year = new Date().getFullYear(), estPaid = 0, { chart = [], legalForm = "", homeOfficeSqft = 0, assets = null } = {}) {
  const { revenue, expenses, net } = ytdNetIncome(invoices, year);
  const sc = scheduleCBreakdown(invoices, year, { chart, legalForm, homeOfficeSqft, depreciation: assets ? taxDepreciationFor({ ...assets, year }) : null });   // C683
  const f = federalEstimate({ revenue, deductible: sc.deductibleTotal, year, legalForm, flatRate: FED_RATE });
  const paid = Number(estPaid) || 0;
  return { revenue, expenses, net, taxableNet: f.profit, deductible: sc.deductibleTotal, notDeductible: sc.notDeductible,
    federal: f.federal, seTax: f.seTax, qbi: f.qbi, total: f.total, estPaid: paid, owed: Math.max(0, f.total - paid), quarterly: f.total / 4 };
}

// ── HOW THE BUSINESS FILES ITS TAXES (O140, C559) ─────────────────────────────
// The calendar showed the S-Corp/Partnership return to a sole proprietor and the personal
// return to a corporation — every deadline to every company, because nothing knew the legal
// form. These are tax CLASSIFICATIONS, not legal labels: a one-person LLC files like a sole
// proprietor, a multi-member LLC like a partnership, and an LLC that elected S status like an
// S corporation — which is what decides the deadlines. Labels are the owner's words; the form
// numbers stay on the deadline itself, where a preparer looks.
export const LEGAL_FORMS = [
  { value: "sole_prop", label: "Just me — it goes on my personal tax return (includes a one-person LLC)" },
  { value: "partnership", label: "A partnership, or an LLC with more than one owner" },
  { value: "s_corp", label: "An S corporation (or an LLC taxed as one)" },
  { value: "c_corp", label: "A C corporation" },
];
const PASS_THROUGH = ["sole_prop", "partnership", "s_corp"];   // owners pay personal estimated tax

// ★ A DEADLINE ON A WEEKEND MOVES TO THE NEXT BUSINESS DAY — the IRS rule. Without this the
// calendar told people the 1099 deadline was Sunday, January 31, 2027 (it is Monday, February 1).
// Federal holidays are NOT applied (Emancipation Day can move April 15 in some years) — the
// recorded limit; a weekend is the common case.
function nextBusinessDay(d) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  while (out.getDay() === 0 || out.getDay() === 6) out.setDate(out.getDate() + 1);
  return out;
}

// All recurring federal deadlines, resolved to their next occurrence from `now`.
// `legalForm` (C559): known → only the deadlines that apply, in that form's words; unknown →
// the full list as before (no deadline may disappear because we did not ask).
export function getTaxDeadlines(now = new Date(), { legalForm = null } = {}) {
  const known = LEGAL_FORMS.some((f) => f.value === legalForm);
  const defs = [
    { m: 0, d: 15, label: "Q4 estimated tax payment", plain: "Pay your 4th-quarter estimated taxes for last year", form: "Form 1040-ES", url: "https://www.irs.gov/payments", est: true, forms: PASS_THROUGH },
    { m: 0, d: 31, kind: "1099", label: "W-2s & 1099s to recipients", plain: "Send W-2s and 1099-NEC forms to your employees and contractors", form: "W-2 / 1099-NEC", url: "https://www.irs.gov/forms-pubs/about-form-1099-nec" },
    { m: 1, d: 28, kind: "1099", label: "1099s to IRS (paper filing)", plain: "File your 1099s with the IRS if you're filing on paper", form: "Form 1096 / 1099", url: "https://www.irs.gov/forms-pubs/about-form-1096" },
    { m: 2, d: 15, label: "S-Corp & Partnership returns", plain: "File your S-Corp (1120-S) or Partnership (1065) tax return", form: "Form 1120-S / 1065", url: "https://www.irs.gov/forms-pubs/about-form-1120-s", forms: ["partnership", "s_corp"],
      byForm: {
        s_corp: { label: "S corporation return", plain: "File your S corporation's tax return", form: "Form 1120-S" },
        partnership: { label: "Partnership return", plain: "File your partnership's tax return", form: "Form 1065", url: "https://www.irs.gov/forms-pubs/about-form-1065" },
      } },
    { m: 2, d: 31, kind: "1099", label: "1099s to IRS (e-filing)", plain: "File your 1099s with the IRS electronically", form: "Form 1099", url: "https://www.irs.gov/filing/e-file-forms-1099-with-iris" },
    { m: 3, d: 15, label: "Personal return + Q1 estimated", plain: "File your individual return (1040) and pay 1st-quarter estimated taxes", form: "Form 1040 / 1040-ES", url: "https://www.irs.gov/payments", est: true,
      byForm: { c_corp: { label: "Corporate return + Q1 estimated", plain: "File your corporation's tax return and pay its 1st-quarter estimated tax", form: "Form 1120 / 1120-W", url: "https://www.irs.gov/forms-pubs/about-form-1120" } } },
    // ★ JUNE 15, NOT 16. The 16th was right only in a year when the 15th fell on a weekend; the
    // weekend rule above now handles that year by year.
    { m: 5, d: 15, label: "Q2 estimated tax payment", plain: "Pay your 2nd-quarter estimated taxes", form: "Form 1040-ES", url: "https://www.irs.gov/payments", est: true,
      byForm: { c_corp: { plain: "Pay your corporation's 2nd-quarter estimated tax", form: "Form 1120-W" } } },
    { m: 8, d: 15, label: "Q3 estimated + extended business returns", plain: "Pay 3rd-quarter estimated taxes; extended S-Corp/Partnership returns are also due", form: "Form 1040-ES / 1120-S / 1065", url: "https://www.irs.gov/payments", est: true,
      byForm: {
        sole_prop: { label: "Q3 estimated tax payment", plain: "Pay your 3rd-quarter estimated taxes", form: "Form 1040-ES" },
        partnership: { plain: "Pay 3rd-quarter estimated taxes; an extended partnership return is also due", form: "Form 1040-ES / 1065" },
        s_corp: { plain: "Pay 3rd-quarter estimated taxes; an extended S corporation return is also due", form: "Form 1040-ES / 1120-S" },
        c_corp: { label: "Q3 estimated tax payment", plain: "Pay your corporation's 3rd-quarter estimated tax", form: "Form 1120-W" },
      } },
    { m: 9, d: 15, label: "Extended personal return", plain: "File your extended individual return (1040)", form: "Form 1040", url: "https://www.irs.gov/forms-pubs/about-form-1040",
      byForm: { c_corp: { label: "Extended corporate return", plain: "File your corporation's extended tax return", form: "Form 1120", url: "https://www.irs.gov/forms-pubs/about-form-1120" } } },
    // A corporation's 4th estimate is due in December, not January — shown only to a C corporation.
    { m: 11, d: 15, label: "Q4 corporate estimated tax", plain: "Pay your corporation's 4th-quarter estimated tax", form: "Form 1120-W", url: "https://www.irs.gov/payments", est: true, forms: ["c_corp"], onlyWhenKnown: true },
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return defs
    .filter((def) => (known ? (!def.forms || def.forms.includes(legalForm)) : !def.onlyWhenKnown))
    .map(({ forms, byForm, onlyWhenKnown, ...def }) => {
      const words = known && byForm && byForm[legalForm] ? byForm[legalForm] : {};
      let year = now.getFullYear();
      let date = nextBusinessDay(new Date(year, def.m, def.d));
      if (date < today) { year += 1; date = nextBusinessDay(new Date(year, def.m, def.d)); }
      const days = Math.round((date - today) / 86400000);
      return { ...def, ...words, key: `${def.m}-${def.d}`, date, year, days, color: days <= 14 ? "#D92D20" : days <= 30 ? "#DC6803" : "#039855" };
    })
    .sort((a, b) => a.date - b.date);
}

// ★★★ C549 — WHICH YEAR THE 1099 TRACKER IS ABOUT, READ OFF THE DEADLINE RATHER THAN OFF
// TODAY'S DATE. The tracker computed `new Date().getFullYear() - 1` and called it "always the
// previous calendar year" — right in January, when you are preparing the forms for the year
// just ended, and WRONG for the other eleven months. On 2026-09-28 the Taxes screen's own
// 1099 card counted **2026** (`getFullYear()`), the bell counted **2026** (`deadline.year - 1`,
// C435), and the tracker screen the card's button opens was headed **2025** — one surface a
// year behind the two that link to it.
//
// ★★ AND THE DIRECTION IS THE ONE THAT FILE ALREADY NAMES AS DANGEROUS: A MISSING 1099,
// SILENTLY. The screen where you go to see who needs a form, and to export the data, showed a
// year in which a company that signed up this year has no payments at all — so it reads "No
// vendor payments recorded for 2025 yet" for nine months while 2026's reportable suppliers sit
// unlisted. Nothing is wrong on screen; the list is simply of the wrong year.
//
// ★ THE RULE IS C435'S, NOT A NEW ONE: a 1099 deadline is about the payments of the year
// BEFORE it, so the year being tracked is `next 1099 deadline .year - 1`. Jan–Mar it is the
// closed year you are filing for (Jan 31 / Feb 28 / Mar 31 all resolve to the same year);
// from April it is the year in progress, which is the year you are accruing toward.
export function taxYearFor1099(now = new Date()) {
  const next = getTaxDeadlines(now).find((d) => d.kind === "1099");
  return next ? next.year - 1 : now.getFullYear();
}

// The soonest deadline within `withinDays` (for the Home alert). null if none.
// C388 — `filed` is the Taxes screen's map (`${key}-${year}` → true): a deadline the person
// has marked filed is not due, so Home and the bell stop asking about it. Without this the
// tick on the Taxes screen changed nothing anywhere else (O123: an action whose effect is
// invisible will be repeated).
export const filedKey = (d) => `${d.key}-${d.year}`;
// C434 — an ESTIMATED-PAYMENT deadline is only waiting when there is something to pay. A
// brand-new company with no books was told "Pay your 3rd-quarter estimated taxes — due in 12
// days" as its first item on Home, and would be told again every quarter regardless of
// income (O122: a card the user sees every quarter is a bug). Filing deadlines (1099s, the
// return itself) stay — those are about forms, not amounts.
export function deadlineIsWaiting(d, estimate, { has1099s = true } = {}) {
  if (!d) return false;
  // C435 — a 1099 filing deadline waits only when the plan names someone to file for; a
  // company with no reportable contractor was told to "send 1099-NEC forms" every January.
  if (d.kind === "1099") return !!has1099s;
  if (!d.est) return true;
  return !!(estimate && Number(estimate.total) > 0);
}
// ★ C618 — THE YEAR AN ESTIMATED PAYMENT IS ABOUT. The January 15 payment is the 4th quarter of
// the year just ENDED; every other one is about the year it falls in. Home and the bell
// computed every estimate from `getFullYear()`, so on January 1–15 the Q4 reminder was sized
// from a new year with a fortnight of profit — near zero, so it read "nothing to pay" and hid.
export const estimateTaxYearFor = (d) => (d && d.m === 0 ? Number(d.year) - 1 : Number(d && d.year));

// ★ C618 — THE FIRST DEADLINE THAT NEEDS SOMETHING, NOT THE FIRST DEADLINE. Home asked for the
// next deadline and THEN checked whether it was waiting; when the first one had nothing to pay,
// the answer was "nothing", and the January 31 1099 deadline right behind it was never looked at.
// `estimateFor(year)` and `has1099sFor(deadline)` are the caller's (they need the ledger).
export function nextWaitingDeadline(now = new Date(), withinDays = 30, { filed = {}, legalForm = null, estimateFor = () => null, has1099sFor = () => true } = {}) {
  for (const d of getTaxDeadlines(now, { legalForm })) {
    if (!(d.days <= withinDays && d.days >= 0) || (filed && filed[filedKey(d)])) continue;
    const estimate = d.est ? estimateFor(estimateTaxYearFor(d)) : null;
    const has1099s = d.kind === "1099" ? !!has1099sFor(d) : true;
    if (deadlineIsWaiting(d, estimate, { has1099s })) return { deadline: d, estimate };
  }
  return null;
}

export function nextUrgentDeadline(now = new Date(), withinDays = 30, { filed = {}, legalForm = null } = {}) {
  return getTaxDeadlines(now, { legalForm }).find(d => d.days <= withinDays && d.days >= 0 && !(filed && filed[filedKey(d)])) || null;
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
export function deductionBreakdown(invoices, year = new Date().getFullYear(), getAccountByRole = null, { chart = null, homeOfficeSqft = 0, legalForm = "", assets = null } = {}) {
  // ★ C678 — EVERY spending account, by its Schedule C line and the deductible share of it
  // (lib/taxGuidance.js). The twelve fixed categories left Food Cost, Repairs, Payroll taxes,
  // Bank fees, Vehicle, Contractors and every category an owner added out of the total. The
  // chart comes from the caller; without one, the roles the caller can resolve are used.
  const known = chart || (getAccountByRole ? Object.keys(ROLE_HINTS).map((r) => { const x = getAccountByRole(r); return x ? { ...x, system_role: x.system_role || r } : null; }).filter(Boolean) : []);
  const sc = scheduleCBreakdown(invoices, year, { chart: known, homeOfficeSqft, legalForm, depreciation: assets ? taxDepreciationFor({ ...assets, year }) : null });   // C683
  const rows = sc.rows.map((r) => ({ key: r.line, line: r.line, label: r.label, form: r.form, amount: r.deductible, raw: r.spent,
    categorized: r.spent > 0 || r.deductible > 0, hint: r.accounts.join(", "), notDeductible: r.taxAdjusted ? 0 : r2(r.spent - r.deductible), taxAdjusted: !!r.taxAdjusted }));
  const personal = PERSONAL_RETURN_ITEMS.map((p) => ({ ...p, amount: 0, categorized: false, ask: true }));
  return [...rows, ...personal];
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// The roles a caller without a chart can still resolve (getAccountByRole), so its accounts map by role.
const ROLE_HINTS = { salaries_wages: 1, payroll_tax: 1, employee_benefits: 1, rent_occupancy: 1, utilities: 1, repairs_maintenance: 1, marketing_advertising: 1,
  travel_entertainment: 1, technology_software: 1, merchant_processing_fees: 1, bank_service_charges: 1, office_supplies: 1, insurance: 1, professional_services: 1,
  depreciation_amortization: 1, bad_debt: 1, miscellaneous_expense: 1, uncategorized_expense: 1, interest_expense: 1, income_tax_expense: 1, cogs: 1, direct_labor: 1,
  shipping_fulfillment: 1, food_cost: 1, beverage_cost: 1, vehicle_expenses: 1, subcontractor_costs: 1, taxes_licenses: 1 };
