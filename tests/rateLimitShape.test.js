import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { AI_CALLS_PER_DOCUMENT } from "../src/lib/aiBudget";

const PROXY = readFileSync(new URL("../supabase/functions/ai-proxy/index.ts", import.meta.url), "utf8");
const num = (name) => {
  const m = PROXY.match(new RegExp(`const ${name} = (\\d+)`));
  expect(m, `${name} not found`).toBeTruthy();
  return Number(m[1]);
};

describe("the rate limit's shape — not its generosity", () => {
  it("★ BOTH WALLS SIT AT THE SAME DOCUMENT COUNT (O113b)", () => {
    // A document costs AI_CALLS_PER_DOCUMENT AI calls and exactly 1 upload. If the two
    // buckets bind at different document counts, raising one alone relocates the identical
    // wall and changes nothing a person could observe — which is the whole of O113b.
    expect(num("AI_LIMIT") / AI_CALLS_PER_DOCUMENT).toBe(num("UPLOAD_LIMIT"));
    expect(num("AI_DAILY_LIMIT") / AI_CALLS_PER_DOCUMENT).toBe(num("UPLOAD_DAILY_LIMIT"));
  });

  it("★ A DAILY CAP EXISTS AND IS THE WIDER WINDOW", () => {
    // An hourly cap alone bounds the RATE and not the TOTAL: a stolen account runs the
    // hourly limit forever and nothing stops it. The daily is the only real brake.
    expect(num("AI_DAILY_LIMIT")).toBeGreaterThan(num("AI_LIMIT"));
    expect(num("UPLOAD_DAILY_LIMIT")).toBeGreaterThan(num("UPLOAD_LIMIT"));
  });

  it("★ the daily limits are actually PASSED to the limiter, not merely declared", () => {
    // A constant nobody sends is the "name the reader" defect: written faithfully,
    // consulted by nothing. Assert the call carries it.
    expect(PROXY).toMatch(/p_daily_limits:\s*daily/);
    expect(PROXY).toMatch(/const daily\s*=.*AI_DAILY_LIMIT/);
  });

  it("★ an ordinary month never meets the limit, and an onboarding fits in a day", () => {
    // The numbers exist to be invisible during legitimate work. A restaurant month is
    // 40-80 documents; an onboarding of 2-3 months is 120-240.
    const perHour = num("AI_LIMIT") / AI_CALLS_PER_DOCUMENT;
    const perDay  = num("AI_DAILY_LIMIT") / AI_CALLS_PER_DOCUMENT;
    expect(perHour).toBeGreaterThanOrEqual(80);    // a whole month in one sitting
    expect(perDay).toBeGreaterThanOrEqual(240);    // a whole onboarding in one day
  });

  it("★ a daily refusal is reported in HOURS, not in three-digit minutes", () => {
    // "resets in about 812 minute(s)" is a number nobody converts in their head, on the
    // one message whose job is to let someone decide what to do next.
    expect(PROXY).toMatch(/resetsInMin >= 120/);
    expect(PROXY).toMatch(/hours/);
  });
});
