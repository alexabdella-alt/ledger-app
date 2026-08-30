// ─────────────────────────────────────────────────────────────────────────────
// O83 Trap 2 — a SIGNED period is a GUARDED period. Once a reviewer attests a month
// (an active period_signoffs row), no write may SILENTLY change that month's totals:
// the attestation would then vouch for numbers that no longer exist. This mirrors the
// cutoff guard (openingBalances.js) but instead of a hard block it routes to an explicit
// decision (reopen / rebook to the open month / send to the CPA).
//
// Pure + tested; the App wires the detection into every write path (booking, multi-line,
// recode, void, mark-paid) and renders the decision surface.
// ─────────────────────────────────────────────────────────────────────────────
import { isPeriodSignedOff } from "./signoff.js";
import { monthLabel } from "./ownerTrust.js";

// "2026-01-28" → "2026-01" (the sign-off period key). Null on a malformed date.
export function periodOf(date) {
  const m = /^(\d{4})-(\d{2})/.exec(String(date || ""));
  return m ? `${m[1]}-${m[2]}` : null;
}

// The ACTIVE signed period a date falls into, or null. Opening-balance entries are exempt
// (they ARE the pre-cutoff position, never "activity in a month"). This is the single
// predicate every write path calls before posting/mutating.
export function signedPeriodForDate(date, signoffs = [], { source = null } = {}) {
  if (source === "opening_balance") return null;
  const p = periodOf(date);
  return p && isPeriodSignedOff(signoffs, p) ? p : null;
}

// Would this mutation change a signed period? True if the entry's own date is in a signed
// period (recode/void/edit of an entry INSIDE a signed month, or a backdated mark-paid).
export function mutationHitsSignedPeriod(entry, signoffs = []) {
  return !!signedPeriodForDate(entry && entry.date, signoffs, { source: entry && entry.source });
}

// ─────────────────────────────────────────────────────────────────────────────
// O130 — ONE "REMOVE THIS" DECISION, MADE BY THE SYSTEM.
//
// The product offered TWO destructive controls, Void and Delete, and asked the owner to
// pick. **"Void" and "reversal" are bookkeeper words** — an owner cannot be expected to
// know that one erases a draft and the other posts a dated correction, and being wrong
// about it is how one invoice ended up reversed three times (O123/O126).
//
// ★★ AND THE CHOICE WAS NEVER REALLY THEIRS TO MAKE, BECAUSE ONE INPUT DECIDES IT:
// HAS THE MONTH BEEN SIGNED OFF?
//   · NOT signed → nobody has attested to those numbers yet, so removing a wrong entry is
//     correcting a draft. Soft delete: the row survives, every view filters it, Undo
//     restores it, and the audit trail keeps it.
//   · SIGNED → you may not quietly change a month your accountant put their name to. That
//     is the entire value of the signature. The correction must be a NEW entry dated
//     today, which is what a reversal actually is.
//
// So the user gets one button and the machine picks. This is the same "outcomes, not
// tasks" rule the rest of the product runs on, applied to the one place it was still
// asking the owner to do accounting.
//
// PURE — takes the entry and the sign-off list, returns the decision and the sentence.
// The sentence lives here WITH the decision (§9: describe from the record) so a caller
// cannot render "Deleted" over a correction, or the reverse.
// ─────────────────────────────────────────────────────────────────────────────

export const REMOVAL = { DELETE: "delete", CORRECT: "correct" };

export function planEntryRemoval(entry, signoffs = [], { monthLabel = null } = {}) {
  const period = signedPeriodForDate(entry && entry.date, signoffs, { source: entry && entry.source });
  const who = (entry && entry.vendor && String(entry.vendor).trim()) || "this transaction";
  if (!period) {
    return {
      mode: REMOVAL.DELETE,
      period: null,
      confirm: `Remove the entry for ${who}? You'll have 30 seconds to undo, and your accountant can restore it later.`,
      done: null,   // the delete path owns its own toast (it carries the Undo action)
    };
  }
  const label = (typeof monthLabel === "function" ? monthLabel(period) : null) || period;
  return {
    mode: REMOVAL.CORRECT,
    period,
    // Says what will happen and WHY, without the words "void", "reversal" or "journal".
    confirm: `${label} has already been signed off by your accountant, so we won't change it. We'll record a correction dated today that cancels this out instead. Go ahead?`,
    done: `Corrected — we recorded it today rather than changing ${label}.`,
  };
}

// ── BULK REMOVAL (the Books multi-select) ────────────────────────────────────
// `softDeleteInvoices` — batch write, ONE Undo toast — has existed since C-something and
// been wired to NO component. The cost is on record: remediating the O83 double-book took
// **scripted database access** to remove 14 entries, because the app could only delete one
// at a time. That is the shape of a product that makes you leave it to fix it.
//
// ★★ A SELECTION CAN STRADDLE THE SIGN-OFF BOUNDARY, AND THAT IS THE WHOLE DIFFICULTY.
// O130 settled the single-entry rule: an open month is a draft (remove it), a signed month
// is attested (post a dated correction). A batch may contain both — and the two need
// genuinely different treatment, so the honest answer is to do the removable ones as one
// undoable batch and SAY what was left, rather than quietly applying either rule to
// everything.
//
// ▶ THE SIGNED ONES ARE NOT SILENTLY CORRECTED IN BULK. A correction is a new dated entry
// that changes this month's numbers; posting several without the person seeing each one is
// exactly the invisible-action class (§9). They are named and left for the single-entry
// path, which shows the confirmation O130 wrote.
export function planBulkRemoval(entries = [], signoffs = [], { monthLabel = null } = {}) {
  const removable = [];
  const signed = [];
  for (const e of entries || []) {
    if (!e) continue;
    const period = signedPeriodForDate(e.date, signoffs, { source: e.source });
    if (period) signed.push({ entry: e, period });
    else removable.push(e);
  }
  const label = (p) => (typeof monthLabel === "function" ? monthLabel(p) : null) || p;
  const months = [...new Set(signed.map((s) => label(s.period)))].sort();

  const n = removable.length;
  const confirm = n
    ? `Remove ${n} ${n === 1 ? "entry" : "entries"}? You'll have 30 seconds to undo, and your accountant can restore them later.`
    : null;
  // Says what will be LEFT BEHIND and why, before anything happens — not afterwards.
  const blocked = signed.length
    ? `${signed.length} of these ${signed.length === 1 ? "is" : "are"} in ${months.length === 1 ? months[0] : "months"} your accountant has signed off, so we won't change ${months.length === 1 ? "it" : "them"} in bulk. Open ${signed.length === 1 ? "that one" : "those"} individually and we'll record a correction dated today instead.`
    : null;

  return { removable, signed, months, confirm, blocked };
}

// Option (b): rebook the entry into the CURRENT open month (date-adjust for a cash-basis
// straggler) — KEEP the document's original date in metadata so nothing is lost, and stamp
// why. Pure; returns a NEW invoice object (never mutates the input).
export function rebookedIntoOpenMonth(invoice, today, fromPeriod = null) {
  const orig = invoice && invoice.date;
  return {
    ...invoice,
    date: today,
    import_metadata: {
      ...(invoice && invoice.import_metadata),
      original_date: orig,
      rebooked_from_signed_period: fromPeriod || periodOf(orig),
    },
  };
}

// Owner-facing, plain-language copy for the decision surface (Cardinal Principle: no
// "period_signoffs", no GL/debit-credit jargon). `period` is "YYYY-MM".
export function signedPeriodOwnerCopy(period) {
  const label = monthLabel(period) || "an earlier month";
  return {
    title: `This is dated ${label} — already reviewed`,
    body: `This entry is dated ${label}, which your accountant has already reviewed and signed off. Adding it now would change ${label}'s numbers after they were approved.`,
    reopen: `Add it to ${label} and reopen ${label} for your accountant to re-review`,
    rebook: `Add it to the current month instead (keeps the original date on file)`,
    cpa: `Send it to your accountant to decide`,
  };
}
