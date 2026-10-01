import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { taxYearFor1099, getTaxDeadlines } from "../src/lib/tax";
import { plan1099Copy } from "../src/lib/form1099";

// ═════════════════════════════════════════════════════════════════════════════
// C549 — WHICH YEAR THE 1099 SURFACES ARE ABOUT.
//
// ★★★ THE LIVE FINDING (empty-company sweep, 2026-09-28). Three surfaces, three answers:
// the Taxes screen's 1099 card counted **2026** (`getFullYear()`), the bell counted **2026**
// (`deadline.year - 1`, C435), and the tracker screen the card's own button opens was headed
// **2025** (`getFullYear() - 1`, commented "always the previous calendar year").
//
// ★★ AND THE FAILURE IS THE ONE `TaxView` ALREADY NAMES AS THE DANGEROUS DIRECTION — A
// MISSING 1099, SILENTLY. The tracker is where you go to see who needs a form and to export
// the data. Pointed at a year in which a company that signed up this year made no payments at
// all, it reads "No vendor payments recorded for 2025 yet" from February to December while
// that year's reportable suppliers sit unlisted. Nothing on screen looks wrong; the list is
// simply of the wrong year.
//
// ★ THE EXPECTATIONS BELOW ARE HAND-COMPUTED FROM THE IRS CALENDAR, NOT RE-DERIVED FROM THE
// FUNCTION. Asserting `taxYearFor1099(d) === nextDeadline.year - 1` would be the ·3a shape —
// two sides of one implementation agreeing, which proves they agree and never that either is
// right.
// ═════════════════════════════════════════════════════════════════════════════

const on = (y, m, d) => new Date(y, m - 1, d);

describe("C549 — the 1099 year comes off the deadline, not off today's date", () => {
  // Forms for year Y are sent to recipients by 31 Jan Y+1 and filed by 28 Feb / 31 Mar Y+1.
  // So: through 31 Mar you are working on the year just ended; from 1 Apr, on the year you
  // are accruing toward.
  const CASES = [
    ["the live case — 2026-09-28, the day this was found", on(2026, 9, 28), 2026],
    ["mid-year: the year in progress", on(2026, 6, 30), 2026],
    ["December: the year about to close, not the one before it", on(2026, 12, 20), 2026],
    ["1 January: filing season — the year just ended", on(2027, 1, 1), 2026],
    ["31 January, the recipient deadline itself", on(2027, 1, 31), 2026],
    ["February, paper-filing window", on(2027, 2, 10), 2026],
    ["31 March, the e-filing deadline itself", on(2027, 3, 31), 2026],
    ["1 April — filing season over, back to the year in progress", on(2027, 4, 1), 2027],
  ];
  for (const [label, when, expected] of CASES) {
    it(label, () => expect(taxYearFor1099(when)).toBe(expected));
  }

  it("★★★ and it is NOT `getFullYear() - 1` — the exact wrong answer that shipped", () => {
    const when = on(2026, 9, 28);
    expect(taxYearFor1099(when)).not.toBe(when.getFullYear() - 1);   // 2025, the year the tracker showed
    expect(taxYearFor1099(when)).toBe(when.getFullYear());
  });

  it("★★ nor is it always `getFullYear()` — January must stay on the year being filed for", () => {
    const jan = on(2027, 1, 20);
    expect(taxYearFor1099(jan)).not.toBe(jan.getFullYear());
    expect(taxYearFor1099(jan)).toBe(2026);
  });

  it("every deadline of kind 1099 resolves to the SAME payment year, so the answer can't wobble mid-season", () => {
    // Feb 10 2027: the next 1099 deadline is 28 Feb, the one after is 31 Mar — both 2026's forms.
    const d = on(2027, 2, 10);
    const years = getTaxDeadlines(d).filter((x) => x.kind === "1099" && x.days <= 60).map((x) => x.year - 1);
    expect(years.length).toBeGreaterThan(1);
    expect(new Set(years).size).toBe(1);
    expect(years[0]).toBe(taxYearFor1099(d));
  });
});

describe("C549 — the card's sentence names the year instead of saying 'this year'", () => {
  const EMPTY = { eligible: [], needsInfo: [], outstanding: 0 };
  it("names it when given one", () => {
    expect(plan1099Copy(EMPTY, { year: 2026 })).toBe("No vendors look like they need a 1099 for 2026.");
  });
  it("keeps the old wording for a caller with no year to name", () => {
    expect(plan1099Copy(EMPTY)).toBe("No vendors look like they need a 1099 this year.");
  });
  it("★ 'this year' is wrong for three months of every year, which is why the year is passed", () => {
    // In January the card is about the year just ended; "this year" would name the wrong one.
    expect(taxYearFor1099(on(2027, 1, 20))).toBe(2026);
    expect(plan1099Copy(EMPTY, { year: taxYearFor1099(on(2027, 1, 20)) })).toMatch(/for 2026/);
  });
});

describe("C549 — the screens read the one year, so the card and the screen it opens agree", () => {
  const src = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  it("the tracker derives its year from the deadline", () => {
    const v = src("src/components/views/Tax1099View.jsx");
    expect(v).toMatch(/const taxYear = taxYearFor1099\(\)/);
    // the wrong answer must be GONE, not merely unused (the note ABOUT it may name it)
    expect(v).not.toMatch(/=\s*new Date\(\)\.getFullYear\(\)\s*-\s*1/);
  });
  it("★★ and the Taxes card counts the SAME year — not the calendar year the rest of that screen uses", () => {
    const v = src("src/components/views/TaxView.jsx");
    expect(v).toMatch(/const year1099 = taxYearFor1099\(\)/);
    expect(v).toMatch(/plan1099ForYear\(\{ invoices, contacts, chart: CHART_OF_ACCOUNTS, year: year1099, keyOf \}\)/);
    expect(v).toMatch(/plan1099Copy\(plan, \{ year: year1099 \}\)/);
    // the estimate and the deduction tracker stay on the calendar year — they are not 1099s
    expect(v).toMatch(/const year = new Date\(\)\.getFullYear\(\)/);
  });
});
