// C719 — a part-payment entered by hand, on Money owed to you and on Bills to pay.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ArView from "../src/components/views/ArView.jsx";
import CustomersView from "../src/components/views/CustomersView.jsx";

const chart = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" }, { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "4000", name: "Sales", category: "Revenue" },
];
const acct = (code) => ({ code, name: chart.find(a => a.code === code)?.name });
const je = (id, date, lines, extra = {}) => ({ id, entry_date: date, description: `Acme – ${id}`, status: "posted", deleted_at: null, source: "ar_invoice",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-l${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra });
const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("★ Money owed to you", () => {
  const rows = flattenJournalEntries([
    je("inv1", "2026-10-01", [{ code: "1100", debit: 1000 }, { code: "4000", credit: 1000 }], { due_date: "2026-12-31" }),
    je("col1", "2026-10-20", [{ code: "1000", debit: 400 }, { code: "1100", credit: 400 }], { import_metadata: { kind: "ar_collection", payment_for: "inv1" } }),
  ], chart);
  const html = renderViewHtml(ArView, { ...POPULATED, invoices: rows, arView: "inbox", companyDataLoaded: true, isViewer: false, getAccountByRole: (r) => chart.find(a => a.system_role === r) || null });
  it("a part-paid invoice shows what's left, and the box offers all of it by default", () => {
    expect(text(html)).toMatch(/OWED TO YOU\s*\$600\.00/);
    expect(html).toMatch(/data-amount-received[^>]*placeholder="All \$600\.00"/);
    expect(text(html)).toMatch(/\$600\.00 \$400\.00 received of \$1,000\.00/);
  });
  it("the Customers page owes what's left too (the payments aren't among the customer's own rows)", () => {
    const t = text(renderViewHtml(CustomersView, { ...POPULATED, invoices: rows, contacts: [], companyDataLoaded: true, getAccountByRole: (r) => chart.find(a => a.system_role === r) || null }));
    expect(t).toMatch(/\$600\.00/);
    expect(t).not.toMatch(/owed[^$]{0,40}\$1,000\.00/i);
  });
  it("the box records what came in; blank is all of it; nothing else is accepted", () => {
    const v = readFileSync("src/components/views/ArView.jsx", "utf8");
    expect(v).toMatch(/const amount = typed === "" \? null : Number\(typed\);\s*if \(amount != null && !\(amount > 0\)\)/);
    expect(v).toMatch(/\.\.\.\(amount != null \? \{ amount \} : \{\}\) \}\);/);
    expect(v).toMatch(/Recorded \$\{fmtMoney\(ok\.amount\)\} received — \$\{fmtMoney\(ok\.left\)\} still owed ✓/);
  });
});

describe("★ Bills to pay", () => {
  it("the pay form has the amount, and one bill's part is recorded and said", () => {
    const ap = readFileSync("src/components/views/ApView.jsx", "utf8");
    expect(ap).toMatch(/data-amount-paid[\s\S]{0,200}placeholder=\{`All \$\{fmt\(owedAmount\(inv\)\)\}`\}/);
    expect(ap).toMatch(/payFrom: payFromByKey\(payFromOpts, payFromKey\), \.\.\.\(amount != null \? \{ amount \} : \{\}\) \}\)/);
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/\.\.\.\(ids\.length === 1 && details\.amount != null \? \{ amount: details\.amount \} : \{\}\) \}\);/);
    expect(app).toMatch(/else if \(ok && ok\.partial\) \{[^\n]*still owed on this bill ✓`\); return 1; \}/);
  });
});
