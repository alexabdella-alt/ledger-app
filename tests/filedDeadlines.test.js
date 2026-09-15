import { describe, it, expect } from "vitest";
import fs from "fs";
import { nextUrgentDeadline, getTaxDeadlines, filedKey } from "../src/lib/tax.js";
import { homeWaitingList } from "../src/lib/homeWaiting.js";

// ═════════════════════════════════════════════════════════════════════════════
// C388 — "MARK FILED" ON THE TAXES SCREEN NOW REACHES HOME AND THE BELL. `tax_settings.
// filed_deadlines` was written and read by TaxView alone; Home's waiting list and the
// notification bell kept saying "Pay 3rd-quarter estimated taxes — due today" after the
// person had ticked it filed. An action whose effect is invisible will be repeated (O123).
// ═════════════════════════════════════════════════════════════════════════════
const NOW = new Date(2026, 8, 15);   // 15 Sept 2026 — the Q3 estimate is due today

describe("★★ nextUrgentDeadline skips a deadline marked filed", () => {
  it("due today → returned; marked filed → the NEXT one within the window, or null", () => {
    const d = nextUrgentDeadline(NOW, 30);
    expect(d).toBeTruthy();
    expect(d.days).toBe(0);
    const after = nextUrgentDeadline(NOW, 30, { filed: { [filedKey(d)]: true } });
    expect(after === null || after.key !== d.key).toBe(true);
    // and the key is the SAME one TaxView stores: `${key}-${year}`
    expect(filedKey(d)).toBe(`${d.key}-${d.year}`);
  });
  it("a filed map for a different year does not hide this year's deadline", () => {
    const d = nextUrgentDeadline(NOW, 30);
    expect(nextUrgentDeadline(NOW, 30, { filed: { [`${d.key}-${d.year - 1}`]: true } })?.key).toBe(d.key);
  });
  it("a falsy or malformed filed map is ignored, never thrown on", () => {
    expect(nextUrgentDeadline(NOW, 30, { filed: null })?.days).toBe(0);
    expect(nextUrgentDeadline(NOW, 30, {})?.days).toBe(0);
  });
  it("every deadline getTaxDeadlines yields carries the key/year the map is keyed on", () => {
    for (const d of getTaxDeadlines(NOW)) expect(filedKey(d)).toMatch(/^\d+-\d+-\d{4}$/);
  });
});

describe("★ the readers actually consult the map (source)", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  const home = fs.readFileSync("src/components/views/DashboardView.jsx", "utf8");
  const tax = fs.readFileSync("src/components/views/TaxView.jsx", "utf8");
  it("Home passes filedDeadlines; the bell passes the ref; TaxView pushes the map after a landed save", () => {
    expect(home).toMatch(/nextUrgentDeadline\(new Date\(\), 30, \{ filed: filedDeadlines \}\)/);
    expect(app).toMatch(/nextUrgentDeadline\(new Date\(\), 30, \{ filed: filedDeadlinesRef\.current \}\)/);
    expect(app).not.toMatch(/getTaxDeadlines\(new Date\(\)\)\.find/);
    const save = tax.slice(tax.indexOf("const save = async (next) => {"), tax.indexOf("const toggleFiled"));
    expect(save.indexOf("rowExists.current = true;")).toBeLessThan(save.indexOf("setFiledDeadlines(next.filed || {})"));
    expect(save.indexOf("if (error || !data || !data.length)")).toBeLessThan(save.indexOf("setFiledDeadlines(next.filed || {})"));
  });
  it("the map is loaded with the company and cleared on switch", () => {
    expect(app).toMatch(/loadFiledDeadlines\(cid\)/);
    expect(app).toMatch(/const resetCompanyState = \(\) => \{[\s\S]*?setFiledDeadlines\(\{\}\);/);
    expect(app).toMatch(/\.from\("tax_settings"\)\s*\.select\("filed_deadlines"\)/);
  });
  it("Home's waiting list carries no tax item when the caller passes none (the filed case)", () => {
    expect(homeWaitingList({ taxDeadline: null }).find((i) => i.id === "tax_deadline")).toBeUndefined();
  });
});
