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
// C526 — every `*_failed` / `*_failure` row, not only the write- and stamp-shaped ones: Home's
// feed admits actions by keyword (`flag`, `paid`, …), and `settled_flag_resync_failed` — whose
// detail quotes the database's own error in parentheses — walked through on "flag". A failure
// is toasted in the owner's words at the moment it happens (C415); the audit row keeps the raw
// reason for the accountant, and the owner's feed is not the place to read it back.
const SYSTEM_ACTIONS = /^(security_check|coa_template_applied|.*_failed|.*_failure|intake_.*|anomaly_.*|statement_.*)$/i;

export function scrubOwnerActivity(detail) {
  let s = String(detail == null ? "" : detail);
  let before;
  do { before = s; for (const re of TECHNICAL_TAIL) s = s.replace(re, ""); } while (s !== before);
  return s.trim();
}

// The line to show, or null when this row is not an owner-facing event.
// `action` is the fallback only when there is no human detail — and an action name is a
// snake_case identifier, so it is humanised rather than printed raw.
// ★ C747 — what older payment rows still say on the live feed, put in plain words:
//   "alexabdella@… paid Nike, Inc. · $151.55 via BANK_TRANSFER"            (a COLLECTION, raw method)
//   "Nike, Inc. · $151.55 auto-matched & marked collected from bank statement (n/a)"   (Nike was a bill PAID)
// The actor is "You" when it's the person reading, "Our team" for Support Mode; a raw method code
// reads as words; "(n/a)" goes; a collection's "paid" becomes "received from". Current writers
// already say "collected from" and pretty methods — this is for the rows already in the log.
const METHOD_WORDS = { BANK_TRANSFER: "bank transfer", ACH: "ACH", CHECK: "check", WIRE: "wire", CARD: "card", CREDIT_CARD: "card", ZELLE: "Zelle", VENMO: "Venmo", PAYPAL: "PayPal", CASH: "cash", OTHER: "another method" };
export function plainPaymentWords(detail, { action = "", viewerEmail = "" } = {}) {
  let s = String(detail || "");
  s = s.replace(/\s*\(n\/a\)/gi, "");
  // Neutral on purpose: the old writer said "collected" for bills it PAID (seen live: Nike, an
  // expense, "auto-matched & marked collected"), so the old word can't be trusted to name the side.
  s = s.replace(/auto-matched & marked (collected|paid) from bank statement/i, "matched to your bank statement");
  s = s.replace(/\bvia ([A-Z][A-Z_]+)\b(?![a-z]|\s*\/)/g, (m, code) => code === "ACH" ? m : (METHOD_WORDS[code] ? `by ${METHOD_WORDS[code]}` : `by ${code.toLowerCase().replace(/_/g, " ")}`));
  const lead = s.match(/^(Platform Admin - \S+|\S+@\S+) /);
  if (lead) {
    const who = lead[1];
    const label = /^Platform Admin - /.test(who) ? "Our team" : (viewerEmail && who.toLowerCase() === String(viewerEmail).toLowerCase() ? "You" : who);
    s = label + s.slice(who.length);
  }
  if (/collect/i.test(action)) s = s.replace(/^(\S+(?: team)?) paid /, "$1 received a payment from ");
  return s;
}

export function ownerActivityText(row = {}, { viewerEmail = "" } = {}) {
  const action = String(row.action || "");
  if (!action && !row.detail) return null;
  if (SYSTEM_ACTIONS.test(action)) return null;

  const detail = plainPaymentWords(scrubOwnerActivity(row.detail), { action, viewerEmail });
  if (detail) return detail;

  // No detail: turn `invoice_collected` into "Invoice collected" rather than showing the
  // identifier. A raw action name is not a sentence.
  const words = action.replace(/[_-]+/g, " ").trim();
  if (!words) return null;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
