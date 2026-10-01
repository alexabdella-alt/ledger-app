import { describe, it, expect } from "vitest";
import { answerToAccount, answerToCategory } from "../src/lib/clarify";

// ═════════════════════════════════════════════════════════════════════════════
// C555 — FIVE WORDS THAT FILED AN OWNER'S ANSWER IN THE WRONG PLACE, FOR EVERY BUSINESS.
// Found by running the five niche months offline (C554). The answer path books immediately,
// with no confirm step, so each of these was a wrong booking, not a wrong suggestion.
// Half of this file is what must NOT change — each fix narrows a word, and a narrowed word
// can drop something it used to catch correctly.
// ═════════════════════════════════════════════════════════════════════════════

const chart = (extra = {}) => {
  const base = {
    technology_software: { code: "6500", name: "Technology & Software" }, utilities: { code: "6200", name: "Utilities" },
    repairs_maintenance: { code: "6250", name: "Repairs & Maintenance" }, office_supplies: { code: "6600", name: "Office Supplies" },
    marketing_advertising: { code: "6300", name: "Marketing & Advertising" }, rent_occupancy: { code: "6100", name: "Rent & Occupancy" },
    insurance: { code: "6700", name: "Insurance" }, professional_services: { code: "6800", name: "Professional Services" },
    travel_entertainment: { code: "6400", name: "Travel & Entertainment" },
    ...extra,
  };
  return (role) => base[role] || null;
};
const WITH_LICENCES = chart({ taxes_licenses: { code: "6910", name: "Taxes & Licenses" } });
const HEALTHCARE = chart({ taxes_licenses: { code: "6910", name: "Taxes & Licenses" }, malpractice_insurance: { code: "6710", name: "Malpractice Insurance" } });
const CONSTRUCTION = chart({ taxes_licenses: { code: "6910", name: "Taxes & Licenses" }, subcontractor_costs: { code: "5110", name: "Subcontractor Costs" } });
const PLAIN = chart();
const role = (answer, by) => {
  const m = answerToAccount(answer, { getAccountByRole: by });
  return m ? m.role : null;
};

describe("C555 — license is a licence fee, not software", () => {
  it("★★★ the live answers", () => {
    expect(role("contractor license renewal", CONSTRUCTION)).toBe("taxes_licenses");
    expect(role("license renewal", HEALTHCARE)).toBe("taxes_licenses");
    expect(role("city business license", WITH_LICENCES)).toBe("taxes_licenses");
    expect(role("building permit", WITH_LICENCES)).toBe("taxes_licenses");
  });
  it("★★ with no licences category it is no longer filed as software — it goes to the AI", () => {
    expect(role("city business license", PLAIN)).toBeNull();
  });
  it("★★★ a SOFTWARE licence is still software, even where a licences category exists", () => {
    expect(role("Microsoft 365 license", WITH_LICENCES)).toBe("technology_software");
    expect(role("software license for 3 seats", WITH_LICENCES)).toBe("technology_software");
    expect(role("adobe license", WITH_LICENCES)).toBe("technology_software");
  });
});

describe("C555 — electric means the electricity bill, not the electrician", () => {
  it("★★★ the live answer: a subcontracted electrician", () => {
    expect(role("electrician I subbed out", CONSTRUCTION)).toBe("subcontractor_costs");
  });
  it("★★ electrical work is a repair, not a utility", () => {
    expect(role("electrical repair in the kitchen", PLAIN)).toBe("repairs_maintenance");
  });
  it("★★★ and the bill still is a utility", () => {
    expect(role("electric bill", PLAIN)).toBe("utilities");
    expect(role("electricity for the shop", PLAIN)).toBe("utilities");
  });
  it("with no subcontractor category, a contractor still lands on professional services", () => {
    expect(role("a contractor we hired", PLAIN)).toBe("professional_services");
  });
});

describe("C555 — advertising a rental is advertising", () => {
  it("★★★ the live answer", () => {
    expect(role("listing the unit for rent", PLAIN)).toBe("marketing_advertising");
    expect(role("directory listing", PLAIN)).toBe("marketing_advertising");
  });
  it("★★ rent is still rent", () => {
    expect(role("rent for the space", PLAIN)).toBe("rent_occupancy");
    expect(role("coworking desk rent", PLAIN)).toBe("rent_occupancy");
  });
  it("renting equipment is not rent ('rented' does not match the word 'rent')", () => {
    expect(role("rented a mini excavator", PLAIN)).not.toBe("rent_occupancy");
  });
});

describe("C555 — there is a repairs rule now", () => {
  it("★★★ the live answer", () => {
    expect(role("paint and supplies to fix up the unit", PLAIN)).toBe("repairs_maintenance");
  });
  it("other repair language", () => {
    expect(role("plumber fixed a leak", PLAIN)).toBe("repairs_maintenance");
    expect(role("handyman", PLAIN)).toBe("repairs_maintenance");
  });
  it("★★ supplies without a repair are still supplies", () => {
    expect(role("office supplies", PLAIN)).toBe("office_supplies");
    expect(role("printer paper and ink", PLAIN)).toBe("office_supplies");
  });
});

describe("C555 — malpractice goes to the malpractice category where there is one", () => {
  it("★★★ the live answer", () => {
    expect(role("malpractice insurance", HEALTHCARE)).toBe("malpractice_insurance");
  });
  it("★★ without one, it is insurance", () => {
    expect(role("malpractice insurance", PLAIN)).toBe("insurance");
    expect(role("liability insurance", HEALTHCARE)).toBe("insurance");
  });
});

it("C555 — the shared vocabulary itself", () => {
  expect(answerToCategory("license")).toBeNull();
  expect(answerToCategory("electrician")).toBeNull();
  expect(answerToCategory("fix up the unit")).toBe("repairs_maintenance");
});
