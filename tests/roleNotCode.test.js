import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// §4: users renumber, so code never hardcodes "6100". C340's jargon guard found "1100"/"2000"
// typed into the clarification flow; a sweep of every literal 4-digit code in src/ then
// found Retained Earnings read as getBal("3100") on the Balance Sheet, and Opening Balance
// Equity as "3400" in BOTH the grid and the posting path — while `083` had just backfilled
// the role onto every company so that exactly this lookup could resolve. Each is pinned as
// "resolved by role, literal only as fallback".
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("C341 — the three load-bearing equity/plug accounts resolve by role", () => {
  it("Balance Sheet: Retained Earnings by role", () => {
    const src = read("src/components/views/ReportsView.jsx");
    expect(src).toMatch(/const reCode = getAccountByRole\?\.\("retained_earnings"\)\?\.code \|\| "3100"/);
    expect(src).toMatch(/getBal\(reCode\)/);
    expect(src).not.toMatch(/getBal\("3100"\)/);
    expect(src).not.toMatch(/a\.code !== "3100"/);
  });
  it("Opening balances grid: the plug by role", () => {
    const src = read("src/components/views/OpeningBalancesView.jsx");
    expect(src).toMatch(/const OBE = getAccountByRole\?\.\(OBE_ROLE\)\?\.code \|\| OBE_CODE/);
    expect(src).not.toMatch(/const OBE = "3400"/);
  });
  it("Opening balances posting: the SAME resolution, so the grid and the entry cannot disagree", () => {
    const src = read("src/App.jsx");
    // `redoOpeningSetup` is declared BEFORE `postOpeningBalances` — an end anchor searched
    // from the start offset, or the slice is empty and the test fails on correct code (C237).
    const start = src.indexOf("const postOpeningBalances");
    const end = src.indexOf("\n  const ", start + 40);
    const fn = src.slice(start, end);
    expect(fn.length).toBeGreaterThan(500);
    expect(fn).toMatch(/const obeCode = getAccountByRole\(OBE_ROLE\)\?\.code \|\| OBE_CODE;/);
    expect(fn).toMatch(/buildOpeningBalanceEntry\(merged, \{ cutoffDate: cutoff, obeCode, accounts/);
    expect(fn).toMatch(/ensureAccountIdForCode\(obeCode\)/);
    expect(fn).not.toMatch(/obeCode: OBE_CODE/);
  });
});
