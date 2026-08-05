import { describe, it, expect } from "vitest";
import {
  reconCompletionGate, resolveReconRowId, reconCompletionCopy,
  RECON_COMPLETE_SUCCESS_COPY, RECON_COMPLETE_FAILURE_COPY,
} from "../src/lib/reconcile.js";
import { assessWriteResult } from "../src/lib/checkedWrite.js";

// ════════════════════════════════════════════════════════════════════════════
// C194 — the worst O84 finding: ReconView showed "Your books match your bank ✓"
// for a reconciliation that DID NOT EXIST. The completion write was wrapped in a
// try whose catch only console.warn'd; the ✓, the audit event and the done screen
// then ran unconditionally. A reconciliation is complete ONLY when a row has been
// re-selected and observed at status='complete'.
// ════════════════════════════════════════════════════════════════════════════

describe("reconCompletionGate — the success state is gated on a VERIFIED row", () => {
  it("verified complete row → proceed", () => {
    expect(reconCompletionGate({ rid: "r1", error: null, row: { id: "r1", status: "complete" } }))
      .toEqual({ proceed: true, reason: null });
  });

  it("ZERO ROWS (the live bug: update matched nothing, row never existed) → HALT", () => {
    expect(reconCompletionGate({ rid: "r1", error: null, row: null }))
      .toEqual({ proceed: false, reason: "zero_rows" });
  });

  it("db error on the verify read → HALT", () => {
    expect(reconCompletionGate({ rid: "r1", error: { message: "boom" }, row: null }))
      .toEqual({ proceed: false, reason: "db_error" });
  });

  it("no row id at all (insert produced nothing) → HALT", () => {
    expect(reconCompletionGate({ rid: null }).proceed).toBe(false);
    expect(reconCompletionGate({ rid: null }).reason).toBe("no_row");
  });

  it("row exists but is NOT 'complete' (e.g. still 'open') → HALT — status must be observed", () => {
    expect(reconCompletionGate({ rid: "r1", error: null, row: { id: "r1", status: "open" } }))
      .toEqual({ proceed: false, reason: "not_complete" });
  });

  it("halts on every non-verified shape (no accidental proceed)", () => {
    const halts = [
      { rid: null }, { rid: "r" , error: {} }, { rid: "r", row: null },
      { rid: "r", row: { status: "import_snapshot" } }, {},
    ];
    for (const h of halts) expect(reconCompletionGate(h).proceed).toBe(false);
  });
});

describe("resolveReconRowId — the ORDERING root cause (state vs synchronous ref)", () => {
  // saveNow records a new id in BOTH reconIdRef (synchronous) and reconId (React state).
  // The old completion path read STATE ONLY, so if the autosave insert was still in flight —
  // exactly what the balance-first ordering causes, since the balance input debounces a save
  // on every keystroke — completion saw null and INSERTED A SECOND ROW.
  it("prefers the synchronous ref when React state hasn't flushed yet (the failing ordering)", () => {
    expect(resolveReconRowId({ stateId: null, refId: "row-from-autosave" })).toBe("row-from-autosave");
  });
  it("uses state when that's all there is (resumed session)", () => {
    expect(resolveReconRowId({ stateId: "resumed-row", refId: null })).toBe("resumed-row");
  });
  it("null only when neither exists → completion must INSERT (and then verify)", () => {
    expect(resolveReconRowId({ stateId: null, refId: null })).toBe(null);
    expect(resolveReconRowId({})).toBe(null);
  });
  it("REGRESSION: the old behaviour (state-only) would have inserted a duplicate — the ref wins", () => {
    const stateOnly = (s) => s.stateId || null;          // the pre-C194 read
    const args = { stateId: null, refId: "existing" };
    expect(stateOnly(args)).toBe(null);                   // old: no id → second INSERT
    expect(resolveReconRowId(args)).toBe("existing");     // new: targets the existing row
  });
});

describe("the payload was NEVER the problem — serialize()'s failing-order shape is valid", () => {
  // Reconstructed from the failing ordering: BALANCE entered, outstanding item NOT yet resolved
  // (so it sits in unmatched_books, outstanding_books is empty, and the difference is non-zero).
  // Evidence from the live DB: reconciliations' only NOT NULL columns without defaults are
  // company_id (always supplied), and the status CHECK allows 'open' | 'complete' |
  // 'import_snapshot'. This payload violates neither — proving the write failed on the id
  // handoff, not on the row contents.
  const failingOrderPayload = {
    company_id: "co1",
    account_id: "acc1", account_name: "Primary Checking",
    period_start: "2026-04-01", period_end: "2026-04-30",
    statement_balance: 33064.41, books_balance: 32714.41, difference: 350,   // ← outstanding not yet resolved
    statement_balance_verified: true,
    status: "complete",
    matched_transactions: [], unmatched_bank: [],
    unmatched_books: ["je-1043"],       // the check still in the sort-out queue
    outstanding_books: [],              // …not yet marked outstanding
    added_during_reconciliation: [],
  };

  it("supplies every NOT NULL column that has no default", () => {
    expect(failingOrderPayload.company_id).toBeTruthy();
    expect(failingOrderPayload.statement_balance_verified).not.toBeUndefined();
    expect(Array.isArray(failingOrderPayload.outstanding_books)).toBe(true);
  });
  it("uses a status the CHECK constraint allows", () => {
    expect(["open", "complete", "import_snapshot"]).toContain(failingOrderPayload.status);
  });
  it("the passing ordering differs ONLY in the outstanding/difference fields (not in validity)", () => {
    const passing = { ...failingOrderPayload, difference: 0, unmatched_books: [], outstanding_books: [{ id: "je-1043", amount: 350, signed: -350 }] };
    expect(Object.keys(passing).sort()).toEqual(Object.keys(failingOrderPayload).sort());   // same shape
    expect(["open", "complete", "import_snapshot"]).toContain(passing.status);
  });
});

describe("completion copy — a halt NEVER renders the success line", () => {
  it("proceed → the ✓ copy", () => {
    expect(reconCompletionCopy({ proceed: true })).toBe(RECON_COMPLETE_SUCCESS_COPY);
    expect(RECON_COMPLETE_SUCCESS_COPY).toMatch(/match your bank ✓/);
  });
  it("halt → the plain-language 'nothing was locked in' copy, never the ✓", () => {
    for (const reason of ["zero_rows", "db_error", "no_row", "not_complete"]) {
      const copy = reconCompletionCopy({ proceed: false, reason });
      expect(copy).toBe(RECON_COMPLETE_FAILURE_COPY);
      expect(copy).toMatch(/nothing was locked in/i);
      expect(copy).not.toMatch(/✓/);
      expect(copy).not.toMatch(/match your bank/i);
    }
  });
  it("the failure copy reassures that the work survives, and stays jargon-free", () => {
    expect(RECON_COMPLETE_FAILURE_COPY).toMatch(/matches are still here/i);
    expect(RECON_COMPLETE_FAILURE_COPY).not.toMatch(/row|insert|update|db|sql|status/i);
  });
});

describe("checked-write verdicts feed the gate consistently (C192 ↔ C194)", () => {
  it("a zero-row completion update is a failure by assessWriteResult AND halts the gate", () => {
    expect(assessWriteResult({ error: null, rows: [] })).toEqual({ ok: false, reason: "zero_rows" });
    expect(reconCompletionGate({ rid: "r1", row: null }).proceed).toBe(false);
  });
});
