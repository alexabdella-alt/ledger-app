import { describe, it, expect } from "vitest";
import {
  buildVendorRuleRow, buildRecurringRow, RECURRING_FREQUENCIES,
  insertVerified, updateVerified, deleteVerified,
} from "../src/lib/chatActions.js";

// ── A tiny faithful fake of the Supabase query builder ────────────────────────
// Backed by an in-memory table; supports insert/update/delete + select with eq filters
// and single/maybeSingle. `failOn` simulates a silent DB failure for a given op so we can
// prove the verify step reports honest failure (never a false "done").
function fakeDB(initial = {}, opts = {}) {
  const tables = JSON.parse(JSON.stringify(initial));
  const { failOn = null, dropWrites = false } = opts;     // dropWrites = "succeeds" but nothing persists
  let _id = 1000;
  const from = (table) => {
    tables[table] = tables[table] || [];
    const rows = tables[table];
    const q = { _op: null, _payload: null, _filters: [], _patch: null };
    const matches = (r) => q._filters.every(([k, v]) => String(r[k]) === String(v));
    const api = {
      insert(payload) { q._op = "insert"; q._payload = payload; return api; },
      update(patch) { q._op = "update"; q._patch = patch; return api; },
      delete() { q._op = "delete"; return api; },
      select() { if (!q._op) q._op = "select"; return api; },
      eq(k, v) { q._filters.push([k, v]); return api; },
      async single() { return run("single"); },
      async maybeSingle() { return run("maybe"); },
      then(resolve) { resolve(run("list")); },              // awaitable terminal (delete/select-list)
    };
    function run(mode) {
      if (failOn === `${table}.${q._op}`) return { data: null, error: { message: "simulated DB failure" } };
      if (q._op === "insert") {
        if (dropWrites) return { data: { ...q._payload, id: _id++ }, error: null }; // returns a row but never stored
        const row = { id: _id++, ...q._payload };
        rows.push(row);
        return { data: row, error: null };
      }
      if (q._op === "update") {
        const hit = rows.filter(matches);
        hit.forEach(r => Object.assign(r, q._patch));
        const row = hit[0] || null;
        return { data: row, error: null };
      }
      if (q._op === "delete") {
        for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i])) rows.splice(i, 1);
        return { data: null, error: null };
      }
      // select
      const found = rows.filter(matches);
      if (mode === "list") return { data: found, error: null };
      return { data: found[0] || null, error: null };       // single / maybe → one row or null
    }
    return api;
  };
  return { from, _tables: tables };
}

describe("buildVendorRuleRow / buildRecurringRow — DB-row shapes", () => {
  it("vendor rule carries the resolved FKs + active flag", () => {
    expect(buildVendorRuleRow({ companyId: "co", contactId: "ct", accountId: "ac", project: "P" }))
      .toEqual({ company_id: "co", contact_id: "ct", account_id: "ac", project: "P", active: true });
  });
  it("recurring clamps an invalid frequency to monthly and rounds the amount", () => {
    const r = buildRecurringRow({ companyId: "co", name: "Rent", amount: 1999.999, debitAccountId: "d", creditAccountId: "c", frequency: "fortnightly", nextDate: "2026-07-01" });
    expect(r.frequency).toBe("monthly");
    expect(r.amount).toBe(2000);
    expect(r.debit_account_id).toBe("d");
    expect(r.credit_account_id).toBe("c");
    expect(r.active).toBe(true);
  });
  it("recurring keeps a valid frequency", () => {
    for (const f of RECURRING_FREQUENCIES) {
      expect(buildRecurringRow({ companyId: "co", name: "x", amount: 1, debitAccountId: "d", creditAccountId: "c", frequency: f, nextDate: "2026-07-01" }).frequency).toBe(f);
    }
  });
});

describe("insertVerified — persists AND verifies (honest on failure)", () => {
  it("persists ✓: writes the row and the read-back confirms it", async () => {
    const db = fakeDB();
    const res = await insertVerified(db, "vendor_rules", buildVendorRuleRow({ companyId: "co", contactId: "ct", accountId: "ac" }));
    expect(res.ok).toBe(true);
    expect(res.row.contact_id).toBe("ct");
    expect(db._tables.vendor_rules).toHaveLength(1);        // actually in the table
  });
  it("honest-on-failure ✓: a DB error on insert → ok:false, nothing claimed", async () => {
    const db = fakeDB({}, { failOn: "vendor_rules.insert" });
    const res = await insertVerified(db, "vendor_rules", buildVendorRuleRow({ companyId: "co", contactId: "ct", accountId: "ac" }));
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/simulated DB failure/);
  });
  it("honest-on-failure ✓: write 'succeeds' but doesn't persist → verify catches it (ok:false)", async () => {
    const db = fakeDB({}, { dropWrites: true });            // insert returns a row but stores nothing
    const res = await insertVerified(db, "recurring_transactions", buildRecurringRow({ companyId: "co", name: "Rent", amount: 1, debitAccountId: "d", creditAccountId: "c", frequency: "monthly", nextDate: "2026-07-01" }));
    expect(res.ok).toBe(false);                              // read-back found nothing
    expect(res.error).toMatch(/missing after insert/);
  });
});

describe("updateVerified — patch confirmed against the returned row", () => {
  it("persists ✓: pausing a recurring flips active=false and verifies", async () => {
    const db = fakeDB({ recurring_transactions: [{ id: 7, name: "Rent", active: true }] });
    const res = await updateVerified(db, "recurring_transactions", 7, { active: false });
    expect(res.ok).toBe(true);
    expect(db._tables.recurring_transactions[0].active).toBe(false);
  });
  it("honest-on-failure ✓: DB error → ok:false", async () => {
    const db = fakeDB({ recurring_transactions: [{ id: 7, active: true }] }, { failOn: "recurring_transactions.update" });
    const res = await updateVerified(db, "recurring_transactions", 7, { active: false });
    expect(res.ok).toBe(false);
  });
});

// ── Per-action mapping (O78): each chat action → its verified persistence path ──
// Proves, per action, that the write PERSISTS (right table + data) and that a simulated
// DB failure does NOT report success. The App.jsx handlers route through exactly these
// primitives + builders after resolving FKs; the delete/void/delete_contract actions are
// gated on their helpers' committed-id / revId / ok return (wired in the chat loop).
describe("per-action persistence (O78): persists ✓ / honest-on-failure ✓", () => {
  const co = "co-1";
  it("add_rule → vendor_rules insert (persists ✓ / fail ✓)", async () => {
    const row = buildVendorRuleRow({ companyId: co, contactId: "ct", accountId: "ac", project: null });
    expect((await insertVerified(fakeDB(), "vendor_rules", row)).ok).toBe(true);
    expect((await insertVerified(fakeDB({}, { failOn: "vendor_rules.insert" }), "vendor_rules", row)).ok).toBe(false);
  });
  it("delete_rule → vendor_rules scoped delete (persists ✓ / fail ✓)", async () => {
    expect((await deleteVerified(fakeDB({ vendor_rules: [{ id: 1, company_id: co, contact_id: "ct" }] }), "vendor_rules", { company_id: co, contact_id: "ct" })).ok).toBe(true);
    expect((await deleteVerified(fakeDB({ vendor_rules: [{ id: 1, contact_id: "ct" }] }, { failOn: "vendor_rules.delete" }), "vendor_rules", { contact_id: "ct" })).ok).toBe(false);
  });
  it("add_recurring → recurring_transactions insert (persists ✓ / fail ✓)", async () => {
    const row = buildRecurringRow({ companyId: co, name: "Rent", amount: 2000, debitAccountId: "d", creditAccountId: "c", frequency: "monthly", nextDate: "2026-07-01" });
    expect((await insertVerified(fakeDB(), "recurring_transactions", row)).ok).toBe(true);
    expect((await insertVerified(fakeDB({}, { failOn: "recurring_transactions.insert" }), "recurring_transactions", row)).ok).toBe(false);
  });
  it("pause_recurring → recurring_transactions update active=false (persists ✓ / fail ✓)", async () => {
    expect((await updateVerified(fakeDB({ recurring_transactions: [{ id: 5, active: true }] }), "recurring_transactions", 5, { active: false })).ok).toBe(true);
    expect((await updateVerified(fakeDB({ recurring_transactions: [{ id: 5, active: true }] }, { failOn: "recurring_transactions.update" }), "recurring_transactions", 5, { active: false })).ok).toBe(false);
  });
  it("add_contact → contacts insert (persists ✓ / fail ✓)", async () => {
    const row = { company_id: co, name: "Pixel", type: "vendor" };
    expect((await insertVerified(fakeDB(), "contacts", row)).ok).toBe(true);
    expect((await insertVerified(fakeDB({}, { failOn: "contacts.insert" }), "contacts", row)).ok).toBe(false);
  });
  it("update_contact → contacts update (persists ✓ / fail ✓)", async () => {
    expect((await updateVerified(fakeDB({ contacts: [{ id: 9, name: "Pixel", email: null }] }), "contacts", 9, { email: "a@b.co" })).ok).toBe(true);
    expect((await updateVerified(fakeDB({ contacts: [{ id: 9, email: null }] }, { failOn: "contacts.update" }), "contacts", 9, { email: "a@b.co" })).ok).toBe(false);
  });
  it("set_contact_rule → contact update + vendor_rule insert (both verified)", async () => {
    const db = fakeDB({ contacts: [{ id: 3, name: "Pixel", gl_code: null }] });
    expect((await updateVerified(db, "contacts", 3, { type: "vendor" })).ok).toBe(true);
    expect((await insertVerified(db, "vendor_rules", buildVendorRuleRow({ companyId: co, contactId: 3, accountId: "ac" }))).ok).toBe(true);
  });
  it("retag_project → journal_entries.project update, verified across targets (persists ✓ / fail ✓)", async () => {
    const ok = fakeDB({ journal_entries: [{ id: 1, project: "General" }, { id: 2, project: "General" }] });
    expect((await updateVerified(ok, "journal_entries", 1, { project: "Apollo" })).ok).toBe(true);
    expect(ok._tables.journal_entries[0].project).toBe("Apollo");
    expect((await updateVerified(fakeDB({ journal_entries: [{ id: 1, project: "General" }] }, { failOn: "journal_entries.update" }), "journal_entries", 1, { project: "Apollo" })).ok).toBe(false);
  });
});

describe("deleteVerified — scoped delete confirmed gone (O51)", () => {
  it("persists ✓: removes only the matched rows and verifies none remain", async () => {
    const db = fakeDB({ vendor_rules: [{ id: 1, contact_id: "a" }, { id: 2, contact_id: "b" }] });
    const res = await deleteVerified(db, "vendor_rules", { contact_id: "a" });
    expect(res.ok).toBe(true);
    expect(db._tables.vendor_rules.map(r => r.contact_id)).toEqual(["b"]);   // scoped: b untouched
  });
  it("honest-on-failure ✓: DB error on delete → ok:false", async () => {
    const db = fakeDB({ vendor_rules: [{ id: 1, contact_id: "a" }] }, { failOn: "vendor_rules.delete" });
    const res = await deleteVerified(db, "vendor_rules", { contact_id: "a" });
    expect(res.ok).toBe(false);
  });
});
