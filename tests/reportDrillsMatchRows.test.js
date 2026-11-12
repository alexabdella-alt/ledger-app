import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeVendorTotals } from "../src/lib/reports";
import { buildAliasIndex, applyAlias } from "../src/lib/vendorAlias";

// C620 — review finding R9: the By Vendor and cash-flow drills listed different rows from the
// line clicked.
describe("By Vendor", () => {
  const rows = [
    { id: 1, vendor: "Hill Country Milling Co.", vendor_key: "hill country milling", amount: 300, date: "2026-03-01", gl_code: "5000", debit_credit: "debit", status: "booked" },
    { id: 2, vendor: "Hill Country Milling", vendor_key: "hill country milling", amount: 200, date: "2026-03-09", gl_code: "5000", debit_credit: "debit", status: "booked" },
    { id: 3, vendor: "HCM Flour", vendor_key: "hcm flour", amount: 100, date: "2026-03-12", gl_code: "5000", debit_credit: "debit", status: "booked" },
  ];
  const aliasIndex = buildAliasIndex([{ id: 9, name: "Hill Country Milling", aliases: ["HCM Flour"] }]);
  const keyOf = (i) => applyAlias(i.vendor_key || i.vendor || "Unknown", aliasIndex);

  it("★ the row carries the key it grouped by, and the drill's rule finds every row it added up", () => {
    const [row] = computeVendorTotals(rows, {}, { aliasIndex });
    expect(row.total).toBe(600);
    expect(row.key).toBeTruthy();
    const drilled = rows.filter((i) => keyOf(i) === row.key);
    expect(drilled.map((r) => r.id)).toEqual([1, 2, 3]);
    // the old rule: exact latest spelling → only one of three
    expect(rows.filter((i) => i.vendor === row.vendor).length).toBe(1);
  });

  it("the screen drills by that key and shows the row's own total", () => {
    const v = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(v).toMatch(/setDrill\(\{scope:"vendor",value:v\.key,label:v\.name,total:v\.total\}\)/);
    expect(v).toMatch(/if \(drill\.scope==="vendor"\)\s+return filtered\.filter\(i=>\(glIsExpense\(i\.gl_code\) \|\| glIsExpense\(i\.secondary_gl_code\)\) && vendorKeyOf\(i\)===drill\.value\)/);
    expect(v).toMatch(/: drill\.total != null \? drill\.total/);
  });
});

describe("cash-flow month", () => {
  it("★ lists the month's cash movements (as the row was built), totalled as net cash", () => {
    const v = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(v).toMatch(/if \(drill\.scope==="cashflow"\) return reconBooksSet\(filtered, \{ cashCodes: cfCashCodes \}\)/);
    expect(v).not.toMatch(/if \(drill\.scope==="cashflow"\) return filtered\.filter\(i=>i\.date && i\.date\.slice\(0,7\)===drill\.value\)/);
    expect(v).toMatch(/: drill\.scope==="cashflow" \? txns\.reduce\(\(s,i\)=>s\+cashLegSigned\(i, cfCashCodes\),0\)/);
  });
});
