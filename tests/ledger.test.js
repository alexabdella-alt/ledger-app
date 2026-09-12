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

// ── C328 — AN ENTRY WITH NO RATIONALE CARRIES NONE, NOT A PLACEHOLDER ───────────
// `flattenJournalEntries` filled an absent `ai_reasoning` with the literal "Loaded from
// database". The detail panel gates its "why we booked it" block on the field being truthy
// and then hands it to `classifyBankReason`, whose provenance filter knows "imported from…"
// and nothing else — so a payment, a clearing or an opening balance rendered an
// "AI REASONING" box reading, verbatim, "Loaded from database". A sentence about where a
// row came from, in the slot for why it was booked (TIER 1 #7(b)).
import { classifyBankReason } from "../src/lib/bankMatch";
describe("C328 — no invented reasoning on a row that has none", () => {
  const je = (extra = {}) => ({
    id: "je-1", entry_date: "2026-08-04", description: "Payment – Roma Cheese & Dairy", source: "manual",
    journal_entry_lines: [
      { account_id: "a2", debit: 551.2, credit: 0, accounts: { code: "2000", name: "Accounts Payable" } },
      { account_id: "a1", debit: 0, credit: 551.2, accounts: { code: "1000", name: "Cash" } },
    ], ...extra,
  });
  it("flattens an entry without ai_reasoning to reasoning: null, so the panel's gate shows nothing", () => {
    const rows = flattenJournalEntries([je()]);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.reasoning).toBeNull();
    // the panel's gate: `sel.reasoning ? classifyBankReason(sel) : null`
    expect(rows[0].reasoning ? classifyBankReason(rows[0]) : null).toBeNull();
  });
  it("keeps a real rationale verbatim", () => {
    const rows = flattenJournalEntries([je({ ai_reasoning: "Weekly linen service — booked to Linen & Laundry." })]);
    expect(rows[0].reasoning).toBe("Weekly linen service — booked to Linen & Laundry.");
  });
  it("the placeholder is gone from src/, and the panel would have shown it verbatim", () => {
    // Demonstrated rather than asserted: the provenance filter does not know this string.
    expect(classifyBankReason({ reasoning: "Loaded from database", gl_name: "Cash" })).toBe("Loaded from database");
    const { readFileSync, readdirSync, statSync } = require("fs");
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = `${d}/${f}`; return statSync(p).isDirectory() ? walk(p) : [p]; });
    const hits = walk(new URL("../src", import.meta.url).pathname).filter((p) => /\.(js|jsx)$/.test(p) && readFileSync(p, "utf8").includes("Loaded from database"));
    expect(hits).toEqual([]);
  });
});
