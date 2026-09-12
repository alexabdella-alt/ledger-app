import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dedupePatch, linksOver, PLACEHOLDER_DOCUMENT_TYPE, stampsOver, documentDate, DOC_DATE_SOURCE } from "../src/lib/docLibrary";

// ── THE BUG THIS PINS (found live, 2026-09-10) ────────────────────────────
// "When I'm in Transactions and click a transaction it isn't showing the invoice — but I
// see all the invoices in the Documents tab."
//
// Two `storeDocument` calls per invoice file: O97's durable-first store (type placeholder,
// link null) and then the invoice path (real type, the invoice it belongs to). Same bytes,
// so C193's content-hash dedupe returns the first row. C300 taught that branch to stamp
// the type it now knew; it never stamped the LINK, so `linked_invoice_id` stayed null on
// every invoice document since. The post-booking relink then updated rows WHERE the link
// equalled the in-session id — matched nothing — and the detail panel's `findSourceDoc`
// found nothing, beside a library that listed the file.
//
// ★ THE ·3a SHAPE, A FIFTH TIME: `stampsOver` was tested, the relink was tested, the
// matcher was tested — each against its own fixture. The SEQUENCE was not. So this file
// runs the sequence: store → store again → relink → reload shape → the matcher a
// transaction actually uses.
const APP = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("../src/components/TransactionDetailPanel.jsx", import.meta.url), "utf8");
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

// The matcher, extracted verbatim in spirit from TransactionDetailPanel.findSourceDoc.
// A source guard below asserts the panel still matches on both ids, so this stand-in
// cannot drift from it silently.
const findSourceDoc = (docLibrary, inv) => (docLibrary || []).find(d =>
  d.linked_invoice_id && (String(d.linked_invoice_id) === String(inv?.id) || String(d.linked_invoice_id) === String(inv?.db_entry_id)));

// A stand-in for the `documents` table plus the three App.jsx behaviours that touch it.
// `dedupe` is injectable so ONE test can restore the shipped behaviour (type only) and
// watch the symptom reappear — a passing sequence proves nothing unless the fixture can
// express the bug.
function makeStore({ dedupe = (row, want) => dedupePatch(row, want) } = {}) {
  const rows = [];
  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  return {
    rows,
    // storeDocument(name, bytes, type, linkedId): hash dedupe, then insert.
    store(hash, type, linkedId) {
      const dupe = rows.find(r => r.content_hash === hash);
      if (dupe) { Object.assign(dupe, dedupe(dupe, { type, linkedId })); return dupe.id; }
      const row = { id: uuid(), content_hash: hash, document_type: type, linked_invoice_id: linkedId != null ? String(linkedId) : null };
      rows.push(row); return row.id;
    },
    // relinkDocsForInvoice(from, to): UPDATE documents SET link = to WHERE link = from.
    relink(from, to) { for (const r of rows) if (String(r.linked_invoice_id) === String(from)) r.linked_invoice_id = String(to); },
    // loadAllData's mapping of a documents row into the docLibrary shape.
    library() { return rows.map(d => ({ id: d.id, type: d.document_type, linked_invoice_id: d.linked_invoice_id })); },
  };
}

const HASH = "sha256:abc";
const IN_SESSION = 1757520000000.4321;               // Date.now()+Math.random(), as buildUploadedInvoice mints
const JE = "3f2b1c9e-1111-4222-8333-444455556666";   // the durable id post_journal_entry returns

describe("a transaction shows its source document — the whole sequence", () => {
  it("durable-first store, then the invoice path on the same bytes, then relink → the entry finds its document", () => {
    const db = makeStore();
    const firstId = db.store(HASH, PLACEHOLDER_DOCUMENT_TYPE, null);      // O97, before classification
    const secondId = db.store(HASH, "invoice", IN_SESSION);             // the invoice path, same bytes
    expect(secondId).toBe(firstId);                                     // C193: one row, not two
    db.relink(IN_SESSION, JE);                                          // after booking resolves

    const lib = db.library();
    expect(lib).toHaveLength(1);
    expect(lib[0].type).toBe("invoice");
    // In-session object (id = float, db_entry_id = uuid) AND the reloaded object (both = uuid).
    expect(findSourceDoc(lib, { id: IN_SESSION, db_entry_id: JE })?.id).toBe(firstId);
    expect(findSourceDoc(lib, { id: JE, db_entry_id: JE })?.id).toBe(firstId);
    // And the Documents tab now dates the file by the entry it produced, not the upload.
    expect(documentDate(lib[0], [{ id: JE, db_entry_id: JE, date: "2026-08-14" }]))
      .toEqual({ date: "2026-08-14", source: DOC_DATE_SOURCE.LINKED });
  });

  it("the SHIPPED behaviour — stamp the type, forget the link — leaves the row in the library and invisible from the transaction", () => {
    const shipped = (row, { type }) => (stampsOver(row.document_type, type) ? { document_type: type } : {});
    const db = makeStore({ dedupe: shipped });
    db.store(HASH, PLACEHOLDER_DOCUMENT_TYPE, null);
    db.store(HASH, "invoice", IN_SESSION);
    db.relink(IN_SESSION, JE);
    const lib = db.library();
    expect(lib).toHaveLength(1);                                        // "I see it in the Documents tab"
    expect(lib[0].type).toBe("invoice");                                // C300 did its half
    expect(lib[0].linked_invoice_id).toBeNull();                        // …and this half was missing
    expect(findSourceDoc(lib, { id: JE, db_entry_id: JE })).toBeUndefined();   // "it isn't showing the invoice"
  });

  it("booking that resolves BEFORE the second store links straight to the durable id (no relink needed)", () => {
    const db = makeStore();
    db.store(HASH, PLACEHOLDER_DOCUMENT_TYPE, null);
    db.store(HASH, "invoice", JE);                                      // effectiveLink() already saw db_entry_id
    expect(findSourceDoc(db.library(), { id: JE, db_entry_id: JE })).toBeDefined();
  });

  it("a genuine re-upload of an already-linked document is NOT moved off the entry it backs", () => {
    const db = makeStore();
    db.store(HASH, PLACEHOLDER_DOCUMENT_TYPE, null);
    db.store(HASH, "invoice", IN_SESSION);
    db.relink(IN_SESSION, JE);
    // Months later: same bytes dropped again, booked as a second entry (a real duplicate).
    db.store(HASH, "invoice", "another-in-session-id");
    expect(db.library()[0].linked_invoice_id).toBe(JE);
  });
});

describe("linksOver / dedupePatch — monotone, like stampsOver", () => {
  it("links null → value", () => { expect(linksOver(null, "x")).toBe(true); expect(linksOver("", "x")).toBe(true); });
  it("never re-points an existing link", () => { expect(linksOver("a", "b")).toBe(false); });
  it("does nothing with nothing to link", () => { expect(linksOver(null, null)).toBe(false); expect(linksOver(null, "")).toBe(false); });
  it("returns an EMPTY patch when there is nothing to say, so the caller can skip the write", () => {
    expect(dedupePatch({ document_type: "invoice", linked_invoice_id: "a" }, { type: "invoice", linkedId: "b" })).toEqual({});
    expect(dedupePatch({ document_type: "other", linked_invoice_id: null }, { type: "other", linkedId: null })).toEqual({});
  });
  it("stamps both halves when both are unknown, and stringifies the link the way the column stores it", () => {
    expect(dedupePatch({ document_type: "other", linked_invoice_id: null }, { type: "invoice", linkedId: IN_SESSION }))
      .toEqual({ document_type: "invoice", linked_invoice_id: String(IN_SESSION) });
  });
  it("stamps ONLY the link when the type is already known (a bank statement re-stored by a path that now knows its statement)", () => {
    expect(dedupePatch({ document_type: "invoice", linked_invoice_id: null }, { type: "invoice", linkedId: JE }))
      .toEqual({ linked_invoice_id: JE });
  });
});

// ── THE SEAM'S EDGE, PINNED IN SOURCE ────────────────────────────────────
// The sequence above runs a stand-in dedupe; `storeDocument` itself is not importable.
// So the branch in App.jsx is held to the same contract by reading it.
describe("App.jsx storeDocument's dedupe branch writes the link, not only the type", () => {
  const src = code(APP);
  const start = src.indexOf("const storeDocument = async");
  // `code()` strips line comments, so the section banner cannot be the anchor — the next
  // declaration is. (An end anchor that is not found slices to EOF and passes vacuously.)
  const end = src.indexOf("const [payrollImports, setPayrollImports]", start);
  const fn = src.slice(start, end);
  it("is scoped to a non-empty slice", () => { expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start); });

  it("selects linked_invoice_id on the dedupe read, or dedupePatch cannot know whether the row is already linked", () => {
    expect(fn).toMatch(/\.select\("id, document_type, linked_invoice_id"\)[\s\S]{0,200}content_hash/);
  });
  it("computes the patch through dedupePatch WITH the link, and writes it through the checked helper", () => {
    expect(fn).toMatch(/const patch = dedupePatch\(dupe, \{ type, linkedId: effectiveLink\(\) \}\)/);
    // Pinned as STRUCTURE, not presence: a write behind `if (false)` still contains the
    // call, and a source scan cannot see reachability (the C238/C240/C248 escape). The
    // guard on the write must be the non-empty patch, and it must lead straight into it.
    expect(fn).toMatch(/if \(Object\.keys\(patch\)\.length\) \{\s*const r = await checkedRowUpdate\(\{[^}]*table: "documents", id: dupe\.id,[\s\S]{0,120}patch, label: "document_dedupe_stamp"/);
  });
  it("applies the SAME patch to the existing in-session card, so the relink can find it before any reload", () => {
    expect(fn).toMatch(/String\(d\.id\) !== String\(dupe\.id\) \? d : \{[\s\S]{0,200}linked_invoice_id: patch\.linked_invoice_id/);
  });
  it("no longer carries a second, hand-rolled link resolution beside the shared one", () => {
    expect((fn.match(/invoicesRef\.current/g) || []).length).toBe(1);
  });
});

describe("the detail panel still matches a document on either id", () => {
  it("findSourceDoc compares linked_invoice_id to inv.id AND inv.db_entry_id", () => {
    const src = code(PANEL);
    expect(src).toMatch(/String\(d\.linked_invoice_id\) === String\(inv\?\.id\)/);
    expect(src).toMatch(/String\(d\.linked_invoice_id\) === String\(inv\?\.db_entry_id\)/);
  });
});

// ── THE ATTACH BUTTON MAY NOT SAY "✓" OVER A LINK THAT DID NOT LAND ─────────
// Before O136 it said "Source document attached ✓" unconditionally — on a persist failure
// (storeDocument returns an in-session float, and had ALREADY shown its own error toast)
// and on a file already in the library (the dedupe branch returned early without linking).
// The button the operator would reach for to repair O136 was itself broken by it.
describe("the manual attach button is gated on the record, not the click", () => {
  const panel = code(PANEL);
  const start = panel.indexOf("const handleSourceUpload = async");
  const end = panel.indexOf("const doRecode = async", start);
  const fn = panel.slice(start, end);
  it("is scoped to a non-empty slice", () => { expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start); });
  it("reads storeDocument's return and shows ✓ only for a durable id", () => {
    expect(fn).toMatch(/const storedId = await storeDocument\(/);
    expect(fn).toMatch(/if \(isDurableDocId\(storedId\)\) showNotification\("Source document attached ✓"\)/);
    expect(panel).toMatch(/import \{ isDurableDocId \} from "\.\.\/lib\/docLibrary"/);
  });
  it("storeDocument returns the in-session fallback when a REQUESTED link did not land on an existing row", () => {
    const src = code(APP);
    const s = src.indexOf("const storeDocument = async");
    const e = src.indexOf("const [payrollImports, setPayrollImports]", s);
    const body = src.slice(s, e);
    expect(body).toMatch(/if \(!stampOk && patch\.linked_invoice_id\) return doc\.id;/);
    // and the failure is REPORTED, not merely logged — the insert path's convention.
    expect(body).toMatch(/if \(!r\.ok\) \{\s*console\.error\("\[documents\] dedupe stamp failed:"[\s\S]{0,300}reportDocError\(queueItemId,/);
  });
});

// ── THE OTHER DIRECTION: A DOCUMENT SAYS WHICH ENTRY IT BECAME ──────────────
import { linkedEntryFor } from "../src/lib/docLibrary";
describe("the Documents card names the entry a file became and opens it (C326)", () => {
  const doc = { id: "d1", linked_invoice_id: JE };
  const rows = [{ id: JE, db_entry_id: JE, vendor: "Roma Cheese & Dairy", amount: 551.2, date: "2026-08-04" }];
  it("resolves on the durable id and on the in-session id, like the panel's matcher", () => {
    expect(linkedEntryFor(doc, rows)?.vendor).toBe("Roma Cheese & Dairy");
    expect(linkedEntryFor({ linked_invoice_id: IN_SESSION }, [{ id: IN_SESSION, db_entry_id: JE, vendor: "x" }])?.vendor).toBe("x");
    expect(linkedEntryFor({ linked_invoice_id: null }, rows)).toBeNull();
    expect(linkedEntryFor({ linked_invoice_id: "nope" }, rows)).toBeNull();
  });
  it("the card's DATE and the card's DOOR come from one resolver, so they cannot name different entries", () => {
    expect(documentDate(doc, rows)).toEqual({ date: "2026-08-04", source: DOC_DATE_SOURCE.LINKED });
    const src = readFileSync(new URL("../src/lib/docLibrary.js", import.meta.url), "utf8");
    const body = code(src);
    const fn = body.slice(body.indexOf("export function documentDate"), body.indexOf("export function documentDateLabel"));
    expect(fn).toMatch(/linkedEntryFor\(doc, invoices\)/);
    expect(fn).not.toMatch(/\.find\(/);            // no second lookup of its own
  });
});
