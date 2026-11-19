// ★ C757 — LESS CRAMMED ON A PHONE (operator's iPhone screenshots, 2026-11-19): what sits side by
// side on a laptop stacks on a phone; the assistant's text box is no longer under the tab bar.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { friendlyDocName } from "../src/components/views/DocsView.jsx";

const css = readFileSync("src/styles.css", "utf8");
const block = css.slice(css.indexOf("C757 — LESS CRAMMED ON A PHONE"), css.indexOf("@media (max-width: 420px)"));
const app = readFileSync("src/App.jsx", "utf8");
const read = (f) => readFileSync(f, "utf8");

describe("C757 — every rule is phone-only", () => {
  it("★★ the block is a 760px media query, and nothing here is styled for a laptop", () => {
    expect(block).toMatch(/^C757[^]*?\*\/\s*@media \(max-width: 760px\) \{/);
    const outside = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    for (const sel of [".sc-rowcard", ".sc-docgrid", ".sc-docthumb", ".sc-reporttabs", ".sc-reportdates", ".sc-chiprow", ".sc-chat-sub"]) expect(outside).not.toContain(sel);
  });
});

describe("C757 — headers stack instead of squeezing", () => {
  it("★★ the small spaced label above a title is hidden; titles are 24px", () => {
    expect(block).toMatch(/\.sc-page \[style\*="font-size: 10px"\]\[style\*="letter-spacing: 3px"\] \{ display: none !important; \}/);
    expect(block).toMatch(/\.sc-page h1 \{ font-size: 24px !important;/);
  });
  it("★★ a title row with a button/filters beside it wraps them underneath (only side-by-side rows)", () => {
    expect(block).toMatch(/\.sc-page div\[style\*="space-between"\]:has\(> div > h1\) \{ flex-wrap: wrap !important;/);
    expect(block).toMatch(/\.sc-page div\[style\*="space-between"\]:has\(> div > h1\) > div:first-child \{ flex: 1 1 100% !important;/);
  });
});

describe("C757 — Vendors and Customers cards", () => {
  it("★★ name across the top; figures and Edit on the line below", () => {
    for (const f of ["src/components/views/VendorsView.jsx", "src/components/views/CustomersView.jsx"]) {
      expect(read(f)).toContain('<div className="sc-rowcard" style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>');
      expect(read(f)).toContain('<div className="sc-rowcard-end" style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>');
    }
    expect(block).toMatch(/\.sc-rowcard-end \{ flex: 1 1 100% !important; padding-left: 56px; \}/);
    expect(block).toMatch(/\.sc-rowcard-end > button:first-of-type \{ margin-left: auto; \}/);
  });
});

describe("C757 — Documents", () => {
  it("★★ two to a row with a small preview; filter chips one swipeable row; date boxes on a laptop only", () => {
    const d = read("src/components/views/DocsView.jsx");
    for (const c of ["sc-docgrid", "sc-docthumb", "sc-docbody", "sc-docname", "sc-chiprow", "sc-docdates"]) expect(d).toContain(`className="${c}"`);
    expect(block).toMatch(/\.sc-docgrid \{ grid-template-columns: 1fr 1fr !important;/);
    expect(block).toMatch(/\.sc-docthumb \{ height: 88px !important; \}/);
    expect(block).toMatch(/\.sc-docdates \{ display: none !important; \}/);
    expect(block).toMatch(/\.sc-chiprow \{ flex-wrap: nowrap !important; overflow-x: auto;/);
  });
  it("★★ a phone camera's machine name reads 'Photo' (the real name stays on hover)", () => {
    expect(friendlyDocName({ name: "camera-batch-DED86AC4-7E73-4194-BF7D-2B97236B262C.jpg" })).toBe("Photo");
    expect(friendlyDocName({ name: "IMG_4512.HEIC" })).toBe("Photo");
    expect(friendlyDocName({ name: "PXL_20261119_101112.jpg" })).toBe("Photo");
    expect(friendlyDocName({ name: "image.jpg" })).toBe("Photo");
    expect(friendlyDocName({ name: "Home Depot receipt.jpg" })).toBe("Home Depot receipt.jpg");
    expect(friendlyDocName({ name: "statement-jan.pdf" })).toBe("statement-jan.pdf");
    expect(friendlyDocName({})).toBe("Untitled file");
    expect(read("src/components/views/DocsView.jsx")).toContain('title={doc.name}');
  });
});

describe("C757 — Reports", () => {
  it("★★ the report buttons are one swipeable row; the dates get their own line", () => {
    const r = read("src/components/views/ReportsView.jsx");
    expect(r).toContain('<div className="sc-reporttabs" style={{ display:"contents" }}>');   // a laptop is unchanged
    expect(r).toContain('<div className="sc-reportdates" style={{ display:"contents" }}>');
    expect(block).toMatch(/\.sc-reporttabs \{ display: flex !important; flex: 1 1 100%; flex-wrap: nowrap; overflow-x: auto;/);
    expect(block).toMatch(/\.sc-reportdates \{ display: flex !important; flex: 1 1 100%;/);
  });
});

describe("C757 — the assistant", () => {
  it("★★★ the tab bar steps aside while the assistant is open (it covered the text box)", () => {
    expect(block).toMatch(/body:has\(\.sc-chat-panel\) \.sc-tabbar \{ display: none !important; \}/);
  });
  it("★★ the close button is the LAST in the header (after History)", () => {
    const h = app.indexOf("setChatHistoryView(v=>!v)} title=\"Action history\"");
    const c = app.indexOf('className="sc-chat-close"');
    expect(h).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(h);
    expect(block).toMatch(/\.sc-chat-sub \{ white-space: nowrap;/);
  });
});
