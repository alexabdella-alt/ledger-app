import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { invoiceOutcomeCopy } from "../src/lib/uploadOutcome";

// C623 — review finding U8: the upload tile said "✓ Booked … Done" from intent.
describe("the tile counts what landed", () => {
  it("★ two of three booked, one refused → says both", () => {
    const t = invoiceOutcomeCopy({ invoiceCount: 2, amount: 300, refusedCount: 1, refusedVendor: "Roma Cheese" });
    expect(t).toBe("✓ 2 invoices booked · $300.00 total · Roma Cheese couldn't be booked");
  });

  it("★ nothing landed → no ✓ at all", () => {
    expect(invoiceOutcomeCopy({ invoiceCount: 0, refusedCount: 1, refusedVendor: "Roma Cheese" })).toBe("⚠ Roma Cheese couldn't be booked — see the message for why");
  });

  it("★ a file with one invoice filed and one refused says both", () => {
    const t = invoiceOutcomeCopy({ invoiceCount: 0, attachedCount: 1, attachedAmount: 80, attachedVendor: "Toast", refusedCount: 1, refusedVendor: "Roma Cheese" });
    expect(t).toMatch(/^✓ .*Toast.* · Roma Cheese couldn't be booked$/);
  });

  it("the source counts landed bookings, not attempts", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const landedInvoices = highConfidence\.filter\(\(_, i\) => jeIds\[i\]\);/);
    expect(app).toMatch(/invoiceCount: landedInvoices\.length,/);
    expect(app).not.toMatch(/invoiceCount: highConfidence\.length,/);
  });
});

describe("an answered question is described by its answer", () => {
  const asked = { invoiceCount: 0, needsClarification: 1, reviewVendor: "Ace", reviewAmount: 50 };
  it.each([
    [[{ kind: "booked", landed: true }], "✓ Booked: Ace · $50.00"],
    [[{ kind: "skipped", landed: false }], "Set aside — not booked: Ace · $50.00"],
    [[{ kind: "deferred", landed: false }], "Sent to your accountant: Ace · $50.00"],
    [[{ kind: "booked", landed: false }], "⚠ Not booked yet: Ace · $50.00 — open it again from Home"],
    [[], "Answered: Ace · $50.00"],
  ])("%j → %s", (answers, want) => {
    expect(invoiceOutcomeCopy({ ...asked, answers }, { pendingReview: false })).toBe(want);
  });

  it("★ each answer is recorded on its tile when it is settled", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    const fn = app.slice(app.indexOf("const settleClarification = (item, outcome) => {"), app.indexOf("const clarificationHoldsRef") > 0 ? app.indexOf("const hold = clarificationHoldsRef.current[key];") : undefined);
    expect(fn).toMatch(/answers: \[ \.\.\.\(\(\(q\.result \|\| \{\}\)\.answers\) \|\| \[\]\), \{ kind: outcome\.kind, landed: outcome\.jeId != null \} \]/);
  });
});
