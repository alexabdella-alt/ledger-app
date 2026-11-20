// ★ C762 — NO PICTURE EMOJIS ON ANY SCREEN (operator, 2026-11-20: "cheesy … none of those look
// professional"). Icons are plain line drawings from components/Icon.jsx. Typography stays: arrows,
// ✓ ✕, and ✦ (the assistant's mark, which has no emoji form).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Icon, { ICON_NAMES, docIconName } from "../src/components/Icon.jsx";

const PICTURE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}\u{2B06}\u{2B07}\u{23F0}-\u{23FA}]/u;
const ALLOWED = new Set(["✓", "✕", "✗", "★", "☑", "☐", "✦"]);
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f.name)) files.push(p); } })("src");

describe("C762 — no picture emojis in the code that draws screens", () => {
  it("★★★ none outside comments, in any file under src/", () => {
    const hits = [];
    for (const f of files) fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("{/*")) return;
      for (const ch of line) if (PICTURE.test(ch) && !ALLOWED.has(ch)) hits.push(`${f}:${i + 1} ${ch}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("C762 — the icon set", () => {
  it("★★ every icon is a line drawing in the text colour; an unknown name draws nothing", () => {
    for (const n of ICON_NAMES) {
      const h = renderToStaticMarkup(<Icon name={n} />);
      expect(h).toMatch(new RegExp(`^<svg class="sc-icon" data-icon="${n}"[^>]*fill="none" stroke="currentColor"`));
    }
    expect(renderToStaticMarkup(<Icon name="nope" />)).toBe("");
  });
  it("★ a document's icon follows its type and file kind", () => {
    expect(docIconName("invoice")).toBe("receipt");
    expect(docIconName("bank_statement")).toBe("bank");
    expect(docIconName("payroll")).toBe("briefcase");
    expect(docIconName("contract")).toBe("clipboard");
    expect(docIconName("other", "image/jpeg")).toBe("image");
    expect(docIconName("other")).toBe("document");
  });
  it("★★ the icons the screens ask for all exist", () => {
    const used = new Set();
    for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(/<Icon name="([a-z]+)"/g)) used.add(m[1]);
    for (const f of ["src/lib/moneyPage.js", "src/lib/sourceDoc.js"]) for (const m of fs.readFileSync(f, "utf8").matchAll(/icon: "([a-z]+)"|RECEIPT_MARK = "([a-z]+)"/g)) used.add(m[1] || m[2]);
    expect([...used].filter((n) => !ICON_NAMES.includes(n))).toEqual([]);
  });
});
