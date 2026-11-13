// Client-side tax planning helpers. All estimates use simplified federal
// planning rates — no state tax, no credits. See disclaimer in TaxView.

import { FED_TAX_RATE, SE_TAX_RATE } from "./constants";
import { computeRevenue, computeExpenses, computeNetIncome } from "./reports";
const r2c = (n) => Math.round((Number(n) || 0) * 100) / 100;
import { scheduleCBreakdown, federalEstimate, PERSONAL_RETURN_ITEMS, taxDepreciationFor, retirementRoom } from "./taxGuidance.js";
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
// ★ C690 — income tax by the year's brackets, from the owner's filing status and other income
// (saved with the year's tax settings: filed_deadlines.filing_status / other_income). Nothing
// saved → single with no other income, and `assumed` says so on screen.
// ★ C693 — the answers CARRY FORWARD: a year with no answer yet uses the other year's (`fallback`),
// field by field, so the question isn't asked again every January and the January 15 reminder
// for last year's 4th quarter uses last year's answers (profileForYear). `carried` says which.
// `own_wages` (the owner's pay from a job) is separate from other household income because it
// uses up the Social Security wage base.
const revenueFor = (invoices, year) => ytdNetIncome(invoices, year).revenue;   // C703 — caps the home office
export function taxProfileFrom(filed = {}, fallback = {}) {
  const f = filed || {}, b = fallback || {};
  const pick = (k) => (f[k] != null && f[k] !== "" ? { v: f[k], carried: false } : b[k] != null && b[k] !== "" ? { v: b[k], carried: true } : { v: null, carried: false });
  const st = pick("filing_status"), oi = pick("other_income"), ow = pick("own_wages"), ho = pick("home_office_sqft"), hp = pick("health_premiums"), sh = pick("owner_share");   // C700, C703
  // C692 — business miles are this year's only (never carried)
  const miles = Math.max(0, Math.floor(Number(f.business_miles) || 0));
  const after = f.business_miles_after_change;
  return { homeOfficeSqft: Number(ho.v) || 0, filingStatus: st.v || "single", otherIncome: Math.max(0, Number(oi.v) || 0), ownWages: Math.max(0, Number(ow.v) || 0), healthPremiums: Math.max(0, Number(hp.v) || 0), ownerShare: sh.v == null ? 1 : Math.min(1, Math.max(0, Number(sh.v) / 100)), ownerShareAssumed: sh.v == null,
    businessMiles: miles, businessMilesAfterChange: after == null || after === "" ? null : Math.max(0, Math.floor(Number(after) || 0)),
    assumed: !st.v, carried: st.carried || oi.carried || ow.carried || hp.carried };
}
// The profile for an estimate of `year`: that year's answers, else the neighbouring year's.
export function profileForYear(year, { current = {}, prev = {}, currentYear = new Date().getFullYear() } = {}) {
  if (Number(year) === currentYear - 1) return taxProfileFrom(prev, current);
  // C698 — an older year: its own settings aren't loaded; carry the nearest answers (no miles —
  // those are that year's only), rather than this year's miles and home office
  if (Number(year) < currentYear - 1) return taxProfileFrom({}, prev && Object.keys(prev).length ? prev : current);
  return taxProfileFrom(current, prev);
}
// ═════════════════════════════════════════════════════════════════════════════
// ★ C695 / C698 — WHAT TO PAY EACH QUARTER (IRC §6654).
// The safe harbor: no underpayment penalty if each of the four installments, by its own due date,
// is 25% of the smaller of 90% of THIS YEAR'S FULL tax or 100% of LAST YEAR'S tax (110% when last
// year's AGI was over $150,000; $75,000 married filing separately). This year's full tax isn't
// known until December — the books only hold the year so far — so (C698, review) a preparer works
// from the one certain number: last year's. When last year's books are complete, the payment is
// 100% / 110% of last year's business tax ÷ 4, every quarter, and paying it on time avoids the
// penalty whatever this year turns out to be (planning: the books' figure stands in for last
// year's return — the screen says to use the return's figure if it differs).
// Without last year's books, there is no penalty-safe figure to give, so the advice is honest
// pay-as-you-go: the tax on this year's profit so far, less what has been paid — never called
// "enough to avoid a penalty". (C695 compared last year's FULL tax with this year's year-to-date
// tax, and early in the year recommended a sixth of the required payment as "penalty-safe".)
// Pass-throughs only — a corporation's installments stay at a quarter of this year's.
// ═════════════════════════════════════════════════════════════════════════════
export function safeHarborQuarter({ thisYear = 0, lastYear = null, lastYearAgi = 0, filingStatus = "single", paid = 0 } = {}) {
  const now = Math.max(0, Number(thisYear) || 0);
  if (lastYear == null) {
    const dueNow = r2c(Math.max(0, now - (Number(paid) || 0)));
    return { perQuarter: dueNow, basis: "so_far", factor: null, required: r2c(now) };
  }
  const factor = (Number(lastYearAgi) || 0) > (filingStatus === "mfs" ? 75000 : 150000) ? 1.1 : 1;
  const required = r2c(Math.max(0, Number(lastYear) || 0) * factor);
  return { perQuarter: r2c(required / 4), basis: "last_year", factor, required };
}
// C698 — last year's books are complete only when they start on or before last January 1 (the
// cutoff) and hold some income or spending for it; a cutoff inside last year means the months
// before it are only in the opening balance, and last year's tax can't be recomputed.
const booksCoverYear = (invoices, year, cutoffDate) => (!cutoffDate || String(cutoffDate) <= `${year}-01-01`)
  && (invoices || []).some((i) => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at
    && String(i.date || "").startsWith(`${year}-`) && /^[4-8]\d{3}$/.test(String(i.gl_code || "")));
export function taxEstimate(invoices, year = new Date().getFullYear(), estPaid = 0, { chart = [], legalForm = "", homeOfficeSqft = 0, assets = null, filingStatus = "single", otherIncome = 0, ownWages = 0, healthPremiums = 0, ownerShare = 1, businessMiles = 0, businessMilesAfterChange = null, priorProfile = null, cutoffDate = null } = {}) {
  const { revenue, expenses, net } = ytdNetIncome(invoices, year);
  const mileageRate = businessMiles > 0 && (!legalForm || legalForm === "sole_prop");   // C703
  const sc = scheduleCBreakdown(invoices, year, { chart, legalForm, homeOfficeSqft, grossIncome: revenueFor(invoices, year), depreciation: assets ? taxDepreciationFor({ ...assets, year, ledger: invoices, mileageRate }) : null, mileage: { miles: businessMiles, milesAfterChange: businessMilesAfterChange } });   // C683, C686, C692, C703
  // C703 — the owner's health insurance / retirement paid from the business count on the personal
  // return; a figure typed on the Taxes screen wins over what the books show (never both)
  const health = healthPremiums > 0 ? healthPremiums : (sc.ownerHealth || 0);
  const ownerRet = sc.ownerRetirement || 0;
  const f = federalEstimate({ revenue, deductible: sc.deductibleTotal, year, legalForm, filingStatus, otherIncome, ownWages, healthPremiums: health, retirement: ownerRet, ownerShare });   // C690, C693, C700, C703
  const paid = Number(estPaid) || 0;
  return { revenue, expenses, net, taxableNet: Math.max(0, f.profit), deductible: sc.deductibleTotal, notDeductible: sc.notDeductible,
    federal: f.federal, seTax: r2c(f.seTax + (f.addlMedicare || 0)), addlMedicare: f.addlMedicare || 0, qbi: f.qbi,   // C685 — self-employment tax includes the 0.9% over $200k
    total: f.total, estPaid: paid, owed: Math.max(0, f.total - paid),
    quarterlyFull: Math.max(0, f.total) / 4,   // C693 — a loss saves tax; it never makes a payment negative
    ...quarterPlan(),
    marginalRate: f.marginalRate || 0, standardDeduction: f.standardDeduction || 0, qbiMayBeLimited: !!f.qbiMayBeLimited, healthDeduction: f.healthDeduction || 0,   // C700
    retirement: retirementPlan() };
  // C696 — how much a sole proprietor or partner could put away, and what it would save this year
  function retirementPlan() {
    if (!["", "sole_prop", "partnership"].includes(legalForm || "") || !(f.profit > 0)) return null;
    const room = retirementRoom({ profit: f.profit, halfSe: f.halfSe, year });
    const saves = (amt) => r2c(Math.max(0, f.total - federalEstimate({ revenue, deductible: sc.deductibleTotal, year, legalForm, filingStatus, otherIncome, ownWages, healthPremiums: health, ownerShare, retirement: ownerRet + amt }).total));
    // C698 — employees on the books: a Solo 401(k) is for an owner with no employees, and a SEP
    // must give eligible employees the same percentage; a job's 401(k) shares the deferral limit
    const hasEmployees = sc.rows.some((r) => r.line === "26" && r.spent > 0);
    return { ...room, sepSaves: saves(room.sep), solo401kSaves: saves(room.solo401k), hasEmployees, hasJob: ownWages > 0 };
  }
  // C695 — the quarterly payment by the safe harbor, when last year's books and answers allow it
  function quarterPlan() {
    if (legalForm === "c_corp") return { quarterly: Math.max(0, f.total) / 4, safeHarbor: null };
    if (!priorProfile || !booksCoverYear(invoices, year - 1, cutoffDate)) {
      const sh = safeHarborQuarter({ thisYear: f.total, paid });
      return { quarterly: sh.perQuarter, safeHarbor: sh };
    }
    const p = priorProfile;
    const prev = ytdNetIncome(invoices, year - 1);
    const pMileage = (p.businessMiles || 0) > 0 && (!legalForm || legalForm === "sole_prop");
    const psc = scheduleCBreakdown(invoices, year - 1, { chart, legalForm, homeOfficeSqft: p.homeOfficeSqft || 0, grossIncome: prev.revenue, depreciation: assets ? taxDepreciationFor({ ...assets, year: year - 1, ledger: invoices, mileageRate: pMileage }) : null, mileage: { miles: p.businessMiles || 0, milesAfterChange: p.businessMilesAfterChange ?? null } });
    const pf = federalEstimate({ revenue: prev.revenue, deductible: psc.deductibleTotal, year: year - 1, legalForm, filingStatus: p.filingStatus || "single", otherIncome: p.otherIncome || 0, ownWages: p.ownWages || 0,
      healthPremiums: (p.healthPremiums || 0) > 0 ? p.healthPremiums : (psc.ownerHealth || 0), retirement: psc.ownerRetirement || 0, ownerShare: p.ownerShare == null ? ownerShare : p.ownerShare });
    const lastYearAgi = (p.otherIncome || 0) + (p.ownWages || 0) + pf.profit - pf.halfSe - (pf.healthDeduction || 0);   // C700
    const sh = safeHarborQuarter({ thisYear: f.total, lastYear: pf.total, lastYearAgi, filingStatus });   // C698 — this year's filing status decides the MFS threshold
    return { quarterly: sh.perQuarter, safeHarbor: { ...sh, lastYearTax: Math.max(0, pf.total) } };
  }
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
export function deductionBreakdown(invoices, year = new Date().getFullYear(), getAccountByRole = null, { chart = null, homeOfficeSqft = 0, legalForm = "", assets = null, businessMiles = 0, businessMilesAfterChange = null, healthPremiums = 0 } = {}) {
  // ★ C678 — EVERY spending account, by its Schedule C line and the deductible share of it
  // (lib/taxGuidance.js). The twelve fixed categories left Food Cost, Repairs, Payroll taxes,
  // Bank fees, Vehicle, Contractors and every category an owner added out of the total. The
  // chart comes from the caller; without one, the roles the caller can resolve are used.
  const known = chart || (getAccountByRole ? Object.keys(ROLE_HINTS).map((r) => { const x = getAccountByRole(r); return x ? { ...x, system_role: x.system_role || r } : null; }).filter(Boolean) : []);
  const mileageRate = businessMiles > 0 && (!legalForm || legalForm === "sole_prop");   // C703
  const sc = scheduleCBreakdown(invoices, year, { chart: known, homeOfficeSqft, legalForm, grossIncome: revenueFor(invoices, year), depreciation: assets ? taxDepreciationFor({ ...assets, year, ledger: invoices, mileageRate }) : null, mileage: { miles: businessMiles, milesAfterChange: businessMilesAfterChange } });   // C683, C686, C692, C703
  const rows = sc.rows.map((r) => ({ key: r.line, line: r.line, label: r.label, form: r.form, amount: r.deductible, raw: r.spent,
    categorized: r.spent > 0 || r.deductible > 0, hint: r.accounts.join(", "), notDeductible: r.taxAdjusted ? 0 : r2(r.spent - r.deductible), taxAdjusted: !!r.taxAdjusted, mileage: r.mileage || null }));
  // C703 — what the books show the business paid for the owner's own health insurance / retirement
  const personal = PERSONAL_RETURN_ITEMS.map((p) => ({ ...p, amount: 0, categorized: false, ask: true,
    booked: p.key === "health" ? (sc.ownerHealth || 0) : p.key === "retirement" ? (sc.ownerRetirement || 0) : 0 }));
  return [...rows, ...personal];
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// The roles a caller without a chart can still resolve (getAccountByRole), so its accounts map by role.
const ROLE_HINTS = { salaries_wages: 1, payroll_tax: 1, employee_benefits: 1, rent_occupancy: 1, utilities: 1, repairs_maintenance: 1, marketing_advertising: 1,
  travel_entertainment: 1, technology_software: 1, merchant_processing_fees: 1, bank_service_charges: 1, office_supplies: 1, insurance: 1, professional_services: 1,
  depreciation_amortization: 1, bad_debt: 1, miscellaneous_expense: 1, uncategorized_expense: 1, interest_expense: 1, income_tax_expense: 1, cogs: 1, direct_labor: 1,
  shipping_fulfillment: 1, food_cost: 1, beverage_cost: 1, vehicle_expenses: 1, subcontractor_costs: 1, taxes_licenses: 1 };
