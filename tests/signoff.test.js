import { describe, it, expect } from "vitest";
import { latestReviewedThrough } from "../src/lib/signoff.js";

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
