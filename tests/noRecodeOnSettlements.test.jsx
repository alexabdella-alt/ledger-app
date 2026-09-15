import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { settlementKind } from "../src/lib/txnPresent.js";
import { isSettlementEntry } from "../src/lib/bankMatch.js";

// ═════════════════════════════════════════════════════════════════════════════
// C465 — "CHANGE CATEGORY" WAS OFFERED ON A PAYMENT ROW. A settlement's lines are A/P-or-A/R
// and cash; recoding one moved the A/P leg to an expense, broke the link to the bill it
// settles, and taught the supplier the new account. Not offered on those rows; refused in
// persistRecode as well. (The panel renders through a portal, which SSR cannot — C246's
// recorded limit — so the panel half is pinned in source.)
// ═════════════════════════════════════════════════════════════════════════════
const payment = { id: "p1", vendor: "Sysco", amount: 500, gl_code: "2000", secondary_gl_code: "1000", description: "Payment – Sysco", import_metadata: { kind: "ap_payment", payment_for: "b1" } };
const bill = { id: "b1", vendor: "Sysco", amount: 500, gl_code: "5010", secondary_gl_code: "2000", description: "Sysco – produce", import_metadata: {} };

describe("C465", () => {
  it("the predicates agree a payment is a settlement and a bill is not", () => {
    expect(settlementKind(payment)).toBe("ap_payment");
    expect(settlementKind(bill)).toBeFalsy();
    expect(isSettlementEntry(payment)).toBe(true);
    expect(isSettlementEntry(bill)).toBe(false);
  });
  it("the panel replaces the control with a sentence on settlements and opening entries", () => {
    const src = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8");
    expect(src).toMatch(/\{\(settle \|\| sel\.source === "opening_balance"\) \? \(\s*<div data-no-recode/);
    expect(src).toMatch(/A payment has no category of its own — change the category on the bill or invoice it settles\./);
  });
  it("persistRecode refuses a settlement or an opening entry before any write", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    const i = app.indexOf("const persistRecode = async (recodedInvoices, newGlCode, newGlName) => {");
    const head = app.slice(i, i + 1500);
    expect(head).toMatch(/const notRecodable = targets\.find\(inv => isSettlementEntry\(inv\) \|\| inv\?\.source === "opening_balance"\);/);
    expect(head.indexOf("notRecodable")).toBeLessThan(head.indexOf("signedPeriodForDate"));
  });
});
