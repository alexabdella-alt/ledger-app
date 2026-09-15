import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C431 — editing a category (rename / renumber) reloads the LEDGER, not only the chart:
// rows carry gl_name/gl_code as load-time snapshots, so without it every screen kept the
// old name and a renumbered account read $0 on the Balance Sheet until the next reload.
const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
describe("C431", () => {
  it("persistAccountEdit reloads the chart and then the ledger, only after the write landed", () => {
    const i = src.indexOf("const persistAccountEdit = ");
    const body = src.slice(i, src.indexOf("const accountHasTransactions = ", i));
    const ok = body.indexOf("if (!r.ok)");
    const chart = body.indexOf("await reloadAccounts();");
    const ledger = body.indexOf("await loadAllData();");
    expect(ok).toBeGreaterThan(-1);
    expect(chart).toBeGreaterThan(ok);
    expect(ledger).toBeGreaterThan(chart);
    expect(body.slice(ledger - 20, ledger + 40)).toMatch(/try \{ await loadAllData\(\); \}/);
  });
  it("the snapshot the reload refreshes is real: flatten reads the joined account name", () => {
    const ledger = fs.readFileSync("src/lib/ledger.js", "utf8");
    expect(ledger).toMatch(/gl_name: primaryLine\?\.accounts\?\.name/);
  });
});
