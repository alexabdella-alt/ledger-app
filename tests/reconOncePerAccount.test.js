import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { reconciliationCoversPeriod } from "../src/lib/controlTotals";

// C629 — review finding K8.
const done = { status: "complete", statement_balance_verified: true, statement_balance: 1000, account_id: "checking", period_start: "2026-03-01", period_end: "2026-03-31", completed_at: "x" };

describe("a month is reconciled per account", () => {
  it("★ checking's March does not cover savings' March", () => {
    expect(reconciliationCoversPeriod([done], "2026-03", { accountId: "savings" })).toBe(false);
    expect(reconciliationCoversPeriod([done], "2026-03", { accountId: "checking" })).toBe(true);
  });
  it("without an account, the month-level answer is unchanged", () => {
    expect(reconciliationCoversPeriod([done], "2026-03")).toBe(true);
  });
  it("the pipeline asks per account", () => {
    expect(readFileSync("src/lib/pipeline.js", "utf8")).toMatch(/reconciliationCoversPeriod\(reconciliations, period, \{ accountId: statement && statement\.bank_account_id \}\)/);
  });
});

describe("a reconciliation the pipeline just saved is not saved again", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("★ it is remembered at once, and the aftermath check reads it", () => {
    expect(app).toMatch(/if \(rid\) \{ freshReconsRef\.current = \[\.\.\.freshReconsRef\.current, \{ \.\.\.payload, id: rid \}\]; setReconciliations\(/);
    expect(app).toMatch(/reconciliations: \[\.\.\.\(reconciliations \|\| \[\]\), \.\.\.freshReconsRef\.current\], balanceSettled: rv\.balanceSettled/);
  });
  it("cleared with the company", () => {
    const reset = app.slice(app.indexOf("const resetCompanyState = "), app.indexOf("const resetCompanyState = ") + 2500);
    expect(reset).toMatch(/freshReconsRef\.current = \[\];/);
  });
});
