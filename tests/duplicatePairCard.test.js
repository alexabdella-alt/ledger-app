import { describe, it, expect } from "vitest";
import { runAnomalyDetection } from "../src/lib/insights";

// ── THE LIVE SPECIMEN (Red River, CPA Review, 2026-09-03) ────────────────────
// TWO high cards for ONE Hill Country pair — one headed "Two charges … for $632.30",
// the other "… for $629.04" — and BOTH listed the same two rows, $629.04 and $632.30.
//
// Two defects in one card:
//   · the loop visits every pair TWICE, once from each row, and the dedupe key carried
//     the CURRENT row's amount. `findDuplicate` matches within 1%, so a pair with two
//     different amounts produced two keys and emitted twice.
//   · the sentence asserted the amounts were EQUAL, directly above the two that were not.

const bill = (id, date, amount, vendor = "Hill Country Milling Co.") => ({
  id, date, vendor, amount, type: "expense", status: "booked",
  gl_code: "5010", gl_name: "Food Cost", source: "universal_upload",
});
const today = "2026-08-31";
const dups = (invoices) =>
  runAnomalyDetection(invoices, { today }).filter(a => a.type === "duplicate_payment");

describe("one pair, one card", () => {
  it("★ NEAR-EQUAL amounts emit exactly ONE card — the live bug", () => {
    const out = dups([bill("a", "2026-08-12", 629.04), bill("b", "2026-08-19", 632.30)]);
    expect(out.length).toBe(1);
  });

  it("★ and the card cannot claim the two amounts are the same", () => {
    const [card] = dups([bill("a", "2026-08-12", 629.04), bill("b", "2026-08-19", 632.30)]);
    // It must name BOTH figures. Stating one implies they are equal, which is exactly
    // what the reviewer could see was false on the rows beneath.
    expect(card.description).toContain("629.04");
    expect(card.description).toContain("632.30");
    expect(card.description).not.toMatch(/for \$632\.30 within a week/);
  });

  it("★ EXACTLY equal amounts still read naturally — one figure, both dates", () => {
    // The negative case: "name both amounts" must not become "always print two numbers",
    // which would read as a discrepancy where there is none.
    const [card] = dups([bill("a", "2026-08-12", 500), bill("b", "2026-08-19", 500)]);
    expect(card.description).toContain("2026-08-12");
    expect(card.description).toContain("2026-08-19");
    expect(card.description.match(/\$500\.00/g).length).toBe(1);
  });

  it("★ the key does not depend on which row we arrived from", () => {
    // Reversing the input order must produce the identical card id. Without a symmetric
    // key the two orders key differently, which IS the double-emission.
    const fwd = dups([bill("a", "2026-08-12", 629.04), bill("b", "2026-08-19", 632.30)]);
    const rev = dups([bill("b", "2026-08-19", 632.30), bill("a", "2026-08-12", 629.04)]);
    expect(fwd.length).toBe(1);
    expect(rev.length).toBe(1);
    expect(fwd[0].id).toBe(rev[0].id);
  });

  it("★ a pair straddling a digit boundary is still ONE card", () => {
    // ★ THIS DOES NOT TEST THE COMPARATOR, and an earlier version of it claimed to.
    // Swapping to lexicographic `.sort()` leaves every assertion green, because ANY total
    // order is symmetric — the sort is what matters, not which one. Kept for what it
    // genuinely covers: 999.99 vs 1000.00 is within the 1% window and must not double-emit.
    const fwd = dups([bill("a", "2026-08-12", 999.99), bill("b", "2026-08-19", 1000.00)]);
    const rev = dups([bill("b", "2026-08-19", 1000.00), bill("a", "2026-08-12", 999.99)]);
    expect(fwd[0].id).toBe(rev[0].id);
  });

  it("★ TWO GENUINELY DIFFERENT PAIRS still produce two cards", () => {
    // The dedupe must not over-collapse: "one card per pair" is equally satisfied by
    // emitting one card ever, which would hide a real second double-payment.
    const out = dups([
      bill("a", "2026-08-12", 629.04), bill("b", "2026-08-19", 632.30),
      bill("c", "2026-08-12", 210.00, "Roma Cheese & Dairy"),
      bill("d", "2026-08-15", 210.00, "Roma Cheese & Dairy"),
    ]);
    expect(out.length).toBe(2);
  });
});
