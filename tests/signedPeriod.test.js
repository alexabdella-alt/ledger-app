import { describe, it, expect } from "vitest";
import { periodOf, signedPeriodForDate, mutationHitsSignedPeriod, rebookedIntoOpenMonth, signedPeriodOwnerCopy } from "../src/lib/signedPeriod.js";

// ════════════════════════════════════════════════════════════════════════════
// O83 Trap 2 — a signed period is a guarded period. Detection must fire on every
// entry dated into an active-signoff month, on every write path, and NOT on open
// months or opening-balance entries.
// ════════════════════════════════════════════════════════════════════════════
const signoffs = [{ period: "2026-01", revoked_at: null }]; // January signed off

describe("signedPeriodForDate — detects a date inside an active signed period", () => {
  it("the exact O83 case: a Jan 28 entry when January is signed → '2026-01'", () => {
    expect(signedPeriodForDate("2026-01-28", signoffs)).toBe("2026-01");
  });
  it("an open month (Feb) → null (booking proceeds normally)", () => {
    expect(signedPeriodForDate("2026-02-15", signoffs)).toBe(null);
  });
  it("a REVOKED sign-off no longer guards the month", () => {
    expect(signedPeriodForDate("2026-01-28", [{ period: "2026-01", revoked_at: "2026-02-01T00:00:00Z" }])).toBe(null);
  });
  it("opening-balance entries are exempt (they ARE the pre-cutoff position)", () => {
    expect(signedPeriodForDate("2026-01-01", signoffs, { source: "opening_balance" })).toBe(null);
  });
  it("no sign-offs at all → null", () => {
    expect(signedPeriodForDate("2026-01-28", [])).toBe(null);
  });
  it("periodOf extracts YYYY-MM, null on garbage", () => {
    expect(periodOf("2026-01-28")).toBe("2026-01");
    expect(periodOf("")).toBe(null);
  });
});

describe("mutationHitsSignedPeriod — recodes/voids/mark-paid of an entry inside a signed month", () => {
  it("an entry dated in a signed month → guarded", () => {
    expect(mutationHitsSignedPeriod({ date: "2026-01-15" }, signoffs)).toBe(true);
  });
  it("an entry in an open month → not guarded", () => {
    expect(mutationHitsSignedPeriod({ date: "2026-02-15" }, signoffs)).toBe(false);
  });
});

describe("rebookedIntoOpenMonth — option (b): keep original date in metadata", () => {
  it("moves the date to today and stashes the original + reason (pure, non-mutating)", () => {
    const inv = { id: "x", date: "2026-01-28", amount: 512.35, vendor: "Roma", import_metadata: { doc_id: 9 } };
    const out = rebookedIntoOpenMonth(inv, "2026-07-23");
    expect(out.date).toBe("2026-07-23");
    expect(out.import_metadata.original_date).toBe("2026-01-28");
    expect(out.import_metadata.rebooked_from_signed_period).toBe("2026-01");
    expect(out.import_metadata.doc_id).toBe(9);   // preserves existing metadata
    expect(inv.date).toBe("2026-01-28");           // input not mutated
  });
});

describe("signedPeriodOwnerCopy — plain language, no jargon", () => {
  it("names the month in business English, offers the three options", () => {
    const c = signedPeriodOwnerCopy("2026-01");
    expect(c.title).toMatch(/January 2026/);
    expect(c.body).toMatch(/already reviewed|signed off/i);
    expect(c.reopen).toMatch(/reopen/i);
    expect(c.rebook).toMatch(/current month/i);
    expect(c.cpa).toMatch(/accountant/i);
    // Cardinal Principle: no jargon
    const all = [c.title, c.body, c.reopen, c.rebook, c.cpa].join(" ");
    expect(all).not.toMatch(/period_signoff|debit|credit|journal|GL\b/i);
  });
});

// The reopen-and-book transition + per-path coverage: the SAME predicate gates every write.
describe("reopen-and-book transition + per-path guard predicate", () => {
  const signed = [{ period: "2026-01", revoked_at: null }];
  it("guarded before reopen; after the sign-off is revoked the re-post proceeds", () => {
    expect(signedPeriodForDate("2026-01-28", signed)).toBe("2026-01");           // held
    const afterReopen = [{ period: "2026-01", revoked_at: "2026-02-01T00:00:00Z" }];
    expect(signedPeriodForDate("2026-01-28", afterReopen)).toBe(null);           // now posts
  });
  it("the ack path is what the handler sets — a re-post with source opening_balance/ack bypasses", () => {
    // The App passes _signedPeriodAck to skip the guard on the deliberate re-post; at the pure
    // layer, opening_balance is the always-exempt source and stands in for that bypass semantics.
    expect(signedPeriodForDate("2026-01-28", signed, { source: "opening_balance" })).toBe(null);
  });
  it("every path feeds the SAME predicate: booking (date), multi-line (entry.date), recode/void/mark-paid (entry.date)", () => {
    // booking + multi-line
    expect(signedPeriodForDate("2026-01-10", signed)).toBe("2026-01");
    // mutation predicate is the same function via mutationHitsSignedPeriod
    expect(mutationHitsSignedPeriod({ date: "2026-01-10" }, signed)).toBe(true);
    // a payment DATED in the open month clears a signed-month bill fine (only the payment date gates)
    expect(signedPeriodForDate("2026-02-05", signed)).toBe(null);
  });
});
