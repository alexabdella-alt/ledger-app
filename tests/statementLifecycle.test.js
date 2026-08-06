import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  statementAdvanceStatus, planStatementReupload, statementReadyToReconcile,
  statementCardState, statementExceptionTarget, prefillEndingBalance, statementForPeriod,
  reconciliationCoversStatement, allLinesSettled, unsettledLineCount,
  READY_TO_RECONCILE_COPY, OPEN_RECONCILE_LABEL,
} from "../src/lib/statementLifecycle.js";
import { statementsCoveredByReconciliation } from "../src/lib/workbench.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C198·1 — statement lifecycle (§11 ★ O86 (i)–(l)). A statement could only ever
// reach 'complete' through the reconcile-completion sweep; the first-pass path
// left finished statements at 'attention' forever, and a re-upload onto one was
// silently swallowed. These pin the transitions.
// ════════════════════════════════════════════════════════════════════════════

const SETTLED = ["booked", "matched", "already_booked"];

describe("(i) first-pass completion advances the statement", () => {
  it("all lines settled + balance settled → 'complete' (the SAME status the reconcile path writes)", () => {
    expect(statementAdvanceStatus({ status: "attention", lineStatuses: SETTLED, balanceSettled: true })).toBe("complete");
    expect(statementAdvanceStatus({ status: "parsed", lineStatuses: ["booked"], balanceSettled: true })).toBe("complete");
    // No invented status: it must be exactly what statementsCoveredByReconciliation drives to.
    const covered = statementsCoveredByReconciliation(
      [{ id: "s1", bank_account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30", status: "attention" }],
      { accountId: "a1", periodStart: "2026-06-01", periodEnd: "2026-06-30", exceptedStatementIds: [] });
    expect(covered).toEqual(["s1"]);   // …and that sweep writes 'complete'
  });

  it("a single pending or excepted line blocks the advance", () => {
    expect(statementAdvanceStatus({ status: "attention", lineStatuses: ["booked", "pending"], balanceSettled: true })).toBeNull();
    expect(statementAdvanceStatus({ status: "attention", lineStatuses: ["booked", "excepted"], balanceSettled: true })).toBeNull();
    expect(unsettledLineCount(["booked", "pending", "excepted"])).toBe(2);
  });

  it("an unsettled BALANCE blocks it too — lines alone must never manufacture a green", () => {
    expect(statementAdvanceStatus({ status: "attention", lineStatuses: SETTLED, balanceSettled: false })).toBeNull();
  });

  it("a statement with NO lines is not 'all settled' (zero-of-zero is the vacuous pass)", () => {
    expect(allLinesSettled([])).toBe(false);
    expect(statementAdvanceStatus({ status: "attention", lineStatuses: [], balanceSettled: true })).toBeNull();
  });

  it("terminal states are never touched — 'complete' is idempotent, 'superseded' never resurrects", () => {
    expect(statementAdvanceStatus({ status: "complete", lineStatuses: SETTLED, balanceSettled: true })).toBeNull();
    expect(statementAdvanceStatus({ status: "superseded", lineStatuses: SETTLED, balanceSettled: true })).toBeNull();
  });
});

describe("(j) re-upload of a NON-complete statement re-evaluates instead of no-oping", () => {
  const nonComplete = { id: "s1", status: "attention", bank_account_id: "a1", period_start: "2026-05-01", period_end: "2026-05-31" };

  it("lines booked since the last upload → status advances AND reconciliation is offered", () => {
    const plan = planStatementReupload({ existing: nonComplete, lineStatuses: SETTLED, balanceSettled: true });
    expect(plan.action).toBe("reevaluate");
    expect(plan.reevaluate).toBe(true);
    expect(plan.advanceTo).toBe("complete");
    expect(plan.offerReconcile).toBe(true);
    expect(plan.unresolved).toBe(0);
  });

  it("still-open lines → re-evaluated, but NOT advanced and NOT offered (honest 'still working')", () => {
    const plan = planStatementReupload({ existing: nonComplete, lineStatuses: ["booked", "excepted"], balanceSettled: true });
    expect(plan.action).toBe("reevaluate");
    expect(plan.advanceTo).toBeNull();
    expect(plan.offerReconcile).toBe(false);
    expect(plan.unresolved).toBe(1);
  });

  it("lines all booked but the balance doesn't tie → still OFFER the reconcile (that's what it's for), don't advance", () => {
    const plan = planStatementReupload({ existing: nonComplete, lineStatuses: SETTLED, balanceSettled: false });
    expect(plan.advanceTo).toBeNull();     // no false green
    expect(plan.offerReconcile).toBe(true); // but hand over the session that sorts it out
  });

  it("REGRESSION — a COMPLETE statement keeps C193's supersede behavior, untouched", () => {
    const plan = planStatementReupload({ existing: { ...nonComplete, status: "complete" }, lineStatuses: SETTLED, balanceSettled: true });
    expect(plan.action).toBe("supersede");
    expect(plan.reevaluate).toBe(false);   // never re-run a finished statement
    expect(plan.advanceTo).toBeNull();
    expect(plan.offerReconcile).toBe(false);
  });

  it("a SUPERSEDED prior is treated as absent — the newer row owns the story", () => {
    expect(planStatementReupload({ existing: { ...nonComplete, status: "superseded" }, lineStatuses: SETTLED }).action).toBe("new");
  });

  it("no prior at all → a plain new statement (first upload path unchanged)", () => {
    expect(planStatementReupload({ existing: null, lineStatuses: [] }).action).toBe("new");
  });

  it("the offer is withheld once the period is genuinely reconciled (no duplicate session)", () => {
    const recons = [{ status: "complete", account_id: "a1", period_start: "2026-05-01", period_end: "2026-05-31" }];
    expect(reconciliationCoversStatement(recons, nonComplete)).toBe(true);
    expect(statementReadyToReconcile({ statement: nonComplete, lineStatuses: SETTLED, reconciliations: recons })).toBe(false);
    expect(statementReadyToReconcile({ statement: nonComplete, lineStatuses: SETTLED, reconciliations: [] })).toBe(true);
    // an OPEN reconciliation is not coverage — it hasn't answered anything yet
    expect(statementReadyToReconcile({ statement: nonComplete, lineStatuses: SETTLED, reconciliations: [{ ...recons[0], status: "open" }] })).toBe(true);
  });
});

describe("(k) the Review card points somewhere useful — and vanishes when resolved", () => {
  const stmt = { id: "s1", status: "attention", bank_account_id: "a1", period_start: "2026-05-01", period_end: "2026-05-31" };

  it("unsettled lines → an exception card (real open work)", () => {
    expect(statementCardState({ statement: stmt, lineStatuses: ["booked", "excepted"], reconciliations: [] })).toBe("exception");
  });

  it("all lines booked, period not reconciled → 'ready', not an exception", () => {
    expect(statementCardState({ statement: stmt, lineStatuses: SETTLED, reconciliations: [] })).toBe("ready");
  });

  it("RESOLVED renders NOTHING — reconciled, complete, or superseded", () => {
    const recons = [{ status: "complete", account_id: "a1", period_start: "2026-05-01", period_end: "2026-05-31" }];
    expect(statementCardState({ statement: stmt, lineStatuses: SETTLED, reconciliations: recons })).toBe("none");
    expect(statementCardState({ statement: { ...stmt, status: "complete" }, lineStatuses: SETTLED, reconciliations: [] })).toBe("none");
    expect(statementCardState({ statement: { ...stmt, status: "superseded" }, lineStatuses: SETTLED, reconciliations: [] })).toBe("none");
  });

  it("a STATEMENT-level card targets Reconcile with the account + month; a LINE card still goes to Bank Import", () => {
    const t = statementExceptionTarget({ kind: "statement", statement_id: "s1", bank_account_id: "a1", period_start: "2026-05-01", period_end: "2026-05-31" });
    expect(t.view).toBe("recon");
    expect(t).toMatchObject({ statementId: "s1", accountId: "a1", periodStart: "2026-05-01", periodEnd: "2026-05-31" });
    expect(statementExceptionTarget({ kind: "line", statement_id: "s1" }).view).toBe("bank");
  });

  it("the ready copy assumes zero accounting knowledge", () => {
    expect(containsOwnerJargon(READY_TO_RECONCILE_COPY)).toBe(false);
    expect(containsOwnerJargon(OPEN_RECONCILE_LABEL)).toBe(false);
  });
});

describe("(l) the session starts with the balance already in it — and an edit wins", () => {
  const stmt = { id: "s1", bank_account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30", stated_ending_balance: 46434.91, status: "complete" };

  it("prefills from the PERSISTED statement, as a string the input can hold", () => {
    expect(prefillEndingBalance({ statement: stmt, current: "" })).toBe("46434.91");
  });

  it("NEVER overwrites what the CPA typed — their independent check governs", () => {
    expect(prefillEndingBalance({ statement: stmt, current: "46000" })).toBeNull();
    expect(prefillEndingBalance({ statement: stmt, current: "0" })).toBeNull();   // an explicit 0 is a real answer
  });

  it("no statement / no stored balance / junk → no prefill (blank field, never a fabricated number)", () => {
    expect(prefillEndingBalance({ statement: null, current: "" })).toBeNull();
    expect(prefillEndingBalance({ statement: { stated_ending_balance: null }, current: "" })).toBeNull();
    expect(prefillEndingBalance({ statement: { stated_ending_balance: "abc" }, current: "" })).toBeNull();
  });

  it("a real 0.00 ending balance IS prefilled (a closed account is a fact, not a missing value)", () => {
    expect(prefillEndingBalance({ statement: { stated_ending_balance: 0 }, current: "" })).toBe("0");
  });

  it("picks the NEWEST live statement for the account + month; superseded and other accounts are invisible", () => {
    const rows = [
      { id: "old", bank_account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30", stated_ending_balance: 1, status: "complete", created_at: "2026-08-01" },
      { id: "new", bank_account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30", stated_ending_balance: 2, status: "attention", created_at: "2026-08-06" },
      { id: "dead", bank_account_id: "a1", period_start: "2026-06-01", period_end: "2026-06-30", stated_ending_balance: 9, status: "superseded", created_at: "2026-08-09" },
      { id: "other", bank_account_id: "a2", period_start: "2026-06-01", period_end: "2026-06-30", stated_ending_balance: 8, status: "attention", created_at: "2026-08-09" },
    ];
    const picked = statementForPeriod(rows, { accountId: "a1", periodStart: "2026-06-01", periodEnd: "2026-06-30" });
    expect(picked.id).toBe("new");
    expect(statementForPeriod(rows, { accountId: "a1", periodStart: "2026-07-01", periodEnd: "2026-07-31" })).toBeNull();
  });
});

// ── Source contracts: this suite has no DOM, so the WIRING is pinned by reading
// the source — the transitions must actually be called where the drive found them.
describe("(wiring) the lifecycle is called on the paths that were dead", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const review = fs.readFileSync(new URL("../src/components/views/ReviewView.jsx", import.meta.url), "utf8");
  const recon = fs.readFileSync(new URL("../src/components/views/ReconView.jsx", import.meta.url), "utf8");

  it("(i) both first-pass booking paths re-evaluate the statement afterwards", () => {
    const calls = app.match(/await reevaluateStatement\(stmtId, \{ account \}\)/g) || [];
    expect(calls.length).toBe(2);                       // the no-matching branch AND the A/P-matching branch
    expect(app).toMatch(/statement:advance-first-pass/);  // …through a CHECKED write (C192)
  });

  it("(j) the re-upload path consults planStatementReupload and re-evaluates the new owner row", () => {
    expect(app).toMatch(/const plan = planStatementReupload\(\{ existing: prior/);
    expect(app).toMatch(/if \(plan\.reevaluate\) await reevaluateStatement\(prior\.id/);
    expect(app).toMatch(/const rv = await reevaluateStatement\(statementId, \{ account \}\);\s*\n\s*if \(rv\.ready\) offerReconciliation/);
    expect(app).toMatch(/await supersedePriorStatements\(priorSameHashIds, statementId\);/);   // C193 path still there
  });

  // The re-evaluation must be a READ plus ONE status write. If it ever books, inserts
  // lines, or re-runs detection, a re-upload would duplicate exactly what O86 says it
  // must not (duplicate lines / a second copy of every anomaly card, 5 → 10 live).
  it("(j) re-evaluation books NOTHING and emits NOTHING — no duplicate lines, no duplicate anomalies", () => {
    const start = app.indexOf("const reevaluateStatement = async");
    expect(start).toBeGreaterThan(0);
    const body = app.slice(start, app.indexOf("\n  // (j) — the offer.", start));
    expect(body).not.toMatch(/bookToDb|post_journal_entry|persistJournalEntry|buildBankLineEntry/);
    expect(body).not.toMatch(/runAnomalyDetection|anomalyInsertRow|createNotification/);
    expect(body).not.toMatch(/\.insert\(/);
    // exactly one mutation in the whole function: the statement's own status
    expect((body.match(/checkedRowUpdate/g) || []).length).toBe(1);
    expect(body).toMatch(/patch: \{ status: next \}/);
  });

  it("(k) Review routes statement-level cards through statementExceptionTarget", () => {
    expect(review).toMatch(/const target = statementExceptionTarget\(x\);/);
    expect(review).toMatch(/setView && setView\("recon"\)/);
    expect(app).toMatch(/const state = statementCardState\(/);
    expect(app).toMatch(/if \(state === "none"\) return null;/);   // resolved → no card at all
  });

  it("(l) ReconView prefills from the persisted statement, empty-field-only", () => {
    expect(recon).toMatch(/prefillEndingBalance\(\{ statement: st, current: statementBalance \}\)/);
    expect(recon).toMatch(/if \(statementBalance !== ""\) return;/);   // a typed value is never clobbered
    expect(recon).toMatch(/setBankTxns\(rows\); setStep\("match"\)/);  // the offered session needs no upload
  });
});
