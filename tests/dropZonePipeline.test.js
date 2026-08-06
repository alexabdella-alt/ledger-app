import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  autoBindAccount, shouldAutoCompleteReconciliation, intakeAdvanceFromLines,
  dropZoneOutcomeCopy, pendingStatementStashes, buildStashDetail,
  STASH_DETAIL_MARKER, STASH_WAITING_COPY, STASH_PICKUP_LABEL,
  autoReconciledAuditDetail,
} from "../src/lib/statementLifecycle.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C198·2 — the drop IS the pipeline (§11 ★ O86 (a)).
//
// DESIGN DECISION (Alex, 2026-08-06): on a verified tie the MACHINE completes the
// reconciliation. Reconciliation is arithmetic (machine-verifiable); sign-off is
// judgment (human, always). C194 is unchanged and absolute — a row may only be
// created complete when the balance verifiably ties.
// ════════════════════════════════════════════════════════════════════════════

const SETTLED = ["booked", "matched", "already_booked"];
const stmt = { id: "s1", status: "attention", bank_account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30", stated_ending_balance: 46434.91 };

describe("(a1) a single-account company auto-binds; anything else stashes", () => {
  it("exactly ONE account → bind it (no ambiguity, so no human needed)", () => {
    const acct = { id: "a1", name: "Primary Checking", gl_code: "1000" };
    expect(autoBindAccount([acct])).toBe(acct);
  });
  it("ZERO accounts → no bind (nothing to bind to)", () => {
    expect(autoBindAccount([])).toBeNull();
  });
  it("TWO accounts → no bind: which account this belongs to is a real choice", () => {
    expect(autoBindAccount([{ id: "a1" }, { id: "a2" }])).toBeNull();
  });
  it("an account with no id can't be bound to anything", () => {
    expect(autoBindAccount([{ name: "orphan" }])).toBeNull();
    expect(autoBindAccount([{ name: "orphan" }, { id: "a1", name: "real" }]).id).toBe("a1");
  });
});

describe("(a2) the machine reconciles ONLY on a verified tie (C194 is absolute)", () => {
  it("all lines settled + the balance ties + nothing covers the period → auto-complete", () => {
    expect(shouldAutoCompleteReconciliation({ statement: stmt, lineStatuses: SETTLED, reconciliations: [], balanceSettled: true })).toBe(true);
  });

  it("★ NO TIE → NO ROW. Never manufactures a reconciliation, only records a proven one", () => {
    expect(shouldAutoCompleteReconciliation({ statement: stmt, lineStatuses: SETTLED, reconciliations: [], balanceSettled: false })).toBe(false);
  });

  it("an open line → no auto-complete (the statement isn't finished)", () => {
    expect(shouldAutoCompleteReconciliation({ statement: stmt, lineStatuses: ["booked", "excepted"], reconciliations: [], balanceSettled: true })).toBe(false);
  });

  it("NEVER duplicates: a period already covered by a complete reconciliation is skipped", () => {
    const covered = [{ status: "complete", account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30" }];
    expect(shouldAutoCompleteReconciliation({ statement: stmt, lineStatuses: SETTLED, reconciliations: covered, balanceSettled: true })).toBe(false);
    // …but an OPEN session isn't coverage — it hasn't proven anything yet.
    expect(shouldAutoCompleteReconciliation({ statement: stmt, lineStatuses: SETTLED, reconciliations: [{ ...covered[0], status: "open" }], balanceSettled: true })).toBe(true);
  });

  it("a statement with NO lines never auto-completes (zero-of-zero is the vacuous pass)", () => {
    expect(shouldAutoCompleteReconciliation({ statement: stmt, lineStatuses: [], reconciliations: [], balanceSettled: true })).toBe(false);
  });

  it("the audit sentence says plainly what the machine did, with no jargon", () => {
    const d = autoReconciledAuditDetail({ monthLabel: "June 2026", accountName: "Primary Checking" });
    expect(d).toMatch(/automatically/i);
    expect(d).toMatch(/matched your books exactly/);
    expect(d).toMatch(/June 2026/);
    expect(containsOwnerJargon(d)).toBe(false);
  });
});

describe("(a1) the owner is told the OUTCOME, in their own words", () => {
  it("a clean run names the whole statement and the bank match", () => {
    const c = dropZoneOutcomeCopy({ total: 21, booked: 21, exceptions: 0, reconciled: true });
    expect(c).toBe("All 21 transactions from your statement are in your books, and everything matches your bank to the penny.");
    expect(containsOwnerJargon(c)).toBe(false);
  });
  it("a clean run that did NOT reconcile does not claim it did", () => {
    const c = dropZoneOutcomeCopy({ total: 21, booked: 21, exceptions: 0, reconciled: false });
    expect(c).toContain("in your books");
    expect(c).not.toMatch(/matches your bank/);
    expect(containsOwnerJargon(c)).toBe(false);
  });
  it("a partial run splits what happened from what's waiting on a human", () => {
    const c = dropZoneOutcomeCopy({ total: 21, booked: 16, exceptions: 5, reconciled: false });
    expect(c).toBe("16 added to your books — 5 need your accountant's eyes first.");
    expect(containsOwnerJargon(c)).toBe(false);
  });
  it("singular is grammatical, and an empty parse is admitted rather than dressed up", () => {
    expect(dropZoneOutcomeCopy({ total: 3, booked: 2, exceptions: 1 })).toContain("1 needs your accountant's eyes");
    expect(dropZoneOutcomeCopy({ total: 1, booked: 1, exceptions: 0, reconciled: true })).toContain("All 1 transaction from your statement is in your books");
    const empty = dropZoneOutcomeCopy({ total: 0 });
    expect(empty).toMatch(/couldn't find any transactions/i);
    expect(containsOwnerJargon(empty)).toBe(false);
  });
});

describe("(a3) the stash survives navigation", () => {
  const rows = [
    { id: "i1", status: "held_for_review", document_id: "d1", filename: "june.pdf", detail: buildStashDetail({ fileName: "june.pdf" }), received_at: "2026-08-06T10:00:00Z" },
    { id: "i2", status: "held_for_review", document_id: "d2", filename: "may.pdf", detail: buildStashDetail({ fileName: "may.pdf" }), received_at: "2026-08-06T12:00:00Z" },
  ];

  it("a stashed statement is found again from the intake ledger, newest first", () => {
    const out = pendingStatementStashes(rows);
    expect(out.map(r => r.id)).toEqual(["i2", "i1"]);
    expect(buildStashDetail({ fileName: "june.pdf" })).toContain(STASH_DETAIL_MARKER);
  });

  it("a stash with no stored document is NOT offered (there'd be nothing to pick up)", () => {
    expect(pendingStatementStashes([{ ...rows[0], document_id: null }])).toEqual([]);
  });

  it("it disappears by itself once recorded — no separate cleanup to forget", () => {
    expect(pendingStatementStashes([{ ...rows[0], status: "recorded" }])).toEqual([]);
  });

  it("other held documents (an invoice awaiting review) are not mistaken for statements", () => {
    expect(pendingStatementStashes([{ ...rows[0], detail: "routed to the clarification queue" }])).toEqual([]);
  });

  it("the pickup copy assumes zero accounting knowledge", () => {
    expect(containsOwnerJargon(STASH_WAITING_COPY)).toBe(false);
    expect(containsOwnerJargon(STASH_PICKUP_LABEL)).toBe(false);
  });
});

describe("(a4) the intake ledger advances when the work is actually done", () => {
  it("every line in the books → RECORDED", () => {
    expect(intakeAdvanceFromLines(SETTLED)).toBe("recorded");
  });
  it("a line still open → stays HELD (honest: it IS still held)", () => {
    expect(intakeAdvanceFromLines(["booked", "excepted"])).toBeNull();
    expect(intakeAdvanceFromLines(["pending"])).toBeNull();
  });
  it("no lines at all → no advance", () => {
    expect(intakeAdvanceFromLines([])).toBeNull();
  });
});

// ── Source contracts (no DOM in this suite): the paths the drive found dead. ──
describe("(wiring) the drop reaches the pipeline, and the stash reaches storage", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const bank = fs.readFileSync(new URL("../src/components/views/BankView.jsx", import.meta.url), "utf8");

  it("(a1) the universal bank branch auto-binds and runs the SAME handleBankFile pipeline", () => {
    expect(app).toMatch(/const soleAccount = autoBindAccount\(bankAccounts\);/);
    expect(app).toMatch(/await handleBankFile\(file, soleAccount, \{ intakeId: item\.intake_id \}\);/);
    // one arrival = one intake row (a second would look like a second document)
    expect(app).toMatch(/if \(!callerIntakeId\) logIntake\(bankIntakeId, file, "bank"\);/);
  });

  it("(a2) auto-completion re-asserts the SAME gate ReconView's button honours", () => {
    const start = app.indexOf("const completeReconciliationIfSettled");
    expect(start).toBeGreaterThan(0);
    const body = app.slice(start, app.indexOf("\n  // The single \"what happens", start));
    expect(body).toMatch(/shouldAutoCompleteReconciliation\(/);
    expect(body).toMatch(/if \(!canCompleteReconciliation\(/);     // C194's own helper, immediately before the insert
    expect(body).toMatch(/completePipelineReconciliation\(/);       // the existing writer, not a second one
    expect(body).toMatch(/AUTO_RECONCILED_AUDIT/);                  // auto-vs-manual marker lives in the audit log
  });

  it("(a2) the offer is the FALLBACK — only when auto-completion declined", () => {
    expect(app).toMatch(/reconciled = await completeReconciliationIfSettled\(rv, \{ account \}\);\s*\n\s*if \(!reconciled\) offerReconciliation/);
  });

  it("(a3) the stash is written to document storage and read back from the intake ledger", () => {
    expect(app).toMatch(/markIntake\(item\.intake_id, INTAKE_STATUS\.HELD, \{ detail: buildStashDetail\(/);
    expect(app).toMatch(/documentId: stashDocId/);
    expect(bank).toMatch(/pendingStatementStashes\(/);
    expect(bank).toMatch(/storage\.from\("documents"\)\.download\(/);
    expect(bank).toMatch(/handleBankFile\(file, importAccount, \{ intakeId: stash\.id \}\)/);
  });

  it("(a4) the intake row advances to RECORDED with its journal-entry linkage", () => {
    expect(app).toMatch(/intakeAdvanceFromLines\(rv\.lineStatuses \|\| \[\]\)/);
    expect(app).toMatch(/markIntake\(intakeId, INTAKE_STATUS\.RECORDED, \{ detail: [\s\S]{0,120}journalEntryIds: jeIds \}\)/);
  });
});
