// C708 — fixes from the new-owner first-run audit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { statementOpeningOffer } from "../src/lib/openingBalanceProposal.js";
import { looksLikeCardStatementFile, cardStatementQuestion, dropZoneOutcomeCopy } from "../src/lib/statementLifecycle.js";
import { homeWaitingList } from "../src/lib/homeWaiting.js";
import { getTaxDeadlines } from "../src/lib/tax.js";
import { PRE_CUTOFF_MESSAGE } from "../src/lib/openingBalances.js";

const app = readFileSync("src/App.jsx", "utf8");
describe("C708 — the starting balance the checklist promised", () => {
  const banks = [{ id: "b1", name: "Chase Checking", gl_code: "1000" }];
  it("the earliest saved statement with an opening figure and a known account", () => {
    const st = [{ id: "s2", bank_account_id: "b1", period_start: "2026-03-01", stated_opening_balance: 900, stated_ending_balance: 1200, status: "parsed" },
                { id: "s1", bank_account_id: "b1", period_start: "2026-02-01", stated_opening_balance: 500, stated_ending_balance: 900, status: "reconciled" },
                { id: "s0", bank_account_id: "b1", period_start: "2026-01-01", stated_opening_balance: 10, status: "superseded" }];
    expect(statementOpeningOffer({ statements: st, bankAccounts: banks })).toEqual({ openingBalance: 500, endingBalance: 900, periodStart: "2026-02-01", accountCode: "1000", accountId: "b1", accountName: "Chase Checking" });
  });
  it("nothing usable → no offer", () => {
    expect(statementOpeningOffer({ statements: [{ bank_account_id: "zz", period_start: "2026-01-01", stated_opening_balance: 5 }], bankAccounts: banks })).toBe(null);
    expect(statementOpeningOffer({ statements: [{ bank_account_id: "b1", period_start: "2026-01-01", stated_opening_balance: null }], bankAccounts: banks })).toBe(null);
  });
  it("the starting-balances screen offers it; confirming moves a hand-picked start date to the statement's", () => {
    const v = readFileSync("src/components/views/OpeningBalancesView.jsx", "utf8");
    expect(v).toMatch(/data-opening-offer/);
    expect(v).toMatch(/\.from\("bank_statements"\)\.select\("id, bank_account_id, period_start, stated_opening_balance, stated_ending_balance, status"\)/);
    expect(app).toMatch(/if \(!cutoffDate \|\| String\(cutoffDate\) !== String\(p\.periodStart\)\) \{ const okc = await saveCutoffDate\(p\.periodStart\);/);
  });
  it("no 'cutoff' in what an owner reads", () => {
    expect(PRE_CUTOFF_MESSAGE).not.toMatch(/cutoff/i);
    expect(app).not.toMatch(/Set your cutoff \(Day One\) date first/);
    expect(app).not.toMatch(/dated before your cutoff \(\$\{cutoff\}\)/);
  });
});

describe("C708 — a card statement isn't filed into checking without asking", () => {
  it("file names that read as a card statement", () => {
    for (const n of ["Amex_Statement_Jan.pdf", "chase-visa-2026-02.csv", "Credit Card Statement.pdf", "capital_one_venture.pdf"]) expect(looksLikeCardStatementFile(n)).toBe(true);
    for (const n of ["Chase_Checking_Jan.pdf", "statement-2026-01.csv", "BofA business.pdf"]) expect(looksLikeCardStatementFile(n)).toBe(false);
  });
  it("Home asks, with the bank account as an explicit choice", () => {
    const q = [{ id: "u1", name: "amex.pdf", status: "done", result: { to: "choose", cardHint: true, accounts: [{ id: "b1", label: "It's from Chase Checking" }] } }];
    const item = homeWaitingList({ uploadQueue: q }).find((i) => i.id === "statement_account:u1");
    expect(item.text).toBe(cardStatementQuestion("amex.pdf"));
    expect(item.text).toMatch(/looks like a credit card statement/);
    expect(app).toMatch(/const cardHint = !!soleAccount && soleAccount\.type !== "credit_card" && looksLikeCardStatementFile\(file\?\.name\)/);
    expect(app).toMatch(/if \(soleAccount && !cardHint\) \{/);
  });
});

describe("C708 — smaller first-run fixes", () => {
  it("the upload step ticks when an upload finishes", () => {
    expect(app).toMatch(/if \(patch && patch\.status === "done"\) setOnboardingUploadDone\(true\);/);
  });
  it("an owner with no accountant is sent to Home's questions, not to an invite", () => {
    expect(dropZoneOutcomeCopy({ total: 5, booked: 3, exceptions: 2, hasAccountant: false })).toMatch(/They're at the top of Home/);
  });
  it("the business profile is shown only after it saved", () => {
    const fn = app.slice(app.indexOf("const saveBusinessProfile = async"), app.indexOf("const saveBusinessProfile = async") + 1600);
    expect(fn.indexOf("setCompanySettings(prev => ({ ...prev, businessType, fiscalYearEnd }));")).toBeGreaterThan(fn.indexOf("Couldn't save your business details"));
  });
  it("the January deadline names its year", () => {
    const q4 = getTaxDeadlines(new Date(2026, 10, 13)).find((d) => d.m === 0 && d.est);
    expect(q4.plain).toBe("Pay your 4th-quarter estimated taxes for 2026");
  });
  it("a disabled Continue looks disabled", () => {
    const f = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(f).not.toMatch(/\? "var\(--sc-gold\)" : "var\(--sc-gold\)"/);
  });
});
