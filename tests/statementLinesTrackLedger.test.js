import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C631 — review finding K10: stored statement-line status drifted from the ledger.
const app = readFileSync("src/App.jsx", "utf8");
const sweep = app.slice(app.indexOf("const linkStatementLinesAfterBooking = async"), app.indexOf("const jeToStamp = new Set();"));
const apply = app.slice(app.indexOf("const applyMatchOnce = async (matchRecord) => {"), app.indexOf("// Move from queue to history"));

describe("statement lines follow the books", () => {
  it("★ an entry another statement line already owns is not handed to a second line", () => {
    expect(sweep).toMatch(/\.select\("journal_entry_id"\)\.eq\("company_id", currentCompany\.id\)\.not\("journal_entry_id", "is", null\)/);
    expect(sweep).toMatch(/if \(claimed\.has\(String\(jeId\)\)\) continue;/);
    expect(sweep.indexOf("if (claimed.has(String(jeId))) continue;")).toBeLessThan(sweep.indexOf("seen.get(k).push("));
  });

  it("★ a match confirmed from the review queue links its statement line, after the clearing posted", () => {
    expect(apply).toMatch(/const stmtId = bank_txn\?\._stmtId \|\| null;/);
    expect(apply).toMatch(/await linkStatementLinesAfterBooking\(stmtId, lineAcct\); await loadStatementExceptions\(currentCompany\.id\);/);
    expect(apply.indexOf("linkStatementLinesAfterBooking(stmtId")).toBeGreaterThan(apply.indexOf("if (!allClearingsPosted(results)) {"));
  });
});
