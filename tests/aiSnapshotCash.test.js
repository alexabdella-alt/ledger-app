import { describe, it, expect } from "vitest";
import { buildFinancials } from "../src/lib/ai.js";

// ═════════════════════════════════════════════════════════════════════════════
// C493 — THE FALLBACK SNAPSHOT TOLD THE MODEL CASH WAS "NOT SET BY THE OWNER" WHENEVER IT
// WAS ZERO OR NEGATIVE. Cash on hand has been GL-derived since the §12 single-source rule,
// so an overdrawn account and a genuinely empty one both read as a missing setting — and
// the model relayed that as an instruction to set something that no longer exists. The
// snapshot states the figure now, whatever its sign.
// ═════════════════════════════════════════════════════════════════════════════
describe("C493 · fallback snapshot cash", () => {
  it("zero and negative cash are figures, never a claim that nothing was set", () => {
    for (const cash of [0, -1250.5]) {
      const { text } = buildFinancials([], cash);
      expect(text).not.toMatch(/not set/i);
      expect(text).toMatch(/Cash on hand: [-−$0-9.,]+/);
    }
    expect(buildFinancials([], -1250.5).text).toMatch(/overdrawn/);
    expect(buildFinancials([], 0).text).not.toMatch(/overdrawn/);
    expect(buildFinancials([], 4200).text).toMatch(/Cash on hand: \$4,200\.00/);
  });
});

// C532 — with the company's A/R code the legacy snapshot's receivables are the code-aware
// figure (a direct deposit is not owed; a taxed invoice is owed with its tax).
describe("C532 — the legacy snapshot's receivables take the A/R code", () => {
  it("a direct deposit with no A/R leg is not 'past due' when the code is given", () => {
    const rows = [
      { id: "dep", vendor: "Acme", amount: 500, date: "2026-01-05", gl_code: "4000", secondary_gl_code: "1000", debit_credit: "credit", type: "revenue", payment_status: "unpaid", due_date: "2026-01-20", status: "booked" },
      { id: "inv", vendor: "Bravo", amount: 300, date: "2026-01-06", gl_code: "4000", secondary_gl_code: "1100", debit_credit: "credit", type: "revenue", payment_status: "unpaid", due_date: "2026-01-20", status: "booked" },
    ];
    const withCode = buildFinancials(rows, 100, { arCode: "1100" }).text;
    const without = buildFinancials(rows, 100).text;
    expect(withCode).toContain("$300.00 across 1 invoice(s) past due");
    expect(without).toContain("$800.00 across 2 invoice(s) past due");   // the flag list, as before, when no code is known
  });
});
