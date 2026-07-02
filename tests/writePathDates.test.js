import { describe, it, expect, vi, afterEach } from "vitest";
import { todayLocal } from "../src/lib/format.js";

// ════════════════════════════════════════════════════════════════════════════
// F-1 (external review): write-path entry dates (reversal date, entry-date/
// in-service/extraction fallbacks, depreciation "due through today") must use
// LOCAL calendar components, not toISOString() (UTC). Otherwise an evening
// booking/void behind UTC on a month boundary lands in the NEXT period — and the
// voided month's P&L shows the un-netted original. This proves todayLocal() (now
// used on all those paths) keeps the date in the LOCAL month.
// ════════════════════════════════════════════════════════════════════════════

describe("F-1 — todayLocal() uses local components, not UTC", () => {
  afterEach(() => vi.restoreAllMocks());

  it("evening that's already NEXT MONTH in UTC stays in the LOCAL (original) month", () => {
    // A UTC-6 user at 2026-05-31 20:00 local == 2026-06-01 02:00 UTC.
    const fakeNow = {
      getFullYear: () => 2026, getMonth: () => 4 /* May, 0-based */, getDate: () => 31,
      toISOString: () => "2026-06-01T02:00:00.000Z",
    };
    vi.spyOn(global, "Date").mockImplementation(function () { return fakeNow; });

    expect(todayLocal()).toBe("2026-05-31");                              // local May → correct period
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-06-01");     // the OLD (buggy) UTC path
    expect(todayLocal()).not.toBe(new Date().toISOString().slice(0, 10)); // the fix changes the month
  });

  it("zero-pads month and day", () => {
    const fakeNow = { getFullYear: () => 2026, getMonth: () => 0 /* Jan */, getDate: () => 5, toISOString: () => "x" };
    vi.spyOn(global, "Date").mockImplementation(function () { return fakeNow; });
    expect(todayLocal()).toBe("2026-01-05");
  });
});
