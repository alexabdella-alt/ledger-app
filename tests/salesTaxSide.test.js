import { describe, it, expect } from "vitest";
import { computeControlTotals } from "../src/lib/controlTotals";

// ── THE LIVE SPECIMEN ────────────────────────────────────────────────────────
// Red River, a month of 27 purchase invoices and no sales: "tax charged on invoices is
// $14.80, sales tax owed (liability) is $0.00 — off by $14.80", severity high, on books
// that were entirely correct.
//
// ★ Sales Tax Payable is a liability for tax we COLLECT ON OUR OWN SALES and remit. Tax we
// pay a SUPPLIER is part of that expense and is owed to nobody. Counting it made the check
// impossible to pass on a purchase-only month — and "revenue-bearing" was already in the
// function's comment, with the helper defined one line above and called by nothing.

const codes = { ap: "2000", ar: "1100", cash: "1000", salesTax: "2350" };
const tax = (id, glCode, amount, dc, meta) => ({
  id, gl_code: glCode, amount, debit_credit: dc, date: "2026-08-15",
  type: glCode[0] === "4" ? "revenue" : "expense", status: "booked",
  ...(meta ? { import_metadata: meta } : {}),
});

// A receipt from a supplier that charged us sales tax. Dr expense / Dr tax / Cr cash.
const purchase = [
  tax("p1_0", "5010", 65.12, "debit",  { tax_amount: 14.80 }),
  tax("p1_1", "1000", 65.12, "credit", { tax_amount: 14.80 }),
];

// An invoice WE issued. Dr A/R / Cr Revenue / Cr Sales Tax Payable.
const sale = [
  tax("s1_0", "1100", 108, "debit",  { tax_amount: 8 }),
  tax("s1_1", "4000", 100, "credit", { tax_amount: 8 }),
  tax("s1_2", "2350", 8,   "credit", { tax_amount: 8 }),
];

const taxCheck = (invoices) => {
  const r = computeControlTotals({ invoices, codes });
  const list = Array.isArray(r) ? r : (r.checks || []);
  return list.find((c) => c.key === "sales_tax_tie");
};

describe("sales tax we PAID is not sales tax we OWE", () => {
  it("★ a month of purchase invoices carrying supplier tax TIES", () => {
    const c = taxCheck(purchase);
    expect(c.a).toBe(0);          // nothing charged on OUR sales
    expect(c.ties).toBe(true);
  });

  it("★ AND AN ACTUAL SALE IS STILL COUNTED — or the 'fix' is switching the check off", () => {
    // The negative case carries the weight. "The purchase month ties" is equally satisfied
    // by returning 0 always, which would silently retire the O59 control this exists for.
    const c = taxCheck(sale);
    expect(c.a).toBe(8);
    expect(c.ties).toBe(true);    // 8 charged, 8 sitting in the liability
  });

  it("★ and the O59 failure it was WRITTEN for still fires: tax mis-posted to revenue", () => {
    const misposted = [
      tax("m1_0", "1100", 108, "debit",  { tax_amount: 8 }),
      tax("m1_1", "4000", 100, "credit", { tax_amount: 8 }),
      tax("m1_2", "4000", 8,   "credit", { tax_amount: 8 }),   // should have been 2350
    ];
    const c = taxCheck(misposted);
    expect(c.a).toBe(8);
    expect(c.b).toBe(0);
    expect(c.ties).toBe(false);
  });

  it("★ a real month — sales AND purchases together — counts only the sales side", () => {
    const c = taxCheck([...purchase, ...sale]);
    expect(c.a).toBe(8);          // not 22.80
    expect(c.ties).toBe(true);
  });
});
