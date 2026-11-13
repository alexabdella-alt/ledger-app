import { vendorGroupKey } from "./vendorIdentity.js";
import { lineForAccount } from "./taxGuidance.js";
import { applyAlias, buildAliasIndex } from "./vendorAlias.js";
import { isSettlementEntry, isLiveSettlement, entryBaseOf } from "./gl.js";
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
// ★ C679 — THE FLOOR FOLLOWS THE PAYMENT YEAR. The 2025 tax law (P.L. 119-21 §70433) raised the
// 1099-NEC / 1099-MISC reporting threshold from $600 to $2,000 for payments made after
// 2025 (inflation-adjusted after 2026). A 2025 payment is still judged at $600.
export function thresholdFor(year) {
  const y = Number(year);
  return Number.isFinite(y) && y >= 2026 ? 2000 : IRS_1099_THRESHOLD;
}

// What KIND of payment this was, decided by the account it landed in — never by the
// supplier's name (§9: the account fixes the category).
export const PAYMENT_KIND = {
  SERVICES: "services",   // 1099-NEC box 1
  RENT: "rent",           // 1099-MISC box 1
  LEGAL: "legal",         // 1099-NEC/MISC — reportable EVEN TO A CORPORATION
  MEDICAL: "medical",     // 1099-MISC box 6 — also reportable to a corporation
  GOODS: "goods",         // not reportable at all
  NOT_REPORTABLE: "not_reportable",
  CARD: "card",           // C679 — paid by card / payment network: reported on the 1099-K, not by the payer   // C679 — utilities, insurance, travel, fees, taxes, wages, interest: never on a 1099-NEC/MISC
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
  // ★ C679 — every other role the app creates, by current IRS practice, so nothing is left to
  // "classify": services (NEC box 1), rent (MISC box 1), or not reportable at all.
  subcontractor_costs: PAYMENT_KIND.SERVICES, customer_support: PAYMENT_KIND.SERVICES, sales_commissions: PAYMENT_KIND.SERVICES,
  property_management: PAYMENT_KIND.SERVICES, education_training: PAYMENT_KIND.SERVICES, direct_labor: PAYMENT_KIND.SERVICES,
  equipment_rental: PAYMENT_KIND.RENT, operating_lease_expense: PAYMENT_KIND.RENT, rou_amortization: PAYMENT_KIND.RENT,
  merchandise_cost: PAYMENT_KIND.GOODS, job_materials: PAYMENT_KIND.GOODS, shipping_fulfillment: PAYMENT_KIND.GOODS,
  medical_supplies: PAYMENT_KIND.GOODS, hosting_infrastructure: PAYMENT_KIND.GOODS, technology_software: PAYMENT_KIND.GOODS,
  vehicle_expenses: PAYMENT_KIND.GOODS, inventory_shrinkage: PAYMENT_KIND.GOODS,
  // Not reported on a 1099-NEC/MISC by rule: utilities and phone, insurance premiums, travel and
  // meals, card/bank/processing fees (financial institutions), taxes and licences (government),
  // wages and payroll (W-2), benefits, interest (a separate form), dues.
  utilities: PAYMENT_KIND.NOT_REPORTABLE, insurance: PAYMENT_KIND.NOT_REPORTABLE, malpractice_insurance: PAYMENT_KIND.NOT_REPORTABLE,
  travel_entertainment: PAYMENT_KIND.NOT_REPORTABLE, merchant_processing_fees: PAYMENT_KIND.NOT_REPORTABLE, bank_service_charges: PAYMENT_KIND.NOT_REPORTABLE,
  taxes_licenses: PAYMENT_KIND.NOT_REPORTABLE, property_taxes: PAYMENT_KIND.NOT_REPORTABLE, payroll_tax: PAYMENT_KIND.NOT_REPORTABLE,
  salaries_wages: PAYMENT_KIND.NOT_REPORTABLE, employee_benefits: PAYMENT_KIND.NOT_REPORTABLE, interest_expense: PAYMENT_KIND.NOT_REPORTABLE,
  dues_memberships: PAYMENT_KIND.NOT_REPORTABLE, hoa_dues: PAYMENT_KIND.NOT_REPORTABLE, income_tax_expense: PAYMENT_KIND.NOT_REPORTABLE,
  depreciation_amortization: PAYMENT_KIND.NOT_REPORTABLE, bad_debt: PAYMENT_KIND.NOT_REPORTABLE, client_reimbursables: PAYMENT_KIND.NOT_REPORTABLE,
};

// C679 — a category the owner made (no role): read its NAME by the same Schedule C mapping the
// Taxes screen uses, so an owner-made category is never "can't classify" either.
const LINE_KIND = {
  "11": PAYMENT_KIND.SERVICES, "8": PAYMENT_KIND.SERVICES, "10": PAYMENT_KIND.SERVICES, "21": PAYMENT_KIND.SERVICES,
  "17": PAYMENT_KIND.LEGAL, "20a": PAYMENT_KIND.RENT, "20b": PAYMENT_KIND.RENT,
  "4": PAYMENT_KIND.GOODS, "18": PAYMENT_KIND.GOODS, "22": PAYMENT_KIND.GOODS, "9": PAYMENT_KIND.GOODS,
  "13": PAYMENT_KIND.NOT_REPORTABLE, "14": PAYMENT_KIND.NOT_REPORTABLE, "15": PAYMENT_KIND.NOT_REPORTABLE, "16b": PAYMENT_KIND.NOT_REPORTABLE,
  "19": PAYMENT_KIND.NOT_REPORTABLE, "23": PAYMENT_KIND.NOT_REPORTABLE, "24a": PAYMENT_KIND.NOT_REPORTABLE, "24b": PAYMENT_KIND.NOT_REPORTABLE,
  "25": PAYMENT_KIND.NOT_REPORTABLE, "26": PAYMENT_KIND.NOT_REPORTABLE, none: PAYMENT_KIND.NOT_REPORTABLE,
  travel_split: PAYMENT_KIND.NOT_REPORTABLE,
  owner_health: PAYMENT_KIND.NOT_REPORTABLE, owner_retirement: PAYMENT_KIND.NOT_REPORTABLE, personal: PAYMENT_KIND.NOT_REPORTABLE,   // C703 — insurers and plan custodians   // C694 — "Meals & Entertainment": meals, shows and trips are not 1099 payments
};
const SERVICE_WORDS = /\b(service|services|cleaning|janitorial|laundry|consult\w*|design\w*|edit(ing|or|ors)?|freelanc\w*|contractor|labor|labour|coaching|photograph\w*|videograph\w*|management|install\w*|maintenance|landscap\w*|tutor\w*|writing|writer)\b/i;
export function paymentKindForAccount({ role = null, name = "", code = "" } = {}) {
  if (role && ROLE_KIND[String(role)]) return ROLE_KIND[String(role)];
  const { line, by } = lineForAccount({ code, name, role: null });
  if (by === "name" && LINE_KIND[line]) return LINE_KIND[line];
  if (SERVICE_WORDS.test(String(name || ""))) return PAYMENT_KIND.SERVICES;
  if (by === "number" && line === "4") return PAYMENT_KIND.GOODS;
  return PAYMENT_KIND.UNKNOWN;   // a category with no name to read — the one case still worth asking
}

// ★ C679 — PAID BY CARD OR THROUGH A PAYMENT NETWORK: NOT YOUR 1099. Payments made with a credit
// or debit card, or through a third-party network (PayPal, Venmo for business, Stripe…), are
// reported by the card company or network on Form 1099-K — the payer files no 1099-NEC/MISC
// for them. Read from the record: the bill was booked straight to a card account, or its
// payment was recorded as a card / network payment.
const CARD_METHODS = new Set(["card", "credit_card", "debit_card", "paypal", "venmo", "cash_app", "stripe"]);
export function paidByCardOrNetwork(row = {}, { cardCodes = new Set() } = {}) {
  if (row._paidByCard) return true;   // C688 — its payment came from a card (paidRowsForYear)
  if (cardCodes.has(String(row.secondary_gl_code ?? ""))) return true;
  return CARD_METHODS.has(String(row.payment_method_used || "").toLowerCase());
}

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
export function reportablePayments(rows = [], roleOfCode = () => null, { accountOf = null, cardCodes = new Set() } = {}) {
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
    // C688 — a payroll run is wages (Form W-2), never a 1099, whatever account it was coded to
    if (r.source === "payroll" || (r.import_metadata && r.import_metadata.kind === "payroll")) continue;
    if (code[0] === "1" && MONEY_ROLES.has(roleOfCode(r.gl_code))) continue;
    const amt = Number(r.amount) || 0;
    if (amt <= 0) continue;
    // A credit to an expense account is a correction: it REDUCES what they were paid.
    const signed = r.debit_credit === "credit" ? -amt : amt;
    // C679 — the account decides by role, then by name; a card / network payment is the 1099-K's.
    const a = accountOf ? accountOf(r.gl_code) : null;
    const kind = paidByCardOrNetwork(r, { cardCodes }) ? PAYMENT_KIND.CARD
      : paymentKindForAccount({ role: roleOfCode(r.gl_code), name: (a && a.name) || r.gl_name || "", code: r.gl_code });
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
  const goods = (k[PAYMENT_KIND.GOODS] || 0) + (k[PAYMENT_KIND.NOT_REPORTABLE] || 0);   // C679 — neither is ever on a 1099
  const card = k[PAYMENT_KIND.CARD] || 0;
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
    if (card > 0 && reportableAmount === 0 && goods === 0) {   // C679
      return { verdict: VERDICT.GOODS_ONLY, why: `${name} was paid by card or a payment app — the card company or app reports those (Form 1099-K), so no 1099 from you.`, amount: card };
    }
    if (goods > 0 && reportableAmount === 0) {
      return { verdict: VERDICT.GOODS_ONLY, why: (k[PAYMENT_KIND.NOT_REPORTABLE] || 0) > 0 && !(k[PAYMENT_KIND.GOODS] > 0)
        ? `${name} was paid for things that don't go on a 1099 (utilities, insurance, travel, fees, taxes or wages).`
        : `${name} was paid for goods, which aren't reported on a 1099 at any amount.`, amount: goods };
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
// C679 — what the chart tells the 1099 logic: each code's account (for its name), and which
// codes are credit-card accounts (a bill booked straight to one was paid by card).
// ★ C688 — a card account by its role, its name ("Amex Business", "Chase Visa"), or a bank
// account the owner set up as a card (Settings) — not only one literally named "credit card".
const CARD_NAME = /^(?!.*\bgift\b).*\b(credit card|card|amex|american express|visa|mastercard|discover)\b/i;
function chartLookups(chart = [], bankAccounts = []) {
  const byCode = new Map((chart || []).map((a) => [String(a.code), a]));
  const cardCodes = new Set((chart || []).filter((a) => a.system_role === "credit_card_liability"
    || (/^2\d{3}$/.test(String(a.code)) && CARD_NAME.test(a.name || "")) || /\bcredit card\b/i.test(a.name || "")).map((a) => String(a.code)));
  for (const b of bankAccounts || []) if (b && b.type === "credit_card" && b.gl_code) cardCodes.add(String(b.gl_code));
  const apCodes = new Set((chart || []).filter((a) => a.system_role === "accounts_payable" || /^accounts payable$/i.test(a.name || "")).map((a) => String(a.code)));
  return { accountOf: (code) => byCode.get(String(code)) || null, cardCodes, apCodes };
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ C688 — A 1099 IS ABOUT PAYMENTS MADE IN THE YEAR, NOT BILLS DATED IN IT. Form 1099-NEC/MISC
// reports what was PAID to the vendor during the calendar year (and the $2,000 floor applies to
// payments made after 2025 — P.L. 119-21 §70433). A purchase paid on the spot (cash, bank, card)
// was paid on its date. A bill on terms (booked to Accounts Payable) was paid when its payment
// was recorded — the live settlement that links it — and an unpaid bill was not paid at all, so
// it counts in no year yet. A bill marked paid with no linked payment entry uses its paid date
// if it has one, else its own date. The payment's source decides "card": a bill paid from a card
// is the card network's 1099-K, whatever the method field says.
// ═════════════════════════════════════════════════════════════════════════════
export function paidRowsForYear(invoices = [], year, { apCodes = new Set(), cardCodes = new Set() } = {}) {
  const y = String(year);
  const pays = new Map();
  for (const i of invoices || []) {
    if (!isLiveSettlement(i)) continue;
    const k = String(i.import_metadata.payment_for);
    const src = [i.gl_code, i.secondary_gl_code].map((c) => String(c ?? "")).find((c) => c && !apCodes.has(c)) || "";
    (pays.get(k) || pays.set(k, []).get(k)).push({ date: String(i.date || i.entry_date || ""), card: cardCodes.has(src) || CARD_METHODS.has(String(i.payment_method_used || "").toLowerCase()) });
  }
  const out = [];
  for (const r of invoices || []) {
    if (!r) continue;
    if (!apCodes.has(String(r.secondary_gl_code ?? "")) || isSettlementEntry(r)) {
      if (String(r.date || "").startsWith(y)) out.push(r);
      continue;
    }
    const p = pays.get(entryBaseOf(r));
    if (p && p.length) {
      const last = p.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
      if (last.date.startsWith(y)) out.push(p.every((x) => x.card) ? { ...r, _paidByCard: true } : r);
    } else if (r.payment_status === "paid") {
      if (String(r.paid_at || r.date || "").slice(0, 10).startsWith(y)) out.push(r);
    }
    // unpaid bill on terms: not paid in any year yet
  }
  return out;
}

export function plan1099({ contacts = [], vendorRowsFor = () => [], roleOfCode = () => null, threshold = null, year = null, accountOf = null, cardCodes = new Set() } = {}) {
  if (threshold == null) threshold = thresholdFor(year);   // C679
  const rows = [];
  for (const c of contacts || []) {
    if (!c || c.type !== "vendor") continue;
    const payments = reportablePayments(vendorRowsFor(c), roleOfCode, { accountOf, cardCodes });
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
export function plan1099ForYear({ invoices = [], contacts = [], chart = [], year = new Date().getFullYear(), keyOf = null, aliasIndex = null, threshold = null, bankAccounts = [] } = {}) {
  const look = chartLookups(chart, bankAccounts);   // C688
  const base = keyOf || ((s) => vendorGroupKey(s) || String(s || "").trim().toLowerCase());
  const idx = aliasIndex || buildAliasIndex(contacts);   // built from the contacts, so every caller gets it
  const alias = (k) => applyAlias(k, idx);
  const key = (s) => alias(base(s));
  const roleOfCode = (code) => (chart || []).find((a) => String(a.code) === String(code))?.system_role || null;
  const yearRows = paidRowsForYear(invoices, year, look);   // C688 — by the year it was PAID
  const byName = new Map();
  for (const r of yearRows) {
    const k = r.vendor_key ? alias(r.vendor_key) : key(r.vendor);
    if (!k) continue;
    (byName.get(k) || byName.set(k, []).get(k)).push(r);
  }
  return plan1099({ contacts, vendorRowsFor: (c) => byName.get(key(c.name)) || [], roleOfCode, threshold, year, accountOf: look.accountOf, cardCodes: look.cardCodes });
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

export function tracker1099Rows({ invoices = [], contacts = [], chart = [], year = new Date().getFullYear(), keyOf = null, aliasIndex = null, threshold = null, bankAccounts = [] } = {}) {
  if (threshold == null) threshold = thresholdFor(year);   // C679
  const { accountOf, cardCodes, apCodes } = chartLookups(chart, bankAccounts);   // C688
  const base = keyOf || ((s) => vendorGroupKey(s) || String(s || "").trim().toLowerCase());
  const idx = aliasIndex || buildAliasIndex(contacts);   // built from the contacts, so every caller gets it
  const alias = (k) => applyAlias(k, idx);
  const key = (s) => alias(base(s));
  const roleOfCode = (code) => (chart || []).find((a) => String(a.code) === String(code))?.system_role || null;
  const groups = new Map();
  for (const r of paidRowsForYear(invoices, year, { apCodes, cardCodes })) {   // C688 — by the year it was PAID
    const k = r.vendor_key ? alias(r.vendor_key) : key(r.vendor);
    if (!k) continue;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const contactByKey = new Map();
  for (const c of contacts || []) { if (c && c.name) { const k = key(c.name); if (k && !contactByKey.has(k)) contactByKey.set(k, c); } }
  const out = [];
  for (const [k, rows] of groups) {
    const payments = reportablePayments(rows, roleOfCode, { accountOf, cardCodes });
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
