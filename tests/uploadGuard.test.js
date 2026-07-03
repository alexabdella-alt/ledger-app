import { describe, it, expect } from "vitest";
import { validateUpload, MAX_UPLOAD_BYTES } from "../src/lib/uploadGuard.js";

// ════════════════════════════════════════════════════════════════════════════
// CR-34 — upload size + type enforcement (the one real abuse hole). Rejects
// oversized files and wrong-type files BEFORE any processing path runs.
// (Client first-line guard; authoritative enforcement is the Storage bucket config.)
// ════════════════════════════════════════════════════════════════════════════

const f = (name, type, size) => ({ name, type, size });

describe("size cap", () => {
  it("rejects a file over the 15 MB limit", () => {
    const r = validateUpload(f("big.pdf", "application/pdf", MAX_UPLOAD_BYTES + 1), "document");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/limit is 15 MB/);
  });
  it("accepts a file at the limit", () => {
    expect(validateUpload(f("ok.pdf", "application/pdf", MAX_UPLOAD_BYTES), "document").ok).toBe(true);
  });
});

describe("type allowlist per intake kind", () => {
  it("document: accepts pdf/png/jpg, rejects csv + exe", () => {
    expect(validateUpload(f("inv.pdf", "application/pdf", 1000), "document").ok).toBe(true);
    expect(validateUpload(f("scan.png", "image/png", 1000), "document").ok).toBe(true);
    expect(validateUpload(f("data.csv", "text/csv", 1000), "document").ok).toBe(false);
    expect(validateUpload(f("evil.exe", "application/x-msdownload", 1000), "document").ok).toBe(false);
  });
  it("bank: accepts csv/xlsx/pdf, rejects png", () => {
    expect(validateUpload(f("stmt.csv", "text/csv", 1000), "bank").ok).toBe(true);
    expect(validateUpload(f("stmt.pdf", "application/pdf", 1000), "bank").ok).toBe(true);
    expect(validateUpload(f("pic.png", "image/png", 1000), "bank").ok).toBe(false);
  });
  it("spreadsheet: accepts csv/xls/xlsx/iif, rejects pdf image", () => {
    expect(validateUpload(f("p.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1000), "spreadsheet").ok).toBe(true);
    expect(validateUpload(f("p.iif", "", 1000), "spreadsheet").ok).toBe(true);
    expect(validateUpload(f("p.png", "image/png", 1000), "spreadsheet").ok).toBe(false);
  });
});

describe("real MIME check (defends renamed files)", () => {
  it("rejects an ext that's allowed but whose reported content type is NOT (renamed exe → .pdf)", () => {
    const r = validateUpload(f("malware.pdf", "application/x-msdownload", 1000), "document");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/content type/);
  });
  it("tolerates an EMPTY type when the extension is valid (browsers omit it for csv/xlsx)", () => {
    expect(validateUpload(f("stmt.csv", "", 1000), "bank").ok).toBe(true);
  });
});

describe("edge cases", () => {
  it("no file → rejected", () => {
    expect(validateUpload(null, "document").ok).toBe(false);
  });
  it("unknown kind falls back to the universal allowlist", () => {
    expect(validateUpload(f("x.pdf", "application/pdf", 1000), "made-up-kind").ok).toBe(true);
  });
});
