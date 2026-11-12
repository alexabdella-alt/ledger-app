import { describe, it, expect } from "vitest";
import { deriveStatementOpening, signedStatementAmount, chronologicalStatementRows } from "../src/lib/openingBalanceProposal";

// C607 — review finding K4. A month that opens at $1,000.00:
//   Mar 1  deposit   +500   → 1,500
//   Mar 1  rent      −700   →   800
//   Mar 2  fee        −15   →   785
const oldestFirst = [
  { date: "2026-03-01", description: "Deposit", amount: 500, balance: 1500 },
  { date: "2026-03-01", description: "Rent", amount: -700, balance: 800 },
  { date: "2026-03-02", description: "Fee", amount: -15, balance: 785 },
];

describe("the statement is read in its true order", () => {
  it("oldest-first: opening 1,000, ending 785", () => {
    const d = deriveStatementOpening({ transactions: oldestFirst });
    expect([d.openingBalance, d.endingBalance]).toEqual([1000, 785]);
  });

  it("★ newest-first export — same answer (it used to open at 1,500: rent's balance minus rent)", () => {
    const d = deriveStatementOpening({ transactions: oldestFirst.slice().reverse() });
    expect([d.openingBalance, d.endingBalance]).toEqual([1000, 785]);
  });

  it("★ the running balances decide the order even when the dates cannot", () => {
    const sameDay = [
      { date: "2026-03-01", amount: -700, balance: 800 },
      { date: "2026-03-01", amount: 500, balance: 1500 },
    ];
    expect(chronologicalStatementRows(sameDay).map((r) => r.amount)).toEqual([500, -700]);
    expect(deriveStatementOpening({ transactions: sameDay }).openingBalance).toBe(1000);
  });
});

describe("when the balances cannot decide, the file's direction does", () => {
  it("★ a newest-first file whose balances don't chain (a row is missing) is still read oldest-first", () => {
    // True order: Mar 1 A (+100 → 1,100), [missing −20], Mar 1 B (−50 → 1,030), [missing −5],
    // Mar 2 C (−10 → 1,015). With two rows missing, NEITHER order chains, so the balances
    // cannot decide — and the file's own newest-first direction must.
    const newestFirst = [
      { date: "2026-03-02", description: "C", amount: -10, balance: 1015 },
      { date: "2026-03-01", description: "B", amount: -50, balance: 1030 },
      { date: "2026-03-01", description: "A", amount: 100, balance: 1100 },
    ];
    expect(chronologicalStatementRows(newestFirst).map((r) => r.description)).toEqual(["A", "B", "C"]);
    expect(deriveStatementOpening({ transactions: newestFirst }).openingBalance).toBe(1000);
  });
});

describe("amounts are signed by their type", () => {
  it.each([[{ amount: 700, type: "debit" }, -700], [{ amount: -500, type: "credit" }, 500], [{ amount: 15, type: "Withdrawal" }, -15], [{ amount: -15 }, -15], [{ amount: "x" }, null]])("%j → %s", (t, want) => {
    expect(signedStatementAmount(t)).toBe(want);
  });

  it("★ an unsigned withdrawal no longer adds to the opening balance", () => {
    const unsigned = [{ date: "2026-03-01", amount: 700, type: "debit", balance: 300 }];
    expect(deriveStatementOpening({ transactions: unsigned }).openingBalance).toBe(1000);   // was 300 − 700 = −400
  });

  it("the ending balance without running balances uses signed amounts too", () => {
    const d = deriveStatementOpening({ transactions: [{ date: "2026-03-01", amount: 40, type: "debit" }], statedOpening: 100 });
    expect(d.endingBalance).toBe(60);
  });
});
