import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { filterDocuments, documentDate, documentDateLabel, documentTypeFor, DOC_DATE_SOURCE, DOCUMENT_TYPES } from "../src/lib/docLibrary.js";

// ═════════════════════════════════════════════════════════════════════════════
// THE DOCUMENT LIBRARY — three claims the screen made and did not keep.
//   (1) the header says "stored and searchable" and there was no search input;
//   (2) every card showed the UPLOAD date, so a February statement uploaded in August read
//       "Aug 25" and "find the January statement" meant "remember which day you sent it";
//   (3) the type was HARDCODED to "invoice", so a utility bill, a receipt and a register
//       all filed the same, while the filter chips implied a taxonomy the data lacked.
// ═════════════════════════════════════════════════════════════════════════════

const invoices = [
  { id: "1", db_entry_id: "e1", date: "2026-02-03", vendor: "Roma" },
  { id: "2", db_entry_id: "e2", date: "2026-01-15", vendor: "Toast" },
];
const docs = [
  { id: "d1", name: "feb_statement.pdf", type: "bank_statement", uploaded_at: "2026-08-25", linked_invoice_id: "e1", tags: [] },
  { id: "d2", name: "roma_invoice_RC-41455.pdf", type: "invoice", uploaded_at: "2026-08-25", linked_invoice_id: null, tags: ["uploaded"] },
  { id: "d3", name: "gusto_register.csv", type: "payroll", uploaded_at: "2026-03-02", linked_invoice_id: "e2", tags: [] },
];

describe("★★ (2) the card shows the document's OWN date when we can derive it", () => {
  it("THE LIVE SYMPTOM: a February statement uploaded in August reads February", () => {
    const d = documentDate(docs[0], invoices);
    expect(d.date).toBe("2026-02-03");
    expect(d.source).toBe(DOC_DATE_SOURCE.LINKED);
  });

  it("★★ and it SAYS which date it is showing when it's only the upload date", () => {
    // "Feb 3" and "uploaded Aug 25" are different facts. A library that silently mixes
    // them is worse than one that only ever showed the upload date, because you cannot
    // tell which you are looking at.
    const derived = documentDate(docs[0], invoices);
    const fallback = documentDate(docs[1], invoices);
    expect(documentDateLabel(derived)).toBe(null);          // an economic date needs no caveat
    expect(documentDateLabel(fallback)).toBe("uploaded");   // this one does
    expect(fallback.date).toBe("2026-08-25");
  });

  it("a real document_date wins over both, once migration 077 lands", () => {
    const d = documentDate({ ...docs[0], document_date: "2026-02-28" }, invoices);
    expect(d.date).toBe("2026-02-28");
    expect(d.source).toBe(DOC_DATE_SOURCE.DOCUMENT);
  });

  it("an unlinked, undated document says nothing rather than something wrong", () => {
    expect(documentDate({ id: "x" }, invoices).date).toBe(null);
    expect(documentDateLabel({ date: null })).toBe(null);
  });
});

describe("★★ (1) search — by name, type and date range", () => {
  it("finds by filename", () => {
    expect(filterDocuments(docs, { query: "roma" }, invoices).map(d => d.id)).toEqual(["d2"]);
  });

  it("★ every term must match, so two words NARROW rather than widen", () => {
    // What a person means by typing two words.
    expect(filterDocuments(docs, { query: "gusto payroll" }, invoices).map(d => d.id)).toEqual(["d3"]);
    expect(filterDocuments(docs, { query: "gusto statement" }, invoices)).toHaveLength(0);
  });

  it("★★ the date range uses the DOCUMENT's date, not the upload date", () => {
    // The whole point: "everything from February" must find a February statement that was
    // uploaded in August.
    const feb = filterDocuments(docs, { from: "2026-02-01", to: "2026-02-28" }, invoices);
    expect(feb.map(d => d.id)).toEqual(["d1"]);
  });

  it("an undated document cannot satisfy a date filter", () => {
    const undated = [{ id: "u", name: "x.pdf", type: "other" }];
    expect(filterDocuments(undated, { from: "2026-01-01" }, invoices)).toHaveLength(0);
    expect(filterDocuments(undated, {}, invoices)).toHaveLength(1);   // …but is not hidden otherwise
  });

  it("combines with the type chips", () => {
    expect(filterDocuments(docs, { query: "2026", type: "payroll" }, invoices)).toHaveLength(0);
    expect(filterDocuments(docs, { type: "payroll" }, invoices).map(d => d.id)).toEqual(["d3"]);
  });

  it("no filters returns everything", () => {
    expect(filterDocuments(docs, {}, invoices)).toHaveLength(3);
  });
});

describe("★★ (3) the type is derived, and an unknown one is kept rather than rejected", () => {
  it("passes through the types the column allows", () => {
    for (const t of DOCUMENT_TYPES) expect(documentTypeFor(t)).toBe(t);
  });

  it("★ maps the classifier's vocabulary onto the column's, rather than widening the CHECK", () => {
    expect(documentTypeFor("bill")).toBe("invoice");
    expect(documentTypeFor("statement")).toBe("bank_statement");
    expect(documentTypeFor("bank statement")).toBe("bank_statement");
    expect(documentTypeFor("payroll_register")).toBe("payroll");
  });

  it("★★ an unrecognised type stores as 'other' — never rejected", () => {
    // A document we cannot label is still one we must keep. Losing the file to protect a
    // taxonomy would be the wrong trade.
    expect(documentTypeFor("underwater_basket_weaving")).toBe("other");
    expect(documentTypeFor(null)).toBe("other");
    expect(documentTypeFor("", "invoice")).toBe("invoice");   // caller's fallback honoured
  });

  it("★ and the universal upload path actually USES it", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    const code = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).toMatch(/storeDocument\(item\.name, base64, mediaType, documentTypeFor\(docType, "invoice"\)/);
    expect(code).not.toMatch(/storeDocument\(item\.name, base64, mediaType, "invoice"/);
  });
});
