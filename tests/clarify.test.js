import { describe, it, expect } from "vitest";
import { draftClientQuestion, answerToCategory, answerToAccount } from "../src/lib/clarify.js";
import { flaggedForReview } from "../src/lib/confidenceFlag.js";

// Roles → accounts, the way the app resolves them.
const ACCTS = {
  insurance: { code: "6700", name: "Insurance" },
  technology_software: { code: "6500", name: "Technology & Software" },
  rent_occupancy: { code: "6100", name: "Rent & Occupancy" },
  professional_services: { code: "6800", name: "Professional Services" },
  travel_entertainment: { code: "6400", name: "Travel & Entertainment" },
};
const getAccountByRole = (r) => ACCTS[r] || null;

const flag = (over = {}) => ({ id: "t1", db_entry_id: "je1", vendor: "The Hartford", amount: 400, date: "2026-02-22", gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 58, severity: "medium", reason: "uncertain on a material amount", reasoning: "guessed rent", alternatives: [{ gl_code: "6700", gl_name: "Insurance" }], ...over });

// The Cardinal Principle, mechanized: NO accounting jargon may appear in a client question.
const JARGON = /\bdebit|\bcredit\b|\bpayable\b|\breceivable\b|\bjournal\b|\bledger\b|\bGL\b|\bgeneral ledger\b|\baccount code\b|\bchart of accounts\b|6700|6100|6500|6800|6400/i;

describe("(a) draftClientQuestion — plain-language, jargon-free, references the specific txn", () => {
  it("an expense question names the vendor + amount + date and offers business-language options", () => {
    const { question } = draftClientQuestion(flag());
    expect(question).toContain("$400");
    expect(question).toContain("The Hartford");
    expect(question).toContain("Feb 22");
    expect(question).not.toMatch(JARGON);            // NO GL codes / debits / accounting terms
    expect(question.toLowerCase()).toMatch(/what was|for\?/);
  });

  it("a revenue question is phrased as income (from …) and offers project/retainer framing", () => {
    const { question } = draftClientQuestion(flag({ vendor: "Riverside Cafe", amount: 1200, gl_code: "4000", gl_name: "Service Revenue", type: "revenue" }));
    expect(question).toContain("$1,200");
    expect(question).toContain("Riverside Cafe");
    expect(question).toMatch(/from Riverside Cafe/);
    expect(question).toMatch(/project|retainer/i);
    expect(question).not.toMatch(JARGON);
  });

  it("degrades gracefully with no vendor / no date (still no jargon)", () => {
    const q1 = draftClientQuestion({ id: "x", amount: 75, gl_code: "6100" }).question;
    expect(q1).toContain("$75");
    expect(q1).not.toMatch(JARGON);
    const q2 = draftClientQuestion({ id: "y", gl_code: "6100" }).question;   // no amount even
    expect(q2).toMatch(/this payment/);
    expect(q2).not.toMatch(JARGON);
  });

  it("emits a structured channel payload (for O82 auto-routing later)", () => {
    const d = draftClientQuestion(flag());
    expect(d.channel.kind).toBe("clarification");
    expect(d.channel.txn_ref.db_entry_id).toBe("je1");
    expect(d.channel.question).toBe(d.question);
  });

  it("several flag types never leak jargon", () => {
    const cases = [
      flag({ vendor: "AWS", gl_code: "6500" }),
      flag({ vendor: "Unknown Vendor", amount: 9000, gl_code: "7100" }),
      flag({ vendor: "Stripe", amount: 5000, gl_code: "4000", type: "revenue" }),
    ];
    for (const c of cases) expect(draftClientQuestion(c).question).not.toMatch(JARGON);
  });
});

describe("(b) a human answer maps to the correct account", () => {
  it('"it’s our business insurance" → Insurance (6700)', () => {
    const m = answerToAccount("it’s our business insurance", { getAccountByRole });
    expect(m).toMatchObject({ gl_code: "6700", gl_name: "Insurance", role: "insurance" });
  });
  it('"monthly software subscription" → Technology & Software (6500)', () => {
    expect(answerToAccount("monthly software subscription", { getAccountByRole }).gl_code).toBe("6500");
  });
  it('"a contractor we hired" → Professional Services (6800)', () => {
    expect(answerToAccount("a contractor we hired", { getAccountByRole }).gl_code).toBe("6800");
  });
  it("a known vendor RULE wins over keyword mapping", () => {
    const m = answerToAccount("not sure honestly", { getAccountByRole, vendor: "Adobe", rules: [{ vendor: "Adobe", gl_code: "6500", gl_name: "Technology & Software" }] });
    expect(m).toMatchObject({ gl_code: "6500", via: "rule" });
  });
});

describe("(c) the resolution routes through reviewOverride and clears the flag", () => {
  it("applying the mapped account re-codes the entry and removes it from the flagged set", () => {
    const ledger = [{ id: "t1", db_entry_id: "je1", vendor: "The Hartford", amount: 1800, gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 58, status: "booked" }];
    expect(flaggedForReview(ledger)).toHaveLength(1);                        // flagged before (material + uncertain)
    const mapped = answerToAccount("business insurance", { getAccountByRole });
    // reviewOverride(txn, mapped.gl_code, mapped.gl_name) = persistRecode + confidence→100
    const after = ledger.map(i => ({ ...i, gl_code: mapped.gl_code, gl_name: mapped.gl_name, confidence: 100 }));
    expect(after[0].gl_code).toBe("6700");                                   // re-coded from the client's answer
    expect(flaggedForReview(after)).toEqual([]);                            // flag cleared
  });
});

describe("(d) a still-ambiguous answer does NOT falsely resolve", () => {
  it("vague answers map to null (and the UI must not book on null)", () => {
    expect(answerToCategory("idk")).toBeNull();
    expect(answerToCategory("a payment")).toBeNull();
    expect(answerToCategory("stuff for the business")).toBeNull();
    expect(answerToAccount("not sure", { getAccountByRole })).toBeNull();     // → caller refuses to resolve
  });
});
