import { describe, it, expect } from "vitest";
import { isPlaceholderBank, onboardingSteps, onboardingChecklistVisible } from "../src/lib/onboarding.js";

describe("onboardingChecklistVisible — the refresh-flash fix", () => {
  it("HIDES while data is not loaded yet (the flash) even though everything reads empty", () => {
    // This is the bug: on refresh companySettings/banks/invoices are empty for a frame.
    // 'not loaded' must NOT be treated as 'not done' → nothing renders.
    expect(onboardingChecklistVisible({ companyDataLoaded: false, onboardingComplete: false })).toBe(false);
    expect(onboardingChecklistVisible({ companyDataLoaded: false, onboardingComplete: true })).toBe(false);
  });
  it("HIDES once loaded for an already-onboarded company", () => {
    expect(onboardingChecklistVisible({ companyDataLoaded: true, onboardingComplete: true })).toBe(false);
  });
  it("SHOWS only once loaded AND genuinely incomplete", () => {
    expect(onboardingChecklistVisible({ companyDataLoaded: true, onboardingComplete: false })).toBe(true);
  });
  it("defaults are safe (no args → hidden)", () => {
    expect(onboardingChecklistVisible()).toBe(false);
  });
});

describe("isPlaceholderBank — the seeded 'Primary Checking' doesn't count", () => {
  it("treats the bare seeded account as a placeholder", () => {
    expect(isPlaceholderBank({ name: "Primary Checking", institution: "", last4: "" })).toBe(true);
  });
  it("a real bank (institution/last4 filled, or renamed) is NOT a placeholder", () => {
    expect(isPlaceholderBank({ name: "Primary Checking", last4: "1234" })).toBe(false);
    expect(isPlaceholderBank({ name: "Primary Checking", institution: "Chase" })).toBe(false);
    expect(isPlaceholderBank({ name: "Business Checking" })).toBe(false);
  });
});

describe("onboardingSteps — per-step completion + all-done roll-up", () => {
  it("a brand-new company has nothing done", () => {
    const s = onboardingSteps({});
    expect(s).toMatchObject({ obHasBiz: false, obHasBank: false, obHasOpening: false, obHasUpload: false, obAllDone: false, requiredDone: 0 });
  });

  it("business step needs both name AND businessType", () => {
    expect(onboardingSteps({ companySettings: { name: "Acme" } }).obHasBiz).toBe(false);
    expect(onboardingSteps({ companySettings: { name: "Acme", businessType: "SaaS" } }).obHasBiz).toBe(true);
  });

  it("bank step ignores the seeded placeholder + the 'default' id, counts a real one", () => {
    expect(onboardingSteps({ bankAccounts: [{ id: "default", name: "Primary Checking" }] }).obHasBank).toBe(false);
    expect(onboardingSteps({ bankAccounts: [{ id: "x", name: "Primary Checking" }] }).obHasBank).toBe(false); // placeholder shape
    expect(onboardingSteps({ bankAccounts: [{ id: "x", name: "Chase", institution: "Chase", last4: "9999" }] }).obHasBank).toBe(true);
  });

  it("opening step is durable: opening_balances rows OR an opening_balance journal entry", () => {
    expect(onboardingSteps({ openingBalances: [{ id: 1 }] }).obHasOpening).toBe(true);
    expect(onboardingSteps({ invoices: [{ source: "opening_balance" }] }).obHasOpening).toBe(true);
    expect(onboardingSteps({ invoices: [{ source: "bank_statement" }] }).obHasOpening).toBe(false);
  });

  it("all four done → obAllDone + requiredDone 4", () => {
    const s = onboardingSteps({
      companySettings: { name: "Acme", businessType: "SaaS" },
      bankAccounts: [{ id: "x", name: "Chase", institution: "Chase", last4: "9999" }],
      openingBalances: [{ id: 1 }],
      onboardingUploadDone: true,
    });
    expect(s.obAllDone).toBe(true);
    expect(s.requiredDone).toBe(4);
  });
});
