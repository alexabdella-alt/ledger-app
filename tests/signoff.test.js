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

// ── C343 — O104's core promise: a report never sounds surer than the books ──────
import { reportAttestationLine } from "../src/lib/signoff.js";
import fs from "node:fs";
describe("reportAttestationLine — one honest line on every report", () => {
  const monthLabel = (p) => ({ "2026-07": "July 2026" }[p] || p);
  it("says plainly when nobody has reviewed anything", () => {
    expect(reportAttestationLine({})).toBe("No month has been signed off yet — these figures haven't been reviewed by anyone.");
  });
  it("names the month an accountant stood behind, and that later months are still open", () => {
    expect(reportAttestationLine({ reviewedThrough: "2026-07", monthLabel }))
      .toBe("Reviewed and signed off through July 2026. Later months are still being checked.");
  });
  it("★ a self-signed month says so — 'you signed it' and 'an accountant reviewed it' are different facts (C272)", () => {
    expect(reportAttestationLine({ reviewedThrough: "2026-07", selfSigned: true, monthLabel }))
      .toMatch(/^Signed off through July 2026 by you — no accountant has reviewed them\./);
  });
  it("the Reports screen renders it from the sign-off rows, on every report", () => {
    const src = fs.readFileSync(new URL("../src/components/views/ReportsView.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/reportAttestationLine\(\{ reviewedThrough, selfSigned: ownerTrust\?\.selfSigned, monthLabel \}\)/);
    // above the report-type pills, so it is on screen whichever report is open
    expect(src.indexOf("reportAttestationLine({")).toBeLessThan(src.indexOf('["pl","P&L"]'));
  });
});
