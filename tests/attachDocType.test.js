import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { documentTypeFor, DOCUMENT_TYPES } from "../src/lib/docLibrary.js";

// C534 — the panel's "Attach source document" stored `inv.type` ("expense"/"revenue") as the
// document_type; the column's CHECK allows seven values and neither is one of them, so the insert
// was refused and the O136 repair button never stored a fresh file. Every type reaching the
// insert is mapped to the column's vocabulary now, and the panel passes a document type.
const ddl = fs.readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8");
const dbSet = ddl.match(/documents_document_type_check CHECK \(\(document_type = ANY \(ARRAY\[(.*?)\]\)\)\)/)[1].match(/'([a-z0-9_]+)'/g).map(s => s.replace(/'/g, "")).sort();

describe("C534", () => {
  it("THE REPRO — the row's P&L side is not a document type the column accepts", () => {
    expect(dbSet.includes("expense")).toBe(false);
    expect(dbSet.includes("revenue")).toBe(false);
    expect(DOCUMENT_TYPES.slice().sort()).toEqual(dbSet);   // the app's list IS the column's
  });
  it("the mapper lands every value in the column's set", () => {
    for (const t of ["expense", "revenue", "pending", "qbo", "invoice", "bank_statement", "", null]) expect(dbSet.includes(documentTypeFor(t, "other")), String(t)).toBe(true);
  });
  it("storeDocument maps at the insert, and the panel passes a document type", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(app).toContain('document_type: documentTypeFor(type, "other"),');
    expect(app).not.toMatch(/document_type: type \|\| null/);
    const panel = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(panel).not.toMatch(/storeDocument\([^)]*inv\.type/);
    expect(panel).toMatch(/storeDocument\([^)]*\(glIsRevenue\(inv\.gl_code\) \? "invoice" : "receipt"\)/);
  });
});
