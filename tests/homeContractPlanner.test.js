import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C624 — review finding U9: a contract dropped on Home ran an older inline lease schedule.
const app = readFileSync("src/App.jsx", "utf8");
const home = app.slice(app.indexOf('} else if (docType === "contract") {'), app.indexOf('} else if (docType === "unknown") {'));

describe("a contract dropped on Home", () => {
  it("★ is planned by the same function as the Contracts screen", () => {
    expect(home).toMatch(/const planned = planContractEntries\(\{ contract, rc, rn, today: todayLocal\(\), defaultIbr: DEFAULT_IBR \}\);/);
    expect(home).not.toMatch(/calcLeaseTermMonths/);
    expect(home).not.toMatch(/Math\.pow\(1\+ibrM/);
    expect(app.match(/planContractEntries\(\{ contract, rc, rn, today: todayLocal\(\), defaultIbr: DEFAULT_IBR \}\)/g)).toHaveLength(2);
  });

  it("★ its save is read, and a failed one is said and undone on screen", () => {
    expect(home).toMatch(/const keptHome = await persistContract\(saved\);/);
    expect(home).toMatch(/if \(!keptHome\?\.ok\) \{\s*\n\s*setContracts\(prev => prev\.filter\(c => c\.id !== saved\.id\)\);/);
    expect(home).not.toMatch(/\n\s*persistContract\(saved\);/);
  });
});
