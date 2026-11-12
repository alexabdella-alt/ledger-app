import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C595 — review finding F1: a contract posted right after upload was saved as a SECOND
// contract, the original kept offering every entry, and Delete there wrote nothing.
const app = readFileSync("src/App.jsx", "utf8");
const persist = app.slice(app.indexOf("const persistContract = async"), app.indexOf("const loadContractsFromDB"));
const del = app.slice(app.indexOf("const softDeleteContracts"), app.indexOf("const softDeleteContract = (contract"));

describe("one contract, one row", () => {
  it("★ a save looks the database id up, so a copy without it UPDATES instead of inserting", () => {
    expect(persist).toMatch(/const dbId = contract\.db_id \|\| contractDbIdsRef\.current\.get\(String\(contract\.id\)\) \|\| null;\s*\n\s*if \(dbId\) \{/);
    expect(persist).toMatch(/\.update\(payload\)\.eq\("id", dbId\)/);
    expect(persist).not.toMatch(/if \(contract\.db_id\) \{/);
  });

  it("★ the first insert records the id where every later call will find it — the map AND the open view", () => {
    expect(persist).toMatch(/contractDbIdsRef\.current\.set\(String\(contract\.id\), data\.id\);/);
    expect(persist).toMatch(/setSelectedContract\(prev => prev && prev\.id === contract\.id \? \{ \.\.\.prev, db_id: data\.id \} : prev\);/);
  });

  it("★ delete finds the row by the same lookup, and its undo carries the id", () => {
    expect(del).toMatch(/const sDbId = s\.db_id \|\| contractDbIdsRef\.current\.get\(String\(s\.id\)\) \|\| null;/);
    expect(del).toMatch(/table: "contracts", id: sDbId,/);
    expect(del).not.toMatch(/id: s\.db_id,/);
    expect(del).toMatch(/gone\.push\(s\.db_id \? s : \{ \.\.\.s, db_id: sDbId \}\)/);
  });

  it("the lookup is cleared with the company", () => {
    const reset = app.slice(app.indexOf("const resetCompanyState = "), app.indexOf("const resetCompanyState = ") + 2500);
    expect(reset).toMatch(/contractDbIdsRef\.current = new Map\(\);/);
  });
});
