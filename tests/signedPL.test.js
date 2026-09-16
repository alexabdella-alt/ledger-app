import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { signedPL } from "../src/lib/reports.js";

// ═════════════════════════════════════════════════════════════════════════════
// C491 — THE UNSIGNED-SUM CLASS, SWEPT. Every per-row sum a person reads — Home's
// expense/revenue drills, a customer's "billed this year", a vendor's "paid this year", the
// P&L's category and project lines — summed `amount` and so counted a correction as a
// second purchase (or a reversed invoice as a second sale). One helper now, and a guard
// that every `.amount` sum in a view goes through it or through an open-item list.
// ═════════════════════════════════════════════════════════════════════════════
describe("C491 · signedPL", () => {
  it("expense debit +, expense credit −, revenue credit +, revenue debit −, unknown leg +", () => {
    expect(signedPL({ gl_code: "5010", amount: 500, debit_credit: "debit" })).toBe(500);
    expect(signedPL({ gl_code: "5010", amount: 500, debit_credit: "credit" })).toBe(-500);
    expect(signedPL({ gl_code: "4000", amount: 900, debit_credit: "credit" })).toBe(900);
    expect(signedPL({ gl_code: "4000", amount: 900, debit_credit: "debit" })).toBe(-900);
    expect(signedPL({ gl_code: "5010", amount: 500 })).toBe(500);
  });
  it("no view sums a ledger row's raw `.amount` outside an open-item list or a sub-total of lines", () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
    const offenders = [];
    for (const f of walk("src/components/views").filter((f) => f.endsWith(".jsx"))) {
      const src = fs.readFileSync(f, "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
      for (const m of src.matchAll(/(?:reduce\(\(s,\s*(\w+)\)\s*=>\s*s\s*\+\s*\(?\1\.amount|\+=\s*(\w+)\.amount\b)/g)) {
        const line = src.slice(0, m.index).split("\n").length;
        const text = src.split("\n")[line - 1];
        // Excused: sums over an OPEN-item list (every row is a live bill, one leg), invoice
        // line items (`l.amount`, not a ledger row), the reconcile's bank lines (`t.amount`),
        // the matching screen's session history, and the Taxes screen's deduction BREAKDOWN rows
        // (`deductions.reduce` sums per-category figures C489 already signed, not ledger rows).
        if (/openPayablesGL|paidPayablesGL|openPayables\b|openReceivables|line_items|\bl\.amount|\bt\.amount|matchHistory|arAll\.filter|deductions\.reduce/.test(text)) continue;
        offenders.push(`${f}:${line}: ${text.trim().slice(0, 100)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
