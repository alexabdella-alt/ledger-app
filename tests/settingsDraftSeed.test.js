import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C427 — the Settings form's draft is seeded only once the company has loaded. Reloading on
// Settings ran the seed before `loadAllData` resolved, so the form showed the reset defaults
// (blank name) over a company that has one — and a save would have written the blanks.
const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
describe("C427", () => {
  it("the seed waits for companyDataLoaded, re-runs when it flips, and sits below its declaration", () => {
    const decl = src.indexOf("const [companyDataLoaded, setCompanyDataLoaded] = useState(false);");
    const eff = src.indexOf('if (view === "settings" && !settingsDraft && companyDataLoaded) {');
    expect(decl).toBeGreaterThan(-1);
    expect(eff).toBeGreaterThan(decl);
    expect(src.slice(eff, eff + 200)).toMatch(/\}, \[view, companyDataLoaded\]\);/);
    expect(src).not.toMatch(/if \(view === "settings" && !settingsDraft\) \{/);
  });
});
