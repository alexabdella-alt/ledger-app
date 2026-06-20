import { describe, it, expect } from "vitest";
import { newInvoiceDraft, emptyInvoiceLine, draftBase } from "../src/lib/invoiceDraft.js";

describe("newInvoiceDraft — a fresh Send Invoice draft is always complete", () => {
  it("has line_items (≥1) and the standard fields", () => {
    const d = newInvoiceDraft({ invoiceNumber: "INV-0001" });
    expect(Array.isArray(d.line_items)).toBe(true);
    expect(d.line_items.length).toBe(1);
    expect(d.invoice_number).toBe("INV-0001");
    expect(d.status).toBe("draft");
  });

  it("pre-fills tax_rate from a non-zero saved company default", () => {
    expect(newInvoiceDraft({ salesTaxRate: 8.5 }).tax_rate).toBe("8.5");
  });

  it("leaves tax_rate blank when the default is 0 / missing", () => {
    expect(newInvoiceDraft({ salesTaxRate: 0 }).tax_rate).toBe("");
    expect(newInvoiceDraft({}).tax_rate).toBe("");
  });
});

describe("emptyInvoiceLine", () => {
  it("has the line shape with a usable amount default", () => {
    const l = emptyInvoiceLine();
    expect(l).toMatchObject({ description: "", qty: 1, rate: "", amount: 0 });
    expect(l.id).toBeDefined();
  });
});

describe("draftBase — functional updates never read line_items off null (the crash)", () => {
  // Reproduces the exact failure: sendInvoiceDraftState starts null; a functional
  // setDraft must spread from a complete object, not the raw null state.
  const fallback = newInvoiceDraft({ invoiceNumber: "INV-1", salesTaxRate: 8.5 });

  it("null raw state → returns the fallback (line_items present, no throw)", () => {
    const base = draftBase(null, fallback);
    expect(() => base.line_items.map(l => l)).not.toThrow();
    expect(base.line_items.length).toBe(1);
  });

  it("an 'Add Line' on a fresh (null) draft works", () => {
    // setDraft(d => ({ ...d, line_items: [...d.line_items, emptyInvoiceLine()] })) with d=null
    const base = draftBase(null, fallback);
    const next = { ...base, line_items: [...base.line_items, emptyInvoiceLine()] };
    expect(next.line_items.length).toBe(2);
  });

  it("the tax-rate onChange on a null draft yields a COMPLETE object (not partial {tax_rate})", () => {
    // This is what regressed: {...null, tax_rate} dropped line_items → later .line_items threw.
    const base = draftBase(null, fallback);
    const next = { ...base, tax_rate: "9" };
    expect(next.tax_rate).toBe("9");
    expect(Array.isArray(next.line_items)).toBe(true);   // line_items survives the update
  });

  it("backfills line_items on a partial state (e.g. a stale {tax_rate} from the old bug)", () => {
    const base = draftBase({ tax_rate: "8" }, fallback);
    expect(Array.isArray(base.line_items)).toBe(true);
    expect(() => base.line_items.reduce((s) => s, 0)).not.toThrow();
  });

  it("prefers the live state when present (doesn't clobber an in-progress draft)", () => {
    const live = { ...fallback, customer: "Acme", line_items: [emptyInvoiceLine(), emptyInvoiceLine()] };
    expect(draftBase(live, fallback)).toBe(live);
  });
});
