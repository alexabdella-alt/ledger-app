// ★ C733 — the first five minutes: the setup card shows the three steps that matter, the next one
// highlighted with a real button; the optional ones are folded; and the waiting list doesn't ask
// for the first statement a second time while the card is asking for it.
import { describe, it, expect } from "vitest";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { onboardingProgressCopy } from "../src/lib/onboarding.js";
import { homeWaitingList } from "../src/lib/homeWaiting.js";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

const owner = { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS };
const fresh = { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: owner, companyDataLoaded: true, isOwner: true,
  invoices: [], openingBalances: [], onboardingUploadDone: false,
  companySettings: { ...(POPULATED.companySettings || {}), name: "Riverside Bakery", businessType: "", onboardingComplete: false } };
const strip = (h) => h.replace(/<!-- -->/g, "");

describe("the setup card for a brand-new company", () => {
  const h = strip(renderViewHtml(DashboardView, fresh));
  it("★ the next step is the highlighted one, with a real button", () => {
    const steps = [...h.matchAll(/data-onboarding-step="([a-z]+)"/g)].map((m) => m[1]);
    expect(steps.slice(0, 3)).toEqual(["biz", "upload", "opening"]);
    expect(h).toMatch(/data-onboarding-step="biz" data-onboarding-next=""/);
    expect((h.match(/data-onboarding-next=""/g) || []).length).toBe(1);
    expect(h).toContain("Start →");
  });
  it("★ the optional ones are folded (closed), below the three", () => {
    expect(h).toMatch(/<details data-onboarding-optional(?![^>]*\bopen\b)[^>]*>/);
    const fold = h.indexOf("data-onboarding-optional");
    for (const k of ["biz", "upload", "opening"]) expect(h.indexOf(`data-onboarding-step="${k}"`)).toBeLessThan(fold);
    expect(h.indexOf("Teach us your vendors")).toBeGreaterThan(fold);
    expect(h.indexOf(`data-onboarding-step="accountant"`)).toBeGreaterThan(fold);
    expect(h).not.toContain("Knock these out");
  });
  it("once the business is described, the upload is next", () => {
    const h2 = strip(renderViewHtml(DashboardView, { ...fresh, companySettings: { ...fresh.companySettings, businessType: "Restaurant" } }));
    expect(h2).toMatch(/data-onboarding-step="upload" data-onboarding-next=""/);
    expect(h2).toContain("1 of 3 done — 2 steps left.");
  });
  it("the progress line", () => {
    expect(onboardingProgressCopy({ done: 0, total: 3 })).toBe("3 quick steps — start with the highlighted one.");
    expect(onboardingProgressCopy({ done: 2, total: 3 })).toBe("2 of 3 done — one step left.");
  });
});

describe("not twice: the first statement", () => {
  it("★ the bank-match line stays off the list while the setup card is on screen", () => {
    const bm = { overdue: true, days: null };
    expect(homeWaitingList({ bankMatch: bm }).some((i) => i.id === "bank_match")).toBe(true);
    expect(homeWaitingList({ bankMatch: bm, onboarding: true }).some((i) => i.id === "bank_match")).toBe(false);
  });
});
