// ★ C749 — "Your months", seen live: five identical lines June → October. A run of adjacent months
// that say the same thing is one line; the range reads oldest – newest.
import { describe, it, expect } from "vitest";
import { ownerMonthLines, ownerMonthLine } from "../src/lib/completeness.js";

const m = (period, status, extra = {}) => ({ period, status, locked: false, items: [], ...extra });
describe("C749 — runs of months say it once", () => {
  it("★★★ five unchecked months in a row → one line, plural words", () => {
    const months = ["2026-10", "2026-09", "2026-08", "2026-07", "2026-06"].map((p) => m(p, "unchecked"));
    expect(ownerMonthLines([m("2026-11", "in_progress"), ...months])).toEqual([
      { tone: "progress", text: "November 2026 — in progress." },
      { tone: "you", text: "June – October 2026 — not checked against your bank yet. Drop those months' bank statements on Home." },
    ]);
  });
  it("★★ across a year: both years named", () => {
    expect(ownerMonthLines([m("2026-01", "complete"), m("2025-12", "complete")])).toEqual([
      { tone: "done", text: "December 2025 – January 2026 — complete. Every upload is in and it matches your bank." },
    ]);
  });
  it("★★ different words, a gap, or a single month stay separate", () => {
    const lines = ownerMonthLines([m("2026-10", "complete"), m("2026-09", "unchecked"), m("2026-07", "unchecked")]);
    expect(lines.map((l) => l.text.split(" — ")[0])).toEqual(["October 2026", "September 2026", "July 2026"]);
    expect(lines[1]).toEqual(ownerMonthLine(m("2026-09", "unchecked")));
  });
  it("★ a statement-late run names the account in the plural; the team's run says 'these months'", () => {
    const late = (p) => m(p, "problem", { items: [{ kind: "no_statement", severity: "problem", text: `No Chase statement for x.` }] });
    expect(ownerMonthLines([late("2026-10"), late("2026-09")])[0].text).toBe("September – October 2026 — waiting for your Chase statements. Drop them on Home.");
    expect(ownerMonthLines([m("2026-10", "attention"), m("2026-09", "attention")])[0].text).toBe("September – October 2026 — our team is finishing these months.");
  });
  it("months before the books start say nothing", () => {
    expect(ownerMonthLines([m("2026-06", "before")])).toEqual([]);
  });
});
