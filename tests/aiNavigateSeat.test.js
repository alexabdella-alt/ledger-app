import { describe, it, expect } from "vitest";
import fs from "fs";
import { viewLabel, ALL_VIEW_IDS, CLIENT_VIEW_IDS, NAV_SECTIONS } from "../src/lib/nav.js";

// ═════════════════════════════════════════════════════════════════════════════
// C382 — THE CHAT'S "NAVIGATE" ACTION ASKS THE SEAT BEFORE IT OPENS A SCREEN.
// "Reconcile my bank" from an owner produced navigate:recon → setView("recon") →
// "Opened recon" in the reply → the route guard bounced them Home with "your accountant
// looks after that part". The chat claimed a door it had just been refused, and leaked a
// route id doing it. C381's bell, one surface over.
// ═════════════════════════════════════════════════════════════════════════════
const app = fs.readFileSync("src/App.jsx", "utf8");
const start = app.indexOf('if (action.type === "navigate" && action.view) {');
const block = app.slice(start, app.indexOf('if (action.type === "add_account")', start));

describe("★★ the navigate action is seat-gated (structure)", () => {
  it("finds the block (anti-vacuity)", () => { expect(block.length).toBeGreaterThan(500); expect(block).toContain("viewAliases"); });
  it("consults canSeeView with the live seat BEFORE any setView, and lands Home when refused", () => {
    const gate = block.indexOf("if (!canSeeView(target, seatOpts))");
    const first = block.indexOf("setView(");
    expect(gate).toBeGreaterThan(-1);
    expect(first).toBeGreaterThan(gate);
    expect(block.slice(gate, gate + 400)).toMatch(/setView\("home"\)/);
    expect(block).toMatch(/seatOpts = \{ role: userRole, isPlatformAdmin, previewAsOwner \}/);
  });
  it("the refusal names whose screen it is (existing) or says it could not find it (unknown) — never 'Opened'", () => {
    const refusal = block.slice(block.indexOf("if (!canSeeView(target, seatOpts))"), block.indexOf("} else {"));
    expect(refusal).toContain("GATED_VIEW_REDIRECT_COPY");
    expect(refusal).toContain("couldn't find a screen by that name");
    expect(refusal).not.toMatch(/Opened/);
  });
  it("the success sentence uses the sidebar's label, never the route id", () => {
    expect(block).toMatch(/Opened \$\{viewLabel\(target\)/);
    expect(block).not.toMatch(/Opened \$\{target\}/);
  });
});

describe("viewLabel reads the sidebar's own rows", () => {
  it("every nav row and every reviewer tool has a label; ids never leak", () => {
    for (const [id, label] of NAV_SECTIONS.flatMap((s) => s.items)) expect(viewLabel(id)).toBe(label);
    expect(viewLabel("recon")).toBe("Reconcile");
    expect(viewLabel("review")).toBe("Review");
    expect(viewLabel("coa")).toBe("Categories");
    expect(viewLabel("send-invoice")).toBe("Send Invoice");
    expect(viewLabel("nope")).toBeNull();
  });
  it("every view the router can render has a human name (a new view without one fails here)", () => {
    for (const id of ALL_VIEW_IDS) expect(viewLabel(id), id).toBeTruthy();
    for (const id of CLIENT_VIEW_IDS) expect(viewLabel(id), id).toBeTruthy();
  });
});
