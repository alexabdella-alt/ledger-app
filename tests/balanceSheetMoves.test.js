import { describe, it, expect } from "vitest";
import { buildOwnerDrawEntry, buildOwnerContributionEntry, buildTransferEntry, buildLoanProceedsEntry, buildLoanPaymentEntry,
  planHeldLine, otherAccountsFor, ownerEquityAccount, loanAccount, heldLineOutcome } from "../src/lib/balanceSheetMoves";
import { fmtMoney } from "../src/lib/format";
import { glIsRevenue, glIsExpense } from "../src/lib/gl";

// C655 — the operator's treatments for money that is not profit or loss.
const lines = (e) => e.lines.map((l) => [l.code, l.debit, l.credit]);
const netIncomeMove = (e) => e.lines.reduce((t, l) => t + (glIsRevenue(l.code) ? l.credit - l.debit : glIsExpense(l.code) ? l.credit - l.debit : 0), 0);
const CHART = [
  { code: "1000", name: "Cash", system_role: "cash" }, { code: "2200", name: "Credit Card Liability", system_role: "credit_card_liability" },
  { code: "2600", name: "Notes Payable", system_role: "notes_payable" }, { code: "3200", name: "Additional Paid-In Capital", system_role: "additional_paid_in_capital" },
  { code: "3300", name: "Owner's Draw / Distributions", system_role: "owners_draw" }, { code: "8000", name: "Interest Expense", system_role: "interest_expense" },
];
const byRole = (r) => CHART.find((a) => a.system_role === r) || null;
const checking = { id: "K", name: "Checking", type: "checking", gl_code: "1000" };
const savings = { id: "S", name: "Savings", type: "savings", gl_code: "1010" };
const card = { id: "C", name: "Business card", type: "credit_card", gl_code: "2200" };
const BANKS = [checking, savings, card];

describe("★ the entries — exact debits and credits", () => {
  it("owner's draw: Dr Owner's Draw / Cr the bank", () => {
    expect(lines(buildOwnerDrawEntry({ amount: 500, date: "2026-03-01", bankCode: "1000", drawCode: "3300" }))).toEqual([["3300", 500, 0], ["1000", 0, 500]]);
  });
  it("owner's contribution: Dr the bank / Cr owner equity", () => {
    expect(lines(buildOwnerContributionEntry({ amount: 2000, bankCode: "1000", equityCode: "3500" }))).toEqual([["1000", 2000, 0], ["3500", 0, 2000]]);
  });
  it("transfer / card payoff: Dr where it went / Cr where it came from", () => {
    expect(lines(buildTransferEntry({ amount: 1240, fromCode: "1000", toCode: "2200" }))).toEqual([["2200", 1240, 0], ["1000", 0, 1240]]);
    expect(buildTransferEntry({ amount: 5, fromCode: "1000", toCode: "1000" }).balanced).toBe(false);
  });
  it("loan received: Dr the bank / Cr the loan", () => {
    expect(lines(buildLoanProceedsEntry({ amount: 10000, bankCode: "1000", loanCode: "2600" }))).toEqual([["1000", 10000, 0], ["2600", 0, 10000]]);
  });
  it("loan payment: Dr the loan (principal) + Dr Interest / Cr the bank", () => {
    expect(lines(buildLoanPaymentEntry({ amount: 850, interest: 62.4, bankCode: "1000", loanCode: "2600", interestCode: "8000" })))
      .toEqual([["2600", 787.6, 0], ["8000", 62.4, 0], ["1000", 0, 850]]);
  });
  it("interest above the payment, or negative, is refused", () => {
    expect(buildLoanPaymentEntry({ amount: 100, interest: 101, bankCode: "1000", loanCode: "2600", interestCode: "8000" }).balanced).toBe(false);
    expect(buildLoanPaymentEntry({ amount: 100, interest: -1, bankCode: "1000", loanCode: "2600", interestCode: "8000" }).balanced).toBe(false);
  });
  it("★ every entry balances, and only a loan payment's interest touches profit", () => {
    const es = [buildOwnerDrawEntry({ amount: 500, bankCode: "1000", drawCode: "3300" }), buildOwnerContributionEntry({ amount: 2000, bankCode: "1000", equityCode: "3500" }),
      buildTransferEntry({ amount: 1240, fromCode: "1000", toCode: "2200" }), buildLoanProceedsEntry({ amount: 10000, bankCode: "1000", loanCode: "2600" })];
    for (const e of es) { expect(e.balanced).toBe(true); expect(netIncomeMove(e)).toBe(0); expect(e.meta.payment_status).toBe("paid"); }
    expect(netIncomeMove(buildLoanPaymentEntry({ amount: 850, interest: 62.4, bankCode: "1000", loanCode: "2600", interestCode: "8000" }))).toBeCloseTo(-62.4);
  });
});

describe("which accounts", () => {
  it("a payoff from checking offers the cards; on the card's own statement, the accounts that could have paid it", () => {
    expect(otherAccountsFor("card", { lineAccount: checking, moneyIn: false, bankAccounts: BANKS }).map((b) => b.id)).toEqual(["C"]);
    expect(otherAccountsFor("card", { lineAccount: card, moneyIn: true, bankAccounts: BANKS }).map((b) => b.id)).toEqual(["K", "S"]);
  });
  it("a transfer offers the other non-card accounts", () => {
    expect(otherAccountsFor("transfer", { lineAccount: checking, bankAccounts: BANKS }).map((b) => b.id)).toEqual(["S"]);
  });
  it("★ owner money in: Paid-In Capital for a corporation; an owner-contributions account otherwise", () => {
    expect(ownerEquityAccount({ legalForm: "s_corp", chart: CHART, getAccountByRole: byRole })).toEqual({ code: "3200", name: "Additional Paid-In Capital", create: false });
    expect(ownerEquityAccount({ legalForm: "sole_prop", chart: CHART, getAccountByRole: byRole })).toEqual({ code: "3500", name: "Owner Contributions", create: true });
    expect(ownerEquityAccount({ legalForm: "", chart: [...CHART, { code: "3050", name: "Owner's Investment" }], getAccountByRole: byRole }).code).toBe("3050");
  });
  it("the loan account is the chart's own, by role", () => {
    expect(loanAccount({ chart: CHART, getAccountByRole: byRole }).code).toBe("2600");
    expect(loanAccount({ chart: [], getAccountByRole: () => null })).toEqual({ code: "2650", name: "Loans", create: true });
  });
});

describe("★ the plan for a held line", () => {
  const p = (x) => planHeldLine({ amount: 500, date: "2026-03-01", lineAccount: checking, bankAccounts: BANKS, chart: CHART, getAccountByRole: byRole, ...x });
  it("owner out → draw; owner in → contribution", () => {
    expect(lines(p({ kind: "owner", moneyIn: false }).entry)).toEqual([["3300", 500, 0], ["1000", 0, 500]]);
    expect(lines(p({ kind: "owner", moneyIn: true, legalForm: "c_corp" }).entry)).toEqual([["1000", 500, 0], ["3200", 0, 500]]);
  });
  it("one card on file → that card, no question", () => {
    expect(lines(p({ kind: "card", moneyIn: false }).entry)).toEqual([["2200", 500, 0], ["1000", 0, 500]]);
  });
  it("on the card's own statement: which account paid it — asked when there are several", () => {
    const q = planHeldLine({ kind: "card", moneyIn: true, amount: 500, lineAccount: card, bankAccounts: BANKS, chart: CHART, getAccountByRole: byRole });
    expect(q.needs).toBe("pick_account");
    const a = planHeldLine({ kind: "card", moneyIn: true, amount: 500, lineAccount: card, bankAccounts: BANKS, chart: CHART, getAccountByRole: byRole, otherAccountId: "K" });
    expect(lines(a.entry)).toEqual([["2200", 500, 0], ["1000", 0, 500]]);   // ★ the same entry the checking side would make
  });
  it("no card set up → asks the owner to add it", () => {
    expect(planHeldLine({ kind: "card", amount: 500, lineAccount: checking, bankAccounts: [checking], chart: CHART, getAccountByRole: byRole }).needs).toBe("add_card");
  });
  it("transfer in from savings: Dr checking / Cr savings", () => {
    expect(lines(p({ kind: "transfer", moneyIn: true }).entry)).toEqual([["1000", 500, 0], ["1010", 0, 500]]);
  });
  it("loan payment asks for the interest first; a bad figure is asked again", () => {
    expect(p({ kind: "loan", moneyIn: false }).needs).toBe("interest");
    expect(p({ kind: "loan", moneyIn: false, interest: 900 })).toMatchObject({ needs: "interest", invalid: true });
    expect(lines(p({ kind: "loan", moneyIn: false, interest: 20 }).entry)).toEqual([["2600", 480, 0], ["8000", 20, 0], ["1000", 0, 500]]);
  });
});

describe("what the owner is told, read from the entry", () => {
  const fmt = fmtMoney;
  it.each([
    [{ kind: "owner", moneyIn: false }, "owner_draw", "Recorded $500.00 as money you took out for yourself."],
    [{ kind: "card", moneyIn: false }, "card_payment", "Recorded $500.00 paid from Checking to Business card."],
    [{ kind: "transfer", moneyIn: true }, "transfer", "Recorded $500.00 moved from Savings to Checking."],
    [{ kind: "loan", moneyIn: true }, "loan_proceeds", "Recorded $500.00 as a loan the business owes."],
  ])("%o", (x, kind, text) => {
    const plan = planHeldLine({ amount: 500, lineAccount: checking, bankAccounts: BANKS, chart: CHART, getAccountByRole: byRole, ...x });
    expect(plan.entry.meta.kind).toBe(kind);
    expect(heldLineOutcome(plan.entry, plan.entry.meta.kind, fmt, plan)).toBe(text);
  });
  it("★ a loan payment names principal and interest by account — even when the interest is zero", () => {
    for (const [interest, text] of [[20, "$480.00 off the loan and $20.00 interest"], [0, "$500.00 off the loan and $0.00 interest"], [500, "$0.00 off the loan and $500.00 interest"]]) {
      const plan = planHeldLine({ kind: "loan", moneyIn: false, interest, amount: 500, lineAccount: checking, bankAccounts: BANKS, chart: CHART, getAccountByRole: byRole });
      expect(heldLineOutcome(plan.entry, "loan_payment", fmt, plan)).toContain(text);
    }
  });
});

import { findExistingMove } from "../src/lib/balanceSheetMoves";
describe("★ a move recorded from the other statement is not recorded twice", () => {
  const e = buildTransferEntry({ amount: 1240, date: "2026-03-16", fromCode: "1000", toCode: "2200" });
  const row = { id: "je9", db_entry_id: "je9", gl_code: "2200", secondary_gl_code: "1000", amount: 1240, date: "2026-03-15" };
  it("same two accounts, same amount, a day apart → that entry", () => expect(findExistingMove([row], e)).toBe("je9"));
  it("a different amount, a different account, too far apart, or removed → none", () => {
    expect(findExistingMove([{ ...row, amount: 1200 }], e)).toBe(null);
    expect(findExistingMove([{ ...row, gl_code: "6500" }], e)).toBe(null);
    expect(findExistingMove([{ ...row, date: "2026-03-01" }], e)).toBe(null);
    expect(findExistingMove([{ ...row, reversed_by: "x" }], e)).toBe(null);
  });
});
