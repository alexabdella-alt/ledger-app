// ★ C735 — week two. (1) A solo owner hears on Home when a finished month is ready to sign off
// (the sign-off moved to Reports in C729 and nothing on Home said so). (2) Inviting the accountant:
// the invite can be emailed from the owner's own mail app, the "same address" rule is said before
// the click, and a Viewer selection nudges toward Accountant.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { monthReadyToSign, homeWaitingList, WAIT } from "../src/lib/homeWaiting.js";
import { firstUnsignedMonth } from "../src/lib/workbench.js";
import { inviteMailto } from "../src/lib/firstRun.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import TeamView from "../src/components/views/TeamView.jsx";

const base = { canSign: true, months: ["2026-10", "2026-10", "2026-11"], signoffs: [], currentMonth: "2026-11", isReady: () => true, label: (p) => (p === "2026-10" ? "October" : p), firstUnsigned: firstUnsignedMonth };

describe("a finished month, ready to sign off", () => {
  it("★ offered for the first unsigned finished month, when nothing blocks it", () => {
    expect(monthReadyToSign(base)).toEqual({ period: "2026-10", label: "October" });
    const [it0] = homeWaitingList({ monthReady: { label: "October" } });
    expect(it0).toMatchObject({ id: "month_ready", urgency: WAIT.SOON, text: "October's books are ready — sign them off to lock them in." });
    expect(it0.actions).toEqual([{ kind: "nav", label: "Review and sign off", view: "reports" }]);
  });
  it("★ not when someone else signs (an accountant), not for this month, not when blocked", () => {
    expect(monthReadyToSign({ ...base, canSign: false })).toBe(null);
    expect(monthReadyToSign({ ...base, months: ["2026-11"] })).toBe(null);               // the month isn't over
    expect(monthReadyToSign({ ...base, isReady: () => false })).toBe(null);              // something blocks it
    expect(monthReadyToSign({ ...base, isReady: () => { throw new Error("x"); } })).toBe(null);
    expect(monthReadyToSign({ ...base, signoffs: [{ period: "2026-10" }] })).toBe(null); // already signed
  });
  it("Home passes it only on the owner's seat, after the data has loaded", () => {
    const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).toMatch(/monthReady: companyDataLoaded \? monthReadyToSign\(\{ canSign: !cockpit && !!canSoloAttest,/);
  });
});

describe("inviting the accountant", () => {
  it("★ the email: to the invited address, the link, and the same-address rule", () => {
    const m = inviteMailto({ email: "pat@cpa.com", link: "https://x.app/?invite=abc", companyName: "Riverside Bakery", role: "accountant" });
    expect(m.startsWith("mailto:pat%40cpa.com?subject=")).toBe(true);
    const body = decodeURIComponent(m.split("&body=")[1]);
    expect(decodeURIComponent(m.split("subject=")[1].split("&")[0])).toBe("Join Riverside Bakery's books on Shadow");
    expect(body).toContain("as their accountant");
    expect(body).toContain("https://x.app/?invite=abc");
    expect(body).toContain("pat@cpa.com — the invite only works for it");
  });
  it("★ the form says the same-address rule (the default stays least-privilege; C741 — no Accountant nudge)", () => {
    const h = renderViewHtml(TeamView, { ...POPULATED, ...(VIEW_CONTEXT["TeamView.jsx"] || {}), isOwner: true, companyDataLoaded: true }).replace(/<!-- -->/g, "");
    expect(h).toContain("the invite only works for that address");
    expect(h).not.toContain("data-invite-role-hint");
    const src = readFileSync("src/components/views/TeamView.jsx", "utf8");
    expect(src).toMatch(/const \[role, setRole\] = React\.useState\("viewer"\);/);
    expect(src).toMatch(/href=\{inviteMailto\(\{ email: lastInvite\.email, link: lastLink/);
  });
});
