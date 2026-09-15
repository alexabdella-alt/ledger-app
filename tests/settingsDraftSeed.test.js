import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C427 — the Settings form's draft is seeded only once the company has loaded. Reloading on
// Settings ran the seed before `loadAllData` resolved, so the form showed the reset defaults
// (blank name) over a company that has one — and a save would have written the blanks.
const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
describe("C427", () => {
  it("the seed waits for companyDataLoaded, re-runs when it flips, and sits below its declaration", () => {
    const decl = src.indexOf("const [companyDataLoaded, setCompanyDataLoaded] = useState(false);");
    const eff = src.indexOf('if (view === "settings" && !settingsDraft && companyDataLoaded && !loadFailures.companies) {');   // C456 widened the gate
    expect(decl).toBeGreaterThan(-1);
    expect(eff).toBeGreaterThan(decl);
    expect(src.slice(eff, eff + 400)).toMatch(/\}, \[view, companyDataLoaded, loadFailures\.companies\]\);/);
    expect(src).not.toMatch(/if \(view === "settings" && !settingsDraft\) \{/);
  });
});

// C456 — a failed `companies` read leaves companySettings at the reset defaults even after
// companyDataLoaded flips; the draft must not seed from them and the form must not save.
describe("C456", () => {
  it("the seed and the save both gate on the company row having loaded", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/if \(view === "settings" && !settingsDraft && companyDataLoaded && !loadFailures\.companies\) \{/);
    expect(app).toMatch(/\}, \[view, companyDataLoaded, loadFailures\.companies\]\);/);
    const sv = fs.readFileSync("src/components/views/SettingsView.jsx", "utf8");
    expect(sv).toMatch(/const save = async \(\) => \{\s*if \(loadFailures\?\.companies\) \{[^\n]*return; \}/);
    expect(sv).toMatch(/<LoadFailedNotice what="company details" table="companies" \/>/);
    expect(sv).toMatch(/<button onClick=\{save\} disabled=\{!!loadFailures\?\.companies\}/);
  });
});
