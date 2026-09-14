// ─────────────────────────────────────────────────────────────────────────────
// C361 — EDITS TO A LOADED CONTACT REACH THE DATABASE, AND "SAVED ✓" READS THE WRITE.
//
// `persistContact` chose UPDATE-vs-UPSERT on `contact.db_id`. The load mapping never set it
// (from the first commit), so every contact loaded from the database took the upsert path,
// hit the (company_id, name_key) unique index, was dropped by ON CONFLICT DO NOTHING, and
// came back `ok: true` with the OLD row. Vendor terms, emails, O111 aliases, 1099 business
// types and "marked 1099 sent" all vanished on reload, reported as saved. And the Customers
// form never called `persistContact` at all.
//
// Pinned from both ends: the resolver reads a loaded row's uuid `id`; the load mapping
// stamps `db_id`; `persistContact` resolves through the helper and refuses to call a
// conflict no-op a success; and each form writes FIRST and paints/says ✓ only on `ok`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { contactDbId, isDbId } from "../src/lib/contactIds.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const UUID = "3a704760-1111-4222-8333-444455556666";

describe("contactDbId — which row a contact object stands for", () => {
  it("a contact shaped like the load mapping used to produce (uuid id, no db_id) still resolves", () => {
    expect(contactDbId({ id: UUID, name: "Sysco" })).toBe(UUID);
  });
  it("an in-session contact (float id, no db_id) resolves to nothing — it must be inserted", () => {
    expect(contactDbId({ id: 1757800000000.123, name: "Sysco" })).toBeNull();
    expect(contactDbId({ id: "Sysco", name: "Sysco" })).toBeNull();     // a ledger-only vendor row keyed by name
  });
  it("db_id wins over id, and a non-uuid db_id is ignored", () => {
    expect(contactDbId({ id: 12.5, db_id: UUID })).toBe(UUID);
    expect(contactDbId({ id: UUID, db_id: "nope" })).toBe(UUID);
    expect(contactDbId(null)).toBeNull();
  });
  it("isDbId is a uuid test, not a truthiness test", () => {
    expect(isDbId(UUID)).toBe(true);
    expect(isDbId("1757800000000.123")).toBe(false);
    expect(isDbId(1)).toBe(false);
  });
});

describe("the load mapping and persistContact (source)", () => {
  const app = read("src/App.jsx");
  it("loaded contacts carry db_id = the row id", () => {
    const start = app.indexOf("setContacts(contactsData.map(c => ({");
    expect(start).toBeGreaterThan(0);
    const end = app.indexOf("})));", start);
    const block = app.slice(start, end);
    expect(block).toMatch(/\bdb_id:\s*c\.id\b/);
  });
  it("persistContact decides update-vs-upsert through contactDbId, not contact.db_id alone", () => {
    const start = app.indexOf("const persistContact = async (contact) => {");
    expect(start).toBeGreaterThan(0);
    const end = app.indexOf("const createOrUpdateContact", start);
    const fn = app.slice(start, end);
    expect(fn).toMatch(/const dbId = contactDbId\(contact\)/);
    expect(fn).toMatch(/if \(dbId\) return await supabase\.from\("contacts"\)\.update\(/);
    expect(fn).not.toMatch(/if \(contact\.db_id\) return/);
  });
  it("a conflict no-op (row existed, nothing written) is NOT reported as ok", () => {
    const start = app.indexOf("const persistContact = async (contact) => {");
    const fn = app.slice(start, app.indexOf("const createOrUpdateContact", start));
    // the flag is set in the recovery branch and gates the verdict
    const flagSet = fn.indexOf("conflictNoop = true;");
    const recover = fn.indexOf('return await supabase.from("contacts").select("*")', flagSet);
    expect(flagSet).toBeGreaterThan(0);
    expect(recover).toBeGreaterThan(flagSet);
    expect(fn).toMatch(/if \(!error && conflictNoop\) \{\s*return \{ ok: false/);
  });
  it("an invoice-driven enrichment audits 'updated' only when the write landed", () => {
    const start = app.indexOf("const createOrUpdateContact = (data) => {");
    const fn = app.slice(start, start + 3000);
    expect(fn).toMatch(/persistContact\(merged\)\.then\(r => \{\s*if \(r\?\.ok\) logAudit\("contact_updated"/);
  });
});

// Each form: the write is awaited, its verdict is read, and the ✓ / close comes AFTER.
// Structure-pinned (C238/C240): presence of `persistContact(` survives `if (false)`.
function gatedSave(src, fnName, closer) {
  const start = src.indexOf(fnName);
  expect(start, `${fnName} not found`).toBeGreaterThan(0);
  const body = src.slice(start, start + 2500);
  const call = body.indexOf("const r = await persistContact(");
  const gate = body.indexOf("if (!r?.ok)", call);
  const close = body.indexOf(closer, gate);
  expect(call, "the write is awaited into r").toBeGreaterThan(0);
  expect(gate, "the verdict is read").toBeGreaterThan(call);
  expect(close, `${closer} comes after the gate`).toBeGreaterThan(gate);
  // and the gate returns before anything is painted
  expect(body.slice(gate, gate + 260)).toMatch(/nothing was changed|still shows as needing one/);
  expect(body.slice(gate, gate + 260)).toMatch(/return;/);
}

describe("the forms write first and say ✓ only on the record", () => {
  it("Tax1099View — save vendor classification", () => {
    gatedSave(read("src/components/views/Tax1099View.jsx"), "const saveVendor = async", 'showNotification("Vendor saved ✓")');
  });
  it("Tax1099View — mark 1099 sent", () => {
    gatedSave(read("src/components/views/Tax1099View.jsx"), "const markSent = async", "Marked 1099 sent for");
  });
  it("VendorsView — edit a vendor", () => {
    gatedSave(read("src/components/views/VendorsView.jsx"), "const saveEdit = async (v)", "setEditingId(null)");
  });
  it("CustomersView — edit a customer (this form never persisted before)", () => {
    const src = read("src/components/views/CustomersView.jsx");
    gatedSave(src, "const saveEdit = async (c)", "setEditingId(null)");
  });
  it("the local paint happens after the gate in every form, never before the write", () => {
    for (const [file, fn] of [
      ["src/components/views/Tax1099View.jsx", "const saveVendor = async"],
      ["src/components/views/Tax1099View.jsx", "const markSent = async"],
      ["src/components/views/VendorsView.jsx", "const saveEdit = async (v)"],
      ["src/components/views/CustomersView.jsx", "const saveEdit = async (c)"],
    ]) {
      const src = read(file); const start = src.indexOf(fn); const body = src.slice(start, start + 2500);
      const write = body.indexOf("await persistContact(");
      const paint = body.indexOf("setContacts(");
      expect(paint, `${file} ${fn}: setContacts precedes the write`).toBeGreaterThan(write);
    }
  });
});

describe("SendInvoiceView resolves the customer id through the shared helper", () => {
  it("no inline uuid workaround remains", () => {
    const src = read("src/components/views/SendInvoiceView.jsx");
    expect(src).toMatch(/contactDbId\(existing\)/);
    expect(src).not.toMatch(/existing\.db_id \|\|/);
  });
});
