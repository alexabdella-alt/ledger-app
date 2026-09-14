// ─────────────────────────────────────────────────────────────────────────────
// C364 — THE CATCH-ALL'S REVIEW RECORD IS WRITTEN, LOADED, AND ITS MARKERS WRITTEN BACK.
//
// `unknown_documents` existed with the record's exact shape and no reader or writer; the AI's
// explanation, drafted entry and watch-for triggers lived in the tab that dropped the file.
// The mapping is one file in both directions; the wiring is pinned by structure.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { unknownDocRow, unknownDocFromRow, isDbUnknownDocId, UNKNOWN_DOC_SELECT } from "../src/lib/unknownDocs.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const UUID = "3a704760-1111-4222-8333-444455556666";
const DOC = "3a704760-2222-4222-8333-444455556666";

const rec = {
  id: 1757800000000.42, name: "mystery.pdf", uploaded_at: "2026-09-14T00:00:00Z",
  document_type: "Vendor Statement", ai_explanation: "A statement of account, not an invoice.",
  entry_needed: true, entry_summary: "Nothing to book until the invoice arrives.",
  journal_entry: { description: "x", date: "2026-09-01", lines: [{ account_code: "6000", account_name: "Salaries", debit: 10, credit: 0 }] },
  no_entry_reason: null,
  watch_for: [{ trigger_description: "an invoice from Acme", trigger_vendor_keywords: ["acme"] }],
  watch_matches: [], posted: false,
};

describe("the row and the record are one shape in both directions", () => {
  it("a record becomes a row the table accepts, and comes back as the same record", () => {
    const row = unknownDocRow(rec, { companyId: UUID, documentId: DOC });
    expect(row).toMatchObject({ company_id: UUID, document_id: DOC, document_type_detected: "Vendor Statement", entry_needed: true, posted: false, dismissed: false });
    expect(row.proposed_journal_entry).toEqual(rec.journal_entry);
    expect(row.watch_for).toEqual(rec.watch_for);
    // the table's own column set — no key the DDL does not carry
    const ddl = read("supabase/migrations/000_baseline_schema.sql");
    const start = ddl.indexOf("CREATE TABLE public.unknown_documents (");
    const cols = ddl.slice(start, ddl.indexOf(");", start)).match(/^\s{4}(\w+)\s/gm).map((l) => l.trim().split(/\s/)[0]);
    for (const k of Object.keys(row)) expect(cols, `column ${k}`).toContain(k);
    const back = unknownDocFromRow({ ...row, id: UUID, created_at: "2026-09-14T00:00:00Z", documents: { name: "mystery.pdf" } });
    expect(back).toMatchObject({ id: UUID, db_id: UUID, name: "mystery.pdf", document_type: "Vendor Statement", entry_needed: true, posted: false });
    expect(back.journal_entry).toEqual(rec.journal_entry);
    expect(back.watch_for).toEqual(rec.watch_for);
  });
  it("no durable document → no row (the column is NOT NULL, and a record about a file we did not keep is a record about nothing)", () => {
    expect(unknownDocRow(rec, { companyId: UUID, documentId: null })).toBeNull();
    expect(unknownDocRow(rec, { companyId: null, documentId: DOC })).toBeNull();
  });
  it("the load asks for the document's name, and a float id is not a row id", () => {
    expect(UNKNOWN_DOC_SELECT).toMatch(/documents\(name\)/);
    expect(isDbUnknownDocId(UUID)).toBe(true);
    expect(isDbUnknownDocId(1757800000000.42)).toBe(false);
  });
});

describe("the wiring (source)", () => {
  const app = read("src/App.jsx");
  it("the record is inserted through the verified insert before it is painted, and a refusal is audited", () => {
    const i = app.indexOf("const unkRow = unknownDocRow(unknownRecord,");
    expect(i).toBeGreaterThan(0);
    const body = app.slice(i, i + 1200);
    const ins = body.indexOf('await insertVerified(supabase, "unknown_documents", unkRow)');
    const stamp = body.indexOf("db_id: ins.row.id");
    const audit = body.indexOf('logAudit("unknown_doc_persist_failed"');
    const paint = body.indexOf("setUnknownDocs(prev => [unknownRecord, ...prev]);");
    expect(ins).toBeGreaterThan(0);
    expect(stamp).toBeGreaterThan(ins);
    expect(audit).toBeGreaterThan(stamp);
    expect(paint).toBeGreaterThan(audit);
  });
  it("loadAllData reads the table and a failed read does not empty the list", () => {
    expect(app).toMatch(/from\("unknown_documents"\)\.select\(UNKNOWN_DOC_SELECT\)\.eq\("company_id", cid\)\.eq\("dismissed", false\)/);
    expect(app).toMatch(/if \(Array\.isArray\(unkRes\.data\)\) setUnknownDocs\(unkRes\.data\.map\(unknownDocFromRow\)/);
    expect(app).not.toMatch(/setUnknownDocs\(\(unkRes\.data \|\| \[\]\)/);
  });
  it("a watch match is written to the row", () => {
    const i = app.indexOf("return { ...doc, watch_matches: newWatchMatches };");
    expect(i).toBeGreaterThan(0);
    const before = app.slice(i - 900, i).replace(/\s+/g, " ");
    expect(before).toMatch(/table: "unknown_documents", id: doc\.db_id, companyId: currentCompany\.id, patch: \{ watch_matches: newWatchMatches \}/);
    expect(before).toMatch(/unknown_doc_watch_persist_failed/);
    // the write sits directly behind the "is this row durable" test — `if (false)` around a
    // checked write is the recorded escape (C238/C240/C248), so the branch is pinned, not the call
    expect(before).toMatch(/if \(isDbUnknownDocId\(doc\.db_id\) && currentCompany\?\.id\) \{ checkedRowUpdate\(\{ supabase, table: "unknown_documents"/);
  });
  it("the posted marker is written back from Review, and a lost marker is said before ✓", () => {
    const view = read("src/components/views/ReviewView.jsx");
    for (const anchor of ["const mark = await persistUnknownDocPatch(doc, { posted: true });", "const mark = await persistUnknownDocPatch(doc, { watch_matches: nextMatches });"]) {
      const i = view.indexOf(anchor);
      expect(i, anchor).toBeGreaterThan(0);
      const after = view.slice(i, i + 700);
      const said = after.indexOf("Don't post it again");
      const tick = after.indexOf("Entry posted: ${doc.document_type}");
      expect(said).toBeGreaterThan(0);
      expect(tick).toBeGreaterThan(said);
    }
    expect(app).toMatch(/const persistUnknownDocPatch = async \(doc, patch\) => \{[\s\S]{0,300}checkedRowUpdate\(\{ supabase, table: "unknown_documents"/);
  });
});
