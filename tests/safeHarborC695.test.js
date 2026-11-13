// C695 — the quarterly payment by the IRS safe harbor (§6654(d)(1)(B)).
import { describe, it, expect } from "vitest";
import { safeHarborQuarter, taxEstimate } from "../src/lib/tax.js";
import { readFileSync } from "node:fs";

describe("C695 — the smaller of 90% of this year and 100% / 110% of last year", () => {
  it("last year's is smaller → 100% of it", () => {
    expect(safeHarborQuarter({ thisYear: 20000, lastYear: 8000, lastYearAgi: 90000 })).toEqual({ perQuarter: 2000, basis: "last_year", factor: 1, required: 8000 });
  });
  it("over $150,000 of AGI last year → 110%; $75,000 married filing separately", () => {
    expect(safeHarborQuarter({ thisYear: 40000, lastYear: 20000, lastYearAgi: 160000 })).toMatchObject({ required: 22000, factor: 1.1 });
    expect(safeHarborQuarter({ thisYear: 40000, lastYear: 20000, lastYearAgi: 80000, filingStatus: "mfs" })).toMatchObject({ factor: 1.1 });
    expect(safeHarborQuarter({ thisYear: 40000, lastYear: 20000, lastYearAgi: 150000 })).toMatchObject({ factor: 1 });
  });
  it("this year's 90% is smaller → that", () => {
    expect(safeHarborQuarter({ thisYear: 10000, lastYear: 30000 })).toEqual({ perQuarter: 2250, basis: "ninety", factor: 1, required: 9000 });
  });
  it("no last year → a quarter of this year's, never negative", () => {
    expect(safeHarborQuarter({ thisYear: 10000 })).toMatchObject({ perQuarter: 2500, basis: "this_year" });
    expect(safeHarborQuarter({ thisYear: -500 }).perQuarter).toBe(0);
  });
});

describe("C695 — from the books", () => {
  const L = [{ gl_code: "4000", amount: 40000, debit_credit: "credit", date: "2025-02-01", status: "posted" },
             { gl_code: "4000", amount: 90000, debit_credit: "credit", date: "2026-02-01", status: "posted" }];
  it("uses last year's books and answers when they cover the whole year", () => {
    const e = taxEstimate(L, 2026, 0, { priorProfile: { filingStatus: "single" } });
    const last = taxEstimate(L, 2025, 0, {}).total;
    expect(e.safeHarbor).toMatchObject({ basis: "last_year", factor: 1, lastYearTax: last });
    expect(e.quarterly).toBe(Math.round(last / 4 * 100) / 100);
    expect(e.quarterlyFull).toBe(e.total / 4);
  });
  it("last year's other income counts toward the $150,000 that switches 110% on", () => {
    expect(taxEstimate(L, 2026, 0, { priorProfile: { filingStatus: "single", otherIncome: 200000 } }).safeHarbor.factor).toBe(1.1);
  });
  it("last year's books start after March → no safe harbor from them", () => {
    const late = [{ ...L[0], date: "2025-06-01" }, L[1]];
    expect(taxEstimate(late, 2026, 0, { priorProfile: {} }).safeHarbor.basis).toBe("this_year");
  });
  it("no prior answers given, or a C corporation → a quarter of this year's", () => {
    expect(taxEstimate(L, 2026, 0, {}).safeHarbor.basis).toBe("this_year");
    expect(taxEstimate(L, 2026, 0, { legalForm: "c_corp", priorProfile: {} }).safeHarbor.basis).toBe("this_year");
  });
  it("every caller passes last year's answers", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/priorProfile: profileForYear\(y - 1, \{ current: filedDeadlinesRef\.current, prev: filedDeadlinesPrevRef\.current \}\)/);
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/priorProfile: profileForYear\(y - 1, \{ current: filedDeadlines, prev: filedDeadlinesPrev \}\)/);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/priorProfile: taxProfileFrom\(filedDeadlinesPrev \|\| \{\}, filed\)/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/priorProfile: profileForYear\(year - 1,/);
    expect(readFileSync("src/components/views/TaxView.jsx", "utf8")).toMatch(/data-safe-harbor/);
  });
});

describe("C695 — the assistant explains the quarterly figure", () => {
  it("its instructions point at estimated_amount_due and its basis", () => {
    const srv = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(srv).not.toMatch(/each payment ≈ annual estimate ÷ 4/);
    expect(srv).toMatch(/estimated_amount_basis says why \(the IRS safe harbor/);
    expect(readFileSync("src/lib/aiTools.js", "utf8")).toMatch(/estimated_amount_basis: est\.safeHarbor \?/);
  });
});
