import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { resolveActionTargets, describeDestructiveAction } from "../src/lib/aiActionGate.js";

// ═════════════════════════════════════════════════════════════════════════════
// C546 — "CREATE THE ACCOUNT AND RECODE THAT CHARGE TO IT" CREATED THE ACCOUNT AND RECODED
// NOTHING. Reported live: the category was added, the recode came back "That didn't go through
// — I couldn't save recode → Events & Catering … check your connection/permissions", and a
// retry worked. Three defects in one line of that sentence:
//   (A) the confirm card and the executor used DIFFERENT matchers — the card string-normalised,
//       the executor compared raw — so the card could list the charge and the executor find none;
//   (B) neither accepted the ENTRY's id, only the exact flattened ROW id, which is what a model
//       naming a single charge has in hand (delete_invoice has accepted both since C519);
//   (C) the failure blamed the connection, a cause nobody had established (O114's decoy shape).
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "6900", name: "Waste Removal", category: "Expenses" },
  { code: "5010", name: "Food Cost", category: "Expenses" }, { code: "5030", name: "Freight", category: "Expenses" },
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" },
];
const acct = (c) => ({ code: c, name: chart.find((a) => a.code === c)?.name });
const je = (id, date, description, lines, extra = {}) => ({
  id, entry_date: date, description, status: "posted", deleted_at: null, source: "universal_upload", payment_status: "unpaid",
  journal_entry_lines: lines.map((l, n) => ({ id: `${id}-line-${n}`, debit: l.debit || 0, credit: l.credit || 0, accounts: acct(l.code) })), ...extra,
});
// The reported charge: one expense line, so naming the entry is unambiguous.
const apex = je("ent-apex", "2026-09-25", "Apex Sanitation Services LLC – September service",
  [{ code: "6900", debit: 1849.01 }, { code: "2000", credit: 1849.01 }]);
// And a two-line bill, for the ambiguity case.
const sysco = je("ent-sysco", "2026-09-20", "Sysco – produce + freight",
  [{ code: "5010", debit: 500 }, { code: "5030", debit: 20 }, { code: "2000", credit: 520 }]);
// ★ AND AN ENTRY WITH THREE LINES BUT ONE CATEGORY (part paid at the till, part on terms).
// This is the shape the entry-id rule is FOR: its id is no row's id, so naming the charge
// resolves only through that rule. The first version of this test used `apex` for it — a TWO-line
// entry, whose flattened row id IS the entry id — so the exact-match branch answered and killing
// the entry-id rule changed nothing. A fixture that passes for the wrong reason proves nothing.
const split = je("ent-split", "2026-09-26", "Apex Sanitation Services LLC – extra collection",
  [{ code: "6900", debit: 300 }, { code: "2000", credit: 200 }, { code: "1000", credit: 100 }]);
const invoices = flattenJournalEntries([apex, sysco, split], chart);
const recode = (ids) => ({ type: "recode", invoiceIds: ids, gl_code: "6950", gl_name: "Events & Catering" });

describe("C546 — the reported sequence", () => {
  it("a 2-line charge resolves by its row id, which IS its entry id — the ordinary case", () => {
    expect(invoices.find((r) => r.id === "ent-apex")).toBeTruthy();
    const t = resolveActionTargets(recode(["ent-apex"]), { invoices });
    expect(t).toHaveLength(1);
    expect(t[0].gl_code).toBe("6900");
  });

  it("THE RULE THAT WAS MISSING — an entry whose id is NO row's id resolves to its one category line", () => {
    expect(invoices.some((r) => String(r.id) === "ent-split")).toBe(false);   // no row carries the entry id…
    expect(invoices.filter((r) => r.db_entry_id === "ent-split")).toHaveLength(3);
    const t = resolveActionTargets(recode(["ent-split"]), { invoices });
    expect(t).toHaveLength(1);
    expect(t[0].gl_code).toBe("6900");                                       // …the only line with a category
    expect(t[0].id).toBe("ent-split_0");
  });

  it("the card's list and the executor's set are the SAME resolver, over every id form", () => {
    for (const ids of [["ent-apex"], ["ent-apex_0"], [" ent-apex "].map((s) => s.trim())]) {
      const targets = resolveActionTargets(recode(ids), { invoices });
      const card = describeDestructiveAction(recode(ids), { invoices });
      expect(card.count, JSON.stringify(ids)).toBe(targets.length);
    }
  });

  it("an id that matches nothing resolves to nothing — and is REPORTED as that, not as a write failure", () => {
    expect(resolveActionTargets(recode(["no-such-entry"]), { invoices })).toHaveLength(0);
    const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    const at = app.indexOf("if (!toRecode.length) {");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 400)).toContain("I couldn't find the transaction you meant");
    // …and it happens BEFORE the write is attempted
    expect(at).toBeLessThan(app.indexOf("await persistRecode(toRecode", at));
  });

  it("AMBIGUITY IS REFUSED, NOT GUESSED — a two-line bill named by its entry resolves to nothing", () => {
    expect(invoices.filter((r) => r.db_entry_id === "ent-sysco")).toHaveLength(3);
    expect(resolveActionTargets(recode(["ent-sysco"]), { invoices })).toHaveLength(0);
    // naming the LINE is still exact, and moves only that line
    const one = resolveActionTargets(recode(["ent-sysco_1"]), { invoices });
    expect(one).toHaveLength(1);
    expect(one[0].gl_code).toBe("5030");
  });

  it("the A/P leg is never a recode target — only lines that have a category", () => {
    const all = resolveActionTargets(recode(["ent-apex"]), { invoices });
    expect(all.every((r) => r.gl_code !== "2000")).toBe(true);
  });
});

describe("C546 — a recode moves the line it was handed", () => {
  it("every flattened line carries its own database id", () => {
    expect(invoices.find((r) => r.id === "ent-sysco_0").line_db_id).toBe("ent-sysco-line-0");
    expect(invoices.find((r) => r.id === "ent-sysco_1").line_db_id).toBe("ent-sysco-line-1");
    expect(invoices.find((r) => r.id === "ent-apex").line_db_id).toBe("ent-apex-line-0");   // the simple row's primary line
  });
  it("persistRecode keys on that id, and refuses to collapse a split when it has none", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    const start = app.indexOf("for (const inv of withDbId) {");
    const body = app.slice(start, app.indexOf("// O67", start) > -1 ? app.indexOf("// O67", start) : start + 2000);
    expect(body).toContain('id: inv.line_db_id');
    expect(body).toMatch(/if \(hits\.length > 1\) \{/);
    // the old entry-wide write is gone
    expect(body).not.toMatch(/update\(\{ account_id: acctRow\.id \}\)\.eq\("journal_entry_id"/);
  });
});
