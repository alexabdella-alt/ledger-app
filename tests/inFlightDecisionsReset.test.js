import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C430 — every in-flight decision state (a staged AI action awaiting Confirm, a routed
// import file, a reconciliation offer, the shadow report) is cleared on a company switch.
const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const i = src.indexOf("const resetCompanyState = () => {");
const reset = src.slice(i, src.indexOf("\n  };", i));
describe("C430", () => {
  it("the four decision states are reset", () => {
    for (const st of ["setPendingAIActions(null)", "setPendingImportFile(null)", "setReconcileOffer(null)", "setShadowResult(null)"]) expect(reset, st).toContain(st);
  });
  it("★ and every `useState(null)` that holds a pending decision is reset — by name, so a new one is added here on purpose", () => {
    // any state whose name starts with `pending` or ends with `Offer` is a decision in flight
    const names = [...src.matchAll(/const \[(pending\w+|\w+Offer), (set\w+)\] = useState\(/g)].map((m) => m[2]);
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const setter of names) expect(reset, setter).toMatch(new RegExp(`${setter}\\(`));
  });
});
