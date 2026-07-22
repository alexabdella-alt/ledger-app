import { describe, it, expect } from "vitest";
import { signOffReadiness, bookedEntriesInPeriod, reconciliationCoversPeriod } from "../src/lib/controlTotals.js";
import { canAttestPeriod, latestReviewedThrough } from "../src/lib/signoff.js";
import { ownerTrustState } from "../src/lib/ownerTrust.js";

// ════════════════════════════════════════════════════════════════════════════
// O50 SIGN-OFF GATE (closes the trust loop end-to-end with O90). The reviewer can
// attest a period ONLY when the FOUR nets clear — completeness (O60) + confidence
// (O49) + accuracy/control-totals (O59) + bank-match (C159). One pure function
// (signOffReadiness) that BOTH the CPA UI and the write path (signOffPeriod) use,
// so the button, the write, and the owner panel can't disagree. Plus the role gate
// (owner/admin attest, members can't) and the loop tie to the owner TrustPanel.
// ════════════════════════════════════════════════════════════════════════════

const GREEN_CT = { failed: [], allTie: true };
const FAILED_CT = { failed: [{ id: "ar_tie", label: "Money owed to you (receivables)" }], allTie: false };
const MATCHED = { overdue: false, days: 4 };
const UNMATCHED = { overdue: true, days: null };
const clear = { controlTotals: GREEN_CT, openConfidenceFlags: [], droppedDocs: [], unknownDocs: [], bankMatch: MATCHED };

describe("signOffReadiness — blocked when ANY net is short, with a reason", () => {
  it("all four nets clear → ok, no blockers", () => {
    const r = signOffReadiness(clear);
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
  });

  it("completeness short (a dropped doc) → blocked, net=completeness", () => {
    const r = signOffReadiness({ ...clear, droppedDocs: [{ id: "d", reason: "stuck" }] });
    expect(r.ok).toBe(false);
    expect(r.blockers.some(b => b.net === "completeness")).toBe(true);
  });

  it("confidence short (an open flag) → blocked, net=confidence", () => {
    const r = signOffReadiness({ ...clear, openConfidenceFlags: [{ id: "f", amount: 2400 }] });
    expect(r.ok).toBe(false);
    expect(r.blockers.some(b => b.net === "confidence")).toBe(true);
  });

  it("accuracy short (a control total doesn't tie) → blocked, net=accuracy", () => {
    const r = signOffReadiness({ ...clear, controlTotals: FAILED_CT });
    expect(r.ok).toBe(false);
    expect(r.blockers.some(b => b.net === "accuracy")).toBe(true);
  });

  it("bank not reconciled → blocked, net=bank, reason names the bank", () => {
    const r = signOffReadiness({ ...clear, bankMatch: UNMATCHED });
    expect(r.ok).toBe(false);
    const bank = r.blockers.find(b => b.net === "bank");
    expect(bank).toBeTruthy();
    expect(bank.reason).toMatch(/bank|reconcil/i);
  });

  it("several nets short → every reason is listed", () => {
    const r = signOffReadiness({ controlTotals: FAILED_CT, openConfidenceFlags: [{ id: "f" }], droppedDocs: [{ id: "d" }], unknownDocs: [], bankMatch: UNMATCHED });
    expect(r.ok).toBe(false);
    expect(r.blockers.map(b => b.net).sort()).toEqual(["accuracy", "bank", "completeness", "confidence"]);
  });
});

describe("role gate (O83) — reviewer (accountant/admin) attests; the client-owner cannot", () => {
  it("accountant and admin may attest (the reviewer/CPA roles)", () => {
    expect(canAttestPeriod("accountant")).toBe(true);
    expect(canAttestPeriod("admin")).toBe(true);
  });
  it("the OWNER (client) may NOT self-attest their own books — the separation-of-duties fix", () => {
    expect(canAttestPeriod("owner")).toBe(false);
  });
  it("a member (or unknown role) may NOT attest", () => {
    expect(canAttestPeriod("member")).toBe(false);
    expect(canAttestPeriod(undefined)).toBe(false);
    expect(canAttestPeriod(null)).toBe(false);
  });
});

// ── Non-vacuous preconditions (O83): zero-of-zero must read "not ready", not "clean" ──
describe("signOffReadiness preconditions — a period with nothing to check is NOT ready", () => {
  it("setup incomplete → blocked (net=readiness)", () => {
    const r = signOffReadiness({ ...clear, setupComplete: false });
    expect(r.ok).toBe(false);
    expect(r.blockers.some(b => b.net === "readiness" && /setup/i.test(b.reason))).toBe(true);
  });
  it("no opening balances → blocked (net=readiness)", () => {
    const r = signOffReadiness({ ...clear, openingEntered: false });
    expect(r.blockers.some(b => b.net === "readiness" && /opening/i.test(b.reason))).toBe(true);
  });
  it("no booked entries in the period → blocked (the vacuous-pass this fixes)", () => {
    const r = signOffReadiness({ ...clear, entriesInPeriodCount: 0 });
    expect(r.ok).toBe(false);
    expect(r.blockers.some(b => b.net === "readiness" && /nothing to review/i.test(b.reason))).toBe(true);
  });
  it("no reconciliation for the period → blocked (net=readiness)", () => {
    const r = signOffReadiness({ ...clear, hasReconForPeriod: false });
    expect(r.blockers.some(b => b.net === "readiness" && /reconciled/i.test(b.reason))).toBe(true);
  });
  it("all preconditions satisfied + nets clear → ready", () => {
    const r = signOffReadiness({ ...clear, setupComplete: true, openingEntered: true, entriesInPeriodCount: 42, hasReconForPeriod: true });
    expect(r.ok).toBe(true);
  });
  it("BACKWARD-COMPAT: preconditions omitted (null) are skipped — the four-net gate is unchanged", () => {
    expect(signOffReadiness(clear).ok).toBe(true);   // no precondition signals → not enforced
  });
});

describe("period helpers", () => {
  const inv = [
    { id: "a", date: "2026-07-03", status: "booked" },
    { id: "b", date: "2026-07-28", status: "booked" },
    { id: "c", date: "2026-06-30", status: "booked" },
    { id: "d", date: "2026-07-10", status: "voided" },   // not live → not counted
  ];
  it("bookedEntriesInPeriod counts live entries dated within the YYYY-MM", () => {
    expect(bookedEntriesInPeriod(inv, "2026-07")).toBe(2);   // a, b (not c=June, not d=voided)
    expect(bookedEntriesInPeriod(inv, "2026-06")).toBe(1);
    expect(bookedEntriesInPeriod(inv, "bad")).toBe(0);
  });
  it("reconciliationCoversPeriod: only a REAL completed reconciliation (status + verified balance) counts", () => {
    const real = { period_start: "2026-07-01", period_end: "2026-07-31", status: "complete", statement_balance: 15657.60 };
    expect(reconciliationCoversPeriod([real], "2026-07")).toBe(true);
    expect(reconciliationCoversPeriod([real], "2026-08")).toBe(false);
    expect(reconciliationCoversPeriod([{ ...real, period_start: "2026-06-01", period_end: "2026-08-31" }], "2026-07")).toBe(true);
    expect(reconciliationCoversPeriod([], "2026-07")).toBe(false);
  });
  it("reconciliationCoversPeriod: O83 phantoms do NOT satisfy the gate", () => {
    const span = { period_start: "2026-07-01", period_end: "2026-07-31" };
    // import-time auto-snapshot (statement_balance 0, marked import_snapshot)
    expect(reconciliationCoversPeriod([{ ...span, status: "import_snapshot", statement_balance: 0 }], "2026-07")).toBe(false);
    // a $0 "complete" that never verified a real bank balance — the Franklin phantom shape
    expect(reconciliationCoversPeriod([{ ...span, status: "complete", statement_balance: 0 }], "2026-07")).toBe(false);
    expect(reconciliationCoversPeriod([{ ...span, status: "complete", statement_balance: 0, statement_balance_verified: false }], "2026-07")).toBe(false);
    // in-progress ('open') never counts
    expect(reconciliationCoversPeriod([{ ...span, status: "open", statement_balance: 15657.60 }], "2026-07")).toBe(false);
  });
  it("reconciliationCoversPeriod: a VERIFIED $0 (confirmed empty/closed account) DOES count", () => {
    const span = { period_start: "2026-07-01", period_end: "2026-07-31" };
    expect(reconciliationCoversPeriod([{ ...span, status: "complete", statement_balance: 0, statement_balance_verified: true }], "2026-07")).toBe(true);
  });
});

describe("latestReviewedThrough — revoked sign-offs don't drive the badge", () => {
  it("ignores a revoked row, takes the max active period", () => {
    const signoffs = [
      { period: "2026-07", revoked_at: "2026-08-01T00:00:00Z" },   // revoked → ignored
      { period: "2026-06", revoked_at: null },
    ];
    expect(latestReviewedThrough(signoffs)).toBe("2026-06");
  });
});

describe("loop tie — the write gate and the owner TrustPanel can't disagree", () => {
  const NOW = new Date("2026-07-12T12:00:00");
  const ownerBase = { controlTotals: GREEN_CT, openConfidenceFlags: [], intakeRows: [{ id: "r", status: "recorded", received_at: "2026-07-05T00:00:00" }], unknownDocs: [], now: NOW };

  it("bank not matched → write gate BLOCKS and the owner panel is NOT all_clear (same source)", () => {
    expect(signOffReadiness({ ...clear, bankMatch: UNMATCHED }).ok).toBe(false);
    const panel = ownerTrustState({ ...ownerBase, bankMatch: UNMATCHED, reviewedThrough: null });
    expect(panel.overall).not.toBe("all_clear");
  });

  it("everything clear → write gate PASSES and (once signed) the owner 'Reviewed' line flips", () => {
    expect(signOffReadiness({ ...clear, bankMatch: MATCHED }).ok).toBe(true);
    // before sign-off: awaiting
    const before = ownerTrustState({ ...ownerBase, bankMatch: MATCHED, reviewedThrough: null });
    expect(before.lines.reviewed.signed).toBe(false);
    expect(before.lines.reviewed.text).toMatch(/awaiting/i);
    // after sign-off through 2026-07 (what signOffPeriod persists) → owner panel reflects it
    const after = ownerTrustState({ ...ownerBase, bankMatch: MATCHED, reviewedThrough: "2026-07" });
    expect(after.lines.reviewed.signed).toBe(true);
    expect(after.lines.reviewed.text).toBe("Reviewed and signed off through July 2026.");
  });
});
