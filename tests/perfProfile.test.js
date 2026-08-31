import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger";
import { computeRevenue, computeExpenses, computeNetIncome, glAccountBalance, glCashOnHand, trialBalance } from "../src/lib/reports";

// ─────────────────────────────────────────────────────────────────────────────
// O107 — WHERE THE TIME GOES. Measurement first, per the item; no fixes here.
//
// ★★ THE ASSERTION IS ABOUT SCALING, NOT ABSOLUTE TIME. Absolute milliseconds vary with the
// machine and would make this flaky and ignorable. **A function that doubles when the data
// doubles is fine at any size; one that QUADRUPLES is what eventually stops a screen from
// rendering** — and it is invisible on a small fixture, which is exactly why nobody has seen
// it. So the guard is: 10× the data must not cost dramatically more than 10× the time.
//
// Synthetic data, because the SHAPES cost the time and not the values — and it means this
// can be re-run by anyone with no production access.
// ─────────────────────────────────────────────────────────────────────────────

const VENDORS = ["Roma Cheese", "Lone Star Supply", "Hill Country Milling", "Bluebonnet Linen", "Toast POS", "Alamo Ice", "Franklin Ave Properties", "Gusto"];
const CODES = ["5000", "6100", "6250", "6400", "6500", "6520", "4000", "1000", "2000"];

function makeEntries(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const amt = 50 + ((i * 37) % 4000) + ((i % 7) * 0.13);
    const code = CODES[i % CODES.length];
    out.push({
      id: `je_${i}`, company_id: "c1",
      entry_date: `2026-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
      description: `${VENDORS[i % VENDORS.length]} – invoice ${i}`,
      source: i % 5 === 0 ? "bank_import" : "universal_upload",
      status: "posted", deleted_at: null, ai_confidence: 60 + (i % 40),
      journal_entry_lines: [
        { id: `l${i}a`, account_id: `a_${code}`, debit: amt, credit: 0, accounts: { code, name: `Account ${code}` } },
        { id: `l${i}b`, account_id: "a_1000", debit: 0, credit: amt, accounts: { code: "1000", name: "Cash" } },
      ],
    });
  }
  return out;
}

const accounts = CODES.map((c) => ({
  code: c, name: `Account ${c}`,
  category: c[0] === "4" ? "Revenue" : c[0] === "1" ? "Assets" : c[0] === "2" ? "Liabilities" : "Expenses",
}));

// Median of a few runs — a single timing on a busy machine is noise, and this guard is only
// worth having if it does not cry wolf.
function timeOf(fn, runs = 5) {
  const ts = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    ts.push(performance.now() - t);
  }
  return ts.sort((a, b) => a - b)[Math.floor(runs / 2)];
}

const SIZES = [2000, 20000];
const measure = (n) => {
  const entries = makeEntries(n);
  const invoices = flattenJournalEntries(entries);
  return {
    n,
    flatten: timeOf(() => flattenJournalEntries(entries)),
    revenue: timeOf(() => computeRevenue(invoices)),
    expenses: timeOf(() => computeExpenses(invoices)),
    net: timeOf(() => computeNetIncome(invoices)),
    glBalance: timeOf(() => glAccountBalance("6100", invoices)),
    glCash: timeOf(() => glCashOnHand(invoices, ["1000"])),
    trialBal: timeOf(() => trialBalance(invoices, accounts)),
  };
};

describe("O107 — no derivation scales worse than linearly with the ledger", () => {
  const small = measure(SIZES[0]);
  const large = measure(SIZES[1]);
  const cols = ["flatten", "revenue", "expenses", "net", "glBalance", "glCash", "trialBal"];

  it("reports the measurement (the item's actual deliverable)", () => {
    const lines = [`\n  O107 — ms by ledger size (a client year is 250-1000 entries)\n`,
      `    ${"".padEnd(11)}${String(SIZES[0]).padStart(10)}${String(SIZES[1]).padStart(10)}${"  10x cost".padStart(12)}`];
    for (const c of cols) {
      const f = small[c] < 0.02 ? null : large[c] / small[c];
      lines.push(`    ${c.padEnd(11)}${small[c].toFixed(2).padStart(10)}${large[c].toFixed(2).padStart(10)}${(f ? `${f.toFixed(1)}x` : "—").padStart(12)}`);
    }
    console.log(lines.join("\n") + "\n");
    expect(cols.length).toBe(7);
  });

  it.each([["flatten"], ["revenue"], ["expenses"], ["net"], ["glBalance"], ["glCash"], ["trialBal"]])(
    "★ %s stays roughly linear across 10x the data",
    (name) => {
      // Too fast to measure at the small size ⇒ nothing to compare; skip rather than
      // manufacture a ratio out of noise. Reported so a silently-skipped check is visible.
      if (small[name] < 0.02) { console.log(`    (${name}: under 0.02ms at ${SIZES[0]} — too fast to scale-test)`); return; }
      const factor = large[name] / small[name];
      // 10x data. Linear is 10x; the ceiling is generous because a test machine is noisy,
      // and a QUADRATIC function would come in near 100x — far outside it.
      expect(factor).toBeLessThan(35);
    },
  );
});
