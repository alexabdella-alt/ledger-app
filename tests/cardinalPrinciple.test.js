import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { draftClientQuestion, describeBooking, clarificationChips, plainCategoryPhrase, containsOwnerJargon } from "../src/lib/clarify.js";
import { ownerTrustState } from "../src/lib/ownerTrust.js";

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

// ════════════════════════════════════════════════════════════════════════════
// Guard EXTENSION (this pass): the leak that got through — clarification ANSWER
// OPTIONS / CHIPS and AUTO-BOOKING CONFIRMATION strings — the previous guard only
// scanned question stems. These are the owner-facing strings the redesign produces,
// so they must be jargon- and GL-code-free for EVERY account, not just a sample.
// ════════════════════════════════════════════════════════════════════════════
describe("Cardinal Principle — auto-booking confirmations + answer chips are jargon-free", () => {
  // A fixture spanning every default expense account + revenue + meals + a renumbered
  // account + a genuinely-unknown one (the phrase must still be plain).
  const FIXTURE = [
    { vendor: "Bella Vita Catering", amount: 477.38, gl_code: "6400", gl_name: "Travel & Entertainment" },
    { vendor: "WeWork", amount: 3200, gl_code: "6100", gl_name: "Rent & Occupancy" },
    { vendor: "AWS", amount: 812.5, gl_code: "6500", gl_name: "Technology & Software" },
    { vendor: "The Hartford", amount: 1400, gl_code: "6700", gl_name: "Insurance" },
    { vendor: "Comcast", amount: 210, gl_code: "6200", gl_name: "Utilities" },
    { vendor: "Staples", amount: 96, gl_code: "6600", gl_name: "Office Supplies" },
    { vendor: "A Lawyer LLP", amount: 2500, gl_code: "6800", gl_name: "Professional Services" },
    { vendor: "Meta Ads", amount: 640, gl_code: "6300", gl_name: "Marketing & Advertising" },
    { vendor: "Payroll Co", amount: 9000, gl_code: "6000", gl_name: "Salaries & Wages" },
    { vendor: "A Customer", amount: 5000, gl_code: "4000", gl_name: "Service Revenue", type: "revenue" },
    { vendor: "Renamed Vendor", amount: 300, gl_code: "9123", gl_name: "Software Subscriptions" },
    { vendor: "Mystery Vendor", amount: 88, gl_code: "7100", gl_name: "Miscellaneous" },
  ];

  it.each(FIXTURE.map((f, i) => [i, f]))("auto-booking confirmation #%i is plain, no jargon / GL code", (_i, inv) => {
    const s = describeBooking(inv);
    expect(s, `confirmation leaked jargon: "${s}"`).not.toMatch(JARGON);
    expect(s, `confirmation leaked a GL code: "${s}"`).not.toMatch(GL_CODE);
    expect(containsOwnerJargon(s), `containsOwnerJargon flagged: "${s}"`).toBe(false);
  });

  it.each(FIXTURE.map((f, i) => [i, f]))("answer chips for #%i carry no jargon / account name / GL code", (_i, inv) => {
    for (const chip of clarificationChips({ ...inv, confidence: 80 })) {
      expect(chip.label, `chip leaked jargon: "${chip.label}"`).not.toMatch(JARGON);
      expect(chip.label, `chip leaked a GL code: "${chip.label}"`).not.toMatch(GL_CODE);
      // A chip must never be the formal account LABEL (e.g. "Travel & Entertainment") — plain
      // phrases that happen to coincide with an account name ("insurance") are fine; the tell
      // of a leaked account name is the "&" conjunction or the verbatim label.
      expect(chip.label, `chip is the formal account label: "${chip.label}"`).not.toContain("&");
      expect(chip.label, `chip echoed the verbatim account name: "${chip.label}"`).not.toBe(String(inv.gl_name));
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Guard EXTENSION (O90): the OWNER TRUST PANEL strings. This is the owner's
// primary trust surface, so its projection of the CPA's data must stay plain —
// no GL codes, no confidence %, and (specific to this panel's inputs) no
// "control total / reconcile / trial balance" jargon leaking from the underlying
// control-total labels. Scans every string across every trust state.
// ════════════════════════════════════════════════════════════════════════════
describe("Cardinal Principle — O90 owner trust panel strings are jargon-free", () => {
  const NOW = new Date("2026-06-15T12:00:00");
  const recorded = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, status: "recorded", received_at: "2026-06-10T09:00:00" }));
  const OWNER_TERMS = /\bcontrol total|\breconcil|\btrial balance\b|\bconfidence\b|\bdebit\b|\bcredit\b|\bpayable\b|\breceivable\b|\bledger\b|journal entr/i;

  // Every owner-facing trust state, including ones fed jargon-y control-total labels
  // (the owner line must NOT echo them).
  const STATES = [
    { controlTotals: { failed: [], allTie: true }, openConfidenceFlags: [], intakeRows: recorded(3), unknownDocs: [], reviewedThrough: "2026-05", now: NOW },
    { controlTotals: { failed: [], allTie: true }, openConfidenceFlags: [{ id: "f", amount: 2400, confidence: 55 }], intakeRows: recorded(1), unknownDocs: [], reviewedThrough: null, now: NOW },
    { controlTotals: { failed: [{ id: "ar_tie", label: "Money owed to you (receivables)" }, { id: "tb", label: "Books balance (every entry has two equal sides)" }], allTie: false }, openConfidenceFlags: [], intakeRows: recorded(1), unknownDocs: [], reviewedThrough: "2026-04", now: NOW },
    { controlTotals: { failed: [], allTie: true }, openConfidenceFlags: [], intakeRows: [...recorded(1), { id: "d", status: "failed", filename: "x.pdf", received_at: "2026-06-01T09:00:00" }], unknownDocs: [], reviewedThrough: null, now: NOW },
    { controlTotals: { failed: [], allTie: true }, openConfidenceFlags: [], intakeRows: [], unknownDocs: [], reviewedThrough: null, now: NOW },
  ];

  it.each(STATES.map((s, i) => [i, s]))("trust state #%i — headline + all 3 lines + nudge are plain", (_i, input) => {
    const s = ownerTrustState(input);
    const strings = [s.headline, s.lines.captured.text, s.lines.reviewed.text, s.lines.correct.text, s.nudge?.text].filter(Boolean);
    for (const str of strings) {
      expect(str, `O90 string leaked jargon: "${str}"`).not.toMatch(JARGON);
      expect(str, `O90 string leaked owner-forbidden term: "${str}"`).not.toMatch(OWNER_TERMS);
      expect(str, `O90 string leaked a confidence %: "${str}"`).not.toMatch(/\d+\s*%/);
      // GL-code check via the year-aware owner lint (a 4-digit YEAR in the reviewed line is fine).
      expect(containsOwnerJargon(str), `O90 string leaked jargon / GL code: "${str}"`).toBe(false);
    }
  });
});
