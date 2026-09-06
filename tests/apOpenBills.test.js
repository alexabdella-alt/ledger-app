import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { computeAP, glAccountBalance } from "../src/lib/reports";
import { computeControlTotals } from "../src/lib/controlTotals";

// ── THE LIVE SPECIMEN (Red River, CPA Review, 2026-09-03) ────────────────────
// "sum of open bills is $27,053.03, payables account balance is $31,678.03 — off by
// $4,625.00", and $4,625.00 is Sabine Kitchen Equipment to the cent:
//
//     Dr 1500 Fixed Assets      4,625.00
//     Cr 2000 Accounts Payable  4,625.00
//
// Correct: the freezer is capitalized and the money is owed. But openness was derived from
// `isExp(i)` — the entry's P&L CLASS — and a fixed-asset debit is not an expense. So the
// bill was invisible to open bills while its A/P credit sat in the GL balance.
// §9: the side is the A/R-or-A/P OFFSET code on the leg, never the entry's type.

const AP = "2000";
const row = (o) => ({ status: "booked", type: "expense", ...o });
// An ordinary bill: Dr expense / Cr A/P.
const bill = row({ id: "b1", date: "2026-08-01", vendor: "Franklin Ave", amount: 4512.75,
                   gl_code: "6100", secondary_gl_code: AP, secondary_amount: 4512.75 });
// The capitalized purchase on terms.
const asset = row({ id: "s1", date: "2026-08-21", vendor: "Sabine Kitchen Equipment", amount: 4625,
                    gl_code: "1500", secondary_gl_code: AP, secondary_amount: 4625 });

describe("an open bill is one with an A/P leg", () => {
  it("★ a capitalized purchase on terms IS an open bill — the live bug", () => {
    expect(computeAP([asset], { apCode: AP }).total).toBe(4625);
  });

  it("★★ and the sub-ledger then ties to the payables GL balance", () => {
    const books = [bill, asset];
    const sub = computeAP(books, { apCode: AP }).total;
    const gl  = glAccountBalance(AP, books);
    expect(sub).toBe(gl);
  });

  it("★★ ap_tie stops firing on correct books", () => {
    const checks = computeControlTotals({ invoices: [bill, asset], codes: { ap: AP } });
    const list = Array.isArray(checks) ? checks : (checks.checks || []);
    const ap = list.find(c => c.key === "ap_tie");
    expect(ap.ties).toBe(true);
  });

  it("★ WITHOUT the code it behaves exactly as before — no silent guessing", () => {
    // "2xxx" would sweep in a loan-financed purchase, which is a liability and not a bill.
    // Omitting the code must degrade to the old rule, never to an invented one.
    expect(computeAP([asset], {}).total).toBe(0);
  });

  it("★ A PAID capitalized purchase is NOT open — the rule still reads payment_status", () => {
    expect(computeAP([{ ...asset, payment_status: "paid" }], { apCode: AP }).total).toBe(0);
  });

  it("★ an asset bought with a LOAN is not an open bill", () => {
    // The counterpart that makes the code necessary: same shape, different offset.
    const financed = row({ ...asset, id: "l1", secondary_gl_code: "2300" });
    expect(computeAP([financed], { apCode: AP }).total).toBe(0);
  });

  it("★ the A/P leg itself is never counted as its own bill", () => {
    const apLeg = row({ id: "x1", date: "2026-08-21", amount: 4625, gl_code: AP, secondary_gl_code: "1500" });
    expect(computeAP([apLeg], { apCode: AP }).total).toBe(0);
  });

  it("★ an expanded multi-line row is skipped, so one entry cannot count twice", () => {
    // Flatten expands a multi-line entry into rows that can share an offset. `_` is this
    // codebase's existing sentinel for such a row.
    const a = row({ id: "m1_0", amount: 100, gl_code: "1500", secondary_gl_code: AP });
    const b = row({ id: "m1_1", amount: 50,  gl_code: "1510", secondary_gl_code: AP });
    expect(computeAP([a, b], { apCode: AP }).total).toBe(0);
  });

  it("★★ ORDINARY BILLS ARE UNAFFECTED — the change is additive", () => {
    // "Sabine is counted" is equally satisfied by counting everything, which would inflate
    // the figure people already read.
    expect(computeAP([bill], { apCode: AP }).total).toBe(4512.75);
    expect(computeAP([bill], {}).total).toBe(4512.75);
  });

  it("★ every caller passes the code, so there is ONE definition of money owed (§12)", () => {
    const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const ct  = strip(readFileSync(new URL("../src/lib/controlTotals.js", import.meta.url), "utf8"));
    const ai  = strip(readFileSync(new URL("../src/lib/aiTools.js", import.meta.url), "utf8"));
    const rep = strip(readFileSync(new URL("../src/lib/reports.js", import.meta.url), "utf8"));
    const app = strip(readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8"));
    expect(ct).toMatch(/computeAP\([^)]*apCode: codes\.ap/);
    expect(ai).toMatch(/computeAP\([^)]*apCode/);
    expect(rep).toMatch(/computeAP\(live, \{ now: monthEnd, apCode \}\)/);
    expect(app).toMatch(/apCode: rc\("accounts_payable"\)/);
  });
});
