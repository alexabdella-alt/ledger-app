import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";
import { auditActionLabel, docTypeLabel } from "../src/lib/plainLabels.js";

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : /\.(jsx?|ts)$/.test(e.name) && !/ 2\./.test(e.name) ? [path.join(d, e.name)] : []);
const ALL_IDS = [...new Set(walk("src").flatMap((f) => [...readFileSync(f, "utf8").matchAll(/(?:logAudit|logAI)\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1])))];
const JARGON = /_|\b(materialized|qbo|coa|recode|gl|recon|persist|je|txn|intake|anomaly|cutoff)\b/i;

describe("C580 — internal ids never reach an owner as ids", () => {
  it("found the logged actions (anti-vacuity)", () => { expect(ALL_IDS.length).toBeGreaterThan(80); });
  it("every action logged anywhere reads as words: no underscores, none of the internal vocabulary", () => {
    for (const id of ALL_IDS) expect(auditActionLabel(id), id).not.toMatch(JARGON);
  });
  it("the common ones read as a person would say them", () => {
    expect(auditActionLabel("invoice_booked")).toBe("Recorded a document");
    expect(auditActionLabel("account_materialized")).toBe("Added a category");
    expect(auditActionLabel("qbo_import_undo_unmarked")).toBe("QuickBooks import undo not marked");
    expect(auditActionLabel("payment_persist_failure")).toBe("Payment — didn't save");
    expect(auditActionLabel("")).toBe("Activity");
  });
  it("document types read as words", () => {
    expect(docTypeLabel("bank_statement")).toBe("Bank statement");
    expect(docTypeLabel("payroll")).toBe("Payroll report");
    expect(docTypeLabel("all")).toBe("All");
    expect(docTypeLabel("something_new")).toBe("Something new");
  });
  it("the screens use them", () => {
    const audit = readFileSync("src/components/views/AuditView.jsx", "utf8");
    expect(audit).toMatch(/\{auditActionLabel\(entry\.action\)\}/);
    expect(audit).not.toMatch(/immutable/);
    const docs = readFileSync("src/components/views/DocsView.jsx", "utf8");
    expect(docs).toMatch(/\{docTypeLabel\(doc\.type\)\}/);
    expect(docs).toMatch(/\{docTypeLabel\(t\)\}/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";

describe("C580 — the last of the owner audit", () => {
  const src = (f) => readFileSync(f, "utf8");
  it("Transactions explains 'Needs Review' when you filter to it, and on the pill", () => {
    const b = src("src/components/views/BooksView.jsx");
    expect(b).toMatch(/filter==="review" && \(\s*<div data-review-explainer/);
    expect(b).toMatch(/title="We weren't sure about this one — open it to check the category"/);
  });
  it("a transaction's other side reads 'Paid from / into' to an owner; the accountant keeps 'Against'", () => {
    expect(src("src/components/views/DetailView.jsx")).toMatch(/showCodesFor\(navSeat\) \? "Against" : "Paid from \/ into"/);
    expect(src("src/components/TransactionDetailPanel.jsx")).toMatch(/showCodes \? "Against" : "Paid from \/ into"/);
  });
  it("Taxes speaks plainly and promises no tracking it doesn't do", () => {
    const t = src("src/components/views/TaxView.jsx");
    expect(t).not.toMatch(/YTD Net Income|Total Estimated Liability|Tag to track/);
    expect(t).toMatch(/Profit so far this year/);
  });
  it("a customer's page offers to bill them; Vendor rules says what a rule does", () => {
    expect(src("src/components/views/CustomersView.jsx")).toMatch(/<NextStep label="Send an invoice →" onClick=\{\(\)=>setView\("send-invoice"\)\} \/>/);
    expect(src("src/components/views/RulesView.jsx")).toMatch(/Tell us once where a vendor goes/);
  });
  void renderToStaticMarkup;
});
