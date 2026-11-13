// C695 — the quarterly payment by the IRS safe harbor (§6654(d)(1)(B)).
import { describe, it, expect } from "vitest";
import { safeHarborQuarter, taxEstimate } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";

describe("C695 / C698 — last year's tax is the certain number", () => {
  it("100% of last year's, a quarter each installment", () => {
    expect(safeHarborQuarter({ thisYear: 20000, lastYear: 8000, lastYearAgi: 90000 })).toEqual({ perQuarter: 2000, basis: "last_year", factor: 1, required: 8000 });
  });
  it("C698 — even early in the year, when this year's tax so far is small (the review's case)", () => {
    // 2025 tax $28,725; Q1 2026 tax so far ~$1,300: the payment is still a quarter of last year's
    expect(safeHarborQuarter({ thisYear: 1295.33, lastYear: 28725, lastYearAgi: 110000 })).toMatchObject({ perQuarter: 7181.25, basis: "last_year" });
  });
  it("over $150,000 of AGI last year → 110%; $75,000 married filing separately (this year's status)", () => {
    expect(safeHarborQuarter({ thisYear: 40000, lastYear: 20000, lastYearAgi: 160000 })).toMatchObject({ required: 22000, factor: 1.1 });
    expect(safeHarborQuarter({ thisYear: 40000, lastYear: 20000, lastYearAgi: 80000, filingStatus: "mfs" })).toMatchObject({ factor: 1.1 });
    expect(safeHarborQuarter({ thisYear: 40000, lastYear: 20000, lastYearAgi: 150000 })).toMatchObject({ factor: 1 });
  });
  it("no last year → pay as you go: the tax so far less what's paid, never negative, never called penalty-safe", () => {
    expect(safeHarborQuarter({ thisYear: 10000, paid: 3000 })).toMatchObject({ perQuarter: 7000, basis: "so_far" });
    expect(safeHarborQuarter({ thisYear: 10000, paid: 12000 }).perQuarter).toBe(0);
    expect(safeHarborQuarter({ thisYear: -500 }).perQuarter).toBe(0);
  });
});

describe("C695 / C698 — from the books", () => {
  const L = [{ gl_code: "4000", amount: 40000, debit_credit: "credit", date: "2025-02-01", status: "posted" },
             { gl_code: "4000", amount: 90000, debit_credit: "credit", date: "2026-02-01", status: "posted" }];
  it("uses last year's books and answers when they cover last year", () => {
    const e = taxEstimate(L, 2026, 0, { priorProfile: { filingStatus: "single" } });
    const last = taxEstimate(L, 2025, 0, {}).total;
    expect(e.safeHarbor).toMatchObject({ basis: "last_year", factor: 1, lastYearTax: last });
    expect(e.quarterly).toBe(Math.round(last / 4 * 100) / 100);
    expect(e.quarterlyFull).toBe(e.total / 4);
  });
  it("last year's other income counts toward the $150,000 that switches 110% on", () => {
    expect(taxEstimate(L, 2026, 0, { priorProfile: { filingStatus: "single", otherIncome: 200000 } }).safeHarbor.factor).toBe(1.1);
  });
  it("C698 — a business that started mid-way through last year (books from its start) still counts", () => {
    const late = [{ ...L[0], date: "2025-06-01" }, L[1]];
    expect(taxEstimate(late, 2026, 0, { priorProfile: {} }).safeHarbor.basis).toBe("last_year");
  });
  it("C698 — a cutoff inside last year means last year's books are partial → pay as you go", () => {
    expect(taxEstimate(L, 2026, 0, { priorProfile: {}, cutoffDate: "2025-02-15" }).safeHarbor.basis).toBe("so_far");
    expect(taxEstimate(L, 2026, 0, { priorProfile: {}, cutoffDate: "2025-01-01" }).safeHarbor.basis).toBe("last_year");
  });
  it("no prior answers given → pay as you go; a C corporation → a quarter of this year's", () => {
    expect(taxEstimate(L, 2026, 0, {}).safeHarbor.basis).toBe("so_far");
    const c = taxEstimate(L, 2026, 0, { legalForm: "c_corp", priorProfile: {} });
    expect(c.safeHarbor).toBe(null);
    expect(c.quarterly).toBe(c.total / 4);
  });
  it("every caller passes last year's answers and the cutoff", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/priorProfile: profileForYear\(y - 1, \{ current: filedDeadlinesRef\.current, prev: filedDeadlinesPrevRef\.current \}\), cutoffDate: cutoffDateRef\.current \|\| null/);
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/priorProfile: profileForYear\(y - 1, \{ current: filedDeadlines, prev: filedDeadlinesPrev \}\), cutoffDate: cutoffDate \|\| null/);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/priorProfile: taxProfileFrom\(filedDeadlinesPrev \|\| \{\}, filed\), cutoffDate: cutoffDate \|\| null/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/priorProfile: profileForYear\(year - 1,[^\n]*cutoffDate: ctx\.cutoffDate \|\| null/);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/data-safe-harbor/);
  });
  it("C698 — the screen never calls the pay-as-you-go figure penalty-safe", () => {
    const tax = readFileSync("src/components/views/TaxView.jsx", "utf8");
    expect(tax).not.toMatch(/90% of this year's estimate, which the IRS accepts/);
    expect(tax).toMatch(/Pay about \{fmt\(est\.quarterly\)\} by the next deadline<\/strong>/);
  });
});

describe("C695 — the assistant explains the quarterly figure", () => {
  it("its instructions point at estimated_amount_due and its basis", () => {
    const srv = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(srv).not.toMatch(/each payment ≈ annual estimate ÷ 4/);
    expect(srv).toMatch(/estimated_amount_basis says why\. Only call the amount penalty-safe/);   // C698
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/estimated_amount_basis: est\.safeHarbor \?/);
  });
});
