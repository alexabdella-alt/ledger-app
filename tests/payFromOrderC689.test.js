// C689 — the default "Paid from" is a bank account, and the list loads in a fixed order.
import { describe, it, expect } from "vitest";
import { payFromOptions } from "../src/lib/payFrom.js";
import { readFileSync } from "node:fs";

describe("C689 — a stable default", () => {
  it("bank accounts come before cards, whatever order they arrive in", () => {
    const o = payFromOptions({ bankAccounts: [{ id: "c", name: "Amex", type: "credit_card", gl_code: "2150" }, { id: "k", name: "Checking", type: "checking", gl_code: "1000" }, { id: "s", name: "Savings", type: "savings", gl_code: "1010" }] });
    expect(o.map((x) => x.key).filter((k) => k !== "own")).toEqual(["acct:k", "acct:s", "acct:c"]);
  });
  it("the app loads bank accounts in a fixed order", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/from\("bank_accounts"\)\.select\("\*, accounts\(code\)"\)\.eq\("company_id", cid\)\.eq\("active", true\)\.order\("created_at"\)\.order\("id"\)/);
  });
});
