import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C606 — review finding K3: leftover Bank Import lines were booked against whatever account
// the picker defaulted to after leaving and returning.
const app = readFileSync("src/App.jsx", "utf8");

describe("statement lines keep the account they were read for", () => {
  it("★ each line is stamped with its account when read", () => {
    expect(app).toMatch(/checked: !t\.needs_review && !t\.already_booked, _accountId: account\?\.id \?\? null \}\)\);/);
  });

  it("★ booking uses the lines' account; the picker only for lines read without one", () => {
    expect(app).toMatch(/const accountForBankLines = \(lines = \[\], fallback = null\) => \{\s*\n\s*const boundId = \(lines \|\| \[\]\)\.find\(t => t && t\._accountId != null\)\?\._accountId;\s*\n\s*if \(boundId == null\) return fallback;/);
    expect(app).toMatch(/const bookBankTransactions = async \(picked = null\) => \{\s*\n\s*const account = accountForBankLines\(bankTransactions, picked\);/);
  });

  it("the Book button says which account it books to", () => {
    const v = readFileSync("src/components/views/BankView.jsx", "utf8");
    const btn = v.slice(v.indexOf("data-bank-book"), v.indexOf("data-bank-book") + 400);
    expect(btn).toMatch(/bankTransactions\.find\(t => t && t\._accountId != null\)\?\._accountId/);
    expect(btn).toMatch(/return a \? `Books to \$\{a\.name\}` : "";/);
  });
});
