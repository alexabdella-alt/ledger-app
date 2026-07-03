import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fmtSignedMoney, fmtMoney, fmtApprox } from "../src/lib/format.js";
import { glCashOnHand, businessHealth } from "../src/lib/reports.js";
import { executeAITool } from "../src/lib/aiTools.js";

// ════════════════════════════════════════════════════════════════════════════
// THE MONEY-FORMATTER GUARD — the formatting sibling of the canonical-computation
// layer. Every displayed monetary value must go through ONE formatter
// (fmtSignedMoney / its documented variants). Ad-hoc `"$"+Math.round(n)` /
// `toLocaleString({maximumFractionDigits:0})` were the root of the "$1 off" bug:
// one canonical VALUE rendered by two formatters (round-half-up whole dollars vs
// exact cents) disagreed by $1 and could never reconcile. This test makes that
// regression structurally impossible:
//   (1) SOURCE SCAN — no ad-hoc money formatter exists outside format.js.
//   (2) PARITY — for a value with cents that exposes rounding-method differences,
//       every surface (dashboard businessHealth, chatbot tool, canonical) renders
//       the BYTE-IDENTICAL string.
// ════════════════════════════════════════════════════════════════════════════

// ── (1) SOURCE SCAN ──────────────────────────────────────────────────────────
describe("source scan — money display goes through the canonical formatter only", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const srcDir = path.join(__dirname, "..", "src");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(js|jsx)$/.test(e.name) ? [full] : [];
  });

  // The ad-hoc money-format patterns that caused (or could re-introduce) the bug.
  const PATTERNS = [
    { name: "whole-dollar \"$\"+Math.round", re: /["'`]\$["'`]?\s*\+\s*Math\.round\(/ },
    { name: "whole-dollar $${…Math.round…}", re: /\$\$\{[^}]*Math\.round\(/ },
    { name: "whole-dollar toLocaleString(maximumFractionDigits:0)", re: /maximumFractionDigits:\s*0/ },
    { name: "inline \"$\"+…toLocaleString money formatter", re: /["'`]\$["'`]?\s*\+[^;\n]*\.toLocaleString\(/ },
  ];

  // Allowlisted: the canonical formatter's own home, and JE-memo / audit provenance
  // strings (immutable records, not cross-checked display balances). A line is
  // provenance if it's building a `memo:` or an ASC-842 lease memo.
  const isAllowed = (file, line) =>
    file.endsWith(path.join("lib", "format.js")) ||
    /\bmemo:/.test(line) ||
    /ASC 842/.test(line);

  it("no source file (outside format.js / JE-memo provenance) formats money ad-hoc", () => {
    const offenders = [];
    for (const file of walk(srcDir)) {
      const lines = fs.readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return; // comments
        if (isAllowed(file, line)) return;
        for (const p of PATTERNS) {
          if (p.re.test(line)) offenders.push(`${path.relative(srcDir, file)}:${i + 1} — ${p.name}`);
        }
      });
    }
    expect(offenders, `ad-hoc money formatting found (route it through fmtSignedMoney/fmtMoney/fmtApprox in lib/format.js):\n${offenders.join("\n")}`).toEqual([]);
  });
});

// ── (2) CROSS-SURFACE PARITY ─────────────────────────────────────────────────
describe("parity — every surface renders the same figure byte-identically", () => {
  // Values chosen to land on .50 cents — the exact shape that makes round-half-up
  // ("$49,214") disagree with exact cents ("$49,213.50").
  //  Cash 1000: opening $49,213.50 (Dr Cash / Cr OBE)              → cash = 49213.50
  //  Revenue 4000: $12,345.50 invoice (Dr A/R / Cr Revenue)        (no cash movement)
  //  Expense 6100: $20,000.75 bill on credit (Dr Exp / Cr A/P)     → net = 12345.50 − 20000.75 = −7655.25
  const ledger = [
    { id: "o",  date: "2026-01-01", gl_code: "1000", debit: 49213.50, credit: 0, amount: 49213.50, secondary_gl_code: "3400" },
    { id: "o2", date: "2026-01-01", gl_code: "3400", debit: 0, credit: 49213.50, amount: 49213.50 },
    { id: "s",  date: "2026-02-10", gl_code: "4000", debit: 0, credit: 12345.50, amount: 12345.50, secondary_gl_code: "1100" },
    { id: "s2", date: "2026-02-10", gl_code: "1100", debit: 12345.50, credit: 0, amount: 12345.50 },
    { id: "b",  date: "2026-02-15", gl_code: "6100", debit: 20000.75, credit: 0, amount: 20000.75, secondary_gl_code: "2000", payment_status: "unpaid", due_date: "2026-03-01" },
    { id: "b2", date: "2026-02-15", gl_code: "2000", debit: 0, credit: 20000.75, amount: 20000.75 },
  ];
  const mockCtx = { cashBalance: glCashOnHand(ledger, ["1000"]), getLedger: async () => ledger, chartOfAccounts: [], getAccountByRole: () => null, anomalies: [], recurring: [] };

  it("cash is $49,213.50 on both the dashboard card and the chatbot — never $49,214", async () => {
    const glCash = glCashOnHand(ledger, ["1000"]);
    expect(glCash).toBe(49213.5);
    const dash = businessHealth(ledger, { cash: glCash }).facts.find(f => f.key === "cash").value;
    const tool = await executeAITool("get_financial_summary", { period: "all_time" }, mockCtx);
    expect(dash).toBe("$49,213.50");
    expect(dash).not.toBe("$49,214");
    expect(tool.cash_balance_display).toBe(dash);
    expect(fmtSignedMoney(glCash)).toBe(dash);
  });

  it("net income renders identically on dashboard + chatbot (a negative with cents)", async () => {
    const glCash = glCashOnHand(ledger, ["1000"]);
    const dashNet = businessHealth(ledger, { cash: glCash }).facts.find(f => f.key === "profit").value;
    const tool = await executeAITool("get_financial_summary", { period: "all_time" }, mockCtx);
    expect(dashNet).toBe(tool.net_income_display);        // same string, both surfaces
    expect(dashNet).toBe(fmtSignedMoney(tool.net_income)); // and it's the canonical formatting
    expect(dashNet.startsWith("-$")).toBe(true);           // signed, to the cent
  });

  it("the canonical formatter and its magnitude variant agree for positives incl .50", () => {
    for (const v of [49213.5, 786.5, 0, 12345.5, 1000000.5]) {
      expect(fmtMoney(v)).toBe(fmtSignedMoney(v));
    }
  });

  it("the whole-dollar variant is DISTINCT and reserved for estimates (documents the split)", () => {
    // fmtApprox is intentionally lossy (whole dollars) — it must NOT be used for a
    // balance that also shows exact cents elsewhere. This asserts it's a real,
    // separate variant so the two are never silently swapped.
    expect(fmtApprox(49213.5)).toBe("$49,214");            // round-half-up whole dollars
    expect(fmtApprox(49213.5)).not.toBe(fmtSignedMoney(49213.5)); // ≠ the exact-cents canonical
  });
});
