import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { scrubOwnerActivity, ownerActivityText } from "../src/lib/activityFeed.js";

// ═════════════════════════════════════════════════════════════════════════════
// C408 — THE AUDIT TRAIL IS A CLIENT SETTINGS SCREEN, SO ITS SENTENCES ARE OWNER-FACING.
//
// `activityFeed.js` records that the audit log "is written for the CPA and carries
// bookkeeping notation on purpose" — and `AuditView` sits in `SETTINGS_VIEW_IDS`, which is
// inside the client seat, rendering `entry.detail` raw. So an owner opening Settings →
// Audit trail read "Sysco · $824.60 → Food Cost (92% confidence · 2026-08-06)", "(GAAP
// capitalize)", "recorded as prepaid (1300), amortizing over 12 months", "Created account
// 6520 … on the fly — it was not in this company's chart". C386 held the screen's chrome
// to the bar with fixture rows; the rows the product actually writes were never read.
//
// The rule: every `logAudit`/`logAI` detail literal in `src/` passes `containsOwnerJargon`
// (placeholders substituted), with the technical fields carried in `after_state` instead.
// Rows that describe a REVIEWER-WORKBENCH MECHANISM (a reconciliation persisting, a
// depreciation stamp, a payroll register's shape check) are excused BY ACTION NAME with
// the reason, and a stale excuse — an action no longer written — fails.
// ═════════════════════════════════════════════════════════════════════════════
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
const plain = (t) => t.replace(/\$\{[^}]*\}/g, "X");
const RE = /log(?:Audit|AI)\(\s*(?:"([a-z_]+)"|[^,]+),\s*(?:`([^`]*)`|"([^"]*)"|'([^']*)')/g;

// Reviewer-workbench mechanism rows. Each names the surface whose machinery it records;
// the owner's Home says the same fact in its own words (C387: "matched to your bank").
const REVIEWER_MECHANISM = {
  bank_account_created: "Bank Import inline account creation (reviewer workbench)",
  ai_account_invention_refused: "the model produced a chart number and the refusal must quote it (C260)",
  depreciation_stamp_failed: "the cost-spread poster's idempotency stamp (·3c mechanism)",
  depreciation_flag_write_failed: "the cost-spread schedule flag (·3c mechanism)",
  depreciation_incomplete: "the auto-poster declining an ambiguous schedule row (reviewer decides)",
  reconciliation_save_failed: "Reconcile session persistence (reviewer workbench)",
  reconciliation_completed: "Reconcile / pipeline completion record (reviewer workbench)",
  reconciliation_complete_failed: "Reconcile completion gate (C194)",
  reconciliation_superseded_open: "Reconcile housekeeping of stale sessions",
  statement_retired_by_reconciliation: "statement exception retirement (reviewer workbench)",
  opening_discrepancy_settled: "the starting-balance note settled by a reconciliation (C259)",
  payroll_posted: "the payroll register's Dr/Cr shape, kept verbatim for the CPA (·3a gate)",
};

const census = () => {
  const rows = [];
  for (const f of walk("src")) {
    const src = strip(fs.readFileSync(f, "utf8"));
    for (const m of src.matchAll(RE)) rows.push({ file: f, action: m[1] || null, text: m[2] ?? m[3] ?? m[4] });
  }
  return rows;
};

describe("★★ every audit sentence an owner can read on the Audit trail passes the owner bar", () => {
  it("no jargon outside the named reviewer-mechanism rows", () => {
    const rows = census();
    expect(rows.length).toBeGreaterThan(100);   // anti-vacuity: the census reads the writers
    const bad = rows.filter((r) => !REVIEWER_MECHANISM[r.action] && containsOwnerJargon(plain(r.text)))
      .map((r) => `${r.file} [${r.action}]: ${r.text.slice(0, 120)}`);
    expect(bad).toEqual([]);
  });
  it("every excused action is still written somewhere (a stale excuse is a licence lying open)", () => {
    const actions = new Set(census().map((r) => r.action));
    for (const a of Object.keys(REVIEWER_MECHANISM)) expect(actions.has(a), a).toBe(true);
  });
  it("the rewritten sentences are the ones written, with the technical field moved to meta", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    // confidence: out of the sentence, into `after_state`
    expect(app).toMatch(/→ \$\{inv\.gl_name\} \(\$\{inv\.date\}\)`, null, \{[^}]*confidence: inv\.confidence \}/);
    expect(app).not.toMatch(/% confidence · \$\{inv\.date\}/);
    // the GAAP answer type: words on the row, the type verbatim in meta
    expect(app).toMatch(/\(\$\{GAAP_TYPE_PLAIN\[item\.gaapType\] \|\| "recorded"\}\)`, null, \{[^}]*gaap_type: item\.gaapType/);
    expect(app).not.toMatch(/\(GAAP \$\{item\.gaapType\}\)/);
    // a materialised account is named, and its code stays in meta for the O108 detector
    expect(app).not.toMatch(/`Created account \$\{/);
    for (const m of app.matchAll(/logAudit\("account_materialized", `[^`]*`, null, \{([^}]*)\}/g)) expect(m[1]).toMatch(/\bcode\b/);
  });
  it("the owner's Audit trail scrubs the trailing notation older rows carry; the reviewer's seat keeps it raw", () => {
    const v = fs.readFileSync("src/components/views/AuditView.jsx", "utf8");
    expect(v).toMatch(/const detailFor = \(entry\) => navSeat\?\.isReviewerSeat \? entry\.detail : scrubOwnerActivity\(entry\.detail\);/);
    expect(v).toMatch(/\{detailFor\(entry\)\}/);
    expect(v).not.toMatch(/\{entry\.detail\}/);
    expect(scrubOwnerActivity("paid Franklin Ave Properties LP · $2,400.00 via ACH · GL Dr AP/Cr Cash posted")).toBe("paid Franklin Ave Properties LP · $2,400.00 via ACH");
  });
  it("the Home feed lines the writers now produce read clean through the feed's own scrub", () => {
    const lines = [
      { action: "invoice_paid", detail: "owner paid Franklin Ave Properties LP · $2,400.00 via ACH / Bank Transfer" },
      { action: "invoice_booked", detail: "Sysco · $824.60 → Food Cost (2026-08-06)" },
      { action: "invoice_booked", detail: "Sabine Kitchen Equipment · $4,625.00 → Fixed Assets (equipment — cost spread over time)" },
      { action: "recode", detail: "Recoded Sysco → Kitchen Supplies" },
    ];
    for (const l of lines) { const t = ownerActivityText(l); expect(t, l.detail).toBeTruthy(); expect(containsOwnerJargon(t), t).toBe(false); }
  });
});
