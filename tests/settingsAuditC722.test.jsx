// C722 — the settings / categories / team / company-switch audit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { journalLinesForExport } from "../src/lib/insights.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import CoaView from "../src/components/views/CoaView.jsx";

const app = readFileSync("src/App.jsx", "utf8");
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("★ a category's type is its number's type", () => {
  it("a change that would make them disagree is refused and said", () => {
    expect(app).toMatch(/const byNumber = categoryForCode\(code\);\s*if \(\(updates\.code \|\| updates\.category\) && byNumber && wantType && byNumber !== wantType\) \{/);
    expect(app).toMatch(/A category's type has to match its number/);
  });
});

describe("★ the whole ledger, both sides, in the export", () => {
  it("a two-line entry gives its debit and its credit; an expanded entry's rows are lines; removed ones are out", () => {
    const rows = journalLinesForExport([
      { id: "e1", db_entry_id: "e1", date: "2026-10-01", gl_code: "6100", gl_name: "Rent", secondary_gl_code: "2000", secondary_gl_name: "Bills to pay", debit_credit: "debit", amount: 2000, vendor: "Landlord", description: "Oct rent", source: "manual" },
      { id: "e2_0", db_entry_id: "e2", date: "2026-10-02", gl_code: "1100", gl_name: "AR", secondary_gl_code: "4000", debit_credit: "debit", amount: 1082.5, vendor: "Acme" },
      { id: "e2_1", db_entry_id: "e2", date: "2026-10-02", gl_code: "4000", gl_name: "Sales", secondary_gl_code: "1100", debit_credit: "credit", amount: 1000, vendor: "Acme" },
      { id: "e3", db_entry_id: "e3", date: "2026-10-03", gl_code: "6500", debit_credit: "debit", amount: 5, secondary_gl_code: "1000", deleted_at: "x" },
    ]);
    expect(rows[0]).toEqual(["Entry", "Date", "Account code", "Account", "Debit", "Credit", "Vendor / customer", "Description", "Source"]);
    expect(rows.slice(1).map((r) => [r[0], r[2], r[4], r[5]])).toEqual([
      ["e1", "6100", 2000, ""], ["e1", "2000", "", 2000],
      ["e2", "1100", 1082.5, ""], ["e2", "4000", "", 1000],
    ]);
  });
  it("not over a load that failed; the categories go too", () => {
    const sv = readFileSync("src/components/views/SettingsView.jsx", "utf8");
    expect(sv).toMatch(/if \(!companyDataLoaded \|\| failedLoads\.length\) \{ showNotification\("Some of your data didn't load/);
    expect(sv).toMatch(/_chart_of_accounts_\$\{stamp\}\.csv/);
  });
});

describe("★ Settings saves in order, and says what it saved", () => {
  const sv = readFileSync("src/components/views/SettingsView.jsx", "utf8");
  it("the screen takes the settings only after the database does; the bank accounts are awaited", () => {
    const save = sv.slice(sv.indexOf("const save = async"), sv.indexOf("const handleLogo"));
    expect(save.indexOf("setCompanySettings(draft)")).toBeGreaterThan(save.indexOf('from("companies").update(companyPatch)'));
    expect(save).toMatch(/const banks = persistBankAccounts \? await persistBankAccounts\(\) : \{ ok: true \};/);
  });
  it("a draft is dropped on leaving Settings, so it can't write old answers back", () => {
    expect(app).toMatch(/if \(view !== "settings" && settingsDraft\) \{ setSettingsDraft\(null\); setSettingsLogoPreview\(null\); \}/);
  });
  it("only a seat the database lets write the company row gets Save", () => {
    expect(sv).toMatch(/disabled=\{!!loadFailures\?\.companies \|\| !\["owner", "admin"\]\.includes\(userRole\)\}/);
    expect(sv).toMatch(/Only the owner or an admin can change the company details/);
  });
});

describe("★ the rest", () => {
  it("a Reports drill doesn't follow you to another company", () => {
    expect(app).toMatch(/setPlDrill\(null\); setDrill\(null\); setDrillSel\(null\);   \/\/ C722/);
  });
  it("a category delete is counted, not assumed", () => {
    expect(app).toMatch(/const \{ data: gone, error \} = await supabase\.from\("accounts"\)\.delete\(\)[^\n]*\.select\("id"\);\s*if \(error \|\| !\(gone \|\| \[\]\)\.length\)/);
  });
  it("a bank account with money still in its own category isn't removed", () => {
    expect(app).toMatch(/still shows \$\{fmtMoney\(Math\.abs\(bal\)\)\} in your books, so it can't be removed yet/);
    expect(readFileSync("src/components/views/SettingsView.jsx", "utf8")).toMatch(/if \(!r\?\.ok && r\?\.error !== "balance"\)/);
  });
  it("Team: a revoke is checked; an admin isn't promised invites", () => {
    const t = readFileSync("src/components/views/TeamView.jsx", "utf8");
    expect(t).toMatch(/if \(error \|\| !\(gone \|\| \[\]\)\.length\) throw new Error/);
    expect(t).not.toMatch(/can invite others/);
  });
  it("a disabled category that already holds a starting balance stays in the grid", () => {
    const o = readFileSync("src/components/views/OpeningBalancesView.jsx", "utf8");
    expect(o).toMatch(/\.\.\.\(CHART_OF_ACCOUNTS\|\|\[\]\)\.filter\(a => a && a\.active === false && savedCodes\.has\(String\(a\.code\)\)\)/);
  });
  it("a view-only member sees the categories without the controls", () => {
    const chart = [{ code: "6600", name: "Office Supplies", category: "Expenses", active: true, db_id: "x" }];
    const viewer = text(renderViewHtml(CoaView, { CHART_OF_ACCOUNTS: chart, isViewer: true, accountsLoadOk: true }));
    const owner = text(renderViewHtml(CoaView, { CHART_OF_ACCOUNTS: chart, isViewer: false, accountsLoadOk: true }));
    expect(viewer).toMatch(/View-only access/);
    expect(viewer).not.toMatch(/\bEdit\b/);
    expect(owner).toMatch(/\bEdit\b/);
    expect(readFileSync("src/components/views/RulesView.jsx", "utf8")).toMatch(/\{!teachViewer && <button onClick=\{async\(\)=>\{ \/\* C397/);
  });
});
