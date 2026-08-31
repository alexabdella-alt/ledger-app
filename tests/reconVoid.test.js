import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { flattenJournalEntries } from "../src/lib/ledger";
import { computeNetIncome, glAccountBalance, trialBalance } from "../src/lib/reports";

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

describe("★★★ removing an entry during reconciliation reaches the database", () => {
  const view = strip(readFileSync("src/components/views/ReconView.jsx", "utf8"));
  const fn = view.slice(view.indexOf("const voidBook ="), view.indexOf("const addToBooks"));

  it("★★★ it goes through the canonical removal path, not local state", () => {
    // It used to set `status:"voided"` with setInvoices ONLY, write an audit row saying the
    // entry was voided, and never touch the database — so the entry came back on the next
    // reload and the reconciliation was computed against books that did not match storage.
    expect(fn).toMatch(/await removeEntry\(b\)/);
    expect(fn).not.toMatch(/setInvoices/);
    expect(fn).not.toMatch(/status:\s*"voided"/);
  });

  it("★★ and it does not claim success on a write that did not land", () => {
    expect(fn).toMatch(/if \(!r \|\| !r\.ok\)/);
    expect(fn).toMatch(/still in your books/);
  });

  it("★ the delete-vs-reversal decision is not this screen's to make", () => {
    // removalPlanFor picks a soft delete or a dated correction depending on whether the month
    // has been signed off — the guard that keeps a signed month from being quietly rewritten.
    expect(fn).toMatch(/removalPlanFor/);
  });

  it("★ and the audit row is no longer written by this screen at all", () => {
    // It used to log `invoice_voided` regardless of outcome. removeEntry owns the audit now,
    // so the trail can only record a removal that actually happened.
    expect(fn).not.toMatch(/logAudit/);
  });
});

describe("★★ a voided entry is excluded from every derivation", () => {
  const entry = (status) => ({
    id: "v1", company_id: "c", entry_date: "2026-03-01", description: "V – x",
    source: "manual", status, deleted_at: null,
    journal_entry_lines: [
      { id: "v1_0", account_id: "a", debit: 100, credit: 0, accounts: { code: "6100", name: "x" } },
      { id: "v1_1", account_id: "b", debit: 0, credit: 100, accounts: { code: "1000", name: "c" } },
    ],
  });

  it("★★★ flatten carries the entry's REAL status — it used to hardcode 'booked'", () => {
    // `deleted_at` was carried; `status` was not, so a database-level voided entry was
    // invisible to every filter. A filter is only as good as the field reaching it.
    expect(flattenJournalEntries([entry("voided")])[0].status).toBe("voided");
    expect(flattenJournalEntries([entry("posted")])[0].status).toBe("booked");
  });

  it("★ net income, GL balances and the trial balance all exclude it", () => {
    const v = flattenJournalEntries([entry("voided")]);
    expect(computeNetIncome(v)).toBe(0);
    expect(glAccountBalance("6100", v)).toBe(0);
    expect(trialBalance(v).accounts.length).toBe(0);
  });

  it("★ and a live entry is still counted — without this, 'excluded' is satisfied by excluding everything", () => {
    const live = flattenJournalEntries([entry("posted")]);
    expect(computeNetIncome(live)).toBe(-100);
    expect(glAccountBalance("6100", live)).toBe(100);
    expect(trialBalance(live).accounts.length).toBe(2);
  });
});
