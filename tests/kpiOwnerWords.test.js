import { describe, it, expect } from "vitest";
import { computeKPIs } from "../src/lib/reports.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C484 — THE KPI REPORT ON THE OWNER'S REPORTS SCREEN SAID "Current Ratio · Gross Margin ·
// Operating Expense Ratio · Burn Multiple · Days Sales Outstanding", with "receivables" and
// "COGS" in the explanations. Its strings live in a lib, so the client-screen jargon guard
// (which scans view source) never read them. Held to the owner bar here, over a populated
// month and an empty one.
// ═════════════════════════════════════════════════════════════════════════════
const rows = [
  { id: "a", date: "2026-09-02", gl_code: "4000", amount: 1000, type: "revenue", debit_credit: "credit", status: "posted" },
  { id: "b", date: "2026-09-03", gl_code: "5010", amount: 400, type: "expense", debit_credit: "debit", status: "posted" },
  { id: "c", date: "2026-08-03", gl_code: "6100", amount: 300, type: "expense", debit_credit: "debit", status: "posted" },
];
const now = new Date("2026-09-15T12:00:00");
describe("C484", () => {
  for (const [name, ledger] of [["a populated month", rows], ["an empty month", []]]) {
    it(`every KPI label, display and explanation passes the owner bar (${name})`, () => {
      const list = computeKPIs(ledger, { now, cash: 5000 });
      const k = list.kpis || list;
      expect(k.length).toBeGreaterThanOrEqual(4);
      for (const x of k) {
        for (const f of [x.label, x.display, x.explanation || ""]) expect([x.key, f, containsOwnerJargon(f)]).toEqual([x.key, f, false]);
        expect(x.label).not.toMatch(/Ratio|Margin|Multiple|Outstanding|N\/A/);
      }
    });
  }
});
