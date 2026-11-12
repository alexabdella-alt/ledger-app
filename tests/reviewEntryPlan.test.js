import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reviewEntryPlan } from "../src/lib/reviewEntryPlan";

// C610 — review finding F9: "Post Entry to Ledger" posted only the first two lines.
const L = (account_code, debit, credit) => ({ account_code, account_name: account_code, debit, credit });

describe("the whole proposal is posted, or nothing", () => {
  it("★ a three-line proposal posts all three lines", () => {
    const p = reviewEntryPlan([L("6250", 100, 0), L("2350", 8.25, 0), L("2000", 0, 108.25)]);
    expect(p.mode).toBe("multi");
    expect(p.lines).toHaveLength(3);
    expect(p.total).toBe(108.25);
  });

  it("★ an unbalanced proposal is refused, never trimmed to fit", () => {
    expect(reviewEntryPlan([L("6250", 100, 0), L("2000", 0, 90)]).mode).toBe("refuse");
    expect(reviewEntryPlan([L("6250", 100, 0)]).mode).toBe("refuse");
  });

  it("one debit against one equal credit is the ordinary entry", () => {
    const p = reviewEntryPlan([L("6250", 100, 0), L("2000", 0, 100), L("6600", 0, 0)]);
    expect([p.mode, p.debit.account_code, p.credit.account_code]).toEqual(["simple", "6250", "2000"]);
    expect(p.paidFromCash).toBe(false);
  });

  it("★ paid straight from the bank is marked paid", () => {
    expect(reviewEntryPlan([L("6250", 100, 0), L("1000", 0, 100)], { cashCode: "1000" }).paidFromCash).toBe(true);
    expect(reviewEntryPlan([L("6250", 100, 0), L("1010", 0, 100)], { cashCodes: ["1000", "1010"] }).paidFromCash).toBe(true);
  });

  it("the screen uses the plan, the multi-line writer, and the paid flag", () => {
    const v = readFileSync("src/components/views/ReviewView.jsx", "utf8");
    expect(v).toMatch(/const plan = reviewEntryPlan\(doc\.journal_entry\.lines, \{ cashCodes: cashGlCodes, cashCode: getAccountByRole\("cash"\)\?\.code \}\);/);
    expect(v).toMatch(/if \(plan\.mode === "refuse"\) \{ showNotification\(plan\.why, "error"\); return; \}/);
    expect(v).toMatch(/const mlId = await persistMultiLineEntry\(je\);\s*\n\s*if \(!mlId\) return;/);
    expect(v).toMatch(/payment_status: plan\.paidFromCash \? "paid" : "unpaid",/);
    expect(v).not.toMatch(/const debitLine = doc\.journal_entry\.lines\.find\(l=>l\.debit>0\);/);
  });
});
