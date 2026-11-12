import { vendorGroupKey } from "./vendorIdentity.js";
import { applyAlias, buildAliasIndex } from "./vendorAlias.js";
import { isSettlementEntry } from "./gl.js";
// ─────────────────────────────────────────────────────────────────────────────
// FULL 1099 ELIGIBILITY — worked out from what the supplier is and what they were paid,
// not from a flag someone ticked.
//
// ★★★ THE STAKE IS NOT TIDINESS. A 1099 is filed with the IRS under the accountant's name.
// The live finding that opened this: on one company nearly every supplier carried the flag,
// including food, equipment and a utility — **none of which are 1099-NEC reportable** —
// because the badge was effectively defaulted on. Wrong flags become wrong filings.
//
// ★★ SO THE OUTPUT IS A PROPOSAL WITH REASONS, NEVER A BARE YES/NO. A CPA signing a filing
// needs to know WHY we think a supplier qualifies, and needs the cases we cannot decide to
// arrive as questions rather than as answers.
//
// ★★★ AND THE RULE THAT MATTERS MOST: **AN UNKNOWN ENTITY TYPE IS NOT "NOT A CORPORATION".**
// If we do not know whether a supplier is incorporated, we can say neither "exempt" nor
// "eligible" — we must say we need to know. Treating unknown as not-exempt would file 1099s
// for corporations; treating it as exempt would miss real ones. `NEEDS_INFO` is a
// first-class outcome for exactly that reason (O98, applied where it costs money).
//
// ▶ NOT TAX ADVICE AND NOT A FILING. This proposes; a person decides. Amounts come from the
// LEDGER (what was actually paid), never from a flag (§9).
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const IRS_1099_THRESHOLD = 600;

// What KIND of payment this was, decided by the account it landed in — never by the
// supplier's name (§9: the account fixes the category).
export const PAYMENT_KIND = {
  SERVICES: "services",   // 1099-NEC box 1
  RENT: "rent",           // 1099-MISC box 1
  LEGAL: "legal",         // 1099-NEC/MISC — reportable EVEN TO A CORPORATION
  MEDICAL: "medical",     // 1099-MISC box 6 — also reportable to a corporation
  GOODS: "goods",         // not reportable at all
  UNKNOWN: "unknown",
};

// system_role → payment kind. Roles, not codes, so a renumbered chart still works.
const ROLE_KIND = {
  cogs: PAYMENT_KIND.GOODS,
  food_cost: PAYMENT_KIND.GOODS,
  beverage_cost: PAYMENT_KIND.GOODS,
  merchandise_cost: PAYMENT_KIND.GOODS,
  paper_packaging: PAYMENT_KIND.GOODS,
  kitchen_supplies: PAYMENT_KIND.GOODS,
  office_supplies: PAYMENT_KIND.GOODS,
  professional_services: PAYMENT_KIND.LEGAL,   // "Professional Services (Legal/Accounting)"
  repairs_maintenance: PAYMENT_KIND.SERVICES,
  linen_laundry: PAYMENT_KIND.SERVICES,
  waste_removal: PAYMENT_KIND.SERVICES,
  marketing_advertising: PAYMENT_KIND.SERVICES,
  rent_occupancy: PAYMENT_KIND.RENT,
  // Deliberately absent: utilities, insurance, software, interest, payroll. They are either
  // exempt by rule or paid to entities that are, and guessing them is how the badge ended up
  // on a utility company in the first place.
};

export function paymentKindForRole(role) {
  if (!role) return PAYMENT_KIND.UNKNOWN;
  return ROLE_KIND[String(role)] || PAYMENT_KIND.UNKNOWN;
}

// ── ENTITY TYPE ──────────────────────────────────────────────────────────────
export const ENTITY = { EXEMPT: "exempt", REPORTABLE: "reportable", UNKNOWN: "unknown" };

const CORP = /\b(inc|incorporated|corp|corporation|pc|p\.c\.)\b/i;
const NOT_CORP = /\b(sole ?proprietor|individual|partnership|llc|lp|llp|contractor|freelance)\b/i;

// ★ READS THE STATED business_type FIRST, and only then the NAME — and a name is weak
// evidence, so it can produce REPORTABLE or EXEMPT but never overrides a stated type.
// ★ C589 — THE TYPES THE APP ITSELF SAVES. The 1099 screen stores `smllc`, `sole_prop`,
// `corp`, `scorp`, `nonprofit`; the patterns below are written for words a person types
// ("LLC", "Corporation"), and matched NONE of those five — so a vendor an accountant had
// just classified as a single-member LLC read "we don't know whether they're incorporated".
// The stored codes are answered first, exactly.
const STATED_TYPE = {
  individual: "reportable", sole_prop: "reportable", smllc: "reportable", partnership: "reportable", llc_multi: "reportable",
  corp: "exempt", c_corp: "exempt", scorp: "exempt", s_corp: "exempt", nonprofit: "exempt",
};

export function entityStatus(contact = {}) {
  const stated = String(contact.business_type || "").trim();
  if (stated) {
    const known = STATED_TYPE[stated.toLowerCase()];
    if (known) return known === "exempt" ? ENTITY.EXEMPT : ENTITY.REPORTABLE;
    if (CORP.test(stated)) return ENTITY.EXEMPT;
    if (NOT_CORP.test(stated)) return ENTITY.REPORTABLE;
  }
  const name = String(contact.name || "");
  if (CORP.test(name)) return ENTITY.EXEMPT;
  if (NOT_CORP.test(name)) return ENTITY.REPORTABLE;
  return ENTITY.UNKNOWN;
}

// ── THE VERDICT ──────────────────────────────────────────────────────────────
export const VERDICT = {
  ELIGIBLE: "eligible",
  BELOW_THRESHOLD: "below_threshold",
  GOODS_ONLY: "goods_only",
  CORP_EXEMPT: "corp_exempt",
  NEEDS_INFO: "needs_info",
  ALREADY_SENT: "already_sent",
  MARKED_EXEMPT: "marked_exempt",
};

const NOT_A_PURCHASE_DIGIT = new Set(["2", "3", "4"]);
const MONEY_ROLES = new Set(["cash", "savings", "accounts_receivable", "undeposited_funds"]);

// Payments to one vendor in one tax year, split by kind. `invoices` are flattened ledger
// rows; `roleOfCode` maps a gl_code to its system_role.
export function reportablePayments(rows = [], roleOfCode = () => null) {
  const byKind = {};
  let total = 0;
  for (const r of rows || []) {
    if (!r || r.status === "voided" || r.status === "deleted" || r.deleted_at) continue;
    // ★ C589 — ONLY WHAT WAS BOUGHT COUNTS, NEVER HOW IT WAS PAID FOR. Every row carrying the
    // vendor's name used to go in, so the PAYMENT of a bill (Dr Accounts Payable / Cr Cash)
    // was counted as a second purchase "in an account we can't classify": a $1,000 legal bill
    // paid three weeks later read "$2,000 — can't decide", and every vendor paid on terms
    // landed in "needs info". A 1099 reports what the money was FOR. So: a settlement is
    // skipped; so is a row whose account is a liability, equity or income (2/3/4 — the bill's
    // payment, a loan, a sale to the same party), and money merely moving through cash or
    // what a customer owes. An expense counts, and so does something bought and put on the
    // balance sheet (equipment a contractor installed, a prepaid service) — that still asks.
    const code = String(r.gl_code ?? "");
    if (isSettlementEntry(r) || NOT_A_PURCHASE_DIGIT.has(code[0])) continue;
    if (code[0] === "1" && MONEY_ROLES.has(roleOfCode(r.gl_code))) continue;
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    // A credit to an expense account is a correction: it REDUCES what they were paid.
    const signed = r.debit_credit === "credit" ? -amt : amt;
    const kind = paymentKindForRole(roleOfCode(r.gl_code));
    byKind[kind] = (byKind[kind] || 0) + signed;
    total += signed;
  }
  return { byKind, total };
}

// ★ C573 — WAS A 1099 SENT FOR THIS YEAR? The column used to be `sent_1099_2025`, read for
// EVERY year: from the 2026 tax year on, a vendor marked sent last year read "already sent",
// and the 1099 they are owed this year was never flagged. `sent_1099_years` (migration 094)
// holds every year it was sent; the old flag still means 2025, and only 2025. No year → false:
// a sent mark that cannot say which year it is about cannot answer this question.
export function sent1099For(contact = {}, year = null) {
  const y = Number(year);   // null/undefined → 0 or NaN, which matches no year
  if ((contact.sent_1099_years || []).map(Number).includes(y)) return true;
  return y === 2025 && !!contact.sent_1099_2025;
}

// What goes in the box on the form: services, rent, legal and medical. Never goods, and never
// money we could not classify (that is a question first).
export function reportableAmountOf(payments = {}) {
  const k = payments.byKind || {};
  return (k[PAYMENT_KIND.SERVICES] || 0) + (k[PAYMENT_KIND.RENT] || 0) + (k[PAYMENT_KIND.LEGAL] || 0) + (k[PAYMENT_KIND.MEDICAL] || 0);
}

// One vendor's verdict, with the reason a CPA would need to sign it.
export function verdictFor(contact = {}, payments = { byKind: {}, total: 0 }, { threshold = IRS_1099_THRESHOLD, year = null } = {}) {
  const name = contact.name || "this vendor";
  if (sent1099For(contact, year)) return { verdict: VERDICT.ALREADY_SENT, why: `A 1099 has already been sent to ${name} for ${year}.`, amount: payments.total };
  if (contact.is_1099_exempt) return { verdict: VERDICT.MARKED_EXEMPT, why: `${name} has been marked exempt.`, amount: payments.total };

  const k = payments.byKind || {};
  const reportableAmount = reportableAmountOf(payments);
  const goods = k[PAYMENT_KIND.GOODS] || 0;
  const unknown = k[PAYMENT_KIND.UNKNOWN] || 0;

  // ★ C355 — UNDER THE FLOOR IS UNDER THE FLOOR, WHATEVER WE COULD NOT CLASSIFY. This read
  // `reportableAmount < threshold && unknown <= 0`, so a supplier paid $145 in an account
  // we could not classify fell past BOTH the floor check and the needs-info check (which
  // asks whether reportable + unknown reaches the floor) and landed on ELIGIBLE — a
  // "Needs a 1099" badge over the sentence "was paid $0.00 for services, over the $600
  // floor". A false filing is the failure direction this file exists to refuse. The most
  // that unclassified money could add is itself; if even that stays under the floor, no
  // 1099 is due and no question needs asking.
  if (reportableAmount + unknown < threshold) {
    // Goods are not reportable at ANY amount, so a supplier paid only for goods is a clean
    // "no" rather than a threshold question — and saying which matters, because one changes
    // next year and the other does not.
    if (goods > 0 && reportableAmount === 0) {
      return { verdict: VERDICT.GOODS_ONLY, why: `${name} was paid for goods, which aren't reported on a 1099 at any amount.`, amount: goods };
    }
    const evenCounting = unknown > 0 ? ` (even counting ${money(unknown)} we couldn't classify)` : "";
    return { verdict: VERDICT.BELOW_THRESHOLD, why: `${name} was paid ${money(reportableAmount)} for services this year${evenCounting} — under the $${threshold} reporting floor.`, amount: reportableAmount };
  }

  // ★ AN UNCATEGORISED PAYMENT CANNOT BE RULED IN OR OUT. Saying "below the floor" while
  // holding payments we could not classify would be a claim about a query.
  if (unknown > 0 && reportableAmount + unknown >= threshold) {
    return { verdict: VERDICT.NEEDS_INFO, why: `${money(unknown)} paid to ${name} is in an account we can't classify as goods or services — we can't tell whether it's reportable.`, amount: reportableAmount + unknown };
  }

  const entity = entityStatus(contact);
  const alwaysReportable = (k[PAYMENT_KIND.LEGAL] || 0) > 0 || (k[PAYMENT_KIND.MEDICAL] || 0) > 0;

  if (entity === ENTITY.EXEMPT && !alwaysReportable) {
    return { verdict: VERDICT.CORP_EXEMPT, why: `${name} looks like a corporation, and corporations don't get a 1099 for ordinary services.`, amount: reportableAmount };
  }
  if (entity === ENTITY.UNKNOWN && !alwaysReportable) {
    // ★★★ THE RULE THIS FILE EXISTS FOR. Unknown is not "not a corporation".
    return { verdict: VERDICT.NEEDS_INFO, why: `${name} was paid ${money(reportableAmount)} for services, which is over the floor — but we don't know whether they're incorporated, and corporations don't get one.`, amount: reportableAmount };
  }
  const legalNote = alwaysReportable ? " Legal and medical payments are reported even to a corporation." : "";
  return { verdict: VERDICT.ELIGIBLE, why: `${name} was paid ${money(reportableAmount)} for services this year, over the $${threshold} floor.${legalNote}`, amount: reportableAmount };
}

function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The whole proposal. `vendorRowsFor(contact)` returns that vendor's ledger rows for the year.
export function plan1099({ contacts = [], vendorRowsFor = () => [], roleOfCode = () => null, threshold = IRS_1099_THRESHOLD, year = null } = {}) {
  const rows = [];
  for (const c of contacts || []) {
    if (!c || c.type !== "vendor") continue;
    const payments = reportablePayments(vendorRowsFor(c), roleOfCode);
    rows.push({ contact: c, name: c.name, ...verdictFor(c, payments, { threshold, year }), payments });
  }
  const by = (v) => rows.filter((r) => r.verdict === v);
  return {
    rows,
    eligible: by(VERDICT.ELIGIBLE),
    needsInfo: by(VERDICT.NEEDS_INFO),
    // ★ THE HEADLINE COUNTS BOTH, because a proposal that reports only what it is sure of
    // understates the work — and the unsure ones are the ones a person has to act on.
    outstanding: by(VERDICT.ELIGIBLE).length + by(VERDICT.NEEDS_INFO).length,
  };
}

// C435 — THE PLAN FOR A YEAR, FROM THE LEDGER AND THE CHART. This was assembled inside
// `TaxView` (the vendor-key map, the role lookup); Home and the bell need the same answer to
// decide whether a 1099 filing deadline is waiting at all, and a second assembly would be
// the C316 mismatch waiting to recur. One builder, three readers.
// C589 — `aliasIndex` (the names a person has said are the same vendor) is applied to both the
// rows and the contacts, the way the Vendors page groups: without it a contractor invoiced
// under two names was two vendors here and one everywhere else.
export function plan1099ForYear({ invoices = [], contacts = [], chart = [], year = new Date().getFullYear(), keyOf = null, aliasIndex = null, threshold = IRS_1099_THRESHOLD } = {}) {
  const base = keyOf || ((s) => vendorGroupKey(s) || String(s || "").trim().toLowerCase());
  const idx = aliasIndex || buildAliasIndex(contacts);   // built from the contacts, so every caller gets it
  const alias = (k) => applyAlias(k, idx);
  const key = (s) => alias(base(s));
  const roleOfCode = (code) => (chart || []).find((a) => String(a.code) === String(code))?.system_role || null;
  const yearRows = (invoices || []).filter((i) => String(i?.date || "").startsWith(String(year)));
  const byName = new Map();
  for (const r of yearRows) {
    const k = r.vendor_key ? alias(r.vendor_key) : key(r.vendor);
    if (!k) continue;
    (byName.get(k) || byName.set(k, []).get(k)).push(r);
  }
  return plan1099({ contacts, vendorRowsFor: (c) => byName.get(key(c.name)) || [], roleOfCode, threshold, year });
}

// ★ C549 — THE SENTENCE NAMES THE YEAR, because "this year" is not what it means for three
// months of every one. A 1099 is about the payments of the year BEFORE its deadline, so from
// January to March this card is about the year just ended — and it sits next to a button that
// opens a screen headed with that year. Passing no `year` keeps the old wording for any caller
// that has no year to name.
export function plan1099Copy(plan = {}, { year = null } = {}) {
  const e = (plan.eligible || []).length;
  const n = (plan.needsInfo || []).length;
  const when = year ? `for ${year}` : "this year";
  if (!e && !n) return `No vendors look like they need a 1099 ${when}.`;
  const parts = [];
  if (e) parts.push(`${e} vendor${e === 1 ? "" : "s"} look${e === 1 ? "s" : ""} like ${e === 1 ? "it needs" : "they need"} a 1099`);
  if (n) parts.push(`${n} we can't decide without knowing more`);
  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// C589 — THE 1099 SCREEN'S ROWS, FROM THE SAME DERIVATION AS EVERYTHING ELSE.
// The screen that produces the filing file had its own arithmetic: an UNSIGNED sum (a voided
// and re-entered bill counted three times), keyed on the vendor's SPELLING (two spellings of
// one contractor each stayed under $600 and neither was flagged), a fuzzy "name contains
// name" contact match, and no idea of goods versus services — so it could say "Needs a 1099"
// for a food supplier while the Taxes card, reading `verdictFor`, said nobody did.
// One row per vendor paid in the year (grouped the way the Vendors page groups, aliases
// included), judged by `verdictFor`. A vendor with no contact yet is judged on its name alone.
// ─────────────────────────────────────────────────────────────────────────────
export const TRACKER_STATUS = {
  needs:    { key: "needs",    label: "Needs 1099" },
  sent:     { key: "sent",     label: "Sent ✓" },
  unknown:  { key: "unknown",  label: "Needs your answer" },
  tracking: { key: "tracking", label: "Tracking" },
  none:     { key: "none",     label: "Not required" },
};
const STATUS_FOR_VERDICT = {
  [VERDICT.ELIGIBLE]: "needs", [VERDICT.ALREADY_SENT]: "sent", [VERDICT.NEEDS_INFO]: "unknown",
  [VERDICT.BELOW_THRESHOLD]: "tracking", [VERDICT.GOODS_ONLY]: "none", [VERDICT.CORP_EXEMPT]: "none", [VERDICT.MARKED_EXEMPT]: "none",
};

export function tracker1099Rows({ invoices = [], contacts = [], chart = [], year = new Date().getFullYear(), keyOf = null, aliasIndex = null, threshold = IRS_1099_THRESHOLD } = {}) {
  const base = keyOf || ((s) => vendorGroupKey(s) || String(s || "").trim().toLowerCase());
  const idx = aliasIndex || buildAliasIndex(contacts);   // built from the contacts, so every caller gets it
  const alias = (k) => applyAlias(k, idx);
  const key = (s) => alias(base(s));
  const roleOfCode = (code) => (chart || []).find((a) => String(a.code) === String(code))?.system_role || null;
  const groups = new Map();
  for (const r of invoices || []) {
    if (!r || !String(r.date || "").startsWith(String(year))) continue;
    const k = r.vendor_key ? alias(r.vendor_key) : key(r.vendor);
    if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const contactByKey = new Map();
  for (const c of contacts || []) { if (c && c.name) { const k = key(c.name); if (k && !contactByKey.has(k)) contactByKey.set(k, c); } }
  const out = [];
  for (const [k, rows] of groups) {
    const payments = reportablePayments(rows, roleOfCode);
    if (!(payments.total >= 1)) continue;                       // nothing bought from them this year
    const contact = contactByKey.get(k) || null;
    const latest = rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
    const name = contact?.name || latest?.vendor || "Unknown";
    const v = verdictFor(contact || { name }, payments, { threshold, year });
    // WHICH question an "unknown" row is asking, so the screen can offer the step that answers
    // it: what kind of business they are, or what the money was for (a category on their
    // transactions). Offering the business-type form for the second would be a dead end.
    const ask = v.verdict !== VERDICT.NEEDS_INFO ? null : (payments.byKind[PAYMENT_KIND.UNKNOWN] || 0) > 0 ? "category" : "type";
    out.push({ key: k, name, ledgerName: latest?.vendor || name, ask, contact, paid: Math.round(payments.total * 100) / 100, reportable: Math.round(reportableAmountOf(payments) * 100) / 100,
      verdict: v.verdict, why: v.why, status: TRACKER_STATUS[STATUS_FOR_VERDICT[v.verdict] || "none"] });
  }
  return out.sort((a, b) => b.paid - a.paid);
}
