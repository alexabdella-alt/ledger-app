// C728 — documents and the question flow.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { filterDocuments } from "../src/lib/docLibrary.js";

const app = readFileSync("src/App.jsx", "utf8");
const flow = readFileSync("src/components/ClarificationFlow.jsx", "utf8");

describe("★ an unanswered question survives a reload", () => {
  it("'answered' means linked to an entry the books hold — not a card's in-session id, not a deleted entry", () => {
    expect(app).toMatch(/const liveEntryIds = new Set\(\(invoices \|\| \[\]\)\.filter\(i => i && i\.status !== "voided" && !i\.deleted_at && i\.db_entry_id != null\)/);
    expect(app).toMatch(/\}, \[intakeRows, clarificationQueue, uploadQueue, docLibrary, invoices\]\);/);
  });
  it("a relink is checked and a failure recorded", () => {
    expect(app).toMatch(/\.eq\("linked_invoice_id", from\)\.select\("id"\);\s*if \(error \|\| \(hadLocal && !\(moved \|\| \[\]\)\.length\)\) \{/);
  });
});

describe("★ the answer does what it says", () => {
  it("'mostly personal' is money taken out, not a business cost", () => {
    expect(app).toMatch(/gl_code: personalUse \? rc\("owners_draw"\) : \(opt\.gl_code \|\| inv\.gl_code\)/);
  });
  it("a vehicle's business share is the cost; the rest is personal use, the bill still owed in full", () => {
    expect(app).toMatch(/\{ code: opt\.gl_code \|\| inv\.gl_code, debit: biz, credit: 0 \},\s*\{ code: rc\("owners_draw"\), debit: personal, credit: 0 \},\s*\{ code: rc\("accounts_payable"\), debit: 0, credit: total \},/);
  });
  it("a failed booking brings the card back, in every branch", () => {
    const body = app.slice(app.indexOf("const applyGaapAnswer = async (item, opt) => {"), app.indexOf("const compensateCapitalization"));
    expect((body.match(/restore\(\)/g) || []).length).toBeGreaterThanOrEqual(6);
    expect(body).toMatch(/if \(!inv\.date\) \{ showNotification\("We need the date on this document/);
  });
  it("a purchase question with no readable date asks the date first, and the answer carries it", () => {
    expect(flow).toMatch(/\.\.\.\(!inv\.date \? \[\{ field: "date", type: "date", prompt: "What date was this from\?"/);
    expect(flow).toMatch(/applyGaapAnswer\(item, \{ \.\.\.sel, \.\.\.\(answers\.date \? \{ date: answers\.date \} : \{\}\) \}\);/);
  });
  it("one booking per question across every card showing it", () => {
    expect(flow).toMatch(/const QUESTION_BOOKINGS = makeKeyedInFlight\(\);\s*const QUESTIONS_BOOKED = new Set\(\);/);
  });
});

describe("★ the library", () => {
  it("an evening upload filters on the day the card shows", () => {
    const d = new Date(2026, 0, 31, 21, 0, 0);   // Jan 31, 9pm local
    const docs = [{ id: "a", name: "x.pdf", type: "other", uploaded_at: d.toISOString() }];
    expect(filterDocuments(docs, { from: "2026-01-31", to: "2026-01-31" }).map((x) => x.id)).toEqual(["a"]);
  });
  it("the preview header is readable, says the type in words and the local day", () => {
    const p = readFileSync("src/components/DocumentPreviewModal.jsx", "utf8");
    expect(p).not.toMatch(/color: "var\(--sc-bg\)"/);
    expect(p).toMatch(/docTypeLabel\(doc\.type\)/);
    expect(p).not.toMatch(/uploaded_at\?\.slice\(0, 10\)/);
  });
});
