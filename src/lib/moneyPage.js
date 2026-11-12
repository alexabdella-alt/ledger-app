// ═════════════════════════════════════════════════════════════════════════════
// C636 / C637 — THE OWNER'S MONEY PAGE, IN AN OWNER'S WORDS.
// Step one (C636) was a page of tiles, one per list. Step two (C637): the lists ARE the page —
// one searchable list of everything, with filters an owner would name (what I owe, what I'm
// owed, what came in, what went out), two figures that set those filters, and the people and
// files one click away. Pure, so the words and figures are tested without rendering anything.
// ═════════════════════════════════════════════════════════════════════════════
import { fmtMoney } from "./format.js";

export const MONEY_PAGE_COPY = {
  intro: "Everything coming in and going out, in one list. Search for anyone or anything, or pick a filter.",
  askHint: "Can't find something? The assistant can find it or open the right page for you.",
  askButton: "Ask →",
};

// The list's filters on the owner's seat, in the order an owner reaches for them. The ids are
// the list's own filter values ("unpaid" = bills still to pay, "owed" = invoices not yet paid).
export const OWNER_MONEY_FILTERS = [
  ["all", "All"],
  ["unpaid", "Bills to pay"],
  ["owed", "Owed to you"],
  ["revenue", "Income"],
  ["expenses", "Spending"],
  ["review", "Needs a look"],
];

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// The two figures above the list. Each sets the list's filter when clicked.
export function moneySummary({ owe = 0, billsOpen = 0, owed = 0, invoicesOpen = 0 } = {}, { money = fmtMoney } = {}) {
  return [
    { filter: "unpaid", label: "You owe", figure: money(owe),
      sub: billsOpen ? `${plural(billsOpen, "bill", "bills")} to pay` : "All paid up", attention: billsOpen > 0 },
    { filter: "owed", label: "Owed to you", figure: money(owed),
      sub: invoicesOpen ? `${plural(invoicesOpen, "invoice", "invoices")} not paid yet` : "Nothing outstanding", attention: false },
  ];
}

// The people and files, one click away below the list.
export function moneyLinks({ contacts = [], docs = [] } = {}) {
  const vendors = (contacts || []).filter((c) => c && c.type !== "customer").length;
  const customers = (contacts || []).filter((c) => c && (c.type === "customer" || c.type === "both")).length;
  return [
    { view: "customers", label: "Customers", count: customers },
    { view: "vendors", label: "Vendors", count: vendors },
    { view: "docs", label: "Documents", count: (docs || []).length },
  ];
}
