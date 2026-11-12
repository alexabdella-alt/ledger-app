import { describe, it, expect } from "vitest";
import { mergeCategorized } from "../src/lib/categorizedMerge";
import { buildBankLineEntry } from "../src/lib/bankMatch";
import { bankLineDirection } from "../src/lib/openingBalanceProposal";
import { planLlmMatches } from "../src/lib/llmMatchFilter";

// C630 — review finding K5.
const raw = [
  { date: "2026-03-02", description: "HOME DEPOT #123", amount: -84.12, balance: 915.88 },
  { date: "2026-03-03", description: "HOME DEPOT REFUND", amount: 20.00, balance: 935.88 },
  { date: "2026-03-04", description: "ADOBE", amount: -54.99, balance: 880.89 },
];

describe("the statement's facts are kept; the AI only classifies", () => {
  it("★ the AI's amount, date and description never replace the statement's", () => {
    const cats = [
      { vendor: "Home Depot", amount: 84.12, date: "2026-03-02", type: "expense", gl_code: "6600", confidence: 90 },
      { vendor: "Home Depot", amount: 20, date: "2026-03-03", type: "expense", gl_code: "6600", confidence: 90 },
      { vendor: "Adobe", amount: 54.99, date: "2026-03-09", description: "Adobe CC", type: "expense", gl_code: "6500", confidence: 95 },
    ];
    const m = mergeCategorized(raw, cats);
    expect(m.map((x) => [x.date, x.amount, x.gl_code])).toEqual([["2026-03-02", -84.12, "6600"], ["2026-03-03", 20, "6600"], ["2026-03-04", -54.99, "6500"]]);
    expect(m[2].description).toBe("ADOBE");
  });

  it("★ a line the AI dropped is still there — flagged, not lost", () => {
    const m = mergeCategorized(raw, [{ vendor: "Home Depot", amount: 84.12, type: "expense", gl_code: "6600", date: "2026-03-02" }, { vendor: "Adobe", amount: 54.99, type: "expense", gl_code: "6500", date: "2026-03-04" }]);
    expect(m).toHaveLength(3);
    expect(m[1]).toMatchObject({ amount: 20, needs_review: true, confidence: 0, gl_code: null });
    expect(m[2].gl_code).toBe("6500");   // matched by amount, not position
  });

  it("★ a suggestion whose amount disagrees is not used", () => {
    const m = mergeCategorized(raw.slice(0, 1), [{ vendor: "Home Depot", amount: 8.41, type: "expense", gl_code: "6600" }]);
    expect(m[0]).toMatchObject({ amount: -84.12, needs_review: true });
  });
});

describe("a refund is money in", () => {
  const [refund] = mergeCategorized([raw[1]], [{ vendor: "Home Depot", amount: 20, type: "expense", gl_code: "6600", date: "2026-03-03" }]);
  it("★ booked as a credit to the expense (cash up), not a debit", () => {
    const e = buildBankLineEntry(refund);
    expect(e.debit_credit).toBe("credit");
    expect(e.gl_code).toBe("6600");
  });
  it("★ and recognised as money in for the re-upload check", () => {
    expect(bankLineDirection(refund)).toBe("in");
  });
  it("lines without the statement's direction keep the old rule", () => {
    expect(buildBankLineEntry({ amount: 50, type: "expense", gl_code: "6600" }).debit_credit).toBe("debit");
  });
});

describe("an AI match auto-clears only to the cent", () => {
  const open = [{ id: "i1", vendor: "Ace", amount: 1000, gl_code: "6250", secondary_gl_code: "2000", debit_credit: "debit", status: "booked" }];
  const run = (bankAmt) => planLlmMatches({
    matches: [{ bank_txn_id: "b1", invoice_ids: ["i1"], match_type: "ap_clear", confidence: 95, auto_clear: true }],
    openUniverse: open, bankTxns: [{ id: "b1", amount: bankAmt, vendor: "Ace" }], id: (n) => `m${n}`,
  });
  it("★ $980 against a $1,000 bill goes to a person", () => {
    const r = run(-980);
    expect(r.autoCleared).toHaveLength(0);
    expect(r.queue).toHaveLength(1);
  });
  it("$1,000 against $1,000 clears", () => {
    expect(run(-1000).autoCleared).toHaveLength(1);
  });
});
