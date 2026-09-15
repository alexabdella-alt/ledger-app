import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { bookableAccounts, disableAccountBlocker, STRUCTURAL_ROLES } from "../src/lib/chart.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C472 — "DISABLE" ON A CATEGORY CHANGED NOTHING BUT THE ROW'S OPACITY. `active: false` was
// written and read by nothing: every picker and all seven AI chart slots kept offering the
// account, so the model went on booking to a category the person had turned off. And the
// control was offered on Cash and Accounts Payable, where obeying it would have been worse.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash", active: true },
  { code: "6300", name: "Marketing", category: "Expenses", active: true },
  { code: "6400", name: "Travel", category: "Expenses", active: false },
  { code: "6500", name: "Software", category: "Expenses" },
];

describe("C472 · bookableAccounts", () => {
  it("drops a disabled account and keeps one with no flag", () => {
    expect(bookableAccounts(chart).map((a) => a.code)).toEqual(["1000", "6300", "6500"]);
    expect(bookableAccounts(null)).toEqual([]);
  });
});

describe("C472 · disableAccountBlocker", () => {
  it("refuses a structural role, names a rule, a recurring charge, a linked bank account; otherwise null", () => {
    expect(disableAccountBlocker(chart[0])).toMatch(/books run on/);
    expect(disableAccountBlocker(chart[1], { rules: [{ vendor: "Meta", gl_code: "6300" }] })).toMatch(/supplier rule \(Meta\)/);
    expect(disableAccountBlocker(chart[1], { recurring: [{ name: "Ad spend", gl_code: "6300" }] })).toMatch(/recurring charge \(Ad spend\)/);
    expect(disableAccountBlocker(chart[1], { recurring: [{ name: "Old", gl_code: "6300", active: false }] })).toBeNull();
    expect(disableAccountBlocker(chart[0] && { ...chart[0], system_role: null }, { bankAccounts: [{ name: "Chase", gl_code: "1000" }] })).toMatch(/Chase/);
    expect(disableAccountBlocker(chart[1], {})).toBeNull();
  });
  it("every sentence passes the owner bar", () => {
    for (const s of [disableAccountBlocker(chart[0]), disableAccountBlocker(chart[1], { rules: [{ vendor: "Meta", gl_code: "6300" }] }), disableAccountBlocker(chart[1], { recurring: [{ name: "Ad spend", gl_code: "6300" }] })]) {
      expect(containsOwnerJargon(s)).toBe(false);
    }
  });
  it("the structural set holds the roles every write path resolves", () => {
    for (const r of ["cash", "accounts_payable", "accounts_receivable", "opening_balance_equity"]) expect(STRUCTURAL_ROLES.has(r)).toBe(true);
    expect(STRUCTURAL_ROLES.has("marketing_advertising")).toBe(false);   // a template may hide it
  });
});

describe("C472 · the choosers read the bookable list", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  it("all seven AI chart slots, and none of the full chart", () => {
    expect((app.match(/CHART: BOOKABLE_ACCOUNTS\./g) || []).length).toBe(7);
    expect(app).not.toMatch(/CHART: CHART_OF_ACCOUNTS\./);
  });
  it("persistAccountEdit refuses a disable with the blocker's reason before the write", () => {
    const fn = app.slice(app.indexOf("const persistAccountEdit = async (account, updates) => {"), app.indexOf("const payload = {};", app.indexOf("const persistAccountEdit")));
    expect(fn).toMatch(/\n\s*if \(updates\.active === false\) \{\s*\n\s*const why = disableAccountBlocker\(account, \{ rules, recurring, bankAccounts \}\);\s*\n\s*if \(why\) \{ showNotification\(why, "error"\); return false; \}/);
  });
  // Every <option> list drawn from the chart is a chooser and must read the bookable list.
  // Balance-sheet/statement readers (ReportsView, CoaView, the opening totals) read the full
  // chart on purpose: a disabled account with a balance is still on the balance sheet.
  it("every <option> mapped from the chart in a component is bookable", () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    const offenders = [];
    for (const f of walk("src/components").filter((f) => f.endsWith(".jsx"))) {
      const src = fs.readFileSync(f, "utf8");
      for (const line of src.split("\n")) {
        if (/<option\b/.test(line) && /\bCHART_OF_ACCOUNTS\b|\bcustomCOA\b/.test(line) && /\.map\(/.test(line)) offenders.push(`${f}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
    // Anti-vacuity: the choosers exist and read the bookable list.
    const panel = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8");
    expect(panel).toMatch(/\(BOOKABLE_ACCOUNTS \|\| \[\]\)\.filter\(a => a\.code >= "4000"\)\.map\(a => <option/);
  });
});
