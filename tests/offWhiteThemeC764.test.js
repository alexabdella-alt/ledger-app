// ★ C764 — THE ACCENT IS OFF-WHITE, NOT GOLD (operator, 2026-11-20: "cheesy and AI-like"). The token
// NAMES (--sc-gold*) are kept so no component changed; only values. Text on an accent fill must be the
// dark ink (--sc-on-accent) or a dark surface — never the light text colour (white on near-white).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const css = fs.readFileSync("src/styles.css", "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));

describe("C764 — the tokens", () => {
  it("★★★ the accent is off-white and the ink on it is dark", () => {
    expect(root).toMatch(/--sc-gold:\s+#ecebe7;/);
    expect(root).toMatch(/--sc-on-accent:\s+#10151b;/);
  });
  it("★★ no gold left anywhere in the styles, the app or the icons", () => {
    const gold = /e8b53d|f6cb5b|bf9226|e8c55b|232,\s*181,\s*61/i;
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|jsx|css|svg)$/.test(f.name)) files.push(p); } })("src");
    files.push("public/favicon.svg");
    expect(files.filter((f) => gold.test(fs.readFileSync(f, "utf8")))).toEqual([]);
  });
});

describe("C764 — nothing light-on-light", () => {
  it("★★★ a style block whose background is the accent never sets light text", () => {
    const bad = [];
    const files = [];
    (function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(js|jsx)$/.test(f.name)) files.push(p); } })("src");
    for (const f of files) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/\{([^{}]{0,1500})\}/g)) {
        const body = m[1];
        const bg = /background\s*:\s*(.+?)(?:,\s*(?=[a-zA-Z]+\s*:)|$)/s.exec(body);
        if (!bg || !/var\(--sc-(?:gold|accent)(?:-bright|-deep)?\)/.test(bg[1])) continue;
        const col = /(?<![-a-zA-Z])color\s*:\s*(.+?)(?:,\s*(?=[a-zA-Z]+\s*:)|$)/s.exec(body);
        if (!col) continue;
        // In a ternary, pair the colour branch with the background branch that holds the accent.
        const branches = (v) => { const q = v.indexOf("?"); if (q < 0) return null; const rest = v.slice(q + 1); const k = rest.lastIndexOf(":"); return [rest.slice(0, k), rest.slice(k + 1)]; };
        const bgB = branches(bg[1]), cB = branches(col[1]);
        let accentColour = col[1];
        if (bgB && cB) accentColour = /--sc-(?:gold|accent)/.test(bgB[0]) ? cB[0] : cB[1];
        if (/--sc-text(?!-mut)\b|#fff\b|#ffffff|"white"/.test(accentColour)) bad.push(`${f}: ${accentColour.trim().slice(0, 60)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
