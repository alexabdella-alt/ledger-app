// ── THE REVIEW LAYER LINKS FROM THE ISSUE TO THE TOOL (C322) ─────────────────
//
// Operator, 2026-09-11: "get rid of the strip, link from the issues instead."
//
// C320 put a four-button tool strip on the Review screen because two workbench
// screens had no other door once their nav rows went. A strip is tabs by another
// name. The model the operator described is that Review SHOWS an issue and the
// issue LINKS to the tool that fixes it — so the tools need no standing presence
// at all. This module builds those issue cards, purely, from the durable records.
//
// ★★ WHY THE PAYROLL CARD READS THE INTAKE ROW AND NOT `payrollImports`: that
// list is React state. A register the gate refused lives in the tab that dropped
// it and is gone on reload — while its intake row, marked HELD, is durable and was
// TERMINAL, so the completeness net never listed it. A register waiting on a person
// therefore had no screen anywhere after a reload. The row is the record; the card
// reads the record. (§9: describe from what was recorded.)

// ★ ONE CONSTANT, WRITTEN BY THE HOLD PATH AND READ HERE. Two strings would be the
// ·3a shape — writer and reader each tested against their own copy, agreeing with
// each other and with nothing. A test asserts App.jsx writes exactly this.
export const PAYROLL_HOLD_PREFIX = "payroll register held for a person: ";

export function payrollHoldDetail(reasons = []) {
  const text = (reasons || []).map((r) => (typeof r === "string" ? r : r && r.text) || "").filter(Boolean).join(" ");
  return `${PAYROLL_HOLD_PREFIX}${text || "the register did not pass every shape check."}`;
}

// Intake rows marked HELD by the payroll hold path → one card each, linking to Payroll,
// carrying the gate's own reasons. Anything not written by that path is not a payroll
// hold, however it is worded — the prefix is the contract, not a heuristic.
export function heldPayrollCards(intakeRows = []) {
  return (intakeRows || [])
    .filter((r) => r && r.status === "held_for_review" && String(r.detail || "").startsWith(PAYROLL_HOLD_PREFIX))
    .map((r) => ({
      kind: "payroll_held",
      id: `payroll_held:${r.id}`,
      intake_id: r.id,
      filename: r.filename || "a payroll register",
      // The reasons are the gate's own words — "the register doesn't foot: gross … less
      // withholdings … is …, but it states net pay of …" — recorded, not re-derived.
      reasons: String(r.detail).slice(PAYROLL_HOLD_PREFIX.length),
      received_at: r.received_at || null,
      // ★ THE LINK IS THE POINT. The card says why; the tool is where the CPA decides.
      goTo: "payroll",
      goToLabel: "Open Payroll",
    }));
}

// Bank lines the matcher could not settle on its own. `matchQueue` is in-session state,
// which is exactly when this matters: the pipeline just redirected to Matching once and
// a person navigated away. One card, not one per line — the decision is made on the
// Matching screen, and a count is what tells the reviewer it is worth opening.
export function matchingCard(matchQueue = []) {
  const pending = (matchQueue || []).filter((m) => m && !m.resolved && !m.dismissed);
  if (!pending.length) return null;
  return {
    kind: "matching_pending",
    id: "matching_pending",
    count: pending.length,
    goTo: "matching",
    goToLabel: "Open Matching",
  };
}

// Everything on Review that is waiting on a person AND has a tool to open. Each entry is
// {kind, goTo, goToLabel, …}; the screen renders the sentence and the one button.
export function waitingOnYou({ intakeRows = [], matchQueue = [] } = {}) {
  const cards = heldPayrollCards(intakeRows);
  const m = matchingCard(matchQueue);
  if (m) cards.push(m);
  return cards;
}

// Plain-language sentence for a card — derived from its fields, never composed alongside.
export function waitingCopy(card) {
  if (!card) return "";
  if (card.kind === "payroll_held") return `${card.filename} was held rather than posted — ${card.reasons}`;
  if (card.kind === "matching_pending") return `${card.count} bank ${card.count === 1 ? "line needs" : "lines need"} a match decision the system couldn't make on its own.`;
  return "";
}

// ── O135 — A HELD REGISTER THAT IS NOT IN MEMORY ANY MORE ────────────────────
//
// `payrollImports` is React state; the intake row is durable. After a reload the
// Review card (built from the row) still points at Payroll, and Payroll has nothing to
// show — the O86(k) link-to-nowhere shape. The stored FILE is durable too (O97 step 1),
// so the register can be rebuilt by putting those bytes back through the pipeline: it
// parses again, the gate refuses again, and the hold lands in-session where the
// override card can act on it. One AI call; no migration.
//
// This decides WHICH held rows need that — the ones with no in-memory register — and
// which are already loading, so the button and the "Reading…" state cannot disagree.
export function heldRegistersToReload({ intakeRows = [], payrollImports = [], uploadQueue = [] } = {}) {
  const inMemory = new Set((payrollImports || []).map((p) => String(p && p._intakeId)).filter((x) => x && x !== "null" && x !== "undefined"));
  const inFlight = new Set((uploadQueue || [])
    .filter((q) => q && q.intake_id && q.status !== "done" && q.status !== "error")
    .map((q) => String(q.intake_id)));
  return heldPayrollCards(intakeRows)
    .filter((c) => !inMemory.has(String(c.intake_id)))
    .map((c) => ({ ...c, loading: inFlight.has(String(c.intake_id)) }));
}
