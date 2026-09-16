import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { flaggedForReview, reviewSummary } from "../src/lib/confidenceFlag.js";

// C518 — review flags were judged per flattened row: a multi-line bill at low confidence was
// flagged once per line above materiality, and not at all when its lines each fell under it.
const chart = [{ code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" }, { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" }];
const acct = (code) => ({ code, name: chart.find((a) => a.code === code)?.name });
const je = (id, lines, conf) => ({ id, entry_date: "2026-09-03", description: `${id} – Sysco`, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid", ai_confidence: conf,
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })) });

describe("C518", () => {
  it("a $3,000 two-line bill at 62% is ONE flag for $3,000; an $1,800 bill split 900/900 IS flagged; a $520 one is not", () => {
    const rows = flattenJournalEntries([
      je("big", [{ code: "5010", debit: 1500 }, { code: "5030", debit: 1500 }, { code: "2000", credit: 3000 }], 62),
      je("mid", [{ code: "5010", debit: 900 }, { code: "5030", debit: 900 }, { code: "2000", credit: 1800 }], 62),
      je("small", [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }], 62),
    ], chart);
    const flags = flaggedForReview(rows);
    expect(flags.map((f) => [String(f.db_entry_id), f.amount])).toEqual([["big", 3000], ["mid", 1800]]);
    expect(reviewSummary(rows).count).toBe(2);
  });
  it("demonstrated: judged per row, the same books gave two flags for one bill and none for the other", () => {
    const rows = flattenJournalEntries([
      je("big", [{ code: "5010", debit: 1500 }, { code: "5030", debit: 1500 }, { code: "2000", credit: 3000 }], 62),
      je("mid", [{ code: "5010", debit: 900 }, { code: "5030", debit: 900 }, { code: "2000", credit: 1800 }], 62),
    ], chart);
    const perRow = rows.filter((r) => Number(r.amount) >= 1000 && r.confidence < 75 && r.gl_code !== "2000");
    expect(perRow.map((r) => r.id)).toEqual(["big_0", "big_1"]);
  });
});
