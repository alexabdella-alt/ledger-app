// ─────────────────────────────────────────────────────────────────────────────
// Shared report calculations — AR/AP aging, trial balance, KPIs, and the
// financial health score. Pure functions over the flattened `invoices` array so
// every report reconciles with every other (and so they're unit-testable).
// All of these EXCLUDE voided / soft-deleted entries (trial balance offers an
// "unadjusted" toggle that includes voided). Uses the shared GL helpers.
// ─────────────────────────────────────────────────────────────────────────────

import { glIsRevenue, glIsExpense } from "./gl";
import { fmtSignedMoney, ymdLocal, todayLocal } from "./format";

const num = n => Number(n) || 0;
const r2 = n => Math.round(num(n) * 100) / 100;
const r1 = n => Math.round(num(n) * 10) / 10;
// Canonical cents (was ad-hoc whole-dollar Math.round — a cross-surface divergence
// with the dashboard/chatbot/Balance Sheet). Prose + KPI explanations + monthly report.
const fmtMoney = n => fmtSignedMoney(n);
export const isLiveEntry = i => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at;
const isCOGS = c => String(c || "")[0] === "5";
const isOpEx = c => { const s = String(c || "")[0]; return s === "6" || s === "7" || s === "8"; };
const ymOf = d => String(d || "").slice(0, 7);
// Classify by GL code when present (authoritative — flatten types every non-revenue
// line of a MULTI-LINE entry as "expense", incl. its AP/cash legs, so trusting `type`
// would miscount balance-sheet legs). Fall back to `type` only when no code is set.
const isRev = i => i.gl_code ? glIsRevenue(i.gl_code) : i.type === "revenue";
const isExp = i => i.gl_code ? glIsExpense(i.gl_code) : i.type === "expense";
const arUnpaid = i => isRev(i) && i.payment_status !== "paid" && i.payment_status !== "collected";
const apUnpaid = i => isExp(i) && i.payment_status !== "paid";
// The amount OWED on a row: for a taxed AR invoice the receivable is the full incl-tax
// A/R balance (carried as `ar_amount`), not the ex-tax revenue (`amount`). AP/untaxed
// rows have no ar_amount → fall back to amount. Keeps AR aging/total tied to GL A/R.
export const owedAmount = i => num(i && i.ar_amount != null ? i.ar_amount : i && i.amount);
const daysOverdue = (dueDate, now) => dueDate ? Math.floor((now - new Date(String(dueDate) + "T12:00:00")) / 86400000) : 0;

// ── SHARED LEG-SIGN PRIMITIVES (the one place debit/credit → sign lives) ──────
// Normal-balance by code first digit: assets(1) & expenses(5–8) are debit-normal
// (+ on debit); liabilities(2), equity(3), revenue(4) are credit-normal.
const isDebitNormalCode = c => { const d = String(c || "")[0]; return d === "1" || d === "5" || d === "6" || d === "7" || d === "8"; };
// The primary leg's debit/credit, from the flattened row. `debit_credit` is authoritative
// (flatten always sets it); isRev is a fallback ONLY for legacy rows that predate that field.
// It is NEVER an override — force-crediting revenue rows mis-signs contra-revenue / refunds /
// reversal legs (the CR-2 bug). A Dr-Revenue row must sign as a debit and SUBTRACT.
const legPrimaryIsDebit = i => (i && i.debit_credit) ? i.debit_credit === "debit" : !(i && isRev(i));
// A leg's contribution to its account's NORMAL-POSITIVE balance: revenue and expense both
// come back positive for ordinary activity; a contra / reversal leg comes back negative, so
// summing these nets a void/reversal to zero instead of double-counting (the CR-1 root).
const legSigned = (code, isDebit, amt) => isDebitNormalCode(code) ? (isDebit ? amt : -amt) : (isDebit ? -amt : amt);

// Signed movement into the accounts matched by `match(code)`, over a period, as a
// normal-positive total. Walks each LIVE row's legs — the primary always; the offset leg too
// for simple 2-line rows (multi-line rows are already one leg each) — signing by debit/credit.
// This is the SINGLE basis for revenue/expense: reversals, refunds, and intra-P&L reclasses
// net correctly, and it ties to glAccountBalance (same walk, same sign) by construction.
function plMovement(invoices, range, match) {
  let total = 0;
  for (const i of liveEntries(invoices, range)) {
    for (const leg of plLegs(i, match)) total += leg.signed;
  }
  return r2(total);
}

// The matching P&L legs of one flattened row: primary always; the offset leg too for simple
// 2-line rows (multi-line rows are already one leg each). Each leg signed to its account's
// normal balance; both legs of a simple row share the row's vendor/date. This is the SHARED
// two-leg walk behind computeRevenue/Expenses, computeCategoryTotals, computeVendorTotals, and
// computeBurnRate — so an intra-P&L RECLASS (Dr 6200 / Cr 6100) nets in ALL of them (no
// primary-only double-count) and they stay divergent-twin-free (Σvendors === Σcategories === total).
function plLegs(i, match) {
  const out = [];
  const amt = num(i && i.amount);
  if (!i || amt === 0) return out;
  const pDebit = legPrimaryIsDebit(i);
  if (match(i.gl_code)) out.push({ code: i.gl_code, name: i.gl_name, signed: legSigned(i.gl_code, pDebit, amt) });
  if (!String(i.id).includes("_") && match(i.secondary_gl_code)) out.push({ code: i.secondary_gl_code, name: i.secondary_gl_name, signed: legSigned(i.secondary_gl_code, !pDebit, amt) });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL CALCULATION LAYER (full reconciliation audit)
// EVERY surface — dashboard, P&L, balance sheet, vendor/category reports, the
// monthly report, KPIs, the health score, anomaly inputs, notifications, the AI
// financial snapshot, and the AI tools — flows through these and ONLY these.
// A figure shown in two places is computed by the same function here, so it is
// identical to the penny. Rules:
//   • isLiveEntry is the ONE liveness predicate (not voided, not soft-deleted).
//   • Classification is by GL code via glIsRevenue/glIsExpense (never name/type).
//   • Dates are inclusive YYYY-MM-DD string ranges; pass {from,to} (null = open).
//   • Every public total is rounded once, at the boundary, via r2.
//   • Accrual basis (all posted entries) is canonical; cash basis is a P&L-only view.
// ═══════════════════════════════════════════════════════════════════════════

// Inclusive date-range test over YYYY-MM-DD strings (lexicographic == chronological).
const inDateRange = (date, from, to) => { const d = String(date || ""); if (from && d < from) return false; if (to && d > to) return false; return true; };

// The live entries for a period: not voided/deleted, within [from,to]. The single
// gate every figure below passes through.
export function liveEntries(invoices, { from = null, to = null } = {}) {
  return (invoices || []).filter(i => isLiveEntry(i) && inDateRange(i.date, from, to));
}

// Revenue / expense = the SIGNED movement into the 4xxx / 5xxx–8xxx accounts (not a raw
// `amount` sum). A live reversing/void entry posts the opposite legs, so it subtracts and the
// P&L nets to zero instead of doubling (CR-1). Every consumer — P&L, monthly report, By
// Vendor/Category/Project, KPIs, businessHealth, the RE split, the AI snapshot, tax — inherits it.
export function computeRevenue(invoices, range = {}) { return plMovement(invoices, range, glIsRevenue); }
export function computeExpenses(invoices, range = {}) { return plMovement(invoices, range, glIsExpense); }
export function computeNetIncome(invoices, range = {}) {
  return r2(computeRevenue(invoices, range) - computeExpenses(invoices, range));
}

// ── FISCAL-YEAR RETAINED-EARNINGS SPLIT (derived soft close, Option A) ────────
// The start (YYYY-MM-DD) of the fiscal year containing `asOf`, given a fiscal year
// END of "MM-DD" (default 12-31). e.g. FYE 12-31 → Jan 1; FYE 06-30, asOf in Mar →
// prior Jul 1. Used to separate prior-years' (closed) earnings from current-period
// net income on an interim balance sheet without posting closing entries.
//
// O87 DECISION (date-handling family): this is FIXED onto local dates, NOT left UTC.
// It parses `asOf` as LOCAL midnight (`+"T00:00:00"`, not `Z`) and returns `ymdLocal`, so
// the Jan-1 boundary can't day-shift for a non-UTC user. This does NOT desync the Balance
// Sheet — the reason the edge was watched — because fiscalYearStart is the SINGLE shared
// boundary function used by BOTH `currentPeriodRange` (report windows) AND `fiscalYearSplit`
// (the BS retained-earnings split). One function → they move together by construction; there
// is no separate UTC copy to drift. (Both callers also pass a LOCAL `asOf`/today.)
export function fiscalYearStart(asOf, fiscalYearEnd = "12-31") {
  const D = new Date(String(asOf) + "T00:00:00");
  if (isNaN(D)) return null;
  const parts = String(fiscalYearEnd || "12-31").split("-").map(Number);
  const m = parts[0] || 12, d = parts[1] || 31;
  let fyEnd = new Date(D.getFullYear(), m - 1, d);
  if (D > fyEnd) fyEnd = new Date(D.getFullYear() + 1, m - 1, d);   // FY ends next calendar year
  const start = new Date(fyEnd);                                     // start = day after the previous FYE
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);
  return ymdLocal(start);   // fiscal-year start is a PERIOD boundary — local, not UTC (closes CR-6)
}

// The default reporting window for a freshly-opened Reports page (O70). It ALWAYS
// ends today — never a stale saved date — and begins at the current period's start.
//   period "mtd"      → first of the current calendar month
//   period "ytd"/"fy" → the fiscal-year start (respects a non-calendar fiscal_year_end),
//                       floored at the company cutoff (no activity exists before it)
//   period "all"      → unbounded ("" / "")
// Pure (takes `today`), so the "to == today, from == period start" contract is tested.
export function currentPeriodRange(period = "fy", { today = null, fiscalYearEnd = "12-31", cutoffDate = null } = {}) {
  const to = today || todayLocal();   // report window ends "today" — local period boundary
  if (period === "all") return { from: "", to: "" };
  if (period === "mtd") return { from: to.slice(0, 7) + "-01", to };
  const fyStart = fiscalYearStart(to, fiscalYearEnd);
  const from = (cutoffDate && fyStart && String(cutoffDate) > fyStart) ? String(cutoffDate) : (fyStart || (to.slice(0, 4) + "-01-01"));
  return { from, to };
}

// Split all-time net income (through `asOf`) into the prior fiscal years' closed net
// (→ rolls into beginning Retained Earnings) and the current fiscal year's net
// (→ "Net Income (current period)"). FY start is floored at the cutoff date (no
// activity exists before it). Invariant: priorNet + currentNet === all-time net.
export function fiscalYearSplit(invoices, { asOf, fiscalYearEnd = "12-31", cutoffDate = null } = {}) {
  const fyStartRaw = fiscalYearStart(asOf, fiscalYearEnd);
  const fyStart = (cutoffDate && fyStartRaw && String(cutoffDate) > fyStartRaw) ? String(cutoffDate) : fyStartRaw;
  let priorNet = 0, currentNet = 0;
  for (const i of liveEntries(invoices, { to: asOf })) {
    // Net-income contribution of this row's P&L leg, signed by debit/credit so a reversal/void
    // nets to zero — keeps the RE split (Balance Sheet) tied to computeNetIncome (Income Statement).
    const amt = num(i.amount); if (amt === 0) continue;
    const leg = legSigned(i.gl_code, legPrimaryIsDebit(i), amt);
    const signed = isRev(i) ? leg : isExp(i) ? -leg : 0;
    if (signed === 0) continue;
    if (fyStart && String(i.date || "") < fyStart) priorNet += signed; else currentNet += signed;
  }
  return { fyStart, priorNet: r2(priorNet), currentNet: r2(currentNet) };
}

// Expense totals by GL category for a period, sorted high→low. The SUM of these
// totals === computeExpenses(...) exactly (same gate, same rounding boundary).
export function computeCategoryTotals(invoices, range = {}) {
  const map = {};
  const add = (code, name, signed) => {
    if (!glIsExpense(code)) return;                       // expense accounts only, by GL class
    const k = String(code);
    const c = map[k] || (map[k] = { gl_code: k, category: name || k, total: 0, count: 0 });
    c.total += signed; c.count++;
  };
  for (const i of liveEntries(invoices, range)) {         // both legs (plLegs) → reversals + reclasses net; Σ === computeExpenses
    for (const leg of plLegs(i, glIsExpense)) add(leg.code, leg.name, leg.signed);
  }
  return Object.values(map).map(c => ({ ...c, total: r2(c.total) })).filter(c => Math.abs(c.total) >= 0.005)
    .sort((a, b) => b.total - a.total || String(a.gl_code).localeCompare(String(b.gl_code)));
}

// Per-vendor totals over P&L accounts only (income-statement scope) — the figure
// the vendor REPORT shows and the AI's get_vendor_summary must equal.
// Spend BY VENDOR — expenses only (the "Expenses by Vendor" report). Classified by
// GL account CLASS, not by whether a counterparty name exists: a revenue invoice that
// happens to carry a customer name (e.g. an AR collection) is NOT a vendor expense and
// must be excluded. `side:"revenue"` gives the symmetric by-customer view if ever needed.
export function computeVendorTotals(invoices, range = {}, { side = "expense" } = {}) {
  const match = side === "revenue" ? glIsRevenue : glIsExpense;
  const map = {};
  for (const i of liveEntries(invoices, range)) {
    // BOTH legs (plLegs) so an intra-P&L reclass (Dr 6200 / Cr 6100, one vendor) nets to the
    // real spend instead of double-counting the primary leg. Σvendors === Σcategories === total.
    const legs = plLegs(i, match);
    if (!legs.length) continue;
    const signed = legs.reduce((s, l) => s + l.signed, 0);
    const name = i.vendor || "Unknown";
    const v = map[name] || (map[name] = { vendor: name, total: 0, count: 0, last_date: "", gl_code: i.gl_code, gl_name: i.gl_name });
    v.total += signed; v.count++;
    if (String(i.date || "") > v.last_date) { v.last_date = String(i.date || ""); v.gl_code = i.gl_code; v.gl_name = i.gl_name; }
  }
  return Object.values(map).map(v => ({ ...v, total: r2(v.total) })).sort((a, b) => b.total - a.total);
}

// Cash on hand = the GL balance of the cash / cash-equivalent accounts, summed.
// THE canonical cash figure — derives from the ledger via glAccountBalance, exactly
// like the Balance Sheet cash line, so every cash surface agrees by construction.
// NB: this is NOT the bank statement balance. The bank balance is the external figure
// GL cash is RECONCILED against; a difference between them is a reconciliation item.
export function glCashOnHand(invoices, cashCodes, { asOf = null } = {}) {
  return r2((cashCodes || []).reduce((s, code) => s + glAccountBalance(code, invoices, { asOf }), 0));
}

// The month key immediately before `ym` ("2026-01" → "2025-12").
const prevYm = (ym) => {
  const [y, m] = String(ym).split("-").map(Number);
  const d = new Date(y, (m || 1) - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Monthly burn = average expense over a `months`-wide (default 3) CONTIGUOUS calendar
// window anchored to the last month that actually has activity, and NOTHING about the
// definition should surprise the reader:
//   • the window ANCHORS on the most recent ACTIVE month (not on "today") — so sporadic
//     or late-entered books don't read $0 just because the last few calendar months are
//     empty (the failure the old months-with-data code was working around);
//   • on the live dashboard the CURRENT partial month is excluded from being that anchor
//     (`excludePartialMonth`), so a single fresh transaction can't become the whole
//     figure; a monthly report of a CLOSED month passes false so its subject month counts;
//   • inside the window it's a FIXED contiguous span — an empty month counts as $0 and we
//     divide by the span length, not by "months that happen to have data", so it can't
//     reach back and skip empties to inflate;
//   • one-off SPIKE months (total > 3× the window median) are dropped when there are ≥3
//     months to judge against, so an annual payment or a setup-import month doesn't
//     distort the average (and the runway that divides by it);
//   • <`months` months of history divides by what it has.
// Returns { value, window:[{ym,total,dropped}], asOfMonth, anchor }. `computeBurnRate` is
// the scalar; the dashboard drill renders `window` so the breakdown reconciles to it.
export function burnRateDetail(invoices, { asOf = null, months = 3, dropOutliers = true, excludePartialMonth = true } = {}) {
  const monthExp = {};
  for (const i of liveEntries(invoices, { to: asOf })) {
    const m = ymOf(i.date); if (!m) continue;
    for (const leg of plLegs(i, glIsExpense)) monthExp[m] = (monthExp[m] || 0) + leg.signed;  // both legs → reclass nets
  }
  const dataMonths = Object.keys(monthExp).sort();
  const curYm = ymOf(asOf || ymdLocal(new Date()));
  const firstData = dataMonths[0];
  if (!firstData) return { value: 0, window: [], asOfMonth: curYm, anchor: null };

  // Anchor = the most recent ACTIVE month at or before the ceiling. On the dashboard the
  // ceiling is the last COMPLETE month (current partial month excluded); for a closed-
  // month report it's the report month itself. Fall back to the latest active month ≤ asOf
  // (a brand-new company whose only activity is the current partial month still shows it).
  const ceiling = excludePartialMonth ? prevYm(curYm) : curYm;
  const atOrBefore = (lim) => { let a = null; for (const m of dataMonths) if (m <= lim) a = m; return a; };
  const anchor = atOrBefore(ceiling) || atOrBefore(curYm) || dataMonths[dataMonths.length - 1];

  const window = [];
  for (let cur = anchor; window.length < months && cur >= firstData; cur = prevYm(cur)) {
    window.push({ ym: cur, total: r2(monthExp[cur] || 0), dropped: false });
  }
  window.reverse();  // chronological

  if (dropOutliers && window.length >= 3) {
    const med = median(window.map((w) => w.total));
    if (med > 0) {
      const flagged = window.filter((w) => w.total > 3 * med);
      if (flagged.length && window.length - flagged.length >= 1) {
        for (const w of window) if (w.total > 3 * med) w.dropped = true;
      }
    }
  }
  const kept = window.filter((w) => !w.dropped);
  const value = r2(kept.length ? kept.reduce((s, w) => s + w.total, 0) / kept.length : 0);
  return { value, window, asOfMonth: curYm, anchor };
}

// Scalar burn — THE figure the card, runway, and AI snapshot all share (same window
// everywhere → they never drift). See burnRateDetail for the definition.
export function computeBurnRate(invoices, opts = {}) {
  return burnRateDetail(invoices, opts).value;
}
export function computeRunway(cash, burn) { const b = num(burn); return b > 0 ? r1(num(cash) / b) : null; }

// AR / AP totals. `total` = all open (accrual); `overdue` = past the due date.
// `now` anchors the overdue test. Reconciles with agingReport (same predicates).
function arApTotals(invoices, predicate, now) {
  let total = 0, overdue = 0, count = 0, overdueCount = 0;
  for (const i of (invoices || [])) {
    if (!isLiveEntry(i) || !predicate(i)) continue;
    const amt = owedAmount(i); total += amt; count++;   // incl-tax for AR; amount for AP/untaxed
    if (i.due_date && daysOverdue(i.due_date, now) > 0) { overdue += amt; overdueCount++; }
  }
  return { total: r2(total), overdue: r2(overdue), count, overdueCount };
}
export function computeAR(invoices, { now = new Date() } = {}) { return arApTotals(invoices, arUnpaid, now); }
export function computeAP(invoices, { now = new Date() } = {}) { return arApTotals(invoices, apUnpaid, now); }

// ── CANONICAL GL ACCOUNT BALANCE (single source of truth for any account) ────
// (Normal-balance sign + leg helpers are defined once, up top — isDebitNormalCode /
// legPrimaryIsDebit / legSigned — so this walk and the P&L walk sign identically.)
//
// The true GL balance of an account = the sum of its journal-entry-line movements,
// signed to the account's normal balance. Walks the flattened ledger: each row's
// primary leg (gl_code) plus, for simple (non-expanded) entries, its offset leg
// (secondary_gl_code); multi-line entries (id contains "_") are already one row per
// line, so only their primary leg is taken (no double count). This is THE number for
// "what the ledger says is in this account" — e.g. Accounts Payable owed. `asOf`
// bounds by date (inclusive). Reconciles with the balance sheet (same walk).
export function glAccountBalance(code, invoices, { asOf = null } = {}) {
  if (!code) return 0;
  const debitNormal = isDebitNormalCode(code);
  const signed = (isDebit, amt) => debitNormal ? (isDebit ? amt : -amt) : (isDebit ? -amt : amt);
  let bal = 0;
  for (const i of (invoices || [])) {
    if (!isLiveEntry(i)) continue;
    if (asOf && String(i.date || "") > asOf) continue;
    const amt = num(i.amount);
    if (amt === 0) continue;
    const primaryIsDebit = legPrimaryIsDebit(i);   // no revenue force-credit — Dr Revenue subtracts (CR-2)
    if (i.gl_code === code) bal += signed(primaryIsDebit, amt);
    // Offset leg only for simple 2-line entries (multi-line rows are pre-expanded).
    // Same fix as the trial balance: the offset leg carries its own amount. Identical for
    // every balanced entry; only a one-sided entry moves, and it should.
    if (!String(i.id).includes("_") && i.secondary_gl_code === code) {
      bal += signed(!primaryIsDebit, i.secondary_amount != null ? num(i.secondary_amount) : amt);
    }
  }
  return r2(bal);
}

// Open / paid PAYABLE LISTS — the exact rows behind computeAP. The Payables page
// renders these so its listed bills reconcile to the penny with its own headline
// total, the AP aging report, and the AI. (Previously ApView filtered inline with
// `glIsExpense(gl_code) || type==="expense"` + `status!=="voided"`, which let
// soft-deleted and balance-sheet-leg rows leak into the list but not the total.)
// openPayables uses the SAME predicate as computeAP; sum(openPayables.amount) === computeAP.total.
export function openPayables(invoices) {
  return (invoices || []).filter(i => isLiveEntry(i) && apUnpaid(i));
}
export function paidPayables(invoices) {
  return (invoices || []).filter(i => isLiveEntry(i) && isExp(i) && i.payment_status === "paid");
}
// Symmetric AR lists (used to keep the receivables surface on the same footing).
export function openReceivables(invoices) {
  return (invoices || []).filter(i => isLiveEntry(i) && arUnpaid(i));
}

// GL-TRUTH open A/R & A/P LISTS — only entries that actually touch the A/R (A/P) account
// on a leg (primary, or the offset leg of a simple 2-line entry) AND are still uncollected
// (unpaid). This is the predicate that EXCLUDES a direct-cash revenue/expense that never
// created a receivable/payable — e.g. a Stripe payout booked Dr Cash / Cr Revenue, or a card
// charge booked Dr Expense / Cr Cash. Those satisfy isRev/isExp + the payment flag (so the
// looser openReceivables/openPayables include them), but have no A/R/A/P leg. The rows here
// tie to glAccountBalance(arCode/apCode), so a card's count + list + total all reconcile.
// arCode/apCode missing → empty (degrade safely rather than over-report).
const touchesAccount = (i, code) => code != null &&
  (String(i.gl_code) === String(code) ||
   (!String(i.id).includes("_") && String(i.secondary_gl_code) === String(code)));
export function openReceivablesGL(invoices, arCode) {
  return (invoices || []).filter(i => isLiveEntry(i) && arUnpaid(i) && touchesAccount(i, arCode));
}
export function openPayablesGL(invoices, apCode) {
  return (invoices || []).filter(i => isLiveEntry(i) && apUnpaid(i) && touchesAccount(i, apCode));
}

// ── AR / AP AGING (Items 24, 83) ────────────────────────────────────────────
export function agingReport(invoices, side = "ar", now = new Date()) {
  const open = (invoices || []).filter(i => isLiveEntry(i) && (side === "ar" ? arUnpaid(i) : apUnpaid(i)));
  const defs = [
    { key: "current", label: "Current", test: d => d <= 0 },
    { key: "1-30",    label: "1–30 days",  test: d => d >= 1 && d <= 30 },
    { key: "31-60",   label: "31–60 days", test: d => d >= 31 && d <= 60 },
    { key: "61-90",   label: "61–90 days", test: d => d >= 61 && d <= 90 },
    { key: "90+",     label: "90+ days",   test: d => d > 90 },
  ];
  const buckets = defs.map(d => ({ key: d.key, label: d.label, rows: [], total: 0, count: 0 }));
  const bmap = Object.fromEntries(buckets.map(b => [b.key, b]));
  let total = 0;
  for (const i of open) {
    const d = daysOverdue(i.due_date, now);
    const def = defs.find(x => x.test(d)) || defs[0];
    const row = {
      id: i.id, party: i.vendor || (side === "ar" ? "Customer" : "Vendor"),
      date: i.date, due_date: i.due_date || null, amount: r2(owedAmount(i)),
      days_overdue: Math.max(0, d), gl_name: i.gl_name, email: i._contact?.email || i.customer_email || null,
    };
    bmap[def.key].rows.push(row); bmap[def.key].total += row.amount; bmap[def.key].count++;
    total += row.amount;
  }
  buckets.forEach(b => { b.total = r2(b.total); b.rows.sort((a, c) => c.days_overdue - a.days_overdue || String(c.date).localeCompare(String(a.date))); });
  return { side, buckets, total: r2(total), count: open.length };
}

// ── TRIAL BALANCE (Item 100) ────────────────────────────────────────────────
// includeVoided=true → "Unadjusted" (all posted entries incl. voided);
// includeVoided=false → "Adjusted" (excludes voided/soft-deleted, reconciles
// with every other report). Reconstructs both sides of each entry: the flattened
// row's primary account, plus the offset (secondary) for simple 2-line entries;
// multi-line entries are already expanded one row per line (id contains "_"), so
// only their primary side is taken to avoid double counting.
export function trialBalance(invoices, { includeVoided = false } = {}) {
  const list = (invoices || []).filter(i =>
    includeVoided ? (i && i.status !== "deleted" && !i.deleted_at) : isLiveEntry(i));
  const acct = {};
  const add = (code, name, side, amt) => {
    if (!code) return;
    const a = acct[code] || (acct[code] = { code, name: name || code, debit: 0, credit: 0 });
    if (name && (a.name === code || !a.name)) a.name = name;
    if (side === "debit") a.debit += amt; else a.credit += amt;
  };
  for (const i of list) {
    const amt = num(i.amount);
    if (amt === 0) continue;
    const side = i.debit_credit === "credit" ? "credit" : "debit";
    add(i.gl_code, i.gl_name, side, amt);
    const isExpanded = String(i.id).includes("_");
    // ★★★ THE OFFSET LEG POSTS ITS OWN AMOUNT, not a copy of the primary's. Deriving it
    // made every two-line entry balance by construction, so this check — "the fundamental
    // tie-out" — could not fail on the commonest shape in the ledger (C289). `secondary_amount`
    // equals `amount` for every balanced entry, so nothing moves; it differs only when an
    // entry is genuinely one-sided, which is precisely what a control total is for.
    const offsetAmt = i.secondary_amount != null ? num(i.secondary_amount) : amt;
    if (!isExpanded && i.secondary_gl_code) add(i.secondary_gl_code, i.secondary_gl_name, side === "debit" ? "credit" : "debit", offsetAmt);
  }
  const accounts = Object.values(acct)
    .map(a => { const net = r2(a.debit - a.credit); return { code: a.code, name: a.name, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 }; })
    .filter(a => a.debit !== 0 || a.credit !== 0)
    .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  const totalDebit = r2(accounts.reduce((s, a) => s + a.debit, 0));
  const totalCredit = r2(accounts.reduce((s, a) => s + a.credit, 0));
  const difference = r2(totalDebit - totalCredit);
  return { accounts, totalDebit, totalCredit, difference, balanced: Math.abs(difference) < 0.005 };
}

// ── KPIs (Item 33) ──────────────────────────────────────────────────────────
// Each returns { key, label, value, display, status:"good"|"warn"|"bad"|"na",
// explanation, trend:"up"|"down"|"flat"|null }. Divide-by-zero → status "na".
export function computeKPIs(invoices, { cashBalance = 0, now = new Date() } = {}) {
  const live = (invoices || []).filter(isLiveEntry);
  // TZ-safe month keys: derive from LOCAL date components, NEVER toISOString() (UTC). A local
  // end-of-month (endOfMonth("2026-05") = May 31 23:59 local) rolls into the NEXT month under
  // UTC for any user behind UTC — that starved this strip of the month's rows and wrongly showed
  // "N/A — no revenue" while the P&L body (TZ-safe string ranges) showed real figures.
  const ymLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const thisMonth = ymLocal(now);
  const lastMonth = ymLocal(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const inMonth = m => live.filter(i => ymOf(i.date) === m);
  const sum = (set, pred) => set.filter(pred).reduce((s, i) => s + num(i.amount), 0);                                  // raw (AR/AP owed)
  // Signed, BOTH-leg P&L sum (plLegs) → reversals AND intra-P&L reclasses net (CR-1 + F-3).
  const sumPL = (set, codeMatch) => set.reduce((s, i) => s + plLegs(i, codeMatch).reduce((a, l) => a + l.signed, 0), 0);
  const rev = set => sumPL(set, glIsRevenue), cogs = set => sumPL(set, isCOGS), opex = set => sumPL(set, isOpEx), exp = set => sumPL(set, glIsExpense);
  const arOut = sum(live, arUnpaid);
  const cash = num(cashBalance);
  const apOut = sum(live, apUnpaid);
  const tm = inMonth(thisMonth), lm = inMonth(lastMonth);
  const trend = (cur, prev) => (cur == null || prev == null) ? null : (Math.abs(cur - prev) < 1e-9 ? "flat" : (cur > prev ? "up" : "down"));
  const out = [];

  // 1. Current Ratio = Current Assets / Current Liabilities
  if (apOut <= 0) {
    out.push({ key: "current_ratio", label: "Current Ratio", value: null, display: "N/A — no current liabilities", status: "na", trend: null,
      explanation: "No unpaid bills on the books yet — once you owe money this shows whether cash + receivables can cover it." });
  } else {
    const v = (cash + arOut) / apOut;
    out.push({ key: "current_ratio", label: "Current Ratio", value: r1(v), display: `${r1(v).toFixed(1)}×`, trend: null,
      status: v > 2 ? "good" : v >= 1 ? "warn" : "bad",
      explanation: `${fmtMoney(cash + arOut)} in cash + receivables against ${fmtMoney(apOut)} of bills due — ${v > 2 ? "a comfortable cushion." : v >= 1 ? "tight but covered." : "you can't currently cover short-term obligations."}` });
  }

  // 2. Gross Margin = (Revenue − COGS) / Revenue × 100
  const gm = set => { const r = rev(set); return r > 0 ? ((r - cogs(set)) / r) * 100 : null; };
  const gmCur = gm(tm);
  if (gmCur == null) out.push({ key: "gross_margin", label: "Gross Margin", value: null, display: "N/A — no revenue yet", status: "na", trend: null, explanation: "No revenue recorded this month, so margin can't be computed." });
  else out.push({ key: "gross_margin", label: "Gross Margin", value: r1(gmCur), display: `${r1(gmCur)}%`, status: gmCur >= 50 ? "good" : gmCur >= 25 ? "warn" : "bad", trend: trend(gmCur, gm(lm)), explanation: `After direct costs (COGS), you keep ${r1(gmCur)}¢ of every revenue dollar.` });

  // 3. Operating Expense Ratio = OpEx / Revenue × 100
  const oer = set => { const r = rev(set); return r > 0 ? (opex(set) / r) * 100 : null; };
  const oerCur = oer(tm);
  if (oerCur == null) out.push({ key: "opex_ratio", label: "Operating Expense Ratio", value: null, display: "N/A — no revenue yet", status: "na", trend: null, explanation: "No revenue this month to compare operating expenses against." });
  else out.push({ key: "opex_ratio", label: "Operating Expense Ratio", value: r1(oerCur), display: `${r1(oerCur)}%`, status: oerCur <= 60 ? "good" : oerCur <= 90 ? "warn" : "bad", trend: trend(oerCur, oer(lm)), explanation: `Operating expenses eat ${r1(oerCur)}% of revenue — lower is leaner.` });

  // 4. Burn Multiple = Net Burn / Net New Revenue
  const netBurn = exp(tm) - rev(tm);
  const netNewRev = rev(tm) - rev(lm);
  if (netNewRev <= 0) out.push({ key: "burn_multiple", label: "Burn Multiple", value: null, display: "N/A — no new revenue", status: "na", trend: null, explanation: "Revenue didn't grow versus last month, so burn multiple isn't meaningful yet." });
  else if (netBurn <= 0) out.push({ key: "burn_multiple", label: "Burn Multiple", value: 0, display: "0.0× (profitable)", status: "good", trend: null, explanation: "You grew revenue without burning cash — excellent." });
  else { const v = netBurn / netNewRev; out.push({ key: "burn_multiple", label: "Burn Multiple", value: r1(v), display: `${r1(v)}×`, status: v < 1 ? "good" : v < 2 ? "warn" : "bad", trend: null, explanation: `Burned ${fmtMoney(netBurn)} to add ${fmtMoney(netNewRev)} of new revenue — under 1× is efficient.` }); }

  // 5. Days Sales Outstanding = (AR / Revenue) × 30
  const dsoOf = set => { const r = rev(set); return r > 0 ? (arOut / r) * 30 : null; };
  const dsoCur = dsoOf(tm);
  if (dsoCur == null) out.push({ key: "dso", label: "Days Sales Outstanding", value: null, display: "N/A — no revenue yet", status: "na", trend: null, explanation: "No revenue this month, so collection days can't be computed." });
  else out.push({ key: "dso", label: "Days Sales Outstanding", value: Math.round(dsoCur), display: `${Math.round(dsoCur)} days`, status: dsoCur <= 30 ? "good" : dsoCur <= 60 ? "warn" : "bad", trend: trend(dsoCur, dsoOf(lm)), explanation: `On average it takes ~${Math.round(dsoCur)} days to collect on sales — lower means faster cash.` });

  return out;
}

// ── OWNER-FACING BUSINESS HEALTH (plain-language, actionable) ────────────────
// The "am I okay, and what do I do?" read for the business owner — built ONLY from things
// the owner cares about and can act on: profitability, runway, cash, overdue AR, burn trend.
// Deliberately EXCLUDES books-health (reconciled / setup / anomalies): those are SHADOW's job
// (the bookkeeping the client pays us to do) and belong to the internal CPA review queue (O50),
// NOT as a demerit on the owner's dashboard. Honest, not rosy — a real problem is stated plainly
// with its number and a next step. Returns { tone, headline, facts[], concerns[] }.
export function businessHealth(invoices = [], { cash = 0, now = new Date() } = {}) {
  const year = now.getFullYear();
  const today = ymdLocal(now);   // was toISOString (UTC) while `year` used local — now consistent, local
  // CANONICAL money display: the SAME exact-cents formatter the chatbot's tools
  // (aiTools.money → fmtSignedMoney) and the Balance Sheet use. Previously this
  // rounded to WHOLE dollars (Math.round), which round-half-up'd a $49,213.50 cash
  // balance to "$49,214" while the chatbot showed the exact cents → a $1 disagreement
  // that could never reconcile. One canonical value (glCash, sum-then-round-once to
  // cents) + one formatter here = dashboard === chatbot to the penny, by construction.
  const money = (n) => fmtSignedMoney(n);

  const net = computeNetIncome(invoices, { from: `${year}-01-01`, to: `${year}-12-31` });
  const burn = computeBurnRate(invoices, { asOf: today });
  const runwayRaw = computeRunway(cash, burn);                       // months, or null when there's no burn
  const runwayInfinite = runwayRaw === null;
  const runway = runwayInfinite ? Infinity : Math.floor(runwayRaw);

  const overdue = (invoices || []).filter(i => isLiveEntry(i) && arUnpaid(i) && i.due_date && daysOverdue(i.due_date, now) > 60);
  const overdueTotal = r2(overdue.reduce((s, i) => s + num(owedAmount(i)), 0));

  // burn trend — this month vs the previous month that has data
  const monthExp = {};
  for (const i of liveEntries(invoices, { to: today })) { const m = ymOf(i.date); if (!m) continue; for (const leg of plLegs(i, glIsExpense)) monthExp[m] = (monthExp[m] || 0) + leg.signed; }
  const ms = Object.keys(monthExp).sort();
  const curM = ms.length ? monthExp[ms[ms.length - 1]] : 0;
  const prevM = ms.length > 1 ? monthExp[ms[ms.length - 2]] : null;
  const burnUpPct = (prevM && prevM > 0 && curM > prevM * 1.05) ? Math.round((curM / prevM - 1) * 100) : 0;

  // The FOUR key numbers live here (once) as the facts under the headline — they replaced the
  // separate metric-card row so the owner never sees the same figures twice. `drill` opens the
  // same dashboard drill the old cards did. Monthly burn = the TRAILING-3-MONTH AVERAGE spend
  // (the same `burn` runway divides by, and what the runway drill shows as "average monthly
  // burn") — NOT the current partial month, which collapsed to the single most-recent expense
  // early in a month and disagreed with the runway math shown right beside it.
  // ── C198·3b (e) — A PROFITABLE BUSINESS IS NOT BURNING ─────────────────────
  // Live O86, on the DEMO surface a prospect sees: "You're profitable with ~3 months
  // of runway · Worth a look". Two true facts welded into a false one. "Runway" is a
  // countdown to running out — it presumes you are consuming cash faster than you
  // make it. Said of a company that is making money, it is simply wrong, and the
  // alarm badge beside it turned a healthy month into a scare.
  //
  // The numbers do not change. The framing does: when net income is positive the same
  // figure is stated as COVERAGE ("cash covers about N months of spending at the
  // current pace, even before new revenue"), which is what it actually measures, and
  // it stops being a concern. The alarm is reserved for the genuinely alarming state —
  // unprofitable AND short of cash.
  const profitable = net >= 0;
  const runwayShort = !runwayInfinite && runway < 6;

  const facts = [
    { key: "cash",   label: "Cash on hand",         value: money(cash),                                    tone: "neutral",                                                                     drill: "cash" },
    { key: "burn",   label: "Monthly burn",         value: money(burn),                                    tone: "neutral",                                                                     drill: "burn" },
    // Coverage on a profitable month is a fact, not a warning — no amber beside "You're profitable".
    { key: "runway", label: profitable ? "Cash covers" : "Runway", value: runwayInfinite ? "No burn" : `~${runway} mo`,
      tone: (runwayInfinite || runway >= 6) ? "good" : profitable ? "neutral" : runway >= 3 ? "watch" : "concern", drill: "runway" },
    { key: "profit", label: `Net income · ${year}`, value: money(net),                                     tone: profitable ? "good" : "concern",                                               drill: "net" },
  ];

  const concerns = [];
  if (!profitable) concerns.push({ key: "profit", severity: "high", text: `You're spending more than you're earning this year (${money(net)} net).` });
  // Don't re-state the burn number here — it's already in the facts row above; reference it.
  if (runwayShort && !profitable) concerns.push({ key: "runway", severity: runway < 3 ? "high" : "med", text: `Only ~${runway} month${runway === 1 ? "" : "s"} of runway at the current spending pace.`, actionLabel: "See burn breakdown", actionView: "runway" });
  if (overdue.length) concerns.push({ key: "ar", severity: overdueTotal >= 5000 ? "high" : "med", text: `${overdue.length} invoice${overdue.length > 1 ? "s are" : " is"} 60+ days overdue (${money(overdueTotal)}).`, actionLabel: "Chase overdue invoices", actionView: "ar" });
  if (burnUpPct) concerns.push({ key: "burn", severity: "med", text: `Spending is up ${burnUpPct}% versus last month.` });

  concerns.sort((a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1));
  const tone = concerns.some(c => c.severity === "high") ? "concern" : concerns.length ? "watch" : "good";

  const months = (n) => `${n} month${n === 1 ? "" : "s"}`;
  const lead = profitable
    ? `You're profitable.${runwayInfinite ? "" : ` Cash covers about ${months(runway)} of spending at the current pace, even before new revenue.`}`
    : `You're running at a loss${runwayInfinite ? "" : ` with about ${months(runway)} of runway`}.`;
  const headline = !concerns.length
    ? `${lead} Everything looks healthy right now.`
    : `${lead} ${tone === "concern" ? "Needs attention" : "Heads up"}: ${concerns[0].text}`;

  return { tone, headline, facts, concerns };
}

// ── MONTHLY REPORT (Item 11) ────────────────────────────────────────────────
// Build the full immutable payload for one month's financial summary. Pure and
// fully testable — the AI executive summary is layered on top by the app (this
// returns a templated `summary` as the guaranteed fallback). Period is "YYYY-MM".
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function priorPeriod(period) {
  const [y, m] = String(period).split("-").map(Number);
  const d = new Date(y, m - 2, 1);                 // m is 1-based → prior month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function formatPeriod(period) {
  const [y, m] = String(period).split("-").map(Number);
  return (MONTHS[m - 1] || "?") + " " + y;
}
const endOfMonth = (period) => {
  const [y, m] = String(period).split("-").map(Number);
  return new Date(y, m, 0, 23, 59, 59);            // day 0 of next month = last day of this one
};
const pctChange = (c, p) => (p === 0 ? null : r1(((c - p) / Math.abs(p)) * 100)); // null = no prior basis
const momLine = (c, p) => ({ current: r2(c), prior: r2(p), change: r2(c - p), changePct: pctChange(c, p) });

export function buildMonthlyReport(period, { invoices = [], cashBalance = 0, reconciliations = [], anomalies = [], onboardingComplete = false, fiscalYearEnd = "12-31" } = {}) {
  const live = (invoices || []).filter(isLiveEntry);
  const prior = priorPeriod(period);
  const monthEnd = endOfMonth(period);
  // Period bounds as YYYY-MM-DD so we share the canonical {from,to} primitives.
  const curRange = { from: `${period}-01`, to: `${period}-31` };
  const prvRange = { from: `${prior}-01`, to: `${prior}-31` };

  // P&L straight from the canonical layer → identical to the dashboard, the live
  // P&L report, and the AI's get_financial_summary for the same month.
  const revCur = computeRevenue(live, curRange), revPrv = computeRevenue(live, prvRange);
  const expCur = computeExpenses(live, curRange), expPrv = computeExpenses(live, prvRange);
  const netCur = computeNetIncome(live, curRange), netPrv = computeNetIncome(live, prvRange);

  const curCats = computeCategoryTotals(live, curRange);
  const prvCatMap = Object.fromEntries(computeCategoryTotals(live, prvRange).map(c => [c.category, c.total]));
  const expenseLines = curCats.map(c => ({ category: c.category, ...momLine(c.total, prvCatMap[c.category] || 0) }))
    .concat(Object.entries(prvCatMap).filter(([cat]) => !curCats.some(c => c.category === cat)).map(([cat, prv]) => ({ category: cat, ...momLine(0, prv) })))
    .sort((a, b) => b.current - a.current);

  // YEAR-TO-DATE P&L: cumulative from the company's FISCAL-year start through the selected
  // month, from the SAME canonical functions — just a wider {from,to}. Respects a non-Jan-1
  // fiscal year (fiscalYearStart), so YTD ties to the Balance Sheet's fiscal-year logic and the
  // dashboard. Prior column = the SAME window in the PRIOR fiscal year (YoY).
  const ytdFrom = fiscalYearStart(`${period}-01`, fiscalYearEnd) || `${period.slice(0, 4)}-01-01`;
  const ytdRange = { from: ytdFrom, to: curRange.to };
  const priorYrPeriod = `${Number(period.slice(0, 4)) - 1}${period.slice(4)}`;   // e.g. 2026-06 → 2025-06
  const ytdPriorFrom = fiscalYearStart(`${priorYrPeriod}-01`, fiscalYearEnd) || `${priorYrPeriod.slice(0, 4)}-01-01`;
  const ytdPriorRange = { from: ytdPriorFrom, to: `${priorYrPeriod}-31` };
  const revYtd = computeRevenue(live, ytdRange), revYtdP = computeRevenue(live, ytdPriorRange);
  const expYtd = computeExpenses(live, ytdRange), expYtdP = computeExpenses(live, ytdPriorRange);
  const netYtd = computeNetIncome(live, ytdRange), netYtdP = computeNetIncome(live, ytdPriorRange);
  const ytdCats = computeCategoryTotals(live, ytdRange);
  const ytdPrvCatMap = Object.fromEntries(computeCategoryTotals(live, ytdPriorRange).map(c => [c.category, c.total]));
  const ytdExpenseLines = ytdCats.map(c => ({ category: c.category, ...momLine(c.total, ytdPrvCatMap[c.category] || 0) }))
    .concat(Object.entries(ytdPrvCatMap).filter(([cat]) => !ytdCats.some(c => c.category === cat)).map(([cat, prv]) => ({ category: cat, ...momLine(0, prv) })))
    .sort((a, b) => b.current - a.current);

  const cash = r2(num(cashBalance));   // GL cash, passed in by the caller (glCashOnHand)
  // The report's subject month is CLOSED, so it counts (excludePartialMonth:false).
  const burn = computeBurnRate(live, { asOf: curRange.to, excludePartialMonth: false });
  const runway = computeRunway(cash, burn);

  const arT = computeAR(live, { now: monthEnd }), apT = computeAP(live, { now: monthEnd });

  const kpis = computeKPIs(live, { cashBalance: cash, now: monthEnd })
    .map(k => ({ key: k.key, label: k.label, display: k.display, status: k.status, trend: k.trend, explanation: k.explanation }));
  // Owner-facing plain-language health (businessHealth) — the 0–100 grade/score was removed
  // (C120); the monthly report must not resurrect it. Same GL-truth inputs.
  const bh = businessHealth(live, { cash, now: monthEnd });

  // Top 5 vendors by expense spend this month (canonical live gate + GL classification).
  const cur = liveEntries(live, curRange);
  const vmap = {};
  for (const i of cur) { const k = i.vendor || "Unknown"; for (const leg of plLegs(i, glIsExpense)) vmap[k] = (vmap[k] || 0) + leg.signed; }
  const topVendors = Object.entries(vmap).map(([vendor, total]) => ({ vendor, total: r2(total) })).sort((a, b) => b.total - a.total).slice(0, 5);

  // Anomalies active during the month — those referencing this month's txns; else high-severity.
  const monthIds = new Set(cur.map(i => String(i.id)));
  let monthAnoms = (anomalies || []).filter(a => (a.invoice_ids || []).some(id => monthIds.has(String(id))));
  if (!monthAnoms.length) monthAnoms = (anomalies || []).filter(a => a.severity === "high");
  const anomList = monthAnoms.slice(0, 8).map(a => ({ type: a.type, severity: a.severity, title: a.title, description: a.description }));

  const payload = {
    period, prior_period: prior, label: formatPeriod(period), generated_at: new Date().toISOString(),
    pl: { revenue: momLine(revCur, revPrv), expenses_total: momLine(expCur, expPrv), net_income: momLine(netCur, netPrv), expense_lines: expenseLines },
    pl_ytd: { revenue: momLine(revYtd, revYtdP), expenses_total: momLine(expYtd, expYtdP), net_income: momLine(netYtd, netYtdP), expense_lines: ytdExpenseLines, range: ytdRange },
    cash: { cash_on_hand: r2(cash), burn_rate: r2(burn), runway_months: runway },
    receivables: { total: arT.total, overdue: arT.overdue, count: arT.count },
    payables: { total: apT.total, overdue: apT.overdue, count: apT.count },
    kpis,
    health: { tone: bh.tone, headline: bh.headline, concerns: bh.concerns },
    top_vendors: topVendors,
    anomalies: anomList,
    transaction_count: cur.length,
    summary: templatedSummary({ period, revCur, expCur, netCur, netPrv, topVendors, arTotal: arT.total, arOverdue: arT.overdue, runway, txns: cur.length }),
  };
  return payload;
}

// Plain-English fallback executive summary (used when the AI call is unavailable).
function templatedSummary({ period, revCur, expCur, netCur, netPrv, topVendors, arTotal, arOverdue, runway, txns }) {
  const M = formatPeriod(period);
  if (txns === 0) return `No transactions were recorded in ${M}. Once activity comes in, this summary will cover your revenue, expenses, cash position, and key metrics for the month.`;
  const s = [];
  s.push(`In ${M} you brought in ${fmtMoney(revCur)} of revenue against ${fmtMoney(expCur)} of expenses, for ${netCur >= 0 ? "a net income of " + fmtMoney(netCur) : "a net loss of " + fmtMoney(-netCur)}.`);
  if (netPrv !== 0) s.push(`That's ${netCur >= netPrv ? "up" : "down"} from ${fmtMoney(netPrv)} the prior month.`);
  if (topVendors[0]) s.push(`Your largest expense was ${topVendors[0].vendor} at ${fmtMoney(topVendors[0].total)}.`);
  if (arTotal > 0) s.push(`You have ${fmtMoney(arTotal)} in receivables outstanding${arOverdue > 0 ? `, ${fmtMoney(arOverdue)} of it overdue` : ""}.`);
  if (runway != null && runway < 6) s.push(`At the current burn rate your runway is about ${runway} months — worth keeping an eye on cash.`);
  // (No 0–100 health score / letter grade — that system was removed; plain-language only.)
  return s.join(" ");
}
