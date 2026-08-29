// ─────────────────────────────────────────────────────────────────────────────
// THE SENTENCE THE OWNER READS AFTER A FILE IS PROCESSED — derived from the recorded
// outcome, and nothing else.
//
// ★★ WHY THIS IS A MODULE AND NOT A CLOSURE IN A JSX BLOCK. CLAUDE.md §9: a description
// composed ALONGSIDE the work can diverge from it, and when it does the books are right
// and the user is misinformed — the worst combination available, because nothing is
// broken so nothing gets fixed. The defence is that every clause must READ A FIELD of the
// outcome. That is only checkable if the sentence is a pure function of the outcome, so
// this is the sentence and `invoiceResult` is the record.
//
// ★ O128 — THE BUG THIS CLOSES. `invoiceCount` counts only what was BOOKED, and the
// renderer read nothing else, so a file whose invoices all matched payments already in the
// books rendered "✓ 0 invoices booked · $0.00 total". That is the SUCCESS case — filing an
// invoice against a payment we already hold is exactly what stops an expense being counted
// twice — announced as though nothing had happened.
// ─────────────────────────────────────────────────────────────────────────────

const money = (n) => `$${(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "filed with a payment we already had" — the attach outcome, in the owner's words. No
// jargon, and it says the CONSEQUENCE ("not counted twice") because that is the part that
// makes the outcome good news rather than a null result.
export function attachPhrase(r = {}) {
  const n = Number(r.attachedCount) || 0;
  if (n <= 0) return null;
  return n === 1
    ? `${r.attachedVendor || "This invoice"} · ${money(r.attachedAmount)} — filed with the payment we already had, not counted twice`
    : `${n} invoices filed with payments we already had · ${money(r.attachedAmount)} — not counted twice`;
}

// The whole line. `pendingReview` is the caller's live view of whether anything is still
// unanswered, which the stored result cannot know on its own.
export function invoiceOutcomeCopy(r = {}, { pendingReview = false } = {}) {
  const booked = Number(r.invoiceCount) || 0;
  const asking = Number(r.needsClarification) || 0;
  const attach = attachPhrase(r);

  // Nothing booked and nothing asked, but something WAS filed → say that, on its own.
  if (attach && booked === 0 && asking === 0) return `✓ ${attach}`;

  if (booked === 0 && asking > 0) {
    // Once the question has been answered and booked, flip to ✓.
    if (!pendingReview) {
      return `✓ Booked${r.reviewVendor ? `: ${r.reviewVendor}` : ""}${r.reviewAmount != null ? ` · ${money(r.reviewAmount)}` : ""}`
           + (attach ? ` · ${attach}` : "");
    }
    return `⚠ Needs your input · ${r.reviewVendor || "this entry"}${r.reviewAmount != null ? ` · ${money(r.reviewAmount)}` : ""}`
         + (asking > 1 ? ` (+${asking - 1} more)` : "")
         + (attach ? ` · ${attach}` : "");
  }

  // Plain-language trail (Cardinal Principle): "as a client meal", never an account name
  // or a confidence score. `bookedAs` is read off the BOOKED ACCOUNT since O115 — it used
  // to keyword-match the vendor, and announced a 5000 Cost-of-Goods entry as a client meal.
  let txt = booked === 1
    ? `✓ Booked: ${r.vendor || "entry"} · ${money(r.amount)}${r.bookedAs ? ` as ${r.bookedAs}` : ""}`
    : `✓ ${booked} invoices booked · ${money(r.amount)} total`;
  if (attach) txt += ` · ${attach}`;
  if (asking > 0 && pendingReview) txt += ` · ${asking} need${asking === 1 ? "s" : ""} your review`;
  return txt;
}
