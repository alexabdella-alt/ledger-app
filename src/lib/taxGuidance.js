// ═════════════════════════════════════════════════════════════════════════════
// ★★ C678 — EVERY SPENDING ACCOUNT MAPPED TO THE IRS'S OWN LINES, AND THE DEDUCTIBLE SHARE OF
// EACH, BY CURRENT FEDERAL GUIDANCE (tax years 2025–2026). Nobody is asked to "map" anything.
//
// The deductions tracker counted twelve fixed categories, so Food Cost, Repairs, Payroll taxes,
// Bank fees, Vehicle, Contract labor and every category an owner added counted for nothing; and
// the 1099 screen gave up on any account outside a thirteen-entry table. This module is the one
// place the app answers "where does this go on the return, and how much of it counts":
//
//   · Schedule C (Form 1040) Part II lines 8–27a, line 30 (home), and line 4 (cost of goods sold,
//     Part III) — by the account's ROLE first (§4), then its NAME, then its number (5xxx = cost of
//     goods sold), then "Other expenses" (line 27a). Nothing is left unmapped.
//   · The deductible share: business MEALS 50% (IRC §274(n); the temporary 100% restaurant rule
//     ended with 2022); ENTERTAINMENT 0% (§274(a), since 2018); TRAVEL 100%; federal INCOME TAX,
//     fines and penalties, political contributions 0%; everything else 100%. A "Travel &
//     Entertainment" account holds all three, so each transaction is read for which it is.
//   · Home office: the IRS simplified method — $5 per square foot, up to 300 sq ft ($1,500).
//   · Health-insurance premiums and retirement contributions of a self-employed owner are claimed
//     on the PERSONAL return (Schedule 1), not the business's — said so, not "tag these".
//
// A planning tool, not a filing: the accountant can still reclassify. Pure.
// ═════════════════════════════════════════════════════════════════════════════
import { sourcePurchaseLive } from "./depreciation.js";   // C686
import { mileageDeduction, isParkingOrToll } from "./mileage.js";   // C692

export const LINES = {
  "4":   { form: "Cost of goods sold (Schedule C line 4, Part III)", plain: "Cost of what you sell" },
  "8":   { form: "Advertising (line 8)", plain: "Advertising" },
  "9":   { form: "Car and truck expenses (line 9)", plain: "Car and truck" },
  "10":  { form: "Commissions and fees (line 10)", plain: "Commissions and fees" },
  "11":  { form: "Contract labor (line 11)", plain: "Contractors" },
  "13":  { form: "Depreciation and section 179 (line 13)", plain: "Equipment cost, spread over time" },
  "14":  { form: "Employee benefit programs (line 14)", plain: "Employee benefits" },
  "15":  { form: "Insurance, other than health (line 15)", plain: "Business insurance" },
  "16b": { form: "Interest, other (line 16b)", plain: "Interest" },
  "17":  { form: "Legal and professional services (line 17)", plain: "Legal and professional services" },
  "18":  { form: "Office expense (line 18)", plain: "Office expenses" },
  "19":  { form: "Pension and profit-sharing plans (line 19)", plain: "Employee retirement plans" },
  "20a": { form: "Rent — vehicles, machinery, equipment (line 20a)", plain: "Equipment rental" },
  "20b": { form: "Rent — other business property (line 20b)", plain: "Rent" },
  "21":  { form: "Repairs and maintenance (line 21)", plain: "Repairs and maintenance" },
  "22":  { form: "Supplies (line 22)", plain: "Supplies" },
  "23":  { form: "Taxes and licenses (line 23)", plain: "Taxes and licenses" },
  "24a": { form: "Travel (line 24a)", plain: "Travel" },
  "24b": { form: "Deductible meals (line 24b)", plain: "Business meals (50% counts)" },
  "25":  { form: "Utilities (line 25)", plain: "Utilities" },
  "26":  { form: "Wages (line 26)", plain: "Wages" },
  "27a": { form: "Other expenses (line 27a)", plain: "Other business costs" },
  "30":  { form: "Business use of home (line 30)", plain: "Home office" },
  // C703 — an owner's own health insurance or retirement savings paid from the business: claimed on
  // the PERSONAL return (Schedule 1), not Schedule C — so it doesn't lower self-employment tax
  personal: { form: "Personal return (Schedule 1), not the business", plain: "On your personal return" },
  "none": { form: "Not deductible", plain: "Not deductible" },
};
const LINE_ORDER = ["4", "8", "9", "10", "11", "13", "14", "15", "16b", "17", "18", "19", "20a", "20b", "21", "22", "23", "24a", "24b", "25", "26", "27a", "30", "personal"];

// Role → line (and share, where it is not 100%). Every expense role the app creates.
const ROLE_LINE = {
  cogs: "4", food_cost: "4", beverage_cost: "4", merchandise_cost: "4", paper_packaging: "4", direct_labor: "4",
  shipping_fulfillment: "4", job_materials: "4", medical_supplies: "4", hosting_infrastructure: "4", inventory_shrinkage: "4",
  marketing_advertising: "8",
  vehicle_expenses: "9",
  merchant_processing_fees: "10", sales_commissions: "10", property_management: "10",
  subcontractor_costs: "11", customer_support: "11",
  depreciation_amortization: "13",
  employee_benefits: "14",
  insurance: "15", malpractice_insurance: "15",
  interest_expense: "16b",
  professional_services: "17",
  office_supplies: "18",
  equipment_rental: "20a",
  rent_occupancy: "20b", operating_lease_expense: "20b", rou_amortization: "20b",
  repairs_maintenance: "21",
  kitchen_supplies: "22",
  payroll_tax: "23", taxes_licenses: "23", property_taxes: "23",
  utilities: "25",
  salaries_wages: "26",
  technology_software: "27a", bank_service_charges: "27a", linen_laundry: "27a", waste_removal: "27a", hoa_dues: "27a",
  client_reimbursables: "27a", education_training: "27a", dues_memberships: "27a", bad_debt: "27a",
  miscellaneous_expense: "27a", uncategorized_expense: "27a",
  income_tax_expense: "none", gain_loss_disposal: "none",
  travel_entertainment: "travel_split",
};

// A category the owner named themselves (no role): its words decide, first match wins.
const NAME_LINE = [
  [/\b(federal|state)? ?income tax\b|\bfines?\b|\bpenalt(y|ies)\b|\bpolitical\b|\blobby/i, "none"],
  // C694 — "Meals & Entertainment" holds both: each charge is read (meal 50%, show 0%, trip 100%)
  [/\b(meals?|dining)\b[\s\S]*\bentertainment\b|\bentertainment\b[\s\S]*\b(meals?|dining)\b/i, "travel_split"],
  // C694 — meals stay 50% even at a conference (§274(n)), so meals are read BEFORE conferences
  [/\bmeals?\b|\bfood & drink\b|\bdining\b|\brestaurants?\b/i, "24b"],
  // C691 — conferences and trade shows are ordinary business costs (100%), not entertainment
  [/\btrade ?shows?\b|\bexpos?\b|\bconferences?\b|\bconventions?\b|\bseminars?\b/i, "27a"],
  [/\bentertainment\b|\btickets?\b|\bconcerts?\b|\bgolf\b|\bcountry club\b/i, "none"],
  [/\btravel\b|\bairfare\b|\bflights?\b|\bhotels?\b|\blodging\b/i, "24a"],
  [/\bcost of (goods|sales)\b|\bcogs\b|\binventory\b|\bmaterials\b|\bmerchandise\b/i, "4"],
  [/\badverti|\bmarketing\b|\bads\b|\bpromotion|\bsponsored\b/i, "8"],
  // C691 — "Gas & Electric" is a utility, not the car: checked before the vehicle words
  // C694 — but "Electric Repairs" / "Electric Contractor" are services (a 1099) and an "Electric
  // Vehicle" is the car: those words keep the name off the utility line
  [/^(?![\s\S]*\b(repairs?|contract(or|ors)?|install\w*|vehicles?|car|truck|maintenance|labor|labour)\b)[\s\S]*(\bgas (&|and) electric\b|\bnatural gas\b|\belectric(ity)?\b|\butilit)/i, "25"],
  // C703 — QuickBooks' own names: "Automobile", "Auto Expense", "Auto Insurance" (car insurance is line 9 too)
  [/\bvehicle\b|\bcar\b|\btruck\b|\bauto(mobile)?s?\b|\bfuel\b|\bgas(oline)?\b|\bmileage\b|\bparking\b|\btolls?\b/i, "9"],
  [/\bcommissions?\b|\bmerchant\b|\bprocessing fees?\b|\bplatform fees?\b|\bpayment processing\b/i, "10"],
  [/\bcontract(or|ors| labor)\b|\bfreelanc|\bsubcontract/i, "11"],
  [/\bdepreciat|\bamortiz|\bsection 179\b/i, "13"],
  // C703 — health insurance and retirement plans: whose? decided in scheduleCBreakdown (owner_*)
  [/\bhealth\b[\s\S]*\b(insurance|premiums?|plan)\b|\bmedical (insurance|plan)\b/i, "owner_health"],
  [/\b(sep|simple)[- ]?ira\b|\bsolo ?401|\b401\(?k\)?\b|\bretirement\b|\bpension\b/i, "owner_retirement"],
  [/\bbenefits?\b/i, "14"],
  [/\binsurance\b/i, "15"],
  [/\binterest\b/i, "16b"],
  [/\blegal\b|\baccounting\b|\bbookkeep|\bprofessional\b|\bconsult/i, "17"],
  [/\boffice\b|\bpostage\b|\bstationery\b/i, "18"],
  [/\b(equipment|gear|camera|lens|lighting|machinery|vehicle|tool|studio equipment)s? rentals?\b|\brent(al)? (of )?(equipment|gear|machinery|vehicle|camera)/i, "20a"],
  [/\brent\b|\blease\b|\bcowork/i, "20b"],
  [/\brepairs?\b|\bmaintenance\b/i, "21"],
  [/\bsupplies\b|\bsmallwares\b|\bprops\b/i, "22"],
  [/\btax(es)?\b|\blicen[cs]es?\b|\bpermits?\b/i, "23"],
  [/\butilit|\belectric|\binternet\b|\bphone\b|\bwater\b/i, "25"],
  [/\bwages?\b|\bsalar|\bpayroll\b/i, "26"],
];

// Inside a "Travel & Entertainment" account: what was this one charge?
// C691 — hotels by their generic words and the common chains, so a stay isn't read as a meal
const TRAVEL_ROW = /\b(airline|airlines|airways|airport|flight|airfare|hotel|hotels|suites|resort|motel|lodging|hostel|hampton inn|comfort inn|marriott|courtyard by marriott|residence inn|hilton|doubletree|embassy suites|hyatt|westin|sheraton|ritz|four seasons|holiday inn|ihg|crowne plaza|kimpton|wyndham|la quinta|best western|radisson|choice hotels|comfort inn|airbnb|vrbo|uber|lyft|taxi|cab|rental car|car rental|hertz|avis|enterprise|national car|sixt|turo|amtrak|train|subway fare|parking|baggage|delta air|united airlines|united air|american air|southwest air|jetblue|alaska air|frontier airlines|spirit air|hawaiian air|expedia|booking\.com|hotels\.com|priceline|kayak\.com)\b/i;
// C691 — conferences and trade shows: a business cost in full, never "entertainment"
const BUSINESS_EVENT_ROW = /\b(trade ?shows?|expo|conference|convention|seminar|registration|workshop)\b/i;
// ★ C694 — food at a hotel, an airport or a conference is still a meal (50%, §274(n)): a charge
// that reads as food is a meal before it is travel or an event. And a ticket is entertainment (0%)
// before it is a trip — "United Center tickets" is a game, not a flight.
const FOOD_ROW = /\b(grill|bar|cafe|café|coffee|diner|pizza|pizzeria|steakhouse|steak house|restaurant|kitchen|bistro|tavern|pub|brewery|eatery|taqueria|bbq|sushi|burger|bakery|deli|dinner|lunch|breakfast|brunch|social)\b/i;
const ENTERTAINMENT_ROW = /\b(tickets?|ticketmaster|stubhub|concert|theater|theatre|golf|country club|sporting event|stadium|arena|game day|season tickets|nightclub|show)\b/i;

const SHARE = { "24b": 0.5, none: 0 };

// Where one account goes: { line, share }. `line` may be "travel_split" (decided per row).
// ★ C691 — a business entity's STATE income tax is a deductible business tax: a C corporation
// deducts state and local income taxes (only federal income tax is not deductible, §275), and an
// S corporation or partnership deducts an elective pass-through entity tax (Notice 2020-75). A
// sole proprietor's state income tax is personal — not on Schedule C — so it stays out.
const STATE_ENTITY_TAX = /\b(state|local|city|franchise|pass[- ]?through entity|ptet)\b[\s\S]*\btax(es)?\b|\bptet\b/i;
const NOT_A_TAX = /\bpenalt(y|ies)\b|\bfines?\b|\binterest\b/i;   // C694 — §162(f): a penalty is never deductible
export function lineForAccount({ code = "", name = "", role = null, legalForm = "" } = {}) {
  if (["c_corp", "s_corp", "partnership"].includes(legalForm) && STATE_ENTITY_TAX.test(String(name || "")) && !/\bfederal\b/i.test(String(name || "")) && !NOT_A_TAX.test(String(name || ""))) return { line: "23", share: 1, by: "name" };
  if (role && ROLE_LINE[role]) return { line: ROLE_LINE[role], share: SHARE[ROLE_LINE[role]] ?? 1, by: "role" };
  const n = String(name || "");
  for (const [re, line] of NAME_LINE) if (re.test(n)) return { line, share: SHARE[line] ?? 1, by: "name" };
  if (/^5\d{3}$/.test(String(code))) return { line: "4", share: 1, by: "number" };
  return { line: "27a", share: 1, by: "default" };
}

// A travel-and-entertainment charge: travel 100%, entertainment 0%, otherwise a business meal 50%.
export function travelSplitFor(row = {}) {
  const t = `${row.vendor || ""} ${row.description || ""}`;
  if (FOOD_ROW.test(t)) return { line: "24b", share: 0.5 };   // C694 — a meal wherever it was eaten
  if (/\btickets?\b/i.test(t) && !/\b(flight|airline|air|train|amtrak|bus|rail)\b/i.test(t)) return { line: "none", share: 0 };   // C694
  if (TRAVEL_ROW.test(t)) return { line: "24a", share: 1 };
  if (BUSINESS_EVENT_ROW.test(t)) return { line: "27a", share: 1 };   // C691
  if (ENTERTAINMENT_ROW.test(t)) return { line: "none", share: 0 };
  return { line: "24b", share: 0.5 };
}

// IRS simplified method for a home office: $5 per square foot, up to 300 square feet.
export const HOME_OFFICE_RATE = 5, HOME_OFFICE_MAX_SQFT = 300;
export function homeOfficeDeduction(sqft) {
  const s = Math.max(0, Math.min(HOME_OFFICE_MAX_SQFT, Math.floor(Number(sqft) || 0)));
  return s * HOME_OFFICE_RATE;
}

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The year's spending, by Schedule C line. `chart` gives each code's name and role.
// ★ C692 — `mileage` ({ miles, milesAfterChange }) for a sole proprietor: the car is deducted by
// the IRS standard mileage rate, which REPLACES the car costs booked to line 9 (gas, repairs,
// insurance…) — except parking and tolls, which are deducted on top. The booked figure is kept
// (`mileage.actual`) so the screen can show both methods.
// C703 — `grossIncome` (the year's income) caps the simplified home office (Rev. Proc. 2013-13
// §4.03: no more than gross income less the other business expenses; nothing carries over).
// An owner's health insurance / retirement accounts: with employees on the books they are the
// employees' benefits (lines 14 / 19); otherwise, for a sole proprietor or partner, the owner's
// own — not Schedule C (`personal`), returned as `ownerHealth` / `ownerRetirement` for the estimate.
export function scheduleCBreakdown(invoices = [], year = new Date().getFullYear(), { chart = [], homeOfficeSqft = 0, legalForm = "", depreciation = null, mileage = null, grossIncome = null } = {}) {
  const mileageOn = !!(mileage && Number(mileage.miles) > 0) && (!legalForm || legalForm === "sole_prop");
  let carCostsReplaced = 0;
  const acct = new Map((chart || []).map((a) => [String(a.code), a]));
  const inScope = (i) => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at && String(i.date || "").startsWith(String(year));
  const lines = new Map();
  const add = (line, spent, deductible, accountName) => {
    const L = lines.get(line) || { line, spent: 0, deductible: 0, accounts: new Set() };
    L.spent += spent; L.deductible += deductible; if (accountName) L.accounts.add(accountName);
    lines.set(line, L);
  };
  const passThroughOwner = !legalForm || legalForm === "sole_prop" || legalForm === "partnership";
  const hasEmployees = (invoices || []).some((i) => inScope(i) && /^[5-8]\d{3}$/.test(String(i.gl_code || "")) && (() => {
    const a = acct.get(String(i.gl_code)) || {}; return lineForAccount({ code: i.gl_code, name: a.name || i.gl_name, role: a.system_role }).line === "26";
  })());
  let ownerHealth = 0, ownerRetirement = 0;
  for (const i of invoices || []) {
    if (!inScope(i)) continue;
    const code = String(i.gl_code || "");
    if (!/^[5-8]\d{3}$/.test(code)) continue;   // spending accounts only
    const a = acct.get(code) || { code, name: i.gl_name };
    const signed = i.debit_credit === "credit" ? -(Number(i.amount) || 0) : (Number(i.amount) || 0);   // C489 — a correction subtracts
    let { line, share } = lineForAccount({ code, name: a.name || i.gl_name, role: a.system_role, legalForm });   // C691 — the entity decides state income tax
    if (line === "travel_split") ({ line, share } = travelSplitFor(i));
    if (line === "owner_health" || line === "owner_retirement") {   // C703
      const health = line === "owner_health";
      if (hasEmployees || !passThroughOwner) { line = health ? "14" : "19"; share = 1; }
      else { if (health) ownerHealth += signed; else ownerRetirement += signed; line = "personal"; share = 0; }
    }
    if (mileageOn && line === "9" && !isParkingOrToll(i, a.name || i.gl_name)) {   // C692 — replaced by the mileage rate
      carCostsReplaced += signed; add(line, signed, 0, a.name || i.gl_name); continue;
    }
    add(line, signed, signed * share, a.name || i.gl_name);
  }
  // ★ C683 — equipment for tax: the books' depreciation of tracked assets is replaced by the tax
  // figure (bonus depreciation), so line 13's deductible is what the return would claim.
  if (depreciation && (depreciation.tax || depreciation.bookTracked)) {
    const L = lines.get("13") || { line: "13", spent: 0, deductible: 0, accounts: new Set() };
    L.deductible += (Number(depreciation.tax) || 0) - (Number(depreciation.bookTracked) || 0);
    L.taxAdjusted = true;
    lines.set("13", L);
  }
  if (mileageOn) {   // C692
    const m = mileageDeduction({ year, miles: mileage.miles, milesAfterChange: mileage.milesAfterChange });
    const L = lines.get("9") || { line: "9", spent: 0, deductible: 0, accounts: new Set() };
    L.deductible += m.amount;
    L.taxAdjusted = true;
    L.mileage = { ...m, actual: r2(L.spent), replaced: r2(carCostsReplaced) };
    lines.set("9", L);
  }
  // Home office — a sole proprietor's (or single-member LLC's) Schedule C line 30.
  let home = legalForm && legalForm !== "sole_prop" ? 0 : homeOfficeDeduction(homeOfficeSqft);
  if (home > 0 && grossIncome != null) {   // C703 — never more than the business made after its other costs
    const others = [...lines.values()].filter((L) => L.line !== "personal").reduce((s, L) => s + L.deductible, 0);
    home = r2(Math.max(0, Math.min(home, Number(grossIncome) - others)));
  }
  if (home > 0) add("30", home, home, null);

  const rows = [...lines.values()]
    .map((L) => ({ line: L.line, label: LINES[L.line]?.plain || L.line, form: LINES[L.line]?.form || L.line,
      spent: r2(L.spent), deductible: r2(L.deductible), accounts: [...L.accounts], taxAdjusted: !!L.taxAdjusted, mileage: L.mileage || null }))
    .filter((r) => Math.abs(r.spent) >= 0.005 || Math.abs(r.deductible) >= 0.005)
    .sort((x, y) => (x.line === "none") - (y.line === "none") || LINE_ORDER.indexOf(x.line) - LINE_ORDER.indexOf(y.line));
  const deductibleTotal = r2(rows.reduce((s, r) => s + r.deductible, 0));
  const notDeductible = r2(rows.reduce((s, r) => s + (r.taxAdjusted || r.line === "personal" ? 0 : Math.max(0, r.spent - r.deductible)), 0));   // C703 — personal-return items aren't "not deductible"   // C683 — line 13's tax figure can exceed the books'
  return { rows, deductibleTotal, notDeductible, homeOffice: home, ownerHealth: r2(Math.max(0, ownerHealth)), ownerRetirement: r2(Math.max(0, ownerRetirement)), hasEmployees };
}

// Personal-return items for a self-employed owner — named, not "tag these".
export const PERSONAL_RETURN_ITEMS = [
  { key: "health", label: "Health insurance premiums", hint: "If you're self-employed and pay your own health insurance, it's claimed on your personal return (Schedule 1), not the business's." },
  { key: "retirement", label: "Retirement contributions (SEP-IRA, Solo 401k)", hint: "Claimed on your personal return (Schedule 1). A SEP-IRA can take up to 20% of your profit after self-employment tax — bring the year's total at tax time." },
];

// ★ THE FEDERAL ESTIMATE, BY CURRENT RULES (planning, not a filing).
//   · Taxable business profit = income − the DEDUCTIBLE share of spending (so half of meals and
//     all of entertainment, fines and income tax stay in), less the home office.
//   · C corporation: 21% flat (IRC §11), no self-employment tax.
//   · Sole proprietor / partner: self-employment tax on 92.35% of profit — 12.4% Social Security
//     up to that year's wage base, 2.9% Medicare on all of it — none under $400 (§1402(b)); the
//     0.9% Additional Medicare Tax above $200,000 / $250,000 joint / $125,000 separate
//     (§1401(b)(2)); half of the SE tax is deductible (§164(f)).
//   · ★ C685 — an S corporation's profit is NOT self-employment income (IRC §1402(a), Rev. Rul.
//     59-221): the owner's payroll tax is already in the books as wages and payroll tax.
//   · ★ C690 — INCOME TAX BY THE YEAR'S BRACKETS, not a flat 25%. The owner's filing status and
//     other household income (a job, a spouse's pay, interest) are asked once on the Taxes screen.
//     Taxable income = other income + profit − half the SE tax − the standard deduction; the 20%
//     qualified business income deduction (§199A) is capped at 20% of taxable income before it;
//     the business's tax is the tax WITH its profit minus the tax WITHOUT it — the amount to set
//     aside for the business, since a paycheck's withholding already covers the rest. Not
//     modelled (the preparer's): itemized deductions, credits, the senior deduction, and the
//     §199A wage / specified-service limits above the threshold (flagged when reached).
export const SS_WAGE_BASE = { 2024: 168600, 2025: 176100, 2026: 184500 };
export const SE_MINIMUM = 400;
export const ADDL_MEDICARE_THRESHOLD = 200000;
const ADDL_MEDICARE_BY_STATUS = { single: 200000, hoh: 200000, mfj: 250000, mfs: 125000 };
export const FILING_STATUSES = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married, filing together" },
  { value: "mfs", label: "Married, filing separately" },
  { value: "hoh", label: "Head of household" },
];
// Standard deductions and bracket tops (10, 12, 22, 24, 32, 35%; 37% above): Rev. Proc. 2023-34
// (2024), Rev. Proc. 2024-40 as amended by P.L. 119-21 (2025: $15,750 / $31,500 / $23,625),
// Rev. Proc. 2025-32 (2026). Married-separate tops are single's, except 35% ends at half of joint.
export const STANDARD_DEDUCTION = {
  2024: { single: 14600, mfj: 29200, mfs: 14600, hoh: 21900 },
  2025: { single: 15750, mfj: 31500, mfs: 15750, hoh: 23625 },
  2026: { single: 16100, mfj: 32200, mfs: 16100, hoh: 24150 },
};
export const BRACKET_TOPS = {
  2024: { single: [11600, 47150, 100525, 191950, 243725, 609350], mfj: [23200, 94300, 201050, 383900, 487450, 731200],
          mfs: [11600, 47150, 100525, 191950, 243725, 365600], hoh: [16550, 63100, 100500, 191950, 243700, 609350] },
  2025: { single: [11925, 48475, 103350, 197300, 250525, 626350], mfj: [23850, 96950, 206700, 394600, 501050, 751600],
          mfs: [11925, 48475, 103350, 197300, 250525, 375800], hoh: [17000, 64850, 103350, 197300, 250500, 626350] },
  2026: { single: [12400, 50400, 105700, 201775, 256225, 640600], mfj: [24800, 100800, 211400, 403550, 512450, 768700],
          mfs: [12400, 50400, 105700, 201775, 256225, 384350], hoh: [17700, 67450, 105700, 201750, 256200, 640600] },
};
// §199A threshold (taxable income before the deduction) above which wage / service limits can apply.
export const QBI_THRESHOLD = { 2024: { single: 191950, mfj: 383900 }, 2025: { single: 197300, mfj: 394600 }, 2026: { single: 201750, mfj: 403500 } };
const RATES = [0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37];
const yearKey = (table, year) => (table[year] ? year : (Number(year) < Math.min(...Object.keys(table).map(Number)) ? Math.min(...Object.keys(table).map(Number)) : Math.max(...Object.keys(table).map(Number))));
const statusOf = (s) => (["single", "mfj", "mfs", "hoh"].includes(s) ? s : "single");
export function incomeTax(taxable, { year = new Date().getFullYear(), filingStatus = "single" } = {}) {
  const tops = BRACKET_TOPS[yearKey(BRACKET_TOPS, year)][statusOf(filingStatus)];
  let t = 0, prev = 0, left = Math.max(0, Number(taxable) || 0);
  for (let i = 0; i < RATES.length && left > 0; i++) {
    const width = i < tops.length ? tops[i] - prev : Infinity;
    const slice = Math.min(left, width);
    t += slice * RATES[i]; left -= slice; prev = i < tops.length ? tops[i] : prev;
  }
  return r2(t);
}
export function standardDeduction(year, filingStatus = "single") {
  return STANDARD_DEDUCTION[yearKey(STANDARD_DEDUCTION, year)][statusOf(filingStatus)];
}
// ★ C693 — (1) the owner's OWN wages from a job use up the year's Social Security wage base
// (Schedule SE line 8a) and lower the 0.9% Additional Medicare threshold (Form 8959 Part II), so
// they are asked separately from other household income; both count for income tax. (2) A
// business LOSS lowers the tax on other income (a Schedule C loss offsets it; §461(l) limits only
// very large ones): the federal figure can be negative — what the loss saves — and the amount to
// set aside never goes below zero. A C corporation's loss carries forward instead (no refund now).
function passThroughTax({ profit, year, legalForm, filingStatus, otherIncome, ownWages, retirement = 0, healthPremiums = 0 }) {
  const status = statusOf(filingStatus);
  const wages = Math.max(0, Number(ownWages) || 0);
  const other = Math.max(0, Number(otherIncome) || 0) + wages;
  const base = legalForm === "s_corp" ? 0 : Math.max(0, profit) * 0.9235;
  const wageBase = Math.max(0, SS_WAGE_BASE[yearKey(SS_WAGE_BASE, year)] - wages);
  const owesSe = base >= SE_MINIMUM;
  const seTax = owesSe ? r2(Math.min(base, wageBase) * 0.124 + base * 0.029) : 0;
  const addlMedicare = owesSe ? r2(Math.max(0, base - Math.max(0, ADDL_MEDICARE_BY_STATUS[status] - wages)) * 0.009) : 0;
  const halfSe = r2(seTax / 2);
  const std = standardDeduction(year, status);
  // C696 — a self-employed retirement contribution lowers taxable income and the business income
  // the 20% deduction is figured on (Reg. §1.199A-3(b)(1)(vi)); it does not lower SE tax.
  const ret = Math.max(0, Number(retirement) || 0);
  // ★ C700 — the self-employed health insurance deduction (§162(l)): premiums the owner pays for
  // themselves and family, up to the business's net earnings after half the SE tax and the
  // retirement contribution; lowers income tax and the 20% deduction's base, never SE tax. Not
  // for an S corporation here (a >2% shareholder's premiums go through payroll), and not for any
  // month a plan through a job — the owner's or a spouse's — was available (said on screen).
  const health = legalForm === "s_corp" ? 0 : Math.min(Math.max(0, Number(healthPremiums) || 0), Math.max(0, profit - halfSe - ret));
  const qbiIncome = Math.max(0, profit - halfSe - ret - health);
  const beforeQbi = Math.max(0, other + profit - halfSe - ret - health - std);
  const qbi = r2(Math.min(qbiIncome * 0.2, beforeQbi * 0.2));
  const withBiz = incomeTax(beforeQbi - qbi, { year, filingStatus: status });
  const without = incomeTax(Math.max(0, other - std), { year, filingStatus: status });
  const federal = r2(withBiz - without);   // negative when a loss lowers the tax on other income
  const qt = QBI_THRESHOLD[yearKey(QBI_THRESHOLD, year)];
  const qbiMayBeLimited = beforeQbi > (status === "mfj" ? qt.mfj : qt.single);
  return { seTax, halfSe, addlMedicare, qbi, federal, total: r2(federal + seTax + addlMedicare), standardDeduction: std, qbiMayBeLimited, healthDeduction: r2(health) };
}
// C703 — `ownerShare` (0–1): a partner's or S corporation shareholder's share of the profit. Each
// owner pays tax on their share (Schedule K-1), not the whole — two equal partners were each
// shown the tax on all of it. A sole proprietor's share is all of it.
export function federalEstimate({ revenue = 0, deductible = 0, year = new Date().getFullYear(), legalForm = "", filingStatus = "single", otherIncome = 0, ownWages = 0, retirement = 0, healthPremiums = 0, ownerShare = 1 } = {}) {
  const share = (legalForm === "partnership" || legalForm === "s_corp") ? Math.min(1, Math.max(0, Number(ownerShare) || 0)) : 1;
  const profit = r2(((Number(revenue) || 0) - (Number(deductible) || 0)) * (legalForm === "c_corp" ? 1 : share));
  if (legalForm === "c_corp") { const p = Math.max(0, profit); return { profit, seTax: 0, halfSe: 0, addlMedicare: 0, qbi: 0, federal: r2(p * 0.21), total: r2(p * 0.21), marginalRate: p > 0 ? 0.21 : 0, standardDeduction: 0, qbiMayBeLimited: false }; }
  const f = passThroughTax({ profit, year, legalForm, filingStatus, otherIncome, ownWages, retirement, healthPremiums });
  // What $100 more of deductions saves, measured rather than assumed.
  const less = passThroughTax({ profit: profit - 100, year, legalForm, filingStatus, otherIncome, ownWages, retirement, healthPremiums });
  const marginalRate = Math.max(0, Math.round(((f.total - less.total) / 100) * 10000) / 10000);
  return { profit, ...f, marginalRate };
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ C696 — RETIREMENT ROOM FOR A SELF-EMPLOYED OWNER (sole proprietor or partner).
// SEP-IRA: 20% of net self-employment earnings (profit − half the SE tax; the "25% of
// compensation" rule worked through for the self-employed, IRS Pub. 560), up to the §415(c)
// limit. Solo 401(k): the same 20% as the employer part PLUS an employee deferral up to the
// §402(g) limit — together up to §415(c); a catch-up on top at 50+ (and a larger one at 60–63).
// Compensation counted is capped at §401(a)(17). Limits: Notice 2023-75 (2024), Notice 2024-80
// (2025), Notice 2025-67 (2026). An S corporation owner's room comes from their salary, not the
// profit — not modelled. Deadlines (C698): a SEP can be opened and funded until the return's due
// date with extensions; a NEW Solo 401(k) can be opened after year-end and take its first year's
// contributions — employee deferrals included for a sole proprietor — until the return's original
// due date (SECURE Act §201; SECURE 2.0 §317). The §402(g) deferral limit is per PERSON across all
// plans, so 401(k) savings at a job reduce it — not known here, and said on screen.
// ═════════════════════════════════════════════════════════════════════════════
export const RETIREMENT_LIMITS = {
  2024: { total: 69000, deferral: 23000, catchUp50: 7500, catchUp6063: 7500, comp: 345000 },
  2025: { total: 70000, deferral: 23500, catchUp50: 7500, catchUp6063: 11250, comp: 350000 },
  2026: { total: 72000, deferral: 24500, catchUp50: 8000, catchUp6063: 11250, comp: 360000 },
};
export function retirementRoom({ profit = 0, halfSe = 0, year = new Date().getFullYear() } = {}) {
  const L = RETIREMENT_LIMITS[yearKey(RETIREMENT_LIMITS, year)];
  const net = Math.max(0, Math.min(L.comp, (Number(profit) || 0) - (Number(halfSe) || 0)));
  const employer = Math.min(L.total, net * 0.2);
  const deferral = Math.min(L.deferral, Math.max(0, net - employer));
  const solo = Math.min(L.total, employer + deferral);
  // C698 — a catch-up (Solo 401(k) only — a SEP has none) needs earnings left after the rest
  const left = Math.max(0, net - solo);
  return { sep: r2(employer), solo401k: r2(solo), catchUp50: r2(Math.min(L.catchUp50, left)), catchUp6063: r2(Math.min(L.catchUp6063, left)), limits: L, netEarnings: r2(net) };
}

// ═════════════════════════════════════════════════════════════════════════════
// ★ C683 — EQUIPMENT FOR TAX: BONUS DEPRECIATION, NOT THE BOOKS' STRAIGHT LINE.
// The books spread an asset over its life (GAAP). For tax, a small business deducts most or all of
// it in the year it goes into service — bonus depreciation (IRC §168(k)): 100% for property
// acquired after 2025-01-19 (made permanent by P.L. 119-21, 2025), otherwise the TCJA phase-down
// (80% 2023, 60% 2024, 40% early-2025; 100% from 2017-09-28 through 2022). §179 reaches the same
// result for most. What bonus doesn't take is spread straight-line over the asset's recorded life
// — a planning stand-in for the MACRS tables. The in-service date stands in for acquisition.
// ═════════════════════════════════════════════════════════════════════════════
export function bonusRateFor(inServiceDate) {
  const d = String(inServiceDate || "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(d)) return 0;
  if (d >= "2025-01-20") return 1;
  if (d >= "2025-01-01") return 0.4;
  if (d >= "2024-01-01") return 0.6;
  if (d >= "2023-01-01") return 0.8;
  if (d >= "2017-09-28") return 1;
  return 0.5;
}
const monthsIn = (fromYmd, months, year) => {
  // how many of an asset's `months` (from its in-service month) fall in `year`
  const [y, m] = String(fromYmd).split("-").map(Number);
  const start = y * 12 + (m - 1), end = start + Math.max(0, months) - 1;
  const ys = year * 12, ye = year * 12 + 11;
  return Math.max(0, Math.min(end, ye) - Math.max(start, ys) + 1);
};
// assets: [{ id, cost, in_service_date, useful_life_months, status, source_journal_entry_id, deleted_at }]
// posted: [{ asset_id, period_date, amount, journal_entry_id }] — the books' depreciation already posted
// ★ C686 — only equipment the books still hold: a deleted asset, or one whose purchase was deleted,
// voided or reversed (C600's sourcePurchaseLive), gets no tax deduction; and a posted depreciation
// row whose entry was later voided is not subtracted (the books no longer carry it). `ledger` is
// the flattened ledger; without it, nothing can be checked and every asset counts (as before).
// C703 — `mileageRate`: the owner deducts the car by the standard mileage rate, which already
// includes depreciation (Rev. Proc. 2019-46) — a vehicle gets no tax depreciation on top (its
// book depreciation is still taken out of line 13). Vehicles are read from the asset's words.
export const VEHICLE_ASSET = /\b(car|cars|truck|van|suv|vehicle|auto(mobile)?|pickup|sedan|minivan|tesla|toyota|honda|ford|chevrolet|chevy|nissan|subaru|jeep|bmw|mercedes|audi|kia|hyundai|rivian|lexus|volkswagen|vw|dodge|ram|gmc)\b/i;
export function taxDepreciationFor({ assets = [], posted = [], year = new Date().getFullYear(), ledger = null, mileageRate = false } = {}) {
  let tax = 0;
  const live = (id) => !ledger || sourcePurchaseLive(ledger, id);
  // C724 — a SOLD or scrapped asset leaves the adjustment entirely: its book wear and tear (already in
  // profit) stands as the tax figure, and the sale's gain or loss is in profit too. Recapture on a sale
  // at a gain is the accountant's to work out — the estimate does not guess at it.
  const held = (assets || []).filter((a) => a && !a.deleted_at && a.status !== "disposed" && live(a.source_journal_entry_id));
  for (const a of held) {
    if (!(Number(a.cost) > 0) || !a.in_service_date) continue;
    if (mileageRate && VEHICLE_ASSET.test(`${a.description || ""} ${a.vendor || ""}`)) continue;   // C703
    const cost = Number(a.cost), rate = bonusRateFor(a.in_service_date);
    const inYear = Number(String(a.in_service_date).slice(0, 4));
    const life = Math.max(1, Number(a.useful_life_months) || 60);
    if (inYear === Number(year)) tax += cost * rate;
    tax += (cost * (1 - rate)) * monthsIn(a.in_service_date, life, Number(year)) / life;
  }
  const ids = new Set(held.map((a) => String(a.id)));
  const bookTracked = (posted || []).filter((p) => ids.has(String(p.asset_id)) && String(p.period_date || "").startsWith(String(year)) && live(p.journal_entry_id))
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return { tax: r2(tax), bookTracked: r2(bookTracked) };
}
