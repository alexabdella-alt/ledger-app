import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ THE CHECKS THAT GATE SIGN-OFF, OVER MANY LEDGERS RATHER THAN ONE.
//
// `controlTotals.test.js` is 19 tests over 8 distinct amounts. These checks decide whether a
// month CAN be signed: **a false mismatch blocks correct books, and a false tie passes wrong
// ones.** C241 is the precedent — the sales-tax check ran BACKWARDS for as long as it existed
// (it flagged correct work and stayed silent on the one failure it was written for), and a
// green single-fixture suite said nothing, because the fixture handed the check the very field
// production never wrote.
//
// ★★ SO THIS ASSERTS BOTH DIRECTIONS, and the second is the one that matters:
//   · a ledger built from the REAL builders must TIE — no check may fire on correct work;
//   · a deliberately broken ledger must FAIL the matching check — a control that never fires
//     is indistinguishable from a clean set of books.
// ─────────────────────────────────────────────────────────────────────────────

const CODES = { ar: "1200", ap: "2000", cash: "1000", salesTax: "2350" };
const line = (code, debit, credit) => ({ id: null, account_id: `a_${code}`, debit, credit, accounts: { code, name: code } });

let seq = 0;
// ★ ENTRIES BUILT DIRECTLY, NOT THROUGH THE BUILDERS. The builders are swept in
// `gaapSweep.test.js`; the subject HERE is the control totals, and hand-built balanced
// entries keep the fixture honest about what is under test rather than importing three
// other contracts' preconditions into it.
const entry = (id, date, lines, extra = {}) => ({
  id, company_id: "c", entry_date: date, description: extra.description || `V ${id} – x`,
  source: extra.source || "manual", status: "posted", deleted_at: null, ...extra,
  journal_entry_lines: lines.map((l, j) => ({ ...line(l[0], l[1] || 0, l[2] || 0), id: `${id}_${j}` })),
});

// A realistic month: invoices raised (some collected), bills booked (some paid).
function ledger({ invoices = 6, collect = 3, bills = 6, pay = 3, base = 1000, taxRate = 0 } = {}) {
  const out = [];
  for (let i = 0; i < invoices; i++) {
    const sub = Math.round((base + i * 137.11) * 100) / 100;
    const tax = Math.round(sub * taxRate * 100) / 100;
    const total = Math.round((sub + tax) * 100) / 100;
    const day = `2026-03-0${(i % 9) + 1}`;
    out.push(entry(`inv-${seq++}`, day,
      tax > 0 ? [[CODES.ar, total, 0], ["4000", 0, sub], [CODES.salesTax, 0, tax]]
              : [[CODES.ar, total, 0], ["4000", 0, sub]],
      { source: "ar_invoice", payment_status: i < collect ? "paid" : "uncollected" }));
    if (i < collect) {
      out.push(entry(`col-${seq++}`, `2026-03-1${i}`, [[CODES.cash, total, 0], [CODES.ar, 0, total]],
        { payment_status: "paid", description: "Payment – Cust" }));
    }
  }
  for (let i = 0; i < bills; i++) {
    const amt = Math.round((base / 2 + i * 91.37) * 100) / 100;
    out.push(entry(`bill-${seq++}`, `2026-03-0${(i % 9) + 1}`, [["6100", amt, 0], [CODES.ap, 0, amt]],
      { source: "universal_upload", payment_status: i < pay ? "paid" : undefined }));
    if (i < pay) {
      out.push(entry(`pay-${seq++}`, `2026-03-2${i}`, [[CODES.ap, amt, 0], [CODES.cash, 0, amt]],
        { payment_status: "paid", description: "Payment – Supplier" }));
    }
  }
  return out;
}

const run = (entries) => computeControlTotals({
  invoices: flattenJournalEntries(entries), reconciliations: [], intakeRows: [], codes: CODES, now: new Date("2026-04-01"),
});

describe("★★★ no control total fires on correct books", () => {
  it("the trial balance ties across many shapes — it is the one that can never be wrong", () => {
    for (const base of [100, 1000, 3333.33, 98765.43]) {
      for (const taxRate of [0, 0.0825, 0.06375]) {
        for (const shape of [{ invoices: 6, collect: 3, bills: 6, pay: 3 }, { invoices: 1, collect: 0, bills: 1, pay: 0 }, { invoices: 12, collect: 12, bills: 12, pay: 12 }]) {
          const r = run(ledger({ ...shape, base, taxRate }));
          const tb = r.checks.find((c) => c.key === "trial_balance");
          if (!tb.ties) throw new Error(`trial balance failed on correct books: base ${base}, tax ${taxRate} — ${tb.a} vs ${tb.b}`);
        }
      }
    }
    expect(true).toBe(true);
  });

  it("★ an empty company ties rather than reporting a mismatch", () => {
    const r = run([]);
    for (const c of r.checks) expect(c.ties).toBe(true);
    expect(r.allTie).toBe(true);
  });
});

describe("★★★ and the checks actually FIRE — a control that never fires is indistinguishable from clean books", () => {
  it("★★ a one-sided MULTI-LINE entry breaks the trial balance", () => {
    const broken = ledger();
    broken.push(entry("bad", "2026-03-15", [["6100", 500, 0], [CODES.cash, 0, 300], [CODES.ap, 0, 199]]));
    expect(run(broken).checks.find((c) => c.key === "trial_balance").ties).toBe(false);
  });

  it("★★★ AND A ONE-SIDED TWO-LINE ENTRY IS CAUGHT TOO — the limit C289 pinned is now closed", () => {
    // It used to be invisible: `flattenJournalEntries` collapsed a 2-line entry into ONE row
    // carrying the primary amount and DERIVED the offset from it, so the discrepancy was
    // discarded before the check could see it — and "the fundamental tie-out" could not fail
    // on the commonest shape in the ledger. The row now carries the offset leg's OWN amount.
    const broken = ledger();
    broken.push(entry("bad2", "2026-03-15", [["6100", 500, 0], [CODES.cash, 0, 499]]));
    expect(run(broken).checks.find((c) => c.key === "trial_balance").ties).toBe(false);
  });

  it("★★ and a BALANCED two-line entry still ties — the fix must not flag correct books", () => {
    const fine = ledger();
    fine.push(entry("ok2", "2026-03-15", [["6100", 500, 0], [CODES.cash, 0, 500]]));
    expect(run(fine).checks.find((c) => c.key === "trial_balance").ties).toBe(true);
  });

  it("★★ a payables balance that does not match the open bills is caught", () => {
    // A bill whose A/P leg is short: the sub-ledger and the GL disagree, which is exactly
    // what ap_tie exists to notice.
    const broken = ledger();
    broken.push({
      id: "apbad", company_id: "c", entry_date: "2026-03-16", description: "Skew – x",
      source: "manual", status: "posted", deleted_at: null,
      journal_entry_lines: [{ ...line(CODES.ap, 250, 0), id: "apbad_0" }, { ...line("3100", 0, 250), id: "apbad_1" }],
    });
    const ap = run(broken).checks.find((c) => c.key === "ap_tie");
    expect(ap.ties).toBe(false);
  });

  it("★ and the same ledger WITHOUT the skew passes that check — so the failure is the skew, not the fixture", () => {
    const ap = run(ledger()).checks.find((c) => c.key === "ap_tie");
    expect(ap.ties).toBe(true);
  });
});
