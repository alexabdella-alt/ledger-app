import { describe, it, expect } from "vitest";
import fs from "fs";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// C392 — the GAAP card's audit row follows the write, and the rollback sentence reads the
// rollback's result.
const app = fs.readFileSync("src/App.jsx", "utf8");
const a0 = app.indexOf("const applyGaapAnswer = ");
const apply = app.slice(a0, app.indexOf("const compensateCapitalization = ", a0));
const c0 = app.indexOf("const compensateCapitalization = ");
const comp = app.slice(c0, app.indexOf("const createFixedAssetWithSchedule", c0));

describe("★ applyGaapAnswer", () => {
  it("finds both blocks (anti-vacuity)", () => { expect(apply.length).toBeGreaterThan(800); expect(comp.length).toBeGreaterThan(400); });
  it("writes 'invoice_booked' and enriches the contact only inside `if (jeId) {`", () => {
    const book = apply.indexOf("const jeId = await bookToDb(finalInv)");
    const gate = apply.indexOf("if (jeId) {", book);
    const audit = apply.indexOf('logAudit("invoice_booked"', book);
    const contact = apply.indexOf("createOrUpdateContact(", book);
    expect(gate).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(gate);
    expect(contact).toBeGreaterThan(gate);
    const close = apply.indexOf("\n    }", gate);
    expect(audit).toBeLessThan(close);
    expect(contact).toBeLessThan(close);
    expect(book).toBeGreaterThan(-1);
  });
});

describe("★★ compensateCapitalization says what actually happened", () => {
  it("a failed rollback returns after its own sentence — 'don't try again' — and never reaches the 'rolled back' one", () => {
    const fail = comp.slice(comp.indexOf("if (!comp.ok) {"), comp.indexOf("setInvoices(prev => prev.filter"));
    expect(fail).toMatch(/Don't try again — send this to your accountant/);
    expect(fail).toMatch(/return;\s*\}\s*$/);
    expect(fail).not.toMatch(/so we undid the entry/);
    const ok = comp.slice(comp.indexOf("setInvoices(prev => prev.filter"));
    expect(ok).toMatch(/so we undid the entry — nothing is in your books/);
  });
  it("both sentences pass the owner bar", () => {
    for (const m of comp.matchAll(/showNotification\(`([^`]*)`/g)) {
      expect([m[1], containsOwnerJargon(m[1].replace(/\$\{[^}]*\}/g, "X"))]).toEqual([m[1], false]);
    }
  });
});
