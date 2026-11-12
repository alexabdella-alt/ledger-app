import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C611 — review finding F11: a new bank account was inserted twice when the balance field's
// blur-save and the Save button ran together.
const app = readFileSync("src/App.jsx", "utf8");
const fn = app.slice(app.indexOf("const bankDbIdsRef = useRef"), app.indexOf("// Create ONE bank-account source inline"));

describe("a new bank account is inserted once", () => {
  it("★ saves run one after another", () => {
    expect(fn).toMatch(/const run = bankSaveChainRef\.current\.then\(\(\) => persistBankAccountsOnce\(accts\), \(\) => persistBankAccountsOnce\(accts\)\);\s*\n\s*bankSaveChainRef\.current = run\.catch\(\(\) => \{\}\);\s*\n\s*return run;/);
  });

  it("★ an inserted account's row is remembered, and a later save with the old list UPDATES it", () => {
    expect(fn).toMatch(/bankDbIdsRef\.current\.set\(String\(a\.id\), data\.id\);/);
    expect(fn).toMatch(/const knownId = bankDbIdsRef\.current\.get\(String\(a\.id\)\);\s*\n\s*const rowId = knownId \|\| a\.id;\s*\n\s*const isUuid = typeof rowId === "string" && rowId\.includes\("-"\);/);
    expect(fn).toMatch(/table: "bank_accounts", id: rowId,/);
  });

  it("the memory is cleared with the company", () => {
    const reset = app.slice(app.indexOf("const resetCompanyState = "), app.indexOf("const resetCompanyState = ") + 2500);
    expect(reset).toMatch(/bankDbIdsRef\.current = new Map\(\);/);
  });

  it("both triggers still call the same save", () => {
    const v = readFileSync("src/components/views/SettingsView.jsx", "utf8");
    expect(v).toMatch(/onBlur=\{\(\)=>persistBankAccounts && persistBankAccounts\(\)\}/);
    expect(v).toMatch(/persistBankAccounts && persistBankAccounts\(\); \/\/ save bank accounts incl\. balances/);
  });
});
