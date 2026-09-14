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

// ── A QUESTION THAT SURVIVES A RELOAD (C365) ────────────────────────────────
// A document the pipeline declined to book because it needed an answer leaves its intake
// row HELD with this sentence — and the card itself is React state (O121), so a reload
// dropped the question while the row sat terminal and "accounted for". The trust header
// then read green over a document nobody had booked: the O121 false green, one reload later.
// The row is the record; this reads it. One constant, written by the hold path and read here.
export const CLARIFICATION_HOLD_DETAIL = "awaiting clarification in review queue";

// Held-for-a-question rows whose question is NOT currently on screen. `liveIntakeIds` are
// the intake ids that still have an unresolved card in this session — those are counted by
// the queue itself, and counting them here too would double the number.
// `bookedDocumentIds` — documents already linked to an entry. Before C367 an answered
// question never moved its row, so live rows from that era still read "awaiting" over a
// document that IS in the books; a linked document is proof the question was answered,
// and it is excluded here rather than offered for a second booking.
export function heldQuestionRows(intakeRows = [], { liveIntakeIds = [], uploadQueue = [], bookedDocumentIds = [] } = {}) {
  const live = new Set((liveIntakeIds || []).map(String));
  const booked = new Set((bookedDocumentIds || []).map(String));
  const inFlight = new Set((uploadQueue || [])
    .filter((q) => q && q.intake_id && q.status !== "done" && q.status !== "error")
    .map((q) => String(q.intake_id)));
  return (intakeRows || [])
    .filter((r) => r && r.status === "held_for_review" && String(r.detail || "") === CLARIFICATION_HOLD_DETAIL)
    .filter((r) => !live.has(String(r.id)))
    .filter((r) => !(r.document_id && booked.has(String(r.document_id))))
    .map((r) => ({
      kind: "question_held",
      id: `question_held:${r.id}`,
      intake_id: r.id,
      filename: r.filename || "a document",
      received_at: r.received_at || null,
      // no stored file → cannot be re-asked from here; the sentence says so rather than
      // offering a button that would fail on click (O124)
      reloadable: !!r.document_id,
      loading: inFlight.has(String(r.id)),
    }));
}

export function heldQuestionsCopy(rows = []) {
  const n = (rows || []).length;
  if (!n) return "";
  const canReload = rows.filter((r) => r.reloadable).length;
  const head = n === 1
    ? `1 document from earlier is still waiting for an answer from you`
    : `${n} documents from earlier are still waiting for an answer from you`;
  if (canReload === n) return `${head} — it isn't in your books until you answer.`;
  if (canReload === 0) return `${head}, and we no longer have the file to ask again — please drop it again.`;
  return `${head} — ${n - canReload} of them would need to be dropped again.`;
}

// ── A DOCUMENT WE COULD NOT READ, AFTER A RELOAD (C369) ─────────────────────
// Three hold paths park a file a PERSON has to deal with — extraction found nothing, the
// model could not extract it, or the file was unreadable/permanently refused — and every one
// wrote a sentence to the intake row that nothing read back. HELD is terminal, so the
// completeness net counted the file as "accounted for", the queue tile that said "Needs a
// look" died with the tab, and after a reload the trust panel read "Everything you sent is
// accounted for — nothing missing" over a document that had become nothing at all.
export const EXTRACT_FAILED_DETAIL = "couldn't extract invoice data — held for review";
export const NOTHING_EXTRACTED_DETAIL = "no transaction extracted — needs review";
export const UNREADABLE_HOLD_PREFIX = "We couldn't read this one: ";

export function isUnreadableHoldDetail(detail) {
  const d = String(detail || "");
  return d === EXTRACT_FAILED_DETAIL || d === NOTHING_EXTRACTED_DETAIL || d.startsWith(UNREADABLE_HOLD_PREFIX);
}

// Held-unreadable rows not represented by an upload tile in THIS session (the tile already
// says "Needs a look" for those, and it carries the fuller sentence).
export function heldUnreadableRows(intakeRows = [], { uploadQueue = [] } = {}) {
  const onScreen = new Set((uploadQueue || []).filter((q) => q && q.intake_id).map((q) => String(q.intake_id)));
  const inFlight = new Set((uploadQueue || [])
    .filter((q) => q && q.intake_id && q.status !== "done" && q.status !== "error")
    .map((q) => String(q.intake_id)));
  return (intakeRows || [])
    .filter((r) => r && r.status === "held_for_review" && isUnreadableHoldDetail(r.detail))
    .filter((r) => !onScreen.has(String(r.id)) || inFlight.has(String(r.id)))
    .map((r) => ({
      kind: "unreadable_held",
      id: `unreadable_held:${r.id}`,
      intake_id: r.id,
      filename: r.filename || "a document",
      reason: String(r.detail || "").startsWith(UNREADABLE_HOLD_PREFIX) ? String(r.detail).slice(UNREADABLE_HOLD_PREFIX.length) : String(r.detail || ""),
      received_at: r.received_at || null,
      reloadable: !!r.document_id,
      loading: inFlight.has(String(r.id)),
    }));
}

export function heldUnreadableCopy(rows = []) {
  const n = (rows || []).length;
  if (!n) return "";
  const names = rows.slice(0, 3).map((r) => r.filename).join(", ") + (n > 3 ? ` and ${n - 3} more` : "");
  return n === 1
    ? `We couldn't read ${names} — it isn't in your books. Try again, or send a clearer copy.`
    : `We couldn't read ${n} documents (${names}) — they aren't in your books. Try again, or send clearer copies.`;
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

// ── SET ASIDE FOR THE ACCOUNTANT (C370) ─────────────────────────────────────
// A lifecycle card answered "set aside for my accountant" books nothing and, since C367,
// leaves the row HELD with this sentence — which promised the accountant would decide and
// gave the accountant no screen. The card reads the row; its button re-reads the stored
// file so the same question comes back on the reviewer's own Home (the O135 door).
export function deferredToAccountantCards(intakeRows = [], { uploadQueue = [] } = {}) {
  const inFlight = new Set((uploadQueue || [])
    .filter((q) => q && q.intake_id && q.status !== "done" && q.status !== "error")
    .map((q) => String(q.intake_id)));
  return (intakeRows || [])
    .filter((r) => r && r.status === "held_for_review" && String(r.detail || "") === DEFERRED_DETAIL)
    .map((r) => ({
      kind: "deferred_to_accountant",
      id: `deferred:${r.id}`,
      intake_id: r.id,
      filename: r.filename || "a document",
      received_at: r.received_at || null,
      reloadable: !!r.document_id,
      loading: inFlight.has(String(r.id)),
      action: "reload",
      goToLabel: "Load it to decide",
    }));
}
// The sentence C367's settle writes. Kept here (the reader) and imported by the writer.
export const DEFERRED_DETAIL = "set aside for your accountant after a question";

// Everything on Review that is waiting on a person AND has a tool to open. Each entry is
// {kind, goTo, goToLabel, …} or {kind, action: "reload", intake_id, …}; the screen renders
// the sentence and the one button.
export function waitingOnYou({ intakeRows = [], matchQueue = [], uploadQueue = [] } = {}) {
  const cards = heldPayrollCards(intakeRows);
  cards.push(...deferredToAccountantCards(intakeRows, { uploadQueue }));
  const m = matchingCard(matchQueue);
  if (m) cards.push(m);
  return cards;
}

// Plain-language sentence for a card — derived from its fields, never composed alongside.
export function waitingCopy(card) {
  if (!card) return "";
  if (card.kind === "payroll_held") return `${card.filename} was held rather than posted — ${card.reasons}`;
  if (card.kind === "deferred_to_accountant") return card.reloadable
    ? `${card.filename} was set aside for you after a question the owner couldn't answer — nothing is booked until you decide.`
    : `${card.filename} was set aside for you after a question, and we no longer have the file to ask it again — it will need to be dropped again.`;
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
