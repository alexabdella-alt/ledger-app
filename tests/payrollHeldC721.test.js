// C721 — a payroll run is never counted twice: not through a signed-month hold, not through a net-pay
// bank line booked before its register arrived.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { netPayLinesReplacedBy, PAYROLL_INCOMPLETE_NOTE, flagIncompletePayroll } from "../src/lib/payroll.js";

const line = (id, amount, date, extra = {}) => ({ id, db_entry_id: id, amount, date, reasoning: PAYROLL_INCOMPLETE_NOTE, status: "booked", ...extra });

describe("★ the net-pay line a register replaces", () => {
  it("same net to the cent, within ten days, live, once per entry", () => {
    const ledger = [
      line("a", 3150, "2026-10-15"),
      line("b", 3150.01, "2026-10-15"),                      // a cent off — a different payment
      line("c", 3150, "2026-11-30"),                          // too far
      line("d", 3150, "2026-10-14", { deleted_at: "x" }),     // already gone
      { ...line("e", 3150, "2026-10-16"), reasoning: "Gusto" }, // not a flagged net-pay line
      line("f", 3150, "2026-10-12", { id: "f_0" }), line("f", 3150, "2026-10-12", { id: "f_1" }),
    ];
    expect(netPayLinesReplacedBy(ledger, { net: 3150, date: "2026-10-15" }).map((i) => i.id)).toEqual(["a", "f_0"]);
    expect(netPayLinesReplacedBy(ledger, { net: 0, date: "2026-10-15" })).toEqual([]);
  });
  it("the flag that marks such a line is the note it's found by", () => {
    expect(flagIncompletePayroll({ amount: 1 }).reasoning).toBe(PAYROLL_INCOMPLETE_NOTE);
  });
  it("posting a register removes it (open month) or says so (signed month)", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/for \(const old of netPayLinesReplacedBy\(invoicesRef\.current \|\| \[\], \{ net: imp\.total_net, date: je\.date \}\)\)/);
    expect(app).toMatch(/if \(signedPeriodForDate\(old\.date, signoffs\)\) \{ replacedHeld\+\+; continue; \}/);
    expect(app).toMatch(/label: "payroll:replace-net-pay-line"/);
    expect(app).toMatch(/was replaced by this, so it isn't counted twice/);
  });
});

describe("★ a multi-line entry into a signed month is refused, never held", () => {
  it("so its caller's follow-up can't be skipped by a later re-post", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    const w = app.slice(app.indexOf("const persistMultiLineEntry = async"), app.indexOf("const persistMultiLineEntry = async") + 4000);
    expect(w).not.toMatch(/setPendingSignedPeriodBooking/);
    expect(w).toMatch(/signed_period_booking_refused/);
  });
});
