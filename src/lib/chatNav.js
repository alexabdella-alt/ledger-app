// ─────────────────────────────────────────────────────────────────────────────
// C572 — WHEN THE CHAT SAYS "I'LL TAKE YOU THERE", IT TAKES YOU TO THE RIGHT SCREEN.
//
// The chat's navigate action named screens from an app that no longer exists: its prompt
// described "3 tabs (Home, Books, Reports)" in one place and "5 tabs" in another, and the
// alias map here sent "show my unpaid bills" to the Transactions list although Bills to pay
// has been its own screen since C312, "money owed to me" likewise, and had no entry at all
// for Team, Categories, Taxes' neighbours or the QuickBooks import. For an owner who asks
// "where do I…?" the answer was a wrong door.
//
// The map is now BUILT FROM THE SIDEBAR'S OWN ROWS (nav.js), so every screen the sidebar
// shows can be reached by its id and by the words on its row, and a renamed row cannot
// silently strand the chat. Synonyms are the words owners actually use. Pure.
// ─────────────────────────────────────────────────────────────────────────────

import { NAV_SECTIONS, NAV_SECTION_SETTINGS, NAV_SECTION_REVIEW, REVIEW_TOOLS } from "./nav.js";

const norm = (s) => String(s || "").toLowerCase().replace(/[()]/g, "").replace(/[_\s]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

const SYNONYMS = {
  home: ["dashboard", "overview", "upload", "drop", "inbox", "questions"],
  books: ["ledger", "transactions", "transaction", "entries", "invoices", "invoice", "money-in", "money-out", "revenue", "income", "expenses", "spending"],
  ap: ["bills", "bill", "unpaid", "unpaid-bills", "payables", "accounts-payable", "what-i-owe", "pay-a-bill", "pay-bills"],
  ar: ["receivables", "accounts-receivable", "money-owed", "owed-to-me", "unpaid-invoices", "who-owes-me"],
  "send-invoice": ["send-an-invoice", "new-invoice", "create-invoice", "invoice-a-customer", "bill-a-customer"],
  customers: ["clients", "customer"],
  vendors: ["vendor", "suppliers", "supplier", "contacts", "payees"],
  docs: ["documents", "document", "files", "receipts", "library"],
  reports: ["report", "pl", "p&l", "profit-loss", "profit-and-loss", "income-statement", "balance-sheet", "cash-flow"],
  settings: ["company", "company-settings", "bank-accounts", "business-details", "gear"],
  team: ["invite", "invite-accountant", "accountant", "teammates", "users", "members"],
  coa: ["chart-of-accounts", "categories", "category", "accounts"],
  "opening-balances": ["starting-balance", "opening-balance", "starting-position"],
  rules: ["vendor-rule", "rule", "auto-categorize", "teach-in", "teach-us-your-vendors"],
  recurring: ["recurring-charge", "subscriptions", "repeating"],
  tax: ["taxes", "tax-center", "estimated-tax", "estimated-taxes", "quarterly-taxes", "deadlines", "tax-deadlines", "tax-compliance"],
  tax1099: ["1099", "1099s", "tax-forms", "contractors"],
  audit: ["audit-trail", "audittrail", "history", "change-history"],
  onboard: ["quickbooks", "qbo", "import", "import-quickbooks"],
  review: ["sign-off", "signoff"],
  recon: ["reconcile", "reconciliation", "match-bank", "bank-match", "match-statement", "match-my-bank-statement"],
  bank: ["bank-import", "bank-feed"],
  contracts: ["leases", "lease", "contract"],
};

// Contracts live under Transactions (a Books filter), not as a screen of their own.
const BOOKS_FILTER_VIEWS = { contracts: "contracts" };

function buildIndex() {
  const idx = new Map();
  const put = (word, id) => { const k = norm(word); if (k && !idx.has(k)) idx.set(k, id); };
  const rows = [...NAV_SECTIONS, NAV_SECTION_REVIEW, NAV_SECTION_SETTINGS].flatMap((s) => s.items).concat(REVIEW_TOOLS);
  for (const [id] of rows) put(id, id);                      // ids first, so an id always resolves to itself
  for (const [id, label] of rows) put(label, id);
  for (const [id, words] of Object.entries(SYNONYMS)) for (const w of words) put(w, id);
  put("send-invoice", "send-invoice");
  return idx;
}
const INDEX = buildIndex();

// A phrase ("invite my accountant") that contains a known word or phrase, as whole words.
// The longest match wins, so "money-owed-to-you" beats "money". Navigation only ever opens a
// screen the seat guard allows, so a loose match costs a click, never data.
function wordMatch(v) {
  if (!v) return null;
  const padded = `-${v}-`;
  let best = null;
  for (const [k, id] of INDEX) if (padded.includes(`-${k}-`) && (!best || k.length > best.k.length)) best = { k, id };
  return best ? best.id : null;
}

const BOOKS_FILTERS = { all: "all", revenue: "revenue", income: "revenue", expenses: "expenses", expense: "expenses", spending: "expenses", review: "review", "needs-review": "review", contracts: "contracts", leases: "contracts" };

// { target, booksFilter } — target is a view id, or the raw word when nothing matches (the
// caller's seat guard then says it could not find that screen, rather than guessing one).
export function resolveChatView(view, filter = null) {
  const v = norm(view);
  const f = norm(filter);
  if (BOOKS_FILTER_VIEWS[v]) return { target: "books", booksFilter: BOOKS_FILTER_VIEWS[v] };
  let target = INDEX.get(v) || wordMatch(v) || String(view || "");
  // A Transactions request whose filter means a screen of its own goes to that screen.
  if (target === "books" && f) {
    const viaFilter = INDEX.get(f);
    if (viaFilter === "ap" || viaFilter === "ar") return { target: viaFilter, booksFilter: null };
    return { target, booksFilter: BOOKS_FILTERS[f] || "all" };
  }
  if (target === "books") {
    const implied = BOOKS_FILTERS[v] || null;               // "revenue", "expenses", …
    return { target, booksFilter: implied || "all" };
  }
  return { target, booksFilter: null };
}
