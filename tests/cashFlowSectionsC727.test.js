// C727 — the cash flow report in its three sections.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { cashFlowSection, cashCounterpart } from "../src/lib/reports.js";
import { cashLegSigned, reconBooksSet } from "../src/lib/reconcile.js";
import { DEFAULT_CHART_OF_ACCOUNTS as CHART } from "../src/lib/constants.js";

const je = (id, lines) => ({ id, entry_date: "2026-10-05", description: `x – ${id}`, status: "posted", deleted_at: null, source: "manual",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })) });

describe("★ which section each cash movement belongs to", () => {
  it("by the account on the other side", () => {
    expect(["4000", "6100", "1100", "2000", "2100", "2400", "1300"].map((c) => cashFlowSection(c, CHART))).toEqual(Array(7).fill("operating"));
    expect(["1500", "1600", "1700"].map((c) => cashFlowSection(c, CHART))).toEqual(["investing", "investing", "investing"]);
    expect(["2600", "3000", "3300", "3200"].map((c) => cashFlowSection(c, CHART))).toEqual(Array(4).fill("financing"));
    expect(cashFlowSection("3900", [])).toBe("financing");   // a custom equity account, by its range
    expect(cashFlowSection("9999", [])).toBe("operating");
  });
  it("a month's movements split, and the three add to the net", () => {
    const rows = flattenJournalEntries([
      je("sale", [{ code: "1000", debit: 5000 }, { code: "4000", credit: 5000 }]),
      je("bill", [{ code: "2000", debit: 800 }, { code: "1000", credit: 800 }]),
      je("equip", [{ code: "1500", debit: 3000 }, { code: "1000", credit: 3000 }]),
      je("loan", [{ code: "1000", debit: 10000 }, { code: "2600", credit: 10000 }]),
      je("draw", [{ code: "3300", debit: 1500 }, { code: "1000", credit: 1500 }]),
      je("sold", [{ code: "1000", debit: 900 }, { code: "1510", debit: 200 }, { code: "1500", credit: 1000 }, { code: "8200", credit: 100 }]),
    ]);
    const cash = ["1000"];
    const by = { operating: 0, investing: 0, financing: 0 };
    let net = 0;
    for (const r of reconBooksSet(rows, { cashCodes: cash })) {   // the report's own set
      const s = cashLegSigned(r, cash);
      if (!s) continue;
      by[cashFlowSection(cashCounterpart(r, cash), CHART)] += s; net += s;
    }
    expect(by).toEqual({ operating: 4200, investing: -2100, financing: 8500 });
    expect(by.operating + by.investing + by.financing).toBe(net);
  });
  it("the report shows them", () => {
    const v = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(v).toMatch(/bySection\[cashFlowSection\(cashCounterpart\(inv, cfCashCodes\), CHART_OF_ACCOUNTS\)\] \+= s;/);
    expect(v).toMatch(/"From running the business" : "Operating activities"/);
  });
});
