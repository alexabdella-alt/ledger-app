import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants";
import { planCoaTemplate, BUSINESS_TYPES } from "../src/lib/coaTemplates";
import { plainCategoryPhrase, containsOwnerJargon } from "../src/lib/clarify";

// ═════════════════════════════════════════════════════════════════════════════
// C557 — THE COACHING & COURSES BUSINESS TYPE (operator: "add the coaching & courses
// business type… do whatever you think is optimal based on industry best").
// The coach niche month (C554) had nowhere to put course sales: the nearest type hides
// Product Revenue. Laid out the way bookkeepers who serve creators do it — one income line
// per stream — so "how much did my course make?" has an answer.
// ═════════════════════════════════════════════════════════════════════════════

const plan = planCoaTemplate("Coaching & Courses", DEFAULT_CHART_OF_ACCOUNTS);
const roles = plan.add.map((a) => a.system_role);

describe("C557 — Coaching & Courses", () => {
  it("is a business type an owner can pick", () => {
    expect(BUSINESS_TYPES).toContain("Coaching & Courses");
  });

  it("★★★ one income line per stream", () => {
    expect(roles).toEqual(expect.arrayContaining(["digital_product_revenue", "sponsorship_revenue", "affiliate_revenue"]));
    for (const r of ["digital_product_revenue", "sponsorship_revenue", "affiliate_revenue"]) {
      expect(plan.add.find((a) => a.system_role === r).category, r).toBe("Revenue");
    }
    // coaching and memberships stay on the default lines, which remain visible
    expect(plan.hide).not.toContain("4100");
    expect(plan.hide).not.toContain("4200");
  });

  it("★★ Product Revenue is NOT hidden — a printed journal or a book is physical product income", () => {
    expect(plan.hide).not.toContain("4000");
  });

  it("the costs a coaching business actually has", () => {
    expect(roles).toEqual(expect.arrayContaining(["subcontractor_costs", "education_training", "dues_memberships", "taxes_licenses"]));
    expect(plan.add.find((a) => a.system_role === "subcontractor_costs").name).toBe("Contractors & Freelancers");
  });

  it("★ platform fees are NOT given a second account — they are already Merchant Processing Fees", () => {
    expect(roles).not.toContain("platform_fees");
    expect(DEFAULT_CHART_OF_ACCOUNTS.some((a) => a.system_role === "merchant_processing_fees")).toBe(true);
  });

  it("every new account reads to an owner in plain words, never as a meal or office supplies", () => {
    for (const a of plan.add.filter((x) => x.category === "Expenses")) {
      const said = plainCategoryPhrase({ gl_code: a.code, gl_name: a.name, vendor: "Some Vendor" });
      expect(said, a.name).not.toMatch(/meal|travel|office supplies|a general business expense/i);
      expect(containsOwnerJargon(said), `${a.name}: "${said}"`).toBe(false);
    }
  });
});

describe("C557 — the onboarding list IS the template list", () => {
  it("★★ Home reads BUSINESS_TYPES rather than typing its own copy", () => {
    const dash = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(dash).toMatch(/\{BUSINESS_TYPES\.map\(t=><option key=\{t\} value=\{t\}>\{t\}<\/option>\)\}/);
    expect(dash).not.toMatch(/\["SaaS\/Software","Consulting\/Services"/);
  });
});
