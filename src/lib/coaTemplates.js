// ─────────────────────────────────────────────────────────────────────────────
// TIER 1 #6 — A CHART OF ACCOUNTS THAT MATCHES THE BUSINESS.
//
// Every company is seeded with the same generic chart, so Franklin Ave Pizza got
// Subscription Revenue and ASC 842 lease accounting, and had nowhere to put food cost.
// That is not a cosmetic problem: **the categoriser is constrained to the chart it is
// given**, so a missing account becomes a miscategorised transaction. The live specimens
// are on record — a Toast merchant fee booked to `6500 Technology & Software` because no
// merchant-fee account existed, and `Alamo Ice & Beverage` (CO2 and bagged ice) landing in
// `7100 Miscellaneous`, which is TIER 1 #7's own hard-fail test.
//
// ★★ THE SEED FUNCTION IS NOT TOUCHED, AND THAT IS DELIBERATE. §6 records that the repo
// holds FIVE definitions of `seed_company_accounts` and the highest-numbered was never
// applied and could not be — so any `create or replace` must start from
// `pg_get_functiondef` against live, not from a file. This runs as an OVERLAY on the
// client instead: the generic seed still happens, and the business type ADDS to it.
// No migration, no RPC change, nothing to get wrong about a function nobody can read.
//
// ★ AND THE SEQUENCING MADE THAT THE NATURAL SHAPE ANYWAY. The roadmap item says
// "CompanySetup asks for business type" — **it does not.** Setup asks only for a name; the
// type is collected later, in the onboarding profile step. So the chart is necessarily
// seeded BEFORE the type is known, and an overlay applied when we learn it is not a
// workaround — it is the only correct place for it.
//
// ▶ ADDITIVE BY DEFAULT. Templates ADD accounts. The few they HIDE are deactivated, never
// deleted, and only when the account carries no transactions — a chart is a client's
// record, not our opinion about their business.
// ─────────────────────────────────────────────────────────────────────────────

// Codes are chosen to sit beside the generic account they refine, so a chart stays
// readable when sorted: food cost next to 5000 COGS, linen next to 6250 Repairs.
// ── O112 — ACCOUNTS EVERY BUSINESS NEEDS, THAT OLDER COMPANIES PREDATE ───────
//
// The question `O112` posed was: we now recognise Toast, Square and Stripe by name, but ten
// of eleven companies have no account for card processing fees — **create it, ask, or leave
// it parked?**
//
// ★★ IT TURNS OUT NOT TO BE A DESIGN QUESTION. `6520` and `6530` are ALREADY in the default
// chart — `068` blessed them after a CPA created them by hand on a real client. So every
// company created since gets them, and the ten that don't are simply older than that
// decision. The question is a BACKFILL, and it has an answer the rest of this file already
// established.
//
// ★★★ AND THE ANSWER TURNS ON *WHEN*, NOT *WHETHER*. Materialising an account MID-BOOKING
// is the O108/O109 hazard — the system inventing a line on a client's chart while nobody is
// looking. Adding one as a deliberate, audited SETUP step is what this whole file does
// safely: additive, never renaming, never touching an account that carries transactions.
// **Same account, same code — the difference is entirely that a person is present.**
//
// So: not created at booking time, not left parked forever. Added to the chart, once,
// through the door that already exists for exactly this.
const UNIVERSAL = [
  // Any business can take a card payment or pay a bank charge; neither is industry-specific,
  // which is why they belong here and not in one industry's list.
  { code: "6520", name: "Merchant Processing Fees", category: "Expenses", system_role: "merchant_processing_fees" },
  { code: "6530", name: "Bank Service Charges", category: "Expenses", system_role: "bank_service_charges" },
  // ★★ ADDED 2026-08-30 ON EVIDENCE, NOT ON A HUNCH. The live role audit (`O35`) found
  // `opening_balance_equity` missing on SEVEN of eleven companies — it is absent from the
  // seed function, and `O108` finding 3 recorded that the app creates it on demand at the
  // first opening-balance post. **That works by accident**: it reaches the chart through
  // `ensureAccount`, which is the materialise-mid-flight path this file exists to avoid.
  // Every company that posts an opening balance needs it, so it belongs in the chart before
  // anyone needs it rather than appearing under them while they use it.
  { code: "3400", name: "Opening Balance Equity", category: "Equity", system_role: "opening_balance_equity" },
];

const TEMPLATES = {
  "Restaurant/Food": {
    add: [
      { code: "5010", name: "Food Cost", category: "Expenses", system_role: "food_cost" },
      { code: "5020", name: "Beverage Cost", category: "Expenses", system_role: "beverage_cost" },
      { code: "5030", name: "Paper & Packaging", category: "Expenses", system_role: "paper_packaging" },
      { code: "6260", name: "Linen & Laundry", category: "Expenses", system_role: "linen_laundry" },
      { code: "6270", name: "Waste Removal", category: "Expenses", system_role: "waste_removal" },
      { code: "6280", name: "Kitchen Supplies & Smallwares", category: "Expenses", system_role: "kitchen_supplies" },
      { code: "6910", name: "Licenses & Permits", category: "Expenses", system_role: "licenses_permits" },
    ],
    // A restaurant does not sell subscriptions. Hidden only if unused.
    hide: ["4200"],
  },
  Retail: {
    add: [
      { code: "5010", name: "Merchandise Cost", category: "Expenses", system_role: "merchandise_cost" },
      { code: "5030", name: "Packaging & Shipping Supplies", category: "Expenses", system_role: "paper_packaging" },
      { code: "1450", name: "Inventory Shrinkage", category: "Expenses", system_role: "inventory_shrinkage" },
      { code: "6910", name: "Licenses & Permits", category: "Expenses", system_role: "licenses_permits" },
    ],
    hide: ["4200"],
  },
  "SaaS/Software": {
    add: [
      { code: "5050", name: "Hosting & Infrastructure", category: "Expenses", system_role: "hosting_infrastructure" },
      { code: "6310", name: "Sales Commissions", category: "Expenses", system_role: "sales_commissions" },
      { code: "6320", name: "Customer Success & Support", category: "Expenses", system_role: "customer_support" },
    ],
    hide: [],
  },
  "Consulting/Services": {
    add: [
      { code: "5110", name: "Subcontractor Costs", category: "Expenses", system_role: "subcontractor_costs" },
      { code: "6410", name: "Client Reimbursable Expenses", category: "Expenses", system_role: "client_reimbursables" },
    ],
    hide: ["4000"],   // a services firm bills services, not product
  },
  Construction: {
    add: [
      { code: "5110", name: "Subcontractor Costs", category: "Expenses", system_role: "subcontractor_costs" },
      { code: "5120", name: "Materials & Supplies", category: "Expenses", system_role: "job_materials" },
      { code: "5130", name: "Equipment Rental", category: "Expenses", system_role: "equipment_rental" },
      { code: "6910", name: "Licenses & Permits", category: "Expenses", system_role: "licenses_permits" },
      { code: "2150", name: "Retainage Payable", category: "Liabilities", system_role: "retainage_payable" },
    ],
    hide: ["4200"],
  },
  Healthcare: {
    add: [
      { code: "5060", name: "Medical Supplies", category: "Expenses", system_role: "medical_supplies" },
      { code: "6710", name: "Malpractice Insurance", category: "Expenses", system_role: "malpractice_insurance" },
      { code: "6910", name: "Licenses & Permits", category: "Expenses", system_role: "licenses_permits" },
      { code: "1150", name: "Insurance Receivable", category: "Assets", system_role: "insurance_receivable" },
    ],
    hide: ["4200"],
  },
  "Real Estate": {
    add: [
      { code: "4150", name: "Rental Income", category: "Revenue", system_role: "rental_income" },
      { code: "6290", name: "Property Management Fees", category: "Expenses", system_role: "property_management" },
      { code: "6295", name: "HOA & Association Dues", category: "Expenses", system_role: "hoa_dues" },
      { code: "6740", name: "Property Taxes", category: "Expenses", system_role: "property_taxes" },
    ],
    hide: [],
  },
  // "Other" deliberately has no template. A business we cannot name is a business whose
  // chart we should not be opinionated about — the generic seed is the honest answer.
  Other: { add: [], hide: [] },
};

export const BUSINESS_TYPES = Object.keys(TEMPLATES);
export const templateFor = (businessType) => TEMPLATES[businessType] || null;

// ── THE PLAN ─────────────────────────────────────────────────────────────────
// Pure. `existing` is the company's live accounts; `usedCodes` are the codes that already
// carry transactions (the caller derives this from the ledger — this module must not guess
// at it, because deactivating an account with history is a real harm).
//
// Returns what to ADD and what to HIDE, and nothing else — never a delete, never an edit
// of an account the user may have renamed.
export function planCoaTemplate(businessType, existing = [], usedCodes = []) {
  const tpl = templateFor(businessType);
  if (!tpl) return { add: [], hide: [], template: null, skipped: { present: [], inUse: [] } };
  // ★ UNIVERSAL FIRST, INDUSTRY SECOND, and a code appearing in both is added once. The
  // industry list wins on name if it ever collides, because it is the more specific claim.
  const wanted = [...UNIVERSAL.filter(u => !tpl.add.some(a => a.code === u.code)), ...tpl.add];

  const have = new Set((existing || []).map((a) => String(a.code)));
  const used = new Set((usedCodes || []).map(String));
  const activeByCode = new Map((existing || []).map((a) => [String(a.code), a]));

  const present = [];
  const add = [];
  for (const acct of wanted) {
    // Never re-add a code the company already has — it may have been renamed, and the
    // rename is theirs.
    if (have.has(acct.code)) { present.push(acct.code); continue; }
    add.push(acct);
  }

  const inUse = [];
  const hide = [];
  for (const code of tpl.hide) {
    const a = activeByCode.get(String(code));
    if (!a || a.active === false) continue;          // nothing to do
    // ★ AN ACCOUNT WITH HISTORY IS NEVER HIDDEN. A chart is the client's record of what
    // they did, not our opinion about what their business is.
    if (used.has(String(code))) { inUse.push(code); continue; }
    hide.push(code);
  }

  return { add, hide, template: businessType, skipped: { present, inUse } };
}

// What the owner is told. Derived from the plan (§9) — never composed alongside it.
export function coaTemplateCopy(plan) {
  if (!plan || !plan.template) return null;
  const n = plan.add.length;
  if (!n && !plan.hide.length) return null;
  const added = n === 1
    ? `Added one account a ${plan.template.toLowerCase()} business usually needs`
    : `Added ${n} accounts a ${plan.template.toLowerCase()} business usually needs`;
  const tidied = plan.hide.length ? `, and tidied away ${plan.hide.length} you're unlikely to use` : "";
  return `${added}${tidied}. You can rename or change any of them in Settings.`;
}

// ── EVERY ACCOUNT THIS FILE CAN PUT ON A CHART ───────────────────────────────
// ★ THE DESCRIPTION LAYER NEEDS TO KNOW THESE EXIST. `clarify.js` builds its account-name
// vocabulary from `DEFAULT_CHART_OF_ACCOUNTS` and nothing else, so every account added
// here was invisible to it: a bill correctly booked to Food Cost was DESCRIBED to the
// owner as "a meal or travel expense", because the name missed the map and fell through
// to the vocabulary of what a human TYPES, where "food" means a meal.
//
// The chart has TWO sources as of C223. A map built from one of them is not a map of the
// chart — it is a map of where somebody last looked.
export const TEMPLATE_ACCOUNTS = [
  ...UNIVERSAL,
  ...Object.values(TEMPLATES).flatMap((t) => t.add || []),
];
