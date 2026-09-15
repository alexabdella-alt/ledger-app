// ─────────────────────────────────────────────────────────────────────────────
// WHAT A DOCUMENT'S INTAKE ROW BECOMES ONCE ITS QUESTIONS ARE ANSWERED (C367).
//
// The pipeline holds a document's intake row "awaiting clarification" when it raises a
// card, and nothing ever advanced it: an answer booked the entry through `bookToDb` and the
// row stayed HELD with that sentence forever. Harmless-looking until C365 read the sentence
// back — every document whose question had been ANSWERED then read as "still waiting for
// an answer from you", a category-1 card shipped by the fix for a category-1 card.
//
// One document can raise several cards (one per invoice on it), so the row settles only
// when the LAST card resolves, and what it settles to is decided here, purely, from the
// outcomes of every card and the ids the batch had already landed at hold time:
//   · anything deferred to the accountant → HELD, with a sentence that is not a question
//   · anything booked or attached          → RECORDED with every id that landed (C311: an
//                                            attach is backed by the payment's entry)
//   · only skips                           → REJECTED (a duplicate, or personal)
// A failed booking reports nothing; its card stays open, so the row stays "awaiting".
// ─────────────────────────────────────────────────────────────────────────────
import { INTAKE_STATUS } from "./documentIntake";

import { DEFERRED_DETAIL, ANSWER_NOT_LANDED_DETAIL } from "./waitingOnYou";
// One string, owned by the reader (waitingOnYou) and re-exported for the writer.
export const CLARIFICATION_DEFERRED_DETAIL = DEFERRED_DETAIL;

export const ANSWER_OUTCOME = { BOOKED: "booked", ATTACHED: "attached", SKIPPED: "skipped", DEFERRED: "deferred" };

export function settleIntakeAfterAnswers({ outcomes = [], existingIds = [], remainingCards = 0 } = {}) {
  if (remainingCards > 0) return { status: null, reason: "cards remain" };
  const landed = [...new Set([
    ...(existingIds || []).map(String),
    ...outcomes.filter((o) => o && o.jeId != null).map((o) => String(o.jeId)),
  ])];
  if (outcomes.some((o) => o && o.kind === ANSWER_OUTCOME.DEFERRED)) {
    return { status: INTAKE_STATUS.HELD, journalEntryIds: landed, detail: CLARIFICATION_DEFERRED_DETAIL };
  }
  const booked = outcomes.filter((o) => o && (o.kind === ANSWER_OUTCOME.BOOKED || o.kind === ANSWER_OUTCOME.ATTACHED));
  if (booked.length && booked.every((o) => o.jeId != null)) {
    return {
      status: INTAKE_STATUS.RECORDED, journalEntryIds: landed,
      detail: `${landed.length} transaction(s) recorded after your answer${outcomes.length === 1 ? "" : "s"}`,
    };
  }
  if (booked.length) {
    // something claimed booked with no id — never RECORDED (C311: terminal-and-unlinked is a lie)
    return { status: INTAKE_STATUS.HELD, journalEntryIds: landed, detail: ANSWER_NOT_LANDED_DETAIL };   // C391 — read back by heldPartialRows
  }
  if (outcomes.length && outcomes.every((o) => o && o.kind === ANSWER_OUTCOME.SKIPPED)) {
    return { status: INTAKE_STATUS.REJECTED, journalEntryIds: landed, detail: "skipped after your answer — a duplicate or not a business expense" };
  }
  return { status: null, reason: "nothing to settle" };
}
