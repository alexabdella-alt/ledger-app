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
export function entityStatus(contact = {}) {
  const stated = String(contact.business_type || "").trim();
  if (stated) {
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

// Payments to one vendor in one tax year, split by kind. `invoices` are flattened ledger
// rows; `roleOfCode` maps a gl_code to its system_role.
export function reportablePayments(rows = [], roleOfCode = () => null) {
  const byKind = {};
  let total = 0;
  for (const r of rows || []) {
    if (!r || r.status === "voided" || r.status === "deleted" || r.deleted_at) continue;
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

// One vendor's verdict, with the reason a CPA would need to sign it.
export function verdictFor(contact = {}, payments = { byKind: {}, total: 0 }, { threshold = IRS_1099_THRESHOLD } = {}) {
  const name = contact.name || "this supplier";
  if (contact.sent_1099_2025) return { verdict: VERDICT.ALREADY_SENT, why: `A 1099 has already been sent to ${name} for this year.`, amount: payments.total };
  if (contact.is_1099_exempt) return { verdict: VERDICT.MARKED_EXEMPT, why: `${name} has been marked exempt.`, amount: payments.total };

  const k = payments.byKind || {};
  const reportableAmount = (k[PAYMENT_KIND.SERVICES] || 0) + (k[PAYMENT_KIND.RENT] || 0)
    + (k[PAYMENT_KIND.LEGAL] || 0) + (k[PAYMENT_KIND.MEDICAL] || 0);
  const goods = k[PAYMENT_KIND.GOODS] || 0;
  const unknown = k[PAYMENT_KIND.UNKNOWN] || 0;

  if (reportableAmount < threshold && unknown <= 0) {
    // Goods are not reportable at ANY amount, so a supplier paid only for goods is a clean
    // "no" rather than a threshold question — and saying which matters, because one changes
    // next year and the other does not.
    if (goods > 0 && reportableAmount === 0) {
      return { verdict: VERDICT.GOODS_ONLY, why: `${name} was paid for goods, which aren't reported on a 1099 at any amount.`, amount: goods };
    }
    return { verdict: VERDICT.BELOW_THRESHOLD, why: `${name} was paid ${money(reportableAmount)} for services this year — under the $${threshold} reporting floor.`, amount: reportableAmount };
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
export function plan1099({ contacts = [], vendorRowsFor = () => [], roleOfCode = () => null, threshold = IRS_1099_THRESHOLD } = {}) {
  const rows = [];
  for (const c of contacts || []) {
    if (!c || c.type !== "vendor") continue;
    const payments = reportablePayments(vendorRowsFor(c), roleOfCode);
    rows.push({ contact: c, name: c.name, ...verdictFor(c, payments, { threshold }), payments });
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

export function plan1099Copy(plan = {}) {
  const e = (plan.eligible || []).length;
  const n = (plan.needsInfo || []).length;
  if (!e && !n) return "No suppliers look like they need a 1099 this year.";
  const parts = [];
  if (e) parts.push(`${e} supplier${e === 1 ? "" : "s"} look${e === 1 ? "s" : ""} like ${e === 1 ? "it needs" : "they need"} a 1099`);
  if (n) parts.push(`${n} we can't decide without knowing more`);
  return parts.join(" · ");
}
