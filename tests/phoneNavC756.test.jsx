// ★ C756 — THE PHONE, FROM THE OPERATOR'S IPHONE (2026-11-19): the tab bar was drawn UNDER the page
// (taps never reached it), a page felt like a dead end (no back), the top bar's buttons were uneven,
// and the assistant was a small box with a text field that zoomed the page.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToString } from "react-dom/server";

vi.mock("react-dom", async (orig) => ({ ...(await orig()), createPortal: (node) => node }));
const { default: OwnerTabBar } = await import("../src/components/OwnerTabBar.jsx");

const app = readFileSync("src/App.jsx", "utf8");
const css = readFileSync("src/styles.css", "utf8");
const ITEMS = [["home", "Home"], ["money", "Money"], ["tax", "Taxes"], ["reports", "Reports"], ["ask", "Ask"]];
const render = (props) => {
  globalThis.document = globalThis.document || { body: {} };
  return renderToString(<OwnerTabBar items={ITEMS} onGo={() => {}} {...props} />).replace(/<!-- -->/g, "");
};

describe("C756 — the tab bar is its own layer", () => {
  it("★★★ rendered into <body> (a portal), not inside the side menu's scrolling strip", () => {
    const bar = readFileSync("src/components/OwnerTabBar.jsx", "utf8");
    expect(bar).toMatch(/return createPortal\(\s*<nav aria-label="Main menu" className="sc-tabbar">/);
    expect(bar).toMatch(/document\.body,\s*\);/);
    expect(app).toContain("{!navSeat.isReviewerSeat && <OwnerTabBar items={mainItems} activeId={active} onGo={tabGo} badgeFor={badgeFor} chatOpen={chatOpen} />}");
  });
  it("★★ five tabs, icon over name; the page you're on is marked", () => {
    const h = render({ activeId: "money" });
    for (const [id, label] of ITEMS) { expect(h).toContain(`data-tab="${id}"`); expect(h).toContain(`>${label}</span>`); }
    expect((h.match(/class="sc-navicon"/g) || []).length).toBe(5);
    expect(h).toMatch(/data-tab="money" aria-current="page" class="sc-tab active"/);
    expect((h.match(/aria-current="page"/g) || []).length).toBe(1);
  });
  it("★★ with the assistant open, Ask is the marked tab", () => {
    const h = render({ activeId: "money", chatOpen: true });
    expect(h).toMatch(/data-tab="ask" aria-current="page" class="sc-tab active"/);
    expect(h).not.toMatch(/data-tab="money" aria-current/);
  });
  it("★ a count rides on its tab", () => {
    expect(render({ badgeFor: (id) => (id === "money" ? 4 : null) })).toMatch(/data-tab="money"[^]*?<span class="sc-tabbadge">4<\/span>/);
  });
  it("★★ Ask opens and closes the assistant; any other tab closes it and goes there", () => {
    expect(app).toContain('const tabGo = (id) => { if (id === "ask") { setChatOpen((o) => !o); return; } setChatOpen(false); go(id); };');
  });
  it("★★★ at phone width: fixed to the bottom, above the page, and the page leaves room for it", () => {
    expect(css).toMatch(/\.sc-tabbar \{ display: flex; position: fixed; left: 0; right: 0; bottom: 0; z-index: 1050; transform: translateZ\(0\);/);
    expect(css).toMatch(/body:has\(\.sc-tabbar\) #main-content \.sc-page \{ padding-bottom:/);
  });
});

describe("C756 — back works", () => {
  it("★★★ every page change is a step in the phone's history (not when the page is the same)", () => {
    const i = app.indexOf("const setView = (v) => {");
    const body = app.slice(i, app.indexOf("};", i));
    expect(body).toMatch(/if \(v !== viewRef\.current\) \{\s*try \{ window\.history\.pushState\(\{ scView: v \}, ""\);/);
  });
  it("★★★ going back restores the page and closes the assistant", () => {
    expect(app).toContain('window.addEventListener("popstate", onPop);');
    expect(app).toContain("if (!st.scChat) setChatOpen(false);");
    expect(app).toContain("if (st.scView && st.scView !== viewRef.current) { viewRef.current = st.scView; setViewRaw(st.scView); onViewChange?.(st.scView); }");
  });
  it("★★ opening the assistant is a step, so swipe-back closes it rather than leaving the page", () => {
    expect(app).toContain("if (chatOpen && !st.scChat) { window.history.pushState({ ...st, scView: viewRef.current, scChat: true }, \"\");");
    expect(app).toContain("else if (!chatOpen && st.scChat) window.history.back();");
  });
  it("★★ a page this seat can't see is REPLACED in history, so back never returns to it", () => {
    const i = app.indexOf("const to = navRedirect(view,");
    expect(app.slice(i, i + 400)).toContain('window.history.replaceState({ scView: to }, "")');
  });
  it("★★ a back button on a page that isn't a main tab (a home-screen app has no browser back)", () => {
    expect(app).toContain('{!(navSeat.isReviewerSeat ? ["home", "dashboard"] : ["home", "dashboard", "money", "tax", "reports"]).includes(view) && (');
    expect(app).toMatch(/className="sc-backbtn" aria-label="Back"/);
    expect(app).toContain('if (historyDepth.current > 0) window.history.back(); else setView(!navSeat.isReviewerSeat && MONEY_GROUP.includes(view) ? "money" : "home");');
    expect(css).toMatch(/\.sc-backbtn \{ display: none; \}/);
    expect(css).toMatch(/\.sc-backbtn \+ \.sc-logo \{ display: none !important; \}/);
  });
});

describe("C756 — the top bar and the screen height", () => {
  it("★★ one height: the business name, the icons and the toggle are all 40px", () => {
    expect(css).toMatch(/\.sc-company-btn \{ height: 40px;/);
    expect(css).toMatch(/\.sc-iconbtn \{ width: 40px !important; height: 40px !important;/);
    expect(css).toMatch(/\.sc-preview-toggle \{ height: 40px;/);
    expect((app.match(/className="sc-iconbtn"/g) || []).length).toBe(2);   // the bell and the gear
  });
  it("★★★ the app is the height of the VISIBLE screen (100vh hides the bottom behind Safari's toolbar)", () => {
    expect(app).toContain('<div className="sc-root" style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>');
    expect(css).toMatch(/\.sc-root \{ height: 100dvh !important; \}/);
  });
});

describe("C756 — the assistant on a phone", () => {
  it("★★★ fills the visible screen, above the tab bar, and follows the keyboard", () => {
    expect(css).toMatch(/\.sc-chat-panel \{ left: 0 !important; right: 0 !important; top: var\(--sc-vvtop, 0px\) !important;[^}]*height: var\(--sc-vvh, 100dvh\) !important;[^}]*z-index: 1100 !important;/);
    expect(app).toContain('root.style.setProperty("--sc-vvh", `${vv.height}px`)');
    expect(app).toContain('vv.addEventListener("resize", fit)');
  });
  it("★★ a 16px text box (smaller makes an iPhone zoom the page), and Send on the keyboard", () => {
    expect(css).toMatch(/\.sc-chat-input \{ font-size: 16px !important; \}/);
    const composer = readFileSync("src/components/ChatComposer.jsx", "utf8");
    expect(composer).toContain('className="sc-chat-input"');
    expect(composer).toContain('enterKeyHint="send"');
    expect(composer).toContain('aria-label="Send"');
  });
  it("★★ a real close button", () => {
    expect(css).toMatch(/\.sc-chat-panel \.sc-chat-close \{ display: flex !important; width: 36px !important; height: 36px !important;/);
  });
});
