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
import { DEFAULT_CHART_OF_ACCOUNTS } from "./constants";

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
  // Reachable since the code map above was widened. Plain words only — no "processing
  // fees payable", no "direct labor cost of sales".
  direct_labor: "wages on jobs",
  shipping_fulfillment: "shipping",
  payroll_tax: "payroll taxes",
  employee_benefits: "employee benefits",
  merchant_processing_fees: "card processing fees",
  bank_service_charges: "bank fees",
  uncategorized_expense: "something we haven't sorted yet",
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
  // 5xxx — direct costs. THESE WERE MISSING, and their absence is half of O115: an entry
  // booked to 5000 had no code→role answer, so the phrase fell through to keyword-matching
  // the vendor name, and "Lone Star Restaurant Supply" matched /restaurant/.
  "5000": "cogs", "5100": "direct_labor", "5200": "shipping_fulfillment",
  "6000": "salaries_wages", "6010": "payroll_tax", "6020": "employee_benefits",
  "6100": "rent_occupancy", "6200": "utilities", "6250": "repairs_maintenance",
  "6300": "marketing_advertising", "6400": "travel_entertainment", "6500": "technology_software",
  "6520": "merchant_processing_fees", "6530": "bank_service_charges",
  "6600": "office_supplies", "6700": "insurance", "6800": "professional_services",
  "6900": "depreciation", "7100": "miscellaneous_expense",
  "7150": "uncategorized_expense", "8000": "interest_expense",
};

// ★ THE ONLY PLACE TEXT IS ALLOWED TO NARROW A BOOKED ACCOUNT (O115). One entry, and it
// earns it: "Travel & Entertainment" is two different everyday things and the owner-facing
// sentence should say which. Adding a role here is a deliberate act — it re-opens exactly
// the door that let a vendor's NAME overrule the account its money is sitting in.
const ROLE_REFINEMENTS = {
  travel_entertainment: [
    { test: (inv, text) => inv.meals_pct != null || MEALS_RE.test(text), phrase: "a client meal" },
  ],
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
//
// ★★ O115 — IT DESCRIBES THE ACCOUNT THE ENTRY IS ON, NOT WHAT THE TEXT LOOKS LIKE.
// This function used to keyword-match the vendor and description BEFORE consulting the
// booked account, so it produced a description assembled in parallel with the booking
// rather than derived from it — and the two diverged in production: Lone Star was
// announced to the owner "as a client meal" while the ledger correctly said 5000 Cost of
// Goods Sold. `MEALS_RE` matched "Lone Star **Restaurant** Supply", a restaurant SUPPLIER.
//
// ★ THE BOOKS WERE RIGHT AND THE OWNER WAS MISINFORMED, which is the worst combination
// available: nothing is broken, so nothing gets fixed (CLAUDE.md §9).
//
// So the order is now: the account decides when there IS one; the text is consulted only
// for an entry that has not been coded yet — which is the ask path, where guessing is the
// entire job and there is no answer sitting three feet away to read instead.
export function plainCategoryPhrase(invoice = {}) {
  if (isRevenueish(invoice)) return "income";

  // (a) THE BOOKED ACCOUNT, if the entry has one. `roleFromAccount` reads the code map
  // first, then keyword-matches the ACCOUNT NAME — both are properties of where the money
  // actually went, so a renumbered or renamed chart still resolves.
  const coded = String(invoice.gl_code || "").trim() || String(invoice.gl_name || "").trim();
  if (coded) {
    const role = roleFromAccount(invoice);
    // ★ THE ACCOUNT FIXES THE CATEGORY; TEXT MAY ONLY REFINE **WITHIN** IT.
    // That is the whole distinction O115 turns on, and it is narrower than "never read the
    // text". `6400 Travel & Entertainment` genuinely spans two everyday things, so calling
    // a caterer on that account "a client meal" REFINES the account — it does not
    // contradict it. Calling a 5000 Cost-of-Goods entry "a client meal" contradicts it,
    // and that is what shipped. Refinements are therefore declared PER ROLE and nowhere
    // else: a role with no entry in the table cannot be talked out of its own phrase.
    const refine = ROLE_REFINEMENTS[role];
    if (refine) {
      const text = `${invoice.description || ""} ${invoice.vendor || ""} ${invoice.notes || ""}`;
      for (const r of refine) if (r.test(invoice, text)) return r.phrase;
    }
    if (role && ROLE_PHRASE[role]) return ROLE_PHRASE[role];
    // Coded to something we have no phrase for. Still refuse to fall back to the vendor
    // text: an unrecognised account is not evidence for a client meal.
    return "a general business expense";
  }

  // (b) NOT YET CODED — the ask path. Now the text is all there is, and `meals_pct` is a
  // real booking-time signal rather than a guess about a name.
  const text = `${invoice.description || ""} ${invoice.vendor || ""} ${invoice.notes || ""}`;
  if (invoice.meals_pct != null || MEALS_RE.test(text)) return "a client meal";
  const role = inferRole(invoice);
  if (role && ROLE_PHRASE[role]) return ROLE_PHRASE[role];
  return "a general business expense";
}

// Role from the ACCOUNT ONLY — the code map, then the account name. Never the vendor or
// description. Split out from `inferRole` (which deliberately also reads the description,
// for the uncoded ask path) so the two questions cannot be confused again: "what is this
// probably?" and "what was this actually booked as?" are different questions.
export function roleFromAccount(invoice = {}) {
  const code = String(invoice.gl_code || "").trim();
  if (DEFAULT_CODE_ROLE[code]) return DEFAULT_CODE_ROLE[code];
  const name = String(invoice.gl_name || "").toLowerCase().trim();
  if (!name) return null;
  // ★ ACCOUNT NAMES ARE THEIR OWN VOCABULARY, NOT THE ASK PATH'S. `ANSWER_MAP` maps what a
  // HUMAN TYPES ("it was a flight") and knows nothing of "Cost of Goods Sold" or "Merchant
  // Processing Fees" — so a renumbered COGS account resolved to nothing and the phrase fell
  // back to a generic. Reusing that map here would also mean editing the ask path's booking
  // behaviour to fix a sentence, which is the wrong blast radius entirely.
  //
  // ★★ AND THE MAP IS BUILT FROM `DEFAULT_CHART_OF_ACCOUNTS`, NOT RETYPED. This repo
  // already carries three implementations of vendor identity (O125) because each new
  // caller wrote its own; a fourth hand-copy of the chart is the same mistake in a
  // different column. If an account is renamed in constants.js, this follows.
  if (ACCOUNT_NAME_ROLE.has(name)) return ACCOUNT_NAME_ROLE.get(name);
  return answerToCategory(invoice.gl_name || "") || null;
}

// name (lowercased) → system_role, straight off the default chart.
const ACCOUNT_NAME_ROLE = new Map(
  (DEFAULT_CHART_OF_ACCOUNTS || [])
    .filter((a) => a && a.name && a.system_role)
    .map((a) => [String(a.name).toLowerCase().trim(), a.system_role]),
);

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
