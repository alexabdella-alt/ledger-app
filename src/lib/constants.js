const DEFAULT_CHART_OF_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Cash & Cash Equivalents", category: "Assets", system_role: "cash" },
  { code: "1010", name: "Savings Account", category: "Assets", system_role: "savings" },
  { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "1250", name: "Allowance for Doubtful Accounts", category: "Assets", system_role: "allowance_doubtful_accounts" },
  { code: "1300", name: "Prepaid Expenses", category: "Assets", system_role: "prepaid_expenses" },
  { code: "1400", name: "Inventory", category: "Assets", system_role: "inventory" },
  { code: "1410", name: "Other Current Assets", category: "Assets", system_role: "other_current_assets" },
  { code: "1500", name: "Fixed Assets (Equipment & Furniture)", category: "Assets", system_role: "fixed_assets" },
  { code: "1510", name: "Accumulated Depreciation", category: "Assets", system_role: "accumulated_depreciation" },
  { code: "1600", name: "Intangible Assets", category: "Assets", system_role: "intangible_assets" },
  { code: "1700", name: "Security Deposits", category: "Assets", system_role: "security_deposits" },
  { code: "1800", name: "Right-of-Use Asset (ASC 842)", category: "Assets", system_role: "rou_asset" },
  { code: "1810", name: "Accumulated Amortization - ROU", category: "Assets", system_role: "accumulated_amortization_rou" },
  // Liabilities
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "2100", name: "Accrued Liabilities", category: "Liabilities", system_role: "accrued_liabilities" },
  { code: "2101", name: "Payroll Taxes Payable", category: "Liabilities", system_role: "payroll_taxes_payable" },
  { code: "2200", name: "Credit Card Liability", category: "Liabilities", system_role: "credit_card_liability" },
  { code: "2300", name: "Deferred Revenue", category: "Liabilities", system_role: "deferred_revenue" },
  { code: "2350", name: "Sales Tax Payable", category: "Liabilities", system_role: "sales_tax_payable" },
  { code: "2400", name: "Lease Liability - Current (ASC 842)", category: "Liabilities", system_role: "lease_liability_current" },
  { code: "2450", name: "Lease Liability - Non-Current (ASC 842)", category: "Liabilities", system_role: "lease_liability_noncurrent" },
  { code: "2500", name: "Long-Term Debt", category: "Liabilities", system_role: "long_term_debt" },
  { code: "2600", name: "Notes Payable", category: "Liabilities", system_role: "notes_payable" },
  // Equity
  { code: "3000", name: "Common Stock", category: "Equity", system_role: "common_stock" },
  { code: "3100", name: "Retained Earnings", category: "Equity", system_role: "retained_earnings" },
  { code: "3200", name: "Additional Paid-In Capital", category: "Equity", system_role: "additional_paid_in_capital" },
  { code: "3300", name: "Owner's Draw / Distributions", category: "Equity", system_role: "owners_draw" },
  { code: "3400", name: "Opening Balance Equity", category: "Equity", system_role: "opening_balance_equity" },
  // Revenue
  { code: "4000", name: "Product Revenue", category: "Revenue", system_role: "product_revenue" },
  { code: "4100", name: "Service Revenue", category: "Revenue", system_role: "service_revenue" },
  { code: "4200", name: "Subscription Revenue", category: "Revenue", system_role: "subscription_revenue" },
  { code: "4300", name: "Interest Income", category: "Revenue", system_role: "interest_income" },
  { code: "4400", name: "Other Income", category: "Revenue", system_role: "other_income" },
  // Cost of Goods Sold
  { code: "5000", name: "Cost of Goods Sold", category: "Expenses", system_role: "cogs" },
  { code: "5100", name: "Direct Labor", category: "Expenses", system_role: "direct_labor" },
  { code: "5200", name: "Shipping & Fulfillment", category: "Expenses", system_role: "shipping_fulfillment" },
  // Operating Expenses
  { code: "6000", name: "Salaries & Wages", category: "Expenses", system_role: "salaries_wages" },
  { code: "6010", name: "Payroll Tax Expense", category: "Expenses", system_role: "payroll_tax" },
  { code: "6020", name: "Employee Benefits", category: "Expenses", system_role: "employee_benefits" },
  { code: "6050", name: "ROU Asset Amortization", category: "Expenses", system_role: "rou_amortization" },
  { code: "6100", name: "Rent & Occupancy", category: "Expenses", system_role: "rent_occupancy" },
  { code: "6150", name: "Operating Lease Expense (ASC 842)", category: "Expenses", system_role: "operating_lease_expense" },
  { code: "6200", name: "Utilities", category: "Expenses", system_role: "utilities" },
  { code: "6250", name: "Repairs & Maintenance", category: "Expenses", system_role: "repairs_maintenance" },
  { code: "6300", name: "Marketing & Advertising", category: "Expenses", system_role: "marketing_advertising" },
  { code: "6400", name: "Travel & Entertainment", category: "Expenses", system_role: "travel_entertainment" },
  { code: "6500", name: "Technology & Software (SaaS)", category: "Expenses", system_role: "technology_software" },
  { code: "6600", name: "Office Supplies & De Minimis Equipment", category: "Expenses", system_role: "office_supplies" },
  { code: "6700", name: "Insurance", category: "Expenses", system_role: "insurance" },
  { code: "6800", name: "Professional Services (Legal/Accounting)", category: "Expenses", system_role: "professional_services" },
  { code: "6900", name: "Depreciation & Amortization", category: "Expenses", system_role: "depreciation_amortization" },
  { code: "7000", name: "Bad Debt Expense", category: "Expenses", system_role: "bad_debt" },
  { code: "7100", name: "Miscellaneous Expense", category: "Expenses", system_role: "miscellaneous_expense" },
  // O88 calibration (migration 063) — HONEST SUSPENSE. A bank line whose vendor we do
  // not know books HERE, never to a guessed account. Distinct from 7100 on purpose:
  // Miscellaneous means "we looked and it is genuinely miscellaneous", Uncategorized
  // means "we did not know". Tier 1 #7's acceptance test treats a Miscellaneous
  // fallback on a recognizable vendor as a HARD FAIL — collapsing the two would
  // delete that test's meaning. Nothing books here until the ladder is wired.
  { code: "7150", name: "Uncategorized Expense", category: "Expenses", system_role: "uncategorized_expense" },
  // Other / Below the line
  { code: "8000", name: "Interest Expense", category: "Expenses", system_role: "interest_expense" },
  { code: "8100", name: "Income Tax Expense", category: "Expenses", system_role: "income_tax_expense" },
  { code: "8200", name: "Gain / Loss on Asset Disposal", category: "Expenses", system_role: "gain_loss_disposal" },
];

const PROJECTS = ["General", "Marketing Campaign", "Office Renovation", "Product Launch", "Cloud Infrastructure", "R&D", "Sales Ops"];

// ── AI / infrastructure ──────────────────────────────────────────────────────
// NOTE: the AI model + max_tokens are SERVER-OWNED (ai-proxy/aiProfiles.js). The
// client never chooses them — it sends only { profile, messages, slots }.
const AI_PROXY_URL = "https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy";

// ── Business logic constants (single source of truth) ────────────────────────
const CAPITALIZE_THRESHOLD = 2500;        // ASC 360 de-minimis: capitalize at/above this
const CAPITALIZE_CHECK_THRESHOLD = 2000;  // asset purchases at/above this trigger the GAAP question
const MEALS_DEDUCTIBLE_RATE = 0.5;        // IRS: meals are 50% deductible
const IRS_1099_THRESHOLD = 600;           // 1099-NEC reporting threshold
const DEFAULT_IBR = 0.05;                 // default incremental borrowing rate for ASC 842
const AI_CONFIDENCE_AUTO_BOOK = 85;       // >= this auto-books without review
const AI_CONFIDENCE_REVIEW = 75;          // < this flags for review
// Hard "ask, don't guess" floor for the clarification flow. BELOW this, the AI is too close to
// a coin-flip to book silently — a real accountant that unsure would ask, and auto-booking a
// coin-flip both erodes trust and feeds the learning layer bad training data. So <FLOOR always
// ASKS regardless of materiality; the FLOOR+ zone stays materiality-gated by O49. This is a
// STARTING VALUE tuned from intuition, meant to be adjusted from real-use data — not permanent.
// (The learning layer's vendor decay lifts confidence over time, so a 70 floor gets quieter per
// business as it's used; it does NOT make the app permanently chatty.)
const AI_CONFIDENCE_ASK_FLOOR = 70;       // < this: clarification ASKS even if immaterial
const AP_AUTO_APPROVE_THRESHOLD = 500;    // AP bills under this can auto-approve
const FED_TAX_RATE = 0.25;                // simplified flat federal planning rate
const SE_TAX_RATE = 0.153;                // self-employment tax rate

// Platform administrators — only these accounts see the Settings → Security tab.
const PLATFORM_ADMIN_EMAILS = ["alexabdella@gmail.com"];

export {
  DEFAULT_CHART_OF_ACCOUNTS, PROJECTS,
  AI_PROXY_URL,
  CAPITALIZE_THRESHOLD, CAPITALIZE_CHECK_THRESHOLD, MEALS_DEDUCTIBLE_RATE,
  IRS_1099_THRESHOLD, DEFAULT_IBR, AI_CONFIDENCE_AUTO_BOOK, AI_CONFIDENCE_REVIEW,
  AI_CONFIDENCE_ASK_FLOOR,
  AP_AUTO_APPROVE_THRESHOLD, FED_TAX_RATE, SE_TAX_RATE,
  PLATFORM_ADMIN_EMAILS,
};
