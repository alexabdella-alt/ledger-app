// ─────────────────────────────────────────────────────────────────────────────
// O114 — THE INVOICE AND THE PAYMENT ARE ONE EVENT.
//
// Implements `docs/INVOICE_PAYMENT_SPEC_O114.md`. Pure: no client, no fetch, no
// booking primitive. It takes an arriving invoice plus the entries already in the
// books and returns ONE of three decisions — attach, ask, or book a payable. The
// caller does the writing.
//
// ★★ THE DEFECT THIS EXISTS TO CLOSE IS ORDER-DEPENDENCE, NOT A FLAG.
// An invoice books `Dr Expense / Cr AP`; a bank line books `Dr Expense / Cr Cash`.
// The bank rail already looks for an open bill (`autoMatchBankLines` +
// `matchableOpenItems`) and clears it. The invoice rail has never looked for an
// existing payment — so the books' final state depended on which document arrived
// first, and the common order (statement first, paperwork later) is the wrong one.
// `tests/invoicePayment.test.js` pins the invariant directly: same pair, both
// orders, identical trial balance.
//
// ★ AN ECONOMIC EVENT IS BOOKED ONCE; A SECOND DOCUMENT DESCRIBING IT IS EVIDENCE.
// Accounts Payable is not a thing invoices create — it is the representation of an
// obligation that has not been settled. If the settlement is already in the books
// there is no payable to create, and manufacturing one to clear it in the same
// breath is a two-step no-op that double-counts the expense if either step is missed.
// ─────────────────────────────────────────────────────────────────────────────

import { identityForEntry, readIdentity, IDENTITY_STRATEGY } from "./vendorIdentity.js";
import { matchDirectory } from "./vendorDirectory.js";

// ── AMOUNTS ──────────────────────────────────────────────────────────────────

export const AMOUNT_RELATION = { EXACT: "exact", NEAR: "near", NONE: "none" };

// Same tolerance as `autoMatchBankLines` (bankMatch.js), deliberately. One rule,
// both rails — two independently-written definitions of "same amount" is the
// ·3b(f3) shape, where two halves of one contract disagreed about a format.
export const EXACT_TOLERANCE = 0.01;

// The NEAR band, decided 2026-08-26. It is a UNION OF TWO NAMED RULES rather than
// one magic number, because the causes of a small discrepancy have different scales
// and no single threshold is right for all of them.
//
//   (a) within 2% of the larger amount — rounding, a small discount, a fee
//       difference. A PERCENTAGE because a flat dollar band is wrong in both tails:
//       $25 is 200% of a $12 charge and invisible against a $12,000 one.
//
//   (b) the two amounts are DIGIT PERMUTATIONS of each other — the transposition
//       signature, and it needs no threshold at all because the digit-multiset
//       constraint is self-limiting. This is the real test, not the CPA's
//       divisible-by-9 shortcut, which is only a proxy for it and fires on 1 in 9
//       arbitrary differences.
//
// ★ (b) IS USED FOR CANDIDACY ONLY, NEVER IN THE COPY. Deciding a pair is worth
// ASKING about is not the same as asserting a cause, and the card is forbidden from
// having a theory (§5). It must never say "this looks like a typo" — a transposition
// and a genuine second charge are externally identical, and which one it is is
// exactly what we are asking.
export const NEAR_PCT = 0.02;

const centsOf = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return Math.round(Math.abs(v) * 100);
};

// Do these two amounts use the same digits in a different order? Compared as integer
// CENTS so the decimal point cannot move the answer, and same-length is required —
// 46.85 and 468.50 are not a transposition of one another, they are a magnitude error.
export function digitsPermuted(a, b) {
  const ca = centsOf(a), cb = centsOf(b);
  if (ca == null || cb == null || ca === cb || !ca || !cb) return false;
  const da = String(ca), db = String(cb);
  if (da.length !== db.length) return false;
  return da.split("").sort().join("") === db.split("").sort().join("");
}

export function amountRelation(a, b, { tolerance = EXACT_TOLERANCE, nearPct = NEAR_PCT } = {}) {
  const va = Number(a), vb = Number(b);
  if (!Number.isFinite(va) || !Number.isFinite(vb) || !va || !vb) {
    return { relation: AMOUNT_RELATION.NONE, diff: null, basis: "unreadable_amount" };
  }
  const A = Math.abs(va), B = Math.abs(vb);
  const diff = Math.abs(A - B);
  if (diff <= tolerance) return { relation: AMOUNT_RELATION.EXACT, diff, basis: "exact" };
  if (diff <= Math.max(A, B) * nearPct) return { relation: AMOUNT_RELATION.NEAR, diff, basis: "within_pct" };
  if (digitsPermuted(A, B)) return { relation: AMOUNT_RELATION.NEAR, diff, basis: "digits_permuted" };
  return { relation: AMOUNT_RELATION.NONE, diff, basis: "outside_band" };
}

// ── IDENTITY ─────────────────────────────────────────────────────────────────

export const IDENTITY_RELATION = { EXACT: "exact", NEAR: "near", NONE: "none" };

// ★ EXACT ENTITY-KEY EQUALITY IS REQUIRED TO ATTACH. Never a substring rule.
// `autoMatchBankLines` matches names by two-way substring containment, which is the
// merge rule that let `square` swallow SQUARE DANCE HALL and `sysco` swallow SYSCO
// FUEL in C202's first directory seed. Attaching an invoice to the wrong payment
// SUPPRESSES a real charge, silently, and a suppressed line leaves nothing on screen
// — Q4's one-way door. Failing to attach merely asks a question.
//
// NEAR identity exists ONLY to raise a question, never to authorise an attach: one
// key's token sequence is a strict PREFIX of the other's. That is the Franklin Ave
// shape exactly — `franklin ave properties` (invoice) vs `franklin ave properties
// rent` (bank), where the rail carries a PURPOSE SUFFIX describing what the payment
// was FOR rather than who it was TO. Token-boundary, so `sysco foods` and `sysco
// fuel` are still NONE: neither is a prefix of the other.
//
// ★ ONE COMPARISON-TIME CANONICALISATION: a standalone `and` is dropped. Found by this
// feature's own suite on a real specimen — `Alamo Fire & Safety LLC` (invoice field)
// normalises to `alamo fire and safety` because `normalizeDescriptor` expands `&`, while
// the bank text `ALAMO FIRE SAFETY LLC` carries no ampersand and stays `alamo fire
// safety`. Neither is a prefix of the other, so the same vendor related as NONE.
// Deliberately applied HERE, at comparison, and NOT in `entityKeyFor` — changing key
// MINTING would silently re-key `vendor_state` rows and move tiers. This can only widen
// what this one feature considers, and the anti-merge cases are pinned either way.
const compareKey = (k) => String(k || "").split(" ").filter((t) => t && t !== "and");

export function identityRelation(keyA, keyB) {
  if (!keyA || !keyB) return IDENTITY_RELATION.NONE;
  if (keyA === keyB) return IDENTITY_RELATION.EXACT;
  const a = compareKey(keyA);
  const b = compareKey(keyB);
  if (a.length === b.length && a.every((t, i) => t === b[i])) return IDENTITY_RELATION.EXACT;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length || short.length === long.length) return IDENTITY_RELATION.NONE;
  return short.every((t, i) => t === long[i]) ? IDENTITY_RELATION.NEAR : IDENTITY_RELATION.NONE;
}

// An arriving invoice carries a CLEAN vendor field — it has not been composed into a
// display string yet, so there is no right half to strip. This is the READ half of
// the per-source strategy (C201), applied to the field directly.
export function entityKeyOfInvoice(invoice = {}, { directory = [] } = {}) {
  return canonicalise(readIdentity(invoice.vendor) || null, invoice.vendor, directory);
}

// ★ THE DIRECTORY CANONICALISES, WHICH IS EXACTLY WHAT C202 WAS BUILT FOR.
// Toast is the case: the invoice field `Toast Inc` reads as `toast`, while the bank
// descriptor `…TOAST INC MERCHANT FEES AUG` resolves to `toast merchant fees aug` —
// the month-name split that identity resolution CANNOT merge and must not learn to,
// because word-stripping would also eat "Lone Star Restaurant SUPPLY". The directory
// answers it by RECOGNITION instead, and needs no seed change: the bank side hits
// `toast` and the invoice side already is `toast`.
//
// Safe to canonicalise with because the directory is BINARY and EXACT-by-default (one
// opt-in PREFIX row), and `directoryConflicts` is run over the seed by a test — so two
// vendors can only canonicalise together if the directory itself over-matches, which is
// the defect that guard exists to catch.
function canonicalise(key, raw, directory) {
  if (!directory || !directory.length) return key;
  const hit = matchDirectory(raw || key, directory);
  return hit ? hit.entity_key : key;
}

// A booked entry's descriptor is `"Resolved Vendor – RAW BANK TEXT"`, so identity
// comes from the per-source strategy: RESOLVE takes the right half, READ the left.
// An UNRECOGNISED source is EXCLUDED and COUNTED, never guessed at (C201).
export function entityKeyOfEntry(entry = {}, { directory = [] } = {}) {
  const ident = identityForEntry({
    description: entry.description ?? entry.vendor ?? null,
    source: entry.source,
  });
  if (ident.excluded) return { key: null, excluded: ident.excluded };
  return {
    key: canonicalise(ident.entity_key, ident.raw, directory),
    identity_source: ident.identity_source,
  };
}

// ── CANDIDACY ────────────────────────────────────────────────────────────────

// The payment window. ASYMMETRIC on purpose: a payment normally falls AFTER the
// invoice date (net-30/net-60 terms), and a payment BEFORE it is a prepayment, which
// is rarer and should not widen the common case to accommodate it.
export const WINDOW_BEFORE_DAYS = 7;
export const WINDOW_AFTER_DAYS = 60;

const dayGap = (from, to) => {
  if (!from || !to) return null;
  const a = new Date(`${String(from).slice(0, 10)}T12:00:00Z`);
  const b = new Date(`${String(to).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  return Math.round((b - a) / 86400000);
};

const isLive = (e) => e && e.status !== "voided" && e.status !== "deleted" && !e.deleted_at;

// Is this entry a settlement already recorded — money that has moved? Structural, not
// a flag: the entry carries a CASH leg. §9 doctrine — derive truth from the GL, not
// from `payment_status`, which is a cache that goes stale.
export function isCashSettled(entry = {}, { cashCodes = [] } = {}) {
  const codes = new Set((cashCodes || []).map(String));
  if (!codes.size) return false;
  return codes.has(String(entry.secondary_gl_code)) || codes.has(String(entry.gl_code));
}

// Already carrying an invoice? Attaching twice would let two invoices claim one
// payment, which is the double-count arriving by a different door.
export function hasAttachedInvoice(entry = {}) {
  const m = entry.import_metadata || {};
  return !!(m.invoice_attached || m.attached_invoice_id || entry.attached_invoice_id);
}

// Every settlement already in the books that could be THIS invoice. Returns the
// candidates AND a named count of what was ruled out — a candidate list with no
// denominator cannot tell "nothing matched" from "nothing was examined", which is
// the C195(7) failure (a block whose input was always empty for a whole release).
export function settlementCandidates(invoice = {}, entries = [], ctx = {}) {
  const { cashCodes = [], amountOpts = {}, directory = [] } = ctx;
  const invKey = entityKeyOfInvoice(invoice, { directory });
  const excludedBy = {};
  const bump = (k) => { excludedBy[k] = (excludedBy[k] || 0) + 1; };

  if (!invKey) return { candidates: [], excludedBy: { invoice_no_identity: 1 }, invoiceEntityKey: null };

  const candidates = [];
  for (const e of entries || []) {
    if (!isLive(e)) { bump("not_live"); continue; }
    if (String(e.id) === String(invoice.id)) { bump("self"); continue; }
    if (!isCashSettled(e, { cashCodes })) { bump("not_cash_settled"); continue; }
    if (hasAttachedInvoice(e)) { bump("already_attached"); continue; }

    const { key, excluded } = entityKeyOfEntry(e, { directory });
    if (excluded) { bump(`entry_${excluded}`); continue; }

    const idRel = identityRelation(invKey, key);
    if (idRel === IDENTITY_RELATION.NONE) { bump("identity_none"); continue; }

    const amt = amountRelation(invoice.amount, e.amount, amountOpts);
    if (amt.relation === AMOUNT_RELATION.NONE) { bump("amount_none"); continue; }

    const gap = dayGap(invoice.date, e.date);
    if (gap == null) { bump("undated"); continue; }
    if (gap < -WINDOW_BEFORE_DAYS || gap > WINDOW_AFTER_DAYS) { bump("outside_window"); continue; }

    candidates.push({ entry: e, entityKey: key, identity: idRel, amount: amt, gapDays: gap });
  }

  // ★★ ONE ENTRY IS ONE PAYMENT, HOWEVER MANY ROWS IT FLATTENS TO.
  // `flattenJournalEntries` emits ONE row for a <=2-line entry (`id: e.id`) but expands a
  // MULTI-LINE entry into one row PER LINE (`id: `${e.id}_${li}``, all sharing
  // `db_entry_id`). Without this dedupe a multi-line settlement — a payroll run, a taxed
  // AR invoice, a lease commencement — would present as several candidates, and
  // `planInvoiceArrival` would see "more than one payment of that amount" and refuse to
  // choose. **The refusal would be safe and completely wrong**, and it would look like the
  // ambiguity the card exists for rather than like a bug.
  //
  // WHY IT WAS INVISIBLE: every fixture pays through a 2-line bank entry, so every input
  // the suite could construct lacked the property that breaks this. Same shape as a guard
  // whose input is always empty (C195(7)) — the code was never wrong on any case anyone
  // could write down. Pinned now by a test that builds the multi-line shape explicitly.
  const byEntry = new Map();
  for (const c of candidates) {
    const key = String(c.entry.db_entry_id ?? c.entry.id);
    // Keep the CLOSEST amount match, so a multi-line entry is represented by its most
    // relevant leg rather than by whichever line happened to come first.
    const prev = byEntry.get(key);
    if (!prev || (c.amount.diff ?? Infinity) < (prev.amount.diff ?? Infinity)) byEntry.set(key, c);
  }
  return { candidates: [...byEntry.values()], excludedBy, invoiceEntityKey: invKey };
}

// ── THE DECISION ─────────────────────────────────────────────────────────────

export const ARRIVAL = {
  ATTACH: "attach",              // one certain settlement — file the invoice against it
  ASK: "ask",                    // a human decides; nothing is booked until they do
  BOOK_PAYABLE: "book_payable",  // a real unsettled obligation — today's path, unchanged
};

export const ASK_REASON = {
  AMOUNT_DIFFERS: "amount_differs",
  IDENTITY_DIFFERS: "identity_differs",
  MULTIPLE_CANDIDATES: "multiple_candidates",
  // ★ NOT a judgement about the ledger — a report that WE failed. The match was certain
  // and the write that records it did not land. It earns its own reason because reusing
  // MULTIPLE_CANDIDATES made the card assert a false fact about the books, and a drive
  // whose output misstates its own failure cannot be diagnosed from that output.
  RECORD_FAILED: "record_failed",
};

// ★ ATTACH REQUIRES CERTAINTY ON BOTH AXES AND A SINGLE CANDIDATE.
// Anything less asks. The asymmetry is the whole design: failing to attach asks a
// question a human can answer, whereas wrongly attaching suppresses a real charge
// with nothing left on screen to notice.
export function planInvoiceArrival(invoice = {}, entries = [], ctx = {}) {
  const { candidates, excludedBy, invoiceEntityKey } = settlementCandidates(invoice, entries, ctx);
  const base = { candidates, excludedBy, invoiceEntityKey };

  if (!candidates.length) {
    return { ...base, action: ARRIVAL.BOOK_PAYABLE, candidate: null, reason: null, basis: "no_candidate" };
  }

  const certain = candidates.filter(
    (c) => c.identity === IDENTITY_RELATION.EXACT && c.amount.relation === AMOUNT_RELATION.EXACT,
  );

  if (certain.length === 1) {
    return { ...base, action: ARRIVAL.ATTACH, candidate: certain[0], reason: null, basis: "exact_identity_exact_amount" };
  }
  if (certain.length > 1) {
    return { ...base, action: ARRIVAL.ASK, candidate: null, reason: ASK_REASON.MULTIPLE_CANDIDATES, basis: "multiple_exact" };
  }

  // One uncertain axis (or both). Name WHICH, because the card's sentence differs and
  // an unattributed ask is one a human cannot act on.
  const best = candidates[0];
  const reason = best.identity !== IDENTITY_RELATION.EXACT
    ? ASK_REASON.IDENTITY_DIFFERS
    : ASK_REASON.AMOUNT_DIFFERS;
  return {
    ...base,
    action: ARRIVAL.ASK,
    candidate: candidates.length === 1 ? best : null,
    reason: candidates.length === 1 ? reason : ASK_REASON.MULTIPLE_CANDIDATES,
    basis: best.amount.basis,
  };
}

// ── THE ATTESTATION BOUNDARY ─────────────────────────────────────────────────

// ★★ AN ATTESTATION IS SCOPED TO THE QUESTION THAT WAS ASKED (CLAUDE.md §9).
// Resolving this card answers "are these two documents the same purchase?" — a
// judgment about DOCUMENT IDENTITY. It is not a judgment about which account the
// vendor's charges belong in, and in the common case the human never even sees the
// account, because attaching does not change it.
//
// Without this constant the hazard is concrete: `attestationStrengthFor` grades a
// line EXPLICIT when `exception_resolved` is set, an ambiguity card IS an exception,
// and Amendment B's backfill bar is ">= 1 explicit". A vendor would graduate to KNOWN
// on PAPERWORK VOLUME, with `attested_account_id` set to whatever the machine happened
// to book — the machine attesting to its own guess through a human's click on an
// unrelated question, which is precisely what Amendment B was signed to prevent.
//
// Pinned in `tests/vendorBackfill.test.js`, where a falsifier of the attestation rule
// would look — NOT in this feature's own suite. The ·3c review bounce is the lesson:
// a proof in the wrong file is indistinguishable from no proof at all.
export const MATCH_EXCEPTION_KIND = "invoice_payment_match";

// What resolving the card records. Two facts, deliberately separate: the MATCH never
// attests a mapping; a RECODE always does, because a human looked at the account and
// changed it. Only the second touches the familiarity clock.
export function matchResolutionFacts({ entryId, invoiceId, answer, recodedAccountId = null } = {}) {
  return {
    match: { kind: MATCH_EXCEPTION_KIND, entry_id: entryId ?? null, invoice_id: invoiceId ?? null, answer: answer ?? null, attests_mapping: false },
    recode: recodedAccountId ? { account_id: String(recodedAccountId), attests_mapping: true } : null,
  };
}
