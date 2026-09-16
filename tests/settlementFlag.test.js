import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { settlementTargetOf, settlementTargetsIn, liveSettlementsFor, flagAfterSettlementChange } from "../src/lib/settlementFlag.js";

// ═════════════════════════════════════════════════════════════════════════════
// C466 — REMOVING A PAYMENT LEFT ITS BILL FLAGGED PAID. `markBillPaid` stamps the flag when
// it posts the payment; soft-delete and reversal took the payment out and left the flag —
// so "Bills to pay" hid a bill the A/P balance still carried, and `ap_tie` failed by the
// deleted amount. The flag now follows the live settlements, in every direction.
// ═════════════════════════════════════════════════════════════════════════════
const bill = { id: "b1", db_entry_id: "b1", vendor: "Sysco", amount: 500, gl_code: "5010", secondary_gl_code: "2000", payment_status: "paid", import_metadata: {} };
const pay = (id, extra = {}) => ({ id, db_entry_id: id, vendor: "Sysco", amount: 500, gl_code: "2000", secondary_gl_code: "1000", status: "posted", import_metadata: { kind: "ap_payment", payment_for: "b1" }, ...extra });

describe("C466 · settlement flag", () => {
  it("names the bill a payment settles, and nothing for a bill", () => {
    expect(settlementTargetOf(pay("p1"))).toEqual({ targetId: "b1", kind: "ap_payment" });
    expect(settlementTargetOf(bill)).toBeNull();
    expect(settlementTargetsIn([pay("p1"), pay("p2"), bill])).toEqual([{ targetId: "b1", kind: "ap_payment" }]);
  });
  it("a deleted payment leaves no live settlement → unpaid", () => {
    const ledger = [bill, pay("p1")];
    expect(liveSettlementsFor(ledger, "b1", { excludeIds: ["p1"] })).toHaveLength(0);
    expect(flagAfterSettlementChange("ap_payment", 0)).toBe("unpaid");
  });
  it("a second live payment keeps the bill paid", () => {
    const ledger = [bill, pay("p1"), pay("p2")];
    expect(liveSettlementsFor(ledger, "b1", { excludeIds: ["p1"] })).toHaveLength(1);
    expect(flagAfterSettlementChange("ap_payment", 1)).toBe("paid");
    expect(flagAfterSettlementChange("ar_collection", 1)).toBe("collected");
  });
  it("a reversed payment does not count; undoing the reversal (excluding it) counts again", () => {
    const rev = { id: "r1", db_entry_id: "r1", status: "posted", import_metadata: { kind: "reversal", reverses: "p1" } };
    const ledger = [bill, pay("p1"), rev];
    expect(liveSettlementsFor(ledger, "b1")).toHaveLength(0);
    expect(liveSettlementsFor(ledger, "b1", { excludeIds: ["r1"] })).toHaveLength(1);
  });
  it("soft-deleted and voided settlements never count", () => {
    expect(liveSettlementsFor([bill, pay("p1", { deleted_at: "2026-09-15" })], "b1")).toHaveLength(0);
    expect(liveSettlementsFor([bill, pay("p1", { status: "voided" })], "b1")).toHaveLength(0);
  });
  it("counts a payment once even when flatten emitted it twice", () => {
    expect(liveSettlementsFor([bill, pay("p1"), pay("p1")], "b1")).toHaveLength(1);
  });
});

describe("C466 · App.jsx wires the resync into every path that changes the settlement set", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  const between = (a, b) => { const i = app.indexOf(a); expect(i).toBeGreaterThan(-1); const j = app.indexOf(b, i); expect(j).toBeGreaterThan(i); return app.slice(i, j); };
  it("a delete resyncs with the deleted ids excluded, after the write", () => {
    const fn = between("const softDeleteJournalEntry = async (invoice) => {", "const restoreJournalEntries");
    // Anchored on the line START so a commented-out call cannot satisfy it (the comment-guard
    // escape this repo has recorded eight times).
    expect(fn).toMatch(/if \(ids\.length\) \{[\s\S]*\n\s*await resyncSettledFlags\(\[invoice\], \{ excludeIds: ids \}\);/);
  });
  it("the delete's Undo resyncs after the restore landed, counting the snapshots", () => {
    const fn = between("const softDeleteInvoices = async (list, byAI=false) => {", "const softDeleteInvoice =");
    const undo = fn.slice(fn.indexOf("const ok = await restoreJournalEntries(allIds);"));
    // C507 — the restored set is the whole family of rows (one entry may be several), under the name `restored`.
    expect(undo).toMatch(/if \(!ok\) \{[\s\S]*?return;[\s\S]*?\}[\s\S]*?\n\s*await resyncSettledFlags\(restored, \{ entries: \[\.\.\.\(invoicesRef\.current \|\| \[\]\), \.\.\.restored\] \}\);/);
  });
  it("a reversal resyncs with the reversed settlement excluded by id", () => {
    const fn = between("const reverseJournalEntry = async (invoice, reason, byAI = false) => {", "const voidInvoiceWithUndo");
    expect(fn).toMatch(/\n\s*await resyncSettledFlags\(\[invoice\], \{ excludeIds: \[String\(origId\)\] \}\);\s*return revId;/);
  });
  it("the reversal's Undo returns on failure — it used to say Restored ✓ after the error — and resyncs on success", () => {
    const fn = between("const voidInvoiceWithUndo = async (invoice, reason, byAI=false) => {", "const softDeleteContracts");
    expect(fn).toMatch(/if \(!undoRes\.ok\) \{[\s\S]*?showNotification\("Couldn't undo that[^\n]*\n\s*return;/);
    expect(fn).toMatch(/\n\s*await resyncSettledFlags\(\[snap\], \{ excludeIds: \[String\(revId\)\] \}\);/);
  });
  it("the resync writes through the checked persistApStatus and audits a lost write", () => {
    const fn = between("const resyncSettledFlags = async (rows,", "const softDeleteJournalEntry");
    expect(fn).toMatch(/const r = await persistApStatus\(t\.targetId, patch\);\s*if \(!r\.ok\) \{\s*allOk = false;\s*logAudit\("settled_flag_resync_failed"/);
  });
});
