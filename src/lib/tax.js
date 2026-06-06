// Client-side tax planning helpers. All estimates use simplified federal
// planning rates — no state tax, no credits. See disclaimer in TaxView.

export const FED_RATE = 0.25;   // simplified flat federal planning rate
export const SE_RATE = 0.153;   // self-employment (Social Security + Medicare)

// Year-to-date P&L from the flattened invoice list.
export function ytdNetIncome(invoices, year = new Date().getFullYear()) {
  let revenue = 0, expenses = 0;
  for (const i of invoices || []) {
    if (i.status === "voided") continue;
    if (!String(i.date || "").startsWith(String(year))) continue;
    const c = String(i.gl_code || "");
    const amt = Number(i.amount) || 0;
    if (c[0] === "4") revenue += amt;
    else if (c[0] === "5" || c[0] === "6") expenses += amt;
  }
  return { revenue, expenses, net: revenue - expenses };
}

// Estimated federal + SE tax for the year. estPaid = estimated payments already made.
export function taxEstimate(invoices, year = new Date().getFullYear(), estPaid = 0) {
  const { revenue, expenses, net } = ytdNetIncome(invoices, year);
  const taxableNet = Math.max(0, net);
  const seTax = taxableNet * SE_RATE;
  const federal = taxableNet * FED_RATE;
  const total = federal + seTax;
  const paid = Number(estPaid) || 0;
  return { revenue, expenses, net, taxableNet, federal, seTax, total, estPaid: paid, owed: Math.max(0, total - paid), quarterly: total / 4 };
}

// All recurring federal deadlines, resolved to their next occurrence from `now`.
export function getTaxDeadlines(now = new Date()) {
  const defs = [
    { m: 0, d: 15, label: "Q4 estimated tax payment", plain: "Pay your 4th-quarter estimated taxes for last year", form: "Form 1040-ES", url: "https://www.irs.gov/payments", est: true },
    { m: 0, d: 31, label: "W-2s & 1099s to recipients", plain: "Send W-2s and 1099-NEC forms to your employees and contractors", form: "W-2 / 1099-NEC", url: "https://www.irs.gov/forms-pubs/about-form-1099-nec" },
    { m: 1, d: 28, label: "1099s to IRS (paper filing)", plain: "File your 1099s with the IRS if you're filing on paper", form: "Form 1096 / 1099", url: "https://www.irs.gov/forms-pubs/about-form-1096" },
    { m: 2, d: 15, label: "S-Corp & Partnership returns", plain: "File your S-Corp (1120-S) or Partnership (1065) tax return", form: "Form 1120-S / 1065", url: "https://www.irs.gov/forms-pubs/about-form-1120-s" },
    { m: 2, d: 31, label: "1099s to IRS (e-filing)", plain: "File your 1099s with the IRS electronically", form: "Form 1099", url: "https://www.irs.gov/filing/e-file-forms-1099-with-iris" },
    { m: 3, d: 15, label: "Personal return + Q1 estimated", plain: "File your individual return (1040) and pay 1st-quarter estimated taxes", form: "Form 1040 / 1040-ES", url: "https://www.irs.gov/payments", est: true },
    { m: 5, d: 16, label: "Q2 estimated tax payment", plain: "Pay your 2nd-quarter estimated taxes", form: "Form 1040-ES", url: "https://www.irs.gov/payments", est: true },
    { m: 8, d: 15, label: "Q3 estimated + extended business returns", plain: "Pay 3rd-quarter estimated taxes; extended S-Corp/Partnership returns are also due", form: "Form 1040-ES / 1120-S / 1065", url: "https://www.irs.gov/payments", est: true },
    { m: 9, d: 15, label: "Extended personal return", plain: "File your extended individual return (1040)", form: "Form 1040", url: "https://www.irs.gov/forms-pubs/about-form-1040" },
  ];
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return defs
    .map(def => {
      let year = now.getFullYear();
      let date = new Date(year, def.m, def.d);
      if (date < today) { year += 1; date = new Date(year, def.m, def.d); }
      const days = Math.round((date - today) / 86400000);
      return { ...def, key: `${def.m}-${def.d}`, date, year, days, color: days <= 14 ? "#DC2626" : days <= 30 ? "#D97706" : "#059669" };
    })
    .sort((a, b) => a.date - b.date);
}

// The soonest deadline within `withinDays` (for the Home alert). null if none.
export function nextUrgentDeadline(now = new Date(), withinDays = 30) {
  return getTaxDeadlines(now).find(d => d.days <= withinDays && d.days >= 0) || null;
}

// Common deductions, with YTD totals pulled from the ledger by GL code.
// meals are reported at the 50% deductible amount.
export function deductionBreakdown(invoices, year = new Date().getFullYear()) {
  const inYear = i => i.status !== "voided" && String(i.date || "").startsWith(String(year)) && (String(i.gl_code || "")[0] === "5" || String(i.gl_code || "")[0] === "6");
  const sumCode = code => (invoices || []).filter(i => inYear(i) && String(i.gl_code || "").startsWith(code)).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const sumMatch = re => (invoices || []).filter(i => inYear(i) && re.test(`${i.description || ""} ${i.vendor || ""}`.toLowerCase())).reduce((s, i) => s + (Number(i.amount) || 0), 0);

  const meals = sumMatch(/restaurant|meal|dining|cafe|coffee|catering|lunch|dinner|grubhub|doordash|uber eats/) ;
  const vehicle = sumMatch(/\bgas\b|fuel|mileage|\bauto\b|vehicle/);

  return [
    { key: "software", label: "Software & subscriptions", amount: sumCode("6500"), categorized: true, hint: "Technology & Software (6500)" },
    { key: "proservices", label: "Professional services (legal, accounting)", amount: sumCode("6800"), categorized: true, hint: "Professional Services (6800)" },
    { key: "marketing", label: "Marketing & advertising", amount: sumCode("6300"), categorized: true, hint: "Marketing & Advertising (6300)" },
    { key: "rent", label: "Rent & occupancy", amount: sumCode("6100"), categorized: true, hint: "Rent & Occupancy (6100)" },
    { key: "utilities", label: "Utilities", amount: sumCode("6200"), categorized: true, hint: "Utilities (6200)" },
    { key: "insurance", label: "Insurance premiums", amount: sumCode("6700"), categorized: true, hint: "Insurance (6700)" },
    { key: "salaries", label: "Salaries & wages", amount: sumCode("6000"), categorized: true, hint: "Salaries & Wages (6000)" },
    { key: "supplies", label: "Office supplies & de minimis equipment", amount: sumCode("6600"), categorized: true, hint: "Office Supplies (6600)" },
    { key: "meals", label: "Business meals (50% deductible)", amount: meals * 0.5, raw: meals, categorized: meals > 0, hint: "50% of meal spend" },
    { key: "vehicle", label: "Vehicle / mileage", amount: vehicle, categorized: vehicle > 0, hint: "Detected from fuel/auto descriptions" },
    { key: "homeoffice", label: "Home office", amount: 0, categorized: false, ask: true, hint: "Tell us if you work from home" },
    { key: "health", label: "Health insurance premiums", amount: 0, categorized: false, ask: true, hint: "Tag these so we can track them" },
    { key: "retirement", label: "Retirement (SEP-IRA, Solo 401k)", amount: 0, categorized: false, ask: true, hint: "Tag contributions to track them" },
  ];
}
