import { describe, it, expect } from "vitest";
import { calcASC842 } from "../src/lib/gl.js";

// ── Item 4: journal entry balance validation ───────────────────────────────
// Double-entry invariant: total debits must equal total credits. The DB enforces
// this via the post_journal_entry RPC; here we test the invariant itself and that
// the balanced entries the app generates actually satisfy it.
const entryBalances = (lines, tolerance = 0.005) => {
  const debits = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const credits = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  return Math.abs(debits - credits) <= tolerance;
};

describe("journal entry balance", () => {
  it("accepts a balanced two-line entry", () => {
    expect(entryBalances([
      { account_code: "6500", debit: 47, credit: 0 },
      { account_code: "2000", debit: 0, credit: 47 },
    ])).toBe(true);
  });

  it("accepts a balanced multi-line entry", () => {
    expect(entryBalances([
      { debit: 1000, credit: 0 },
      { debit: 500, credit: 0 },
      { debit: 0, credit: 1500 },
    ])).toBe(true);
  });

  it("rejects an unbalanced entry", () => {
    expect(entryBalances([
      { debit: 100, credit: 0 },
      { debit: 0, credit: 90 },
    ])).toBe(false);
  });

  it("a lease commencement entry (DR ROU asset / CR lease liability) balances", () => {
    const { rouAsset, leaseLiability } = calcASC842(2500, 24, 0.07);
    const lines = [
      { account_code: "1800", debit: rouAsset, credit: 0 },        // ROU asset
      { account_code: "2400", debit: 0, credit: leaseLiability },  // lease liability
    ];
    expect(entryBalances(lines)).toBe(true);
  });
});
