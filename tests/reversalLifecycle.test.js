import { describe, it, expect } from "vitest";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import {
  computeRevenue, computeExpenses, computeNetIncome, glAccountBalance,
  computeCategoryTotals, computeVendorTotals, computeKPIs, liveEntries,
} from "../src/lib/reports.js";
import { reconBooksSet, cashLegSigned } from "../src/lib/reconcile.js";

// ════════════════════════════════════════════════════════════════════════════
// REPORT-LEVEL REVERSAL / VOID / CONTRA LIFECYCLE (closes the flatten→report gap
// that let CR-1 survive). The GAAP invariant suite validated reversals at the
// LINE level; this one runs booking + its live reversal through the REAL
// flattenJournalEntries and asserts EVERY report surface nets correctly.
//
// Design mirrors the app: void/reverse KEEPS the original live and posts a live
// reversing entry (opposite legs). So both are in `invoices`; the reports must net.
// ════════════════════════════════════════════════════════════════════════════

const CASH = "1000", AR = "1100", AP = "2000", REV = "4000", EXP = "6500";
const YTD = { from: "2026-01-01", to: "2026-12-31" };

// DB-shaped entry as Supabase returns it to flattenJournalEntries.
const dbEntry = (id, date, lines, over = {}) => ({
  id, entry_date: date, description: over.description || `${id}`,
  source: over.source || "manual", status: over.status || "posted", deleted_at: over.deleted_at || null,
  created_at: `${date}T10:00:00Z`, import_metadata: over.import_metadata || null,
  journal_entry_lines: lines.map(l => ({
    debit: l.debit || 0, credit: l.credit || 0,
    accounts: { code: l.code, name: l.name || l.code },
  })),
});
// Reverse a set of lines (swap debit<->credit) — mirrors buildReversalLines.
const reversed = (lines) => lines.map(l => ({ code: l.code, debit: l.credit || 0, credit: l.debit || 0 }));

// The accounting equation must hold on the flattened ledger at every step:
// Σ assets(1) = Σ liab(2) + Σ equity(3) + (Σ revenue(4) − Σ expense(5–8)).
function equationResidual(flat) {
  const bal = code => glAccountBalance(code, flat);
  const codesTouched = new Set();
  flat.forEach(r => { codesTouched.add(String(r.gl_code)); if (r.secondary_gl_code) codesTouched.add(String(r.secondary_gl_code)); });
  let assets = 0, liab = 0, equity = 0;
  for (const c of codesTouched) {
    const d = c[0];
    if (d === "1") assets += bal(c);
    else if (d === "2") liab += bal(c);
    else if (d === "3") equity += bal(c);
  }
  const ni = computeNetIncome(flat);
  return Math.round((assets - (liab + equity + ni)) * 100) / 100;
}

describe("Lifecycle 1 — a direct-cash expense, then VOIDED (reversal)", () => {
  const bookLines = [{ code: EXP, debit: 500 }, { code: CASH, credit: 500 }];   // Dr Expense / Cr Cash
  const booked = flattenJournalEntries([dbEntry("exp1", "2026-03-04", bookLines)]);
  const voided = flattenJournalEntries([
    dbEntry("exp1", "2026-03-04", bookLines),
    dbEntry("exp1rev", "2026-03-20", reversed(bookLines), { import_metadata: { kind: "reversal", reverses: "exp1" } }),
  ]);

  it("booked alone: expense 500, net income -500", () => {
    expect(computeExpenses(booked, YTD)).toBe(500);
    expect(computeNetIncome(booked, YTD)).toBe(-500);
  });
  it("after void: expense nets to 0 EVERYWHERE (P&L, By Category, By Vendor, glAccountBalance)", () => {
    expect(computeExpenses(voided, YTD)).toBe(0);                 // was 1000 before CR-1 fix
    expect(computeNetIncome(voided, YTD)).toBe(0);
    expect(glAccountBalance(EXP, voided)).toBe(0);
    expect(computeCategoryTotals(voided, YTD).find(c => c.gl_code === EXP)).toBeUndefined();  // zero line dropped
    expect(computeVendorTotals(voided, YTD).reduce((s, v) => s + v.total, 0)).toBe(0);
  });
  it("Income Statement and Balance Sheet agree; the accounting equation holds", () => {
    expect(equationResidual(booked)).toBe(0);
    expect(equationResidual(voided)).toBe(0);
  });
  it("cash flow (reconcile basis) also nets to zero after the void", () => {
    const net = reconBooksSet(voided, { cashCodes: [CASH] }).reduce((s, r) => s + cashLegSigned(r, [CASH]), 0);
    expect(Math.round(net * 100) / 100).toBe(0);   // -500 out + 500 back in
  });
});

describe("Lifecycle 2 — revenue booked, then REFUNDED (contra-revenue / credit memo)", () => {
  const sale = [{ code: CASH, debit: 1000 }, { code: REV, credit: 1000 }];        // Dr Cash / Cr Revenue
  const refund = [{ code: REV, debit: 400 }, { code: CASH, credit: 400 }];        // Dr Revenue / Cr Cash (partial refund)
  const flat = flattenJournalEntries([
    dbEntry("sale1", "2026-04-02", sale),
    dbEntry("refund1", "2026-04-10", refund, { description: "Credit memo" }),
  ]);
  it("refund REDUCES revenue (Dr Revenue subtracts) — 1000 − 400 = 600", () => {
    expect(computeRevenue(flat, YTD)).toBe(600);                  // was 1400 before CR-2 fix
    expect(glAccountBalance(REV, flat)).toBe(600);               // BS path agrees (no force-credit)
    expect(computeNetIncome(flat, YTD)).toBe(600);
  });
  it("full refund nets revenue to zero everywhere", () => {
    const full = flattenJournalEntries([
      dbEntry("sale2", "2026-04-02", sale),
      dbEntry("refund2", "2026-04-10", [{ code: REV, debit: 1000 }, { code: CASH, credit: 1000 }]),
    ]);
    expect(computeRevenue(full, YTD)).toBe(0);
    expect(glAccountBalance(REV, full)).toBe(0);
    expect(equationResidual(full)).toBe(0);
  });
});

describe("Lifecycle 3 — accrual bill → paid → VOIDED", () => {
  const bill = [{ code: EXP, debit: 700 }, { code: AP, credit: 700 }];            // Dr Expense / Cr A/P
  const pay = [{ code: AP, debit: 700 }, { code: CASH, credit: 700 }];            // Dr A/P / Cr Cash

  it("bill alone: expense 700; A/P owed 700; no cash moved", () => {
    const f = flattenJournalEntries([dbEntry("bill1", "2026-05-01", bill)]);
    expect(computeExpenses(f, YTD)).toBe(700);
    expect(glAccountBalance(AP, f)).toBe(700);
    expect(reconBooksSet(f, { cashCodes: [CASH] })).toHaveLength(0);   // accrual bill absent from cash flow
  });
  it("bill + payment: expense still 700 (not 1400); A/P back to 0; cash out 700", () => {
    const f = flattenJournalEntries([dbEntry("bill2", "2026-05-01", bill), dbEntry("pay2", "2026-05-15", pay)]);
    expect(computeExpenses(f, YTD)).toBe(700);                    // payment is balance-sheet only, doesn't re-hit P&L
    expect(glAccountBalance(AP, f)).toBe(0);
    const cashNet = reconBooksSet(f, { cashCodes: [CASH] }).reduce((s, r) => s + cashLegSigned(r, [CASH]), 0);
    expect(cashNet).toBe(-700);
    expect(equationResidual(f)).toBe(0);
  });
  it("bill + payment + void of the bill: expense 0, A/P 0, equation holds", () => {
    const f = flattenJournalEntries([
      dbEntry("bill3", "2026-05-01", bill),
      dbEntry("pay3", "2026-05-15", pay),
      dbEntry("bill3rev", "2026-05-20", reversed(bill), { import_metadata: { kind: "reversal", reverses: "bill3" } }),
    ]);
    expect(computeExpenses(f, YTD)).toBe(0);                      // bill and its reversal net
    expect(computeNetIncome(f, YTD)).toBe(0);
    expect(equationResidual(f)).toBe(0);                          // still balances after the whole lifecycle
  });
});

describe("KPIs inherit the fix (no double-count after a void)", () => {
  it("gross margin / revenue behave on netted figures", () => {
    const sale = [{ code: CASH, debit: 1000 }, { code: REV, credit: 1000 }];
    const f = flattenJournalEntries([
      dbEntry("s", "2026-06-01", sale),
      dbEntry("srev", "2026-06-05", reversed(sale), { import_metadata: { kind: "reversal", reverses: "s" } }),
    ]);
    // revenue nets to 0 → KPIs must not report the gross 1000 (or 2000)
    expect(computeRevenue(f, YTD)).toBe(0);
    const kpis = computeKPIs(f, { cashBalance: 0, now: new Date("2026-06-30T12:00:00") });
    const gm = kpis.find(k => k.key === "gross_margin");
    expect(gm.status).toBe("na");   // no revenue after the wash → margin N/A, not computed off a phantom 1000
  });
});

// ── CR-17: reversal idempotency is GL-truth (a repeat void is provably inert) ──
import { alreadyReversed } from "../src/lib/ledger.js";

describe("reversal idempotency guard (CR-17) — GL-truth, no double-negation", () => {
  const sale = [{ code: CASH, debit: 1000 }, { code: REV, credit: 1000 }];
  // The live reversal carries import_metadata.reverses = the original's id (written
  // atomically with the entry now, so this marker exists iff the reversal was posted).
  const reversalRow = { id: "revX", db_entry_id: "revX", date: "2026-04-10", amount: 1000,
    gl_code: REV, secondary_gl_code: CASH, debit_credit: "debit", type: "revenue",
    import_metadata: { kind: "reversal", reverses: "saleX" } };

  it("detects an existing LIVE reversal → a repeat reverse is blocked", () => {
    const ledger = [
      { id: "saleX", db_entry_id: "saleX", date: "2026-04-02", amount: 1000, gl_code: REV, secondary_gl_code: CASH, debit_credit: "credit", type: "revenue" },
      reversalRow,
    ];
    expect(alreadyReversed(ledger, "saleX")).toBe(true);   // guard fires → reverseJournalEntry returns early, no 2nd reversal
  });

  it("a not-yet-reversed entry is reversible; a voided/deleted reversal does NOT count", () => {
    expect(alreadyReversed([{ id: "saleX" }], "saleX")).toBe(false);
    expect(alreadyReversed([{ ...reversalRow, status: "voided" }], "saleX")).toBe(false);
    expect(alreadyReversed([{ ...reversalRow, deleted_at: "2026-04-11T00:00:00Z" }], "saleX")).toBe(false);
  });

  it("net income after ONE reversal is 0, and the guard prevents a 2nd (which would double-negate to −1000)", () => {
    const oneReversal = flattenJournalEntries([
      dbEntry("saleX", "2026-04-02", sale),
      dbEntry("revX", "2026-04-10", reversed(sale), { import_metadata: { kind: "reversal", reverses: "saleX" } }),
    ]);
    expect(computeNetIncome(oneReversal, YTD)).toBe(0);        // sale + its reversal net to zero
    expect(alreadyReversed(oneReversal, "saleX")).toBe(true);  // a repeat void is refused → never becomes −1000
  });
});

// ── CR-21: the App memo substitution (netIncome = r2(rev − exp), no double-walk) ──
// is numerically identical to the canonical computeNetIncome — even under reversals.
// (App.jsx computes netIncome from the memoized totalRevenue/totalExpenses instead of
//  calling computeNetIncome, which would re-walk the ledger twice more. Locks equivalence.)
describe("CR-21 memo equivalence — net income from rev/exp memos === computeNetIncome", () => {
  const r2 = n => Math.round(n * 100) / 100;
  const cases = {
    "normal": [dbEntry("s", "2026-03-01", [{ code: CASH, debit: 1000 }, { code: REV, credit: 1000 }]),
               dbEntry("e", "2026-03-02", [{ code: EXP, debit: 400 }, { code: CASH, credit: 400 }])],
    "with a reversal": [dbEntry("s2", "2026-03-01", [{ code: EXP, debit: 500 }, { code: CASH, credit: 500 }]),
               dbEntry("s2r", "2026-03-10", reversed([{ code: EXP, debit: 500 }, { code: CASH, credit: 500 }]), { import_metadata: { kind: "reversal", reverses: "s2" } })],
    "empty": [],
  };
  for (const [name, entries] of Object.entries(cases)) {
    it(`matches for: ${name}`, () => {
      const flat = flattenJournalEntries(entries);
      const memoNet = r2(computeRevenue(flat, YTD) - computeExpenses(flat, YTD));  // the App substitution
      expect(memoNet).toBe(computeNetIncome(flat, YTD));                            // the canonical path
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// O123 — VOID IS IDEMPOTENT, AND ITS GUARD IS ONLY REAL IF THE MARKER IS WRITTEN.
//
// ★★ THE LIVE FAILURE THIS PINS. `reverseJournalEntry` posted with
// `p_meta: { kind:'reversal', reverses: origId }` — and `post_journal_entry`
// (migration 010) cherry-picks SIX named scalars out of p_meta and never writes
// `import_metadata` at all (O95). So `reverses` was discarded on every reversal ever
// posted, BOTH idempotency guards were permanently false, and the O8 display marker had
// nothing to read. One Hill Country invoice was reversed THREE times — −937.00 against a
// single 468.50 charge, three clicks twenty seconds apart, because nothing on screen
// changed and the button stayed enabled.
//
// ★ AND IT IS THE FIRST p_meta VICTIM THAT FAILS **OPEN**. Payroll failed closed (asked a
// human); depreciation failed closed (posted nothing). This one CREATES WRONG ENTRIES,
// one per click, with no ceiling.
// ════════════════════════════════════════════════════════════════════════════
describe("★★ O123 — the double-reversal, and the guard that has to stop it", () => {
  const orig = () => dbEntry("HC", "2026-08-06", [{ code: EXP, debit: 468.50 }, { code: CASH, credit: 468.50 }]);
  const rev = (id, date) => dbEntry(id, date, reversed([{ code: EXP, debit: 468.50 }, { code: CASH, credit: 468.50 }]),
                                    { import_metadata: { kind: "reversal", reverses: "HC" } });

  it("ONE reversal nets the charge to zero — the correct outcome", () => {
    const flat = flattenJournalEntries([orig(), rev("r1", "2026-08-27")]);
    expect(glAccountBalance(EXP, flat, { asOf: "2026-12-31" })).toBe(0);
  });

  it("★ THREE reversals put the ledger 937.00 the WRONG side of zero — the live damage", () => {
    // Reproduces the production shape exactly: one debit, three credits. Recorded as a
    // number rather than a description so the repair has something to be checked against.
    const flat = flattenJournalEntries([orig(), rev("r1", "2026-08-27"), rev("r2", "2026-08-27"), rev("r3", "2026-08-27")]);
    expect(glAccountBalance(EXP, flat, { asOf: "2026-12-31" })).toBe(-937.00);
  });

  it("★★ the guard catches the second click — BUT ONLY IF THE MARKER IS ON THE ROW", async () => {
    const { alreadyReversed } = await import("../src/lib/ledger.js");
    const flat = flattenJournalEntries([orig(), rev("r1", "2026-08-27")]);
    expect(alreadyReversed(flat, "HC")).toBe(true);

    // ★ THE BUG, STATED AS A TEST. Strip `import_metadata` — which is precisely what the
    // RPC did to every reversal in production — and the guard goes quietly false while
    // the reversing entry is sitting right there in the ledger.
    const stripped = flattenJournalEntries([orig(), dbEntry("r1", "2026-08-27",
      reversed([{ code: EXP, debit: 468.50 }, { code: CASH, credit: 468.50 }]))]);
    expect(alreadyReversed(stripped, "HC")).toBe(false);
  });

  it("a soft-deleted or voided reversal does NOT count — undo must re-enable the void", async () => {
    const { alreadyReversed } = await import("../src/lib/ledger.js");
    const undone = flattenJournalEntries([orig(),
      dbEntry("r1", "2026-08-27", reversed([{ code: EXP, debit: 468.50 }, { code: CASH, credit: 468.50 }]),
              { import_metadata: { kind: "reversal", reverses: "HC" }, deleted_at: "2026-08-28T00:00:00Z" })]);
    expect(alreadyReversed(undone, "HC")).toBe(false);
  });
});

// ── THE SOURCE CONTRACT ──────────────────────────────────────────────────────
// ★★ A UNIT TEST CANNOT REACH THIS BUG: it lived on the far side of the RPC boundary,
// where the client's p_meta went in and nothing came out. What IS checkable from here is
// that the caller no longer DEPENDS on that boundary — the marker must be written by a
// follow-up checked update (the remedy ·3c applied to payroll and depreciation, and
// missed here), never by p_meta alone.
describe("★★ the reversal marker is written AFTER the post, not through p_meta", () => {
  const fs = require("node:fs"), path = require("node:path");
  const src = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const raw = src.slice(src.indexOf("const reverseJournalEntry"), src.indexOf("const voidInvoiceWithUndo"));
  const body = raw;
  // Comments stripped for the "no longer claims" check below: this suite QUOTES the old
  // false comment in order to explain it, and a guard that matches its own explanation is
  // the C202 false positive all over again.
  const code = raw.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("finds the reversal path", () => { expect(body.length).toBeGreaterThan(500); });

  it("★ issues a checkedRowUpdate stamping import_metadata.reverses on the posted reversal", () => {
    expect(body).toMatch(/checkedRowUpdate\(/);
    const stamp = body.slice(body.indexOf("checkedRowUpdate("));
    expect(stamp).toMatch(/table:\s*"journal_entries"/);
    expect(stamp).toMatch(/import_metadata:\s*\{[^}]*reverses/);
  });

  it("★ a failed stamp is AUDITED and SAID OUT LOUD — here the stamp is the only guard", () => {
    // Depreciation has `status='pending'` behind it; payroll only loses norm history.
    // Nothing else stops a second reversal, so a silent stamp failure is a live
    // double-post hazard rather than a degraded feature.
    expect(body).toMatch(/reversal_stamp_failed/);
    expect(body).toMatch(/showNotification\(/);
  });

  it("★ no longer claims p_meta persists import_metadata", () => {
    // The old comment asserted exactly that, and was the reason no follow-up stamp was
    // written. A comment that states a false contract is how this survived a green suite.
    expect(code).not.toMatch(/p_meta persists to/);
    expect(code).not.toMatch(/marker is written iff the entry is posted/);
  });
});
