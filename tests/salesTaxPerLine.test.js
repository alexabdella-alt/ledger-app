import { describe, it, expect } from "vitest";
import { computeLineTax, buildArInvoiceEntryPerLine, buildArInvoiceEntry } from "../src/lib/revenueEntries";

// ═════════════════════════════════════════════════════════════════════════════
// PER-LINE AND MULTI-JURISDICTION SALES TAX — §12's deferred sales-tax case.
//
// One blended rate is right for a business selling one kind of thing in one place, and wrong
// the moment either changes: a restaurant charges tax on prepared food and often none on
// grocery items; a business shipping across a state line charges the DESTINATION's rate.
//
// ★★★ THE FAILURE A BLENDED RATE PRODUCES IS THE DANGEROUS KIND: the invoice total can be
// RIGHT while the SPLIT is wrong — and the split is what gets filed. **You remit to a
// jurisdiction, not to an average.** An invoice collecting the correct $86.25 and
// attributing it to the wrong state is a correct-looking document and a wrong return.
// ═════════════════════════════════════════════════════════════════════════════

const C = { ar: "1100", rev: "4000", tax: "2350" };
const codes = { arCode: C.ar, revenueCode: C.rev, salesTaxCode: C.tax };

describe("★★★ the breakdown is carried, not collapsed", () => {
  it("★★★ two jurisdictions on one invoice stay separable", () => {
    // Collapsing them at booking time destroys the only place that fact exists — a return
    // would then have to be reconstructed from the invoices rather than read from the books.
    const e = buildArInvoiceEntryPerLine({
      ...codes,
      lines: [
        { amount: 1000, taxRate: 0.0625, jurisdiction: "TX" },
        { amount: 500, taxRate: 0.08875, jurisdiction: "NY" },
      ],
    });
    expect(e.meta.tax_by_jurisdiction).toEqual({ TX: 62.5, NY: 44.38 });
    expect(e.meta.tax).toBe(106.88);
  });

  it("★★ and the TOTAL is exactly what the single-rate builder would produce", () => {
    // The accuracy control cross-foots "tax charged" against the Sales-Tax-Payable balance
    // (C241). Adding jurisdictions must not quietly change the figure it compares.
    const perLine = buildArInvoiceEntryPerLine({ ...codes, lines: [{ amount: 1000, taxRate: 0.0625, jurisdiction: "TX" }] });
    const single = buildArInvoiceEntry({ ...codes, subtotal: 1000, taxRate: 0.0625 });
    expect(perLine.meta.tax).toBe(single.meta.tax);
    expect(perLine.lines).toEqual(single.lines);
  });

  it("★ the entry still balances, with tax on top of revenue", () => {
    const e = buildArInvoiceEntryPerLine({ ...codes, lines: [{ amount: 1000, taxRate: 0.1, jurisdiction: "TX" }] });
    expect(e.balanced).toBe(true);
    const ar = e.lines.find((l) => l.code === C.ar);
    expect(ar.debit).toBe(1100);            // 1000 + 100 tax
  });
});

describe("★★ exempt is not the same as zero-rated, and neither is a missing rate", () => {
  it("★★★ an exempt line contributes no tax and no jurisdiction row", () => {
    // A restaurant's grocery items. Exempt is a DECISION someone made.
    const t = computeLineTax([
      { amount: 100, taxRate: 0.0825, jurisdiction: "TX" },
      { amount: 40, taxExempt: true, jurisdiction: "TX" },
    ]);
    expect(t.subtotal).toBe(140);           // still revenue
    expect(t.tax).toBe(8.25);               // taxed on 100 only
    expect(t.byJurisdiction).toEqual({ TX: 8.25 });
  });

  it("★★★ a MISSING rate refuses the whole invoice — it is a gap, not a zero", () => {
    // Treating an absent rate as 0% would under-collect silently and produce an invoice that
    // looks complete. The one thing worse than asking is guessing.
    expect(computeLineTax([{ amount: 100, jurisdiction: "TX" }])).toBeNull();
    expect(computeLineTax([{ amount: 100, taxRate: "abc", jurisdiction: "TX" }])).toBeNull();
    expect(computeLineTax([{ amount: 100, taxRate: -0.05, jurisdiction: "TX" }])).toBeNull();
  });

  it("★ a zero RATE is honoured — it was stated", () => {
    const t = computeLineTax([{ amount: 100, taxRate: 0, jurisdiction: "OR" }]);
    expect(t.tax).toBe(0);
    expect(t.byJurisdiction).toEqual({});   // nothing owed to Oregon
  });

  it("a line with no amount is not a sale", () => {
    expect(computeLineTax([{ amount: 0, taxRate: 0.05 }])).toBeNull();
    expect(computeLineTax([])).toBeNull();
  });
});

describe("★ jurisdictions accumulate rather than overwrite", () => {
  it("★★ two lines in the same state add up", () => {
    const t = computeLineTax([
      { amount: 100, taxRate: 0.05, jurisdiction: "TX" },
      { amount: 200, taxRate: 0.05, jurisdiction: "TX" },
    ]);
    expect(t.byJurisdiction).toEqual({ TX: 15 });
    expect(t.tax).toBe(15);
  });

  it("★ an unnamed jurisdiction is labelled, not dropped", () => {
    // Dropping it would lose tax from the breakdown while keeping it in the total — the
    // breakdown would then silently fail to add up to what was charged.
    const t = computeLineTax([{ amount: 100, taxRate: 0.05 }]);
    expect(t.byJurisdiction).toEqual({ unspecified: 5 });
    const sum = Object.values(t.byJurisdiction).reduce((a, b) => a + b, 0);
    expect(sum).toBe(t.tax);
  });

  it("★★★ the breakdown always sums to the tax charged", () => {
    for (const lines of [
      [{ amount: 1000, taxRate: 0.0625, jurisdiction: "TX" }, { amount: 500, taxRate: 0.08875, jurisdiction: "NY" }],
      [{ amount: 33.33, taxRate: 0.07, jurisdiction: "A" }, { amount: 66.67, taxRate: 0.09, jurisdiction: "B" }],
      [{ amount: 10, taxRate: 0.05, jurisdiction: "A" }, { amount: 10, taxExempt: true }],
    ]) {
      const t = computeLineTax(lines);
      const sum = Math.round(Object.values(t.byJurisdiction).reduce((a, b) => a + b, 0) * 100) / 100;
      expect([JSON.stringify(lines), sum]).toEqual([JSON.stringify(lines), t.tax]);
    }
  });
});
