import { describe, it, expect } from "vitest";
import { computeKPIs } from "../src/lib/reports.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// ═════════════════════════════════════════════════════════════════════════════
// C496 — THE KPI STRIP'S "WHAT CUSTOMERS OWE" AND "WHAT'S DUE" WERE FLAG SUMS. `arOut` was
// Σ amount over the `payment_status` list — the ex-tax revenue figure, not the receivable
// (C454), decided by a flag (C452) — while the aging report beside it read the GL. With the
// company's codes the strip reads the same A/R and A/P balances as everything else.
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })), ...extra });
const NOW = new Date("2026-09-15T12:00:00");
const ledger = flattenJournalEntries([
  // a taxed sale on terms: the customer owes 1,299, revenue is 1,200
  je("s1", "2026-09-02", "Acme – catering", [{ code: "1100", name: "Accounts Receivable", debit: 1299 }, { code: "4000", name: "Sales", credit: 1200 }, { code: "2350", name: "Sales Tax Payable", credit: 99 }]),
  // a card sale: no receivable, no flag — the C452 shape
  je("s2", "2026-09-03", "Walk-in", [{ code: "1000", name: "Cash", debit: 400 }, { code: "4000", name: "Sales", credit: 400 }], { payment_status: null }),
  // a bill on terms and a bill paid at the till
  je("b1", "2026-09-04", "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 500 }, { code: "2000", name: "Accounts Payable", credit: 500 }]),
  je("b2", "2026-09-05", "Roma – cheese", [{ code: "5010", name: "Food Cost", debit: 120 }, { code: "1000", name: "Cash", credit: 120 }], { payment_status: "paid" }),
]);

describe("C496 · KPI strip reads the GL", () => {
  it("with codes, what customers owe is the A/R balance — the taxed receivable, and the card sale is not owed", () => {
    const k = computeKPIs(ledger, { cashBalance: 1000, now: NOW, arCode: "1100", apCode: "2000" }).find((x) => x.key === "current_ratio");
    // (cash 1000 + AR 1299) / AP 500
    expect(k.value).toBe(4.6);
    expect(k.explanation).toContain("$2,299.00");
    expect(k.explanation).toContain("$500.00");
  });
  it("without codes the fallback still counts the receivable INCLUDING its tax, never the ex-tax revenue", () => {
    const k = computeKPIs(ledger, { cashBalance: 1000, now: NOW }).find((x) => x.key === "current_ratio");
    expect(k.explanation).not.toContain("$2,200.00");
  });
  it("DSO reads the same receivable", () => {
    const k = computeKPIs(ledger, { cashBalance: 0, now: NOW, arCode: "1100", apCode: "2000" }).find((x) => x.key === "dso");
    // AR 1299 / revenue 1600 × 30 ≈ 24
    expect(k.value).toBe(24);
  });
});
