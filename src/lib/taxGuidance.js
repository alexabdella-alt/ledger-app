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
  "none": { form: "Not deductible", plain: "Not deductible" },
};
const LINE_ORDER = ["4", "8", "9", "10", "11", "13", "14", "15", "16b", "17", "18", "19", "20a", "20b", "21", "22", "23", "24a", "24b", "25", "26", "27a", "30"];

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
  [/\bentertainment\b|\btickets?\b|\bconcerts?\b|\bgolf\b|\bcountry club\b/i, "none"],
  [/\bmeals?\b|\bfood & drink\b|\bdining\b|\brestaurants?\b/i, "24b"],
  [/\btravel\b|\bairfare\b|\bflights?\b|\bhotels?\b|\blodging\b/i, "24a"],
  [/\bcost of (goods|sales)\b|\bcogs\b|\binventory\b|\bmaterials\b|\bmerchandise\b/i, "4"],
  [/\badverti|\bmarketing\b|\bads\b|\bpromotion|\bsponsored\b/i, "8"],
  [/\bvehicle\b|\bcar\b|\btruck\b|\bfuel\b|\bgas(oline)?\b|\bmileage\b|\bparking\b|\btolls?\b/i, "9"],
  [/\bcommissions?\b|\bmerchant\b|\bprocessing fees?\b|\bplatform fees?\b|\bpayment processing\b/i, "10"],
  [/\bcontract(or|ors| labor)\b|\bfreelanc|\bsubcontract/i, "11"],
  [/\bdepreciat|\bamortiz|\bsection 179\b/i, "13"],
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
const TRAVEL_ROW = /\b(airline|airlines|airways|flight|airfare|hotel|marriott|hilton|hyatt|airbnb|lodging|motel|uber|lyft|taxi|cab|rental car|hertz|avis|enterprise|amtrak|train|parking|baggage|delta|united|american air|southwest|jetblue|alaska air|expedia|booking\.com)\b/i;
const ENTERTAINMENT_ROW = /\b(tickets?|ticketmaster|stubhub|concert|theater|theatre|golf|country club|sporting event|stadium|arena|game day|season tickets|nightclub|show)\b/i;

const SHARE = { "24b": 0.5, none: 0 };

// Where one account goes: { line, share }. `line` may be "travel_split" (decided per row).
export function lineForAccount({ code = "", name = "", role = null } = {}) {
  if (role && ROLE_LINE[role]) return { line: ROLE_LINE[role], share: SHARE[ROLE_LINE[role]] ?? 1, by: "role" };
  const n = String(name || "");
  for (const [re, line] of NAME_LINE) if (re.test(n)) return { line, share: SHARE[line] ?? 1, by: "name" };
  if (/^5\d{3}$/.test(String(code))) return { line: "4", share: 1, by: "number" };
  return { line: "27a", share: 1, by: "default" };
}

// A travel-and-entertainment charge: travel 100%, entertainment 0%, otherwise a business meal 50%.
export function travelSplitFor(row = {}) {
  const t = `${row.vendor || ""} ${row.description || ""}`;
  if (TRAVEL_ROW.test(t)) return { line: "24a", share: 1 };
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
export function scheduleCBreakdown(invoices = [], year = new Date().getFullYear(), { chart = [], homeOfficeSqft = 0, legalForm = "", depreciation = null } = {}) {
  const acct = new Map((chart || []).map((a) => [String(a.code), a]));
  const inScope = (i) => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at && String(i.date || "").startsWith(String(year));
  const lines = new Map();
  const add = (line, spent, deductible, accountName) => {
    const L = lines.get(line) || { line, spent: 0, deductible: 0, accounts: new Set() };
    L.spent += spent; L.deductible += deductible; if (accountName) L.accounts.add(accountName);
    lines.set(line, L);
  };
  for (const i of invoices || []) {
    if (!inScope(i)) continue;
    const code = String(i.gl_code || "");
    if (!/^[5-8]\d{3}$/.test(code)) continue;   // spending accounts only
    const a = acct.get(code) || { code, name: i.gl_name };
    const signed = i.debit_credit === "credit" ? -(Number(i.amount) || 0) : (Number(i.amount) || 0);   // C489 — a correction subtracts
    let { line, share } = lineForAccount({ code, name: a.name || i.gl_name, role: a.system_role });
    if (line === "travel_split") ({ line, share } = travelSplitFor(i));
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
  // Home office — a sole proprietor's (or single-member LLC's) Schedule C line 30.
  const home = legalForm && legalForm !== "sole_prop" ? 0 : homeOfficeDeduction(homeOfficeSqft);
  if (home > 0) add("30", home, home, null);

  const rows = [...lines.values()]
    .map((L) => ({ line: L.line, label: LINES[L.line]?.plain || L.line, form: LINES[L.line]?.form || L.line,
      spent: r2(L.spent), deductible: r2(L.deductible), accounts: [...L.accounts], taxAdjusted: !!L.taxAdjusted }))
    .filter((r) => Math.abs(r.spent) >= 0.005 || Math.abs(r.deductible) >= 0.005)
    .sort((x, y) => (x.line === "none") - (y.line === "none") || LINE_ORDER.indexOf(x.line) - LINE_ORDER.indexOf(y.line));
  const deductibleTotal = r2(rows.reduce((s, r) => s + r.deductible, 0));
  const notDeductible = r2(rows.reduce((s, r) => s + (r.taxAdjusted ? 0 : Math.max(0, r.spent - r.deductible)), 0));   // C683 — line 13's tax figure can exceed the books'
  return { rows, deductibleTotal, notDeductible, homeOffice: home };
}

// Personal-return items for a self-employed owner — named, not "tag these".
export const PERSONAL_RETURN_ITEMS = [
  { key: "health", label: "Health insurance premiums", hint: "If you're self-employed and pay your own health insurance, it's claimed on your personal return (Schedule 1), not the business's — bring the year's total at tax time." },
  { key: "retirement", label: "Retirement contributions (SEP-IRA, Solo 401k)", hint: "Claimed on your personal return (Schedule 1). A SEP-IRA can take up to 20% of your profit after self-employment tax — bring the year's total at tax time." },
];

// ★ THE FEDERAL ESTIMATE, BY CURRENT RULES (planning, not a filing).
//   · Taxable business profit = income − the DEDUCTIBLE share of spending (so half of meals and
//     all of entertainment, fines and income tax stay in), less the home office.
//   · C corporation: 21% flat (IRC §11), no self-employment tax.
//   · Everyone else (pass-through): self-employment tax on 92.35% of profit — 12.4% Social
//     Security up to that year's wage base, 2.9% Medicare on all of it; half of it deductible;
//     then the 20% qualified business income deduction (§199A, made permanent in 2025); the rest
//     at the app's flat planning rate. Personal deductions and credits are the preparer's.
//   · ★ C685 — an S CORPORATION's profit is NOT self-employment income (IRC §1402(a), Rev. Rul.
//     59-221): the owner's payroll tax is already in the books as wages and payroll tax. So an S
//     corp gets the QBI deduction and the planning rate, and no self-employment tax.
//   · ★ C685 — no self-employment tax when net earnings are under $400 (§1402(b)); and the 0.9%
//     Additional Medicare Tax on self-employment earnings over $200,000 (§1401(b)(2), the
//     single-filer threshold — a planning stand-in; it is NOT part of the half deducted).
export const SS_WAGE_BASE = { 2024: 168600, 2025: 176100, 2026: 184500 };
export const SE_MINIMUM = 400;
export const ADDL_MEDICARE_THRESHOLD = 200000;
export function federalEstimate({ revenue = 0, deductible = 0, year = new Date().getFullYear(), legalForm = "", flatRate = 0.25 } = {}) {
  const profit = r2(Math.max(0, (Number(revenue) || 0) - (Number(deductible) || 0)));
  if (legalForm === "c_corp") return { profit, seTax: 0, halfSe: 0, addlMedicare: 0, qbi: 0, federal: r2(profit * 0.21), total: r2(profit * 0.21) };
  const base = legalForm === "s_corp" ? 0 : profit * 0.9235;
  const wageBase = SS_WAGE_BASE[year] || SS_WAGE_BASE[Math.max(...Object.keys(SS_WAGE_BASE).map(Number))];
  const owesSe = base >= SE_MINIMUM;
  const seTax = owesSe ? r2(Math.min(base, wageBase) * 0.124 + base * 0.029) : 0;
  const addlMedicare = owesSe ? r2(Math.max(0, base - ADDL_MEDICARE_THRESHOLD) * 0.009) : 0;
  const halfSe = r2(seTax / 2);
  const afterHalf = Math.max(0, profit - halfSe);
  const qbi = r2(afterHalf * 0.2);
  const federal = r2((afterHalf - qbi) * flatRate);
  return { profit, seTax, halfSe, addlMedicare, qbi, federal, total: r2(federal + seTax + addlMedicare) };
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
export function taxDepreciationFor({ assets = [], posted = [], year = new Date().getFullYear(), ledger = null } = {}) {
  let tax = 0;
  const live = (id) => !ledger || sourcePurchaseLive(ledger, id);
  const held = (assets || []).filter((a) => a && !a.deleted_at && live(a.source_journal_entry_id));
  for (const a of held) {
    if (!(Number(a.cost) > 0) || !a.in_service_date) continue;
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
