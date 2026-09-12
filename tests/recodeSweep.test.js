import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { planRecodeSweep } from "../src/lib/recodeSweep.js";

// O105 (C339) — correct one supplier's category and be OFFERED the rest, never handed them.
const row = (id, vendor, gl_code, date, extra = {}) => ({ id, vendor, gl_code, date, status: "booked", ...extra });
const rows = [
  row("s", "Sysco Central Texas", "5010", "2026-08-21"),        // the subject
  row("a", "Sysco Central Texas", "5010", "2026-08-07"),
  row("b", "SYSCO CENTRAL TEXAS LLC", "5010", "2026-07-30"),    // same supplier, other spelling (key, not name)
  row("c", "Sysco Central Texas", "6600", "2026-08-14"),        // already elsewhere — not on the account just left
  row("d", "Sysco Central Texas", "5010", "2026-06-12"),        // June — signed
  row("e", "Roma Cheese", "5010", "2026-08-09"),                // different supplier
  row("f", "Sysco Central Texas", "5010", "2026-08-02", { deleted_at: "2026-08-03" }),   // removed
  row("g", "Sysco Central Texas", "5010", "2026-05-12"),        // May — signed
];
const isSigned = (r) => String(r.date).slice(0, 7) <= "2026-06";

describe("planRecodeSweep", () => {
  it("★ names the same supplier's LIVE entries on the account just left, by key not spelling, minus the subject", () => {
    const p = planRecodeSweep({ rows, subject: rows[0], fromCode: "5010", toCode: "6600", toName: "Kitchen Supplies", isSigned });
    expect(p.eligible.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(p.blocked.map((r) => r.id).sort()).toEqual(["d", "g"]);
    expect(p.sentence).toBe("Also change the other 2 Sysco Central Texas entries to Kitchen Supplies? 2 more are in months already signed off and stay as they are.");
  });
  it("★★ a signed month is COUNTED and never in `eligible` — the sweep cannot rewrite a closed month", () => {
    const p = planRecodeSweep({ rows, subject: rows[0], fromCode: "5010", toCode: "6600", isSigned: () => true });
    expect(p.eligible).toEqual([]);
    expect(p.blocked.length).toBe(4);
    expect(p.sentence).toMatch(/^4 more are in months already signed off/);
  });
  it("offers nothing when there is nothing to offer, and nothing when from and to are the same account", () => {
    expect(planRecodeSweep({ rows, subject: rows[5], fromCode: "5010", toCode: "6600", isSigned }).sentence).toBeNull();
    expect(planRecodeSweep({ rows, subject: rows[0], fromCode: "5010", toCode: "5010", isSigned }).eligible).toEqual([]);
  });
  it("singular copy for one entry", () => {
    const p = planRecodeSweep({ rows: [rows[0], rows[1]], subject: rows[0], fromCode: "5010", toCode: "6600", toName: "Kitchen Supplies", isSigned });
    expect(p.sentence).toBe("Also change the other 1 Sysco Central Texas entry to Kitchen Supplies?");
  });
});

describe("the panel offers the sweep after a recode and hands persistRecode ONLY the eligible rows", () => {
  const src = fs.readFileSync(new URL("../src/components/TransactionDetailPanel.jsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  it("plans with the real signed-period rule, after the FIRST recode succeeded", () => {
    const fn = src.slice(src.indexOf("const doRecode = async"), src.indexOf("const reversedInfo") > 0 ? src.indexOf("const reversedInfo") : src.length);
    expect(fn).toMatch(/if \(ok\) \{[\s\S]{0,600}planRecodeSweep\(\{ rows: invoices, subject: inv, fromCode: before\.gl_code, toCode: acct\.code/);
    expect(fn).toMatch(/isSigned: \(r\) => !!signedPeriodForDate\(r\.date, signoffs, \{ source: r\.source \}\)/);
  });
  it("the sweep writes `eligible` and nothing else, through the same persistRecode, and paints only on success", () => {
    const fn = src.slice(src.indexOf("const runSweep = async"), src.indexOf("const doRecode = async"));
    expect(fn).toMatch(/persistRecode\(eligible\.map\(i => \(\{ \.\.\.i, gl_code: acct\.code \}\)\), acct\.code, acct\.name\)/);
    expect(fn).toMatch(/if \(ok\) \{\s*const ids = new Set\(eligible/);
    expect(fn).not.toMatch(/blocked/);
  });
  it("the offer is a question with a No, and a signed-only offer has no button to press", () => {
    expect(src).toMatch(/No, just this one/);
    expect(src).toMatch(/\{sweepOffer\.eligible\.length > 0 && \(/);
  });
});
