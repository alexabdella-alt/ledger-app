import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { bankMatchStatus } from "../src/lib/controlTotals.js";
import { ownerTrustState } from "../src/lib/ownerTrust.js";
// C455 — a failed reconciliations read is not "never matched to your bank".
const base = { controlTotals: { failed: [], allTie: true }, hasBooks: true, setupComplete: true, reviewedThrough: "2026-07", hasAttester: true };
describe("C455", () => {
  it("unchecked: not overdue, and says so; checked with no rows: overdue as before", () => {
    const inv = [{ id: 1, status: "booked" }];
    expect(bankMatchStatus({ reconciliations: [], invoices: inv, checked: false })).toMatchObject({ overdue: false, unchecked: true });
    expect(bankMatchStatus({ reconciliations: [], invoices: inv })).toMatchObject({ overdue: true });
  });
  it("the trust header says it could not check, and does not reach all_clear", () => {
    const t = ownerTrustState({ ...base, bankMatch: { overdue: false, unchecked: true } });
    expect(t.lines.correct.text).toMatch(/couldn't check whether your books have been matched/);
    expect(t.overall).not.toBe("all_clear");
    expect(ownerTrustState({ ...base, bankMatch: { overdue: false } }).lines.correct.text).toMatch(/Nothing needs your attention/);
  });
  it("Home's memo and the bell pass the verdict", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/bankMatchStatus\(\{ reconciliations, invoices, checked: !loadFailures\.reconciliations \}\)/);
    expect(app).toMatch(/checked: !loadFailuresRef\.current\.reconciliations \}\);/);
  });
});
