import { describe, it, expect } from "vitest";
import { latestReviewedThrough, isPeriodSignedOff } from "../src/lib/signoff.js";

describe("latestReviewedThrough — the newest attested period", () => {
  it("returns the max YYYY-MM (chronological = lexicographic)", () => {
    expect(latestReviewedThrough([{ period: "2026-03" }, { period: "2026-05" }, { period: "2026-04" }])).toBe("2026-05");
  });
  it("ignores malformed periods", () => {
    expect(latestReviewedThrough([{ period: "not-a-month" }, { period: "2026-01" }])).toBe("2026-01");
  });
  it("null when nothing signed off", () => {
    expect(latestReviewedThrough([])).toBe(null);
  });
});

describe("isPeriodSignedOff — the selected month's signed-vs-ready state (O83 card fix)", () => {
  const signoffs = [{ period: "2026-01", revoked_at: null }, { period: "2026-02", revoked_at: null }];
  it("signed month → true (card shows signed state only: no sign-off button, reopen visible)", () => {
    expect(isPeriodSignedOff(signoffs, "2026-01")).toBe(true);
  });
  it("unsigned month → false (normal ready/blocked gate behavior)", () => {
    expect(isPeriodSignedOff(signoffs, "2026-03")).toBe(false);
  });
  it("a revoked (reopened) sign-off does NOT count as signed", () => {
    expect(isPeriodSignedOff([{ period: "2026-01", revoked_at: "2026-02-01T00:00:00Z" }], "2026-01")).toBe(false);
  });
  it("empty / missing inputs → false", () => {
    expect(isPeriodSignedOff([], "2026-01")).toBe(false);
    expect(isPeriodSignedOff(signoffs, "")).toBe(false);
    expect(isPeriodSignedOff(undefined, "2026-01")).toBe(false);
  });
});
