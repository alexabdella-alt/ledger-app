// ★ C760 — HOME LEADS WITH "WE NEED … FROM YOU" (operator, 2026-11-19: "we need to be prompting the
// business owner, 'we need this'"), and the specific statements we need are asked for there.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { homeWaitingList, ownerNeedHeadline, waitingHeadline, WAIT } from "../src/lib/homeWaiting.js";
import { statementNeedsFrom } from "../src/components/views/MonthStatus.jsx";

const need = [{ tone: "you", text: "September – October 2026 — waiting for your Primary Checking statements. Drop them on Home." }];

describe("C760 — the owner's headline", () => {
  it("★★★ says what we need, and counts the for-your-information rows separately", () => {
    expect(ownerNeedHeadline([{ urgency: WAIT.NOW }, { urgency: WAIT.SOON }, { urgency: WAIT.INFO }])).toBe("We need 2 things from you · 1 more for your information");
    expect(ownerNeedHeadline([{ urgency: WAIT.STOPS }])).toBe("We need one thing from you");
    expect(ownerNeedHeadline([{ urgency: WAIT.INFO }])).toBe("1 thing for your information");
    expect(ownerNeedHeadline([])).toBeNull();
  });
  it("★★ Home uses it on the owner's seat; the accountant keeps theirs", () => {
    const d = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(d).toContain("{cockpit ? waitingHeadline(items) : ownerNeedHeadline(items)}</div>");
    expect(waitingHeadline([{ urgency: WAIT.NOW }])).toMatch(/waiting on you/);
  });
});

describe("C760 — the statements we need, asked for on Home", () => {
  it("★★★ one ask per line, each with Upload statement; the generic 'not matched in N days' steps aside", () => {
    const items = homeWaitingList({ statementNeeds: need, bankMatch: { overdue: true, days: 101 } });
    expect(items.map((i) => i.id)).toEqual(["statement_need:0"]);
    expect(items[0]).toMatchObject({ urgency: WAIT.NOW, text: need[0].text, actions: [{ kind: "upload", label: "Upload statement" }] });
  });
  it("★★ with nothing specific to ask, the generic line still shows", () => {
    expect(homeWaitingList({ statementNeeds: [], bankMatch: { overdue: true, days: 101 } }).map((i) => i.id)).toEqual(["bank_match"]);
  });
  it("★★ read from the same report as 'Your books' — nothing while loading or when the read failed", () => {
    const months = [{ period: "2026-10", status: "attention", locked: false, items: [{ kind: "no_statement", severity: "attention", text: "No Primary Checking statement for October 2026." }] }];
    expect(statementNeedsFrom({ report: [{ status: "attention", months }] }, new Date(2026, 10, 19)).map((l) => l.text))
      .toEqual(["October 2026 — waiting for your Primary Checking statement. Drop it on Home."]);
    expect(statementNeedsFrom({ loading: true })).toEqual([]);
    expect(statementNeedsFrom({ loading: false, failed: ["x"] })).toEqual([]);
  });
  it("★ the accountant's seat doesn't read it", () => {
    const d = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(d).toContain("const booksState = useCompletenessState(!cockpit);");
    expect(d).toContain("statementNeeds: cockpit ? [] : statementNeedsFrom(booksState),");
  });
});
