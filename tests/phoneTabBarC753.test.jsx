// ★ C753 — THE PHONE: THE PAGE NO LONGER SLIDES SIDEWAYS, AND THE OWNER'S MAIN PLACES ARE A TAB BAR
// AT THE BOTTOM. (Operator's iPhone screenshots, 2026-11-19: the top bar was wider than the screen,
// so every page could be pushed sideways and was cut off at both edges.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";
import NavIcon, { NAV_ICON_IDS } from "../src/components/NavIcon.jsx";
import CompanySwitcher from "../src/components/CompanySwitcher.jsx";
import { CLIENT_NAV_SECTIONS, PREVIEW_AS_OWNER_ENTER_SHORT, PREVIEW_AS_OWNER_EXIT_SHORT, PREVIEW_AS_OWNER_EXIT_LABEL } from "../src/lib/nav.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import SettingsView from "../src/components/views/SettingsView.jsx";

const css = readFileSync("src/styles.css", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const block = css.slice(css.indexOf("C753 — A PHONE THAT DOESN'T SLIDE SIDEWAYS"), css.indexOf("@media (max-width: 420px)"));
// (C756 rebuilt the tab bar as its own layer — components/OwnerTabBar.jsx — and these tests follow it.)

describe("C753 — nothing may widen the page on a phone", () => {
  it("★★ html and body never scroll sideways at phone width", () => {
    expect(block).toMatch(/@media \(max-width: 760px\) \{\s*html, body \{ overflow-x: hidden; max-width: 100%; \}/);
  });
  it("★★ the business name is one line, cut with '…', and may shrink", () => {
    const h = renderToString(<CompanySwitcher companies={[]} currentCompany={{ id: "c", name: "Franklin Ave Pizza LLC" }} onSwitch={() => {}} onNew={() => {}} />);
    expect(h).toMatch(/class="sc-company-name"[^>]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
    expect(h).toContain('title="Franklin Ave Pizza LLC"');
    expect(block).toMatch(/\.sc-topbar-right > \.sc-company \{ flex: 0 1 auto; min-width: 0; \}/);   // C756 — the name takes the room that's left
    expect(app).toMatch(/className="sc-topbar-right" style=\{\{ display:"flex", alignItems:"center", gap:14, minWidth:0 \}\}/);
  });
  it("★★ Sign out leaves the top bar on a phone — and is in Settings instead", () => {
    expect(app).toMatch(/<button className="sc-hide-narrow" onClick=\{onSignOut\}/);
    const h = renderViewHtml(SettingsView, { onSignOut: () => {}, session: { user: { email: "owner@example.com" } } });
    expect(h).toContain("data-settings-account");
    expect(h).toMatch(/Signed in as <b[^>]*>owner@example\.com<\/b>/);
    expect(h).toMatch(/>Sign out<\/button>/);
  });
  it("★ the preview toggle has a short label on a phone", () => {
    expect(PREVIEW_AS_OWNER_ENTER_SHORT.length).toBeLessThan(12);
    expect(PREVIEW_AS_OWNER_EXIT_SHORT.length).toBeLessThan(PREVIEW_AS_OWNER_EXIT_LABEL.length);
    expect(app).toMatch(/<span className="sc-show-narrow">\{previewAsOwner \? PREVIEW_AS_OWNER_EXIT_SHORT : PREVIEW_AS_OWNER_ENTER_SHORT\}<\/span>/);
  });
});

describe("C753 — the owner's tab bar", () => {
  const main = CLIENT_NAV_SECTIONS.find((s) => s.id === "main").items.map(([id]) => id);
  it("★★ every main place has an icon (and only those)", () => {
    expect([...NAV_ICON_IDS].sort()).toEqual([...main].sort());
    for (const id of main) expect(renderToString(<NavIcon id={id} />)).toMatch(/class="sc-navicon" aria-hidden="true"><svg/);
    expect(renderToString(<NavIcon id="settings" />)).toBe("");
  });
  it("★★ the owner's menu is marked for the tab bar; the accountant's is not", () => {
    expect(app).toContain('className={navSeat.isReviewerSeat ? "sc-sidenav" : "sc-sidenav sc-owner-nav"}');
    expect(app).toContain("data-navsec={section.id}");
    expect(app).toContain("{!navSeat.isReviewerSeat && <NavIcon id={id} />}");
  });
  it("★★★ C756 — at phone width the bar is its OWN layer, above the page; the menu's main rows are hidden there", () => {
    expect(block).toMatch(/\.sc-tabbar \{ display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 1050;/);
    expect(css).toMatch(/\.sc-tabbar \{ display: none; \}/);                     // not on a laptop
    expect(block).toMatch(/\.sc-owner-nav \[data-navsec="main"\], \.sc-owner-nav \[data-navsec="settings-entry"\] \{ display: none !important; \}/);
    expect(block).toMatch(/\.sc-tabbar \.sc-navicon \{ display: flex; \}/);
    expect(css).toMatch(/\.sc-navicon \{ display: none; \}/);                   // a laptop's menu stays words only
    expect(block).toMatch(/env\(safe-area-inset-bottom\)/);                        // clear of the iPhone's home bar
  });
  it("★★ the page leaves room above the bar", () => {
    expect(block).toMatch(/body:has\(\.sc-tabbar\) #main-content \.sc-page \{ padding-bottom: calc\(100px \+ env\(safe-area-inset-bottom\)\) !important; \}/);
  });
  it("★★ Ask is a tab, so the floating bubble steps aside — and the assistant can be closed from inside", () => {
    expect(block).toMatch(/body:has\(\.sc-tabbar\) \.sc-chat-fab \{ display: none !important; \}/);
    expect(block).toMatch(/\.sc-chat-panel \.sc-chat-close \{ display: flex !important;/);
    expect(app).toMatch(/<button className="sc-chat-close" onClick=\{\(\)=>setChatOpen\(false\)\} aria-label="Close the assistant"/);
    expect(app).toMatch(/<button className="sc-chat-fab"/);
  });
});

describe("C753 — Money's three cards on a phone", () => {
  it("★★ one row of three, the description and arrow dropped, the count in the corner", () => {
    expect(block).toMatch(/\.sc-page \[data-money-links\] \{ grid-template-columns: repeat\(3, 1fr\) !important;/);
    expect(block).toMatch(/\.sc-page \[data-money-links\] \.sc-mlink-sub, \.sc-page \[data-money-links\] \.sc-mlink-arrow \{ display: none !important; \}/);
    const mv = readFileSync("src/components/views/MoneyView.jsx", "utf8");
    for (const c of ["sc-mlink-sub", "sc-mlink-text", "sc-mlink-arrow"]) expect(mv).toContain(`className="${c}"`);
  });
});
