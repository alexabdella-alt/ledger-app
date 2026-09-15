import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { runAnomalyDetection } from "../src/lib/insights.js";

// ═════════════════════════════════════════════════════════════════════════════
// C471 — A CORRECTION MADE WITHIN A WEEK OF THE ENTRY IT CANCELS RAISED A "TWO CHARGES"
// CARD (HIGH — blocks sign-off) ON THE PAIR, AND A LARGE-CHARGE CARD ON THE CORRECTION.
// Both halves are out of the detectors' population now: a canceled purchase is not
// evidence of a spending pattern. Through the real flatten, so the stamp is what is read.
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })), ...extra });
const AP = "2000";
// A year of ordinary weekly Sysco produce so the detectors have a baseline to be wrong against.
const history = [];
for (let w = 0; w < 30; w++) {
  const d = new Date(Date.UTC(2026, 0, 5 + w * 7)); const date = d.toISOString().slice(0, 10);
  history.push(je(`h${w}`, date, "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 480 + (w % 3) }, { code: AP, name: "Accounts Payable", credit: 480 + (w % 3) }]));
}
const big = je("b1", "2026-08-03", "Sysco – walk-in freezer", [{ code: "5010", name: "Food Cost", debit: 6200 }, { code: AP, name: "Accounts Payable", credit: 6200 }]);
const corr = je("r1", "2026-08-05", "REVERSAL: Sysco – walk-in freezer", [{ code: AP, name: "Accounts Payable", debit: 6200 }, { code: "5010", name: "Food Cost", credit: 6200 }], { import_metadata: { kind: "reversal", reverses: "b1" } });
const now = new Date("2026-08-06T12:00:00Z");

describe("C471 · a correction and its target raise no card", () => {
  const withPair = flattenJournalEntries([...history, big, corr]);
  const without = flattenJournalEntries(history);
  it("the pair adds no anomaly to a clean ledger", () => {
    const a = runAnomalyDetection(withPair, [], now, { apCode: AP });
    const b = runAnomalyDetection(without, [], now, { apCode: AP });
    expect(a.map((x) => x.id).sort()).toEqual(b.map((x) => x.id).sort());
    expect(a.filter((x) => x.type === "duplicate_payment")).toEqual([]);
    expect(a.filter((x) => x.type === "large_transaction")).toEqual([]);
  });
  it("and the detectors still see the uncorrected purchase — the fix did not go blind", () => {
    const uncorrected = flattenJournalEntries([...history, big]);
    const a = runAnomalyDetection(uncorrected, [], now, { apCode: AP });
    expect(a.some((x) => x.type === "large_transaction" || x.type === "vendor_spike")).toBe(true);
  });
});
