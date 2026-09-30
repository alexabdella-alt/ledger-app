import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { autoBookDecision, reasoningContradiction, REASONING_CONTRADICTS } from "../src/lib/confidenceFlag";
import { clarificationChips } from "../src/lib/clarify";

// ═════════════════════════════════════════════════════════════════════════════
// C551 — TIER 1 #7, the half that can be built: a confident booking whose OWN explanation
// argues for a different category is asked about, not filed.
//
// ★★★ THE LIVE CASE (O83). A Lone Star food-supplier bill auto-booked to Travel &
// Entertainment at 92% while its stored reasoning read "direct product costs properly
// classified as Cost of Goods Sold". The model was sure — of the other answer.
//
// ★★ HALF THESE TESTS ARE ABOUT SILENCE. A guard like this is judged as much by the questions
// it does NOT ask: the reasoning mentions other things constantly (freight on a produce bill,
// cash, an alternative the model considered), and every false positive is a question the owner
// did not need (O122). A test suite that only proves the check CAN fire proves half of it.
// ═════════════════════════════════════════════════════════════════════════════

const CHART = [
  { code: "1000", name: "Cash", system_role: "cash" },
  { code: "2000", name: "Accounts Payable", system_role: "accounts_payable" },
  { code: "4000", name: "Product Revenue", system_role: "product_revenue" },
  { code: "5000", name: "Cost of Goods Sold", system_role: "cogs" },
  { code: "5010", name: "Food Cost", system_role: "food_cost" },
  { code: "5030", name: "Freight", system_role: "shipping_fulfillment" },
  { code: "6100", name: "Rent & Occupancy", system_role: "rent_occupancy" },
  { code: "6200", name: "Utilities", system_role: "utilities" },
  { code: "6400", name: "Travel & Entertainment", system_role: "travel_entertainment" },
  { code: "6500", name: "Technology & Software (SaaS)", system_role: "technology_software" },
  { code: "6520", name: "Merchant Processing Fees", system_role: "merchant_processing_fees" },
  { code: "6600", name: "Office Supplies & De Minimis Equipment", system_role: "office_supplies" },
  { code: "6800", name: "Professional Services (Legal/Accounting)", system_role: "professional_services" },
  { code: "7100", name: "Miscellaneous Expense", system_role: "miscellaneous_expense" },
  { code: "8000", name: "Interest Expense", system_role: "interest_expense" },
  { code: "6300", name: "Marketing & Advertising", system_role: "marketing_advertising", active: false },
];
const LONE_STAR = {
  vendor: "Lone Star Beverage", amount: 1344.85, confidence: 92, gl_code: "6400", gl_name: "Travel & Entertainment",
  reasoning: "Lone Star supplies beer and mixers for resale — direct product costs properly classified as Cost of Goods Sold.",
};
const decide = (over, chart = CHART) => autoBookDecision({ ...LONE_STAR, ...over }, { chart });

describe("C551 — it asks when the explanation argues for another category", () => {
  it("★★★ the live case: booked Travel & Entertainment, reasoning says Cost of Goods Sold", () => {
    const d = decide({});
    expect(d.autoBook).toBe(false);
    expect(d.reason).toBe(REASONING_CONTRADICTS);
    expect(d.named).toEqual({ code: "5000", name: "Cost of Goods Sold" });
  });

  it("★★ at 99% too — no confidence score can catch this, which is why it reads the words", () => {
    expect(decide({ confidence: 99 }).autoBook).toBe(false);
  });

  it("★ at $12 too — a self-contradiction is worth one question at any amount", () => {
    expect(decide({ amount: 12 }).reason).toBe(REASONING_CONTRADICTS);
  });

  it("the Toast merchant-fee shape: booked Technology & Software, reasoning says Merchant Processing Fees", () => {
    const d = decide({ vendor: "Toast", gl_code: "6500", gl_name: "Technology & Software (SaaS)",
      reasoning: "Monthly Toast fees on card sales; these are properly classified as merchant processing fees." });
    expect(d.reason).toBe(REASONING_CONTRADICTS);
    expect(d.named.code).toBe("6520");
  });

  it("the model's British spelling counts — 'categorised as'", () => {
    expect(decide({ reasoning: "Beer for resale, categorised as Cost of Goods Sold." }).named.code).toBe("5000");
  });

  it("an account named by its CODE counts", () => {
    expect(decide({ reasoning: "Beer for resale, recorded as 5000." }).named.code).toBe("5000");
  });

  it("a parenthetical in the chart's name does not hide it", () => {
    const d = decide({ gl_code: "6600", gl_name: "Office Supplies & De Minimis Equipment",
      reasoning: "Quarterly bookkeeping retainer from the CPA firm — this should be professional services." });
    expect(d.named.code).toBe("6800");
  });

  it("an income account counts as much as an expense one", () => {
    const d = decide({ gl_code: "8000", gl_name: "Interest Expense", reasoning: "Customer payment for goods, classified as product revenue." });
    expect(d.named.code).toBe("4000");
  });
});

describe("C551 — and it stays SILENT on everything that is not a contradiction", () => {
  const silent = (over, chart) => {
    const d = decide(over, chart);
    expect(d.reason, JSON.stringify(d)).not.toBe(REASONING_CONTRADICTS);
    expect(d.autoBook).toBe(true);
  };

  it("reasoning that argues for the account it booked", () => {
    silent({ reasoning: "Beer for a client dinner, classified as Travel & Entertainment." });
  });
  it("★★ 'X rather than Y' is the model agreeing with itself", () => {
    silent({ gl_code: "5000", gl_name: "Cost of Goods Sold",
      reasoning: "Classified as Cost of Goods Sold rather than Travel & Entertainment, since the beer is resold." });
  });
  it("★★★ reasoning that AFFIRMS the booked account and places a portion elsewhere is not a contradiction", () => {
    // Added after a mutation that deleted the "it argues for what it booked" rule survived:
    // the 'rather than' case above never reaches that rule, because the second account sits
    // too far from any cue. This one does — both accounts are asserted, and only the rule
    // that the booked one was argued FOR keeps it silent.
    silent({ gl_code: "5000", gl_name: "Cost of Goods Sold",
      reasoning: "Beer for resale recorded as cost of goods sold; the delivery fee is treated as freight." });
  });
  it("★★★ the three-word window is what keeps a LATER incidental mention from counting", () => {
    // Added after a mutation widening the window to forty words survived: the freight case
    // below has no cue at all, so it never exercised the distance. Here a cue opens the
    // sentence and the account appears as an aside, far from it.
    silent({ vendor: "Sysco", gl_code: "5010", gl_name: "Food Cost",
      reasoning: "Weekly produce order recorded from the Sysco invoice for the kitchen line, freight included." });
  });
  it("★★ a denial is not a claim — 'not classified as Utilities'", () => {
    silent({ gl_code: "6100", gl_name: "Rent & Occupancy", reasoning: "Monthly lease payment; not classified as utilities despite the water line item." });
  });
  it("★★ a considered alternative is the model showing its work — 'could also be classified as'", () => {
    silent({ gl_code: "6500", gl_name: "Technology & Software (SaaS)",
      reasoning: "Adobe subscription for design software; could also be classified as office supplies but software fits better." });
  });
  it("★★★ an INCIDENTAL mention is not a claim — freight on a produce invoice", () => {
    silent({ vendor: "Sysco", gl_code: "5010", gl_name: "Food Cost",
      reasoning: "Sysco produce delivery for the kitchen; freight included on the invoice." });
  });
  it("★★ naming the broader PARENT of a sub-account — Food Cost is cost of goods sold", () => {
    silent({ vendor: "Sysco", gl_code: "5010", gl_name: "Food Cost",
      reasoning: "Produce and dry goods for the menu, properly classified as cost of goods sold." });
  });
  it("★ a balance-sheet account is an ordinary word — 'recorded as cash'", () => {
    silent({ gl_code: "5010", gl_name: "Food Cost", reasoning: "Farmers market produce, paid and recorded as cash at the stall." });
  });
  it("★ the catch-all bucket is an ordinary adjective — 'miscellaneous'", () => {
    silent({ gl_code: "5010", gl_name: "Food Cost", reasoning: "Spices and garnish, recorded as miscellaneous kitchen items for the menu." });
  });
  it("an INACTIVE account is not a place the books could go", () => {
    silent({ gl_code: "6400", reasoning: "Flyers for a tasting event, classified as marketing and advertising." });
  });
  it("reasoning that names no account at all", () => {
    silent({ reasoning: "Lone Star Beverage delivery for the bar." });
  });
  it("empty reasoning", () => { silent({ reasoning: "" }); });
  it("★ the learned-vendor sentence the app writes itself", () => {
    silent({ reasoning: "Coded Lone Star Beverage to Travel & Entertainment — you corrected this vendor before, so we apply your categorization." });
  });
});

describe("C551 — ordering and the paths it must not touch", () => {
  it("below the confidence floor still says so — the most specific true reason wins", () => {
    expect(decide({ confidence: 40 }).reason).toBe("below_confidence_floor");
  });
  it("a confident Miscellaneous booking still reports the C224 reason", () => {
    expect(decide({ gl_code: "7100", gl_name: "Miscellaneous Expense" }).reason).toBe("catch_all_account_named_vendor");
  });
  it("★ with no chart the check cannot run and behaves as before — which is why the call site must pass one", () => {
    expect(autoBookDecision(LONE_STAR).autoBook).toBe(true);
    expect(reasoningContradiction(LONE_STAR, { chart: [] })).toBeNull();
  });
});

describe("C551 — the question card cannot hand the contradicted guess back as a one-tap answer", () => {
  // ★★★ THE ATTESTATION RULE (§9). The card offers "It was ___" built from the booked
  // account. On a card that exists BECAUSE that account is in doubt, one tap would turn the
  // model's wrong half into the owner's confirmed answer — the guess laundered through a
  // human's hand. So the chip is withheld and the owner says it in their own words.
  const inv = { ...LONE_STAR, type: "expense" };
  it("an ordinary confident card may offer its chip", () => {
    expect(clarificationChips(inv).length).toBeGreaterThan(0);
  });
  it("★★★ a contradiction-routed card offers none", () => {
    expect(clarificationChips({ ...inv, ask_reason: REASONING_CONTRADICTS })).toEqual([]);
  });
});

describe("C551 — the upload path reads it", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  it("★★ passes the company's chart — without it the check is silently absent", () => {
    expect(app).toMatch(/autoBookDecision\(invoice, \{ chart: CHART_OF_ACCOUNTS \}\)/);
  });
  it("★★ stamps the reason on the card's invoice, where the chip reads it", () => {
    expect(app).toMatch(/invoice\.ask_reason = decision\.reason/);
  });
  it("a supplier RULE still books straight through — it is the owner's own instruction", () => {
    expect(app).toMatch(/if \(rule \|\| decision\.autoBook\)/);
  });
});
