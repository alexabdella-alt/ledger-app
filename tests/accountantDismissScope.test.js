import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C424 — the "add your accountant" dismissal is scoped to the company and re-read on a switch.
const src = fs.readFileSync("src/App.jsx", "utf8");
describe("C424", () => {
  it("the key carries the company id, the state re-reads on switch, and the writer uses the same key", () => {
    expect(src).toMatch(/const accountantDismissKey = \(cid\) => `cfai_onboard_accountant_dismissed_\$\{cid \|\| "none"\}`;/);
    expect(src).toMatch(/useEffect\(\(\) => \{ setAccountantDismissed\(readAccountantDismissed\(currentCompany\?\.id\)\); \}, \[currentCompany\?\.id\]\);/);
    expect(src).toMatch(/localStorage\.setItem\(accountantDismissKey\(currentCompany\?\.id\), "1"\)/);
    expect(src).not.toMatch(/"cfai_onboard_accountant_dismissed"/);
  });
});
