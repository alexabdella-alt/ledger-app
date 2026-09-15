import { describe, it, expect } from "vitest";
import fs from "fs";

// ═════════════════════════════════════════════════════════════════════════════
// C393 — "invoice_booked" IS WRITTEN AFTER THE LEDGER ANSWERS, EVERYWHERE. Six sites wrote
// the audit row and THEN called the writer (C240's shape: the audit trail recording an
// intention as an event). A refused booking — a signed month, the cutoff, an RPC error —
// left "booked → Food Cost" in the one record an accountant is entitled to trust.
// ═════════════════════════════════════════════════════════════════════════════
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const app = strip(fs.readFileSync("src/App.jsx", "utf8"));
const flow = strip(fs.readFileSync("src/components/ClarificationFlow.jsx", "utf8"));

describe("★★ every invoice_booked audit sits after a landed id", () => {
  it("ClarificationFlow writes it in ONE place — inside bookAnswer, after `if (!jeId) return false`", () => {
    const sites = [...flow.matchAll(/logAudit\("invoice_booked"/g)];
    expect(sites).toHaveLength(1);
    const b0 = flow.indexOf("const bookAnswer = async (finalInv, successText, audit = null) => {");
    expect(b0).toBeGreaterThan(-1);
    const body = flow.slice(b0, flow.indexOf("const total = questions.length", b0));
    expect(body.indexOf("if (!jeId) return false;")).toBeLessThan(body.indexOf('logAudit("invoice_booked"'));
    // and every caller hands its detail through, none logs itself
    expect([...flow.matchAll(/bookAnswer\(finalInv, [^;]*?\{ detail:/g)].length).toBe(4);
  });
  it("the upload batch audits inside bookToDb(inv).then(jeId => { if (jeId) { … } })", () => {
    const b0 = app.indexOf("bookPromises = highConfidence.map(inv => bookToDb(inv).then(jeId => {");
    expect(b0).toBeGreaterThan(-1);
    const body = app.slice(b0, b0 + 700);
    const gate = body.indexOf("if (jeId) {");
    expect(gate).toBeGreaterThan(-1);   // -1 would sort before everything and pass vacuously
    expect(gate).toBeLessThan(body.indexOf('logAudit("invoice_booked"'));
    expect(gate).toBeLessThan(body.indexOf("createOrUpdateContact(inv._contact)"));
    expect(body).toMatch(/return jeId;/);
  });
  it("no invoice_booked audit in App.jsx is followed within five lines by the write it describes", () => {
    const L = app.split("\n");
    const bad = [];
    L.forEach((l, i) => {
      if (!/logAudit\("invoice_booked"/.test(l)) return;
      const win = L.slice(i + 1, i + 6).join("\n");
      if (/\b(bookToDb|persistJournalEntry|persistMultiLineEntry)\(/.test(win)) bad.push(i + 1);
    });
    expect(bad).toEqual([]);
  });
});
