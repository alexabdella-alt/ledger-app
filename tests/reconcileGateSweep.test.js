import { describe, it, expect } from "vitest";
import {
  canCompleteReconciliation, reconCompletionGate, reconcileDifference,
  resolveReconRowId, statementBalanceVerified,
} from "../src/lib/reconcile.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ THE ONE GATE THAT MUST NEVER SHOW A FALSE GREEN.
//
// C194: "Your books match your bank ✓" rendered UNGATED — a failed completion insert was
// `console.warn`'d and the success screen appeared anyway, reproduced live with NO row
// existing. §11 calls that the worst class of bug in this product: a false green on the
// attestation surface itself.
//
// The gate has hand-picked tests. **This sweeps the arithmetic underneath it**, because the
// dangerous direction is not "it refused a good month" — that is loud and someone complains —
// but "it accepted a month that is a cent out", which nobody ever sees.
// ─────────────────────────────────────────────────────────────────────────────

// Awkward on purpose: magnitudes either side of the tolerance, and figures whose cents do
// not round conveniently.
//
// ★ EVERY VALUE HAS AT MOST TWO DECIMALS, deliberately. My first version included 33333.335
// and both sweeps failed on it — but a books balance is a SUM OF TWO-DECIMAL AMOUNTS, so a
// third decimal cannot occur; the fixture was inventing an impossible input and then blaming
// the gate. (Same correction as the depreciation sweep: a third of a cent is not money.)
const BOOKS = [0, 0.01, 33.33, 1500, 12483.27, 99999.99, 33333.33, 1234567.89];
const OUTSTANDING = [0, 0.01, 275, 1043.55, 9999.99];
const UNMATCHED = [0, 0.01, 137.11];

describe("★★★ a month that genuinely ties completes; a month a cent out does not", () => {
  it("the tie is exact across every combination", () => {
    let checked = 0;
    for (const booksBalance of BOOKS) for (const outstandingSigned of OUTSTANDING) for (const unmatchedBankSigned of UNMATCHED) {
      // The statement balance that SHOULD tie, by the gate's own formula.
      const statementBalance = Math.round((booksBalance - outstandingSigned + unmatchedBankSigned) * 100) / 100;
      const difference = reconcileDifference({ statementBalance, booksBalance, outstandingSigned, unmatchedBankSigned });
      if (Math.abs(difference) >= 0.005) {
        throw new Error(`a correct month did not tie: books ${booksBalance}, outstanding ${outstandingSigned}, unmatched ${unmatchedBankSigned} → difference ${difference}`);
      }
      checked++;
    }
    expect(checked).toBe(BOOKS.length * OUTSTANDING.length * UNMATCHED.length);
  });

  it("★★★ ONE CENT OUT IS REFUSED, in both directions, on every combination", () => {
    // This is the assertion the whole file exists for. A cent accepted here is a month
    // attested as matching the bank when it does not.
    let refused = 0;
    for (const booksBalance of BOOKS) for (const outstandingSigned of OUTSTANDING) for (const unmatchedBankSigned of UNMATCHED) {
      const exact = Math.round((booksBalance - outstandingSigned + unmatchedBankSigned) * 100) / 100;
      for (const skew of [0.01, -0.01]) {
        const statementBalance = Math.round((exact + skew) * 100) / 100;
        const difference = reconcileDifference({ statementBalance, booksBalance, outstandingSigned, unmatchedBankSigned });
        if (canCompleteReconciliation({ statementBalance: String(statementBalance), difference })) {
          throw new Error(`ACCEPTED a month ${skew > 0 ? "over" : "under"} by a cent: books ${booksBalance}, statement ${statementBalance}, difference ${difference}`);
        }
        refused++;
      }
    }
    expect(refused).toBeGreaterThan(200);
  });

  it("★ and a genuinely tying month IS accepted — otherwise 'refuses a cent' is satisfied by refusing everything", () => {
    let accepted = 0;
    for (const booksBalance of BOOKS.filter((b) => b !== 0)) {
      const statementBalance = Math.round(booksBalance * 100) / 100;
      const difference = reconcileDifference({ statementBalance, booksBalance });
      expect(canCompleteReconciliation({ statementBalance: String(statementBalance), difference })).toBe(true);
      accepted++;
    }
    expect(accepted).toBeGreaterThan(5);
  });
});

describe("★★ a balance nobody entered is not a verified balance", () => {
  it("blank, whitespace and nonsense are all unverified", () => {
    for (const v of ["", "   ", null, undefined, "abc", "$", NaN]) {
      expect(statementBalanceVerified(v)).toBe(false);
      expect(canCompleteReconciliation({ statementBalance: v, difference: 0 })).toBe(false);
    }
  });

  it("★★ ZERO is refused unless explicitly confirmed — an empty field parses to 0 and would sail through", () => {
    expect(statementBalanceVerified("0")).toBe(false);
    expect(statementBalanceVerified("0", true)).toBe(true);
    expect(canCompleteReconciliation({ statementBalance: "0", difference: 0 })).toBe(false);
    expect(canCompleteReconciliation({ statementBalance: "0", difference: 0, emptyConfirmed: true })).toBe(true);
  });

  it("a negative balance is legitimate — an overdrawn account still reconciles", () => {
    expect(statementBalanceVerified("-1500.25")).toBe(true);
  });
});

describe("★★★ the completion gate refuses every way the write can fail", () => {
  it.each([
    ["no id — the write never produced one", { rid: null, error: null, row: { status: "complete" } }, "no_row"],
    ["the verify read itself failed", { rid: "r1", error: { message: "boom" }, row: null }, "db_error"],
    ["zero rows — THE live bug", { rid: "r1", error: null, row: null }, "zero_rows"],
    ["a row that is not complete", { rid: "r1", error: null, row: { status: "open" } }, "not_complete"],
  ])("★ %s", (_label, input, reason) => {
    const g = reconCompletionGate(input);
    expect(g.proceed).toBe(false);
    expect(g.reason).toBe(reason);
  });

  it("★ and it proceeds only on a verified complete row — so 'refuses' is not satisfied by refusing everything", () => {
    expect(reconCompletionGate({ rid: "r1", error: null, row: { status: "complete" } })).toEqual({ proceed: true, reason: null });
  });

  it("★★ the row id prefers the synchronous ref over React state — the ordering seam that inserted a SECOND row", () => {
    expect(resolveReconRowId({ stateId: null, refId: "ref1" })).toBe("ref1");
    expect(resolveReconRowId({ stateId: "state1", refId: "ref1" })).toBe("ref1");
    expect(resolveReconRowId({ stateId: "state1", refId: null })).toBe("state1");
    expect(resolveReconRowId({})).toBe(null);
  });
});
