import { describe, it, expect } from "vitest";
import fs from "fs";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C396 — EVERY TOAST AN OWNER CAN SEE PASSES THE OWNER BAR. Screens are held to it
// (C315, C384, C386); the sentences that pop up over them were not, and a census found
// twelve — "Booked as deferred revenue", "Capitalized & depreciation scheduled", "Journal
// entry not found", "we couldn't record this upload in the intake ledger" — on paths an
// owner reaches (the question cards, the equipment-cost repair, the Home drop zone).
//
// App.jsx also raises toasts on reviewer-only paths; those are excused BY EXACT STRING
// with the screen that owns them, and a stale excuse (a string no longer in the source)
// fails, so a licence cannot lie open (C315's rule for its exemptions).
// ═════════════════════════════════════════════════════════════════════════════
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const toasts = (src) => [...strip(src).matchAll(/showNotification\??\.?\(\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')/g)]
  .map((m) => (m[1] ?? m[2] ?? m[3]));
const plain = (t) => t.replace(/\$\{[^}]*\}/g, "X");

// Reviewer-only toasts in App.jsx — each names the reviewer surface that raises it.
const REVIEWER_ONLY = {
  "Posted to the ledger — but we couldn't record that it's been posted. Don't post this entry again.": "ContractsView post (reviewer)",
  "Journal entry posted to ledger ✓": "AddView manual entry (reviewer; `add` is not a client view)",
  'Posted ${posted.length} entr${posted.length === 1 ? "y" : "ies"} to the ledger — but we couldn\'t record that they\'ve been posted. Don\'t post them again.': "ContractsView post-all (reviewer)",
  '✓ Posted ${posted.length} entr${posted.length === 1 ? "y" : "ies"} to ledger': "ContractsView post-all (reviewer)",
};

const OWNER_FILES = [
  "src/App.jsx", "src/components/ClarificationFlow.jsx", "src/components/TransactionDetailPanel.jsx",
  "src/components/DocumentPreviewModal.jsx", "src/components/ChatComposer.jsx",
  ...["DashboardView", "BooksView", "ApView", "ArView", "CustomersView", "VendorsView", "DocsView", "DetailView", "ReportsView",
      "SendInvoiceView", "SettingsView", "TeamView", "CoaView", "OpeningBalancesView", "RulesView", "RecurringView", "Tax1099View", "TaxView", "AuditView"]
    .map((v) => `src/components/views/${v}.jsx`),
];

describe("★★ toasts on owner-reachable paths pass the owner bar", () => {
  it("no jargon in any toast, outside the named reviewer-only exemptions", () => {
    const bad = [];
    let seen = 0;
    for (const f of OWNER_FILES) {
      for (const t of toasts(fs.readFileSync(f, "utf8"))) {
        seen++;
        if (REVIEWER_ONLY[t]) continue;
        if (containsOwnerJargon(plain(t))) bad.push(`${f}: ${t.slice(0, 120)}`);
      }
    }
    expect(seen).toBeGreaterThan(150);   // anti-vacuity
    expect(bad).toEqual([]);
  });
  it("native confirm() dialogs on owner-reachable screens pass the bar too", () => {
    for (const f of OWNER_FILES.concat(["src/components/views/QBOImportView.jsx"])) {
      const src = strip(fs.readFileSync(f, "utf8"));
      for (const m of src.matchAll(/window\.confirm\(\s*(?:`([^`]*)`|"([^"]*)")/g)) {
        const t = m[1] ?? m[2];
        expect([f, t.slice(0, 80), containsOwnerJargon(plain(t))]).toEqual([f, t.slice(0, 80), false]);
      }
    }
  });
  it("every reviewer-only exemption is still a live string (a stale one is a licence lying open)", () => {
    const app = strip(fs.readFileSync("src/App.jsx", "utf8"));
    for (const t of Object.keys(REVIEWER_ONLY)) expect(app, t).toContain(t);
  });
  it("the rewritten sentences are the ones on screen", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    for (const s of ["Recorded as money received in advance ✓", "Recorded — its cost will be spread over time ✓", "Cost spread set up ✓", "Agreement read —", "to your categories — you didn't have one"]) expect(app).toContain(s);
    for (const s of ["deferred revenue (advance payment)", "Depreciation attached", "upload in the intake ledger", "Contract analyzed —", "Journal entry not found."]) expect(app).not.toContain(s);
    // C423 — "A/R" and "A/P" were not in the bar; three toasts and a button said "A/R booked"
    const siv = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    expect(siv).not.toMatch(/A\/R booked|Collect A\/R/);
    expect(siv).toContain("recorded as money owed to you ✓");
  });
});
