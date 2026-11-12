import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { signedPL, glAccountBalance, owedAmount, openPayablesGL } from "../src/lib/reports";
import { flattenJournalEntries } from "../src/lib/ledger";

// C614 — review finding R3: Home's "You owe" / "Owed to you" drills totalled differently
// from the tiles that open them.
const acct = { rep: { id: "r", code: "6250", name: "Repairs" }, ap: { id: "ap", code: "2000", name: "A/P" },
  ar: { id: "ar", code: "1100", name: "A/R" }, rev: { id: "v", code: "4100", name: "Services" }, tax: { id: "t", code: "2350", name: "Sales Tax" } };
const je = (id, lines) => ({ id, entry_date: "2026-03-10", description: "Harbor Cafe", status: "posted", source: "manual",
  journal_entry_lines: lines.map(([a, debit, credit], i) => ({ id: `${id}-${i}`, account_id: acct[a].id, debit, credit, accounts: acct[a] })) });

describe("the numbers the drill used to show", () => {
  const rows = flattenJournalEntries([je("b1", [["rep", 4306, 0], ["ap", 0, 4306]]), je("i1", [["ar", 1086.25, 0], ["rev", 0, 1000], ["tax", 0, 86.25]])]);
  it("★ a MULTI-LINE bill, listed by its bills-to-pay line, summed NEGATIVE by its income/expense sign", () => {
    // A simple two-line bill summed correctly; this is the shape that didn't.
    const A = { f: { id: "f", code: "5000", name: "Food" }, s: { id: "s", code: "6600", name: "Supplies" }, ap: acct.ap };
    const multi = flattenJournalEntries([{ id: "b2", entry_date: "2026-03-10", description: "Roma", status: "posted", source: "manual",
      journal_entry_lines: [["f", 300, 0], ["s", 220, 0], ["ap", 0, 520]].map(([a, d, c], i) => ({ id: `l${i}`, account_id: A[a].id, debit: d, credit: c, accounts: A[a] })) }]);
    const listed = openPayablesGL(multi, "2000");
    expect(listed.map((r) => r.amount)).toEqual([520]);
    expect(listed.reduce((s, r) => s + signedPL(r), 0)).toBe(-520);   // what the headline used to print
    expect(glAccountBalance("2000", multi)).toBe(520);                  // what the tile prints
  });
  it("★ a taxed invoice's owed amount includes its tax", () => {
    expect(glAccountBalance("1100", rows)).toBe(1086.25);
    const rev = rows.find((r) => r.ar_amount != null);
    if (rev) expect(owedAmount(rev)).toBe(1086.25);
  });
});

describe("the drill now reads what the tile reads", () => {
  const v = readFileSync("src/components/views/DashboardView.jsx", "utf8");
  it("★ both headlines use the books' balance, never a signed sum of rows", () => {
    expect(v).toMatch(/subtitle = `\$\{openAP\.length\} unpaid · \$\{fmt\(apCodeD \? glAccountBalance\(apCodeD, invoices\) :/);
    expect(v).toMatch(/subtitle = `\$\{openAR\.length\} uncollected · \$\{fmt\(arCodeD \? glAccountBalance\(arCodeD, invoices\) :/);
    expect(v).not.toMatch(/openAP\.reduce\(\(s,i\)=>s\+signedPL\(i\),0\)/);
    expect(v).not.toMatch(/openAR\.reduce\(\(s,i\)=>s\+signedPL\(i\),0\)/);
  });
  it("invoice rows show the amount owed including tax", () => {
    expect(v).toMatch(/body = txnRows\(openAR, "var\(--sc-success\)", owedAmount\);/);
    expect(v).toMatch(/\{fmt\(amountOf\(inv\)\)\}<\/span>/);
  });
});
