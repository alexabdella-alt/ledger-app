import { describe, it, expect } from "vitest";
import { findDuplicate, detectRecurringPatterns, normVendor, toCSV } from "../src/lib/insights.js";

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

// ── CSV export helper ──────────────────────────────────────────────────────
describe("toCSV", () => {
  it("builds CSV and escapes commas/quotes/newlines", () => {
    const csv = toCSV(["Name", "Amount"], [["Acme, Inc.", "$1,200"], ['He said "hi"', "5"]]);
    expect(csv).toBe('Name,Amount\n"Acme, Inc.","$1,200"\n"He said ""hi""",5');
  });
});
