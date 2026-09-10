// ─────────────────────────────────────────────────────────────────────────────
// C319 — A COMPANY WITH DATA IN IT, FOR THE RENDER SWEEP.
//
// ★★★ C246's HARNESS HANDS EVERY UNKNOWN KEY AN EMPTY ARRAY, SO NO ROW EVER
// RENDERS. That was the right first move — it caught two crash-on-mount bugs the
// same day it shipped — and it leaves the majority of every screen unexercised:
// the row bodies, the joins, the per-row conditionals. C246 recorded the limit in
// its own words ("catches a screen that crashes, not one that silently renders
// empty"); this is the other half.
//
// ★★ SMALL ON PURPOSE. The harness comment warns that a fixture listing ~390 keys
// would be "a second copy of the app's state shape, stale within a week", and it
// is right. So this populates ONLY the collections that drive row rendering and
// lets the Proxy answer everything else — and it derives what it can from the
// REAL builders, so those shapes cannot drift from the app's.
// ─────────────────────────────────────────────────────────────────────────────
import { buildVendorSummary } from "../../src/lib/vendorSummary.js";
import { vendorGroupKey } from "../../src/lib/vendorIdentity.js";

const ent = (id, vendor, amount, date, gl_code, gl_name, extra = {}) => ({
  id, vendor, vendor_key: vendorGroupKey(vendor), amount, date, gl_code, gl_name,
  type: Number(gl_code) >= 4000 && Number(gl_code) < 5000 ? "revenue" : "expense",
  status: "booked", source: "universal_upload", db_entry_id: `je_${id}`,
  payment_status: "unpaid", confidence: 92, reasoning: "Test reasoning.",
  debit_credit: "debit", project: "General", ...extra,
});

// Two spellings of one supplier — the C317 case, so the join path actually runs.
export const INVOICES = [
  ent("i1", "Hill Country Milling Co.", 824.60, "2026-01-05", "5010", "Food Cost"),
  ent("i2", "Hill Country Milling", 912.30, "2026-03-05", "5010", "Food Cost"),
  ent("i3", "Bluebonnet Linen Service", 145.00, "2026-03-09", "6180", "Linen & Laundry"),
  ent("i4", "Franklin Ave Properties", 2400.00, "2026-03-01", "6100", "Rent & Occupancy", { payment_status: "paid" }),
  ent("i5", "Corner Market Catering", 1500.00, "2026-03-12", "4010", "Food Sales", { debit_credit: "credit" }),
  ent("i6", "Gusto Payroll", 4000.00, "2026-03-14", "6000", "Salaries & Wages", { source: "payroll", payment_status: "paid" }),
];

export const CONTACTS = [
  { id: "c1", name: "Hill Country Milling Co.", type: "vendor", business_type: "sole_proprietor", email: "ap@hcm.test", payment_terms: "net30", tags: ["food"] },
  { id: "c2", name: "Bluebonnet Linen Service", type: "vendor", business_type: "llc", aliases: [] },
  { id: "c3", name: "Corner Market Catering", type: "customer", email: "ar@cmc.test" },
];

export const ACCOUNTS = [
  { id: "a1", code: "1000", name: "Cash", category: "Assets", system_role: "cash", active: true },
  { id: "a2", code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable", active: true },
  { id: "a3", code: "5010", name: "Food Cost", category: "Expenses", system_role: "food_cost", active: true },
  { id: "a4", code: "6100", name: "Rent & Occupancy", category: "Expenses", system_role: "rent_occupancy", active: true },
  { id: "a5", code: "4010", name: "Food Sales", category: "Revenue", system_role: "product_revenue", active: true },
];

// ★★★ SELECTION KEYS MUST BE NULL, NOT ABSENT. The Proxy answers an unknown key with `[]`,
// which is TRUTHY — so `if (selectedContact)` took the DETAIL branch and the vendor LIST
// never rendered. The sweep looked like it was exercising rows and was not: a planted crash
// in the row body survived it. Same shape as the stale `navSeat` string, and the reason the
// positive "the rows actually reached the page" assertion below exists.
const NO_SELECTION = {
  vendorsSelectedContact: null, vendorsEditingId: null, customersEditingId: null,
  customersSelected: null, selectedContract: null, selectedInvoice: null,
  activeRecon: null, docsPreview: null, qboPreview: null, deleteConfirm: null,
};

// The POPULATED context. Anything not named here still falls through to the Proxy.
export const POPULATED = {
  ...NO_SELECTION,
  invoices: INVOICES,
  filteredInvoices: INVOICES,
  contacts: CONTACTS,
  CHART_OF_ACCOUNTS: ACCOUNTS,
  customCOA: ACCOUNTS,
  // Derived by the REAL builder, so a change to grouping shows up here rather than in a
  // hand-written copy that quietly disagrees with the app.
  vendorSummary: buildVendorSummary(INVOICES, null),
  aliasIndex: new Map(),
  bankAccounts: [{ id: "b1", name: "Primary Checking", type: "checking", gl_code: "1000", last4: "4321", institution: "Test Bank", current_balance: 10000 }],
  reconciliations: [{ id: "r1", status: "complete", account_name: "Primary Checking", period_end: "2026-03-31", books_balance: 10000, statement_balance: 10000, difference: 0, matched_transactions: [], unmatched_bank: [], outstanding_books: [] }],
  docLibrary: [{ id: "d1", name: "invoice-jan.pdf", mime_type: "application/pdf", document_type: "invoice", storage_path: "co/d1.pdf", file_size_bytes: 12000, uploaded_at: "2026-01-06", linked_invoice_id: "je_i1", tags: ["uploaded"] }],
  auditLog: [{ id: "al1", action: "invoice_booked", detail: "Hill Country Milling Co. · $824.60", performed_by: "test@example.com", created_at: "2026-01-05T10:00:00Z" }],
  anomalies: [{ id: "an1", type: "large_transaction", severity: "medium", status: "open", title: "Large charge", detail: "A large charge", entity_refs: { invoice_ids: ["i4"] }, period: "2026-03", first_seen_at: "2026-03-02T00:00:00Z" }],
  signoffs: [{ id: "s1", period: "2026-01", signed_by: "test@example.com", signed_at: "2026-02-01T00:00:00Z", self_attested: false }],
  rules: [{ id: "ru1", vendor: "Hill Country Milling Co.", gl_code: "5010", gl_name: "Food Cost" }],
  recurring: [{ id: "rc1", vendor: "Bluebonnet Linen Service", amount: 145, frequency: "weekly", next_date: "2026-03-16", gl_code: "6180", active: true }],
  contracts: [{ id: "ct1", counterparty: "Franklin Ave Properties", contract_type: "lease", monthly_amount: 2400, start_date: "2026-01-01", end_date: "2027-12-31", generated_entries: [], posted_entries: [] }],
  sentInvoices: [{ id: "si1", customer: "Corner Market Catering", amount: 1500, date: "2026-03-12", status: "sent", line_items: [] }],
  payrollImports: [{ id: "p1", pay_date: "2026-03-14", total_gross: 4000, total_net: 3150, employees: [], _intakeId: "in1" }],
  notifications: [{ id: "n1", type: "needs_review", title: "Something to look at", body: "Detail", read: false, created_at: "2026-03-02T00:00:00Z" }],
  companies: [{ id: "co_test", name: "Test Co" }],
  unknownDocs: [], clarificationQueue: [], uploadQueue: [], matchQueue: [], bankTransactions: [],
  openingBalances: [], statementExceptions: [], anomalyComments: [],
};
