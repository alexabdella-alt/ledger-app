import { describe, it, expect } from "vitest";
import {
  plainCategoryPhrase, describeBooking, clarificationChips, inferRole,
  answerToAccount, containsOwnerJargon,
} from "../src/lib/clarify.js";
import { recallVendor, learnFromBooking, emptyProfile } from "../src/lib/clientProfile.js";
import { shouldFlagForReview, autoBookDecision } from "../src/lib/confidenceFlag.js";
import { AI_CONFIDENCE_ASK_FLOOR } from "../src/lib/constants.js";

// ════════════════════════════════════════════════════════════════════════════
// Clarification-flow redesign — confidence-gated, transparent, plain-language.
// Mirrors how a real bookkeeper works: book when confident, ask (in plain words)
// only when genuinely unsure, and describe every booking without accounting jargon.
// ════════════════════════════════════════════════════════════════════════════

const ACCTS = {
  insurance: { code: "6700", name: "Insurance" },
  technology_software: { code: "6500", name: "Technology & Software" },
  rent_occupancy: { code: "6100", name: "Rent & Occupancy" },
  professional_services: { code: "6800", name: "Professional Services" },
  travel_entertainment: { code: "6400", name: "Travel & Entertainment" },
  utilities: { code: "6200", name: "Utilities" },
  marketing_advertising: { code: "6300", name: "Marketing & Advertising" },
  office_supplies: { code: "6600", name: "Office Supplies" },
  salaries_wages: { code: "6000", name: "Salaries & Wages" },
};
const getAccountByRole = (r) => ACCTS[r] || null;

describe("(2) plainCategoryPhrase — plain-language voice, never an account name or GL code", () => {
  it("catering / meals → 'a client meal'", () => {
    expect(plainCategoryPhrase({ vendor: "Bella Vita Catering", gl_code: "6400", gl_name: "Travel & Entertainment" })).toBe("a client meal");
    expect(plainCategoryPhrase({ vendor: "Acme", gl_code: "6400", meals_pct: 50 })).toBe("a client meal");
  });
  it("maps common default accounts to human phrases", () => {
    expect(plainCategoryPhrase({ gl_code: "6100", gl_name: "Rent & Occupancy" })).toBe("rent");
    expect(plainCategoryPhrase({ gl_code: "6500", gl_name: "Technology & Software" })).toBe("software");
    expect(plainCategoryPhrase({ gl_code: "6700", gl_name: "Insurance" })).toBe("insurance");
    expect(plainCategoryPhrase({ gl_code: "6600", gl_name: "Office Supplies" })).toBe("office supplies");
  });
  it("resolves by account NAME when the code was renumbered", () => {
    expect(plainCategoryPhrase({ gl_code: "9123", gl_name: "Software Subscriptions" })).toBe("software");
  });
  it("revenue → 'income'; genuinely unknown → a safe generic (still plain)", () => {
    expect(plainCategoryPhrase({ gl_code: "4000", gl_name: "Service Revenue", type: "revenue" })).toBe("income");
    expect(plainCategoryPhrase({ gl_code: "7100", gl_name: "Miscellaneous" })).toBe("a general business expense");
  });
  it("NEVER emits accounting jargon or a GL code, across every default account", () => {
    for (const [role, a] of Object.entries(ACCTS)) {
      const phrase = plainCategoryPhrase({ gl_code: a.code, gl_name: a.name });
      expect(containsOwnerJargon(phrase), `${role} → "${phrase}"`).toBe(false);
    }
  });
});

describe("(2) describeBooking — the transparent, non-interrupting auto-book record", () => {
  it("reads exactly like the spec example", () => {
    const s = describeBooking({ vendor: "Bella Vita Catering", amount: 477.38, gl_code: "6400", gl_name: "Travel & Entertainment" });
    expect(s).toBe("Booked Bella Vita Catering ($477.38) as a client meal.");
  });
  it("degrades gracefully with no amount / no vendor, still jargon-free", () => {
    expect(describeBooking({ gl_code: "6100", gl_name: "Rent & Occupancy" })).toMatch(/^Booked .* as rent\.$/);
    for (const inv of [
      { vendor: "AWS", amount: 30, gl_code: "6500", gl_name: "Technology & Software" },
      { vendor: "The Hartford", amount: 9000, gl_code: "6700", gl_name: "Insurance" },
      { vendor: "Stripe", amount: 5000, gl_code: "4000", gl_name: "Service Revenue", type: "revenue" },
    ]) expect(containsOwnerJargon(describeBooking(inv)), describeBooking(inv)).toBe(false);
  });
});

describe("(3) clarificationChips — a plain guess chip, only when confident, that round-trips", () => {
  it("offers ONE plain chip for a strong guess, and it maps back to the same category", () => {
    const inv = { vendor: "WeWork", gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 72 };
    const chips = clarificationChips(inv);
    expect(chips).toHaveLength(1);
    expect(containsOwnerJargon(chips[0].label)).toBe(false);
    // clicking the chip resolves deterministically via answerToAccount
    expect(answerToAccount(chips[0].answer, { getAccountByRole }).gl_code).toBe("6100");
  });
  it("no chip when the AI is NOT confident (a real bookkeeper wouldn't guess out loud)", () => {
    expect(clarificationChips({ gl_code: "6100", gl_name: "Rent & Occupancy", confidence: 30 })).toEqual([]);
  });
  it("no chip on revenue (income isn't chip-categorized here)", () => {
    expect(clarificationChips({ gl_code: "4000", gl_name: "Service Revenue", type: "revenue", confidence: 90 })).toEqual([]);
  });
  it("chip labels never leak jargon across categories", () => {
    for (const a of Object.values(ACCTS)) {
      for (const chip of clarificationChips({ gl_code: a.code, gl_name: a.name, confidence: 80 })) {
        expect(containsOwnerJargon(chip.label), chip.label).toBe(false);
      }
    }
  });
});

describe("(1) confidence gate — ask below the floor, else materiality-gated by O49", () => {
  // The floor is a single, clearly-named, easily-tunable constant (adjustable from real-use data).
  it("exposes AI_CONFIDENCE_ASK_FLOOR as a locatable constant (~70, the starting value)", () => {
    expect(typeof AI_CONFIDENCE_ASK_FLOOR).toBe("number");
    expect(AI_CONFIDENCE_ASK_FLOOR).toBe(70);
  });

  it("a 65%-confident item ASKS even though it's small (below the floor = near coin-flip)", () => {
    const d = autoBookDecision({ amount: 40, confidence: 65 });
    expect(d.autoBook).toBe(false);
    expect(d.reason).toBe("below_confidence_floor");
  });
  it("an 80%-confident SMALL item auto-books (above floor, immaterial → no interruption)", () => {
    const d = autoBookDecision({ amount: 120, confidence: 80 });
    expect(d.autoBook).toBe(true);
    expect(d.reason).toBe("confident");
  });
  it("just below the floor asks; at the floor books (boundary is exact)", () => {
    expect(autoBookDecision({ amount: 500, confidence: AI_CONFIDENCE_ASK_FLOOR - 1 }).autoBook).toBe(false);
    expect(autoBookDecision({ amount: 500, confidence: AI_CONFIDENCE_ASK_FLOOR }).autoBook).toBe(true);
  });
  it("above the floor still defers to O49: uncertain AND material → asks", () => {
    const d = autoBookDecision({ amount: 4000, confidence: 72 });   // 72 ≥ floor, but material + <75
    expect(d.autoBook).toBe(false);
    expect(d.reason).toBe("flagged_uncertain_material");
  });
  it("no amount → can't book, so it asks", () => {
    expect(autoBookDecision({ amount: 0, confidence: 99 })).toMatchObject({ autoBook: false, reason: "missing_amount" });
  });
  // O49 itself is unchanged — the floor is layered ON TOP in the trigger, not inside O49.
  it("O49 still treats a tiny uncertain item as immaterial (the floor is the added guard)", () => {
    expect(shouldFlagForReview({ amount: 40, confidence: 20 }).flagged).toBe(false);
  });
});

describe("(4) learned-vendor decay — questions taper off as the business's patterns are learned", () => {
  it("recallVendor returns nothing until a vendor is booked at least twice", () => {
    let p = emptyProfile();
    p = learnFromBooking(p, { vendor: "Bella Vita Catering", gl_code: "6400", gl_name: "Travel & Entertainment", amount: 400, date: "2026-01-01" });
    expect(recallVendor(p, "Bella Vita Catering")).toBeNull();               // seen once → still ask
    p = learnFromBooking(p, { vendor: "Bella Vita Catering", gl_code: "6400", gl_name: "Travel & Entertainment", amount: 500, date: "2026-02-01" });
    const hit = recallVendor(p, "Bella Vita Catering");                       // seen twice → recall it
    expect(hit).toMatchObject({ gl_code: "6400" });
    expect(hit.count).toBe(2);
  });
  it("recall is case-insensitive and null for unknown vendors", () => {
    let p = emptyProfile();
    p = learnFromBooking(p, { vendor: "AWS", gl_code: "6500", gl_name: "Technology & Software", amount: 20, date: "2026-01-01" });
    p = learnFromBooking(p, { vendor: "AWS", gl_code: "6500", gl_name: "Technology & Software", amount: 22, date: "2026-02-01" });
    expect(recallVendor(p, "aws")?.gl_code).toBe("6500");
    expect(recallVendor(p, "Never Seen Co")).toBeNull();
  });
});
