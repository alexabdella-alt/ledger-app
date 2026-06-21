import { describe, it, expect } from "vitest";
import { detectFromText } from "../src/lib/fileDetect.js";

// Real-shaped header rows for each importer's expected file.
const BANK = `Date,Description,Amount,Balance,Debit,Credit
2026-05-01,ACH PAYMENT NIKE,-151.55,9848.45,151.55,
2026-05-02,DEPOSIT,2000.00,11848.45,,2000.00`;

// The EXACT shape that caused the incident: a Gusto/ADP payroll register dropped on
// the bank importer. Must detect as PAYROLL (not bank), so it can't recur.
const PAYROLL_INCIDENT = `Employee Name,Pay Period,Pay Date,Hours,Gross Pay,Federal Income Tax,Social Security,Medicare,State Income Tax,Net Pay,Employer Taxes
Jane Smith,2026-05-01 - 2026-05-15,2026-05-20,80,4000.00,500.00,248.00,58.00,200.00,2994.00,366.00
John Doe,2026-05-01 - 2026-05-15,2026-05-20,80,3500.00,420.00,217.00,50.75,175.00,2637.25,320.25`;

const INVOICE = `Invoice Number,Bill To,Qty,Unit Price,Line Total,Subtotal
INV-001,Acme Corp,3,100.00,300.00,300.00`;

// QuickBooks GL export — junk title rows above the real header, with Account + Split.
const QBO = `My Company LLC,,,,
Transaction Detail,,,,
January 2026,,,,
Date,Transaction Type,Num,Name,Account,Split,Amount
2026-01-03,Expense,1001,Staples,Office Supplies,Checking,-45.20`;

const GENERIC = `Date,Description,Amount
2026-05-01,Coffee,4.50`;

describe("detectFromText — classifies by header columns", () => {
  it("bank statement → bank_statement (balance/debit/credit)", () => {
    const r = detectFromText(BANK);
    expect(r.type).toBe("bank_statement");
    expect(r.confidence).toBe("high");
  });

  it("payroll register → payroll", () => {
    const r = detectFromText(PAYROLL_INCIDENT);
    expect(r.type).toBe("payroll");
    expect(r.confidence).toBe("high");
    expect(r.signals.payroll).toEqual(expect.arrayContaining(["employee name", "gross pay", "net pay"]));
  });

  it("invoice CSV → invoice", () => {
    expect(detectFromText(INVOICE).type).toBe("invoice");
  });

  it("QuickBooks export (Account + Split, junk rows above) → qbo", () => {
    const r = detectFromText(QBO);
    expect(r.type).toBe("qbo");
    expect(r.signals.qbo).toEqual(expect.arrayContaining(["split"]));
  });

  it("a bare date/amount CSV → unknown (no false flag)", () => {
    const r = detectFromText(GENERIC);
    expect(r.type).toBe("unknown");
    expect(r.confidence).toBe("none");
  });

  it("empty / blank input → unknown", () => {
    expect(detectFromText("").type).toBe("unknown");
    expect(detectFromText("\n\n").type).toBe("unknown");
  });
});

// ── THE INCIDENT GUARDRAIL ───────────────────────────────────────────────────
// The payroll register dropped on the bank importer must be confidently NOT a bank
// statement — this is what makes the mismatch warning fire and the 9 wrong bank
// entries impossible to recur.
describe("incident guardrail: payroll register is NOT detected as a bank statement", () => {
  const r = detectFromText(PAYROLL_INCIDENT);
  it("detects payroll, high confidence", () => {
    expect(r.type).toBe("payroll");
    expect(r.confidence).toBe("high");
  });
  it("is NOT bank_statement", () => {
    expect(r.type).not.toBe("bank_statement");
  });
  it("on the bank importer this is a confident mismatch (would warn, not silently process)", () => {
    const expectedByBankImporter = "bank_statement";
    const isConfidentMismatch = r.confidence === "high" && r.type !== expectedByBankImporter;
    expect(isConfidentMismatch).toBe(true);
  });
});

describe("symmetry: a real bank file does NOT misfire on the bank importer", () => {
  const r = detectFromText(BANK);
  it("matches the bank importer's expected type → no warning", () => {
    const isConfidentMismatch = r.confidence === "high" && r.type !== "bank_statement";
    expect(isConfidentMismatch).toBe(false);
  });
  it("but a bank file on the PAYROLL importer is a confident mismatch (would warn)", () => {
    const isConfidentMismatch = r.confidence === "high" && r.type !== "payroll";
    expect(isConfidentMismatch).toBe(true);
  });
});

describe("unknown/low confidence never warns (drop target is a strong prior)", () => {
  it("a generic date/amount CSV on any importer → no mismatch warning", () => {
    const r = detectFromText(GENERIC);              // unknown / none
    for (const expected of ["bank_statement", "payroll", "invoice"]) {
      const warns = r.confidence === "high" && r.type !== expected;
      expect(warns).toBe(false);
    }
  });
});
