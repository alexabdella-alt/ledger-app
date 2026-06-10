import { describe, it, expect } from "vitest";

// ── Item 9: rate limiting ──────────────────────────────────────────────────
// Mirrors the SQL bump_rate_limit (migration 021): atomically increment the
// current hour's counter and return the new value. The edge function compares
// that value against the limit AFTER incrementing — so request #limit is allowed
// (count === limit) and #limit+1 is rejected (count > limit).
function makeLimiter(limit) {
  const buckets = new Map(); // `${user}|${bucket}|${hour}` -> count
  const bump = (user, bucket, hour) => {
    const k = `${user}|${bucket}|${hour}`;
    const next = (buckets.get(k) || 0) + 1;
    buckets.set(k, next);
    return next;
  };
  // Returns true if the request is allowed.
  const allow = (user, bucket, hour) => bump(user, bucket, hour) <= limit;
  return { allow };
}

describe("bump_rate_limit semantics", () => {
  it("allows exactly `limit` requests per hour, then rejects (60 AI/hr)", () => {
    const { allow } = makeLimiter(60);
    for (let i = 1; i <= 60; i++) expect(allow("u1", "ai", "2026-06-09T10")).toBe(true);
    expect(allow("u1", "ai", "2026-06-09T10")).toBe(false); // #61 rejected
  });

  it("counts upload bucket separately (20 uploads/hr)", () => {
    const { allow } = makeLimiter(20);
    for (let i = 1; i <= 20; i++) expect(allow("u1", "upload", "2026-06-09T10")).toBe(true);
    expect(allow("u1", "upload", "2026-06-09T10")).toBe(false); // #21 rejected
  });

  it("resets in a new hour bucket", () => {
    const { allow } = makeLimiter(2);
    expect(allow("u1", "ai", "10")).toBe(true);
    expect(allow("u1", "ai", "10")).toBe(true);
    expect(allow("u1", "ai", "10")).toBe(false);
    expect(allow("u1", "ai", "11")).toBe(true); // next hour → fresh counter
  });

  it("isolates counters per user", () => {
    const { allow } = makeLimiter(1);
    expect(allow("u1", "ai", "10")).toBe(true);
    expect(allow("u1", "ai", "10")).toBe(false);
    expect(allow("u2", "ai", "10")).toBe(true); // different user unaffected
  });
});
