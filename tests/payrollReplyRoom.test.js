import { describe, it, expect } from "vitest";
import { PROFILES } from "../supabase/functions/ai-proxy/aiProfiles.js";
import { PAYROLL_TEXT_LIMIT } from "../src/lib/payroll.js";

// C570 — the payroll reply lists every employee before the totals. It must have room for a
// register as long as the client is allowed to send, or a large staff fails at the reply.
describe("C570 — the payroll reply has room for the register the client may send", () => {
  it("is at least 8,000 tokens", () => {
    expect(PROFILES["parse-payroll"].max_tokens).toBeGreaterThanOrEqual(8000);
  });
  it("scales with the input limit: one employee line per ~200 input characters, ~25 tokens each, plus totals", () => {
    const people = PAYROLL_TEXT_LIMIT / 200;
    expect(PROFILES["parse-payroll"].max_tokens).toBeGreaterThanOrEqual(people * 25 + 400);
  });
});
