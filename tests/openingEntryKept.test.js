import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { planEntryRemoval, planBulkRemoval, REMOVAL, OPENING_KEEP_SENTENCE, isOpeningEntry } from "../src/lib/signedPeriod.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C467 — DELETE WAS OFFERED ON THE OPENING-BALANCE ENTRY. Removing it alone left the
// `opening_balances` rows saying "posted": cutoff locked, grid full, onboarding ticked,
// cash on hand at zero, and no way to post another without finding "Redo opening setup".
// The starting-balances screen owns every change to that entry.
// ═════════════════════════════════════════════════════════════════════════════
const opening = { id: "o1", db_entry_id: "o1", vendor: "Opening balances as of 2026-01-01", date: "2026-01-01", source: "opening_balance", amount: 5000 };
const bill = { id: "b1", db_entry_id: "b1", vendor: "Sysco", date: "2026-03-04", source: "universal_upload", amount: 500 };

describe("C467 · the opening entry is kept", () => {
  it("planEntryRemoval returns KEEP with the sentence, and no confirm", () => {
    const p = planEntryRemoval(opening, []);
    expect(p.mode).toBe(REMOVAL.KEEP);
    expect(p.confirm).toBeNull();
    expect(p.blocked).toBe(OPENING_KEEP_SENTENCE);
    expect(planEntryRemoval(bill, []).mode).toBe(REMOVAL.DELETE);
  });
  it("the bulk planner leaves it out of removable and says so", () => {
    const p = planBulkRemoval([opening, bill], []);
    expect(p.removable.map((e) => e.id)).toEqual(["b1"]);
    expect(p.kept.map((e) => e.id)).toEqual(["o1"]);
    expect(p.blocked).toContain("starting balances");
    expect(planBulkRemoval([bill], []).blocked).toBeNull();
  });
  it("the sentences pass the owner bar", () => {
    expect(containsOwnerJargon(OPENING_KEEP_SENTENCE)).toBe(false);
    expect(containsOwnerJargon(planBulkRemoval([opening], []).blocked)).toBe(false);
  });
  it("isOpeningEntry keys on the source only", () => {
    expect(isOpeningEntry(opening)).toBe(true);
    expect(isOpeningEntry({ ...opening, source: "manual" })).toBe(false);
    expect(isOpeningEntry(null)).toBe(false);
  });
});

describe("C467 · every removal door refuses it", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  const panel = fs.readFileSync("src/components/TransactionDetailPanel.jsx", "utf8");
  const between = (a, b) => { const i = app.indexOf(a); expect(i).toBeGreaterThan(-1); const j = app.indexOf(b, i); expect(j).toBeGreaterThan(i); return app.slice(i, j); };
  it("removeEntry stops on KEEP before either mechanism", () => {
    const fn = between("const removeEntry = async (invoice, byAI = false) => {", "const removalPlanFor");
    expect(fn).toMatch(/\n\s*if \(plan\.mode === REMOVAL\.KEEP\) \{[\s\S]*?return \{ ok: false, mode: plan\.mode \};/);
    expect(fn.indexOf("REMOVAL.KEEP")).toBeLessThan(fn.indexOf("REMOVAL.CORRECT"));
  });
  it("softDeleteJournalEntry refuses before any write (the AI delete and bulk paths reach it directly)", () => {
    const fn = between("const softDeleteJournalEntry = async (invoice) => {", "const uid = session?.user?.id");
    expect(fn).toMatch(/\n\s*if \(isOpeningEntry\(invoice\)\) \{[\s\S]*?return \[\];/);
  });
  it("reverseJournalEntry refuses (the AI void path)", () => {
    const fn = between("const reverseJournalEntry = async (invoice, reason, byAI = false) => {", "const origId =");
    expect(fn).toMatch(/\n\s*if \(isOpeningEntry\(invoice\)\) \{ showNotification\(OPENING_KEEP_SENTENCE, "error"\); return null; \}/);
  });
  it("the panel shows a sentence in place of Delete, ahead of the already-corrected branch", () => {
    expect(panel).toMatch(/sel\.source === "opening_balance"\s*\n[^\n]*\n\s*\? <span data-no-remove/);
    expect(panel.indexOf("data-no-remove")).toBeLessThan(panel.indexOf("? <button disabled title={`Already removed"));
  });
});
