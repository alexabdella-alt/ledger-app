import { describe, it, expect } from "vitest";
import { detectHeaderRow, mapColumns, parseDate, parseAmount, parseQbo, matchAccount, isQboBankFile } from "../src/lib/qboParser.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

const byRole = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map(a => [a.system_role, a]));
const getAccountByRole = (role) => byRole[role] || null;

describe("parseDate", () => {
  it("parses MM/DD/YYYY (QuickBooks default)", () => {
    expect(parseDate("06/09/2026")).toBe("2026-06-09");
    expect(parseDate("1/5/2026")).toBe("2026-01-05");
  });
  it("parses ISO and 2-digit years", () => {
    expect(parseDate("2026-03-15")).toBe("2026-03-15");
    expect(parseDate("3/4/26")).toBe("2026-03-04");
  });
  it("parses written dates and rejects junk", () => {
    expect(parseDate("January 5, 2026")).toBe("2026-01-05");
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("handles $, commas, parentheses, trailing minus", () => {
    expect(parseAmount("$1,234.56")).toBe(1234.56);
    expect(parseAmount("(500.00)")).toBe(-500);
    expect(parseAmount("-42")).toBe(-42);
    expect(parseAmount("42.00-")).toBe(-42);
  });
  it("rejects non-numeric", () => {
    expect(parseAmount("abc")).toBeNull();
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
  });
});

describe("detectHeaderRow + mapColumns", () => {
  const junk = [
    ["Acme Industries"],
    ["Transaction List by Date"],
    ["January 1 - December 31, 2026"],
    [],
    ["Date", "Transaction Type", "Num", "Name", "Account", "Split", "Amount", "Memo/Description"],
    ["06/01/2026", "Expense", "1001", "AWS", "Software & Apps", "Checking", "$297.00", "monthly"],
  ];
  it("finds the real header row beneath QuickBooks junk", () => {
    expect(detectHeaderRow(junk)).toBe(4);
  });
  it("maps known columns to fields", () => {
    const m = mapColumns(junk[4]);
    expect(m.date).toBe(0);
    expect(m.account).toBe(4);
    expect(m.amount).toBe(6);
    expect(m.memo).toBe(7);
  });
  it("returns -1 when no recognizable header exists", () => {
    expect(detectHeaderRow([["foo", "bar"], ["1", "2"]])).toBe(-1);
  });
});

describe("parseQbo — single Amount format", () => {
  const rows = [
    ["Acme Industries"],
    ["Transaction List by Date"],
    [],
    ["Date", "Type", "Name", "Account", "Amount", "Memo"],
    ["06/01/2026", "Expense", "AWS", "Software & Apps", "$297.00", "hosting"],
    ["06/03/2026", "Expense", "WeWork", "Rent", "1,500.00", ""],
    ["", "", "", "Total", "1,797.00", ""],        // subtotal row → skipped
    ["bad", "Expense", "X", "Misc", "abc", ""],    // bad date + amount → failed
  ];
  const out = parseQbo(rows);
  it("detects header, parses good rows, collects failures", () => {
    expect(out.headerIndex).toBe(3);
    expect(out.rows).toHaveLength(2);
    expect(out.rows[0]).toMatchObject({ date: "2026-06-01", amount: 297, account: "Software & Apps", name: "AWS" });
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0].reason).toMatch(/date/);
  });
  it("preserves the original row for auditability", () => {
    expect(out.rows[0]._raw.Account).toBe("Software & Apps");
    expect(out.rows[0]._raw.Amount).toBe("$297.00");
  });
});

describe("parseQbo — separate Debit/Credit format", () => {
  const rows = [
    ["Journal report"],
    ["Date", "Account", "Debit", "Credit"],
    ["2026-06-01", "Office Supplies", "120.00", ""],   // debit → +120
    ["2026-06-02", "Service Revenue", "", "900.00"],   // credit → -900
  ];
  const out = parseQbo(rows);
  it("computes amount = debit − credit", () => {
    expect(out.rows[0].amount).toBe(120);
    expect(out.rows[1].amount).toBe(-900);
  });
});

describe("matchAccount", () => {
  it("exact name match wins", () => {
    expect(matchAccount("Rent & Occupancy", DEFAULT_CHART_OF_ACCOUNTS, getAccountByRole)).toBe("6100");
  });
  it("fuzzy keyword match by role", () => {
    expect(matchAccount("Software & Apps", DEFAULT_CHART_OF_ACCOUNTS, getAccountByRole)).toBe("6500");
    expect(matchAccount("Business Meals", DEFAULT_CHART_OF_ACCOUNTS, getAccountByRole)).toBe("6400");
    expect(matchAccount("Legal & Professional Fees", DEFAULT_CHART_OF_ACCOUNTS, getAccountByRole)).toBe("6800");
  });
  it("returns null for an unrecognized account (caller defaults to Misc)", () => {
    expect(matchAccount("Zorblax Expenses", DEFAULT_CHART_OF_ACCOUNTS, getAccountByRole)).toBeNull();
  });
});

describe("isQboBankFile", () => {
  it("flags .qbo (bank statement) files for the bank flow", () => {
    expect(isQboBankFile("statement.qbo")).toBe(true);
    expect(isQboBankFile("MyExport.QBO")).toBe(true);
    expect(isQboBankFile("transactions.csv")).toBe(false);
    expect(isQboBankFile("coa.xlsx")).toBe(false);
  });
});
