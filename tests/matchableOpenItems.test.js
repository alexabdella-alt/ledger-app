import { describe, it, expect } from "vitest";
import { matchableOpenItems as moi } from "../src/lib/bankMatch.js";

// C531 — a STORED bank line reads `source: "bank_import"` (the RPC normalises the in-session
// "bank_feed"/"bank_statement" names), and the guard that keeps bank lines out of the matcher's
// open universe named only the in-session spellings — so after a reload it matched nothing. A
// payment booked from the bank rail without a link (a legacy line, or one the matcher could not
// pair) carries an A/P leg and was offered as an OPEN PAYABLE to match against: the O83 Feb shape.
describe("C531 — stored bank lines are never open items", () => {
  const rows = [
    { id: "bill", vendor: "Roma", amount: 300, date: "2026-02-01", gl_code: "5010", secondary_gl_code: "2000", debit_credit: "debit", type: "expense", payment_status: "unpaid", source: "universal_upload" },
    // a payment from the bank rail, stored, with no payment_for link
    { id: "bankpay", vendor: "Roma", amount: 300, date: "2026-02-10", gl_code: "2000", secondary_gl_code: "1000", debit_credit: "debit", type: "expense", payment_status: "paid", source: "bank_import" },
  ];
  it("the bill is open; the stored bank-rail payment is not offered as one", () => {
    expect(moi(rows, { arCode: "1100", apCode: "2000" }).map(r => r.id)).toEqual(["bill"]);
  });
});
