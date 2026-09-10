// ── O134 — WHICH ENTRIES A RECORDED DOCUMENT LINKS TO ────────────────────────
//
// `document_intake.journal_entry_ids` is what the `docs_recorded` control total reads: a row
// marked RECORDED carrying no link is a document that claims to be booked with nothing behind
// it. So the ids have to be the DURABLE ones, and the count has to cover every transaction the
// document produced.
//
// ★★★ THIS EXISTS BECAUSE THE INVOICE PATH GOT BOTH WRONG, INVISIBLY. It built the list as
// `highConfidence.map(i => i.db_entry_id)` — a read of the LOCAL invoice objects. `bookToDb`
// writes `db_entry_id` through `setInvoices(prev => prev.map(...))`, which builds NEW objects
// in React state; the captured array holds the originals and never gains the field. Every map
// yielded `undefined`, `.filter(Boolean)` emptied it, `setIntakeStatus` skipped the patch, and
// the row went terminal-and-unlinked. Recorded, unlinked, every invoice, every time — and a
// failed control total BLOCKS SIGN-OFF, so the accuracy net failed permanently on the one path
// a real client walks in on, while the books themselves were correct.
//
// ★★ THE RULE, AND IT IS THE WHOLE OF THIS MODULE: AN ENTRY ID COMES FROM WHAT THE WRITE
// RESOLVED TO, NEVER FROM THE OBJECT THAT WAS HANDED TO THE WRITE. That is C307's mechanism
// (an in-session object read where a durable id was needed) and C191's (a parse-time id
// reaching a DB call), stated once so the next caller can be checked against it.

const usable = (v) => v !== null && v !== undefined && v !== "" && v !== false;

// `bookedIds` — the resolved values of the booking promises, one slot per booked invoice, null
// where a booking failed and rolled back. Pass `[]` when the await itself threw: `bookedCount`
// is what says how many were expected, so a total failure reads as "0 of N", never as "0 of 0".
//
// `attached` — O114 attach plans. Nothing new is POSTED for these, but they are not unbacked:
// the document was filed against a payment that already exists, and THAT entry is what stands
// behind it. Leaving them out would leave the attach-only case (O128's "0 invoices booked", a
// real live outcome) permanently failing `docs_recorded` on work that was correct.
export function recordedEntryLinks({ bookedCount = 0, bookedIds = [], attached = [] } = {}) {
  const seen = new Set();
  const push = (v) => { if (usable(v)) seen.add(String(v)); };
  for (const v of bookedIds || []) push(v);
  for (const p of attached || []) {
    const t = p && p.target;
    push(t && (t.db_entry_id ?? t.id));
  }
  const ids = [...seen];
  const expected = Math.max(0, Number(bookedCount) || 0) + (attached ? attached.length : 0);
  return {
    ids,
    expected,
    // Deliberately floored at 0 rather than allowed to go negative: duplicate ids are deduped
    // above, so `ids.length` can only fall short, and a negative would read as a surplus.
    missing: Math.max(0, expected - ids.length),
    complete: expected > 0 && ids.length === expected,
  };
}
