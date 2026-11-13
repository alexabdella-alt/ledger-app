import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED, ACCOUNTS } from "./helpers/populatedFixture.js";
import TaxView from "../src/components/views/TaxView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

// C678 — the Taxes screen shows every spending line by current guidance; nothing asks to be mapped.
const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
describe("★ the deductions on the Taxes screen", () => {
  const t = text(renderViewHtml(TaxView, { ...POPULATED, ...(VIEW_CONTEXT["TaxView.jsx"] || {}), CHART_OF_ACCOUNTS: ACCOUNTS, navSeat: owner, companyDataLoaded: true }));
  it("food cost — which used to count for nothing — is on line 4", () => expect(t).toMatch(/Cost of what you sell · line 4/));
  it("the home office asks for a size, not a yes/no, and says the IRS method", () => {
    expect(t).toMatch(/Home office · line 30/);
    expect(t).toMatch(/\$5 a square foot, up to 300 sq ft/);
  });
  it("health insurance and retirement say where they're claimed — no 'tag these'", () => {
    expect(t).toMatch(/claimed on your personal return \(Schedule 1\)/);
    expect(t).not.toMatch(/Tag these|Tag contributions|Not tracked here/);
  });
});
