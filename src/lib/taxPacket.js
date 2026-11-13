// ═════════════════════════════════════════════════════════════════════════════
// ★ C699 — ONE FILE FOR THE TAX PREPARER.
// At tax time a preparer asks for the same things every year: income, spending by tax-form line,
// business miles, the home office, equipment bought, estimated payments made, and who might need
// a 1099. The app already knows each of them; this lays them out as one spreadsheet, from the same
// figures the Taxes screen shows (taxEstimate / deductionBreakdown / tracker1099Rows), so nothing
// is re-typed. A planning summary from the books, said in the file itself — not a return. Pure:
// the caller loads and downloads.
// ═════════════════════════════════════════════════════════════════════════════
import { LEGAL_FORMS } from "./tax.js";
import { FILING_STATUSES } from "./taxGuidance.js";

export const TAX_PACKET_HEADERS = ["Section", "Item", "Amount", "Note"];
const money = (n) => (Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : "");

export function taxPacketRows({ year, companyName = "", legalForm = "", profile = {}, est = {}, deductions = [], assets = [], estPaid = 0, form1099 = [], preparedOn = "" } = {}) {
  const rows = [];
  const add = (section, item, amount = "", note = "") => rows.push([section, item, amount === "" ? "" : money(amount), note]);
  const form = LEGAL_FORMS.find((f) => f.value === legalForm);
  const status = FILING_STATUSES.find((f) => f.value === profile.filingStatus);

  add("About", "Business", "", companyName);
  add("About", "Tax year", "", String(year));
  add("About", "How the business files", "", form ? form.label : "Not set — choose it on the Taxes screen");
  if (legalForm !== "c_corp") add("About", "Filing status", "", profile.assumed ? "Not given (the estimate assumed single)" : (status ? status.label : ""));
  add("About", "Prepared", "", `${preparedOn ? `On ${preparedOn}, ` : ""}from the books — a planning summary for your tax preparer, not a tax return`);

  add("Income", "Money that came in (sales and other income)", est.revenue);
  add("Income", "Profit in the books", est.net, "income less every expense, before tax rules");

  for (const d of deductions || []) {
    if (d.ask || d.line === "none" || d.line === "30") continue;
    if (!(Math.abs(Number(d.amount) || 0) >= 0.005 || Math.abs(Number(d.raw) || 0) >= 0.005)) continue;
    const notes = [d.form, d.hint ? `from: ${d.hint}` : ""];
    if (d.notDeductible > 0.004) notes.push(`${money(d.notDeductible)} of ${money(d.raw)} spent doesn't count (meals at 50%)`);
    if (d.mileage) notes.push(`car by the IRS mileage rate; ${money(d.mileage.replaced)} of recorded car costs replaced (parking and tolls kept)`);
    else if (d.taxAdjusted) notes.push(`equipment by bonus depreciation; the books spread it over its life`);
    add("Deductible spending", d.label, d.amount, notes.filter(Boolean).join(" · "));
  }
  const none = (deductions || []).find((d) => d.line === "none");
  if (none && Number(none.raw) > 0) add("Not deductible", none.label, none.raw, `${none.hint || ""} — entertainment, fines and income tax`.replace(/^ — /, ""));

  if (profile.homeOfficeSqft > 0 && legalForm !== "c_corp" && legalForm !== "s_corp" && legalForm !== "partnership") {
    add("Home office", "Square feet used only for work", profile.homeOfficeSqft, "IRS simplified method: $5 a square foot, up to 300");
    add("Home office", "Deduction", Math.min(300, profile.homeOfficeSqft) * 5);
  }
  const car = (deductions || []).find((d) => d.line === "9" && d.mileage);
  if (car) {
    add("Car", "Business miles", car.mileage.miles, car.mileage.assumedSplit ? "miles from July 1 not given — spread evenly" : "");
    add("Car", "Deduction at the IRS rate", car.mileage.amount, (car.mileage.rates || []).map((r) => `${(r.rate * 100).toFixed(1).replace(/\.0$/, "")}¢ from ${r.from}`).join(", "));
    add("Car", "Car costs recorded in the books", car.mileage.actual, "for comparing with the actual-cost method");
  }

  const bought = (assets || []).filter((a) => a && String(a.in_service_date || "").startsWith(`${year}-`) && Number(a.cost) > 0);
  for (const a of bought) add("Equipment bought", a.description || a.vendor || "Equipment", a.cost, `in use from ${a.in_service_date}`);

  if (Number(profile.healthPremiums) > 0 && legalForm !== "c_corp" && legalForm !== "s_corp") add("Personal return", "Health insurance you paid for yourself", profile.healthPremiums, `self-employed health insurance deduction (Schedule 1)${est.healthDeduction != null ? `; ${money(est.healthDeduction)} counted, up to the business profit` : ""}`);   // C700
  add("Estimated tax", "Estimated payments you told us you made", estPaid);
  if (est.total != null) {
    add("Estimated tax", "Federal income tax (estimate)", est.federal);
    if (legalForm !== "c_corp") add("Estimated tax", "Self-employment tax (estimate)", est.seTax);
    add("Estimated tax", "Total federal (estimate)", est.total, "from the books and your answers — your preparer's figure decides");
  }

  for (const r of form1099 || []) {
    if (!r || !["needs", "unknown", "sent"].includes(r.status?.key)) continue;
    add("1099s", r.name, r.reportable || r.paid, r.status.key === "sent" ? "sent" : r.status.key === "needs" ? "looks like it needs a 1099" : `needs an answer: ${r.why || "what kind of business they are"}`);
  }
  return rows;
}

export function taxPacketFilename(companyName = "", year) {
  const slug = String(companyName || "business").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "business";
  return `${slug}-tax-summary-${year}.csv`;
}
