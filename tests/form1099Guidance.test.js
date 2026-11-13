import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { thresholdFor, paymentKindForAccount, paidByCardOrNetwork, reportablePayments, verdictFor, VERDICT, PAYMENT_KIND, plan1099ForYear } from "../src/lib/form1099.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// C679 — the 1099 side by current guidance: nothing an owner set up is "can't classify".
describe("the reporting floor follows the payment year", () => {
  it("$600 through 2025, $2,000 from 2026 (2025 tax law)", () => {
    expect([thresholdFor(2024), thresholdFor(2025), thresholdFor(2026), thresholdFor(2027)]).toEqual([600, 600, 2000, 2000]);
  });
  it("★ a $1,500 contractor: a 1099 for 2025, none for 2026", () => {
    const c = { name: "Jo Editor", business_type: "individual" };
    const p = { byKind: { services: 1500 }, total: 1500 };
    expect(verdictFor(c, p, { threshold: thresholdFor(2025), year: 2025 }).verdict).toBe(VERDICT.ELIGIBLE);
    expect(verdictFor(c, p, { threshold: thresholdFor(2026), year: 2026 }).verdict).toBe(VERDICT.BELOW_THRESHOLD);
  });
});

describe("★ every account the app creates has a kind — nothing left to classify", () => {
  const src = readFileSync("src/lib/coaTemplates.js", "utf8");
  const roles = [...new Set([...DEFAULT_CHART_OF_ACCOUNTS.filter((a) => /^[5-8]/.test(a.code)).map((a) => a.system_role),
    ...[...src.matchAll(/code: "[5-8]\d{3}"[^}]*system_role: "([a-z_]+)"/g)].map((m) => m[1])])];
  const allowedUnknown = new Set(["miscellaneous_expense", "uncategorized_expense", "gain_loss_disposal"]);   // genuinely no information
  for (const role of roles) {
    it(role, () => {
      const k = paymentKindForAccount({ role });
      if (allowedUnknown.has(role)) return;
      expect(k).not.toBe(PAYMENT_KIND.UNKNOWN);
    });
  }
  it.each([
    ["utilities", PAYMENT_KIND.NOT_REPORTABLE], ["insurance", PAYMENT_KIND.NOT_REPORTABLE], ["travel_entertainment", PAYMENT_KIND.NOT_REPORTABLE],
    ["salaries_wages", PAYMENT_KIND.NOT_REPORTABLE], ["subcontractor_costs", PAYMENT_KIND.SERVICES], ["equipment_rental", PAYMENT_KIND.RENT],
    ["technology_software", PAYMENT_KIND.GOODS],
  ])("%s → %s", (role, kind) => expect(paymentKindForAccount({ role })).toBe(kind));
});

describe("a category the owner named", () => {
  it.each([["Editing Freelancers", PAYMENT_KIND.SERVICES], ["Camera Gear Rental", PAYMENT_KIND.RENT], ["Studio Cleaning", PAYMENT_KIND.SERVICES],
    ["Props & Supplies", PAYMENT_KIND.GOODS], ["Phone & Internet", PAYMENT_KIND.NOT_REPORTABLE], ["Legal Fees", PAYMENT_KIND.LEGAL]])(
    "%s → %s", (name, kind) => expect(paymentKindForAccount({ code: "6990", name })).toBe(kind));
  it("a category with no name to read is the one honest question left", () => {
    expect(paymentKindForAccount({ code: "7990", name: "" })).toBe(PAYMENT_KIND.UNKNOWN);
  });
});

describe("★ paid by card or a payment app: the 1099-K's, not yours", () => {
  const cardCodes = new Set(["2200"]);
  it("a bill booked straight to the card, or a payment recorded by card / PayPal / Venmo", () => {
    expect(paidByCardOrNetwork({ secondary_gl_code: "2200" }, { cardCodes })).toBe(true);
    expect(paidByCardOrNetwork({ payment_method_used: "paypal" }, { cardCodes })).toBe(true);
    expect(paidByCardOrNetwork({ payment_method_used: "check", secondary_gl_code: "2000" }, { cardCodes })).toBe(false);
  });
  it("a contractor paid $3,000 by card: no 1099 from you, and it says why", () => {
    const rows = [{ amount: 3000, gl_code: "6990", gl_name: "Editing Freelancers", debit_credit: "debit", secondary_gl_code: "2200" }];
    const p = reportablePayments(rows, () => null, { cardCodes });
    expect(p.byKind).toEqual({ card: 3000 });
    const v = verdictFor({ name: "Jo Editor", business_type: "individual" }, p, { threshold: 600, year: 2025 });
    expect([v.verdict, v.why]).toEqual([VERDICT.GOODS_ONLY, "Jo Editor was paid by card or a payment app — the card company or app reports those (Form 1099-K), so no 1099 from you."]);
  });
  it("the plan finds the card account from the chart", () => {
    const chart = [{ code: "2200", name: "Credit Card Liability", system_role: "credit_card_liability" }, { code: "6990", name: "Editing Freelancers" }];
    const inv = [{ vendor: "Jo Editor", amount: 3000, gl_code: "6990", date: "2025-04-01", debit_credit: "debit", status: "posted", secondary_gl_code: "2200" }];
    const plan = plan1099ForYear({ invoices: inv, contacts: [{ name: "Jo Editor", type: "vendor", business_type: "individual" }], chart, year: 2025 });
    expect(plan.eligible).toEqual([]);
    expect(plan.rows[0].verdict).toBe(VERDICT.GOODS_ONLY);   // excluded as a card payment — not merely "unknown"
  });
});
