import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLIENT_VIEW_IDS, ALL_VIEW_IDS } from "../src/lib/nav";

// ═════════════════════════════════════════════════════════════════════════════
// C564 — THE SETUP CHECKLIST SAID "TEAM INVITES ARE COMING SOON", AND KEPT SAYING IT.
// Invites shipped in August (C225, Settings → Team). Clicking "Connect with your accountant"
// showed that sentence and dismissed the step, so the false notice then sat on every new
// company's checklist for good — on the step that matters most to the CPA model this product
// is built around (O131/D2: without an accountant, nobody reviews the books).
// ═════════════════════════════════════════════════════════════════════════════
const dash = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
const code = dash.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, "").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

describe("C564 — the accountant step leads somewhere real", () => {
  it("★★★ nothing on Home says invites are coming soon", () => {
    expect(code).not.toMatch(/coming soon/i);
    expect(code).not.toMatch(/accountantNotice/);
  });
  it("★★ the step takes the owner to Team, labelled as what it does", () => {
    expect(code).toMatch(/go:\(\)=>navTo\("team"\), optional:true, actionLabel:"Invite →"/);
  });
  it("★★ and Team is a screen both seats may open — so the click is never silently refused", () => {
    expect(CLIENT_VIEW_IDS).toContain("team");
    expect(ALL_VIEW_IDS).toContain("team");
  });
  it("★ only the owner sees it (only the owner can invite), and 'Not now' hides it without claiming anything", () => {
    expect(code).toMatch(/\{isOwner && !accountantDismissed \? renderStep\(optional\) : null\}/);
    expect(code).toMatch(/e\.stopPropagation\(\); dismissAccountantStep\(\);/);
  });
});
