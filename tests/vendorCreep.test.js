import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { vendorCreep, vendorCreepCopy, CREEP_MIN_SIGNED_MONTHS } from "../src/lib/vendorCreep.js";
import { activeSignedPeriods } from "../src/lib/signoff.js";

// O104 (C344) — "which suppliers are creeping up", from SIGNED months only.
const row = (id, vendor, amount, date, extra = {}) => ({ id, vendor, vendor_key: vendor.toLowerCase(), amount, date, gl_code: "5010", status: "booked", ...extra });
const ledger = [
  // Sysco: 2,000 / 2,100 / 2,000 in May–July, then 3,000 in August (the latest signed month)
  row("s1", "Sysco", 2000, "2026-05-10"), row("s2", "Sysco", 2100, "2026-06-10"), row("s3", "Sysco", 2000, "2026-07-10"), row("s4", "Sysco", 3000, "2026-08-10"),
  // Roma: flat
  row("r1", "Roma", 800, "2026-05-12"), row("r2", "Roma", 800, "2026-06-12"), row("r3", "Roma", 800, "2026-07-12"), row("r4", "Roma", 820, "2026-08-12"),
  // Bluebonnet: one prior month only — no "usual" to speak of
  row("b1", "Bluebonnet", 145, "2026-07-03"), row("b2", "Bluebonnet", 300, "2026-08-03"),
  // September: unsigned, Sysco spikes hugely — MUST NOT be read
  row("s9", "Sysco", 9000, "2026-09-10"),
  // a correcting credit on Sysco in August (subtracts)
  row("s4c", "Sysco", 200, "2026-08-20", { debit_credit: "credit" }),
];
const signed = ["2026-05", "2026-06", "2026-07", "2026-08"];

describe("vendorCreep", () => {
  it("★ names the supplier whose LATEST SIGNED month is ≥25% above the average of the signed months before it", () => {
    const r = vendorCreep({ rows: ledger, signedPeriods: signed });
    expect(r.ok).toBe(true);
    expect(r.latest).toBe("2026-08");
    expect(r.items.map((i) => i.vendor)).toEqual(["Sysco"]);
    expect(r.items[0].latest).toBe(2800);                 // 3,000 less the 200 credit
    expect(r.items[0].usual).toBeCloseTo(2033.33, 2);
  });
  it("★★ reads ONLY signed months — an unsigned September spike does not exist for this report", () => {
    const r = vendorCreep({ rows: ledger, signedPeriods: ["2026-05", "2026-06", "2026-07"] });
    expect(r.latest).toBe("2026-07");
    expect(r.items).toEqual([]);                          // July was ordinary
  });
  it("one prior month is a coincidence, not a usual", () => {
    const r = vendorCreep({ rows: ledger, signedPeriods: signed });
    expect(r.items.find((i) => i.vendor === "Bluebonnet")).toBeUndefined();
  });
  it("refuses to speak with fewer than three signed months, and says so", () => {
    const r = vendorCreep({ rows: ledger, signedPeriods: ["2026-07", "2026-08"] });
    expect(r.ok).toBe(false);
    expect(CREEP_MIN_SIGNED_MONTHS).toBe(3);
    expect(vendorCreepCopy(r).headline).toMatch(/three signed-off months/);
  });
  it("the sentence reads the report — both amounts and the jump", () => {
    const copy = vendorCreepCopy(vendorCreep({ rows: ledger, signedPeriods: signed }), { monthLabel: () => "August 2026" });
    expect(copy.headline).toBe("In August 2026, one supplier charged more than usual:");
    expect(copy.lines[0]).toBe("Sysco: $2800.00, against about $2033.33 a month before — 38% more.");
  });
  it("a quiet month says nothing is creeping, rather than nothing at all", () => {
    const rows = ledger.filter((r) => r.id !== "s4" && r.id !== "s4c");
    expect(vendorCreepCopy(vendorCreep({ rows, signedPeriods: signed }), { monthLabel: () => "August 2026" }).headline)
      .toBe("In August 2026, no supplier charged noticeably more than usual.");
  });
});

describe("the By Vendor report renders it from the ACTIVE sign-offs", () => {
  it("activeSignedPeriods drops a revoked sign-off", () => {
    expect(activeSignedPeriods([{ period: "2026-07" }, { period: "2026-08", revoked_at: "2026-09-01" }, { period: "2026-06" }])).toEqual(["2026-06", "2026-07"]);
  });
  it("ReportsView feeds the report activeSignedPeriods(signoffs), never every month", () => {
    const src = fs.readFileSync(new URL("../src/components/views/ReportsView.jsx", import.meta.url), "utf8");
    expect(src).toMatch(/vendorCreep\(\{ rows: invoices, signedPeriods: activeSignedPeriods\(signoffs\) \}\)/);
  });
});
