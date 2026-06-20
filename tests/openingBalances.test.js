import { describe, it, expect } from "vitest";
import {
  buildOpeningBalanceEntry, isBeforeCutoff, preCutoffActivity, hasPreCutoffActivity, OBE_CODE,
  bookingBlockedReason, PRE_CUTOFF_MESSAGE,
} from "../src/lib/openingBalances.js";

const sumD = ls => ls.reduce((s, l) => s + (l.debit || 0), 0);
const sumC = ls => ls.reduce((s, l) => s + (l.credit || 0), 0);
const isPL = c => ["4", "5", "6", "7", "8"].includes(String(c)[0]);

describe("buildOpeningBalanceEntry — one balanced opening entry, plug to OBE", () => {
  it("a complete trial balance (A = L + E incl. RE) plugs OBE to zero and balances", () => {
    const { lines } = buildOpeningBalanceEntry(
      { "1000": 5000, "1100": 2000, "2000": 1500, "3100": 5500 },   // 7000 assets = 1500 liab + 5500 RE
      { cutoffDate: "2026-01-01" }
    );
    expect(sumD(lines)).toBe(sumC(lines));                 // balanced
    expect(lines.find(l => l.code === OBE_CODE)).toBeUndefined();   // no residual → no OBE line
    expect(lines).toContainEqual({ code: "1000", debit: 5000, credit: 0 });
    expect(lines).toContainEqual({ code: "2000", debit: 0, credit: 1500 });
    expect(lines).toContainEqual({ code: "3100", debit: 0, credit: 5500 });
  });

  it("an incomplete trial balance plugs the residual to Opening Balance Equity", () => {
    const { lines } = buildOpeningBalanceEntry({ "1000": 5000, "2000": 1500 }, { cutoffDate: "2026-01-01" });
    expect(sumD(lines)).toBe(sumC(lines));
    // assets 5000 debit, liab 1500 credit → residual 3500 credit to OBE
    expect(lines).toContainEqual({ code: OBE_CODE, debit: 0, credit: 3500 });
  });

  it("cash-only opening → Dr Cash / Cr Opening Balance Equity", () => {
    const { lines, source, date } = buildOpeningBalanceEntry({ "1000": 5000 }, { cutoffDate: "2026-03-15" });
    expect(source).toBe("opening_balance");
    expect(date).toBe("2026-03-15");
    expect(lines).toEqual([
      { code: "1000", debit: 5000, credit: 0 },
      { code: OBE_CODE, debit: 0, credit: 5000 },
    ]);
  });

  it("is balance-sheet-only — never touches net income (no 4xxx/5–8xxx lines)", () => {
    const { lines } = buildOpeningBalanceEntry({ "1000": 5000, "1500": 3000, "2000": 2000, "3100": 6000 }, {});
    expect(lines.some(l => isPL(l.code))).toBe(false);
  });

  it("handles a negative balance (e.g. contra/overdraft) by flipping the side", () => {
    const { lines } = buildOpeningBalanceEntry({ "1000": -500 }, { cutoffDate: "2026-01-01" });
    // negative asset → credit 500; OBE debit 500
    expect(lines).toContainEqual({ code: "1000", debit: 0, credit: 500 });
    expect(lines).toContainEqual({ code: OBE_CODE, debit: 500, credit: 0 });
    expect(sumD(lines)).toBe(sumC(lines));
  });

  it("skips zero balances", () => {
    const { lines } = buildOpeningBalanceEntry({ "1000": 0, "2000": 0 }, {});
    expect(lines).toEqual([]);
  });
});

describe("cutoff enforcement predicates", () => {
  it("isBeforeCutoff flags dates strictly before the cutoff", () => {
    expect(isBeforeCutoff("2025-12-31", "2026-01-01")).toBe(true);
    expect(isBeforeCutoff("2026-01-01", "2026-01-01")).toBe(false);   // on the cutoff is OK
    expect(isBeforeCutoff("2026-02-01", "2026-01-01")).toBe(false);
    expect(isBeforeCutoff("2026-02-01", null)).toBe(false);           // no cutoff → no enforcement
  });

  it("bookingBlockedReason returns the redirect message for a pre-cutoff date, null otherwise", () => {
    expect(bookingBlockedReason("2024-12-31", "2025-01-01")).toBe(PRE_CUTOFF_MESSAGE);
    expect(bookingBlockedReason("2025-01-01", "2025-01-01")).toBeNull();   // on the cutoff is OK
    expect(bookingBlockedReason("2025-06-01", "2025-01-01")).toBeNull();   // after cutoff
    expect(bookingBlockedReason("2024-12-31", null)).toBeNull();           // no cutoff → allowed
  });

  it("preCutoffActivity finds live non-opening transactions before the cutoff (the footgun)", () => {
    const entries = [
      { id: "a", date: "2025-06-01", source: "manual" },                       // pre-cutoff → footgun
      { id: "b", date: "2025-06-01", source: "opening_balance" },              // opening itself → ignored
      { id: "c", date: "2025-06-01", source: "manual", deleted_at: "x" },      // deleted → ignored
      { id: "d", date: "2026-02-01", source: "manual" },                       // post-cutoff → fine
    ];
    const hits = preCutoffActivity(entries, "2026-01-01");
    expect(hits.map(e => e.id)).toEqual(["a"]);
    expect(hasPreCutoffActivity(entries, "2026-01-01")).toBe(true);
    expect(hasPreCutoffActivity([entries[3]], "2026-01-01")).toBe(false);
  });
});
