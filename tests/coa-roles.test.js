import { describe, it, expect } from "vitest";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// ── Item 6: COA system_role lookups ────────────────────────────────────────
// useAccounts builds a byRole index from the live accounts and getAccountByRole
// resolves a stable role to the (possibly renumbered) account. Here we verify the
// authoritative default mapping that the lookup falls back to.
const byRole = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map(a => [a.system_role, a]));
const getAccountByRole = (role) => byRole[role] || null;

describe("getAccountByRole (default COA mapping)", () => {
  const expected = {
    salaries_wages: "6000",
    rent_occupancy: "6100",
    utilities: "6200",
    marketing_advertising: "6300",
    travel_entertainment: "6400",
    technology_software: "6500",
    office_supplies: "6600",
    insurance: "6700",
    professional_services: "6800",
    depreciation_amortization: "6900",
    miscellaneous_expense: "7100",
    interest_expense: "8000",
    cash: "1000",
    accounts_receivable: "1100",
    accounts_payable: "2000",
  };

  for (const [role, code] of Object.entries(expected)) {
    it(`resolves role "${role}" → ${code}`, () => {
      expect(getAccountByRole(role)?.code).toBe(code);
    });
  }

  it("returns null for an unknown role", () => {
    expect(getAccountByRole("not_a_real_role")).toBeNull();
  });

  it("every default account has a unique code", () => {
    const codes = DEFAULT_CHART_OF_ACCOUNTS.map(a => a.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
