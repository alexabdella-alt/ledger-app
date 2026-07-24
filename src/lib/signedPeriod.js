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
