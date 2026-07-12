// ─────────────────────────────────────────────────────────────────────────────
// Clarification Loop — first slice (no O80/O82 dependency).
//
// When an O49-flagged transaction needs info only the CLIENT has, the system DRAFTS a
// plain-language question to the client; the client's answer maps to the right account and
// resolves the flag through the existing verified review actions (reviewOverride/Approve).
//
// CARDINAL PRINCIPLE (hard rule, asserted by tests): the question is a HUMAN question about
// the business ("what was this for?"), NEVER accounting jargon — no GL codes, no debits/
// credits, no "payable/receivable/journal/ledger". The system translates the human answer
// into accounting silently; the client never sees a GL code.
// ─────────────────────────────────────────────────────────────────────────────

import { glIsRevenue } from "./gl.js";
import { fmtMoney } from "./format.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function friendlyDate(d) {
  const s = String(d || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${mon} ${Number(m[3])}` : "";
}
function moneyPhrase(n) {
  const v = Math.abs(Number(n) || 0);
  if (!v) return "";
  return fmtMoney(v);   // canonical magnitude cents
}
const isRevenueish = (txn) => (txn && (txn.gl_code ? glIsRevenue(txn.gl_code) : txn.type === "revenue" || txn.inflow === true));

// 1) DRAFT THE QUESTION — plain-language, references the specific txn, offers business-language
// options. Returns the question plus a structured `channel` payload so that when O82 lands it
// can route through the bot automatically (same shape, different transport).
export function draftClientQuestion(txn = {}) {
  const amt = moneyPhrase(txn.amount);
  const who = (txn.vendor && String(txn.vendor).trim()) || (txn.description && String(txn.description).trim()) || null;
  const when = friendlyDate(txn.date);
  const onWhen = when ? ` on ${when}` : "";
  const amtPhrase = amt ? `the ${amt} payment` : "this payment";

  let question;
  if (isRevenueish(txn)) {
    const from = who ? ` from ${who}` : "";
    question = `Hey — quick question: ${amtPhrase}${from}${onWhen} — what was that for? (A one-time project, ongoing/retainer work, or something else?)`;
  } else {
    const to = who ? ` to ${who}` : "";
    question = `Hey — what was ${amtPhrase}${to}${onWhen} for? (For example: a one-time purchase, a recurring subscription, a service, or something else.)`;
  }

  return {
    question,
    // ref + channel payload: structured for O82 auto-routing (the bot would send `question`
    // to the client's channel and tag the reply back to this txn). Pre-O82 the CPA sends it.
    ref: { id: txn.id, db_entry_id: txn.db_entry_id ?? null, vendor: txn.vendor ?? null, amount: txn.amount ?? null, date: txn.date ?? null },
    channel: { kind: "clarification", question, txn_ref: { id: txn.id, db_entry_id: txn.db_entry_id ?? null, vendor: txn.vendor ?? null, amount: txn.amount ?? null, date: txn.date ?? null } },
  };
}

// 2) MAP A HUMAN ANSWER → a system_role (deterministic keyword match; reuses the same
// vendor→category signals the categorizer/ReconView use). Returns null when the answer is
// too vague to disambiguate — so a still-ambiguous answer NEVER falsely resolves a flag.
const ANSWER_MAP = [
  [/\binsurance\b|\bliability\b|\bworkers?[' ]?comp\b/, "insurance"],
  [/\brent\b|\blease\b|\boffice space\b|\bcowork|\bwework\b/, "rent_occupancy"],
  [/\bsoftware\b|\bsaas\b|\bsubscription\b|\bapp\b|\btool\b|\bhosting\b|\bcloud\b|\baws\b|\bdomain\b|\blicense\b/, "technology_software"],
  [/\bmarketing\b|\bads?\b|\badvertis|\bpromo|\bcampaign\b|\bseo\b/, "marketing_advertising"],
  [/\btravel\b|\bflight\b|\bhotel\b|\bairfare\b|\bmileage\b|\buber\b|\blyft\b|\brental car\b/, "travel_entertainment"],
  [/\bmeal\b|\bfood\b|\blunch\b|\bdinner\b|\brestaurant\b|\bcoffee\b|\bclient (lunch|dinner|meal)\b/, "travel_entertainment"],
  [/\blegal\b|\baccount(ing|ant)\b|\bconsult|\battorney\b|\blawyer\b|\bbookkeep|\bprofessional (service|fee)/, "professional_services"],
  [/\bcontractor\b|\bfreelanc|\bsubcontract|\b1099\b/, "professional_services"],
  [/\bpayroll\b|\bsalary\b|\bsalaries\b|\bwages\b|\bemployee pay\b/, "salaries_wages"],
  [/\butilit|\belectric|\bwater bill\b|\bgas bill\b|\binternet\b|\bphone bill\b|\bcomcast\b|\bverizon\b/, "utilities"],
  [/\boffice supplies?\b|\bsupplies\b|\bpaper\b|\bstaples\b|\bprinter\b|\bink\b/, "office_supplies"],
  [/\bbank fee\b|\bservice charge\b|\bmerchant fee\b|\bprocessing fee\b/, "miscellaneous_expense"],
  [/\binterest\b/, "interest_expense"],
];
export function answerToCategory(answer) {
  const a = String(answer || "").toLowerCase().trim();
  if (a.length < 3) return null;
  for (const [re, role] of ANSWER_MAP) if (re.test(a)) return role;
  return null;   // too vague → caller must not auto-resolve
}

// 3+4) ANSWER → ACCOUNT: turn the plain-language answer into a real GL account via roles
// (so the human answer becomes correct accounting silently). Returns { gl_code, gl_name,
// role, confidence } or null when unmappable (ambiguous). Vendor rules win when present.
export function answerToAccount(answer, { getAccountByRole, rules = [], vendor = null } = {}) {
  // a known vendor rule is the strongest signal
  if (vendor && Array.isArray(rules)) {
    const v = String(vendor).toLowerCase().trim();
    const rule = rules.find((r) => r.vendor && String(r.vendor).toLowerCase().trim() === v);
    if (rule && rule.gl_code) return { gl_code: rule.gl_code, gl_name: rule.gl_name || rule.gl_code, role: null, confidence: 99, via: "rule" };
  }
  const role = answerToCategory(answer);
  if (!role) return null;
  const acct = typeof getAccountByRole === "function" ? getAccountByRole(role) : null;
  if (!acct || !(acct.code || acct.gl_code)) return { gl_code: null, gl_name: null, role, confidence: 90, via: "category" };
  return { gl_code: acct.code || acct.gl_code, gl_name: acct.name || acct.gl_name || role, role, confidence: 90, via: "category" };
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAIN-LANGUAGE BOOKING VOICE (Cardinal Principle — the owner never sees a GL code
// or an account name). A booked entry is described to the owner in the words a person
// would use ("a client meal", "software", "rent") — NEVER "6420 Meals & Entertainment".
// These power (2) the transparent auto-booking record and (3) the ask-path chips, and are
// linted jargon-free by the Cardinal-Principle guard (5).
// ─────────────────────────────────────────────────────────────────────────────

// role → plain owner phrase. Deliberately avoids accounting words (no "depreciation",
// "amortization", "accrual") so the output always passes the jargon lint below.
const ROLE_PHRASE = {
  salaries_wages: "payroll",
  rent_occupancy: "rent",
  utilities: "a utility bill",
  marketing_advertising: "marketing",
  travel_entertainment: "a meal or travel expense",
  technology_software: "software",
  office_supplies: "office supplies",
  insurance: "insurance",
  professional_services: "professional services",
  depreciation: "equipment",
  interest_expense: "interest",
  miscellaneous_expense: "a general business expense",
  cogs: "cost of goods",
  repairs_maintenance: "repairs and upkeep",
  fixed_assets: "equipment",
  intangible_assets: "an improvement",
};
// A keyword the owner might type that round-trips back through answerToCategory to the
// same role (so a chip built from a role resolves deterministically when clicked).
const ROLE_KEYWORD = {
  salaries_wages: "payroll",
  rent_occupancy: "rent",
  utilities: "utilities",
  marketing_advertising: "marketing",
  travel_entertainment: "a meal",
  technology_software: "software",
  office_supplies: "office supplies",
  insurance: "insurance",
  professional_services: "professional services",
  interest_expense: "interest",
};
// Default-COA code → role (matches DEFAULT_CHART_OF_ACCOUNTS). A rename/renumber falls back
// to keyword-matching the account name, so this is a fast-path, not the only path.
const DEFAULT_CODE_ROLE = {
  "6000": "salaries_wages", "6100": "rent_occupancy", "6200": "utilities",
  "6300": "marketing_advertising", "6400": "travel_entertainment", "6500": "technology_software",
  "6600": "office_supplies", "6700": "insurance", "6800": "professional_services",
  "6900": "depreciation", "7100": "miscellaneous_expense", "8000": "interest_expense",
};

const MEALS_RE = /\b(restaurant|meal|meals|dining|cafe|café|coffee|catering|caterer|lunch|dinner|bar|grill)\b|grubhub|doordash|uber eats|seamless/i;

// Best-effort role for an already-coded entry, without needing the live COA: try the default
// code map, then keyword-match the account name, then the description. Returns null if unknown.
export function inferRole(invoice = {}) {
  const code = String(invoice.gl_code || "").trim();
  if (DEFAULT_CODE_ROLE[code]) return DEFAULT_CODE_ROLE[code];
  return answerToCategory(invoice.gl_name || "") || answerToCategory(invoice.description || "") || null;
}

// The plain-language phrase for how an entry was booked. Never an account name / GL code.
export function plainCategoryPhrase(invoice = {}) {
  if (isRevenueish(invoice)) return "income";
  const text = `${invoice.description || ""} ${invoice.vendor || ""} ${invoice.notes || ""} ${invoice.gl_name || ""}`;
  if (invoice.meals_pct != null || MEALS_RE.test(text)) return "a client meal";
  const role = inferRole(invoice);
  if (role && ROLE_PHRASE[role]) return ROLE_PHRASE[role];
  return "a general business expense";
}

// (2) The transparent auto-booking record: a non-interrupting, plain-language sentence the
// owner CAN see but never has to act on. "Booked Bella Vita Catering ($477.38) as a client meal."
export function describeBooking(invoice = {}) {
  const who = (invoice.vendor && String(invoice.vendor).trim()) || (invoice.description && String(invoice.description).trim()) || "this";
  const amt = moneyPhrase(invoice.amount);
  const amtPart = amt ? ` (${amt})` : "";
  return `Booked ${who}${amtPart} as ${plainCategoryPhrase(invoice)}.`;
}

// (3) Optional plain-language quick-chips — offered ONLY when the AI already has a strong,
// human-phrased guess (a known role and enough confidence). Never account names. Each chip's
// `answer` round-trips through answerToCategory so clicking it resolves deterministically.
export function clarificationChips(invoice = {}, { minConfidence = 55 } = {}) {
  if (isRevenueish(invoice)) return [];
  const conf = invoice.confidence == null ? 0 : Number(invoice.confidence);
  if (conf < minConfidence) return [];                     // not a strong-enough guess → no chip
  const role = inferRole(invoice);
  const keyword = role && ROLE_KEYWORD[role];
  const phrase = plainCategoryPhrase(invoice);
  if (!keyword && phrase === "a general business expense") return [];   // nothing specific to suggest
  const answer = keyword || phrase;
  return [{ label: `It was ${phrase}`, answer }];
}

// ── Cardinal-Principle jargon lint (shared by the guard tests) ──
// Accounting machinery the owner must never see: GAAP/ASC terms, debit/credit, journal/ledger,
// payable/receivable, capitalize/depreciate/amortize/accrue, "chart of accounts", and any bare
// 4-digit GL code (1000–8999).
export const OWNER_JARGON_RE = /\bGAAP\b|\bASC\b|\bdebit(ed|s)?\b|\bcredit(ed|s)?\b|journal entr|\bledger\b|\bpayable\b|\breceivable\b|deferred revenue|balance sheet|capitaliz|depreciat|amortiz|\baccru|chart of accounts|\bgeneral ledger\b|\bGL code\b|\bcontrol total|\breconcil|\btrial balance\b|\bconfidence\b/i;
// A bare 4-digit GL account code (1000–8999) — EXCEPT a plausible calendar year (1900–2199),
// which legitimately appears in owner copy ("Reviewed through May 2026") and is not a GL code.
export const OWNER_GLCODE_RE = /\b(?!(?:19|20|21)\d{2}\b)[1-8][0-9]{3}\b/;
export function containsOwnerJargon(text) {
  const s = String(text || "");
  return OWNER_JARGON_RE.test(s) || OWNER_GLCODE_RE.test(s);
}
