import { describe, it, expect } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants";
import { planCoaTemplate } from "../src/lib/coaTemplates";
import { answerToAccount } from "../src/lib/clarify";

// ═════════════════════════════════════════════════════════════════════════════
// C556 — THE ACCOUNTS THE NICHE MONTHS HAD NOWHERE TO PUT THINGS IN, per business type.
// Each from a document in tools/niches/*.json that had no correct home (C554). Added to the
// types whose month showed the need — NOT to UNIVERSAL, which is reserved for what every
// business has, and NOT to "Other", which deliberately gets no industry opinion.
// ═════════════════════════════════════════════════════════════════════════════

const chartFor = (type) => {
  const plan = planCoaTemplate(type, DEFAULT_CHART_OF_ACCOUNTS);
  return [...DEFAULT_CHART_OF_ACCOUNTS.filter((a) => !plan.hide.includes(String(a.code))), ...plan.add];
};
const roleOf = (type, answer) => {
  const chart = chartFor(type);
  const m = answerToAccount(answer, { getAccountByRole: (r) => chart.find((a) => a.system_role === r) || null });
  return m ? (m.role || chart.find((a) => String(a.code) === String(m.gl_code))?.system_role) : null;
};
const added = (type) => planCoaTemplate(type, DEFAULT_CHART_OF_ACCOUNTS).add.map((a) => `${a.code} ${a.system_role}`);

describe("C556 — which types gain which accounts", () => {
  it("Consulting/Services: licences, education, dues", () => {
    expect(added("Consulting/Services")).toEqual(expect.arrayContaining(["6910 taxes_licenses", "6820 education_training", "6830 dues_memberships"]));
  });
  it("Construction: vehicle expenses", () => {
    expect(added("Construction")).toContain("6460 vehicle_expenses");
  });
  it("Real Estate: vehicle expenses, and a LIABILITY for tenants' deposits", () => {
    const re = planCoaTemplate("Real Estate", DEFAULT_CHART_OF_ACCOUNTS).add;
    expect(re.map((a) => a.system_role)).toEqual(expect.arrayContaining(["vehicle_expenses", "security_deposits_held"]));
    expect(re.find((a) => a.system_role === "security_deposits_held").category).toBe("Liabilities");
  });
  it("Healthcare: education, dues", () => {
    expect(added("Healthcare")).toEqual(expect.arrayContaining(["6820 education_training", "6830 dues_memberships"]));
  });
  it("★ untouched where no month showed a need: Restaurant/Food, Retail, SaaS, Other", () => {
    for (const t of ["Restaurant/Food", "Retail", "SaaS/Software", "Other"]) {
      const roles = planCoaTemplate(t, DEFAULT_CHART_OF_ACCOUNTS).add.map((a) => a.system_role);
      expect(roles, t).not.toContain("vehicle_expenses");
      expect(roles, t).not.toContain("education_training");
      expect(roles, t).not.toContain("dues_memberships");
    }
  });
  it("★ the new codes collide with nothing in the default chart", () => {
    const def = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => String(a.code)));
    for (const c of ["6460", "6820", "6830", "2170"]) expect(def.has(c), c).toBe(false);
  });
});

describe("C556 — natural answers reach the new accounts, only where they exist", () => {
  it("★★ the niche months' own answers", () => {
    expect(roleOf("Construction", "gas for the work truck")).toBe("vehicle_expenses");
    expect(roleOf("Real Estate", "gas driving to the rental")).toBe("vehicle_expenses");
    expect(roleOf("Healthcare", "continuing education course")).toBe("education_training");
    expect(roleOf("Consulting/Services", "my coaching certification course")).toBe("education_training");
    expect(roleOf("Healthcare", "professional association membership")).toBe("dues_memberships");
    expect(roleOf("Real Estate", "HOA dues")).toBe("hoa_dues");
    expect(roleOf("Real Estate", "property tax on the condo")).toBe("property_taxes");
    expect(roleOf("Construction", "mileage reimbursement payment")).toBe("vehicle_expenses");
    expect(roleOf("Consulting/Services", "city business license")).toBe("taxes_licenses");
  });
  it("★★★ and what must NOT change", () => {
    expect(roleOf("Construction", "gas bill")).toBe("utilities");
    expect(roleOf("Construction", "truck insurance")).toBe("insurance");
    expect(roleOf("Construction", "truck payment")).not.toBe("vehicle_expenses");
    expect(roleOf("Consulting/Services", "my course platform subscription")).toBe("technology_software");
    expect(roleOf("Healthcare", "gym membership")).not.toBe("dues_memberships");
    expect(roleOf("Real Estate", "HOA dues")).not.toBe("dues_memberships");
  });
  it("★ where the company has no such account, the rule stays silent (the AI decides)", () => {
    expect(roleOf("Restaurant/Food", "fuel for the delivery van")).not.toBe("vehicle_expenses");
    expect(roleOf("Restaurant/Food", "fuel for the delivery van")).toBeNull();
  });
});
