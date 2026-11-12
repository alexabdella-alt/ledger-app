import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { openingGridValues, openingGridToPost, bankFallbackFor } from "../src/lib/openingGrid";
import { renderViewHtml } from "./helpers/renderView.jsx";
import OpeningBalancesView from "../src/components/views/OpeningBalancesView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C590 — THE STARTING-BALANCES GRID. Review findings B6 (two reviewers), B3 and B5.
// ═════════════════════════════════════════════════════════════════════════════
const accounts = [
  { code: "1000", name: "Cash", category: "Assets" }, { code: "1500", name: "Equipment", category: "Assets" },
  { code: "2100", name: "Credit Card", category: "Liabilities" }, { code: "2500", name: "Loan", category: "Liabilities" },
];
const saved = [
  { account_code: "1000", balance: 8000, posted: true }, { account_code: "1500", balance: 12000, posted: true },
  { account_code: "2500", balance: 5000, posted: true }, { account_code: "3400", balance: 15000, posted: true },
];
const bank = [{ id: 1, gl_code: "1000", current_balance: 11250 }];   // a later statement's ENDING balance

describe("B6 — typing one figure leaves the others where they were", () => {
  it("★ correcting the loan keeps the cash and the equipment on the grid", () => {
    const { values } = openingGridValues({ accounts, saved, bankAccounts: bank, typed: { 2500: "5200" } });
    expect(values).toEqual({ 1000: 8000, 1500: 12000, 2100: "", 2500: "5200" });
  });

  it("★ and Save sends ALL of them — not only the one that was typed", () => {
    const { values } = openingGridValues({ accounts, saved, bankAccounts: bank, typed: { 2500: "5200" } });
    expect(openingGridToPost(values, accounts)).toEqual({ 1000: 8000, 1500: 12000, 2500: 5200 });
  });

  it("clearing a field clears THAT field", () => {
    const { values } = openingGridValues({ accounts, saved, bankAccounts: bank, typed: { 1500: "" } });
    expect(values[1500]).toBe("");
    expect(openingGridToPost(values, accounts)).toEqual({ 1000: 8000, 2500: 5000 });
  });
});

describe("B3 — opening cash is the figure that was saved, not the bank's latest balance", () => {
  it("★ a saved opening wins over the bank account's current balance", () => {
    const { values, fromBank } = openingGridValues({ accounts, saved, bankAccounts: bank });
    expect(values[1000]).toBe(8000);
    expect(fromBank.has("1000")).toBe(false);
  });

  it("before anything is saved, the bank's balance is offered — and labelled as such", () => {
    const { values, fromBank } = openingGridValues({ accounts, saved: [], bankAccounts: bank });
    expect(values[1000]).toBe(11250);
    expect([...fromBank]).toEqual(["1000"]);
  });

  it("★ once a starting position exists, a cash account with no saved figure is EMPTY, not the bank's", () => {
    const noCash = saved.filter((r) => r.account_code !== "1000");
    const { values, fromBank } = openingGridValues({ accounts, saved: noCash, bankAccounts: bank });
    expect(values[1000]).toBe("");
    expect(fromBank.size).toBe(0);
  });

  it("a typed figure is never labelled 'from bank'", () => {
    const { fromBank } = openingGridValues({ accounts, saved: [], bankAccounts: bank, typed: { 1000: "9000" } });
    expect(fromBank.size).toBe(0);
  });

  it("★ the save-time fallback fills an empty cash field from the bank on the FIRST save only", () => {
    expect(bankFallbackFor({ 1500: 12000 }, bank, { hasSavedOpening: false })).toEqual({ 1000: 11250, 1500: 12000 });
    expect(bankFallbackFor({ 1500: 12000 }, bank, { hasSavedOpening: true })).toEqual({ 1500: 12000 });
    expect(bankFallbackFor({ 1000: 8000 }, bank, { hasSavedOpening: false })).toEqual({ 1000: 8000 });
  });

  it("the handler asks with the saved rows, not a flag", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/bankFallbackFor\(gridBalancesByCode, bankAccounts, \{ hasSavedOpening: \(openingBalances \|\| \[\]\)\.length > 0 \}\)/);
  });
});

describe("B5 — re-saving keeps the saved rows", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const fn = app.slice(app.indexOf("const postOpeningBalancesOnce"), app.indexOf("const confirmOpeningFromStatement ="));

  it("★ the rows are upserted on the table's own key, and the answer is read", () => {
    // The baseline's constraint is the reason: one row per (company, account).
    const schema = readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8");
    expect(schema).toMatch(/opening_balances_company_id_account_id_key UNIQUE \(company_id, account_id\)/);
    expect(fn).toMatch(/\.from\("opening_balances"\)\.upsert\(rows, \{ onConflict: "company_id,account_id" \}\)\.select\("id"\)/);
    // a plain insert survives only as the answer to "that constraint is not there"
    expect(fn).toMatch(/if \(rowsErr && \/no unique or exclusion constraint\/i\.test\(rowsErr\.message \|\| ""\)\) \{\s*\n\s*\(\{ data: wrote, error: rowsErr \} = await supabase\.from\("opening_balances"\)\.insert\(rows\)\.select\("id"\)\);/);
    expect(fn.match(/\.from\("opening_balances"\)\.insert\(/g)).toHaveLength(1);
    expect(fn).toMatch(/if \(rowsErr \|\| !\(wrote \|\| \[\]\)\.length\) throw/);
  });

  it("★ the old rows are deleted only after the new ones are in", () => {
    const del = fn.indexOf('.from("opening_balances").delete()');
    const guard = fn.lastIndexOf("if (openingRowsSaved) {", del);
    expect(guard).toBeGreaterThan(-1);
    expect(del - guard).toBeLessThan(120);
    expect(fn).toMatch(/openingRowsSaved = false;\s*\n\s*logAudit\("opening_rows_save_failed"/);
  });

  it("a failed save of the rows is said, not announced as ✓", () => {
    expect(fn).toMatch(/if \(!openingRowsSaved\) \{ showNotification\("Your starting balances are saved in your books, but this screen couldn't update its own copy/);
    const said = fn.indexOf("if (!openingRowsSaved) { showNotification");
    expect(said).toBeLessThan(fn.indexOf("showNotification(`Opening balances posted as of"));
  });

  it("after a save the grid shows the record again, not what was typed", () => {
    expect(fn).toMatch(/await loadAllData\(\); \} catch \{\}\s*\n\s*setOpeningBalBalances\(\{\}\);/);
  });
});

describe("the screen", () => {
  const ctx = (extra) => ({
    BOOKABLE_ACCOUNTS: accounts, CHART_OF_ACCOUNTS: accounts, bankAccounts: bank, openingBalances: saved, openingBalBalances: {},
    openingPosted: true, cutoffDate: "2026-01-01", navSeat: { isReviewerSeat: false }, getAccountByRole: () => null, ...extra,
  });
  const valueFor = (html, name) => { const m = html.match(new RegExp(`${name}</span></div>(?:<span[^>]*>from bank</span>)?<input[^>]*value="([^"]*)"`)); return m ? m[1] : null; };

  it("★ shows every saved figure while one field is being edited", () => {
    const html = renderViewHtml(OpeningBalancesView, ctx({ openingBalBalances: { 2500: "5200" } }));
    expect(valueFor(html, "Cash")).toBe("8000");
    expect(valueFor(html, "Equipment")).toBe("12000");
    expect(valueFor(html, "Loan")).toBe("5200");
  });

  it("★ shows the saved opening cash, with no 'from bank' tag, when the bank now holds a later balance", () => {
    const html = renderViewHtml(OpeningBalancesView, ctx());
    expect(valueFor(html, "Cash")).toBe("8000");
    expect(html).not.toMatch(/from bank/);
  });

  it("offers the bank's balance, tagged, before anything is saved", () => {
    const html = renderViewHtml(OpeningBalancesView, ctx({ openingBalances: [], openingPosted: false }));
    expect(valueFor(html, "Cash")).toBe("11250");
    expect(html).toMatch(/from bank/);
  });

  it("has no grid arithmetic of its own", () => {
    const src = readFileSync("src/components/views/OpeningBalancesView.jsx", "utf8");
    expect(src).not.toMatch(/Object\.keys\(openingBalBalances\)\.length > 0/);
    expect(src).toMatch(/postOpeningBalances\(openingGridToPost\(balances, bsAccts\)\)/);
  });
});
