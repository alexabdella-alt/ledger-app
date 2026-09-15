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
    // C404 — `handleChatSend` is ASYNC, so a `=== false` check compared a Promise and never
    // fired; the box clears at once and is REFILLED when the promise resolves to false.
    expect(composer.replace(/\/\/[^\n]*/g, "")).toMatch(/const r = onSend\(msg\);\s*if \(r === false\) return;\s*setText\(""\);\s*Promise\.resolve\(r\)\.then\(\(ok\) => \{ if \(ok === false\) setText\(\(cur\) => cur \|\| msg\); \}\)/);
    expect(composer).not.toMatch(/onSend\(msg\) === false\) return;/);
    expect(app).toMatch(/if \(!msg \|\| chatLoading\) return false;/);
  });
});

// C404 — a prefill marked `send` is sent on arrival; a declined send keeps the text.
describe("★ Home's ask sends on arrival (C404)", () => {
  const composer = require("fs").readFileSync("src/components/ChatComposer.jsx", "utf8");
  it("the effect sends a `send` prefill and clears only when the chat accepted it", () => {
    expect(composer).toMatch(/if \(prefill\.send && !loading && onSend\) \{ deliver\(String\(prefill\.text\)\.trim\(\)\); return; \}/);
    // a declined send (or a plain prefill) still fills the box
    const eff = composer.slice(composer.indexOf("if (prefill.send"), composer.indexOf("}, [prefill]"));
    expect(eff).toMatch(/setText\(prefill\.text\);/);
  });
  it("Home marks its prefill `send: true`; Reports' analysis button does NOT (the person may edit it first)", () => {
    const home = require("fs").readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(home).toMatch(/setChatPrefill\(\{ at: Date\.now\(\), text: t, send: true \}\)/);
    const reports = require("fs").readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(reports).toMatch(/setChatPrefill\(\{ at: Date\.now\(\), text: `Give me a detai/);
    expect(reports).not.toMatch(/send: true/);
  });
});

// And the property itself, run: an async decline refills the box; an accepted send clears it.
describe("★★ the composer's box follows the chat's ASYNC verdict", () => {
  it("a send whose promise resolves false puts the text back", async () => {
    const React = await import("react");
    const { renderToString } = await import("react-dom/server");
    // The composer is a client component; the logic under test is `deliver`, which the
    // source guard above pins to the shape — this exercises the same shape as a pure function.
    const deliverLike = (onSend, setText, msg) => {
      const r = onSend(msg);
      if (r === false) return Promise.resolve();
      setText("");
      return Promise.resolve(r).then((ok) => { if (ok === false) setText((cur) => cur || msg); });
    };
    let box = "what did I spend on food?";
    const setText = (v) => { box = typeof v === "function" ? v(box) : v; };
    await deliverLike(async () => false, setText, box);
    expect(box).toBe("what did I spend on food?");
    await deliverLike(async () => true, setText, box);
    expect(box).toBe("");
    // a synchronous false leaves the text untouched and never clears
    box = "hello"; await deliverLike(() => false, setText, box); expect(box).toBe("hello");
  });
});

