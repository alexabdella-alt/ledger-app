// ═════════════════════════════════════════════════════════════════════════════
// C636 — THE MONEY PAGE'S TILES, IN AN OWNER'S WORDS. Pure: the figures are passed in (the same
// GL balances Home's tiles read), so what a tile says can be tested without rendering anything.
// One tile per list the owner's old menu had a row for, in the order an owner reaches for them:
// what they owe, what they're owed, sending an invoice, then everything else.
// ═════════════════════════════════════════════════════════════════════════════

export const MONEY_PAGE_COPY = {
  intro: "Everything coming in and going out, in one place. Pick what you want to look at.",
  askHint: "Can't find something? The assistant can find it or open the right page for you.",
  askButton: "Ask →",
};

import { fmtMoney } from "./format.js";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const entryCount = (invoices = []) => new Set((invoices || [])
  .filter((i) => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at && i.source !== "opening_balance")
  .map((i) => String(i.db_entry_id != null ? i.db_entry_id : String(i.id).split("_")[0]))).size;

export function moneyTiles({ owe = 0, billsOpen = 0, owed = 0, invoicesOpen = 0, invoices = [], contacts = [], docs = [] } = {}, { money = fmtMoney } = {}) {
  const vendors = (contacts || []).filter((c) => c && c.type !== "customer").length;
  const customers = (contacts || []).filter((c) => c && (c.type === "customer" || c.type === "both")).length;
  const entries = entryCount(invoices);
  return [
    { view: "ap", title: "Bills to pay", what: "Bills you've received and haven't paid yet.",
      figure: billsOpen ? `${plural(billsOpen, "bill", "bills")} · ${money(owe)}` : "All paid up", attention: billsOpen > 0 },
    { view: "ar", title: "Money owed to you", what: "Invoices your customers haven't paid yet.",
      figure: invoicesOpen ? `${plural(invoicesOpen, "invoice", "invoices")} · ${money(owed)}` : "Nothing outstanding", attention: false },
    { view: "send-invoice", title: "Send an invoice", what: "Bill a customer and email it from here.", figure: null },
    { view: "books", title: "Transactions", what: "Everything in your books, newest first. Search, fix or remove an entry.",
      figure: entries ? plural(entries, "entry", "entries") : "Nothing yet — drop a document on Home" },
    { view: "customers", title: "Customers", what: "The people and businesses who pay you.", figure: customers ? plural(customers, "customer", "customers") : null },
    { view: "vendors", title: "Vendors", what: "Who you pay, and how much this year.", figure: vendors ? plural(vendors, "vendor", "vendors") : null },
    { view: "docs", title: "Documents", what: "Every receipt, invoice and statement you've added.", figure: (docs || []).length ? plural(docs.length, "file", "files") : null },
  ];
}
