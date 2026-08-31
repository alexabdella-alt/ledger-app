import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ")
  .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

const app = strip(readFileSync("src/App.jsx", "utf8"));
const composer = strip(readFileSync("src/components/ChatComposer.jsx", "utf8"));

describe("★★★ O107 cause 2 — typing no longer re-renders the whole application", () => {
  it("★★★ the chat text is NOT state on the root component any more", () => {
    // It was, and it was read in exactly ONE place while every view destructured it unused —
    // so every keystroke rebuilt the 407-key context and re-rendered every mounted view.
    expect(app).not.toMatch(/const \[chatInput, setChatInput\]/);
    expect(app).not.toMatch(/\bsetChatInput\b/);
  });

  it("★ and no view still asks the context for it", () => {
    for (const f of ["DashboardView", "ReportsView", "BankView", "ReviewView", "VendorsView"]) {
      const v = readFileSync(`src/components/views/${f}.jsx`, "utf8");
      expect(v).not.toMatch(/\bchatInput\b/);
    }
  });

  it("★★ the composer owns its own text", () => {
    expect(composer).toMatch(/const \[text, setText\] = React\.useState\(""\)/);
  });

  it("★★ the send handler TAKES the message rather than reading root state", () => {
    expect(app).toMatch(/const handleChatSend = async \(message\) =>/);
    expect(app).toMatch(/const msg = String\(message \|\| ""\)\.trim\(\);/);
  });
});

describe("★★ the things that still need to reach the box do it without costing a keystroke", () => {
  it("★ a Reports button pre-fills via a channel that changes on a CLICK, not per character", () => {
    const reports = strip(readFileSync("src/components/views/ReportsView.jsx", "utf8"));
    expect(reports).toMatch(/setChatPrefill\(\{ at: Date\.now\(\)/);
    expect(composer).toMatch(/prefill/);
  });

  it("★★ keyed on the prefill's own timestamp, so clicking the same button twice works", () => {
    // A plain string would be ignored the second time, which reads as the button being broken.
    expect(composer).toMatch(/\}, \[prefill\]\);/);
    expect(composer).toMatch(/at: |prefill\.text/);
  });

  it("★★ a company switch clears the box by REMOUNTING, not by reaching into it", () => {
    expect(app).toMatch(/key=\{currentCompany\?\.id \|\| "none"\}/);
  });

  it("★★★ and the box only clears when the send was ACCEPTED — otherwise typing is lost", () => {
    // handleChatSend returns false when it declines (already loading, empty after trim).
    expect(composer).toMatch(/if \(onSend && onSend\(msg\) === false\) return;/);
    expect(app).toMatch(/if \(!msg \|\| chatLoading\) return false;/);
  });
});
