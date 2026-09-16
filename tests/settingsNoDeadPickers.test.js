import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ═════════════════════════════════════════════════════════════════════════════
// C476 — TWO SETTINGS CONTROLS WITH NO READER. "Default cash account" and "Currency" were
// saved to the company row, loaded back, and consulted by nothing: every cash figure
// resolves by role (§4) and through the bank account a statement is matched to, and every
// amount prints in US dollars whatever the picker said. A picker whose value changes
// nothing is `O123` in a select — and a currency picker offering EUR on a product built
// around 1099s and Schedule C is a false promise. Removed rather than wired.
// ═════════════════════════════════════════════════════════════════════════════
describe("C476", () => {
  const src = fs.readFileSync("src/components/views/SettingsView.jsx", "utf8");
  it("the Settings form offers no currency picker and no default-cash picker", () => {
    expect(src).not.toMatch(/draft\.currency/);
    expect(src).not.toMatch(/draft\.defaultCashAccount/);
    expect(src).not.toMatch(/"EUR"|"GBP"/);
  });
  it("and the fields nothing reads have no reader anywhere (so the removal is not hiding a live setting)", () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    const readers = [];
    for (const f of walk("src").filter((f) => /\.(js|jsx)$/.test(f) && !f.endsWith("writeShapes.js"))) {
      const t = fs.readFileSync(f, "utf8");
      for (const k of ["defaultCashAccount", "defaultAPAccount", "defaultARAccount", "companySettings.currency", "companySettings?.currency"]) {
        // The state's own default object is a writer, not a reader.
        const uses = (t.match(new RegExp(k.replace(/[.?]/g, "\\$&"), "g")) || []).length - (t.match(new RegExp(`${k.replace(/[.?]/g, "\\$&")}\\s*:\\s*"`, "g")) || []).length;
        if (uses > 0) readers.push(`${f}: ${k}`);
      }
    }
    expect(readers).toEqual([]);
  });
});
