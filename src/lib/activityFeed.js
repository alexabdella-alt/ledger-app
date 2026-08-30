// ─────────────────────────────────────────────────────────────────────────────
// THE OWNER'S ACTIVITY FEED — audit rows are for auditors; this is for a person.
//
// Home renders `a.detail || a.action` VERBATIM out of the audit log. That log is written
// for the CPA and the audit trail, so it carries bookkeeping notation on purpose — and one
// line of it reached the owner's home screen as:
//
//     paid Franklin Ave Properties LP · $2400.00 via ACH · GL Dr AP/Cr Cash posted
//
// Everything to "ACH" is good plain language. The tail is jargon on the one screen whose
// whole job is to be readable by someone with no accounting training.
//
// ★★ THE FIX IS BOTH ENDS, AND THE SECOND ONE IS THE POINT. The writer stops putting the
// notation in the human sentence (it moves to the structured `after_state`, where the
// payment's entry id already lives, so the audit trail loses nothing). But **rendering the
// audit log raw is a general leak vector** — any future audit detail with debit/credit
// wording surfaces on Home the same way, and nobody would notice until it shipped. So the
// feed scrubs as well: fixing the one line without the scrub would fix this instance and
// leave the class.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

// Notation that is correct in an audit trail and wrong in front of an owner. Anchored and
// narrow: it strips a trailing technical CLAUSE, never a word out of the middle of a
// sentence, because a vendor called "Credit Union Services" must survive intact.
const TECHNICAL_TAIL = [
  / · GL [^·]*$/i,                       // "· GL Dr AP/Cr Cash posted"
  / · (Dr|Cr) [A-Z][^·]*$/,              // a bare debit/credit clause
  / · journal entry [0-9a-f-]{8,}[^·]*$/i,
  / · entry id [^·]*$/i,
];

// Words that mean the whole line is machinery rather than an event a person did. These
// rows are kept OUT of the owner feed entirely rather than scrubbed — a half-readable
// sentence about a control total is worse than no line at all.
const SYSTEM_ACTIONS = /^(security_check|coa_template_applied|.*_write_failed|.*_stamp_failed|intake_.*|anomaly_.*|statement_.*|reversal_stamp_failed)$/i;

export function scrubOwnerActivity(detail) {
  let s = String(detail == null ? "" : detail);
  let before;
  do { before = s; for (const re of TECHNICAL_TAIL) s = s.replace(re, ""); } while (s !== before);
  return s.trim();
}

// The line to show, or null when this row is not an owner-facing event.
// `action` is the fallback only when there is no human detail — and an action name is a
// snake_case identifier, so it is humanised rather than printed raw.
export function ownerActivityText(row = {}) {
  const action = String(row.action || "");
  if (!action && !row.detail) return null;
  if (SYSTEM_ACTIONS.test(action)) return null;

  const detail = scrubOwnerActivity(row.detail);
  if (detail) return detail;

  // No detail: turn `invoice_collected` into "Invoice collected" rather than showing the
  // identifier. A raw action name is not a sentence.
  const words = action.replace(/[_-]+/g, " ").trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
