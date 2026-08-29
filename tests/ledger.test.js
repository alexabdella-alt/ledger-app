import { describe, it, expect } from "vitest";
import { reversalIndex, reversalFor, flattenJournalEntries } from "../src/lib/ledger.js";

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

// ═════════════════════════════════════════════════════════════════════════════
// O125 — flatten emits a display NAME and a grouping KEY, and they are different fields.
// Run through the REAL flattenJournalEntries, because the defect lived in that function
// and a test of the helpers alone would prove only that the helpers work.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ O125 — flattenJournalEntries stops deciding identity by punctuation", () => {
  const entry = (id, desc, code, debit, credit = 0, over = {}) => ({
    id, entry_date: over.date || "2026-08-15", description: desc,
    source: over.source || "manual", status: "posted", deleted_at: null,
    created_at: "2026-08-15T10:00:00Z", import_metadata: over.import_metadata || null,
    journal_entry_lines: [
      { debit, credit: 0, accounts: { code, name: code } },
      { debit: 0, credit: debit, accounts: { code: "1000", name: "Cash" } },
    ],
  });

  it("emits BOTH fields, and they are not the same string", () => {
    const [row] = flattenJournalEntries([entry("a", "Hill Country Milling Co. – freight", "5000", 100)]);
    expect(row.vendor).toBe("Hill Country Milling Co.");
    expect(row.vendor_key).toBe("hill country milling");
  });

  it("★ THE LIVE SYMPTOM: fifteen payroll runs are ONE vendor", () => {
    const runs = ["2026-01-15", "2026-02-15", "2026-03-15", "2026-08-28"].map((d, i) =>
      entry(`p${i}`, `Gusto Payroll — ${d} – ${d}`, "6000", 4000, 0, { source: "payroll", date: d }));
    const rows = flattenJournalEntries(runs);
    expect(new Set(rows.map(r => r.vendor_key)).size).toBe(1);
    expect(rows[0].vendor).toBe("Gusto Payroll");
  });

  it("★ THE LIVE SYMPTOM: the full-stop variants group together", () => {
    const rows = flattenJournalEntries([
      entry("a", "Hill Country Milling Co. – freight", "5000", 100),
      entry("b", "Hill Country Milling Co – freight", "5000", 200),
    ]);
    expect(rows[0].vendor_key).toBe(rows[1].vendor_key);
    // …while each keeps the name it was actually written with.
    expect(rows[0].vendor).not.toBe(rows[1].vendor);
  });

  it("★★ THE LIVE SYMPTOM: a reversal groups with the charge it reverses, so they NET", () => {
    // Before this, the original's vendor total was overstated and the reversal hid under
    // a vendor called "REVERSAL: …". Grouped by key, the two sum to zero — which is the
    // arithmetic truth of a reversed charge, and what the vendor list should show.
    const rows = flattenJournalEntries([
      entry("o", "Hill Country Milling Co. – freight", "5000", 468.50),
      { id: "r", entry_date: "2026-08-27", description: "REVERSAL: Hill Country Milling Co. – freight — Voided",
        source: "manual", status: "posted", deleted_at: null, created_at: "2026-08-27T10:00:00Z",
        import_metadata: { kind: "reversal", reverses: "o" },
        journal_entry_lines: [
          { debit: 0, credit: 468.50, accounts: { code: "5000", name: "5000" } },
          { debit: 468.50, credit: 0, accounts: { code: "1000", name: "Cash" } },
        ] },
    ]);
    expect(new Set(rows.map(r => r.vendor_key)).size).toBe(1);
    const net = rows.reduce((s, r) => s + (r.debit_credit === "debit" ? r.amount : -r.amount), 0);
    expect(net).toBe(0);
  });

  it("★ and still does not merge two genuinely different suppliers", () => {
    const rows = flattenJournalEntries([
      entry("a", "Lone Star – x", "5000", 10),
      entry("b", "Lone Star Restaurant Supply – x", "5000", 20),
    ]);
    expect(rows[0].vendor_key).not.toBe(rows[1].vendor_key);
  });
});
