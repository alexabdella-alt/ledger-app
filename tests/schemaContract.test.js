import { describe, it, expect, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApprovalUpdate, buildAccountInsert, buildCompanyUpdate, mapCompanyRow } from "../src/lib/writeShapes.js";

// ════════════════════════════════════════════════════════════════════════════
// SCHEMA-CONTRACT / WRITE+READ-BACK LOCK.
// These would have caught two silent production failures:
//   1. approval writes put an EMAIL into journal_entries.approved_by (a UUID
//      column) → Postgres rejects → 0 rows → approval state never persisted.
//   2. account auto-creation wrote a non-existent `account_type` column and
//      omitted the NOT-NULL `category`.
// A tiny in-memory DB enforces the AUTHORITATIVE live schema (column existence,
// uuid typing, NOT-NULL on insert) exactly the way PostgREST/Postgres would, so
// the corrected builders write+read-back cleanly and the OLD shapes are rejected.
// ════════════════════════════════════════════════════════════════════════════

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Subset of the live schema (from the information_schema dump) relevant to the fix.
const SCHEMA = {
  journal_entries: {
    id:               { type: "uuid", notNull: true, hasDefault: true },
    company_id:       { type: "uuid", notNull: true },
    approval_status:  { type: "text" },
    approved_at:      { type: "timestamptz" },
    approved_by:      { type: "uuid" },                 // ← uuid, NOT text/email
    rejected_at:      { type: "timestamptz" },
    rejection_reason: { type: "text" },
    payment_status:   { type: "text" },
  },
  accounts: {
    id:          { type: "uuid",    notNull: true, hasDefault: true },
    company_id:  { type: "uuid",    notNull: true },
    code:        { type: "text",    notNull: true },
    name:        { type: "text",    notNull: true },
    category:    { type: "text",    notNull: true },     // ← NOT NULL, no default
    active:      { type: "boolean", notNull: true, hasDefault: true },
    is_system:   { type: "boolean", notNull: true, hasDefault: true },
    system_role: { type: "text" },
    // NB: there is intentionally NO `account_type` column.
  },
  // reconciliations as it exists AFTER migration 035 (denormalized shape the app
  // writes; the normalized 005 columns are now nullable dead schema).
  reconciliations: {
    id:                          { type: "uuid",        notNull: true, hasDefault: true },
    company_id:                  { type: "uuid",        notNull: true },
    bank_account_id:             { type: "uuid" },          // nullable after 035 (dead)
    statement_date:              { type: "date" },          // nullable after 035 (dead)
    statement_ending_balance:    { type: "numeric" },       // nullable after 035 (dead)
    status:                      { type: "text",        notNull: true, hasDefault: true },
    completed_by:                { type: "uuid" },          // ← uuid, never an email
    completed_at:                { type: "timestamptz" },
    created_at:                  { type: "timestamptz", notNull: true, hasDefault: true },
    account_id:                  { type: "uuid" },          // app's column (≠ bank_account_id)
    account_name:                { type: "text" },
    period_start:                { type: "date" },
    period_end:                  { type: "date" },
    statement_balance:           { type: "numeric" },
    statement_balance_verified:  { type: "boolean", hasDefault: true },   // migration 055
    books_balance:               { type: "numeric" },
    difference:                  { type: "numeric" },
    matched_transactions:        { type: "jsonb", hasDefault: true },
    unmatched_bank:              { type: "jsonb", hasDefault: true },
    unmatched_books:             { type: "jsonb", hasDefault: true },
    added_during_reconciliation: { type: "jsonb", hasDefault: true },
  },
};

// Minimal PostgREST/Postgres-faithful fake: rejects unknown columns, non-uuid
// values in uuid columns, and missing NOT-NULL columns on insert.
function makeDb(seed = {}) {
  const store = Object.fromEntries(Object.keys(SCHEMA).map(t => [t, new Map()]));
  for (const [t, rows] of Object.entries(seed)) for (const r of rows) store[t].set(r.id, { ...r });

  const validate = (table, payload, { isInsert }) => {
    const cols = SCHEMA[table];
    for (const [k, v] of Object.entries(payload)) {
      if (!cols[k]) return `column "${k}" of relation "${table}" does not exist`;
      if (cols[k].type === "uuid" && v != null && !UUID_RE.test(String(v)))
        return `invalid input syntax for type uuid: "${v}"`;
    }
    if (isInsert) {
      for (const [k, meta] of Object.entries(cols)) {
        if (meta.notNull && !meta.hasDefault && payload[k] == null)
          return `null value in column "${k}" violates not-null constraint`;
      }
    }
    return null;
  };

  return {
    insert(table, payload) {
      const msg = validate(table, payload, { isInsert: true });
      if (msg) return { data: [], error: { message: msg }, matched: 0 };
      const id = payload.id || randomUUID();
      const row = { id, ...payload };
      store[table].set(id, row);
      return { data: [{ ...row }], error: null, matched: 1 };
    },
    update(table, id, patch) {
      const msg = validate(table, patch, { isInsert: false });
      if (msg) return { data: [], error: { message: msg }, matched: 0 };
      const row = store[table].get(id);
      if (!row) return { data: [], error: null, matched: 0 };
      Object.assign(row, patch);
      return { data: [{ ...row }], error: null, matched: 1 };
    },
    get: (table, id) => { const r = store[table].get(id); return r ? { ...r } : null; },
  };
}

describe("approval status — write + read-back persists approved_by as a uuid", () => {
  const CO = randomUUID(), JE = randomUUID(), UID = randomUUID();
  let db;
  beforeEach(() => { db = makeDb({ journal_entries: [{ id: JE, company_id: CO, approval_status: null, approved_by: null }] }); });

  it("approve persists approval_status + approved_by (the uuid actually lands)", () => {
    const res = db.update("journal_entries", JE, buildApprovalUpdate({ decision: "approved", at: new Date().toISOString(), actorUserId: UID }));
    expect(res.error).toBeNull();
    expect(res.matched).toBe(1);
    const row = db.get("journal_entries", JE);
    expect(row.approval_status).toBe("approved");
    expect(row.approved_by).toBe(UID);
  });

  it("reject records the rejecter in approved_by (no rejected_by column) + persists", () => {
    const patch = buildApprovalUpdate({ decision: "rejected", at: new Date().toISOString(), actorUserId: UID, reason: "duplicate" });
    expect(patch).not.toHaveProperty("rejected_by");
    const res = db.update("journal_entries", JE, patch);
    expect(res.error).toBeNull();
    const row = db.get("journal_entries", JE);
    expect(row.approval_status).toBe("rejected");
    expect(row.approved_by).toBe(UID);
    expect(row.rejection_reason).toBe("duplicate");
    expect(row.payment_status).toBe("rejected");
  });

  it("REGRESSION GUARD: writing an email to approved_by is rejected and persists nothing (the original bug)", () => {
    const res = db.update("journal_entries", JE, { approval_status: "approved", approved_by: "alex@example.com" });
    expect(res.error).toBeTruthy();
    expect(res.error.message).toMatch(/uuid/);
    expect(res.matched).toBe(0);
    expect(db.get("journal_entries", JE).approval_status).toBeNull();   // nothing landed
  });
});

describe("account auto-creation — write + read-back persists category, never account_type", () => {
  const CO = randomUUID();
  let db;
  beforeEach(() => { db = makeDb(); });

  it("the builder always includes the NOT-NULL category", () => {
    expect(buildAccountInsert({ companyId: CO, code: "6500", name: "Tech" }).category).toBe("Expenses");
  });

  it("insert succeeds and the account reads back with category and no account_type", () => {
    const ins = db.insert("accounts", buildAccountInsert({ companyId: CO, code: "6500", name: "Technology", category: "Expenses" }));
    expect(ins.error).toBeNull();
    const row = db.get("accounts", ins.data[0].id);
    expect(row.category).toBe("Expenses");
    expect(row).not.toHaveProperty("account_type");
  });

  it("REGRESSION GUARD: the old payload (account_type + missing category) is rejected (the original bug)", () => {
    const ins = db.insert("accounts", { company_id: CO, code: "6500", name: "Technology", account_type: "expense" });
    expect(ins.error).toBeTruthy();
    expect(ins.error.message).toMatch(/account_type/);
    expect(ins.matched).toBe(0);
  });

  it("REGRESSION GUARD: an accounts insert missing category violates NOT NULL", () => {
    const ins = db.insert("accounts", { company_id: CO, code: "6500", name: "Technology", active: true, is_system: false });
    expect(ins.error).toBeTruthy();
    expect(ins.error.message).toMatch(/category/);
  });
});

describe("reconciliations — denormalized record write + read-back, completed_by stays uuid", () => {
  const CO = randomUUID(), UID = randomUUID();
  let db;
  beforeEach(() => { db = makeDb(); });

  // Mirrors ReconView.serialize() — the denormalized shape the app writes.
  const reconPayload = (over = {}) => ({
    company_id: CO, account_id: randomUUID(), account_name: "Checking ••1234",
    period_start: "2026-05-01", period_end: "2026-05-31",
    statement_balance: 5000, books_balance: 4800, difference: 200,
    statement_balance_verified: true,
    status: "complete",
    matched_transactions: [{ bank: { id: "t1" }, bookId: "b1", conf: 0.9 }],
    unmatched_bank: [{ id: "t2", amount: 50 }], unmatched_books: ["b3"],
    added_during_reconciliation: [],
    completed_at: new Date().toISOString(), completed_by: UID,
    ...over,
  });

  it("inserts the full denormalized record and reads it back (incl. completed_by uuid)", () => {
    const ins = db.insert("reconciliations", reconPayload());
    expect(ins.error).toBeNull();
    const row = db.get("reconciliations", ins.data[0].id);
    expect(row.account_name).toBe("Checking ••1234");
    expect(row.statement_balance).toBe(5000);
    expect(row.matched_transactions).toHaveLength(1);
    expect(row.completed_by).toBe(UID);
  });

  it("succeeds WITHOUT the normalized NOT-NULL columns (relaxed by migration 035)", () => {
    const p = reconPayload();
    expect(p).not.toHaveProperty("bank_account_id");   // app never writes the normalized cols
    expect(db.insert("reconciliations", p).error).toBeNull();
  });

  it("REGRESSION GUARD: writing an email to completed_by is rejected and persists nothing", () => {
    const ins = db.insert("reconciliations", reconPayload({ completed_by: "alex@example.com" }));
    expect(ins.error).toBeTruthy();
    expect(ins.error.message).toMatch(/uuid/);
    expect(ins.matched).toBe(0);
  });
});

// ── O13: company settings persist to `companies` and round-trip (not just sales_tax_rate)
describe("company settings — save writes ALL identity/accounting fields + round-trips", () => {
  const settings = {
    name: "Acme LLC", taxId: "12-3456789", address: "1 Main St", city: "Austin",
    state: "TX", zip: "78701", country: "US", fiscalYearEnd: "06-30", currency: "USD",
    defaultCashAccount: "1000", defaultAPAccount: "2000", defaultARAccount: "1100",
    businessType: "SaaS", salesTaxRate: 8.5, logoBase64: "data:image/png;base64,XXXX",
    onboardingComplete: true,
  };

  it("buildCompanyUpdate writes the companies columns (not just sales_tax_rate)", () => {
    const u = buildCompanyUpdate(settings);
    expect(u).toMatchObject({
      name: "Acme LLC", tax_id: "12-3456789", address: "1 Main St", city: "Austin",
      state: "TX", zip: "78701", country: "US", fiscal_year_end: "06-30", currency: "USD",
      default_cash_account: "1000", default_ap_account: "2000", default_ar_account: "1100",
      business_type: "SaaS", sales_tax_rate: 8.5,
    });
    // O62: the logo now persists as a base64 data URL in logo_path; onboarding_complete
    // is still owned by completeOnboarding (not written here).
    expect(u.logo_path).toBe("data:image/png;base64,XXXX");
    expect("onboarding_complete" in u).toBe(false);
  });

  it("write→read round-trips through the DB shape (the persisted fields survive)", () => {
    const row = buildCompanyUpdate(settings);   // companies column shape (what the DB stores)
    const back = mapCompanyRow(row);            // what loadAllData reads back
    for (const k of ["name","taxId","address","city","state","zip","country","fiscalYearEnd","currency","defaultCashAccount","defaultAPAccount","defaultARAccount","businessType","salesTaxRate"]) {
      expect(back[k]).toBe(settings[k]);
    }
    // O62: the logo round-trips too (logoBase64 → logo_path → logoBase64)
    expect(back.logoBase64).toBe(settings.logoBase64);
  });

  it("O62: a null/absent logo round-trips to null (not undefined/crash)", () => {
    expect(buildCompanyUpdate({}).logo_path).toBe(null);
    expect(mapCompanyRow({}).logoBase64).toBe(null);
  });

  it("name is never null (NOT NULL column) even from an empty draft", () => {
    expect(buildCompanyUpdate({}).name).toBe("Company");
    expect(buildCompanyUpdate({ name: "   " }).name).toBe("Company");
  });

  it("fiscal-year-end persists (feeds the period logic) — not silently dropped", () => {
    expect(buildCompanyUpdate({ fiscalYearEnd: "03-31" }).fiscal_year_end).toBe("03-31");
    expect(mapCompanyRow(buildCompanyUpdate({ fiscalYearEnd: "03-31" })).fiscalYearEnd).toBe("03-31");
  });
});
