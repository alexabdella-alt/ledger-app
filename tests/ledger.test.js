import { describe, it, expect } from "vitest";
import { reversalIndex, reversalFor } from "../src/lib/ledger.js";

// O8 — a GAAP reversal posts a SEPARATE offsetting entry carrying
// import_metadata.reverses = <original db id>; the original stays live. reversalIndex
// maps original-id → { date, reversalId } so the UI can mark the original "Reversed".
describe("reversalIndex / reversalFor — mark a live original that has been reversed", () => {
  const original = { id: "A", db_entry_id: "A", date: "2026-03-01", description: "Bill", import_metadata: null };
  const reversal = { id: "R", db_entry_id: "R", date: "2026-04-15", description: "REVERSAL: Bill", import_metadata: { kind: "reversal", reverses: "A" } };
  const unrelated = { id: "B", db_entry_id: "B", date: "2026-03-02", import_metadata: null };

  it("indexes the reversal by the ORIGINAL's id, with its date", () => {
    const idx = reversalIndex([original, reversal, unrelated]);
    expect(idx.has("A")).toBe(true);
    expect(idx.get("A")).toEqual({ date: "2026-04-15", reversalId: "R" });
    expect(idx.has("B")).toBe(false);
  });

  it("reversalFor flags the original but NOT the reversal entry or unrelated rows", () => {
    const idx = reversalIndex([original, reversal, unrelated]);
    expect(reversalFor(idx, original)).toEqual({ date: "2026-04-15", reversalId: "R" });
    expect(reversalFor(idx, reversal)).toBe(null);   // the reversal entry itself isn't "reversed"
    expect(reversalFor(idx, unrelated)).toBe(null);
  });

  it("matches on db_entry_id when the flattened id differs (multi-line synthetic ids)", () => {
    // A multi-line original flattens to rows id `A_0`, `A_1` … all sharing db_entry_id "A".
    const line0 = { id: "A_0", db_entry_id: "A", date: "2026-03-01" };
    const idx = reversalIndex([reversal]);
    expect(reversalFor(idx, line0)).toEqual({ date: "2026-04-15", reversalId: "R" });
  });

  it("keeps the earliest reversal date if two point at one original; empty/no-meta → empty index", () => {
    const r2 = { id: "R2", db_entry_id: "R2", date: "2026-02-01", import_metadata: { reverses: "A" } };
    expect(reversalIndex([reversal, r2]).get("A").date).toBe("2026-02-01");
    expect(reversalIndex([original, unrelated]).size).toBe(0);
    expect(reversalIndex([]).size).toBe(0);
    expect(reversalIndex(null).size).toBe(0);
  });
});
