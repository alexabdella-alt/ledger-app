import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { draftClientQuestion } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// CARDINAL-PRINCIPLE GUARD (CR-25 / CR-26). The owner NEVER sees accounting
// machinery. This lints the owner-facing copy at the source:
//   • the GAAP clarification `explanation:` strings (shown to the owner while booking),
//   • the chat `actionSummary.push(...)` templates (the bot's replies after actions),
//   • the dashboard prompts.
// CPA/Review surfaces are exempt (the `reasoning:` field, ReviewView, AuditView) —
// those legitimately carry GAAP/GL detail and are NOT scanned.
// ════════════════════════════════════════════════════════════════════════════

const read = (rel) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

// Accounting jargon that must not reach the owner. Word-boundaried to avoid false hits.
const JARGON = /\bGAAP\b|\bASC\b|\bdebit\b|\bcredit(ed|s)?\b|journal entr|\bledger\b|deferred revenue|balance sheet|capitaliz|depreciat|amortiz|\baccru/i;
// A GL account code leaking into a template (a bare 4-digit code, or a `${…code}` interpolation).
const GL_CODE = /\b[1-8][0-9]{3}\b|\$\{[^}]*\bcode\b[^}]*\}/;

// Pull `explanation: `…`` template-literal values out of a source file.
function explanations(src) {
  return [...src.matchAll(/explanation:\s*`([^`]*)`/g)].map(m => m[1]);
}
// Pull the argument of every `actionSummary.push(`…`)` template literal.
function actionSummaries(src) {
  // Owner-facing chat summaries live in the main loop (actionSummary.push) AND in the
  // destructive-action executor behind the confirm gate (summary.push) — both must be
  // jargon-free (Cardinal Principle / CR-26).
  return [...src.matchAll(/(?:actionSummary|summary)\.push\(`([^`]*)`\)/g)].map(m => m[1]);
}

describe("Cardinal Principle — GAAP clarification explanations are jargon-free (CR-25)", () => {
  const app = read("src/App.jsx");
  const exps = explanations(app);
  it("finds the GAAP clarification explanations", () => {
    expect(exps.length).toBeGreaterThanOrEqual(5);   // deferred rev, capital, prepaid, leasehold, vehicle
  });
  it.each(exps.map((e, i) => [i, e]))("explanation #%i is plain business language, no jargon", (_i, text) => {
    expect(text, `owner-facing explanation leaked jargon: "${text}"`).not.toMatch(JARGON);
    expect(text, `owner-facing explanation leaked a GL code: "${text}"`).not.toMatch(GL_CODE);
  });
});

describe("Cardinal Principle — chat action summaries are jargon-free (CR-26)", () => {
  const app = read("src/App.jsx");
  const sums = actionSummaries(app);
  it("finds the action-summary templates", () => {
    expect(sums.length).toBeGreaterThan(10);
  });
  it.each(sums.map((s, i) => [i, s]))("summary #%i shows no GL code / debit-credit / journal jargon", (_i, text) => {
    expect(text, `chat summary leaked jargon: "${text}"`).not.toMatch(JARGON);
    expect(text, `chat summary leaked a GL code: "${text}"`).not.toMatch(GL_CODE);
    expect(text, `chat summary used "recoded"/"reversing entry": "${text}"`).not.toMatch(/recoded|reversing entry|voided entry/i);
  });
});

describe("Cardinal Principle — dashboard prompts avoid machinery", () => {
  it("the owner dashboard never says 'journal entries' / 'journal entry'", () => {
    const dash = read("src/components/views/DashboardView.jsx");
    // Only inspect rendered JSX text, not code comments.
    const stripped = dash.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\/[^\n]*/g, "");
    expect(stripped).not.toMatch(/journal entr/i);
  });
});

describe("Cardinal Principle — the clarification loop question stays plain (regression, ties clarify.js)", () => {
  it("draftClientQuestion output carries no accounting jargon", () => {
    const q = draftClientQuestion({ vendor: "Hartford", amount: 400, date: "2026-06-01", gl_code: "6800", gl_name: "Professional Services" });
    const text = `${q?.question || ""} ${q?.subtext || q?.detail || ""}`;
    expect(text).not.toMatch(JARGON);
    expect(text).not.toMatch(GL_CODE);
  });
});
