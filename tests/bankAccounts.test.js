import { describe, it, expect } from "vitest";
import { glRoleForAccountType, glCodeForAccountType } from "../src/lib/bankAccounts.js";
import { buildBankLineEntry } from "../src/lib/bankMatch.js";

// A stand-in for the live COA role→code index (getAccountByRole(role)?.code).
const RESOLVE = role => ({
  credit_card_liability: "2200",
  long_term_debt: "2500",
  cash: "1000",
}[role]);

describe("glRoleForAccountType — source type → natural offset GL role", () => {
  it("credit_card → credit_card_liability", () => {
    expect(glRoleForAccountType("credit_card")).toBe("credit_card_liability");
  });
  it("loan → long_term_debt", () => {
    expect(glRoleForAccountType("loan")).toBe("long_term_debt");
  });
  it("checking / savings / other → cash", () => {
    expect(glRoleForAccountType("checking")).toBe("cash");
    expect(glRoleForAccountType("savings")).toBe("cash");
    expect(glRoleForAccountType("other")).toBe("cash");
    expect(glRoleForAccountType(undefined)).toBe("cash");
  });
});

describe("glCodeForAccountType — resolves the type's default GL code", () => {
  it("credit_card resolves to the company's Credit Card Liability code (2200)", () => {
    expect(glCodeForAccountType("credit_card", RESOLVE)).toBe("2200");
  });
  it("checking resolves to Cash (1000)", () => {
    expect(glCodeForAccountType("checking", RESOLVE)).toBe("1000");
  });
  it("loan resolves to Long-Term Debt (2500)", () => {
    expect(glCodeForAccountType("loan", RESOLVE)).toBe("2500");
  });
  it("falls back to the conventional code when the role can't be resolved (legacy COA)", () => {
    const none = () => undefined;
    expect(glCodeForAccountType("credit_card", none)).toBe("2200");
    expect(glCodeForAccountType("loan", none)).toBe("2500");
    expect(glCodeForAccountType("checking", none)).toBe("1000");
    expect(glCodeForAccountType("credit_card")).toBe("2200"); // no resolver at all
  });
});

// The O63 end-to-end at the unit level: an inline-created credit-card account's GL
// code becomes the OFFSET for direct bookings, so importing a card charge books
// Dr Expense / Cr 2200 (the card liability) — not Cr Cash. Closes the O57 offset loop.
describe("inline-created credit-card account → import books Dr Expense / Cr 2200", () => {
  const cardGl = glCodeForAccountType("credit_card", RESOLVE); // "2200"
  const cardName = "Credit Card Liability";

  it("an expense charge offsets to the card liability (Cr 2200), not Cash", () => {
    const entry = buildBankLineEntry(
      { type: "expense", amount: 54.99, gl_code: "6500", gl_name: "Technology & Software", vendor: "Adobe", date: "2026-05-03" },
      { offsetCode: cardGl, offsetName: cardName }
    );
    expect(entry.gl_code).toBe("6500");            // Dr Expense (primary)
    expect(entry.debit_credit).toBe("debit");
    expect(entry.secondary_gl_code).toBe("2200");  // Cr Credit Card Liability (offset)
    expect(entry.secondary_gl_name).toBe(cardName);
  });

  it("a checking account would instead offset to Cash (1000) — same path, different source", () => {
    const bankGl = glCodeForAccountType("checking", RESOLVE); // "1000"
    const entry = buildBankLineEntry(
      { type: "expense", amount: 54.99, gl_code: "6500", gl_name: "Technology & Software" },
      { offsetCode: bankGl, offsetName: "Cash" }
    );
    expect(entry.secondary_gl_code).toBe("1000");
  });
});
