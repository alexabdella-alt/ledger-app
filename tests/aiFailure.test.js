import { describe, it, expect } from "vitest";
import { classifyAIFailure, isDegradedMode, degradedBannerCopy, AI_FAILURE } from "../src/lib/aiFailure.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// WHEN THE AI CALL FAILS — SAY WHICH FAILURE IT WAS.
//
// Everything became one string: `AI service error (429 Too Many Requests): …`. Jargon on
// an owner surface, and it collapsed FOUR situations that need four different responses —
// one of which (out of credit) no amount of retrying will ever fix, and which the O84
// drive hit live with no in-app explanation at all.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★ our own rate limit reads as ours, with a real number", () => {
  const r = classifyAIFailure({ status: 429, body: { error: "Rate limit exceeded", blocked_bucket: "ai", resets_in_minutes: 22 } });

  it("names the wait, from the field the proxy already sends", () => {
    expect(r.kind).toBe(AI_FAILURE.OUR_LIMIT);
    expect(r.owner).toMatch(/our own hourly limit/);
    expect(r.owner).toMatch(/about 22 minutes/);
    expect(r.resetsInMinutes).toBe(22);
  });

  it("★ says nothing is lost, and does NOT ask them to retry", () => {
    // Before O113a a refused call still spent the budget, so retrying actively made it
    // worse and nothing on screen said so. The drain retries; the person should not.
    expect(r.owner).toMatch(/nothing to re-send/);
    expect(r.owner).not.toMatch(/try again/i);
    expect(r.retryable).toBe(true);
  });

  it("omits the time rather than inventing one when the field is absent", () => {
    const bare = classifyAIFailure({ status: 429, body: { error: "Rate limit exceeded" } });
    expect(bare.owner).not.toMatch(/about/);
    expect(bare.resetsInMinutes).toBe(null);
  });
});

describe("★★★ out of credit is NOT a rate limit — mistaking them is the costly error", () => {
  // One resolves itself within the hour. The other never resolves until somebody pays.
  const cases = [
    { status: 400, body: { error: { message: "Your credit balance is too low to access the API" } } },
    { status: 429, body: { error: "You exceeded your current quota, please check your plan and billing" } },
    { status: 402, body: { error: "payment required" } },
  ];

  it("recognised whatever status code it arrives under", () => {
    for (const c of cases) {
      const r = classifyAIFailure({ ...c, message: c.body.error?.message || c.body.error });
      expect(r.kind, JSON.stringify(c)).toBe(AI_FAILURE.OUT_OF_CREDIT);
    }
  });

  it("★★ marked NOT retryable — retrying forever would hide a thing only a human can fix", () => {
    const r = classifyAIFailure({ status: 400, message: "Your credit balance is too low" });
    expect(r.retryable).toBe(false);
    expect(r.waitingHelps).toBe(false);
  });

  it("★ the OWNER is told it's ours, and the OPERATOR is told what to do", () => {
    const r = classifyAIFailure({ status: 400, message: "credit balance is too low" });
    expect(r.owner).toMatch(/this is on us, not your file/);
    expect(r.owner).toMatch(/[Nn]othing has been lost/);
    expect(r.operator).toMatch(/out of credit/i);
    expect(r.operator).toMatch(/[Tt]op it up/);
    // The owner sentence must never mention credit, billing, or the provider.
    expect(r.owner).not.toMatch(/credit|billing|Anthropic|API|quota/i);
  });
});

describe("★ the other two", () => {
  it("an overloaded provider is transient and says so without blaming the file", () => {
    const r = classifyAIFailure({ status: 503, message: "overloaded" });
    expect(r.kind).toBe(AI_FAILURE.PROVIDER_BUSY);
    expect(r.retryable).toBe(true);
    expect(r.owner).toMatch(/nothing to re-send/);
  });

  it("a credentials failure is OURS and not retryable", () => {
    const r = classifyAIFailure({ status: 401 });
    expect(r.kind).toBe(AI_FAILURE.NOT_CONFIGURED);
    expect(r.retryable).toBe(false);
    expect(r.owner).toMatch(/on our side, not with your file/);
  });

  it("★★ an UNRECOGNISED failure is reported as unrecognised, not optimistically", () => {
    // Guessing "we'll keep trying" on something we cannot classify is how a document sits
    // in a retry loop forever — intakeDrain's doctrine, same direction.
    const r = classifyAIFailure({ status: 418, message: "something odd" });
    expect(r.kind).toBe(AI_FAILURE.UNKNOWN);
    expect(r.retryable).toBe(false);
    expect(r.owner).toMatch(/not sure why/);
    expect(r.owner).toMatch(/nothing has been lost/i);
  });
});

describe("★★ degraded mode is a claim about the FEATURE, not about one file", () => {
  it("only the two failures that actually stop document reading raise it", () => {
    expect(isDegradedMode(AI_FAILURE.OUT_OF_CREDIT)).toBe(true);
    expect(isDegradedMode(AI_FAILURE.NOT_CONFIGURED)).toBe(true);
    // A busy provider and our own hourly limit both clear on their own — announcing the
    // feature as down would be a false alarm, which is its own defect.
    expect(isDegradedMode(AI_FAILURE.PROVIDER_BUSY)).toBe(false);
    expect(isDegradedMode(AI_FAILURE.OUR_LIMIT)).toBe(false);
    expect(isDegradedMode(AI_FAILURE.UNKNOWN)).toBe(false);
    expect(degradedBannerCopy(AI_FAILURE.OUR_LIMIT)).toBe(null);
  });

  it("★ the banner says uploads still work — the O84 failure was silence, not the outage", () => {
    for (const k of [AI_FAILURE.OUT_OF_CREDIT, AI_FAILURE.NOT_CONFIGURED]) {
      const copy = degradedBannerCopy(k);
      expect(copy).toMatch(/paused/);
      expect(copy).toMatch(/You can still upload/);
      expect(copy).toMatch(/everything is saved/i);
    }
  });
});

describe("★ no owner-facing jargon in any of it", () => {
  it("every owner sentence passes the Cardinal-Principle lint", () => {
    const all = [429, 400, 401, 503, 418].map((status) =>
      classifyAIFailure({ status, message: status === 400 ? "credit balance is too low" : "x" }));
    for (const r of all) {
      expect(containsOwnerJargon(r.owner), r.owner).toBe(false);
      // and never the raw shape the old string exposed
      expect(r.owner).not.toMatch(/AI service error|\b\d{3} [A-Z]/);
    }
  });
});
