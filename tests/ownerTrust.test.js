import { describe, it, expect } from "vitest";
import { ownerTrustState, monthLabel } from "../src/lib/ownerTrust.js";
import { evaluateSignOff, bankMatchStatus } from "../src/lib/controlTotals.js";
import { reconcileIntake } from "../src/lib/documentIntake.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// O90 — owner trust panel (CR-27). The owner-facing projection of the SAME trust
// data the CPA reviews. Two guarantees this locks:
//   (1) it shows green ONLY when all three nets clear (completeness/confidence/accuracy);
//   (2) it can NEVER disagree with the CPA sign-off gate — overall="attention"
//       iff evaluateSignOff(same inputs).ok === false (the "penny-guarantee").
// Plus: honest plain-language state per net, and NO owner-facing jargon anywhere.
// ════════════════════════════════════════════════════════════════════════════

const NOW = new Date("2026-06-15T12:00:00");
const recorded = (n = 1) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, status: "recorded", received_at: "2026-06-10T09:00:00" }));
const droppedRow = { id: "d1", status: "failed", filename: "receipt.pdf", received_at: "2026-06-10T09:00:00" };   // failed → always dropped
const pendingRow = { id: "p1", status: "processing", received_at: "2026-06-15T11:58:00" };                        // <30m → in-flight, not dropped
const GREEN_CT = { failed: [], allTie: true };
const FAILED_CT = { failed: [{ id: "ar_tie", label: "Money owed to you (receivables)" }], allTie: false };
const flag = (n = 1) => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, vendor: "Bella Vita", amount: 2400, confidence: 55 }));

const MATCHED = { overdue: false, days: 4 };       // bank matched recently
const UNMATCHED = { overdue: true, days: null };   // never reconciled (or stale)
const base = { controlTotals: GREEN_CT, openConfidenceFlags: [], intakeRows: recorded(3), unknownDocs: [], reviewedThrough: "2026-05", bankMatch: MATCHED, now: NOW };

// Collect every owner-facing string a scenario would render.
const strings = (s) => [s.headline, s.lines.captured.text, s.lines.reviewed.text, s.lines.correct.text, s.nudge?.text].filter(Boolean);

// ── (0) NEUTRAL — no false green on a brand-new company (zero data to evaluate) ──
// The bug: a new company with no entries, no bank, no opening balances, no fiscal
// year set rendered fully green ("Your books are handled and up to date") — zero
// failures out of zero checks reading as success. The fix: an explicit neutral state
// keyed on the SAME signals the home setup checklist counts (hasBooks / setupComplete),
// so the panel and the "0 of 4 done" card can never contradict.
describe("(0) neutral on a brand-new company — never a false green on zero data", () => {
  const ZERO = { controlTotals: GREEN_CT, openConfidenceFlags: [], intakeRows: [], unknownDocs: [], reviewedThrough: null, bankMatch: { overdue: false, days: null }, hasBooks: false, setupComplete: false, now: NOW };

  it("no entries AND no completed setup → neutral (NOT all_clear), even though every check trivially 'passes'", () => {
    const s = ownerTrustState(ZERO);
    expect(s.overall).toBe("neutral");
    expect(s.neutral).toBe(true);
    // The exact false-green being closed: with zero checks, evaluateSignOff would say ok=true.
    expect(s.overall).not.toBe("all_clear");
  });

  it("neutral state shows NO success indicators and NO 'awaiting sign-off' line", () => {
    const s = ownerTrustState(ZERO);
    expect(s.lines).toBeNull();                 // no per-net breakdown (so no green ✓, no "Reviewed" line)
    expect(s.nudge).toBeNull();
    expect(s.reviewedThrough).toBeNull();
    expect(Object.values(s.nets).every(v => v === false)).toBe(true);
  });

  it("neutral copy is plain 'let's get set up' language", () => {
    const s = ownerTrustState(ZERO);
    expect(s.headline).toMatch(/let's get you set up/i);
    expect(s.subtext).toMatch(/once your business info and first transactions are in/i);
    expect(s.headline).not.toMatch(/handled|up to date|clear/i);   // no reassurance wording
  });

  it("TRANSITION: the first booked entry exits neutral → real (green) status resumes", () => {
    const s = ownerTrustState({ ...ZERO, hasBooks: true });
    expect(s.neutral).toBeUndefined();
    expect(s.overall).toBe("all_clear");        // now there ARE books to evaluate, and they're clean
    expect(s.lines).not.toBeNull();
  });

  it("TRANSITION: completing setup exits neutral even before the first entry", () => {
    const s = ownerTrustState({ ...ZERO, setupComplete: true });
    expect(s.neutral).toBeUndefined();
    expect(s.overall).not.toBe("neutral");
  });

  it("a short net still wins even on a near-empty company (neutral is ONLY for truly nothing-to-evaluate)", () => {
    // Setup complete but a document fell through → NOT neutral, and NOT green.
    const s = ownerTrustState({ ...ZERO, setupComplete: true, intakeRows: [droppedRow] });
    expect(s.neutral).toBeUndefined();
    expect(s.overall).toBe("attention");
  });

  it("BACKWARD-COMPAT: callers that don't pass hasBooks default to live status (not neutral)", () => {
    const s = ownerTrustState(base);            // base sets no hasBooks/setupComplete
    expect(s.neutral).toBeUndefined();
    expect(s.overall).toBe("all_clear");
  });
});

describe("(1) green ONLY when all three nets clear", () => {
  it("all nets clear → all_clear, all lines ok, no nudge", () => {
    const s = ownerTrustState(base);
    expect(s.overall).toBe("all_clear");
    expect(s.lines.captured.ok).toBe(true);
    expect(s.lines.correct.ok).toBe(true);
    expect(s.nudge).toBeNull();
    expect(s.headline).toMatch(/handled/i);
  });

  it("an open confidence flag → NOT green; honest line + the one owner nudge", () => {
    const s = ownerTrustState({ ...base, openConfidenceFlags: flag(1) });
    expect(s.overall).toBe("attention");
    expect(s.lines.correct.ok).toBe(false);
    expect(s.lines.correct.text).toMatch(/one transaction needs a quick answer/i);
    expect(s.nudge).toMatchObject({ kind: "confidence", count: 1 });
    expect(s.lines.captured.ok).toBe(true);          // completeness still fine
  });

  it("a control total that doesn't tie → NOT green; honest, owner-appropriate, NO nudge", () => {
    const s = ownerTrustState({ ...base, controlTotals: FAILED_CT });
    expect(s.overall).toBe("attention");
    expect(s.lines.correct.ok).toBe(false);
    expect(s.lines.correct.text).toMatch(/double-checking/i);
    expect(s.nudge).toBeNull();                      // accuracy isn't an owner task
    // the jargon-y control-total label must NOT leak into the owner line
    expect(s.lines.correct.text.toLowerCase()).not.toContain("receivable");
  });

  it("a document that fell through → NOT green; captured says so plainly", () => {
    const s = ownerTrustState({ ...base, intakeRows: [...recorded(2), droppedRow] });
    expect(s.overall).toBe("attention");
    expect(s.lines.captured.ok).toBe(false);
    expect(s.lines.captured.text).toMatch(/needs attention|couldn't file/i);
  });

  it("an unclassified (unposted) document → NOT green (completeness net)", () => {
    const s = ownerTrustState({ ...base, unknownDocs: [{ id: "u1", posted: false }] });
    expect(s.overall).toBe("attention");
    expect(s.lines.captured.ok).toBe(false);
  });

  it("benign in-flight docs (recent, not stuck) → in_progress, NOT a false all-clear, NOT attention", () => {
    const s = ownerTrustState({ ...base, intakeRows: [...recorded(2), pendingRow] });
    expect(s.overall).toBe("in_progress");
    expect(s.lines.captured.ok).toBe(true);          // net not short (not dropped)
    expect(s.lines.captured.pending).toBe(true);
    expect(s.lines.captured.text).toMatch(/filing|finishing|almost/i);
    expect(s.headline).not.toMatch(/up to date/i);   // never claims "done" while filing
  });

  // ── The false-green this fix closes: books internally clean but NOT matched to the bank. ──
  it("bank not yet matched → NOT all_clear, and 'nothing wrong' does NOT claim 'up to date'", () => {
    const s = ownerTrustState({ ...base, bankMatch: UNMATCHED });
    expect(s.overall).not.toBe("all_clear");         // the contradiction with the dashboard alert is gone
    expect(s.overall).toBe("in_progress");           // honest "wrapping up", not alarming
    expect(s.lines.correct.ok).toBe(false);
    expect(s.lines.correct.state).toBe("info");
    expect(s.lines.correct.text).toMatch(/matching your books to your bank/i);
    expect(s.lines.correct.text).not.toMatch(/correct and up to date/i);
    expect(s.nets.bankMatched).toBe(false);
    expect(s.nudge).toBeNull();                       // dashboard's own bank reminder carries the action
  });

  it("fully matched + everything clean → still green (the fix doesn't over-trigger)", () => {
    const s = ownerTrustState({ ...base, bankMatch: MATCHED });
    expect(s.overall).toBe("all_clear");
    expect(s.lines.correct.ok).toBe(true);
    expect(s.lines.correct.text).toMatch(/correct and up to date/i);
    expect(s.nets.bankMatched).toBe(true);
  });

  // ── The "Documents" reframe: a bank-fed / seeded company has a full ledger but no uploaded
  //    docs — the line must read NEUTRAL, never "nothing to file"/a gap next to real books. ──
  it("no uploaded documents → Documents line is neutral (not a gap), overall still green", () => {
    const s = ownerTrustState({ ...base, intakeRows: [] });
    expect(s.lines.captured.ok).toBe(true);                 // no dropped docs → completeness net satisfied
    expect(s.lines.captured.state).toBe("info");            // neutral marker, not green-triumphant, not attention
    expect(s.lines.captured.text).toMatch(/no documents waiting/i);
    expect(s.lines.captured.text).not.toMatch(/nothing to file|missing|accounted for/i);
    expect(s.overall).toBe("all_clear");                    // the empty doc-ledger doesn't drag the panel down
  });
});

describe("(2) penny-guarantee — never diverges from the CPA sign-off gate", () => {
  const scenarios = {
    "all clear": base,
    "confidence short": { ...base, openConfidenceFlags: flag(2) },
    "accuracy short": { ...base, controlTotals: FAILED_CT },
    "completeness short (dropped)": { ...base, intakeRows: [...recorded(1), droppedRow] },
    "completeness short (unknown)": { ...base, unknownDocs: [{ id: "u", posted: false }] },
    "in-flight only": { ...base, intakeRows: [...recorded(1), pendingRow] },
    "bank not matched": { ...base, bankMatch: UNMATCHED },
  };
  for (const [name, inp] of Object.entries(scenarios)) {
    it(`"${name}": overall==='attention' iff evaluateSignOff.ok===false`, () => {
      const s = ownerTrustState(inp);
      const dropped = reconcileIntake(inp.intakeRows, { now: inp.now });
      const gate = evaluateSignOff({ controlTotals: inp.controlTotals, openConfidenceFlags: inp.openConfidenceFlags, droppedDocs: dropped, unknownDocs: inp.unknownDocs });
      expect(s.overall === "attention").toBe(!gate.ok);           // the two surfaces agree, always
      if (gate.ok) expect(["all_clear", "in_progress"]).toContain(s.overall);
    });
  }
});

describe("(2b) bank-match is the SAME source as the dashboard alert — the two can't contradict", () => {
  const withBooks = [{ id: "je1", status: "posted" }];
  // A real reconciliation carries a VERIFIED bank ending balance (non-zero or confirmed-$0).
  const recentRecon = [{ status: "complete", completed_at: "2026-06-10T00:00:00", statement_balance: 5000 }];   // 5 days before NOW
  const staleRecon = [{ status: "complete", completed_at: "2026-04-01T00:00:00", statement_balance: 5000 }];     // >35 days

  it("bankMatchStatus: never-reconciled with real books → overdue (the blind spot)", () => {
    const st = bankMatchStatus({ reconciliations: [], invoices: withBooks, now: NOW });
    expect(st).toMatchObject({ overdue: true, days: null, everReconciled: false });
  });
  it("bankMatchStatus: a $0 UNVERIFIED 'complete' phantom does NOT count as matched (O83)", () => {
    const phantom = [{ status: "complete", completed_at: "2026-06-10T00:00:00", statement_balance: 0 }];
    const st = bankMatchStatus({ reconciliations: phantom, invoices: withBooks, now: NOW });
    expect(st).toMatchObject({ overdue: true, everReconciled: false });   // phantom ignored → reads not-matched
    // but a VERIFIED $0 (confirmed empty/closed account) DOES count
    const verifiedZero = [{ status: "complete", completed_at: "2026-06-10T00:00:00", statement_balance: 0, statement_balance_verified: true }];
    expect(bankMatchStatus({ reconciliations: verifiedZero, invoices: withBooks, now: NOW }).overdue).toBe(false);
  });
  it("bankMatchStatus: recent completed reconciliation → NOT overdue", () => {
    expect(bankMatchStatus({ reconciliations: recentRecon, invoices: withBooks, now: NOW }).overdue).toBe(false);
  });
  it("bankMatchStatus: stale (>35 days) reconciliation → overdue", () => {
    expect(bankMatchStatus({ reconciliations: staleRecon, invoices: withBooks, now: NOW }).overdue).toBe(true);
  });
  it("bankMatchStatus: no books yet → NOT overdue (don't nag an empty company)", () => {
    expect(bankMatchStatus({ reconciliations: [], invoices: [], now: NOW }).overdue).toBe(false);
  });

  // The panel consumes the identical object → its bank line ⟺ the dashboard alert's `overdue`.
  it.each([
    ["never reconciled", [], withBooks],
    ["recent", recentRecon, withBooks],
    ["stale", staleRecon, withBooks],
    ["no books", [], []],
  ])("panel bank state matches the alert (%s)", (_n, recon, inv) => {
    const st = bankMatchStatus({ reconciliations: recon, invoices: inv, now: NOW });
    const s = ownerTrustState({ ...base, bankMatch: st });
    // alert shows iff overdue; panel is not-all_clear-for-bank iff overdue (given other nets clean)
    const panelFlagsBank = s.lines.correct.state === "info" && s.lines.correct.text.match(/bank/i);
    expect(!!panelFlagsBank).toBe(st.overdue);
    if (st.overdue) expect(s.overall).not.toBe("all_clear");
  });
});

describe("(3) reviewed line reflects the sign-off state honestly", () => {
  it("signed off → 'Reviewed and signed off through <Month Year>'", () => {
    const s = ownerTrustState({ ...base, reviewedThrough: "2026-05" });
    expect(s.lines.reviewed.signed).toBe(true);
    expect(s.lines.reviewed.text).toBe("Reviewed and signed off through May 2026.");
  });
  it("never signed off → honest 'awaiting', no fake month/green", () => {
    const s = ownerTrustState({ ...base, reviewedThrough: null });
    expect(s.lines.reviewed.signed).toBe(false);
    expect(s.lines.reviewed.text).toMatch(/awaiting/i);
  });
  it("monthLabel formats YYYY-MM; null on garbage", () => {
    expect(monthLabel("2026-01")).toBe("January 2026");
    expect(monthLabel("nope")).toBeNull();
  });
});

describe("(Cardinal) no owner-facing jargon in any state", () => {
  const cases = [
    base,
    { ...base, openConfidenceFlags: flag(3) },
    { ...base, controlTotals: FAILED_CT },
    { ...base, intakeRows: [...recorded(1), droppedRow] },
    { ...base, intakeRows: [...recorded(1), pendingRow] },
    { ...base, reviewedThrough: null },
    { ...base, intakeRows: [] },
    { ...base, bankMatch: UNMATCHED },
  ];
  it.each(cases.map((c, i) => [i, c]))("scenario #%i: every string is plain business English", (_i, inp) => {
    for (const str of strings(ownerTrustState(inp))) {
      expect(containsOwnerJargon(str), `owner string leaked jargon: "${str}"`).toBe(false);
      expect(str, `owner string leaked a confidence %: "${str}"`).not.toMatch(/\d+\s*%/);
    }
  });
});
