// ─────────────────────────────────────────────────────────────────────────────
// THIS PERIOD IN PLAIN WORDS (U4, C379) — the paragraph Reports opens with.
//
// O104's promise is that a report is a decision-language sentence first and a table second.
// C343 shipped the honest half ("reviewed through …"); C344 the vendor-creep sentence on By
// Vendor. This is the top of the page: what came in, what went out, whether you made money,
// who owes you and what you owe — every number read from the same derivations the tables
// below use (`computeRevenue` / `computeExpenses` / `glAccountBalance`), so the paragraph
// can never disagree with the table under it. The wording is a draft for the operator to edit.
// ─────────────────────────────────────────────────────────────────────────────
import { computeRevenue, computeExpenses, glAccountBalance, computeCategoryTotals } from "./reports";
import { fmtMoney } from "./format";

export function plainPeriodSummary({ rangeInvoices = [], allInvoices = [], rangeLabel = "this period", arCode = null, apCode = null } = {}) {
  const revenue = computeRevenue(rangeInvoices);
  const expenses = computeExpenses(rangeInvoices);
  const net = Math.round((revenue - expenses) * 100) / 100;
  const owed = arCode ? glAccountBalance(arCode, allInvoices) : null;
  const owe = apCode ? glAccountBalance(apCode, allInvoices) : null;
  const inWords = /^(this|last|all)/i.test(rangeLabel) || /^Q\d/.test(rangeLabel) || /^Year/.test(rangeLabel) ? rangeLabel.toLowerCase() : rangeLabel;
  const period = inWords === "all time" ? "Since the start" : inWords === "year to date" ? "So far this year" : `In ${inWords.replace(/^this /, "this ").replace(/^last /, "last ")}`;
  const parts = [];
  if (!rangeInvoices.length) {
    parts.push(`${period}, nothing has been recorded yet.`);
  } else {
    parts.push(`${period} you brought in ${fmtMoney(revenue)} and spent ${fmtMoney(expenses)}` +
      (net > 0 ? ` — a profit of ${fmtMoney(net)}.` : net < 0 ? ` — you spent ${fmtMoney(-net)} more than you brought in.` : ` — you broke even.`));
  }
  // ★★ O104/C561 — "WHAT AM I SPENDING ON?", the one of O104's three questions this paragraph
  // could not answer (who you owe is below; who is creeping up is By Vendor, C344). Read from
  // `computeCategoryTotals` — the P&L's own source, whose totals add up to `expenses` exactly —
  // so the sentence cannot name a figure the report beneath it disagrees with. Category names
  // lose their parenthetical ("Technology & Software (SaaS)"), which is accountants' shorthand.
  const spend = expenses > 0 ? spendingSentence(computeCategoryTotals(rangeInvoices), expenses) : null;
  if (spend) parts.push(spend);
  const owedParts = [];
  if (owed != null) owedParts.push(owed > 0 ? `Customers owe you ${fmtMoney(owed)}` : `No customer owes you anything`);
  if (owe != null) owedParts.push(owe > 0 ? `you owe vendors ${fmtMoney(owe)}` : `you owe vendors nothing`);
  if (owedParts.length) parts.push(owedParts.join(", and ") + ".");
  return { text: parts.join(" "), revenue, expenses, net, owed, owe };
}

const plainName = (c) => String(c.category || c.gl_code || "").replace(/\s*\([^)]*\)/g, "").trim();
export function spendingSentence(categories = [], expenses = 0) {
  const top = (categories || []).filter((c) => c && c.total > 0).slice(0, 3);
  if (!top.length) return null;
  const item = (c) => `${plainName(c)} (${fmtMoney(c.total)})`;
  if (top.length === 1) {
    return Math.abs(top[0].total - expenses) < 0.005
      ? `All of it went to ${plainName(top[0])}.`
      : `The biggest cost was ${item(top[0])}.`;
  }
  const list = top.length === 2 ? `${item(top[0])} and ${item(top[1])}` : `${item(top[0])}, ${item(top[1])} and ${item(top[2])}`;
  return `The biggest costs were ${list}.`;
}
