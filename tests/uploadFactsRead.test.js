import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildUploadedInvoice } from "../src/lib/uploadedInvoice";
import { autoBookDecision, missingFact } from "../src/lib/confidenceFlag";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants";

// C598 — review finding U7: the AI's amount and date were used unread.
const byRole = (r) => DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.system_role === r) || null;
const build = (extracted, rule = null) => buildUploadedInvoice({
  extracted: { vendor: "Lone Star", ...extracted }, coding: { gl_code: "5000", gl_name: "COGS", confidence: 95 }, rule,
  rc: (r) => byRole(r)?.code, rn: (r) => byRole(r)?.name, id: 1, bookedAt: "x", today: "2026-11-12",
}).invoice;

describe("the amount is read as money", () => {
  it.each([["1,344.85", 1344.85], ["$1,344.85", 1344.85], ["1344.85", 1344.85], [1344.85, 1344.85], ["(25.00)", -25], ["", 0], ["about forty", 0], [null, 0]])("%s → %s", (raw, want) => {
    expect(build({ amount: raw, date: "2026-03-01" }).amount).toBe(want);
  });
  it("★ a thousands separator no longer books $1", () => {
    expect(build({ amount: "1,344.85", date: "2026-03-01" }).amount).not.toBe(1);
  });
  it("the tax is read the same way", () => {
    expect(build({ amount: "1,100.00", tax_amount: "1,00.00", date: "2026-03-01" }).tax_amount).toBe(100);
  });
});

describe("no date is not today", () => {
  it("★ a missing date stays empty and is marked", () => {
    const inv = build({ amount: "50", date: "" });
    expect(inv.date).toBe("");
    expect(inv.date_missing).toBe(true);
    expect(inv.due_date).toBeNull();
  });
  it("a US-style date is read; nonsense is missing", () => {
    expect(build({ amount: "50", date: "03/14/2026" }).date).toBe("2026-03-14");
    expect(build({ amount: "50", date: "sometime in March" }).date_missing).toBe(true);
  });
  it("★ a missing date asks — and an answered one clears it", () => {
    const inv = build({ amount: "50", date: "" });
    expect(autoBookDecision(inv)).toEqual({ autoBook: false, reason: "missing_date" });
    expect(missingFact({ ...inv, date: "2026-03-01" })).toBeNull();
  });
});

describe("certainty about the category does not supply a missing fact", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("★ a vendor rule books straight through only when the amount and date are there", () => {
    expect(app).toMatch(/if \(\(rule && !MISSING_FACT_REASONS\.has\(decision\.reason\)\) \|\| decision\.autoBook\) \{/);
  });
  it("★ a recognised income document with a missing fact is asked about", () => {
    expect(app).toMatch(/\} else if \(extracted\._direction === "revenue" && !missingFact\(invoice\)\) \{\s*\n\s*highConfidence\.push\(invoice\);\s*\n\s*\} else if \(extracted\._direction === "revenue"\) \{/);
  });
  it("the card asks for the date first when there is none", () => {
    const flow = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(flow).toMatch(/if \(!inv\.date\)\s*\n\s*pre\.push\(\{ field: "date", type: "date", prompt: "What date was this from\?"/);
  });
});
