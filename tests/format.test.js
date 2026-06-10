import { describe, it, expect } from "vitest";
import { fmtDate } from "../src/lib/format.js";

// ── Item 7: date formatting ────────────────────────────────────────────────
describe("fmtDate", () => {
  it("formats a YYYY-MM-DD string without timezone drift", () => {
    // Parsed at noon local so it never rolls back a day across time zones.
    expect(fmtDate("2026-03-05")).toBe("Mar 5, 2026");
    expect(fmtDate("2026-12-31")).toBe("Dec 31, 2026");
    expect(fmtDate("2026-01-01")).toBe("Jan 1, 2026");
  });

  it("formats a Date object", () => {
    expect(fmtDate(new Date(2026, 6, 4))).toBe("Jul 4, 2026"); // month is 0-indexed
  });

  it("returns empty string for null/empty input", () => {
    expect(fmtDate(null)).toBe("");
    expect(fmtDate("")).toBe("");
    expect(fmtDate(undefined)).toBe("");
  });

  it("falls back to the raw value for unparseable input", () => {
    expect(fmtDate("not-a-date")).toBe("not-a-date");
  });

  it("respects custom Intl options", () => {
    expect(fmtDate("2026-03-05", { month: "long", year: "numeric" })).toBe("March 2026");
  });
});
