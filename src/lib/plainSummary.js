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
import { computeRevenue, computeExpenses, glAccountBalance } from "./reports";
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
  const owedParts = [];
  if (owed != null) owedParts.push(owed > 0 ? `Customers owe you ${fmtMoney(owed)}` : `No customer owes you anything`);
  if (owe != null) owedParts.push(owe > 0 ? `you owe suppliers ${fmtMoney(owe)}` : `you owe suppliers nothing`);
  if (owedParts.length) parts.push(owedParts.join(", and ") + ".");
  return { text: parts.join(" "), revenue, expenses, net, owed, owe };
}
