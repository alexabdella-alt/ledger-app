import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { offRhythmCopy } from "../src/lib/recurringVendor.js";

// ═════════════════════════════════════════════════════════════════════════════
// C422 — MONEY A PERSON READS CARRIES THOUSANDS SEPARATORS. `$4625.00` on the invoice a
// customer receives, on the duplicate card an owner answers, on the "charged twice" card.
// Every owner-facing template goes through `fmtMoney`; a bare `$${x.toFixed(2)}` may remain
// only in audit/memo strings written for the accountant (named below) and in test fixtures.
// ═════════════════════════════════════════════════════════════════════════════
const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

// Accountant-facing strings (audit detail / journal memo / matcher reasoning) may keep the bare form.
const ACCOUNTANT_ONLY = [
  "src/lib/contractEntries.js",   // ASC 842 journal memos
  "src/lib/bankMatch.js",         // matcher reasoning for the CPA
];

describe("C422", () => {
  it("no owner-facing template formats money by hand", () => {
    const bad = [];
    for (const f of walk("src")) {
      if (ACCOUNTANT_ONLY.includes(f)) continue;
      const src = strip(fs.readFileSync(f, "utf8"));
      for (const m of src.matchAll(/\$\$\{[^}]*toFixed\(2\)\}/g)) {
        const line = src.slice(0, m.index).split("\n").length;
        const ctx = src.slice(Math.max(0, m.index - 260), m.index);
        // audit rows are the accountant's record; the owner's Audit trail scrubs (C408) and
        // a bare figure there is not a leak, only untidy — excused by the call it sits in
        if (/logAudit\(|logAI\(|memo:`/.test(ctx)) continue;   // journal memos are the accountant's
        bad.push(`${f}:${line} ${m[0]}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it("the off-rhythm card names a formatted amount", () => {
    const t = offRhythmCopy({ vendor: "Sysco", amount: 4625, gapDays: 3, intervalDays: 7 });
    expect(t).toMatch(/\$4,625\.00/);
    expect(t).not.toMatch(/\$4625\.00/);
  });
  it("the invoice a customer receives is formatted", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(src).toMatch(/<span>Total Due<\/span><span>\$\{fmtMoney\(total\)\}<\/span>/);
    expect(src).not.toMatch(/\$\$\{total\.toFixed\(2\)\}/);
  });
});
