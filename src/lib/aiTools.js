// ─────────────────────────────────────────────────────────────────────────────
// AI function-calling tools. The AI calls these to query this company's live
// database (via the RLS-protected Supabase client) instead of relying on a
// sampled context window — so answers are exact and complete regardless of
// transaction volume.
//
// AI_TOOLS       — Anthropic tool definitions sent with the API call.
// executeAITool  — runs the named tool against a ctx scoped to one company.
//
// ctx shape: { supabase, companyId, chartOfAccounts, getAccountByRole,
//              cashBalance, anomalies, recurring, getLedger() }
// getLedger() returns the full flattened ledger (fetched once per turn, cached).
// ─────────────────────────────────────────────────────────────────────────────

import { taxEstimate, deductionBreakdown, getTaxDeadlines } from "./tax.js";
import { runAnomalyDetection } from "./insights.js";
import {
  isLiveEntry, computeRevenue, computeExpenses, computeNetIncome, computeCategoryTotals,
  computeVendorTotals, computeBurnRate, computeRunway, computeAR, computeAP,
} from "./reports.js";

const isLive = isLiveEntry;                                  // the ONE shared liveness predicate
const isExpenseCode = c => { const s = String(c || ""); return s[0] === "5" || s[0] === "6" || s[0] === "7" || s[0] === "8"; };
const isRevenueCode = c => String(c || "")[0] === "4";
const normV = s => String(s || "").toLowerCase().trim();
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const unpaid = i => i.payment_status !== "paid" && i.payment_status !== "collected";

function periodRange(period, dateFrom, dateTo, now = new Date()) {
  if (dateFrom || dateTo) return { from: dateFrom || null, to: dateTo || null };
  const y = now.getFullYear(), m = now.getMonth();
  const iso = d => d.toISOString().slice(0, 10);
  switch (period) {
    case "this_month": return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m + 1, 0)) };
    case "last_month": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "this_year": return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_year": return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "all_time": default: return { from: null, to: null };
  }
}
const inRange = (date, from, to) => { const d = String(date || ""); if (from && d < from) return false; if (to && d > to) return false; return true; };

// ── Tool implementations ────────────────────────────────────────────────────
async function searchTransactions(input, ctx) {
  const led = (await ctx.getLedger()).filter(isLive);
  let rows = led.filter(i => {
    if (input.vendor && !normV(i.vendor).includes(normV(input.vendor))) return false;
    if (input.gl_code && String(i.gl_code) !== String(input.gl_code)) return false;
    if (!inRange(i.date, input.date_from, input.date_to)) return false;
    if (input.min_amount != null && (Number(i.amount) || 0) < input.min_amount) return false;
    if (input.max_amount != null && (Number(i.amount) || 0) > input.max_amount) return false;
    if (input.status && (i.payment_status || "unpaid") !== input.status) return false;
    return true;
  });
  const total = rows.reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const matchCount = rows.length;                       // ALL matches (before the display cap)
  // Most recent first, so the AI always lists the latest matches first when
  // disambiguating ("which Adobe charge — Jun 9, May 8, or Apr 7?").
  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const cap = Math.min(input.limit || 50, 200);
  const listed = rows.slice(0, cap).map(i => ({
    id: i.id, date: i.date, vendor: i.vendor, amount: i.amount, gl_code: i.gl_code, gl_name: i.gl_name,
    type: i.type, payment_status: i.payment_status, due_date: i.due_date, description: i.description,
  }));
  // The listed rows can be a TRUNCATED slice while total_amount/total_count reflect ALL
  // matches. Surface that explicitly so the AI never presents a partial list as complete —
  // it must tell the user "showing the N most recent of M" when truncated is true.
  const truncated = matchCount > listed.length;
  return {
    count: listed.length,                               // rows actually listed
    total_count: matchCount,                            // total matches (may exceed count)
    total_amount: r2(total),                            // sum over ALL matches, not just listed
    truncated,
    ...(truncated ? { note: `Showing the ${listed.length} most recent of ${matchCount} total matches. total_amount reflects all ${matchCount}. Tell the user the list is truncated and that the total covers everything; offer to narrow by date/amount to see specific ones.` } : {}),
    transactions: listed,
  };
}

// All three flow through the canonical layer in reports.js — so the AI's numbers
// equal the dashboard, the reports, and the monthly report to the penny.
async function getCategoryTotals(input, ctx) {
  const { from, to } = periodRange(input.period || "all_time", input.date_from, input.date_to);
  const categories = computeCategoryTotals(await ctx.getLedger(), { from, to });
  return { period: input.period || "all_time", categories };
}

async function getVendorSummary(input, ctx) {
  const { from, to } = periodRange(input.period || "all_time", input.date_from, input.date_to);
  let vendors = computeVendorTotals(await ctx.getLedger(), { from, to });
  if (input.vendor) { const q = normV(input.vendor); vendors = vendors.filter(v => normV(v.vendor).includes(q)); }
  return { vendors: vendors.slice(0, 50) };
}

async function getFinancialSummary(input, ctx) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const { from, to } = periodRange(input.period || "this_year", input.date_from, input.date_to);
  const led = await ctx.getLedger();
  const cash = Number(ctx.cashBalance) || 0;   // GL cash on hand, provided by the app
  const burn = computeBurnRate(led, { asOf: today });
  const ar = computeAR(led, { now }), ap = computeAP(led, { now });
  return {
    period: input.period || "this_year",
    total_revenue: computeRevenue(led, { from, to }),
    total_expenses: computeExpenses(led, { from, to }),
    net_income: computeNetIncome(led, { from, to }),
    burn_rate: burn, runway_months: computeRunway(cash, burn),
    cash_balance: cash,
    top_expense_categories: computeCategoryTotals(led, { from, to }).slice(0, 5).map(c => ({ category: c.category, total: c.total })),
    overdue_ar_total: ar.overdue, unpaid_ap_total: ap.overdue,
  };
}

async function getOverdueInvoices(input, ctx) {
  const now = new Date();
  const type = input.type || "both";
  const minDays = input.days_overdue || 1;
  const all = (await ctx.getLedger()).filter(isLive);
  const rows = [];
  for (const i of all) {
    if (!unpaid(i) || !i.due_date) continue;
    const isAR = isRevenueCode(i.gl_code), isAP = isExpenseCode(i.gl_code);
    if (!isAR && !isAP) continue;
    if (type === "ar" && !isAR) continue;
    if (type === "ap" && !isAP) continue;
    const days = Math.floor((now - new Date(i.due_date)) / 86400000);
    if (days < minDays) continue;
    rows.push({ kind: isAR ? "ar" : "ap", vendor: i.vendor, amount: r2(i.amount), due_date: i.due_date, days_overdue: days, gl_name: i.gl_name });
  }
  rows.sort((a, b) => b.days_overdue - a.days_overdue);
  return { count: rows.length, total: r2(rows.reduce((s, r) => s + r.amount, 0)), invoices: rows };
}

async function getAnomalies(_input, ctx) {
  const list = Array.isArray(ctx.anomalies) && ctx.anomalies.length
    ? ctx.anomalies
    : runAnomalyDetection(await ctx.getLedger(), ctx.recurring || []);
  return { count: list.length, anomalies: (list || []).map(a => ({ type: a.type, severity: a.severity, title: a.title, description: a.description })) };
}

async function getTaxSummary(input, ctx) {
  const year = input.year || new Date().getFullYear();
  const led = await ctx.getLedger();
  const est = taxEstimate(led, year);
  const deductions = deductionBreakdown(led, year, ctx.getAccountByRole)
    .filter(d => (d.amount || 0) > 0)
    .map(d => ({ category: d.label, amount: r2(d.amount) }));
  const next = getTaxDeadlines(new Date()).find(d => d.days >= 0);
  return {
    year,
    net_income: r2(est.net),
    estimated_tax: r2(est.federal),
    se_tax: r2(est.seTax),
    total_owed: r2(est.total),
    deductions_by_category: deductions,
    total_deductions: r2(deductions.reduce((s, d) => s + d.amount, 0)),
    next_deadline: next ? next.label : null,
    next_deadline_days: next ? next.days : null,
    estimated_amount_due: next && next.est ? r2(est.quarterly) : null,
  };
}

async function getRecurringTransactions(_input, ctx) {
  const list = (ctx.recurring || []).map(r => ({
    vendor: r.vendor || r.name, name: r.name, amount: r.amount, frequency: r.frequency,
    next_expected: r.next_date, gl_code: r.gl_code, gl_name: r.gl_name, active: r.active !== false,
  }));
  return { count: list.length, recurring: list };
}

export async function executeAITool(name, input = {}, ctx) {
  switch (name) {
    case "search_transactions":      return searchTransactions(input, ctx);
    case "get_category_totals":      return getCategoryTotals(input, ctx);
    case "get_vendor_summary":       return getVendorSummary(input, ctx);
    case "get_financial_summary":    return getFinancialSummary(input, ctx);
    case "get_overdue_invoices":     return getOverdueInvoices(input, ctx);
    case "get_anomalies":            return getAnomalies(input, ctx);
    case "get_tax_summary":          return getTaxSummary(input, ctx);
    case "get_recurring_transactions": return getRecurringTransactions(input, ctx);
    default:                         return { error: `Unknown tool: ${name}` };
  }
}

// ── Anthropic tool definitions ──────────────────────────────────────────────
const PERIOD_ENUM = ["this_month", "last_month", "this_year", "last_year", "all_time"];

export const AI_TOOLS = [
  {
    name: "search_transactions",
    description: "Search journal entries / transactions by vendor, GL code, date range, amount range, or payment status. Use when the user asks about specific transactions, a vendor, or a date range. Returns matching entries (most recent first). The listed `transactions` are capped (default 50, max 200) but `total_count` and `total_amount` always reflect ALL matches. If `truncated` is true, you MUST tell the user the list is partial (e.g. 'showing the 200 most recent of N') and that the total covers everything — never present a truncated list as the complete set.",
    input_schema: {
      type: "object",
      properties: {
        vendor: { type: "string", description: "Vendor name (fuzzy, case-insensitive substring match)" },
        gl_code: { type: "string", description: "Exact GL account code (e.g. 6500)" },
        date_from: { type: "string", description: "Start date YYYY-MM-DD (inclusive)" },
        date_to: { type: "string", description: "End date YYYY-MM-DD (inclusive)" },
        min_amount: { type: "number" },
        max_amount: { type: "number" },
        status: { type: "string", description: "Payment status filter (e.g. unpaid, paid, collected)" },
        limit: { type: "number", description: "Max rows to return (default 50, cap 200)" },
      },
    },
  },
  {
    name: "get_category_totals",
    description: "Total spending by GL expense category for a period, sorted high→low. Use for spending-by-category, biggest expenses, burn drivers, deductions.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_ENUM },
        date_from: { type: "string", description: "YYYY-MM-DD (overrides period)" },
        date_to: { type: "string", description: "YYYY-MM-DD (overrides period)" },
      },
    },
  },
  {
    name: "get_vendor_summary",
    description: "Per-vendor totals (total, count, last charge date, typical GL account) for a period, sorted high→low. Use for vendor spending questions like 'how much did I spend on Adobe?'.",
    input_schema: {
      type: "object",
      properties: {
        vendor: { type: "string", description: "Optional vendor filter (fuzzy)" },
        period: { type: "string", enum: PERIOD_ENUM },
        date_from: { type: "string" },
        date_to: { type: "string" },
      },
    },
  },
  {
    name: "get_financial_summary",
    description: "Overall financial health: revenue, expenses, net income, burn rate, runway, cash, top expense categories, overdue AR, unpaid AP. Use for burn rate, runway, 'how are we doing', monthly/quarterly summaries.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_ENUM },
        date_from: { type: "string" },
        date_to: { type: "string" },
      },
    },
  },
  {
    name: "get_overdue_invoices",
    description: "Unpaid invoices past their due date. type 'ar' = money owed to you, 'ap' = bills you owe, 'both'. Use for overdue/unpaid questions.",
    input_schema: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["ar", "ap", "both"] },
        days_overdue: { type: "number", description: "Minimum days past due (default 1)" },
      },
    },
  },
  {
    name: "get_anomalies",
    description: "Current list of automatically-detected unusual activity (vendor spikes, duplicates, large/round charges, missing recurring, etc.). Use when the user asks 'anything unusual?' or 'any anomalies?'.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_tax_summary",
    description: "Estimated taxes + deductions for a year: federal estimate, SE tax, total owed, deductions by category, and the next deadline with its estimated amount. Use for tax / deduction / estimated-payment questions.",
    input_schema: {
      type: "object",
      properties: { year: { type: "number", description: "Tax year (defaults to current year)" } },
    },
  },
  {
    name: "get_recurring_transactions",
    description: "List of recurring transaction rules (vendor, amount, frequency, next expected date). Use for questions about recurring expenses or subscriptions.",
    input_schema: { type: "object", properties: {} },
  },
];
