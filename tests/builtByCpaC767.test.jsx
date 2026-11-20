// ★ C767 — "BUILT BY A CPA" ON THE SIGN-IN PAGE (operator, 2026-11-20: a selling point worth showing).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { AUTH_TRUST } from "../src/lib/firstRun.js";

describe("C767 — the trust line", () => {
  const a = readFileSync("src/components/AuthScreen.jsx", "utf8");
  it("★★ a badge above the headline, a sentence under the tagline, and the badge beside the name on a phone", () => {
    expect(AUTH_TRUST.badge).toBe("Built by a CPA");
    expect(AUTH_TRUST.line).toMatch(/CPA/);
    expect(a).toContain("data-auth-trust ");
    expect(a.indexOf("data-auth-trust ")).toBeLessThan(a.indexOf('<h1 className="sc-rise-1"'));
    expect(a).toContain("{AUTH_TRUST.line}");
    expect(a).toContain("data-auth-trust-mini");
  });
  it("★ the shield is a line icon, not an emoji; the feature tiles lost their purple tint", () => {
    expect(a).toContain('<Icon name="shield"');
    expect(a).not.toMatch(/139,\s*123,\s*255/);
  });
});
