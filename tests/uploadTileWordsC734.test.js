// ★ C734 — the upload tile in the reader's words: the owner sees "Reading your bill or receipt…",
// not "Processing as Invoice…"; a file we couldn't place says where it went, not "Entry proposed".
// The accountant keeps the precise wording. Receipts and bills read "Added to your books", as a
// statement does.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { queueItemStatusCopy } from "../src/lib/uploadQueueTile.js";
import { invoiceOutcomeCopy } from "../src/lib/uploadOutcome.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

describe("while it reads", () => {
  it("★ the owner: plain, and a receipt is not called an invoice", () => {
    expect(queueItemStatusCopy({ status: "classifying" })).toBe("⟳ Reading…");
    expect(queueItemStatusCopy({ status: "processing", type: "invoice" })).toBe("⟳ Reading your bill or receipt…");
    expect(queueItemStatusCopy({ status: "processing", type: "bank_statement" })).toBe("⟳ Reading your bank statement…");
    expect(queueItemStatusCopy({ status: "processing", type: "weird" })).toBe("⟳ Reading…");
  });
  it("the accountant keeps the precise wording", () => {
    expect(queueItemStatusCopy({ status: "classifying" }, { cockpit: true })).toBe("⟳ Identifying document type...");
    expect(queueItemStatusCopy({ status: "processing", type: "invoice" }, { cockpit: true })).toBe("⟳ Processing as Invoice...");
  });
  it("nothing for states it doesn't describe", () => {
    expect(queueItemStatusCopy({ status: "done", type: "invoice", result: {} })).toBe(null);
    expect(queueItemStatusCopy({ status: "error" })).toBe(null);
  });
});

describe("a file we couldn't place", () => {
  const item = { status: "done", type: "unknown", result: { document_type: "W-9", entry_needed: true } };
  it("★ the owner hears where it went, and who looks next — no 'Entry proposed'", () => {
    const t = queueItemStatusCopy(item);
    expect(t).toBe("We couldn't tell what this is — it's saved in Documents, and your accountant will take a look.");
    expect(containsOwnerJargon(t)).toBe(false);
    expect(queueItemStatusCopy(item, { hasAccountant: false })).toBe("We couldn't tell what this is — it's saved in Documents.");
  });
  it("the accountant sees the type and whether an entry is proposed", () => {
    expect(queueItemStatusCopy(item, { cockpit: true })).toBe("⚠ W-9 · Entry proposed — needs review");
  });
  it("Home reads it from the one function", () => {
    const src = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(src).not.toMatch(/Identifying document type|Processing as \$\{tc\.label\}|Entry proposed — needs review/);
    expect((src.match(/queueItemStatusCopy\(item, \{ cockpit, hasAccountant \}\)/g) || []).length).toBe(2);
  });
});

describe("receipts and bills", () => {
  it("★ 'Added to your books', and several are 'bills'", () => {
    expect(invoiceOutcomeCopy({ invoiceCount: 1, amount: 59.99, vendor: "Adobe", bookedAs: "software" })).toBe("✓ Added to your books: Adobe · $59.99 as software");
    expect(invoiceOutcomeCopy({ invoiceCount: 3, amount: 300 })).toBe("✓ 3 bills added to your books · $300.00 total");
  });
});
