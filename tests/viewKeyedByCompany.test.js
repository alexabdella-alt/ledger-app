import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C426 — the view container remounts on a company switch, so per-screen state (selections,
// searches, open edit forms) cannot carry from one company to the next.
describe("C426", () => {
  it("the view container's key carries the company id", () => {
    const src = fs.readFileSync("src/App.jsx", "utf8");
    expect(src).toMatch(/<div key=\{`\$\{view\}:\$\{currentCompany\?\.id \|\| "none"\}`\} className="sc-rise"/);
    expect(src).not.toMatch(/<div key=\{view\} className="sc-rise"/);
  });
});
