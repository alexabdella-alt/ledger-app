// ─────────────────────────────────────────────────────────────────────────────
// U5 / C377 — "HOW YOUR BUSINESS IS DOING" SAYS THE FOUR NUMBERS AN OWNER ASKS.
//
// "Monthly burn" and "Runway" are startup vocabulary; a restaurant owner asks how much
// cash there is, whether they made money, who owes them and what they owe. The block also
// said "Spending is up 804% versus last month" over two entries against one — a partial
// month is not a trend. `facts` keeps the burn/runway pair for the monthly report and the
// drills; Home renders `ownerFacts`, in plain words, with the balances GL-derived.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { businessHealth } from "../src/lib/reports.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";

const exp = (amount, date, id) => ({ id, vendor: "V", amount, date, gl_code: "6100", gl_name: "Rent", secondary_gl_code: "1000", type: "expense", status: "booked", debit_credit: "debit" });
const NOW = new Date("2026-09-14T12:00:00");

describe("ownerFacts", () => {
  it("cash · profit-or-loss this year · owed to you · you owe — and no burn or runway", () => {
    const bh = businessHealth([exp(100, "2026-08-01", 1)], { cash: 5000, now: NOW, owedToYou: 1200, youOwe: 800 });
    expect(bh.ownerFacts.map((f) => f.label)).toEqual(["Cash on hand", "Loss this year", "Owed to you", "You owe"]);
    expect(bh.ownerFacts.map((f) => f.key)).toEqual(["cash", "profit", "ar", "ap"]);
    for (const f of bh.ownerFacts) expect([f.label, containsOwnerJargon(f.label)]).toEqual([f.label, false]);
    // the report's own row is untouched
    expect(bh.facts.map((f) => f.key)).toEqual(["cash", "burn", "runway", "profit"]);
  });
  it("a balance we were not handed is omitted, never guessed (C309)", () => {
    const bh = businessHealth([], { cash: 0, now: NOW });
    expect(bh.ownerFacts.map((f) => f.key)).toEqual(["cash", "profit"]);
  });
  it("every headline and concern passes the jargon bar", () => {
    const loss = businessHealth([exp(9000, "2026-08-01", 1), exp(9000, "2026-07-01", 2), exp(9000, "2026-06-01", 3)], { cash: 9000, now: NOW });
    const ok = businessHealth([{ ...exp(100, "2026-08-01", 1), gl_code: "4000", type: "revenue", debit_credit: "credit" }], { cash: 50000, now: NOW });
    for (const h of [loss, ok]) {
      expect([h.headline, containsOwnerJargon(h.headline)]).toEqual([h.headline, false]);
      for (const c of h.concerns) expect([c.text, containsOwnerJargon(c.text)]).toEqual([c.text, false]);
    }
    expect(loss.headline).not.toMatch(/runway|burn/i);
    expect(ok.headline).not.toMatch(/runway|burn/i);
  });
});

describe("the month-over-month spend trend", () => {
  it("compares the last two COMPLETE months — the current partial month is never the numerator", () => {
    // two full months flat, then a big partial current month: no trend line
    const led = [exp(1000, "2026-07-05", 1), exp(1000, "2026-08-05", 2), exp(8000, "2026-09-05", 3)];
    expect(businessHealth(led, { cash: 100000, now: NOW }).concerns.find((c) => c.key === "burn")).toBeUndefined();
    // two full months, second up 50%: the trend fires
    const up = [exp(1000, "2026-07-05", 1), exp(1500, "2026-08-05", 2)];
    expect(businessHealth(up, { cash: 100000, now: NOW }).concerns.find((c) => c.key === "burn")?.text).toBe("Spending is up 50% versus last month.");
  });
  it("★ C385 — 'last month' is the calendar month before, not the last month with data", () => {
    // June 1,000 · July empty · August 1,500 (now = Sept): July is the month before August
    // and it has nothing in it, so there is no trend — NOT "up 50% versus last month" against June.
    const gap = [exp(1000, "2026-06-05", 1), exp(1500, "2026-08-05", 2)];
    expect(businessHealth(gap, { cash: 100000, now: NOW }).concerns.find((c) => c.key === "burn")).toBeUndefined();
    // and the year boundary: Dec 1,000 → Jan 1,500 is adjacent
    const yr = [exp(1000, "2025-12-05", 1), exp(1500, "2026-01-05", 2)];
    expect(businessHealth(yr, { cash: 100000, now: NOW }).concerns.find((c) => c.key === "burn")?.text).toBe("Spending is up 50% versus last month.");
  });
  it("a prior month under $250 is not a baseline", () => {
    const led = [exp(20, "2026-07-05", 1), exp(180, "2026-08-05", 2)];
    expect(businessHealth(led, { cash: 100000, now: NOW }).concerns.find((c) => c.key === "burn")).toBeUndefined();
  });
});

describe("Home renders the owner's numbers", () => {
  it("the four labels are on screen and the startup words are not", () => {
    const html = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"] }).replace(/<!-- -->/g, "");
    expect(html).toContain("Cash on hand");
    expect(html).toMatch(/Profit this year|Loss this year/);
    expect(html).toContain("Owed to you");
    expect(html).toContain("You owe");
    expect(html).not.toContain("Monthly burn");
    expect(html).not.toMatch(/>Runway</);
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(src).toMatch(/bh\.ownerFacts\.map/);
    expect(src).toMatch(/owedToYou: getAccountByRole\?\.\("accounts_receivable"\)\?\.code \? glAccountBalance\(/);
  });
});
