import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { computeExpenses, glAccountBalance, trialBalance } from "../src/lib/reports.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";

// ═════════════════════════════════════════════════════════════════════════════
// C547 — A LINE WHOSE ACCOUNT WE CANNOT READ USED TO BORROW THE OTHER LEG'S, AND THE MONEY
// LEFT THE BOOKS IN COMPLETE SILENCE. Found while explaining O139 (a line pointing at another
// company's account — the account row is then RLS-invisible, so the join returns nothing).
// The flatten read `primaryCode || offsetLine?.accounts?.code`, so the row became the OFFSET's
// account and BOTH legs read the same code — cancelling each other. Measured on an $800 bill:
// expenses lost the $800, payables lost the $800 it really did owe (read $500, not $1,300),
// and `trial_balance` reported "balanced, difference $0.00".
//
// ★★★ AND THE BORROW WAS WHAT HID IT FROM EVERY CHECK — measured, not assumed. With the
// fabricated code gone the TRIAL BALANCE catches the imbalance on its own ($500 against
// $1,300), which it could not do while the row cancelled itself out. So the fix restores an
// existing guard as well as adding one. The new check earns its place by saying WHICH line
// and WHY: "1 transaction with no readable category" is actionable where "the books don't
// add up" is a hunt.
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" },
  { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
];
const acct = (c) => ({ code: c, name: chart.find((a) => a.code === c)?.name });
const je = (id, description, lines) => ({
  id, entry_date: "2026-09-02", description, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: l.code === null ? null : acct(l.code) })),
});
const good = je("ok", "Sysco – food", [{ code: "5010", debit: 500 }, { code: "2000", credit: 500 }]);
// The expense line's account cannot be read — the O139 shape, and equally a deleted account.
const blind = je("bad", "Apex – service", [{ code: null, debit: 800 }, { code: "2000", credit: 800 }]);
const codes = { ar: "1100", ap: "2000", salesTax: "2350" };
const totals = (rows) => computeControlTotals({ invoices: rows, reconciliations: [], intakeRows: [], codes });

describe("C547 — the unreadable line", () => {
  const rows = flattenJournalEntries([good, blind], chart);

  it("does NOT borrow the other leg's account, and is marked", () => {
    const bad = rows.find((r) => r.db_entry_id === "bad");
    expect(bad.gl_code).toBeNull();                 // not "2000" — we don't invent a category
    expect(bad.account_unresolved).toBe(true);
    expect(rows.find((r) => r.db_entry_id === "ok").account_unresolved).toBeUndefined();
  });

  it("so the OTHER leg's real balance survives — payables read $1,300, not $500", () => {
    expect(glAccountBalance("2000", rows)).toBe(1300);
    expect(glAccountBalance("5010", rows)).toBe(500);
    expect(computeExpenses(rows)).toBe(500);        // the $800 still isn't an expense — we can't say what it is
  });

  it("★★ IT IS NOW AUDIBLE TWICE: the new check names it, and the trial balance can see it again", () => {
    const c = totals(rows).checks.find((x) => x.key === "lines_have_a_category");
    expect(c.ties).toBe(false);
    expect(c.b).toBe(1);
    expect(c.severity).toBe("high");                // a figure nobody can explain blocks a clean sign-off
    // ★ THE BORROW IS WHAT SILENCED THE TRIAL BALANCE. Reproduce it — give the unreadable line
    // the offset's code, exactly as the old flatten did — and the books read perfectly balanced
    // with $800 missing from every total. That is the state this fix ends.
    const asBefore = rows.map((r) => (r.account_unresolved ? { ...r, gl_code: r.secondary_gl_code } : r));
    expect(trialBalance(asBefore).balanced).toBe(true);
    expect(trialBalance(asBefore).difference).toBe(0);
    expect(computeExpenses(asBefore)).toBe(500);                       // the $800 simply gone…
    expect(glAccountBalance("2000", asBefore)).toBe(500);              // …and it took the real A/P with it
    // and now
    expect(trialBalance(rows).balanced).toBe(false);
  });

  it("and it stays silent on books where every line reads — never a check that always fires", () => {
    const clean = flattenJournalEntries([good], chart);
    const c = totals(clean).checks.find((x) => x.key === "lines_have_a_category");
    expect(c.ties).toBe(true);
    expect(c.b).toBe(0);
  });

  it("a multi-line entry marks only the line that cannot be read", () => {
    const mixed = flattenJournalEntries([je("mix", "Sysco – split", [
      { code: "5010", debit: 500 }, { code: null, debit: 20 }, { code: "2000", credit: 520 },
    ])], chart);
    expect(mixed.filter((r) => r.account_unresolved).map((r) => r.amount)).toEqual([20]);
    expect(mixed.find((r) => r.gl_code === "5010").account_unresolved).toBeUndefined();
    expect(totals(mixed).checks.find((x) => x.key === "lines_have_a_category").b).toBe(1);
  });
});
