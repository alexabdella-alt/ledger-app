import { describe, it, expect } from "vitest";
import { fmtSignedMoney, fmtApprox, fmtMoney } from "../src/lib/format.js";

// C483 — "-$0.00": a sub-cent negative (floating-point residue in a sum, e.g. a net income
// that is exactly zero in cents) printed with a minus sign on a zero.
describe("C483", () => {
  it("a value that rounds to zero carries no sign", () => {
    expect(fmtSignedMoney(-0.001)).toBe("$0.00");
    expect(fmtSignedMoney(-1e-13)).toBe("$0.00");
    expect(fmtApprox(-0.4)).toBe("$0");
    expect(fmtSignedMoney(-0)).toBe("$0.00");
  });
  it("a real negative keeps its sign — the fix must not go blind", () => {
    expect(fmtSignedMoney(-0.005)).toBe("-$0.01");
    expect(fmtSignedMoney(-12.5)).toBe("-$12.50");
    expect(fmtApprox(-0.5)).toBe("-$1");
    expect(fmtApprox(-3)).toBe("-$3");
    expect(fmtMoney(-12.5)).toBe("$12.50");
  });
});
