import { describe, it, expect } from "vitest";
import { findDuplicate, detectRecurringPatterns, normVendor, toCSV, runAnomalyDetection } from "../src/lib/insights.js";

// ── Item 10: duplicate detection ───────────────────────────────────────────
describe("findDuplicate", () => {
  const existing = [
    { id: 1, vendor: "Acme Corp", amount: 1200, date: "2026-03-01", status: "posted" },
    { id: 2, vendor: "Globex LLC", amount: 75.5, date: "2026-03-10", status: "posted" },
  ];

  it("flags an exact amount + same vendor re-upload regardless of date", () => {
    const dup = findDuplicate({ vendor: "ACME CORP", amount: 1200, date: "2026-08-01" }, existing);
    expect(dup?.id).toBe(1); // normalized vendor + exact amount, months apart
  });

  it("flags same vendor + amount within 1% + within 7 days", () => {
    const dup = findDuplicate({ vendor: "Globex", amount: 76, date: "2026-03-14" }, existing);
    expect(dup?.id).toBe(2); // 76 vs 75.5 ≈ 0.66% and 4 days apart
  });

  it("does NOT flag a different amount on a far date", () => {
    const dup = findDuplicate({ vendor: "Acme Corp", amount: 999, date: "2026-06-01" }, existing);
    expect(dup).toBeNull();
  });

  it("does NOT flag a different vendor", () => {
    expect(findDuplicate({ vendor: "Initech", amount: 1200, date: "2026-03-01" }, existing)).toBeNull();
  });

  it("ignores voided / soft-deleted existing entries", () => {
    const ex = [{ id: 9, vendor: "Acme Corp", amount: 1200, date: "2026-03-01", status: "voided" }];
    expect(findDuplicate({ vendor: "Acme Corp", amount: 1200, date: "2026-03-01" }, ex)).toBeNull();
  });

  it("normalizes vendor names (legal suffixes, punctuation, case)", () => {
    expect(normVendor("Acme, Inc.")).toBe(normVendor("ACME"));
    expect(normVendor("Globex LLC")).toBe("globex");
  });
});

// ── Item 62-adjacent: recurring pattern detection ──────────────────────────
describe("detectRecurringPatterns", () => {
  const now = new Date("2026-06-15");
  const mk = (vendor, amount, date) => ({ vendor, amount, date, gl_code: "6500", gl_name: "Technology & Software", status: "posted" });

  it("detects a ~monthly, similar-amount vendor not already recurring", () => {
    const invoices = [
      mk("Slack", 28, "2026-04-02"),
      mk("Slack", 29, "2026-05-03"),
      mk("Slack", 28.5, "2026-06-02"),
    ];
    const out = detectRecurringPatterns(invoices, [], now);
    expect(out).toHaveLength(1);
    expect(out[0].vendor).toBe("Slack");
    expect(out[0].count).toBe(3);
    expect(out[0].avgAmount).toBeCloseTo(28.5, 2);
    expect(out[0].gl_code).toBe("6500");
  });

  it("skips vendors that already have a recurring rule", () => {
    const invoices = [mk("Slack", 28, "2026-04-02"), mk("Slack", 28, "2026-05-02")];
    const out = detectRecurringPatterns(invoices, [{ vendor: "Slack" }], now);
    expect(out).toHaveLength(0);
  });

  it("ignores irregular cadence and one-off charges", () => {
    const irregular = [mk("Random", 50, "2026-01-01"), mk("Random", 50, "2026-06-01")]; // ~5 months apart
    expect(detectRecurringPatterns(irregular, [], now)).toHaveLength(0);
    const oneoff = [mk("Once", 100, "2026-05-01")];
    expect(detectRecurringPatterns(oneoff, [], now)).toHaveLength(0);
  });

  it("ignores amounts that vary by more than 10%", () => {
    const varying = [mk("Spiky", 100, "2026-04-01"), mk("Spiky", 200, "2026-05-01"), mk("Spiky", 100, "2026-06-01")];
    expect(detectRecurringPatterns(varying, [], now)).toHaveLength(0);
  });
});

// ── Item 32: anomaly detection ─────────────────────────────────────────────
describe("runAnomalyDetection", () => {
  const now = new Date("2026-06-15");
  const mk = (id, vendor, amount, date, gl_code = "6500", extra = {}) => ({ id, vendor, amount, date, gl_code, gl_name: "Technology & Software", status: "posted", ...extra });

  it("flags a vendor spike (latest ≥ 2× the average)", () => {
    const out = runAnomalyDetection([
      mk(1, "AWS", 297, "2026-04-10"),
      mk(2, "AWS", 305, "2026-05-10"),
      mk(3, "AWS", 892, "2026-06-10"), // ~3× baseline
    ], [], now);
    const a = out.find(x => x.type === "vendor_spike");
    expect(a).toBeTruthy();
    expect(a.severity).toBe("high");
    expect(a.invoice_ids).toContain(3);
  });

  it("flags a large single transaction not capitalized, but not one on an asset account", () => {
    const out = runAnomalyDetection([
      mk(1, "Dell", 4200, "2026-06-01"),                 // large expense → flagged
      mk(2, "Dell", 9000, "2026-06-02", "1500"),         // asset (capitalized) → not flagged
    ], [], now);
    const large = out.filter(x => x.type === "large_transaction");
    expect(large).toHaveLength(1);
    expect(large[0].invoice_ids).toContain(1);
  });

  it("flags round-number amounts as low severity", () => {
    const out = runAnomalyDetection([mk(1, "Estimate Co", 2000, "2026-06-01")], [], now);
    const r = out.find(x => x.type === "round_number");
    expect(r?.severity).toBe("low");
  });

  it("returns nothing for normal, varied activity", () => {
    const out = runAnomalyDetection([
      mk(1, "Cafe", 12.4, "2026-06-01"),
      mk(2, "Office Depot", 47.9, "2026-06-03"),
    ], [], now);
    expect(out).toHaveLength(0);
  });

  it("orders results by severity (high first)", () => {
    const out = runAnomalyDetection([
      mk(1, "AWS", 100, "2026-04-10"), mk(2, "AWS", 100, "2026-05-10"), mk(3, "AWS", 3000, "2026-06-10"),
    ], [], now);
    if (out.length > 1) expect(out[0].severity).toBe("high");
  });
});

// ── CSV export helper ──────────────────────────────────────────────────────
describe("toCSV", () => {
  it("builds CSV and escapes commas/quotes/newlines", () => {
    const csv = toCSV(["Name", "Amount"], [["Acme, Inc.", "$1,200"], ['He said "hi"', "5"]]);
    expect(csv).toBe('Name,Amount\n"Acme, Inc.","$1,200"\n"He said ""hi""",5');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// O83 Feb — duplicate_payment must use a TIGHT date window on EXACT matches too.
// The old exact branch returned "any date", so legitimate same-amount recurring
// charges (biweekly payroll, monthly insurance) flagged as "duplicate within a
// week" 14–29 days apart. The window (7 days) now matches the copy.
// ════════════════════════════════════════════════════════════════════════════
const NOW_DUP = new Date("2026-03-01T12:00:00Z");
const exp = (id, vendor, amount, date) => ({ id, vendor, amount, date, gl_code: "6000", gl_name: "Salaries", status: "posted" });
const dupFlags = (ledger) => runAnomalyDetection(ledger, [], NOW_DUP).filter(a => a.type === "duplicate_payment");

describe("duplicate_payment — tight window excludes legitimate recurring same-amount vendors", () => {
  it("biweekly payroll (4 × $3,150, 14-day spacing) → ZERO duplicate flags", () => {
    const ledger = [
      exp("g1", "Gusto Payroll", 3150, "2026-01-15"),
      exp("g2", "Gusto Payroll", 3150, "2026-01-30"),
      exp("g3", "Gusto Payroll", 3150, "2026-02-13"),
      exp("g4", "Gusto Payroll", 3150, "2026-02-27"),
    ];
    expect(dupFlags(ledger)).toHaveLength(0);
  });

  it("monthly insurance across two months (2 × $264.50, 29 days apart) → ZERO duplicate flags", () => {
    const ledger = [
      exp("h1", "Hartline Insurance", 264.50, "2026-01-22"),
      exp("h2", "Hartline Insurance", 264.50, "2026-02-20"),
    ];
    expect(dupFlags(ledger)).toHaveLength(0);
  });

  it("the linen bait (3 × $145, 7-day spacing) → EXACTLY 2 flags (the adjacent pairs)", () => {
    const ledger = [
      exp("b1", "Bluebonnet Linen", 145, "2026-02-01"),
      exp("b2", "Bluebonnet Linen", 145, "2026-02-08"),
      exp("b3", "Bluebonnet Linen", 145, "2026-02-15"),
    ];
    const flags = dupFlags(ledger);
    expect(flags).toHaveLength(2);
    // adjacent pairs only — never the 14-day-apart (b1,b3) pair. Asserted on the linked
    // entries rather than the fingerprint string: C198·3b (f3) re-keyed emission onto
    // CONTENT (vendor + amount + dates) so a re-upload can't mint a second card, and the
    // pairing — which is what this test is actually about — is unchanged by that.
    const pairs = flags.map(f => [...f.invoice_ids].sort().join("-")).sort();
    expect(pairs).toEqual(["b1-b2", "b2-b3"]);
  });

  it("same-day identical charges → a flag (0 days apart, the genuine double-pay)", () => {
    const ledger = [
      exp("s1", "Sysco", 500, "2026-02-10"),
      exp("s2", "Sysco", 500, "2026-02-10"),
    ];
    expect(dupFlags(ledger)).toHaveLength(1);
  });
});

describe("findDuplicate windowDays — exact matches respect the window when set", () => {
  const existing = [{ id: 1, vendor: "Gusto", amount: 3150, date: "2026-01-15", status: "posted" }];
  it("exact amount 14 days apart with windowDays:7 → null (not a duplicate)", () => {
    expect(findDuplicate({ vendor: "Gusto", amount: 3150, date: "2026-01-29" }, existing, { windowDays: 7 })).toBeNull();
  });
  it("exact amount 5 days apart with windowDays:7 → flagged", () => {
    expect(findDuplicate({ vendor: "Gusto", amount: 3150, date: "2026-01-20" }, existing, { windowDays: 7 })?.id).toBe(1);
  });
  it("default (no window) still flags an exact re-upload at any date (booking/QBO guard preserved)", () => {
    expect(findDuplicate({ vendor: "Gusto", amount: 3150, date: "2026-09-01" }, existing)?.id).toBe(1);
  });
});
