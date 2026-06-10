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
const isRev = i => glIsRevenue(i.gl_code) || i.type === "revenue";
const isExp = i => glIsExpense(i.gl_code) || i.type === "expense";
const arUnpaid = i => isRev(i) && i.payment_status !== "paid" && i.payment_status !== "collected";
const apUnpaid = i => isExp(i) && i.payment_status !== "paid";
const daysOverdue = (dueDate, now) => dueDate ? Math.floor((now - new Date(String(dueDate) + "T12:00:00")) / 86400000) : 0;

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
      date: i.date, due_date: i.due_date || null, amount: r2(i.amount),
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

  const lastRecon = (reconciliations || []).map(r => r.completed_at || r.period_end || r.created_at).filter(Boolean).sort().pop();
  const reconAge = lastRecon ? (now - new Date(lastRecon)) / 86400000 : Infinity;

  const overdueAR = live.filter(i => arUnpaid(i) && i.due_date && daysOverdue(i.due_date, now) > 60);
  const overdueARtotal = r2(overdueAR.reduce((s, i) => s + num(i.amount), 0));

  const curM = recentMonths.length ? monthExp[recentMonths[recentMonths.length - 1]] : 0;
  const prevM = recentMonths.length > 1 ? monthExp[recentMonths[recentMonths.length - 2]] : null;
  const burnOk = prevM == null || curM <= prevM * 1.05;

  const highAnoms = (anomalies || []).filter(a => a.severity === "high");

  const items = [
    { label: "Runway over 6 months", max: 25, points: runway >= 6 ? 25 : (runway >= 3 ? 12 : 0), met: runway >= 6, detail: burn > 0 ? `~${runway === Infinity ? "∞" : runway.toFixed(1)} months at ${fmtMoney(burn)}/mo burn` : "No recent burn / cash not set" },
    { label: "Reconciled within 35 days", max: 20, points: reconAge <= 35 ? 20 : 0, met: reconAge <= 35, detail: lastRecon ? `Last matched ${Math.round(reconAge)} days ago` : "Never reconciled to bank" },
    { label: "No receivables 60+ days overdue", max: 15, points: overdueAR.length === 0 ? 15 : 0, met: overdueAR.length === 0, detail: overdueAR.length ? `${overdueAR.length} invoice${overdueAR.length > 1 ? "s" : ""} 60+ days late totaling ${fmtMoney(overdueARtotal)}` : "None 60+ days overdue" },
    { label: "Burn flat or declining", max: 15, points: burnOk ? 15 : 0, met: burnOk, detail: prevM == null ? "Not enough history yet" : (burnOk ? "Burn is steady or down month-over-month" : `Burn up ${Math.round((curM / prevM - 1) * 100)}% vs last month`) },
    { label: "No high-severity anomalies", max: 15, points: highAnoms.length === 0 ? 15 : 0, met: highAnoms.length === 0, detail: highAnoms.length ? `${highAnoms.length} high-severity flag${highAnoms.length > 1 ? "s" : ""}` : "Nothing unusual flagged" },
    { label: "Setup complete", max: 10, points: onboardingComplete ? 10 : 0, met: !!onboardingComplete, detail: onboardingComplete ? "Books fully set up" : "Finish onboarding to lock this in" },
  ];

  const score = Math.round(items.reduce((s, i) => s + i.points, 0));
  const grade = score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F";
  const color = score >= 80 ? "#039855" : score >= 60 ? "#DC6803" : "#D92D20";
  const tier = score >= 80 ? "Strong" : score >= 60 ? "Good" : "Needs attention";
  const concern = items.filter(i => !i.met).sort((a, b) => b.max - a.max)[0];
  let summary = `Your financial health is ${tier}.`;
  if (concern) {
    if (concern.label.startsWith("No receivables") && overdueAR.length) summary += ` Main concern: ${overdueAR.length} invoice${overdueAR.length > 1 ? "s are" : " is"} 60+ days overdue totaling ${fmtMoney(overdueARtotal)}.`;
    else summary += ` Main concern: ${concern.label.toLowerCase()} — ${concern.detail.toLowerCase()}.`;
  } else summary += " Everything looks healthy across the board.";

  return { score, grade, color, tier, items, summary };
}
