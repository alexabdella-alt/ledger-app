import { describe, it, expect } from "vitest";
import { bankTxnKey, markAlreadyBooked } from "../src/lib/openingBalanceProposal.js";
import { buildBankLineEntry, planBankImport } from "../src/lib/bankMatch.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ RE-UPLOADING A STATEMENT MUST NEVER DOUBLE-BOOK IT.
//
// This is the O83 production incident: re-uploading one statement double-booked 14 of 20 lines,
// because the dedup key mixed the CLEANED vendor on the booked side with the RAW memo on the
// re-parse side — two strings that never collide. The key is now date + amount + direction ONLY,
// deliberately, and the trade-off is written into its comment.
//
// ★★ IT HAS BEEN TESTED ON HAND-PICKED CASES. This sweeps it: many statement shapes, the
// round-trip asserted every time — book the lines, re-parse the SAME statement, and every line
// must come back marked. **A single unmarked line is a double-post.**
// ─────────────────────────────────────────────────────────────────────────────

const CASH = "1000";
const ymd = (m, d) => `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// Statement shapes chosen for the ways a dedup key can fail: repeats, sign flips, cents,
// same-day clusters, and the known same-key collision.
const SHAPES = {
  ordinary: [
    { id: "t1", date: ymd(1, 4), amount: -551.2, description: "ACH DEBIT - ROMA CHEESE", type: "expense", gl_code: "5000" },
    { id: "t2", date: ymd(1, 7), amount: 9200.15, description: "TOAST DEPOSIT", type: "revenue", gl_code: "4000" },
    { id: "t3", date: ymd(1, 11), amount: -145, description: "BLUEBONNET LINEN", type: "expense", gl_code: "6100" },
  ],
  sameDaySameAmount: [
    { id: "s1", date: ymd(2, 3), amount: -145, description: "LINEN A", type: "expense", gl_code: "6100" },
    { id: "s2", date: ymd(2, 3), amount: -145, description: "LINEN B", type: "expense", gl_code: "6100" },
    { id: "s3", date: ymd(2, 3), amount: -145, description: "LINEN C", type: "expense", gl_code: "6100" },
  ],
  bothDirections: [
    { id: "b1", date: ymd(3, 9), amount: -420.5, description: "OUT", type: "expense", gl_code: "6100" },
    { id: "b2", date: ymd(3, 9), amount: 420.5, description: "IN", type: "revenue", gl_code: "4000" },
  ],
  awkwardCents: [
    { id: "c1", date: ymd(4, 1), amount: -0.01, description: "TINY", type: "expense", gl_code: "6100" },
    { id: "c2", date: ymd(4, 2), amount: -33.335, description: "THIRD OF A CENT", type: "expense", gl_code: "6100" },
    { id: "c3", date: ymd(4, 3), amount: -99999.99, description: "BIG", type: "expense", gl_code: "6100" },
  ],
  monthBoundary: [
    { id: "m1", date: ymd(1, 31), amount: -300, description: "LAST DAY", type: "expense", gl_code: "6100" },
    { id: "m2", date: ymd(2, 1), amount: -300, description: "FIRST DAY", type: "expense", gl_code: "6100" },
  ],
};

// ★ THE REAL BOOKED ROW, not a hand-made imitation. `buildBankLineEntry` RETURNS the flattened
// ledger row (gl_code / secondary_gl_code / debit_credit), which is exactly what the dedup
// reads back on a re-upload — so the round-trip below is the actual one. My first version
// wrapped it and derived `debit_credit` from a `lines` array it does not have, which silently
// made every expense look like money coming IN.
const book = (txns) => txns.map((t, i) => ({
  ...buildBankLineEntry(t, { offsetCode: CASH, offsetName: "Cash" }),
  id: `booked${i}`,
  // ★★★ THE ASYMMETRY THAT CAUSED O83, REPRODUCED. At booking time the vendor is CLEANED and
  // the memo REWRITTEN ("Toast POS – TOAST POS DEPOSIT 0113"); a re-parse of the same statement
  // yields the RAW memo ("TOAST POS DEPOSIT 011326"), and the GL can even be re-categorised
  // run-to-run. **A mutation proved my first fixture could not catch this**: it passed the same
  // description to both sides, so putting the description back into the dedup key — the exact
  // production bug — left every test green. A fixture that agrees with itself proves nothing.
  vendor: `Cleaned ${String(t.description || "").split(" ")[0]}`,
  description: `${String(t.description || "").split(" ")[0]} – ${t.description}`,
  gl_code: t.type === "revenue" ? "4000" : "7100",   // re-categorised, as it does in the wild
}));

describe("★★★ a re-uploaded statement is fully recognised, on every shape", () => {
  it.each(Object.keys(SHAPES))("%s — every line comes back marked already-booked", (name) => {
    const txns = SHAPES[name];
    const marked = markAlreadyBooked(txns, book(txns), { offsetCode: CASH });
    const unmarked = marked.filter((m) => !m.already_booked);
    if (unmarked.length) {
      throw new Error(`${name}: ${unmarked.length} of ${txns.length} line(s) would be booked AGAIN — ${unmarked.map((u) => `${u.date} ${u.amount}`).join(", ")}`);
    }
    expect(marked.length).toBe(txns.length);
  });

  it("★★ and a genuinely NEW line in a re-upload is NOT marked — otherwise nothing would ever book", () => {
    const first = SHAPES.ordinary;
    const second = [...first, { id: "new", date: ymd(1, 20), amount: -777.77, description: "NEW CHARGE", type: "expense", gl_code: "6100" }];
    const marked = markAlreadyBooked(second, book(first), { offsetCode: CASH });
    expect(marked.filter((m) => m.already_booked).length).toBe(first.length);
    expect(marked.find((m) => m.id === "new").already_booked).toBe(false);
  });

  it("★★★ MULTISET: three identical lines need three bookings — two bookings leave one unmarked", () => {
    // The trade-off in the key's own comment: identical lines collide. What must NOT happen is
    // one booking marking all three, which would silently drop two real charges.
    const three = SHAPES.sameDaySameAmount;
    const twoBooked = book(three.slice(0, 2));
    const marked = markAlreadyBooked(three, twoBooked, { offsetCode: CASH });
    expect(marked.filter((m) => m.already_booked).length).toBe(2);
    expect(marked.filter((m) => !m.already_booked).length).toBe(1);
  });
});

describe("★★ what must NOT count as already booked", () => {
  it("★★★ a VOIDED or soft-deleted booking does not block a re-book", () => {
    // Otherwise reversing a wrong entry would make the correct one un-bookable — the money
    // would be missing from the books with no way to put it back through the statement.
    const txns = SHAPES.ordinary;
    for (const dead of [{ status: "voided" }, { status: "deleted" }, { deleted_at: "2026-08-01T00:00:00Z" }]) {
      const ledger = book(txns).map((r) => ({ ...r, ...dead }));
      const marked = markAlreadyBooked(txns, ledger, { offsetCode: CASH });
      expect(marked.every((m) => !m.already_booked)).toBe(true);
    }
  });

  it("★ a booking against a DIFFERENT account does not count", () => {
    const txns = SHAPES.ordinary;
    const otherAccount = book(txns).map((r) => ({ ...r, secondary_gl_code: "2200" }));
    const marked = markAlreadyBooked(txns, otherAccount, { offsetCode: CASH });
    expect(marked.every((m) => !m.already_booked)).toBe(true);
  });

  it("★★ the same amount in the OPPOSITE direction is a different line", () => {
    // A $420.50 payment and a $420.50 refund on one day are two events, not one.
    const [out, incoming] = SHAPES.bothDirections;
    const marked = markAlreadyBooked([out, incoming], book([out]), { offsetCode: CASH });
    expect(marked.find((m) => m.id === "b1").already_booked).toBe(true);
    expect(marked.find((m) => m.id === "b2").already_booked).toBe(false);
  });

  it("★ a line one day either side is a different line", () => {
    const [last, first] = SHAPES.monthBoundary;
    const marked = markAlreadyBooked([last, first], book([last]), { offsetCode: CASH });
    expect(marked.find((m) => m.id === "m1").already_booked).toBe(true);
    expect(marked.find((m) => m.id === "m2").already_booked).toBe(false);
  });
});

describe("★★ the key itself is stable and direction-aware", () => {
  it("ignores sign but not direction, and rounds to cents", () => {
    expect(bankTxnKey({ date: "2026-01-04", amount: -551.2, direction: "out" }))
      .toBe(bankTxnKey({ date: "2026-01-04", amount: 551.2, direction: "out" }));
    expect(bankTxnKey({ date: "2026-01-04", amount: 551.2, direction: "in" }))
      .not.toBe(bankTxnKey({ date: "2026-01-04", amount: 551.2, direction: "out" }));
    expect(bankTxnKey({ date: "2026-01-04", amount: 33.335, direction: "out" }))
      .toBe(bankTxnKey({ date: "2026-01-04", amount: 33.34, direction: "out" }));
  });

  it("★ an unknown direction defaults to 'out' rather than minting a third key space", () => {
    expect(bankTxnKey({ date: "2026-01-04", amount: 10 }))
      .toBe(bankTxnKey({ date: "2026-01-04", amount: 10, direction: "out" }));
  });
});

describe("★★★ no statement line is silently dropped by the import planner", () => {
  it("every parsed line lands in exactly one bucket", () => {
    // A line that reaches no bucket is money that neither books, clears, nor asks — the
    // quietest possible failure on the path most transactions take.
    for (const [name, txns] of Object.entries(SHAPES)) {
      const plan = planBankImport({ parsedTxns: txns, autoCleared: [], queue: [], openItems: [], codes: { apCode: "2000", arCode: "1200", cashCode: CASH, cashName: "Cash" } });
      const accounted = new Set([
        ...(plan.clears || []).flatMap((c) => (c.bank_txn_id != null ? [String(c.bank_txn_id)] : [])),
        ...(plan.standalone || []).map((s) => String(s.bank_txn_id ?? s.id)),
        ...(plan.review || []).map((r) => String(r.bank_txn_id)),
        ...(plan.skipped || []).map((s) => String(s.bank_txn_id ?? s.id)),
      ]);
      const lost = txns.filter((t) => !accounted.has(String(t.id)));
      if (lost.length) throw new Error(`${name}: ${lost.length} line(s) reached no bucket — ${lost.map((l) => l.id).join(", ")}`);
    }
    expect(Object.keys(SHAPES).length).toBe(5);
  });
});
