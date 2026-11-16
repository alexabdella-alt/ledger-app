// ★ C731 — the accountant's Home is the owner's shape (operator, 2026-11-15: "we need to make it easy
// for the accountant too"). Two new pieces: what's changed since they last looked, and the
// cash-below-zero line moved from the dropped health block onto the waiting list.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { markNewSince, sinceLastLookedHeader } from "../src/lib/sinceLastLooked.js";
import { homeWaitingList, WAIT } from "../src/lib/homeWaiting.js";

const items = [
  { ts: "2026-11-15T10:00:00Z", text: "Paid Sysco" },
  { ts: "2026-11-14T09:00:00Z", text: "Hill Country — Food" },
  { ts: "2026-11-01", text: "older" },
  { ts: "", text: "no time" },
];

describe("what's changed since you last looked", () => {
  it("marks only the rows after the last visit, and counts them", () => {
    const r = markNewSince(items, "2026-11-14T12:00:00Z");
    expect(r.items.map((i) => i.isNew)).toEqual([true, false, false, false]);
    expect(r.newCount).toBe(1);
    expect(r.firstVisit).toBe(false);
    expect(sinceLastLookedHeader(r)).toBe("1 new since you last looked");
  });
  it("a row exactly at the last visit is not new", () => {
    expect(markNewSince(items, "2026-11-15T10:00:00Z").newCount).toBe(0);
  });
  it("★ no last visit (first time, private window, storage blocked) marks nothing and never claims 'nothing new'", () => {
    for (const seen of [null, "", "garbage"]) {
      const r = markNewSince(items, seen);
      expect(r.newCount).toBe(0);
      expect(r.firstVisit).toBe(true);
      expect(sinceLastLookedHeader(r)).toBe("Latest changes");
    }
  });
  it("nothing after the last visit says so", () => {
    expect(sinceLastLookedHeader(markNewSince(items, "2026-11-16T00:00:00Z"))).toBe("Nothing new since you last looked");
  });
  it("the Home reads and stamps the last visit per company, and every new row shows even past the first 10", () => {
    const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).toMatch(/const seenKey = cockpit && currentCompany\?\.id \? `sc\.homeSeen\.\$\{currentCompany\.id\}` : null;/);
    expect(src).toMatch(/try \{ prev = window\.localStorage\.getItem\(seenKey\); \} catch/);
    expect(src).toMatch(/const shown = since\.items\.slice\(0, Math\.max\(feedCount, since\.newCount\)\);/);
  });
});

describe("cash below zero in the books — on the waiting list now", () => {
  it("is a SOON item with the statement first and starting balances second", () => {
    const [it0] = homeWaitingList({ cashBelowZero: -540.25 });
    expect(it0.id).toBe("cash_below_zero");
    expect(it0.urgency).toBe(WAIT.SOON);
    expect(it0.text).toContain("in cash (-$540.25)");   // signed — fmtMoney drops the minus
    expect(it0.actions.map((a) => [a.kind, a.label])).toEqual([["upload", "Upload statement"], ["nav", "Check starting balances"]]);
    expect(it0.actions[1].view).toBe("opening-balances");
  });
  it("absent at zero, above zero, or unknown", () => {
    for (const v of [0, 100, null, undefined]) expect(homeWaitingList({ cashBelowZero: v }).some((i) => i.id === "cash_below_zero")).toBe(false);
  });
  it("Home passes the books' cash only once the data has loaded (not a flash of 'less than nothing')", () => {
    const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).toMatch(/cashBelowZero: companyDataLoaded && Number\(glCash\) < -0\.005 \? Number\(glCash\) : null/);
  });
});
