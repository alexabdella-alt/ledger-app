import { describe, it, expect } from "vitest";
import { ownerTrustState, monthLabel } from "../src/lib/ownerTrust.js";
import { evaluateSignOff } from "../src/lib/controlTotals.js";
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

const base = { controlTotals: GREEN_CT, openConfidenceFlags: [], intakeRows: recorded(3), unknownDocs: [], reviewedThrough: "2026-05", now: NOW };

// Collect every owner-facing string a scenario would render.
const strings = (s) => [s.headline, s.lines.captured.text, s.lines.reviewed.text, s.lines.correct.text, s.nudge?.text].filter(Boolean);

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
});

describe("(2) penny-guarantee — never diverges from the CPA sign-off gate", () => {
  const scenarios = {
    "all clear": base,
    "confidence short": { ...base, openConfidenceFlags: flag(2) },
    "accuracy short": { ...base, controlTotals: FAILED_CT },
    "completeness short (dropped)": { ...base, intakeRows: [...recorded(1), droppedRow] },
    "completeness short (unknown)": { ...base, unknownDocs: [{ id: "u", posted: false }] },
    "in-flight only": { ...base, intakeRows: [...recorded(1), pendingRow] },
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
  ];
  it.each(cases.map((c, i) => [i, c]))("scenario #%i: every string is plain business English", (_i, inp) => {
    for (const str of strings(ownerTrustState(inp))) {
      expect(containsOwnerJargon(str), `owner string leaked jargon: "${str}"`).toBe(false);
      expect(str, `owner string leaked a confidence %: "${str}"`).not.toMatch(/\d+\s*%/);
    }
  });
});
