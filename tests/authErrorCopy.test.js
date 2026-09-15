import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { authErrorCopy } from "../src/lib/authErrorCopy.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// C421 — the sign-in screen's error reads in the person's words, with the next step.
describe("authErrorCopy", () => {
  it("maps the messages Supabase auth actually returns to a sentence with a next step", () => {
    expect(authErrorCopy("Invalid login credentials")).toMatch(/don't match/);
    expect(authErrorCopy("Email not confirmed")).toMatch(/Confirm your email first/);
    expect(authErrorCopy("User already registered")).toMatch(/log in instead/);
    expect(authErrorCopy("Email rate limit exceeded")).toMatch(/wait a few minutes/);
    expect(authErrorCopy("TypeError: Failed to fetch")).toMatch(/check your connection/);
    expect(authErrorCopy("Password should be at least 6 characters")).toMatch(/longer password/);
  });
  it("a plain sentence the app wrote passes through; code-shaped text does not", () => {
    expect(authErrorCopy("Enter your email address first.")).toBe("Enter your email address first.");
    expect(authErrorCopy('{"code":500,"msg":"boom"}')).toMatch(/on our side/);
  });
  it("every mapped sentence passes the owner bar", () => {
    for (const raw of ["Invalid login credentials", "Email not confirmed", "User already registered", "rate limit", "network", "weak password", "invalid email", "", "{x}"]) {
      expect(containsOwnerJargon(authErrorCopy(raw))).toBe(false);
    }
  });
  it("both auth forms route through it", () => {
    const src = fs.readFileSync("src/components/AuthScreen.jsx", "utf8");
    expect((src.match(/setError\(authErrorCopy\(e\?\.message\)\)/g) || []).length).toBe(2);
    expect(src).not.toMatch(/setError\(e\.message\)/);
  });
});
