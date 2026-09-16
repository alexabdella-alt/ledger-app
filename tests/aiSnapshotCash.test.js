import { describe, it, expect } from "vitest";
import { buildFinancials } from "../src/lib/ai.js";

// ═════════════════════════════════════════════════════════════════════════════
// C493 — THE FALLBACK SNAPSHOT TOLD THE MODEL CASH WAS "NOT SET BY THE OWNER" WHENEVER IT
// WAS ZERO OR NEGATIVE. Cash on hand has been GL-derived since the §12 single-source rule,
// so an overdrawn account and a genuinely empty one both read as a missing setting — and
// the model relayed that as an instruction to set something that no longer exists. The
// snapshot states the figure now, whatever its sign.
// ═════════════════════════════════════════════════════════════════════════════
describe("C493 · fallback snapshot cash", () => {
  it("zero and negative cash are figures, never a claim that nothing was set", () => {
    for (const cash of [0, -1250.5]) {
      const { text } = buildFinancials([], cash);
      expect(text).not.toMatch(/not set/i);
      expect(text).toMatch(/Cash on hand: [-−$0-9.,]+/);
    }
    expect(buildFinancials([], -1250.5).text).toMatch(/overdrawn/);
    expect(buildFinancials([], 0).text).not.toMatch(/overdrawn/);
    expect(buildFinancials([], 4200).text).toMatch(/Cash on hand: \$4,200\.00/);
  });
});
