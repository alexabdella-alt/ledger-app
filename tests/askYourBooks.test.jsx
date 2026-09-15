// U6 / C380 — the chat is where you talk to your books; one line on Home opens the same
// chat with what you typed, through the prefill channel Reports already uses (C297).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { containsOwnerJargon } from "../src/lib/clarify.js";

describe("Ask your books", () => {
  it("is on Home, above the waiting list, and its placeholder passes the jargon bar", () => {
    const html = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"] });
    const ask = html.indexOf('aria-label="Ask about your books"');
    expect(ask).toBeGreaterThan(0);
    expect(ask).toBeLessThan(html.indexOf('id="waiting-on-you"') > 0 ? html.indexOf('id="waiting-on-you"') : Infinity);
    const ph = html.match(/placeholder="([^"]+)"/g).find((m) => m.includes("Ask about your books"));
    expect(ph && containsOwnerJargon(ph)).toBe(false);
  });
  it("submitting opens the chat with the typed text as the prefill (keyed on its own timestamp — C297)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(src).toMatch(/onSubmit=\{e => \{ e\.preventDefault\(\); const t = String\(askText \|\| ""\)\.trim\(\); setChatOpen\(true\); if \(t\) setChatPrefill\(\{ at: Date\.now\(\), text: t \}\); setAskText\(""\); \}\}/);
  });
});
