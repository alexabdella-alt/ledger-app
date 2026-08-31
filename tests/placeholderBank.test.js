import { describe, it, expect } from "vitest";
import { bankEverEdited, isPlaceholderBank, onboardingSteps } from "../src/lib/onboarding";

const T0 = "2026-01-01T10:00:00.000Z";
const seeded = { id: "b1", name: "Primary Checking", institution: "", last4: "", current_balance: 0, created_at: T0, updated_at: T0 };

describe("a real account must not be mistaken for the one we seed", () => {
  it("the untouched seeded row is still a placeholder", () => {
    expect(isPlaceholderBank(seeded)).toBe(true);
  });

  it("★★ but the SAME row, once a person has saved it, is theirs — the residual this closes", () => {
    // Nothing about the name, the bank or the balance changed. Only the fact that a human
    // opened Settings and pressed save, which the old heuristic had no way to hear.
    const edited = { ...seeded, updated_at: "2026-01-05T09:00:00.000Z" };
    expect(isPlaceholderBank(edited)).toBe(false);
  });

  it("★ so onboarding's bank step can finally be ticked off", () => {
    expect(onboardingSteps({ bankAccounts: [seeded] }).obHasBank).toBe(false);
    expect(onboardingSteps({ bankAccounts: [{ ...seeded, updated_at: "2026-01-05T09:00:00.000Z" }] }).obHasBank).toBe(true);
  });

  it("filling in any real detail still clears it, as before", () => {
    expect(isPlaceholderBank({ ...seeded, institution: "Chase" })).toBe(false);
    expect(isPlaceholderBank({ ...seeded, last4: "4412" })).toBe(false);
    expect(isPlaceholderBank({ ...seeded, current_balance: 250 })).toBe(false);
    expect(isPlaceholderBank({ ...seeded, name: "Business Checking" })).toBe(false);
  });

  it("★★ MISSING OR UNPARSEABLE TIMESTAMPS MEAN 'WE DON'T KNOW', NOT 'IT WAS EDITED'", () => {
    // The other way round would declare every account real on a company whose rows predate
    // the timestamps, ticking off a step the person never did.
    expect(bankEverEdited({})).toBe(false);
    expect(bankEverEdited({ created_at: T0 })).toBe(false);
    expect(bankEverEdited({ created_at: "not a date", updated_at: "also not" })).toBe(false);
    expect(isPlaceholderBank({ ...seeded, created_at: null, updated_at: null })).toBe(true);
  });

  it("insert-time jitter is not an edit", () => {
    expect(bankEverEdited({ created_at: T0, updated_at: "2026-01-01T10:00:00.400Z" })).toBe(false);
    expect(bankEverEdited({ created_at: T0, updated_at: "2026-01-01T10:00:05.000Z" })).toBe(true);
  });
});
