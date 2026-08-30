import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { validateUpload } from "../src/lib/uploadGuard.js";

// ═════════════════════════════════════════════════════════════════════════════
// PAYROLL PDFs — a promise the product was not keeping.
//
// The home drop zone says "drop anything here — your AI controller handles the rest" and
// advertises PDF. Payroll accepted only csv/xls/xlsx/iif/txt. **A Gusto PDF summary — the
// artifact an owner ACTUALLY HAS — bounced off a product that had just told them to drop
// anything** (O84 finding 3).
// ═════════════════════════════════════════════════════════════════════════════

const file = (name, type) => ({ name, type, size: 40_000 });

describe("★★ payroll accepts the file an owner actually has", () => {
  it("THE LIVE REJECTION: a Gusto PDF summary is accepted", () => {
    expect(validateUpload(file("gusto_summary.pdf", "application/pdf"), "payroll").ok).toBe(true);
  });

  it("and the spreadsheet formats still work", () => {
    for (const [n, t] of [["register.csv", "text/csv"], ["register.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], ["export.iif", "text/plain"]]) {
      expect(validateUpload(file(n, t), "payroll").ok, n).toBe(true);
    }
  });

  it("★★ QuickBooks still REFUSES a PDF — the kind was split, not widened", () => {
    // QBO shares the old `spreadsheet` kind and genuinely cannot read a PDF: it parses a
    // grid. Widening the shared kind would have made the QBO screen ACCEPT a file it then
    // fails on — a worse promise than the one being fixed.
    expect(validateUpload(file("company.pdf", "application/pdf"), "spreadsheet").ok).toBe(false);
  });

  it("junk is still refused on both", () => {
    for (const kind of ["payroll", "spreadsheet"]) {
      expect(validateUpload(file("photo.heic", "image/heic"), kind).ok, kind).toBe(false);
    }
  });
});

import { payrollRequestBody, isPdfFile } from "../src/lib/payroll.js";

describe("★★ a PDF register goes as a DOCUMENT, not as text", () => {
  const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/PayrollView.jsx"), "utf8");

  it("★★ THE PDF PAYLOAD CARRIES THE FILE, NOT A STRING", () => {
    const body = payrollRequestBody({ isPdf: true, base64: "JVBERi0x" });
    const content = body.messages[0].content;
    expect(Array.isArray(content)).toBe(true);
    expect(content[0]).toMatchObject({ type: "document", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0x" } });
    // The text slot must be EMPTY — `file.text()` on a PDF is binary noise, and sending it
    // alongside would hand the model garbage to reconcile against the real document.
    expect(body.slots.PAYROLL).toBe("");
  });

  it("the spreadsheet payload is unchanged — text in the slot, no document block", () => {
    const body = payrollRequestBody({ isPdf: false, text: "gross,net\n4000,3150" });
    expect(body.slots.PAYROLL).toBe("gross,net\n4000,3150");
    expect(typeof body.messages[0].content).toBe("string");
  });

  it("caps the text slot, as it always did", () => {
    expect(payrollRequestBody({ text: "x".repeat(9000) }).slots.PAYROLL).toHaveLength(8000);
  });

  it("★ the SAME server-owned profile handles both — the register is the register", () => {
    // The system prompt describing a payroll register does not care which container it
    // arrived in, and forking the profile would create two things to keep in step.
    expect(payrollRequestBody({ isPdf: true, base64: "x" }).profile).toBe("parse-payroll");
    expect(payrollRequestBody({ isPdf: false, text: "x" }).profile).toBe("parse-payroll");
  });

  it("recognises a PDF by content type OR extension", () => {
    expect(isPdfFile({ name: "gusto.pdf", type: "application/pdf" })).toBe(true);
    expect(isPdfFile({ name: "gusto.PDF", type: "" })).toBe(true);          // browser omitted the type
    expect(isPdfFile({ name: "register.csv", type: "text/csv" })).toBe(false);
    expect(isPdfFile(null)).toBe(false);
  });

  it("★ and the stored document carries its REAL type", () => {
    // Hardcoded "text/csv" was harmless while only spreadsheets could arrive, and wrong
    // the moment a PDF can: the library would hold a PDF labelled a CSV, and the preview
    // reads that label.
    expect(view).not.toMatch(/storeDocument\(file\.name, null, "text\/csv"/);
    expect(view).toMatch(/file\.type \|\| \(isPdf \? "application\/pdf"/);
  });

  it("the file picker offers PDF, or the accept list contradicts the guard", () => {
    expect(view).toMatch(/accept=".*\.pdf"/);
  });
});
