import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// C585 — the signed-in app has a phone layout. These pin the hooks and the rules; what they
// LOOK like was checked in a browser at 375px against real screens rendered with sample data.
const css = readFileSync("src/styles.css", "utf8");
const app = readFileSync("src/App.jsx", "utf8");
const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
const block = narrow.slice(0, narrow.indexOf("\n}\n") + 3);

describe("C585 — a phone layout for the signed-in app", () => {
  it("every rule is inside the narrow-screen block — a laptop is untouched", () => {
    expect(block.length).toBeGreaterThan(800);
    // none of the phone selectors is styled anywhere OUTSIDE a media query
    const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    for (const sel of [".sc-sidenav", ".sc-shell-body", ".sc-page", ".sc-topbar", ".sc-hide-narrow", ".sc-chat-panel", ".sc-stack-row", ".sc-hide-tiny"]) {
      expect(outside, `${sel} is styled outside the narrow block`).not.toContain(sel);
    }
  });
  it("the side menu becomes one swipeable row and the page takes the full width", () => {
    expect(block).toMatch(/\.sc-shell-body \{ flex-direction: column !important; \}/);
    expect(block).toMatch(/\.sc-sidenav \{ width: 100% !important;[^}]*overflow-x: auto;/);
    expect(block).toMatch(/\.sc-sidenav \.sc-navtab \{ width: auto !important;[^}]*min-height: 44px !important;/);   // a thumb-sized target
    expect(block).toMatch(/\.sc-page \{ padding: 18px 14px 96px !important; \}/);
  });
  it("side-by-side columns stack (except ones that already adapt), and a wide table scrolls in its own box", () => {
    expect(block).toMatch(/\.sc-page \[style\*="grid-template-columns"\]:not\(\[style\*="auto-fit"\]\):not\(\[style\*="auto-fill"\]\) \{ grid-template-columns: 1fr !important; \}/);
    expect(block).toMatch(/\.sc-page table \{ display: block; max-width: 100%; overflow-x: auto;/);
  });
  it("form fields are 16px, so an iPhone does not zoom the page when one is tapped", () => {
    expect(block).toMatch(/\.sc-page input, \.sc-page select, \.sc-page textarea \{ font-size: 16px !important;/);
  });
  it("the app's frame carries the hooks those rules need", () => {
    expect(app).toMatch(/className="sc-topbar"/);
    expect(app).toMatch(/className="sc-shell-body"/);
    expect(app).toMatch(/<nav aria-label="Main" className="sc-sidenav"/);
    expect(app).toMatch(/className="sc-rise sc-page"/);
    expect(app).toMatch(/className="sc-chat-panel"/);
    expect((app.match(/className="sc-hide-narrow"/g) || []).length).toBe(2);   // the email and the word "Settings"
  });
  it("the screen you are on is kept in sight in the menu strip", () => {
    expect(app).toMatch(/document\.querySelector\("\.sc-sidenav \.sc-navtab\.active"\)\?\.scrollIntoView\(\{ block: "nearest", inline: "center" \}\)/);
  });
  it("Settings' bank accounts: the heading row hides when the columns stack, and each box names itself", () => {
    const s = readFileSync("src/components/views/SettingsView.jsx", "utf8");
    expect(s).toMatch(/<div className="sc-hide-narrow" style=\{\{display:"grid",gridTemplateColumns:"2fr 0\.9fr/);
    for (const label of ["Account name", "Account type", "Category", "Bank name", "Current balance on your statement"]) expect(s).toContain(`aria-label="${label}"`);
    expect(s).toMatch(/className="sc-stack-row"/);
  });
});
