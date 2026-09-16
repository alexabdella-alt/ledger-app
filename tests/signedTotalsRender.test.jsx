import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";
import { flattenJournalEntries } from "../src/lib/ledger.js";

// ═════════════════════════════════════════════════════════════════════════════
// C494 — A LEG-SIGNED TOTAL WAS RENDERED THROUGH THE MAGNITUDE FORMATTER. `fmtMoney` drops
// the sign by design (tables that colour by direction); C489–C491 made every total signed
// and left them on `fmt`, so a category holding only a correction this period — the bill it
// corrects booked last period — nets −$500 and printed "$500.00", in the same red as a
// charge. The sign was hidden exactly where the fix had just put it.
// ═════════════════════════════════════════════════════════════════════════════
const acct = (code, name) => ({ code, name });
const je = (id, date, description, lines, extra = {}) => ({ id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code, l.name) })), ...extra });
const rows = flattenJournalEntries([
  je("b1", "2026-08-28", "Sysco – produce", [{ code: "5010", name: "Food Cost", debit: 500 }, { code: "2000", name: "Accounts Payable", credit: 500 }]),
  je("r1", "2026-09-03", "REVERSAL: Sysco – produce", [{ code: "2000", name: "Accounts Payable", debit: 500 }, { code: "5010", name: "Food Cost", credit: 500 }], { import_metadata: { kind: "reversal", reverses: "b1" } }),
  je("b2", "2026-09-04", "Roma – cheese", [{ code: "5020", name: "Beverage Cost", debit: 120 }, { code: "2000", name: "Accounts Payable", credit: 120 }]),
]);
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C494", () => {
  const base = { ...POPULATED, invoices: rows, companyDataLoaded: true, signoffsLoadOk: true, reportRange: "custom", reportDateFrom: "2026-09-01", reportDateTo: "2026-09-30", basisMode: "accrual" };
  it("a category whose only movement this period is a correction shows a negative, not a positive charge", () => {
    const t = text(renderViewHtml(ReportsView, { ...base, reportType: "pl" }));
    expect(t).toContain("-$500.00");
    expect(t).toContain("$120.00");
  });
  it("every view that renders a leg-signed total aliases fmt to the signed formatter", () => {
    for (const f of ["DashboardView", "ReportsView", "VendorsView", "CustomersView", "ApView"]) {
      const src = fs.readFileSync(`src/components/views/${f}.jsx`, "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
      expect(src, f).toMatch(/\n\s*const fmt = fmtSignedMoney;/);
      expect(src, f).not.toMatch(/const fmt = fmtMoney;/);
    }
  });
});
