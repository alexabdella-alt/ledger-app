// ─────────────────────────────────────────────────────────────────────────────
// O120 — WHICH QUESTIONS DESERVE TO STOP YOU.
//
// Ten cards sat unanswered through the August drive while the header said the books were
// correct and up to date. The obvious fix — a pop-up per card — fights the product: the
// stated promise is **book everything and batch the judgement to close**, and a modal per
// item **turns a queue you can zip through into a gauntlet.**
//
// ★★★ SO THE QUESTION IS NOT "MODAL OR NOT", IT IS **WHICH CARDS EARN AN INTERRUPTION** —
// and the discriminator was already decided: **a card whose wrong answer books silently
// wrong may stop you; one whose wrong answer is visible and undoable waits its turn.**
//
//   · **STOPS** — the `O114` lifecycle card is the archetype. *"Different purchase"* mints a
//     phantom payable; *"same purchase"* suppresses a real charge — **and the more dangerous
//     of the two leaves nothing on any screen.** You cannot notice you got it wrong.
//   · **WAITS** — a low-confidence category question. Wrong is visible in the account, and a
//     recode undoes it. It belongs in the batch, which is the whole point of the batch.
//
// ★★ AND IT IS ORDERING, NOT INTERRUPTING. Nothing here opens a modal. The cards that can
// break the books silently come FIRST and are counted by name in the banner, so they cannot
// be scrolled past — while the sitting stays a sitting. **"Louder" was never the fix; the
// fix is that the dangerous ones are not buried behind the harmless ones.**
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const URGENCY = {
  STOPS: "stops",   // a wrong answer books silently wrong — nothing on screen to notice
  WAITS: "waits",   // a wrong answer is visible and undoable
};

// ★ KEYED ON WHAT THE WRONG ANSWER DOES, NOT ON SEVERITY OR AMOUNT. A $40 lifecycle card
// still stops you and a $40,000 category question still waits, because the question is
// whether you could TELL — not how much is at stake.
const STOPS_ON = new Set([
  // O114 — attach-or-book. One branch suppresses a real charge with nothing left on screen.
  "lifecycle", "amount_differs", "identity_differs", "multiple_candidates", "period_count_mismatch",
  // A duplicate answered wrongly either double-counts or silently drops a real charge.
  "duplicate", "duplicate_payment",
  // Revenue-vs-expense: booked backwards, the P&L is wrong in both directions at once and
  // the entry itself looks perfectly ordinary.
  "direction",
]);

export function urgencyOf(card = {}) {
  const kind = card.kind || card.type || card.reason || card.field || null;
  if (kind && STOPS_ON.has(String(kind))) return URGENCY.STOPS;
  // ★ THE DEFAULT IS *WAITS*, DELIBERATELY. Getting this wrong in the "stops" direction
  // rebuilds the gauntlet the batch exists to avoid — and an unclassified card is far more
  // likely to be an ordinary category question than a silent-failure one. Adding a kind to
  // the set is a decision someone makes; drifting into it is not.
  return URGENCY.WAITS;
}

// Dangerous first, then original order preserved within each group — a stable sort, so two
// cards of the same urgency stay in the order the documents arrived.
export function sortByUrgency(cards = []) {
  const open = (cards || []).filter(Boolean);
  return [
    ...open.filter((c) => urgencyOf(c) === URGENCY.STOPS),
    ...open.filter((c) => urgencyOf(c) !== URGENCY.STOPS),
  ];
}

export function countByUrgency(cards = []) {
  const rows = (cards || []).filter(Boolean);
  const stops = rows.filter((c) => urgencyOf(c) === URGENCY.STOPS).length;
  return { stops, waits: rows.length - stops, total: rows.length };
}

// ★★ THE BANNER SAYS WHICH KIND, NOT JUST HOW MANY — and never "scroll down". A count alone
// makes ten harmless questions look like ten problems, which is how a person learns to
// ignore the number entirely.
export function queueBannerCopy(cards = []) {
  const { stops, waits, total } = countByUrgency(cards);
  if (!total) return null;
  if (!stops) {
    return waits === 1
      ? "1 question about a document — it can wait until you're ready."
      : `${waits} questions about your documents — they can wait until you're ready.`;
  }
  const s = stops === 1
    ? "1 needs an answer before we can record it correctly"
    : `${stops} need an answer before we can record them correctly`;
  return waits ? `${s}, and ${waits} that can wait.` : `${s}.`;
}
