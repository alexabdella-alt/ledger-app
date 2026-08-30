import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ownerActivityText, scrubOwnerActivity } from "../src/lib/activityFeed.js";
import { planBulkRemoval } from "../src/lib/signedPeriod.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// TWO LAUNCH-WEEK ITEMS THAT SHARE A ROOT: A SURFACE BUILT FOR ONE AUDIENCE, SHOWN TO
// ANOTHER — and a batch capability built and wired to nothing.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★ the owner's activity feed is not the audit log", () => {
  it("THE LIVE LINE: the GL notation is gone and the sentence survives", () => {
    // Home rendered `audit_log.detail` VERBATIM. That log is written for the CPA and
    // carries bookkeeping notation on purpose.
    const row = { action: "invoice_paid", detail: "Alex paid Franklin Ave Properties LP · $2400.00 via ACH · GL Dr AP/Cr Cash posted" };
    const text = ownerActivityText(row);
    expect(text).toBe("Alex paid Franklin Ave Properties LP · $2400.00 via ACH");
    // ★ ASSERTED SPECIFICALLY, NOT VIA `containsOwnerJargon` — AND THE REASON IS A REAL
    // LIMIT OF THAT LINT. It flags a bare four-digit number as a possible GL code, so
    // `$2400.00` trips it. **The jargon lint cannot be applied to any line containing a
    // money amount**, which is most activity lines. Worth knowing before someone wires it
    // to a feed and starts "fixing" perfectly good sentences.
    for (const w of ["GL ", "Dr ", "Cr ", "posted"]) expect(text).not.toContain(w);
  });

  it("the AR twin too", () => {
    expect(scrubOwnerActivity("Alex collected from Toast · $1200.00 via ACH · GL Dr Cash/Cr AR posted"))
      .toBe("Alex collected from Toast · $1200.00 via ACH");
  });

  it("★ strips a technical TAIL, never a word out of the middle", () => {
    // A vendor called "Credit Union Services" must survive intact — the rule is anchored
    // to a trailing clause for exactly this reason.
    const keep = "Alex paid Credit Union Services · $80.00 via ACH";
    expect(scrubOwnerActivity(keep)).toBe(keep);
  });

  it("★★ rows that are MACHINERY are dropped, not half-scrubbed", () => {
    // A barely-readable line about a control total is worse than no line at all.
    for (const action of ["security_check", "coa_template_applied", "payment_link_write_failed", "intake_duplicate_auto_resolved"]) {
      expect(ownerActivityText({ action, detail: "…" }), action).toBe(null);
    }
  });

  it("an action with no detail is humanised, not printed as an identifier", () => {
    expect(ownerActivityText({ action: "invoice_collected" })).toBe("Invoice collected");
    expect(ownerActivityText({})).toBe(null);
  });

  it("★ the WRITER stopped putting notation in the human sentence too", () => {
    // Both ends: fixing only the feed would leave the audit detail carrying jargon for the
    // next surface that renders it; fixing only the writer would leave the class open.
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    const code = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).toMatch(/gl_posted: glPosted/);           // structured, in after_state
    expect(code).not.toMatch(/\$\{glStr\}/);               // not in the sentence
  });
});

describe("★★ bulk removal respects the sign-off boundary", () => {
  const signoffs = [{ period: "2026-08", revoked_at: null }];
  const label = (p) => ({ "2026-08": "August 2026" }[p] || p);
  const open1 = { id: "a", date: "2026-09-02", vendor: "Roma" };
  const open2 = { id: "b", date: "2026-09-05", vendor: "Toast" };
  const sealed = { id: "c", date: "2026-08-06", vendor: "Hill Country" };

  it("removes the ones it can, in one batch", () => {
    const plan = planBulkRemoval([open1, open2], signoffs, { monthLabel: label });
    expect(plan.removable).toHaveLength(2);
    expect(plan.blocked).toBe(null);
    expect(plan.confirm).toMatch(/Remove 2 entries/);
    expect(plan.confirm).toMatch(/undo/i);
  });

  it("★★ a SIGNED month is not silently corrected in bulk — it is named and left", () => {
    // O130 settled the single-entry rule; a batch can straddle the boundary. Posting
    // several dated corrections without the person seeing each one is the invisible-action
    // class (§9), so those go back to the single-entry path that shows the confirmation.
    const plan = planBulkRemoval([open1, sealed, open2], signoffs, { monthLabel: label });
    expect(plan.removable.map(e => e.id)).toEqual(["a", "b"]);
    expect(plan.signed).toHaveLength(1);
    expect(plan.blocked).toMatch(/August 2026/);
    expect(plan.blocked).toMatch(/individually/);
  });

  it("★ says what will be LEFT BEHIND before anything happens, not after", () => {
    const plan = planBulkRemoval([open1, sealed], signoffs, { monthLabel: label });
    expect(plan.confirm).toBeTruthy();
    expect(plan.blocked).toBeTruthy();
    // No accounting vocabulary in either sentence.
    for (const str of [plan.confirm, plan.blocked]) {
      for (const w of ["void", "reversal", "journal", "debit", "credit", "ledger"]) {
        expect(str.toLowerCase()).not.toContain(w);
      }
    }
  });

  it("an all-signed selection removes nothing and says so", () => {
    const plan = planBulkRemoval([sealed], signoffs, { monthLabel: label });
    expect(plan.removable).toHaveLength(0);
    expect(plan.confirm).toBe(null);
    expect(plan.blocked).toBeTruthy();
  });

  it("★ the batch path is actually WIRED now — that was the whole defect", () => {
    // `softDeleteInvoices` existed with batch write and a single Undo toast and was wired
    // to NO component. Remediating the O83 double-book took scripted database access to
    // remove 14 entries because of it.
    const books = fs.readFileSync(path.join(process.cwd(), "src/components/views/BooksView.jsx"), "utf8");
    expect(books).toMatch(/softDeleteInvoices/);
    expect(books).toMatch(/planBulkRemoval/);
    expect(books).toMatch(/type="checkbox"/);
    expect(books).toMatch(/Select all shown/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE REVIEW CARD'S EVIDENCE, and the trust panel's queue glyph.
// ═════════════════════════════════════════════════════════════════════════════
import { anomalyEvidence } from "../src/lib/anomalies.js";

describe("★★ the reviewer can see what they're being asked to judge", () => {
  const entries = [
    { id: "1", db_entry_id: "e1", date: "2026-08-04", vendor: "Roma Cheese", amount: 551.2 },
    { id: "2", db_entry_id: "e2", date: "2026-08-06", vendor: "Roma Cheese", amount: 551.2 },
    { id: "3", db_entry_id: "e3", date: "2026-08-09", vendor: "Toast", amount: 120 },
  ];

  it("THE ASYMMETRY THIS CLOSES: the pair behind a duplicate flag, resolved", () => {
    // Dismissing JUDGES a condition acceptable — a review act, permanently reviewer-only.
    // The screen offered that judgement with no sight of the transactions, while the
    // OWNER's panel linked to them. The person making the call had the least context.
    const ev = anomalyEvidence({ entity_refs: ["e1", "e2"] }, entries);
    expect(ev.entries.map(e => e.id)).toEqual(["1", "2"]);
    expect(ev.missing).toBe(0);
    expect(ev.total).toBe(2);
  });

  it("resolves a freshly-detected anomaly's ids too, not just a persisted row's", () => {
    expect(anomalyEvidence({ invoice_ids: ["1", "3"] }, entries).entries).toHaveLength(2);
  });

  it("★★ a ref that no longer resolves is COUNTED, not silently dropped", () => {
    // O87 finding (v) was exactly this: detection-time ids stopped resolving after a
    // reload, and code that skipped them made three cards unplaceable with no sign
    // anything was missing. "2 linked entries, 1 we can't find" is honest; quietly
    // showing one is not.
    const ev = anomalyEvidence({ entity_refs: ["e1", "gone"] }, entries);
    expect(ev.entries).toHaveLength(1);
    expect(ev.missing).toBe(1);
    expect(ev.total).toBe(2);
  });

  it("one entry referenced twice is shown once", () => {
    expect(anomalyEvidence({ entity_refs: ["1", "e1"] }, entries).entries).toHaveLength(1);
  });

  it("sorted oldest first — a duplicate judgment is about the gap between them", () => {
    const ev = anomalyEvidence({ entity_refs: ["e2", "e1"] }, entries);
    expect(ev.entries.map(e => e.date)).toEqual(["2026-08-04", "2026-08-06"]);
  });

  it("an anomaly with no refs asks for nothing", () => {
    expect(anomalyEvidence({}, entries)).toMatchObject({ entries: [], missing: 0, total: 0 });
  });

  it("★ and the card actually renders them", () => {
    const review = fs.readFileSync(path.join(process.cwd(), "src/components/views/ReviewView.jsx"), "utf8");
    expect(review).toMatch(/anomalyEvidence\(a, invoices\)/);
    expect(review).toMatch(/can no longer be found/);
  });
});

describe("★ the trust panel's Documents row is a QUEUE, not an unearned tick", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/views/TrustPanel.jsx"), "utf8");

  it("queue rows get their own glyph", () => {
    // The semantics were already right — an empty queue must NOT get a celebratory ✓,
    // which would be the vacuous pass this panel exists to refuse. The PICTURE was wrong:
    // a hollow grey dot among green ticks reads as "pending".
    expect(panel).toMatch(/kind = "state"/);
    expect(panel).toMatch(/kind === "queue"/);
    expect(panel).toMatch(/<Line kind="queue"[^>]*title="Documents"/);
  });

  it("★ the EARNED rows are untouched — green only when verified", () => {
    expect(panel).toMatch(/<Line state=\{lines\.reviewed\.state\} title="Reviewed"/);
    expect(panel).toMatch(/<Line state=\{lines\.correct\.state\} title="Nothing wrong"/);
  });
});
