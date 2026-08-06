import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectFileType, planUniversalSpreadsheetRoute } from "../src/lib/fileDetect.js";

// ════════════════════════════════════════════════════════════════════════════
// C198(g) — PIN THE XLSX DETECTOR BRANCH.
//
// The fix itself already shipped (O55: detectFileType sniffs the first sheet's
// header rows through the xlsx lib, so a binary workbook classifies the same way
// a CSV header does) and was verified live on 2026-08-06 against real Gusto and
// bank workbooks. What did NOT exist was a test holding it there — every existing
// fileDetect test feeds TEXT, so the whole binary branch (arrayBuffer → XLSX.read
// → sheet_to_json → detectFromText) was unpinned, and O86 (g) suspected it live.
//
// These build REAL .xlsx bytes in memory with the repo's own xlsx lib and push
// them through the actual async detector. Nothing is stubbed: if the branch
// regresses — a lost await, a changed read option, a header-row slice — the
// payroll CSV silently becomes a bank statement again and these go red.
// ════════════════════════════════════════════════════════════════════════════

// A real workbook as bytes, wrapped in the minimal File-ish shim the detector uses.
const xlsxFile = (name, rows, sheetName = "Sheet1") => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return {
    name,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    arrayBuffer: async () => buf,
  };
};

const GUSTO = [
  ["Employee", "Pay Period", "Pay Date", "Gross Pay", "Net Pay", "Employer Tax"],
  ["A. Rivera", "2026-06-01 – 2026-06-15", "2026-06-20", "2000.00", "1512.44", "153.00"],
  ["B. Okafor", "2026-06-01 – 2026-06-15", "2026-06-20", "2000.00", "1498.10", "153.00"],
];
const BANK = [
  ["Posting Date", "Description", "Withdrawal", "Deposit", "Running Balance", "Check Number"],
  ["06/02/2026", "TOAST POS DEPOSIT", "", "4210.55", "31972.86", ""],
  ["06/03/2026", "CHECK 1043", "350.00", "", "31622.86", "1043"],
];
const QBO = [
  ["Date", "Type", "Num", "Name", "Account", "Split", "Amount"],
  ["06/02/2026", "Bill", "1187", "Roma Foods", "Accounts Payable", "5000", "-812.40"],
];

describe("(g) a real binary .xlsx routes on its CONTENT", () => {
  it("1 — a payroll-named Gusto register → payroll, high, routed to payroll", async () => {
    const det = await detectFileType(xlsxFile("gusto_payroll_june_2026.xlsx", GUSTO));
    expect(det.type).toBe("payroll");
    expect(det.confidence).toBe("high");
    expect(planUniversalSpreadsheetRoute(det)).toEqual({ to: "payroll" });
  });

  it("2 — THE LIVE BUG: same headers, a NEUTRAL filename → still payroll (content, not name)", async () => {
    const det = await detectFileType(xlsxFile("june_data_export.xlsx", GUSTO));
    expect(det.type).toBe("payroll");
    expect(det.confidence).toBe("high");
    expect(planUniversalSpreadsheetRoute(det)).toEqual({ to: "payroll" });
  });

  it("3 — bank export headers → bank_statement, high, routed to bank_statement", async () => {
    const det = await detectFileType(xlsxFile("export.xlsx", BANK));
    expect(det.type).toBe("bank_statement");
    expect(det.confidence).toBe("high");
    expect(planUniversalSpreadsheetRoute(det)).toEqual({ to: "bank_statement" });
  });

  it("4 — QuickBooks export headers → qbo, high, routed to qbo", async () => {
    const det = await detectFileType(xlsxFile("transactions.xlsx", QBO));
    expect(det.type).toBe("qbo");
    expect(det.confidence).toBe("high");
    expect(planUniversalSpreadsheetRoute(det)).toEqual({ to: "qbo" });
  });

  it("5 — a junk sheet → unknown, and falls back to the account-picker (bank) flow", async () => {
    const det = await detectFileType(xlsxFile("notes.xlsx", [["hello", "world"], ["a", "b"]]));
    expect(det.type).toBe("unknown");
    expect(planUniversalSpreadsheetRoute(det)).toEqual({ to: "bank_statement" });
  });

  it("6 — corrupt bytes (not a zip) → unknown with a parse reason, never a wrong confident route", async () => {
    const junk = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]).buffer;
    const det = await detectFileType({ name: "broken.xlsx", type: "application/vnd.ms-excel", arrayBuffer: async () => junk });
    expect(det.type).toBe("unknown");
    expect(det.confidence).not.toBe("high");
    expect(String(det.reason || "")).toMatch(/parse/i);
    expect(planUniversalSpreadsheetRoute(det)).toEqual({ to: "bank_statement" });
  });

  it("the payroll workbook is genuinely BINARY (the text path could not have read it)", async () => {
    const f = xlsxFile("gusto_payroll_june_2026.xlsx", GUSTO);
    const bytes = new Uint8Array(await f.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);   // "PK" — a zip container, not text
    expect(bytes.length).toBeGreaterThan(200);
  });
});
