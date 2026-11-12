import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { settledBases, isLiveSettlement } from "../src/lib/gl";
import { matchableOpenItems } from "../src/lib/bankMatch";
import { flattenJournalEntries } from "../src/lib/ledger";

// C599 — review finding B1: a reversed payment still counted as settling its bill.
const acct = { exp: { id: "e", code: "6250", name: "Repairs" }, ap: { id: "ap", code: "2000", name: "A/P" }, cash: { id: "c", code: "1000", name: "Cash" } };
const je = (id, lines, meta, extra = {}) => ({ id, entry_date: "2026-03-10", description: "Ace Plumbing", status: "posted", source: "manual", import_metadata: meta || null,
  journal_entry_lines: lines.map(([a, debit, credit], i) => ({ id: `${id}-${i}`, account_id: acct[a].id, debit, credit, accounts: acct[a] })), ...extra });
const bill = je("b1", [["exp", 500, 0], ["ap", 0, 500]]);
const pay = je("p1", [["ap", 500, 0], ["cash", 0, 500]], { kind: "ap_payment", payment_for: "b1" });
const reversal = je("r1", [["cash", 500, 0], ["ap", 0, 500]], { kind: "reversal", reverses: "p1" });

describe("a payment taken back settles nothing", () => {
  it("a live payment settles its bill", () => {
    expect(settledBases(flattenJournalEntries([bill, pay])).has("b1")).toBe(true);
  });

  it("★ the same payment, reversed, does not — read through the real flatten", () => {
    const rows = flattenJournalEntries([bill, pay, reversal]);
    expect(rows.find((r) => String(r.db_entry_id ?? r.id).startsWith("p1"))?.reversed_by).toBeTruthy();
    expect(settledBases(rows).has("b1")).toBe(false);
  });

  it("★ and the bank matcher offers the bill as open again", () => {
    const open = matchableOpenItems(flattenJournalEntries([bill, pay, reversal]), { apCode: "2000", arCode: "1100" });
    expect(open.some((i) => String(i.db_entry_id ?? i.id).startsWith("b1"))).toBe(true);
    const settled = matchableOpenItems(flattenJournalEntries([bill, pay]), { apCode: "2000", arCode: "1100" });
    expect(settled.some((i) => String(i.db_entry_id ?? i.id).startsWith("b1"))).toBe(false);
  });

  it("voided and deleted payments still settle nothing, as before", () => {
    expect(isLiveSettlement({ import_metadata: { payment_for: "b1" }, status: "voided" })).toBe(false);
    expect(isLiveSettlement({ import_metadata: { payment_for: "b1" }, deleted_at: "x" })).toBe(false);
    expect(isLiveSettlement({ import_metadata: { payment_for: "b1" } })).toBe(true);
  });
});

describe("'mark paid' asks the database the same question", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const probe = app.slice(app.indexOf('.eq("import_metadata->>payment_for", String(dbId))'), app.indexOf("if (!already) {\n          postedPaymentId"));
  it("★ a payment a live reversal points at does not block paying the bill again", () => {
    expect(probe).toMatch(/\.in\("import_metadata->>reverses", payIds\)\s*\n\s*\.is\("deleted_at", null\)\.eq\("status", "posted"\);/);
    expect(probe).toMatch(/already = payIds\.some\(id => !reversed\.has\(id\)\);/);
    expect(probe).not.toMatch(/\.limit\(1\)/);
  });
  it("reversals are stored under the key the probe reads", () => {
    expect(app).toMatch(/p_meta: \{ kind: "reversal", reverses: String\(origId\) \}/);
  });
});
