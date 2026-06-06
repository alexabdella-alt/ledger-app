const DEFAULT_CHART_OF_ACCOUNTS = [
  // Assets
  { code: "1000", name: "Cash & Cash Equivalents", category: "Assets" },
  { code: "1010", name: "Savings Account", category: "Assets" },
  { code: "1100", name: "Accounts Receivable", category: "Assets" },
  { code: "1250", name: "Allowance for Doubtful Accounts", category: "Assets" },
  { code: "1300", name: "Prepaid Expenses", category: "Assets" },
  { code: "1400", name: "Inventory", category: "Assets" },
  { code: "1410", name: "Other Current Assets", category: "Assets" },
  { code: "1500", name: "Fixed Assets (Equipment & Furniture)", category: "Assets" },
  { code: "1510", name: "Accumulated Depreciation", category: "Assets" },
  { code: "1600", name: "Intangible Assets", category: "Assets" },
  { code: "1700", name: "Security Deposits", category: "Assets" },
  { code: "1800", name: "Right-of-Use Asset (ASC 842)", category: "Assets" },
  { code: "1810", name: "Accumulated Amortization - ROU", category: "Assets" },
  // Liabilities
  { code: "2000", name: "Accounts Payable", category: "Liabilities" },
  { code: "2100", name: "Accrued Liabilities", category: "Liabilities" },
  { code: "2200", name: "Credit Card Liability", category: "Liabilities" },
  { code: "2300", name: "Deferred Revenue", category: "Liabilities" },
  { code: "2350", name: "Sales Tax Payable", category: "Liabilities" },
  { code: "2400", name: "Lease Liability - Current (ASC 842)", category: "Liabilities" },
  { code: "2450", name: "Lease Liability - Non-Current (ASC 842)", category: "Liabilities" },
  { code: "2500", name: "Long-Term Debt", category: "Liabilities" },
  { code: "2600", name: "Notes Payable", category: "Liabilities" },
  // Equity
  { code: "3000", name: "Common Stock", category: "Equity" },
  { code: "3100", name: "Retained Earnings", category: "Equity" },
  { code: "3200", name: "Additional Paid-In Capital", category: "Equity" },
  { code: "3300", name: "Owner's Draw / Distributions", category: "Equity" },
  // Revenue
  { code: "4000", name: "Product Revenue", category: "Revenue" },
  { code: "4100", name: "Service Revenue", category: "Revenue" },
  { code: "4200", name: "Subscription Revenue", category: "Revenue" },
  { code: "4300", name: "Interest Income", category: "Revenue" },
  { code: "4400", name: "Other Income", category: "Revenue" },
  // Cost of Goods Sold
  { code: "5000", name: "Cost of Goods Sold", category: "Expenses" },
  { code: "5100", name: "Direct Labor", category: "Expenses" },
  { code: "5200", name: "Shipping & Fulfillment", category: "Expenses" },
  // Operating Expenses
  { code: "6000", name: "Salaries & Wages", category: "Expenses" },
  { code: "6010", name: "Payroll Tax Expense", category: "Expenses" },
  { code: "6020", name: "Employee Benefits", category: "Expenses" },
  { code: "6050", name: "ROU Asset Amortization", category: "Expenses" },
  { code: "6100", name: "Rent & Occupancy", category: "Expenses" },
  { code: "6150", name: "Operating Lease Expense (ASC 842)", category: "Expenses" },
  { code: "6200", name: "Utilities", category: "Expenses" },
  { code: "6250", name: "Repairs & Maintenance", category: "Expenses" },
  { code: "6300", name: "Marketing & Advertising", category: "Expenses" },
  { code: "6400", name: "Travel & Entertainment", category: "Expenses" },
  { code: "6500", name: "Technology & Software (SaaS)", category: "Expenses" },
  { code: "6600", name: "Office Supplies & De Minimis Equipment", category: "Expenses" },
  { code: "6700", name: "Insurance", category: "Expenses" },
  { code: "6800", name: "Professional Services (Legal/Accounting)", category: "Expenses" },
  { code: "6900", name: "Depreciation & Amortization", category: "Expenses" },
  { code: "7000", name: "Bad Debt Expense", category: "Expenses" },
  { code: "7100", name: "Miscellaneous Expense", category: "Expenses" },
  // Other / Below the line
  { code: "8000", name: "Interest Expense", category: "Expenses" },
  { code: "8100", name: "Income Tax Expense", category: "Expenses" },
  { code: "8200", name: "Gain / Loss on Asset Disposal", category: "Expenses" },
];

const PROJECTS = ["General", "Marketing Campaign", "Office Renovation", "Product Launch", "Cloud Infrastructure", "R&D", "Sales Ops"];

export { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS };
