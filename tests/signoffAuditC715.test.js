// C715 — the accountant-seat sign-off audit: what the gate checked wrong, and what it didn't check.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { computeControlTotals, signOffReadiness, periodReconciledForAccounts } from "../src/lib/controlTotals.js";
import { latestReviewedThrough } from "../src/lib/signoff.js";
import { ownerSignOffBlockers } from "../src/lib/ownerTrust.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

const rec = (extra) => ({ id: "r1", status: "complete", account_id: "acct-1", account_name: "Acct", statement_balance: 0, statement_balance_verified: true, ...extra });
const cashCheck = (cts) => cts.checks.find((c) => c.key === "cash_recon");

describe("★ the bank-match control total uses the reconcile screen's identity", () => {
  it("a bank account: an uncashed $275 check reconciles", () => {
    const cts = computeControlTotals({ reconciliations: [rec({ statement_balance: 1275, books_balance: 1000, outstanding_books: [{ signed: -275 }] })],
      bankAccounts: [{ id: "acct-1", gl_code: "1000" }] });
    expect(cashCheck(cts).ties).toBe(true);
  });
  it("a credit card reconciled with a $200 uncleared charge ties — it used to fail by $400", () => {
    // owes $0 on the statement; the books owe $200 more (the charge hasn't posted yet)
    const r = rec({ statement_balance: 0, books_balance: 200, outstanding_books: [{ signed: -200 }] });
    expect(cashCheck(computeControlTotals({ reconciliations: [r], bankAccounts: [{ id: "acct-1", gl_code: "2150", type: "credit_card" }] })).ties).toBe(true);
    // the same record read as a bank account is off — the sign is what changed
    expect(cashCheck(computeControlTotals({ reconciliations: [r], bankAccounts: [{ id: "acct-1", gl_code: "1000" }] })).ties).toBe(false);
  });
  it("a bank line the reviewer chose to ignore is out of the figure, as on the reconcile screen", () => {
    const r = rec({ statement_balance: 1000, books_balance: 1000, unmatched_bank: [{ amount: 50, _ignored: true }] });
    expect(cashCheck(computeControlTotals({ reconciliations: [r], bankAccounts: [] })).ties).toBe(true);
    const r2 = rec({ statement_balance: 1000, books_balance: 1000, unmatched_bank: [{ amount: 50 }] });
    expect(cashCheck(computeControlTotals({ reconciliations: [r2], bankAccounts: [] })).ties).toBe(false);
  });
});

describe("★ a month is reconciled when every active account's statements cover all of it", () => {
  const R = (account_id, period_start, period_end) => rec({ account_id, period_start, period_end, statement_balance: 10 });
  it("a mid-month statement doesn't cover two whole months", () => {
    const recs = [R("a", "2026-10-15", "2026-11-14")];
    expect(periodReconciledForAccounts(recs, "2026-10", ["a"])).toBe(false);
    expect(periodReconciledForAccounts(recs, "2026-11", ["a"])).toBe(false);
  });
  it("two statements that meet cover the month together", () => {
    const recs = [R("a", "2026-09-15", "2026-10-14"), R("a", "2026-10-15", "2026-11-14")];
    expect(periodReconciledForAccounts(recs, "2026-10", ["a"])).toBe(true);
  });
  it("a short statement inside a longer one doesn't pull the coverage back", () => {
    const recs = [R("a", "2026-10-01", "2026-10-20"), R("a", "2026-10-02", "2026-10-05"), R("a", "2026-10-21", "2026-10-31")];
    expect(periodReconciledForAccounts(recs, "2026-10", ["a"])).toBe(true);
  });
  it("a one-day gap is a gap", () => {
    const recs = [R("a", "2026-09-15", "2026-10-13"), R("a", "2026-10-15", "2026-11-14")];
    expect(periodReconciledForAccounts(recs, "2026-10", ["a"])).toBe(false);
  });
  it("checking reconciled doesn't stand for the card", () => {
    const recs = [R("chk", "2026-10-01", "2026-10-31")];
    expect(periodReconciledForAccounts(recs, "2026-10", ["chk"])).toBe(true);
    expect(periodReconciledForAccounts(recs, "2026-10", ["chk", "card"])).toBe(false);
    expect(periodReconciledForAccounts([...recs, R("card", "2026-10-01", "2026-10-31")], "2026-10", ["chk", "card"])).toBe(true);
  });
  it("an unfinished reconciliation counts for nothing; February's last day is its own", () => {
    expect(periodReconciledForAccounts([{ ...R("a", "2026-10-01", "2026-10-31"), status: "in_progress" }], "2026-10", ["a"])).toBe(false);
    expect(periodReconciledForAccounts([R("a", "2026-02-01", "2026-02-28")], "2026-02", ["a"])).toBe(true);
    expect(periodReconciledForAccounts([R("a", "2026-02-01", "2026-02-27")], "2026-02", ["a"])).toBe(false);
  });
});

describe("★ 'reviewed through' means every month up to it", () => {
  const s = (period, revoked_at = null) => ({ period, revoked_at });
  it("a gap stops the run", () => {
    expect(latestReviewedThrough([s("2026-01"), s("2026-03")])).toBe("2026-01");
    expect(latestReviewedThrough([s("2026-01"), s("2026-02"), s("2026-03")])).toBe("2026-03");
  });
  it("a reopened month stops it too; across a year end it carries", () => {
    expect(latestReviewedThrough([s("2026-01"), s("2026-02", "2026-04-01"), s("2026-03")])).toBe("2026-01");
    expect(latestReviewedThrough([s("2025-12"), s("2026-01")])).toBe("2026-01");
    expect(latestReviewedThrough([])).toBe(null);
  });
});

describe("★ what the gate didn't check", () => {
  const clean = { setupComplete: true, openingEntered: true, entriesInPeriodCount: 5, hasReconForPeriod: true };
  const reasons = (r) => r.blockers.map((b) => `${b.net}: ${b.reason}`);
  it("a clean month still signs", () => expect(signOffReadiness(clean).ok).toBe(true));
  it("a quiet month between busy ones signs — nothing booked, nothing to reconcile", () => {
    expect(signOffReadiness({ ...clean, entriesInPeriodCount: 0, hasReconForPeriod: false, activityAfterPeriod: true }).ok).toBe(true);
  });
  it("an empty month at the end isn't quiet — its statements just aren't in", () => {
    const r = signOffReadiness({ ...clean, entriesInPeriodCount: 0, hasReconForPeriod: false });
    expect(reasons(r)).toContain("readiness: no transactions are booked in this period yet — upload its statements first");
    expect(reasons(r).some((x) => /reconciled/.test(x))).toBe(true);
  });
  it("held documents, the month's bank-line exceptions, the month before, a month not over", () => {
    const r = signOffReadiness({ ...clean, heldCount: 2, exceptionsInPeriod: 1, previousUnsigned: "July 2026", periodNotOver: true });
    expect(r.ok).toBe(false);
    expect(reasons(r)).toEqual(expect.arrayContaining([
      "completeness: 2 documents are held out of the books (waiting on a decision) — decide them first",
      "bank_lines: 1 bank line in this month couldn't be added or matched — sort it out first",
      "readiness: July 2026 isn't signed off yet — months are signed in order, so the review covers everything before it",
      "readiness: this month isn't over yet — sign it off once it has ended and its statements are in",
    ]));
  });
  it("the owner reads each of them in plain words, none dropped", () => {
    const r = signOffReadiness({ ...clean, heldCount: 1, exceptionsInPeriod: 3, previousUnsigned: "July 2026", periodNotOver: true });
    const out = ownerSignOffBlockers(r.blockers, { periodLabel: "August 2026" });
    expect(out).toEqual(expect.arrayContaining([
      "1 document isn't in your books yet.",
      "3 bank lines in August 2026 couldn't be added or matched yet.",
      "Sign off July 2026 first — months are signed in order.",
      "August 2026 isn't over yet — sign it off once it has ended.",
    ]));
    expect(out.length).toBe(r.blockers.length);
    for (const s of out) expect([s, containsOwnerJargon(s)]).toEqual([s, false]);
    expect(ownerSignOffBlockers([{ net: "readiness", reason: "this month isn't over yet" }])[0]).toBe("This month isn't over yet — sign it off once it has ended.");
  });
});

describe("★ the app feeds the gate, and the screens say what was kept", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("every active account, the month's held items and exceptions, the order, the calendar", () => {
    expect(app).toMatch(/hasReconForPeriod: periodReconciledForAccounts\(reconciliations, period, accountsActiveIn\(period\)\),\s*\.\.\.signOffContext\(period\),/);
    expect(app).toMatch(/heldCount: \(intakeRows \|\| \[\]\)\.filter\(r => r && r\.status === INTAKE_STATUS\.HELD\)\.length/);
    expect(app).toMatch(/e\.kind === "line" && String\(e\.date \|\| ""\)\.slice\(0, 7\) === period/);
    expect(app).toMatch(/periodNotOver: String\(period\) >= nowMonth/);
    expect(app).toMatch(/computeControlTotals\(\{ invoices, reconciliations, intakeRows, codes: controlCodes, bankAccounts \}\)/);
  });
  it("the reviewed mark is a checked write, and a refused one is said", () => {
    expect(app).toMatch(/checkedRowUpdate\(\{ supabase, table: "journal_entries", id: txn\.db_entry_id, companyId: currentCompany\.id, patch: \{ ai_confidence: 100 \}, label: "reviewOverride" \}\)/);
    expect(app).toMatch(/if \(!bump\.ok\) return \{ ok: true, stillFlagged: true/);
    const rv = readFileSync("src/components/views/ReviewView.jsx", "utf8");
    expect((rv.match(/if \(r\.ok && r\.stillFlagged\)/g) || []).length).toBe(2);
    expect(rv).toMatch(/summary\.allClear && !waiting\.length \?/);
  });
});
