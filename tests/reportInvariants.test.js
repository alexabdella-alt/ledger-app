import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import {
  computeExpenses, computeNetIncome, computeRevenue, fiscalYearSplit, glAccountBalance, glCashOnHand, trialBalance,
} from "../src/lib/reports.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ THE REPORTS A CLIENT ACTUALLY READS, OVER MANY LEDGERS RATHER THAN ONE.
//
// `gaapInvariants.test.js` checks the accounting equation over a fixture of one instance per
// EVENT. That proves the BUILDERS are right. It says nothing about whether the DERIVATIONS
// stay right as a real ledger accumulates — voided entries, soft-deleted ones, multi-line
// entries, revenue on the offset leg, a year boundary in the middle.
//
// C286/C287 showed what a single fixture cannot see: a defect that only appears at particular
// values. **These are the same invariants, over 40 generated ledgers.** Every ledger is
// balanced BY CONSTRUCTION (each entry's debits equal its credits), so any imbalance the
// derivations report is the derivations' own.
//
// ★ DETERMINISTIC — a seeded generator, no `Math.random`, so a failure names a ledger anyone
// can reproduce.
// ─────────────────────────────────────────────────────────────────────────────

const CODES = ["1000", "1200", "1500", "2000", "2350", "3100", "4000", "4200", "5000", "6100", "6400", "8000"];
const isBal = (c) => /^[123]/.test(c);

// A tiny deterministic PRNG — the same seed always yields the same ledger.
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

function makeLedger(seed, n = 60) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length) % xs.length];
  const out = [];
  for (let i = 0; i < n; i++) {
    const amt = Math.round((1 + r() * 9000) * 100) / 100;
    // ★ REALISTIC DOUBLE ENTRY: at most ONE P&L leg. Every builder in `src/lib` pairs a P&L
    // account with a balance-sheet account — none produces P&L on both sides — and the two
    // net-income derivations disagree on that shape (pinned as a known limit below). A
    // generator that emitted it would be testing an entry the product cannot create.
    const PL = CODES.filter((c) => /^[4-8]/.test(c));
    const BS = CODES.filter((c) => isBal(c));
    const a = pick(r() < 0.7 ? PL : BS);
    let b = pick(/^[4-8]/.test(a) ? BS : CODES);
    if (b === a) b = a === "1000" ? "2000" : "1000";
    // ★ NOTHING AFTER THE AS-OF DATE. My first version dated entries into Sep-Dec 2026 while
    // asserting `prior + current === all-time` against an as-of of 2026-08-30 — so the split
    // correctly excluded entries all-time correctly included, and the "failure" was my fixture.
    const year = r() < 0.35 ? 2025 : 2026;                       // straddle a year boundary
    const maxMonth = year === 2026 ? 8 : 12;
    const date = `${year}-${String(1 + Math.floor(r() * maxMonth)).padStart(2, "0")}-${String(1 + Math.floor(r() * 28)).padStart(2, "0")}`;
    // ★ A THIRD LEG SOMETIMES, because a 2-line entry and an N-line entry flatten differently
    // and the derivations must agree on both.
    const third = r() < 0.25;
    const split = third ? Math.round(amt * 0.4 * 100) / 100 : 0;
    const lines = third
      ? [{ code: a, debit: amt, credit: 0 }, { code: b, debit: 0, credit: amt - split }, { code: pick(/^[4-8]/.test(a) ? BS : CODES), debit: 0, credit: split }]
      : [{ code: a, debit: amt, credit: 0 }, { code: b, debit: 0, credit: amt }];
    const voided = r() < 0.08;
    const deleted = r() < 0.08;
    out.push({
      // ★ NO UNDERSCORE IN AN ENTRY ID. `_` is the sentinel meaning "an expanded multi-line
      // row", so `glAccountBalance` counts primary-only for those — my first ids were
      // `e7919_3`, which made EVERY entry look expanded and its offset leg vanish. The
      // "failure" was my fixture colliding with a structural convention.
      id: `e${seed}-${i}`, company_id: "c", entry_date: date, description: `Vendor ${i} – thing`,
      source: pick(["universal_upload", "bank_import", "manual", "payroll"]),
      status: voided ? "voided" : "posted",
      deleted_at: deleted ? "2026-08-01T00:00:00Z" : null,
      journal_entry_lines: lines.map((l, j) => ({
        id: `e${seed}-${i}_${j}`, account_id: `a_${l.code}`, debit: l.debit, credit: l.credit,
        accounts: { code: l.code, name: `Account ${l.code}` },
      })),
    });
  }
  return out;
}

const ACCOUNTS = CODES.map((c) => ({
  code: c, name: `Account ${c}`,
  category: c[0] === "1" ? "Assets" : c[0] === "2" ? "Liabilities" : c[0] === "3" ? "Equity" : c[0] === "4" ? "Revenue" : "Expenses",
}));

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

describe("★★★ the reporting layer's invariants hold across 40 generated ledgers", () => {
  it("★ revenue − expenses === net income, on every ledger", () => {
    for (const seed of SEEDS) {
      const inv = flattenJournalEntries(makeLedger(seed));
      const diff = computeRevenue(inv) - computeExpenses(inv) - computeNetIncome(inv);
      if (Math.abs(diff) >= 0.005) throw new Error(`seed ${seed}: revenue − expenses − net = ${diff}`);
    }
    expect(SEEDS.length).toBe(40);
  });

  it("★★ the trial balance balances — debits === credits", () => {
    for (const seed of SEEDS) {
      const inv = flattenJournalEntries(makeLedger(seed));
      const tb = trialBalance(inv);
      const rows = Array.isArray(tb) ? tb : (tb.rows || Object.values(tb));
      const d = rows.reduce((s, r) => s + (Number(r.debit) || 0), 0);
      const c = rows.reduce((s, r) => s + (Number(r.credit) || 0), 0);
      if (Math.abs(d - c) >= 0.005) throw new Error(`seed ${seed}: trial balance Dr ${d.toFixed(2)} vs Cr ${c.toFixed(2)}`);
    }
    expect(SEEDS.length).toBe(40);
  });

  it("★★★ the accounting equation: assets − liabilities − equity === net income", () => {
    for (const seed of SEEDS) {
      const inv = flattenJournalEntries(makeLedger(seed));
      const sum = (pred) => CODES.filter(pred).reduce((s, c) => s + glAccountBalance(c, inv), 0);
      const assets = sum((c) => c[0] === "1");
      const liabs = sum((c) => c[0] === "2");
      const equity = sum((c) => c[0] === "3");
      const net = computeNetIncome(inv);
      const drift = assets - liabs - equity - net;
      if (Math.abs(drift) >= 0.005) throw new Error(`seed ${seed}: A ${assets.toFixed(2)} − L ${liabs.toFixed(2)} − E ${equity.toFixed(2)} − NI ${net.toFixed(2)} = ${drift.toFixed(4)}`);
    }
    expect(SEEDS.length).toBe(40);
  });

  it("★★ every P&L derivation agrees with glAccountBalance — the cluster-#4 lock, at scale", () => {
    // Two independent derivation paths for the same figure. They were locked against each
    // other on ONE fixture; this is the same lock across varied ledgers.
    for (const seed of SEEDS) {
      const inv = flattenJournalEntries(makeLedger(seed));
      const rev = CODES.filter((c) => c[0] === "4").reduce((s, c) => s + glAccountBalance(c, inv), 0);
      const exp = CODES.filter((c) => /^[5-8]/.test(c)).reduce((s, c) => s + glAccountBalance(c, inv), 0);
      if (Math.abs(rev - computeRevenue(inv)) >= 0.005) throw new Error(`seed ${seed}: revenue ${computeRevenue(inv)} vs GL ${rev}`);
      if (Math.abs(exp - computeExpenses(inv)) >= 0.005) throw new Error(`seed ${seed}: expenses ${computeExpenses(inv)} vs GL ${exp}`);
    }
    expect(SEEDS.length).toBe(40);
  });

  it("★★ the fiscal-year split: prior + current === all-time, on every ledger", () => {
    for (const seed of SEEDS) {
      const inv = flattenJournalEntries(makeLedger(seed));
      const all = computeNetIncome(inv);
      const s = fiscalYearSplit(inv, { asOf: "2026-08-30", fiscalYearEnd: "12-31" });
      const drift = (s.priorNet + s.currentNet) - all;
      if (Math.abs(drift) >= 0.005) throw new Error(`seed ${seed}: prior ${s.priorNet} + current ${s.currentNet} vs all-time ${all} → ${drift}`);
    }
    expect(SEEDS.length).toBe(40);
  });

  it("★ voided and soft-deleted entries are excluded by every derivation, consistently", () => {
    for (const seed of SEEDS.slice(0, 12)) {
      const raw = makeLedger(seed);
      const live = raw.filter((e) => e.status !== "voided" && !e.deleted_at);
      const a = flattenJournalEntries(raw);
      const b = flattenJournalEntries(live);
      expect(computeNetIncome(a)).toBeCloseTo(computeNetIncome(b), 2);
      expect(glCashOnHand(a, ["1000"])).toBeCloseTo(glCashOnHand(b, ["1000"]), 2);
    }
    expect(SEEDS.length).toBe(40);
  });

  it("the generator is deterministic and actually produces varied ledgers", () => {
    // Without this the sweep could be forty copies of one ledger, or empty.
    expect(JSON.stringify(makeLedger(7919))).toBe(JSON.stringify(makeLedger(7919)));
    expect(JSON.stringify(makeLedger(7919))).not.toBe(JSON.stringify(makeLedger(15838)));
    const inv = flattenJournalEntries(makeLedger(7919));
    expect(inv.length).toBeGreaterThan(20);
  });
});


describe("★★ a KNOWN LIMIT, pinned so it cannot become a surprise", () => {
  it("the two net-income derivations disagree on an entry with P&L accounts on BOTH legs", () => {
    // `computeNetIncome` nets revenue against expenses across the whole row; `fiscalYearSplit`
    // attributes by period from the primary leg. On a normal entry — one P&L leg against a
    // balance-sheet leg — they agree, which is why §12's lock has always held.
    //
    // ★★ NO BUILDER IN `src/lib` PRODUCES THIS SHAPE: every one pairs a P&L account with a
    // balance-sheet account, so the divergence is currently unreachable. It is pinned rather
    // than fixed because changing a core reporting function for a case nothing can create is
    // the wrong risk — but if a builder ever emits P&L on both legs, THIS TEST FAILS FIRST and
    // the split must be reconciled before that builder ships.
    const e = {
      id: "pl-both", company_id: "c", entry_date: "2026-03-01", description: "V – x",
      source: "manual", status: "posted", deleted_at: null,
      journal_entry_lines: [
        { id: "pl_0", account_id: "a", debit: 100, credit: 0, accounts: { code: "6100", name: "x" } },
        { id: "pl_1", account_id: "b", debit: 0, credit: 100, accounts: { code: "4000", name: "y" } },
      ],
    };
    const inv = flattenJournalEntries([e]);
    const all = computeNetIncome(inv);
    const s = fiscalYearSplit(inv, { asOf: "2026-08-30", fiscalYearEnd: "12-31" });
    expect(all).toBe(0);                              // revenue 100 − expenses 100
    expect(s.priorNet + s.currentNet).toBe(-100);     // the divergence, stated
  });
});

describe("★★★ a one-sided two-line entry is now visible to the derivations", () => {
  const oneSided = (d, c) => ([{
    id: "lopsided", company_id: "c", entry_date: "2026-03-01", description: "V – x",
    source: "manual", status: "posted", deleted_at: null,
    journal_entry_lines: [
      { id: "ls_0", account_id: "a", debit: d, credit: 0, accounts: { code: "6100", name: "x" } },
      { id: "ls_1", account_id: "b", debit: 0, credit: c, accounts: { code: "1000", name: "cash" } },
    ],
  }]);

  it("★★ the flattened row carries the offset leg's OWN amount", () => {
    const [row] = flattenJournalEntries(oneSided(500, 499));
    expect(row.amount).toBe(500);
    expect(row.secondary_amount).toBe(499);
  });

  it("★★★ so the trial balance no longer balances by construction", () => {
    const tb = trialBalance(flattenJournalEntries(oneSided(500, 499)));
    expect(tb.balanced).toBe(false);
    expect(Math.abs(tb.difference)).toBeCloseTo(1, 2);
  });

  it("★★ and the GL balances reflect what each leg actually says", () => {
    const inv = flattenJournalEntries(oneSided(500, 499));
    expect(glAccountBalance("6100", inv)).toBe(500);
    expect(glAccountBalance("1000", inv)).toBe(-499);
  });

  it("★★★ a BALANCED entry is unchanged — the fix must move nothing that was right", () => {
    const inv = flattenJournalEntries(oneSided(500, 500));
    expect(inv[0].secondary_amount).toBe(500);
    expect(trialBalance(inv).balanced).toBe(true);
    expect(glAccountBalance("6100", inv)).toBe(500);
    expect(glAccountBalance("1000", inv)).toBe(-500);
  });

  it("★ a row with no secondary_amount at all falls back to the primary — older callers are safe", () => {
    // Anything constructing rows by hand (tests, the AI path, a fixture) has no such field.
    const hand = [{ id: "h1", date: "2026-03-01", amount: 250, gl_code: "6100", secondary_gl_code: "1000", debit_credit: "debit", status: "booked" }];
    expect(glAccountBalance("1000", hand)).toBe(-250);
    expect(trialBalance(hand).balanced).toBe(true);
  });
});
