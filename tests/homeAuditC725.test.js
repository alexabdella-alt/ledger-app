// C725 — the Home / notifications audit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { businessHealth, buildMonthlyReport, openReceivablesGL, owedAmount } from "../src/lib/reports.js";
import { dueSoonCopy, homeWaitingList } from "../src/lib/homeWaiting.js";

const je = (id, date, lines, extra = {}) => ({ id, entry_date: date, description: `Acme – ${id}`, status: "posted", deleted_at: null, source: "manual",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: { code: l.code, name: l.code } })), ...extra });
const NOW = new Date(2026, 10, 13);

describe("★ what's still owed, everywhere on Home", () => {
  const rows = flattenJournalEntries([
    je("i1", "2026-06-01", [{ code: "1200", debit: 10000 }, { code: "4000", credit: 10000 }], { due_date: "2026-07-01" }),
    je("k1", "2026-08-01", [{ code: "1000", debit: 9000 }, { code: "1200", credit: 9000 }], { import_metadata: { kind: "ar_collection", payment_for: "i1" } }),
  ]);
  it("a part-paid late invoice is late for what's left", () => {
    const late = openReceivablesGL(rows, "1200");
    expect(late.map(owedAmount)).toEqual([1000]);
    const h = businessHealth(rows, { cash: 9000, now: NOW });
    expect(h.headline).toMatch(/1 invoice is 60\+ days overdue \(\$1,000\.00\)/);
  });
  it("an invoice a payment settled is not overdue, whatever its flag", () => {
    const paid = flattenJournalEntries([
      je("i1", "2026-06-01", [{ code: "1200", debit: 500 }, { code: "4000", credit: 500 }], { due_date: "2026-07-01" }),
      je("k1", "2026-08-01", [{ code: "1000", debit: 500 }, { code: "1200", credit: 500 }], { import_metadata: { kind: "ar_collection", payment_for: "i1" } }),
    ]);
    expect(businessHealth(paid, { cash: 500, now: NOW }).concerns.some((c) => c.key === "ar")).toBe(false);
  });
  it("bills due soon: what's left on each", () => {
    expect(dueSoonCopy({ n: 1, total: 400, next: { vendor: "Rent", amount: 1000, _paid: 600, due_date: "2026-11-16" } })).toMatch(/Rent, \$400\.00, due/);
  });
  it("Home's list totals what's left", () => {
    const items = homeWaitingList({ dueSoonBills: [{ vendor: "Rent", amount: 1000, _paid: 600, due_date: "2026-11-16" }] });
    expect(items.find((i) => i.id === "bills_due_soon").text).toMatch(/\(\$400\.00\)/);
  });
  it("the Home screen reads them that way", () => {
    const d = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(d).toMatch(/const amount = owedAmount\(i\);/);
    expect(d).toMatch(/const overdueTotal = overdueBills\.reduce\(\(t, i\) => t \+ owedAmount\(i\), 0\);/);
  });
});

describe("★ cash below zero is said as what it is", () => {
  const profitable = flattenJournalEntries([je("s", "2026-03-01", [{ code: "1000", debit: 20000 }, { code: "4000", credit: 20000 }]), je("x", "2026-04-01", [{ code: "6100", debit: 9000 }, { code: "1000", credit: 9000 }])]);
  it("never 'covers about -3 months … Everything looks healthy'", () => {
    const h = businessHealth(profitable, { cash: -9000, now: NOW });
    expect(h.headline).not.toMatch(/-\d+ months|Everything looks healthy/);
    expect(h.concerns.some((c) => c.key === "cash" && /less than nothing in cash/.test(c.text))).toBe(true);
    expect(h.facts.find((f) => f.key === "runway").value).toBe("—");
  });
  it("under a month is said in words", () => {
    const h = businessHealth(profitable, { cash: 100, now: NOW });
    expect(h.headline).not.toMatch(/about 0 months/);
  });
});

describe("★ the monthly report's summary", () => {
  it("no runway alarm on a profitable month; 'the same' when unchanged; owner words", () => {
    const rows = flattenJournalEntries([
      je("a", "2026-09-10", [{ code: "1000", debit: 1000 }, { code: "4000", credit: 1000 }]),
      je("b", "2026-10-10", [{ code: "1000", debit: 1000 }, { code: "4000", credit: 1000 }]),
    ]);
    const r = buildMonthlyReport("2026-10", { invoices: rows, cashBalance: 10 });
    expect(r.summary).toMatch(/in sales against/);
    expect(r.summary).toMatch(/That's the same as the month before\./);
    expect(r.summary).not.toMatch(/runway|burn rate|revenue|receivables/i);
  });
  it("a profitable month with little cash gets no cash warning", () => {
    const rows = flattenJournalEntries([
      je("a", "2026-10-10", [{ code: "1000", debit: 1000 }, { code: "4000", credit: 1000 }]),
      je("b", "2026-10-12", [{ code: "6100", debit: 500 }, { code: "1000", credit: 500 }]),
    ]);
    const r = buildMonthlyReport("2026-10", { invoices: rows, cashBalance: 10 });
    expect(r.summary).toMatch(/a profit of \$500\.00/);
    expect(r.summary).not.toMatch(/worth keeping an eye on/);
  });
});

describe("★ notifications and the trust panel", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("a changed alert is unread again; each producer has its own type; a resolved one is taken down", () => {
    expect(app).toMatch(/const patch = \{ title, description, link_view, \.\.\.\(fresh \? \{ read: false, created_at: new Date\(\)\.toISOString\(\) \} : \{\}\) \};/);
    for (const t of ["tax_deadline", "bank_match_overdue", "input_needed"]) expect(app).toMatch(new RegExp(`\\} else clearNotificationType\\("${t}"\\);`));
    expect(app).toMatch(/clearNotificationType\("anomaly"\)/);
    expect(app).not.toMatch(/due in \$\{nextDue\.days\} day\$\{nextDue\.days === 1 \? "" : "s"\}\$\{amt\}`, description/);
  });
  it("a solo owner isn't told an accountant is looking", () => {
    expect(readFileSync("src/lib/ownerTrust.js", "utf8")).toMatch(/hasAttester === false \? "ask the assistant about it, or invite your accountant\." : "your accountant is taking a look\."/);
  });
});
