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

  // O83 Issue 2: adopting the seeded account by entering a BALANCE (the natural
  // "set up my bank account" action) must clear the placeholder flag — a real
  // account is no longer misclassified as the empty seed.
  it("entering a balance on the seeded 'Primary Checking' makes it a real account", () => {
    expect(isPlaceholderBank({ name: "Primary Checking", current_balance: 5000 })).toBe(false);
    expect(isPlaceholderBank({ name: "Primary Checking", current_balance: "5000" })).toBe(false);   // Settings sends a string
    // still a placeholder while pristine (default name, no details, no/zero balance)
    expect(isPlaceholderBank({ name: "Primary Checking", current_balance: 0 })).toBe(true);
    expect(isPlaceholderBank({ name: "Primary Checking", current_balance: "" })).toBe(true);
    expect(isPlaceholderBank({ name: "Primary Checking" })).toBe(true);
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

  it("bank step ticks when the user enters a balance on the seeded account (O83 Issue 2)", () => {
    expect(onboardingSteps({ bankAccounts: [{ id: "x", name: "Primary Checking", current_balance: 12000 }] }).obHasBank).toBe(true);
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

// ═════════════════════════════════════════════════════════════════════════════
// O132 (C352) — THE STATEMENT COMES BEFORE THE OPENING BALANCE. The checklist asked for the
// opening balance one step before the document that derives it, and a typed guess that
// disagrees with the statement becomes a reconciliation mismatch the app refuses to
// auto-adjust. Order and copy are one list, read by the checklist and pinned here.
// ═════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import { ONBOARDING_STEP_ORDER, ONBOARDING_STEP_COPY } from "../src/lib/onboarding.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

describe("★ O132 — the first statement is asked for BEFORE the opening balance", () => {
  it("upload precedes opening, and both are still required", () => {
    expect(ONBOARDING_STEP_ORDER.indexOf("upload")).toBeLessThan(ONBOARDING_STEP_ORDER.indexOf("opening"));
    expect(ONBOARDING_STEP_ORDER).toEqual(["biz", "bank", "upload", "opening"]);
  });
  it("the copy asks for a STATEMENT and says the opening comes from it", () => {
    expect(ONBOARDING_STEP_COPY.upload.label).toMatch(/bank statement/i);
    expect(ONBOARDING_STEP_COPY.opening.hint).toMatch(/from your first statement/i);
    for (const c of Object.values(ONBOARDING_STEP_COPY)) {
      expect(containsOwnerJargon(c.label)).toBe(false);
      expect(containsOwnerJargon(c.hint)).toBe(false);
    }
  });
  it("★ the checklist READS the order — it does not carry its own", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(src).toMatch(/const steps = ONBOARDING_STEP_ORDER\.map\(k => stepByKey\[k\]\)/);
    expect(src).not.toMatch(/label:"Upload your first document"/);
  });
});
