// ★ C738 — completeness across every client: an upload that went nowhere, a month with no statement,
// bank lines not in the books, a month not matched to the penny — and no green on nothing checked.
import { describe, it, expect } from "vitest";
import { completenessReport, completenessSummary, monthCoverage, STUCK_MINUTES } from "../src/lib/completeness.js";

const NOW = new Date(2026, 10, 18, 12, 0);   // Nov 18 2026 local → current month 2026-11, last finished 2026-10
const co = { id: "c1", name: "Red River Pizza Co.", cutoff_date: "2026-08-01" };
const acct = { id: "a1", company_id: "c1", name: "Chase Checking", active: true, institution: "Chase" };
const stmt = (id, s, e) => ({ id, company_id: "c1", bank_account_id: "a1", period_start: s, period_end: e, status: "complete" });
const recon = (s, e) => ({ company_id: "c1", account_id: "a1", status: "complete", statement_balance: 1000, period_start: s, period_end: e });
const clean = {
  companies: [co], accounts: [acct],
  intake: [{ company_id: "c1", status: "recorded", received_at: "2026-09-03T10:00:00Z", filename: "sysco.pdf" }],
  statements: [stmt("s8", "2026-08-01", "2026-08-31"), stmt("s9", "2026-09-01", "2026-09-30"), stmt("s10", "2026-10-01", "2026-10-31")],
  recons: [recon("2026-08-01", "2026-10-31")], openLines: [], now: NOW,
};
const one = (over = {}) => completenessReport({ ...clean, ...over })[0];
const texts = (r) => r.items.map((i) => `${i.severity}: ${i.text}`);

describe("a clean client", () => {
  it("★ complete: every finished month covered, every line in, matched to the penny", () => {
    const r = one();
    expect(r.status).toBe("complete");
    expect(r.items).toEqual([]);
    expect(Object.fromEntries(r.months.map((m) => [m.period, m.status]))).toEqual({ "2026-06": "before", "2026-07": "before", "2026-08": "complete", "2026-09": "complete", "2026-10": "complete", "2026-11": "in_progress" });
  });
});

describe("hole 1 — something arrived and went nowhere", () => {
  it("★ an upload still 'received' after the grace minutes is a problem, named by file", () => {
    const stuckAt = new Date(NOW - (STUCK_MINUTES + 5) * 60000).toISOString();
    const r = one({ intake: [...clean.intake, { company_id: "c1", status: "received", received_at: stuckAt, filename: "receipt-4471.jpg" }] });
    expect(r.status).toBe("problem");
    expect(texts(r)[0]).toMatch(/^problem: 1 upload from November 2026 arrived and never reached the books or a question \(receipt-4471\.jpg\)\.$/);
    expect(r.months.find((m) => m.period === "2026-11").status).toBe("problem");
  });
  it("★ one that STARTED being read and never finished ('processing' too long) is a problem too", () => {
    const r = one({ intake: [...clean.intake, { company_id: "c1", status: "processing", received_at: "2026-11-10T09:00:00Z", filename: "statement-oct.pdf" }] });
    expect(r.status).toBe("problem");
    expect(texts(r)[0]).toMatch(/arrived and never reached the books or a question \(statement-oct\.pdf\)/);
  });
  it("one just arrived (still within the grace minutes) is not yet a problem", () => {
    const r = one({ intake: [...clean.intake, { company_id: "c1", status: "processing", received_at: new Date(NOW - 60000).toISOString(), filename: "x.pdf" }] });
    expect(r.status).toBe("complete");
  });
  it("a failed upload is a problem with its reason; a held one is attention", () => {
    const r = one({ intake: [...clean.intake, { company_id: "c1", status: "failed", received_at: "2026-10-02T09:00:00Z", filename: "bad.pdf", detail: "couldn't read" }, { company_id: "c1", status: "held_for_review", received_at: "2026-10-05T09:00:00Z", filename: "q.pdf" }] });
    expect(texts(r)).toContain("problem: 1 upload from October 2026 failed (bad.pdf: couldn't read).");
    expect(texts(r)).toContain("attention: 1 document from October 2026 waiting on an answer.");
  });
});

describe("hole 2 — something never arrived (the bank backstop)", () => {
  it("★ a finished month with no statement is a problem", () => {
    const r = one({ statements: [clean.statements[0], clean.statements[2]] });
    expect(texts(r)).toContain("problem: No Chase Checking statement for September 2026.");
    expect(r.months.find((m) => m.period === "2026-09").status).toBe("problem");
  });
  it("last month's statement before the 15th is 'not in yet' (attention), after it 'missing' (problem)", () => {
    const early = one({ statements: clean.statements.slice(0, 2), now: new Date(2026, 10, 6, 12) });
    expect(texts(early)).toContain("attention: Chase Checking's October 2026 statement isn't in yet.");
    const late = one({ statements: clean.statements.slice(0, 2) });
    expect(texts(late)).toContain("problem: No Chase Checking statement for October 2026.");
  });
  it("a statement covering only half a month is not coverage", () => {
    const r = one({ statements: [clean.statements[0], stmt("s9", "2026-09-01", "2026-09-14"), clean.statements[2]] });
    expect(texts(r)).toContain("problem: Chase Checking's statements cover only part of September 2026.");
  });
  it("★ books that start before the first statement: those months were never checked", () => {
    const r = one({ companies: [{ ...co, cutoff_date: "2026-06-01" }] });
    expect(texts(r)).toContain("problem: The books start in June 2026 but the first bank statement is from August 2026 — June 2026 to July 2026 haven't been checked against the bank.");
  });
  it("bank lines not in the books, and a month not matched to the penny, are attention", () => {
    const r = one({ openLines: [{ company_id: "c1", statement_id: "s9", line_date: "2026-09-12", status: "pending" }], recons: [recon("2026-08-01", "2026-08-31")] });
    expect(texts(r)).toContain("attention: 1 line on the Chase Checking statement for September 2026 isn't in the books yet.");
    expect(texts(r)).toContain("attention: Chase Checking for October 2026 hasn't been matched to the penny yet.");
  });
  it("★ uploads but no statement at all: a problem, never green", () => {
    const r = one({ statements: [], recons: [] });
    expect(r.status).toBe("problem");
    expect(texts(r)).toContain("problem: No bank statement yet — nothing checks these books against the bank.");
    expect(r.months.some((m) => m.status === "complete")).toBe(false);
  });
  it("a second, real account with no statements is attention; the untouched default account is ignored", () => {
    const card = { id: "a2", company_id: "c1", name: "Amex", active: true, institution: "Amex" };
    const placeholder = { id: "a3", company_id: "c1", name: "Primary Checking", active: true, created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z" };
    const r = one({ accounts: [acct, card, placeholder] });
    expect(texts(r)).toEqual(["attention: Amex has no statements yet — its spending isn't checked against the bank."]);
  });
  it("a superseded statement doesn't count as coverage", () => {
    const r = one({ statements: [clean.statements[0], { ...clean.statements[1], status: "superseded" }, clean.statements[2]] });
    expect(texts(r)).toContain("problem: No Chase Checking statement for September 2026.");
  });
});

describe("the list", () => {
  it("problems first; a client with nothing yet is 'empty'; the summary counts", () => {
    const rep = completenessReport({ ...clean, companies: [co, { id: "c2", name: "Brand New LLC" }, { id: "c3", name: "Leaky Co" }], intake: [...clean.intake, { company_id: "c3", status: "failed", received_at: "2026-11-01T00:00:00Z", filename: "f" }] });
    expect(rep.map((r) => [r.name, r.status])).toEqual([["Leaky Co", "problem"], ["Red River Pizza Co.", "complete"], ["Brand New LLC", "empty"]]);
    expect(completenessSummary(rep)).toEqual({ total: 3, problem: 1, attention: 0, complete: 1, empty: 1 });
  });
  it("coverage arithmetic", () => {
    expect(monthCoverage([["2026-09-01", "2026-09-15"], ["2026-09-16", "2026-09-30"]], "2026-09")).toBe("full");
    expect(monthCoverage([["2026-08-20", "2026-09-19"]], "2026-09")).toBe("partial");
    expect(monthCoverage([], "2026-09")).toBe("none");
  });
});
