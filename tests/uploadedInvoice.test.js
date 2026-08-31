import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { buildUploadedInvoice } from "../src/lib/uploadedInvoice";
import { autoBookDecision } from "../src/lib/confidenceFlag";

const CODES = { product_revenue:"4000", miscellaneous_expense:"7100", accounts_payable:"2000", accounts_receivable:"1200" };
const NAMES = { product_revenue:"Product Revenue", miscellaneous_expense:"Miscellaneous Expense", accounts_payable:"Accounts Payable", accounts_receivable:"Accounts Receivable" };
const rc = (r) => CODES[r];
const rn = (r) => NAMES[r];
const build = (o = {}) => buildUploadedInvoice({
  rc, rn, id: "fixed-id", bookedAt: "2026-08-30T12:00:00.000Z", today: "2026-08-30",
  extracted: { vendor: "Roma Cheese", amount: "551.20", date: "2026-08-04", type: "expense", description: "cheese" },
  ...o,
});

describe("O89 — the highest-traffic decision in the product, now testable", () => {
  it("takes the model's coding when there is no rule", () => {
    const { invoice } = build({ coding: { gl_code: "5000", gl_name: "COGS", confidence: 88 } });
    expect(invoice.gl_code).toBe("5000");
    expect(invoice.confidence).toBe(88);
  });

  it("★★ a vendor rule BEATS the model — that is what a rule is", () => {
    const { invoice } = build({
      coding: { gl_code: "5000", gl_name: "COGS", confidence: 88 },
      rule: { gl_code: "6250", gl_name: "Repairs", project: "Kitchen" },
    });
    expect(invoice.gl_code).toBe("6250");
    expect(invoice.project).toBe("Kitchen");
  });

  it("★★ and the rule carries 99, so the confidence gate lets it straight through", () => {
    const { invoice } = build({ coding: { confidence: 20 }, rule: { gl_code: "6250", gl_name: "Repairs" } });
    expect(invoice.confidence).toBe(99);
    expect(autoBookDecision(invoice).autoBook).toBe(true);
  });

  it("a model that offers no score gets the 75 floor, not 100", () => {
    expect(build({ coding: { gl_code: "5000", gl_name: "COGS" } }).invoice.confidence).toBe(75);
  });
});

describe("★★★ `type` comes from the GL CODE, never from the model's own answer", () => {
  it("an expense account makes it an expense even when the model said revenue", () => {
    // Same basis flattenJournalEntries uses. Without it an odd AI `type` mis-slots the row
    // out of the transactions tab the moment it books.
    const { invoice } = build({ extracted: { vendor: "Roma", amount: "10", date: "2026-08-04", type: "revenue" }, coding: { gl_code: "5000", gl_name: "COGS" } });
    expect(invoice.type).toBe("expense");
  });

  it("and a revenue account makes it revenue even when the model said expense", () => {
    const { invoice } = build({ extracted: { vendor: "A Client", amount: "10", date: "2026-08-04", type: "expense" }, coding: { gl_code: "4000", gl_name: "Sales" } });
    expect(invoice.type).toBe("revenue");
  });

  it("a balance-sheet code falls back to what the model said — there is no P&L answer to take", () => {
    const { invoice } = build({ extracted: { vendor: "X", amount: "10", date: "2026-08-04", type: "expense" }, coding: { gl_code: "1500", gl_name: "Equipment" } });
    expect(invoice.type).toBe("expense");
  });
});

describe("★★★ the Miscellaneous fallback, and the gate that makes it safe", () => {
  it("an expense with no coding falls back to Miscellaneous", () => {
    expect(build({ coding: {} }).invoice.gl_code).toBe("7100");
  });

  it("★★ and that booking is REFUSED when the vendor has a name — the cold-start hard fail", () => {
    // The fallback is correct here; stopping it is the booking gate's job. Together they turn
    // "we couldn't tell" into a question rather than a silent wrong bucket.
    const { invoice } = build({ coding: {} });
    const d = autoBookDecision({ ...invoice, confidence: 100 });
    expect(d.autoBook).toBe(false);
    expect(d.reason).toBe("catch_all_account_named_vendor");
  });

  it("revenue with no coding falls back to the revenue account, not Miscellaneous", () => {
    const { invoice } = build({ extracted: { vendor: "A Client", amount: "10", date: "2026-08-04", type: "revenue" }, coding: {} });
    expect(invoice.gl_code).toBe("4000");
  });
});

describe("the offsetting side follows the direction", () => {
  it("an expense offsets to Accounts Payable, revenue to Accounts Receivable", () => {
    expect(build({ coding: { gl_code: "5000", gl_name: "COGS" } }).invoice.secondary_gl_code).toBe("2000");
    const rev = build({ extracted: { vendor: "A Client", amount: "10", date: "2026-08-04", type: "revenue" }, coding: {} });
    expect(rev.invoice.secondary_gl_code).toBe("1200");
    expect(rev.invoice.debit_credit).toBe("credit");
  });

  it("a rule always offsets to Accounts Payable", () => {
    expect(build({ rule: { gl_code: "6250", gl_name: "Repairs" } }).invoice.secondary_gl_code).toBe("2000");
  });
});

describe("it is pure, which is what makes any of the above assertable", () => {
  it("★ same input, same row — no clock, no randomness", () => {
    expect(JSON.stringify(build({ coding: { gl_code: "5000", gl_name: "COGS" } })))
      .toBe(JSON.stringify(build({ coding: { gl_code: "5000", gl_name: "COGS" } })));
  });

  it("★★ and pure BY CONSTRUCTION — the id and the timestamp are injected", () => {
    const src = readFileSync("src/lib/uploadedInvoice.js", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/Date\.now|Math\.random|new Date\(\)/);
    expect(src).not.toContain("supabase");
  });

  it("carries the vendor's details through for contact creation", () => {
    const { invoice } = build({ extracted: { vendor: " Roma Cheese ", amount: "1", date: "2026-08-04", type: "expense", vendor_email: "a@b.c" }, coding: { gl_code: "5000", gl_name: "COGS" } });
    expect(invoice.vendor).toBe("Roma Cheese");          // trimmed
    expect(invoice._contact.email).toBe("a@b.c");
    expect(invoice._contact.type).toBe("vendor");
  });

  it("a missing vendor becomes Unknown rather than empty", () => {
    expect(build({ extracted: { amount: "1", date: "2026-08-04" }, coding: {} }).invoice.vendor).toBe("Unknown");
  });
});
