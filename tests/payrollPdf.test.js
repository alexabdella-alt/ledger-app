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

import { payrollRequestBody, isPdfFile, PAYROLL_TEXT_LIMIT, PAYROLL_TOO_LONG, payrollFailureCopy } from "../src/lib/payroll.js";

describe("★★ a PDF register goes as a DOCUMENT, not as text", () => {
  // ★ TWO FILES NOW, BECAUSE O116 SPLIT THEM: the PIPELINE moved to `App.jsx` (so the Home
  // queue can run it), the file PICKER and drop zone are still the view's. Repointing both
  // at App.jsx made the accept-list assertion read a file that has no picker in it — it
  // would have gone green the moment someone deleted the picker entirely.
  const pipeline = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
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

  // ★★ C566 — THIS TEST USED TO PIN THE BUG: "caps the text slot, as it always did" asserted a
  // 9,000-character register came out as 8,000. A register's TOTALS are at the bottom, so the
  // cap silently dropped them and the later employees. The property now: sent whole, or refused.
  it("★★★ a long register is sent WHOLE — never cut", () => {
    const text = "x".repeat(9000);
    expect(payrollRequestBody({ text }).slots.PAYROLL).toBe(text);
    const big = "y".repeat(PAYROLL_TEXT_LIMIT);
    expect(payrollRequestBody({ text: big }).slots.PAYROLL).toHaveLength(PAYROLL_TEXT_LIMIT);
  });
  it("★★★ and past the limit it is REFUSED with a code — a cut register reads as a smaller, complete payroll", () => {
    let err = null;
    try { payrollRequestBody({ text: "z".repeat(PAYROLL_TEXT_LIMIT + 1) }); } catch (e) { err = e; }
    expect(err && err.code).toBe(PAYROLL_TOO_LONG);
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
    // The store call is part of the PIPELINE, which O116 moved to App.jsx.
    expect(pipeline).not.toMatch(/storeDocument\(file\.name, null, "text\/csv"/);
    expect(pipeline).toMatch(/file\.type \|\| \(isPdf \? "application\/pdf"/);
  });

  it("the file picker offers PDF, or the accept list contradicts the guard", () => {
    expect(view).toMatch(/accept=".*\.pdf"/);
  });
});

describe("C566 — a payroll failure is said, and says the right thing", () => {
  it("★★ each recorded cause has its own sentence, and every one says nothing was recorded", () => {
    expect(payrollFailureCopy({ code: PAYROLL_TOO_LONG })).toMatch(/too long to read in one go/);
    expect(payrollFailureCopy({ code: "AI_REPLY_CUT_OFF" })).toMatch(/lists more people than we can read in one go/);
    expect(payrollFailureCopy(new Error("anything else"))).toMatch(/couldn't read that payroll file/);
    for (const e of [{ code: PAYROLL_TOO_LONG }, { code: "AI_REPLY_CUT_OFF" }, new Error("x")]) expect(payrollFailureCopy(e)).toMatch(/Nothing was recorded|nothing was recorded/);
  });
  it("★★★ the upload's catch now TELLS the person — it logged to the console and stopped", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    expect(app).toMatch(/payroll parse error: \$\{e\?\.message\|\|e\}` \}\); console\.error\(e\);\s*\n(\s*\/\/.*\n)*\s*showNotification\(payrollFailureCopy\(e\), "error"\);/);
  });
});
