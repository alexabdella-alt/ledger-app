// ─────────────────────────────────────────────────────────────────────────────
// Shared report calculations — AR/AP aging, trial balance, KPIs, and the
// financial health score. Pure functions over the flattened `invoices` array so
// every report reconciles with every other (and so they're unit-testable).
// All of these EXCLUDE voided / soft-deleted entries (trial balance offers an
// "unadjusted" toggle that includes voided). Uses the shared GL helpers.
// ─────────────────────────────────────────────────────────────────────────────

import { glIsRevenue, glIsExpense } from "./gl";

const num = n => Number(n) || 0;
const r2 = n => Math.round(num(n) * 100) / 100;
const r1 = n => Math.round(num(n) * 10) / 10;
const fmtMoney = n => "$" + Math.round(num(n)).toLocaleString("en-US");
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

export function computeRevenue(invoices, range = {}) {
  return r2(liveEntries(invoices, range).filter(i => isRev(i)).reduce((s, i) => s + num(i.amount), 0));
}
export function computeExpenses(invoices, range = {}) {
  return r2(liveEntries(invoices, range).filter(i => isExp(i)).reduce((s, i) => s + num(i.amount), 0));
}
export function computeNetIncome(invoices, range = {}) {
  return r2(computeRevenue(invoices, range) - computeExpenses(invoices, range));
}

// ── FISCAL-YEAR RETAINED-EARNINGS SPLIT (derived soft close, Option A) ────────
// The start (YYYY-MM-DD) of the fiscal year containing `asOf`, given a fiscal year
// END of "MM-DD" (default 12-31). e.g. FYE 12-31 → Jan 1; FYE 06-30, asOf in Mar →
// prior Jul 1. Used to separate prior-years' (closed) earnings from current-period
// net income on an interim balance sheet without posting closing entries.
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
  return start.toISOString().slice(0, 10);
}

// The default reporting window for a freshly-opened Reports page (O70). It ALWAYS
// ends today — never a stale saved date — and begins at the current period's start.
//   period "mtd"      → first of the current calendar month
//   period "ytd"/"fy" → the fiscal-year start (respects a non-calendar fiscal_year_end),
//                       floored at the company cutoff (no activity exists before it)
//   period "all"      → unbounded ("" / "")
// Pure (takes `today`), so the "to == today, from == period start" contract is tested.
export function currentPeriodRange(period = "fy", { today = null, fiscalYearEnd = "12-31", cutoffDate = null } = {}) {
  const to = today || new Date().toISOString().slice(0, 10);
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
    const signed = isRev(i) ? num(i.amount) : isExp(i) ? -num(i.amount) : 0;
    if (signed === 0) continue;
    if (fyStart && String(i.date || "") < fyStart) priorNet += signed; else currentNet += signed;
  }
  return { fyStart, priorNet: r2(priorNet), currentNet: r2(currentNet) };
}

// Expense totals by GL category for a period, sorted high→low. The SUM of these
// totals === computeExpenses(...) exactly (same gate, same rounding boundary).
export function computeCategoryTotals(invoices, range = {}) {
  const map = {};
  for (const i of liveEntries(invoices, range)) {
    if (!isExp(i)) continue;
    const k = String(i.gl_code || "");
    const c = map[k] || (map[k] = { gl_code: k, category: i.gl_name || k, total: 0, count: 0 });
    c.total += num(i.amount); c.count++;
  }
  return Object.values(map).map(c => ({ ...c, total: r2(c.total) })).sort((a, b) => b.total - a.total || String(a.gl_code).localeCompare(String(b.gl_code)));
}

// Per-vendor totals over P&L accounts only (income-statement scope) — the figure
// the vendor REPORT shows and the AI's get_vendor_summary must equal.
// Spend BY VENDOR — expenses only (the "Expenses by Vendor" report). Classified by
// GL account CLASS, not by whether a counterparty name exists: a revenue invoice that
// happens to carry a customer name (e.g. an AR collection) is NOT a vendor expense and
// must be excluded. `side:"revenue"` gives the symmetric by-customer view if ever needed.
export function computeVendorTotals(invoices, range = {}, { side = "expense" } = {}) {
  const include = side === "revenue" ? isRev : isExp;
  const map = {};
  for (const i of liveEntries(invoices, range)) {
    if (!include(i)) continue;                            // expense (or revenue) accounts only — by GL class
    const name = i.vendor || "Unknown";
    const v = map[name] || (map[name] = { vendor: name, total: 0, count: 0, last_date: "", gl_code: i.gl_code, gl_name: i.gl_name });
    v.total += num(i.amount); v.count++;
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

// Trailing-N-month average expense burn (default 3), counting only months up to
// `asOf` (inclusive). Same window everywhere → burn/runway never drift.
export function computeBurnRate(invoices, { asOf = null, months = 3 } = {}) {
  const monthExp = {};
  for (const i of liveEntries(invoices, { to: asOf })) {
    if (!isExp(i)) continue;
    const m = ymOf(i.date); if (m) monthExp[m] = (monthExp[m] || 0) + num(i.amount);
  }
  const recent = Object.keys(monthExp).sort().slice(-months);
  return r2(recent.length ? recent.reduce((s, m) => s + monthExp[m], 0) / recent.length : 0);
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
// Normal-balance sign by code first digit: assets(1) & expenses(5–8) are
// debit-normal (+ on debit); liabilities(2), equity(3), revenue(4) credit-normal.
const isDebitNormalCode = c => { const d = String(c || "")[0]; return d === "1" || d === "5" || d === "6" || d === "7" || d === "8"; };

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
    const primaryIsDebit = isRev(i) ? false : i.debit_credit !== "credit";
    if (i.gl_code === code) bal += signed(primaryIsDebit, amt);
    // Offset leg only for simple 2-line entries (multi-line rows are pre-expanded).
    if (!String(i.id).includes("_") && i.secondary_gl_code === code) bal += signed(!primaryIsDebit, amt);
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
    if (!isExpanded && i.secondary_gl_code) add(i.secondary_gl_code, i.secondary_gl_name, side === "debit" ? "credit" : "debit", amt);
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
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const inMonth = m => live.filter(i => ymOf(i.date) === m);
  const sum = (set, pred) => set.filter(pred).reduce((s, i) => s + num(i.amount), 0);
  const rev = set => sum(set, isRev), cogs = set => sum(set, i => isCOGS(i.gl_code)), opex = set => sum(set, i => isOpEx(i.gl_code)), exp = set => sum(set, isExp);
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

// ── FINANCIAL HEALTH SCORE (Item 63) ────────────────────────────────────────
export function financialHealthScore({ invoices = [], cashBalance = 0, reconciliations = [], anomalies = [], onboardingComplete = false, now = new Date() } = {}) {
  const live = (invoices || []).filter(isLiveEntry);
  const monthExp = {};
  for (const i of live) if (isExp(i)) { const m = ymOf(i.date); if (m) monthExp[m] = (monthExp[m] || 0) + num(i.amount); }
  const recentMonths = Object.keys(monthExp).sort();
  const burn = recentMonths.slice(-3).length ? recentMonths.slice(-3).reduce((s, m) => s + monthExp[m], 0) / recentMonths.slice(-3).length : 0;
  const cash = num(cashBalance);
  const runway = burn > 0 ? cash / burn : (cash > 0 ? Infinity : 0);

  // Only a COMPLETED reconciliation counts. `completed_at` is written solely when ReconView's
  // "complete" runs; in-progress drafts (and the dead import-side row) have no completed_at, so
  // merely starting a reconcile — or importing/matching — must NOT register as "reconciled".
  const lastRecon = (reconciliations || []).map(r => r.completed_at).filter(Boolean).sort().pop();
  const reconAge = lastRecon ? (now - new Date(lastRecon)) / 86400000 : Infinity;

  const overdueAR = live.filter(i => arUnpaid(i) && i.due_date && daysOverdue(i.due_date, now) > 60);
  const overdueARtotal = r2(overdueAR.reduce((s, i) => s + num(i.amount), 0));

  const curM = recentMonths.length ? monthExp[recentMonths[recentMonths.length - 1]] : 0;
  const prevM = recentMonths.length > 1 ? monthExp[recentMonths[recentMonths.length - 2]] : null;
  const burnOk = prevM == null || curM <= prevM * 1.05;

  const highAnoms = (anomalies || []).filter(a => a.severity === "high");

  const items = [
    { label: "Runway over 6 months", max: 25, points: runway >= 6 ? 25 : (runway >= 3 ? 12 : 0), met: runway >= 6, detail: burn > 0 ? `~${runway === Infinity ? "∞" : runway.toFixed(1)} months at ${fmtMoney(burn)}/mo burn` : "No recent burn / cash not set" },
    { id: "reconciled", label: "Reconciled within 35 days", max: 20, points: reconAge <= 35 ? 20 : 0, met: reconAge <= 35, detail: lastRecon ? `Last reconciled ${Math.round(reconAge)} days ago` : "Never reconciled to bank" },
    { label: "No receivables 60+ days overdue", max: 15, points: overdueAR.length === 0 ? 15 : 0, met: overdueAR.length === 0, detail: overdueAR.length ? `${overdueAR.length} invoice${overdueAR.length > 1 ? "s" : ""} 60+ days late totaling ${fmtMoney(overdueARtotal)}` : "None 60+ days overdue" },
    { label: "Burn flat or declining", max: 15, points: burnOk ? 15 : 0, met: burnOk, detail: prevM == null ? "Not enough history yet" : (burnOk ? "Burn is steady or down month-over-month" : `Burn up ${Math.round((curM / prevM - 1) * 100)}% vs last month`) },
    { label: "No high-severity anomalies", max: 15, points: highAnoms.length === 0 ? 15 : 0, met: highAnoms.length === 0, detail: highAnoms.length ? `${highAnoms.length} high-severity flag${highAnoms.length > 1 ? "s" : ""}` : "Nothing unusual flagged" },
    { label: "Setup complete", max: 10, points: onboardingComplete ? 10 : 0, met: !!onboardingComplete, detail: onboardingComplete ? "Books fully set up" : "Finish onboarding to lock this in" },
  ];

  const score = Math.round(items.reduce((s, i) => s + i.points, 0));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  // Grade, word-label, and color ALL derive from ONE map keyed on `grade`, so they can never
  // disagree. (Bug: they were three independent score-band computations with MISALIGNED
  // thresholds — grade used 10-pt bands (D=60–69) while tier used ≥80/≥60/<60 — so a score of
  // 60–69 rendered "Grade D · Good" at once. Single source ⇒ always consistent.)
  const GRADE_META = {
    A: { tier: "Strong",          color: "#039855" },
    B: { tier: "Good",            color: "#039855" },
    C: { tier: "Fair",            color: "#DC6803" },
    D: { tier: "Needs attention", color: "#DC6803" },
    F: { tier: "At risk",         color: "#D92D20" },
  };
  const { tier, color } = GRADE_META[grade];
  const concern = items.filter(i => !i.met).sort((a, b) => b.max - a.max)[0];
  let summary = `Your financial health is ${tier}.`;
  if (concern) {
    if (concern.label.startsWith("No receivables") && overdueAR.length) summary += ` Main concern: ${overdueAR.length} invoice${overdueAR.length > 1 ? "s are" : " is"} 60+ days overdue totaling ${fmtMoney(overdueARtotal)}.`;
    else summary += ` Main concern: ${concern.label.toLowerCase()} — ${concern.detail.toLowerCase()}.`;
  } else summary += " Everything looks healthy across the board.";

  return { score, grade, color, tier, items, summary };
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

export function buildMonthlyReport(period, { invoices = [], cashBalance = 0, reconciliations = [], anomalies = [], onboardingComplete = false } = {}) {
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

  const cash = r2(num(cashBalance));   // GL cash, passed in by the caller (glCashOnHand)
  const burn = computeBurnRate(live, { asOf: curRange.to });
  const runway = computeRunway(cash, burn);

  const arT = computeAR(live, { now: monthEnd }), apT = computeAP(live, { now: monthEnd });

  const kpis = computeKPIs(live, { cashBalance: cash, now: monthEnd })
    .map(k => ({ key: k.key, label: k.label, display: k.display, status: k.status, trend: k.trend, explanation: k.explanation }));
  const h = financialHealthScore({ invoices: live, cashBalance: cash, reconciliations, anomalies, onboardingComplete, now: monthEnd });

  // Top 5 vendors by expense spend this month (canonical live gate + GL classification).
  const cur = liveEntries(live, curRange);
  const vmap = {};
  for (const i of cur) { if (!isExp(i)) continue; const k = i.vendor || "Unknown"; vmap[k] = (vmap[k] || 0) + num(i.amount); }
  const topVendors = Object.entries(vmap).map(([vendor, total]) => ({ vendor, total: r2(total) })).sort((a, b) => b.total - a.total).slice(0, 5);

  // Anomalies active during the month — those referencing this month's txns; else high-severity.
  const monthIds = new Set(cur.map(i => String(i.id)));
  let monthAnoms = (anomalies || []).filter(a => (a.invoice_ids || []).some(id => monthIds.has(String(id))));
  if (!monthAnoms.length) monthAnoms = (anomalies || []).filter(a => a.severity === "high");
  const anomList = monthAnoms.slice(0, 8).map(a => ({ type: a.type, severity: a.severity, title: a.title, description: a.description }));

  const payload = {
    period, prior_period: prior, label: formatPeriod(period), generated_at: new Date().toISOString(),
    pl: { revenue: momLine(revCur, revPrv), expenses_total: momLine(expCur, expPrv), net_income: momLine(netCur, netPrv), expense_lines: expenseLines },
    cash: { cash_on_hand: r2(cash), burn_rate: r2(burn), runway_months: runway },
    receivables: { total: arT.total, overdue: arT.overdue, count: arT.count },
    payables: { total: apT.total, overdue: apT.overdue, count: apT.count },
    kpis,
    health: { score: h.score, grade: h.grade, tier: h.tier, summary: h.summary },
    top_vendors: topVendors,
    anomalies: anomList,
    transaction_count: cur.length,
    summary: templatedSummary({ period, revCur, expCur, netCur, netPrv, topVendors, arTotal: arT.total, arOverdue: arT.overdue, runway, health: h, txns: cur.length }),
  };
  return payload;
}

// Plain-English fallback executive summary (used when the AI call is unavailable).
function templatedSummary({ period, revCur, expCur, netCur, netPrv, topVendors, arTotal, arOverdue, runway, health, txns }) {
  const M = formatPeriod(period);
  if (txns === 0) return `No transactions were recorded in ${M}. Once activity comes in, this summary will cover your revenue, expenses, cash position, and key metrics for the month.`;
  const s = [];
  s.push(`In ${M} you brought in ${fmtMoney(revCur)} of revenue against ${fmtMoney(expCur)} of expenses, for ${netCur >= 0 ? "a net income of " + fmtMoney(netCur) : "a net loss of " + fmtMoney(-netCur)}.`);
  if (netPrv !== 0) s.push(`That's ${netCur >= netPrv ? "up" : "down"} from ${fmtMoney(netPrv)} the prior month.`);
  if (topVendors[0]) s.push(`Your largest expense was ${topVendors[0].vendor} at ${fmtMoney(topVendors[0].total)}.`);
  if (arTotal > 0) s.push(`You have ${fmtMoney(arTotal)} in receivables outstanding${arOverdue > 0 ? `, ${fmtMoney(arOverdue)} of it overdue` : ""}.`);
  if (runway != null && runway < 6) s.push(`At the current burn rate your runway is about ${runway} months — worth keeping an eye on cash.`);
  s.push(`Overall financial health: ${health.tier} (grade ${health.grade}).`);
  return s.join(" ");
}
