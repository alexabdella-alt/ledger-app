import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav";

// C564 made the "Connect with your accountant" step lead somewhere real. ★ C739 — operator,
// 2026-11-18: "these people will not be hiring accountants … it's either them or me or a combo of
// both". The Shadow team is every client's reviewer, so the step is gone from the setup card.
const dash = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
const code = dash.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

describe("C739 — no accountant step", () => {
  it("★ nothing on Home says invites are coming soon, and no step asks for an accountant", () => {
    expect(code).not.toMatch(/coming soon/i);
    expect(code).not.toMatch(/Connect with your accountant/);
    expect(code).not.toMatch(/renderStep\(optional\)/);
  });
  it("★ a brand-new company's setup card has no accountant step", () => {
    const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
    const h = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: owner, companyDataLoaded: true, isOwner: true, invoices: [], openingBalances: [], onboardingUploadDone: false,
      companySettings: { ...(POPULATED.companySettings || {}), businessType: "", onboardingComplete: false } });
    expect(h).toContain("data-onboarding-step=\"biz\"");
    expect(h).not.toContain("data-onboarding-step=\"accountant\"");
    expect(h).not.toMatch(/your accountant/i);
  });
});
