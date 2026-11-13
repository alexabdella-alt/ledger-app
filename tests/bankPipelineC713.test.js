// C713 — fixes from the bank-statement pipeline audit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dedicatedGlFor } from "../src/lib/bankAccounts.js";
import { dropZoneOutcomeCopy } from "../src/lib/statementLifecycle.js";
import { buildBankLineEntry } from "../src/lib/bankMatch.js";

const app = readFileSync("src/App.jsx", "utf8");

describe("C713 — a refund keeps its direction through the pipeline", () => {
  it("every rebuild of a statement line carries money_in", () => {
    expect(app).toMatch(/\.\.\.\(typeof l\.money_in === "boolean" \? \{ money_in: l\.money_in \} : l\.direction === "in" \|\| l\.direction === "out" \? \{ money_in: l\.direction === "in" \} : \{\}\)/);
    expect((app.match(/\.\.\.\(typeof t\.money_in === "boolean" \? \{ money_in: t\.money_in \} : \{\}\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });
  it("and a refund filed under an expense then books as money IN", () => {
    const e = buildBankLineEntry({ id: "r", date: "2026-03-02", vendor: "Home Depot", amount: 84.12, money_in: true, type: "expense", gl_code: "6600", gl_name: "Office Supplies" }, { offsetCode: "1000", offsetName: "Cash" });
    expect(e.debit_credit).toBe("credit");   // the expense is credited (reduced) and cash debited — money in
    const lost = buildBankLineEntry({ id: "r", date: "2026-03-02", vendor: "Home Depot", amount: 84.12, type: "expense", gl_code: "6600", gl_name: "Office Supplies" }, { offsetCode: "1000", offsetName: "Cash" });
    expect(lost.debit_credit).toBe("debit");  // without money_in (the bug) it read as spending
  });
});

describe("C713 — each bank account and card in its own category", () => {
  const chart = [{ code: "1000", name: "Cash" }, { code: "2200", name: "Credit Card Liability" }];
  const accts = [{ id: "a", name: "Amex", type: "credit_card", gl_code: "2200" }, { id: "k", name: "Chase Checking", type: "checking", gl_code: "1000" }];
  it("a second card gets a free 22xx code named for it; a second checking a free 10xx", () => {
    expect(dedicatedGlFor({ id: "v", name: "Chase Visa", type: "credit_card", gl_code: "2200" }, accts, chart)).toEqual({ code: "2201", name: "Chase Visa", category: "Liabilities" });
    expect(dedicatedGlFor({ id: "s", name: "BofA Checking", type: "checking", gl_code: "1000" }, accts, chart)).toEqual({ code: "1001", name: "BofA Checking", category: "Assets" });
  });
  it("an account that's alone keeps its code", () => {
    expect(dedicatedGlFor(accts[0], accts, chart)).toBe(null);
  });
  it("new accounts get it automatically; Settings offers it to one that shares", () => {
    expect(app).toMatch(/const own = await giveBankAccountOwnCategory\(\{ id: "new", name: cleanName, type, gl_code: glCode \}\);/);
    expect(readFileSync("src/components/views/SettingsView.jsx", "utf8")).toMatch(/Give it its own category/);
  });
});

describe("C713 — the owner hears what really happened", () => {
  it("a bound statement whose save or run failed is never 'imported ✓'", () => {
    expect(app).toMatch(/We read your statement but couldn't finish adding it to your books — it's saved, so nothing is lost/);
    expect(app).toMatch(/left\.writeFailures = wf\.count;/);
  });
  it("only answerable lines are 'a quick answer from you'; the rest are named for what they are", () => {
    const t = dropZoneOutcomeCopy({ total: 10, booked: 6, exceptions: 4, hasAccountant: false, answerable: 1 });
    expect(t).toMatch(/1 needs a quick answer from you/);
    expect(t).toMatch(/3 couldn't be matched to a bill or saved/);
    expect(dropZoneOutcomeCopy({ total: 10, booked: 9, exceptions: 1, hasAccountant: false, answerable: 0 })).not.toMatch(/quick answer/);
  });
  it("a failed clearing raises an exception; the suggested match reaches the Matching queue", () => {
    expect(app).toMatch(/else if \(!ok && c\.bankId != null\) \{ const line = byLineId\.get\(String\(c\.bankId\)\); if \(line\) \{ exceptions\.push\(excOf\(line, "book_failed"\)\);/);
    expect(app).toMatch(/if \(plan2\.review\.length\) setMatchQueue\(/);
  });
});
