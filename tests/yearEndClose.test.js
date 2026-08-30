import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildYearEndCloseEntry } from "../src/lib/journalEntries";

// ═════════════════════════════════════════════════════════════════════════════
// #17 · YEAR-END CLOSE — the last of the seventeen events to get a builder.
//
// ▶ IT HAS NO CALLER, DELIBERATELY. The product does a DERIVED soft close
// (`fiscalYearSplit`): prior years' net rolls into beginning Retained Earnings without
// posting anything, which is why the balance sheet has been right for multi-year companies
// since that shipped. **Whether to also POST closing entries is an accounting decision about
// locking a year, not a mechanism gap.** The builder exists because §12's rule is that every
// event has a pure builder with a test asserting exact Dr/Cr — this was the only one without
// — so the decision can now be made without also being a build.
// ═════════════════════════════════════════════════════════════════════════════

const RE = "3100";

describe("★★ it zeroes the P&L and plugs the difference", () => {
  it("a profitable year credits retained earnings", () => {
    const e = buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [
      { code: "4000", balance: 10000 }, { code: "6100", balance: 4000 }, { code: "6500", balance: 1000 },
    ]});
    expect(e.balanced).toBe(true);
    expect(e.meta).toMatchObject({ revenue: 10000, expense: 5000, net: 5000 });
    expect(e.lines.find((l) => l.code === RE)).toMatchObject({ debit: 0, credit: 5000 });
  });

  it("★★ a loss DEBITS retained earnings — the plug follows the sign", () => {
    const e = buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [
      { code: "4000", balance: 100 }, { code: "6100", balance: 400 },
    ]});
    expect(e.lines.find((l) => l.code === RE)).toMatchObject({ debit: 300, credit: 0 });
  });

  it("★★★ a year that broke exactly even needs NO plug", () => {
    // Adding a zero line would be a rounding lie — the revenue and expense lines already
    // balance each other.
    //
    // ★★ WHERE THAT GUARANTEE ACTUALLY LIVES, established by a mutation that SURVIVED:
    // making the plug unconditional still produced no line, because `buildJournalEntry`
    // itself drops zero-amount lines. So the protection is doubled — the builder's structure
    // does not emit one, and the entry builder would discard it anyway. **Recording it
    // because "my branch prevents this" was not the whole truth**, and a future reader
    // changing the sign logic needs to know the second net exists.
    const e = buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [
      { code: "4000", balance: 500 }, { code: "6100", balance: 500 },
    ]});
    expect(e.balanced).toBe(true);
    expect(e.lines.some((l) => l.code === RE)).toBe(false);
    expect(e.meta.net).toBe(0);
    // The general invariant, which is the one that matters: no entry carries a zero line.
    expect(e.lines.every((l) => l.debit !== 0 || l.credit !== 0)).toBe(true);
  });

  it("every revenue and expense account gets a line that cancels it", () => {
    const e = buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [
      { code: "4000", balance: 700 }, { code: "4100", balance: 300 }, { code: "5000", balance: 200 }, { code: "8000", balance: 50 },
    ]});
    expect(e.lines.find((l) => l.code === "4000")).toMatchObject({ debit: 700 });   // revenue debited to zero it
    expect(e.lines.find((l) => l.code === "5000")).toMatchObject({ credit: 200 });  // expense credited to zero it
    expect(e.lines.find((l) => l.code === "8000")).toMatchObject({ credit: 50 });
  });
});

describe("★★★ what a close must NEVER do", () => {
  it("★★★ it does not touch a balance-sheet account", () => {
    // Closing is defined as zeroing the P&L. An asset or liability line would move a balance
    // that is supposed to CARRY into the new year — the one thing a close must never do. So
    // passing a whole trial balance in is safe.
    const e = buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [
      { code: "4000", balance: 1000 }, { code: "6100", balance: 400 },
      { code: "1000", balance: 99999 }, { code: "2000", balance: 5000 }, { code: "3000", balance: 1 },
    ]});
    for (const code of ["1000", "2000", "3000"]) {
      expect([code, e.lines.some((l) => l.code === code)]).toEqual([code, false]);
    }
  });

  it("★ a zero balance produces no line — an empty account is already closed", () => {
    const e = buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [
      { code: "4000", balance: 1000 }, { code: "6600", balance: 0 },
    ]});
    expect(e.lines.some((l) => l.code === "6600")).toBe(false);
  });

  it("nothing to close produces nothing, not an empty entry", () => {
    expect(buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [] })).toBeNull();
    expect(buildYearEndCloseEntry({ retainedEarningsCode: RE, balances: [{ code: "1000", balance: 500 }] })).toBeNull();
    expect(buildYearEndCloseEntry({ balances: [{ code: "4000", balance: 500 }] })).toBeNull();  // no RE account
  });
});

describe("★★ the no-caller decision is recorded where someone would wire it", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/journalEntries.js"), "utf8");

  it("★★★ the file says it must not be wired without the decision, and why", () => {
    // O129's lesson was that dead plumbing which LOOKS wired gets punished. This is the
    // opposite — deliberately unwired — so the reason has to sit where the next person looks.
    // ★ MATCHED ON THE COMMENT TEXT WITH ITS WRAPPING REMOVED. The phrase spans a line break
    // and a `//` prefix, so a plain regex misses it — a test that fails because prose was
    // wrapped, not because the prose is absent. Same family as the anchor and slice slips.
    const prose = src.split("\n").map((l) => l.replace(/^\s*\/\/\s?/, "")).join(" ");
    expect(prose).toMatch(/THIS BUILDER HAS NO CALLER, DELIBERATELY/);
    expect(prose).toMatch(/posting a close is not reversible by re-running it/);
    expect(prose).toMatch(/a second close on the same year would double the roll/);
  });

  it("★★ and it is genuinely uncalled — no surface posts a close today", () => {
    // If this ever fails, someone wired it: that is the moment the decision was needed.
    const files = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.(js|jsx)$/.test(f.name)) files.push(full);
      }
    })(path.join(process.cwd(), "src"));
    const callers = files.filter((f) => !f.endsWith("journalEntries.js"))
      .filter((f) => /buildYearEndCloseEntry/.test(fs.readFileSync(f, "utf8")));
    expect(callers).toEqual([]);
  });
});
