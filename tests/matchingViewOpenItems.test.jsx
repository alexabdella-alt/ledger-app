import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import MatchingView from "../src/components/views/MatchingView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C358 — THE MATCHING SCREEN'S OPEN-ITEM PANELS READ THE MATCHER'S OWN UNIVERSE.
// They derived openness from `type` + `payment_status` (§9's named anti-pattern), so a
// direct-to-cash expense and every legacy bank line (null status reads as "unpaid") were
// listed as OPEN PAYABLES the engine would never propose a match for — the panel and the
// engine below it disagreed about what was open. Rendered, with rows shaped the way the
// ledger actually flattens them.
// ═════════════════════════════════════════════════════════════════════════════
const text = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const seat = { isReviewerSeat: true, role: "accountant", viewIds: ["matching"], sections: [] };
const row = (id, vendor, amount, gl_code, secondary_gl_code, extra = {}) => ({
  id, db_entry_id: `je_${id}`, vendor, amount, date: "2026-03-05", gl_code, gl_name: "x", secondary_gl_code, secondary_gl_name: "y",
  type: Number(gl_code) >= 4000 && Number(gl_code) < 5000 ? "revenue" : "expense", status: "booked", debit_credit: "debit", ...extra,
});

describe("★★ C358 — open payables/receivables on the Matching screen", () => {
  it("a bill with an A/P leg is open; a direct-to-cash expense is NOT, whatever its flag says", () => {
    const invoices = [
      row("bill", "Hill Country Milling Co.", 824.6, "5010", "2000", { payment_status: "unpaid" }),
      row("cash", "Corner Store", 42.0, "6600", "1000", { payment_status: "unpaid", source: "bank_import" }),   // paid at the register; the flag lies
      row("legacy", "Old Bank Line", 99.0, "6600", "1000", { payment_status: null, source: "bank_import" }),
    ];
    const t = text(renderViewHtml(MatchingView, { ...POPULATED, invoices, navSeat: seat }));
    expect(t).toContain("Hill Country Milling Co.");
    expect(t).not.toContain("Corner Store");
    expect(t).not.toContain("Old Bank Line");
    expect(t).toMatch(/OPEN PAYABLES 1 \$824\.60 outstanding/i);
  });
  it("a customer invoice with an A/R leg is an open receivable; a cash sale is not", () => {
    const invoices = [
      row("ar", "Metro Cafe", 1500, "4010", "1100", { debit_credit: "credit" }),
      row("cashsale", "Walk-in", 60, "4010", "1000", { debit_credit: "credit" }),
    ];
    const t = text(renderViewHtml(MatchingView, { ...POPULATED, invoices, navSeat: seat }));
    expect(t).toContain("Metro Cafe");
    expect(t).not.toContain("Walk-in");
    expect(t).toMatch(/OPEN RECEIVABLES 1 \$1,500\.00 outstanding/i);
  });
  it("★ the SIDE comes from the leg, not the `type` flag — a receivable whose flag drifted is still a receivable", () => {
    // O73's root cause: a `type` string that drifted starved the candidate set. The A/R leg
    // is the fact; the flag is a cache of it.
    const invoices = [row("ar", "Metro Cafe", 1500, "4010", "1100", { debit_credit: "credit", type: "expense" })];
    const t = text(renderViewHtml(MatchingView, { ...POPULATED, invoices, navSeat: seat }));
    expect(t).toMatch(/OPEN RECEIVABLES 1 \$1,500\.00 outstanding/i);
    expect(t).toMatch(/OPEN PAYABLES 0/i);
  });
  it("★ a bill whose payment is already recorded is not open, even with a stale flag", () => {
    const invoices = [
      row("bill", "Hill Country Milling Co.", 824.6, "5010", "2000", { payment_status: "unpaid" }),
      row("pay", "Hill Country Milling Co.", 824.6, "2000", "1000", { import_metadata: { kind: "payment", payment_for: "je_bill" }, source: "manual" }),
    ];
    const t = text(renderViewHtml(MatchingView, { ...POPULATED, invoices, navSeat: seat }));
    expect(t).toMatch(/OPEN PAYABLES 0/i);
  });
  it("the view reads matchableOpenItems and carries no openness rule of its own", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/MatchingView.jsx"), "utf8");
    expect(src).toMatch(/matchableOpenItems\(invoices, \{ arCode, apCode, accruedCode \}\)/);
    expect(src).not.toMatch(/payment_status!=="paid"|payment_status!=="collected"/);
  });
});
