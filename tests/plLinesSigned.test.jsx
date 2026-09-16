import { describe, it, expect } from "vitest";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// ═════════════════════════════════════════════════════════════════════════════
// C490 — THE P&L'S CATEGORY LINES SUMMED `amount` UNSIGNED WHILE ITS HEADLINE WAS SIGNED. A
// $500 bill and its $500 correction read as $1,000 of Food Cost on a report whose total
// said $0 — the lines did not add up to their own headline. Rendered through the real
// flatten so the sign comes from the leg, as in production.
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })), ...extra });
const rows = flattenJournalEntries([
  je("b1", "2026-09-02", "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 500 }, { code: "2000", name: "Accounts Payable", credit: 500 }]),
  je("r1", "2026-09-03", "REVERSAL: Sysco – produce", [{ code: "2000", name: "Accounts Payable", debit: 500 }, { code: "5010", name: "Food Cost", credit: 500 }], { import_metadata: { kind: "reversal", reverses: "b1" } }),
  je("b2", "2026-09-04", "Roma – cheese", [{ code: "5010", name: "Food Cost", debit: 120 }, { code: "2000", name: "Accounts Payable", credit: 120 }]),
  je("s1", "2026-09-05", "Acme – catering", [{ code: "1100", name: "Accounts Receivable", debit: 900 }, { code: "4000", name: "Sales", credit: 900 }]),
  je("s2", "2026-09-06", "REVERSAL: Acme – catering", [{ code: "4000", name: "Sales", debit: 900 }, { code: "1100", name: "Accounts Receivable", credit: 900 }], { import_metadata: { kind: "reversal", reverses: "s1" } }),
]);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C490", () => {
  const base = { ...POPULATED, invoices: rows, companyDataLoaded: true, signoffsLoadOk: true, reportRange: "custom", reportDateFrom: "2026-09-01", reportDateTo: "2026-09-30", basisMode: "accrual" };
  it("the Food Cost line nets the correction — $120, not $1,120", () => {
    const t = text(renderViewHtml(ReportsView, { ...base, reportType: "pl" }));
    expect(t).toContain("$120.00");
    expect(t).not.toContain("$1,120.00");
    expect(t).not.toContain("$1,800.00");   // the reversed sale and its reversal do not add to $1,800 of revenue
  });
  it("the By Project lines net the same way", () => {
    const t = text(renderViewHtml(ReportsView, { ...base, reportType: "project" }));
    expect(t).not.toContain("$1,120.00");
    expect(t).toContain("$120.00");
  });
});
