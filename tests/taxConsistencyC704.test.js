// C704 — the same tax figures on every surface: payments, January's Q4, the penalty promise.
import { describe, it, expect } from "vitest";
import { installmentsDue, paidForYear, safeHarborQuarter, taxEstimate } from "../src/lib/tax.js";
import { lastYearBalanceLine } from "../src/lib/taxSetAside.js";
import { executeAITool } from "../src/lib/aiTools.js";
import { readFileSync } from "node:fs";

describe("C704 — installments and payments", () => {
  it("how many of the year's four installments are due", () => {
    expect(installmentsDue(2026, "2026-03-01")).toBe(0);
    expect(installmentsDue(2026, "2026-04-15")).toBe(0);   // due today is not yet late
    expect(installmentsDue(2026, "2026-04-16")).toBe(1);
    expect(installmentsDue(2026, "2026-09-20")).toBe(3);
    expect(installmentsDue(2026, "2027-02-01")).toBe(4);
  });
  it("the payments for a year come from that year", () => {
    expect(paidForYear(2027, { thisYear: 500, lastYear: 15000, currentYear: 2027 })).toBe(500);
    expect(paidForYear(2026, { thisYear: 500, lastYear: 15000, currentYear: 2027 })).toBe(15000);
    expect(paidForYear(2025, { thisYear: 500, lastYear: 15000, currentYear: 2027 })).toBe(0);
  });
  it("behind on earlier quarters is said, not hidden behind 'avoids a penalty'", () => {
    expect(safeHarborQuarter({ thisYear: 9000, lastYear: 20000, paid: 0, due: 2 }).behind).toBe(10000);
    expect(safeHarborQuarter({ thisYear: 9000, lastYear: 20000, paid: 10000, due: 2 }).behind).toBe(0);
    const L = [{ gl_code: "4000", amount: 90000, debit_credit: "credit", date: "2025-02-01", status: "posted" }, { gl_code: "4000", amount: 60000, debit_credit: "credit", date: "2026-02-01", status: "posted" }];
    const e = taxEstimate(L, 2026, 0, { priorProfile: {}, asOf: "2026-09-20" });
    expect(e.safeHarbor.behind).toBe(Math.round(e.safeHarbor.required * 3 / 4 * 100) / 100);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/behind on this year's earlier payments — pay that now to catch up/);
  });
});

describe("C704 — January's Q4 is about last year, everywhere", () => {
  it("Home and the bell use last year's payments and both years' filed marks", () => {
    const app = readFileSync("src/App.jsx", "utf8"), home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(app).toMatch(/setEstPaidPrevYear\(Number\(prev\?\.estimated_payments_made\) \|\| 0\)/);
    expect(home).toMatch(/paidForYear\(y, \{ thisYear: estPaidThisYear, lastYear: estPaidPrevYear \}\)/);
  });
  it("the Taxes screen's deadline row shows the deadline's own year", () => {
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).toMatch(/const e = estimateTaxYearFor\(d\) === year \? est : lastYearEst;/);
    expect(tax).toMatch(/const isFiled = !!filed\[filedKey\(d\)\] \|\| !!\(filedDeadlinesPrev \|\| \{\}\)\[filedKey\(d\)\];/);
  });
  it("Home shows last year's balance until April 15", () => {
    expect(lastYearBalanceLine({ owed: 4200, total: 9000, estPaid: 1000 }, 2026).text).toBe("For 2026: about $4,200 of tax is still to pay by April 15, after the estimated payments you recorded.");
    expect(lastYearBalanceLine({ owed: 4200, total: 9000, estPaid: 0 }, 2026).text).toBe("For 2026: about $4,200 of tax is still to pay by April 15.");   // C706 — no payments, no mention
    expect(lastYearBalanceLine({ owed: 4200, total: 9000 }, 2026, { cutoffDate: "2026-09-01" }).text).toMatch(/Your books start on 2026-09-01, so this covers only part of 2026/);
    expect(lastYearBalanceLine({ owed: 0, total: 9000 }, 2026)).toBe(null);
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/data-last-year-tax/);
  });
  it("the bell's 1099 check sees card accounts set up in Settings", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/year: d\.year - 1, bankAccounts: bankAccountsRef\.current \|\| \[\] \}\)\.outstanding > 0/);
  });
});

describe("C704 — the assistant subtracts what's been paid", () => {
  it("total_owed is what's still owed; the year's total is separate", async () => {
    const ledger = [{ gl_code: "4000", amount: 60000, debit_credit: "credit", date: `${new Date().getFullYear()}-02-01`, status: "posted" }];
    const r = await executeAITool("get_tax_summary", {}, { getLedger: async () => ledger, chartOfAccounts: [], estPaidThisYear: 2000, estPaidPrevYear: 0 });
    expect(r.estimated_payments_made).toBe(2000);
    expect(r.total_owed).toBe(Math.max(0, Math.round((r.total_tax_for_year - 2000) * 100) / 100));
    expect(readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8")).toMatch(/If behind_on_installments is above zero/);
  });
});
