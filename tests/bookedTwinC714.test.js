// C714 — the same bank line from another copy of the statement is offered, not booked twice.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bookedTwinFor } from "../src/lib/statementQuestions.js";

const card = (over = {}) => ({ id: "sxq_1", invoice: { date: "2026-03-02", amount: 84.12, money_in: false, vendor: "Home Depot", ...over }, statementLine: { lineId: "1", statementId: "s2", accountId: "a", accountCode: "1000" } });
const booked = (over = {}) => ({ id: "je1", db_entry_id: "je1", date: "2026-03-02", amount: 84.12, gl_code: "6600", secondary_gl_code: "1000", debit_credit: "debit", type: "expense", status: "posted", vendor: "HOME DEPOT", ...over });

describe("C714", () => {
  it("money out on the same account, date and amount → the entry", () => {
    expect(bookedTwinFor(card(), [booked()])?.id).toBe("je1");
  });
  it("a different account, amount, date or direction → none", () => {
    expect(bookedTwinFor(card(), [booked({ secondary_gl_code: "2200" })])).toBe(null);
    expect(bookedTwinFor(card(), [booked({ amount: 84.13 })])).toBe(null);
    expect(bookedTwinFor(card(), [booked({ date: "2026-03-03" })])).toBe(null);
    expect(bookedTwinFor(card({ money_in: true }), [booked()])).toBe(null);
    expect(bookedTwinFor(card(), [booked({ status: "voided" })])).toBe(null);
  });
  it("money in matches a credit to the category (a refund) on the same account", () => {
    expect(bookedTwinFor(card({ money_in: true }), [booked({ debit_credit: "credit" })])?.id).toBe("je1");
  });
  it("not a bank line → none", () => {
    expect(bookedTwinFor({ invoice: { date: "2026-03-02", amount: 84.12 } }, [booked()])).toBe(null);
  });
  it("the card asks, with both answers", () => {
    const f = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(f).toMatch(/data-booked-twin/);
    expect(f).toMatch(/Yes, it's the same one/);
    expect(f).toMatch(/No, it's a separate charge/);
    expect(f).toMatch(/Already in your books — linked to it, not added twice\./);
  });
});
