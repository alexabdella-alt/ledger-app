import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  reconcileAnomalies, IMPERATIVE_ANOMALY_TYPES,
  openingDiscrepancyAnomaly, openingNotesSettledBy,
} from "../src/lib/anomalies";

// ═════════════════════════════════════════════════════════════════════════════
// THE OPENING-BALANCE DISCREPANCY BECOMES A DURABLE NOTE.
//
// It lived in React state alone, so a reload or a navigation lost it — the O97 in-memory
// class, on a finding that says the client's STARTING POSITION may be wrong.
//
// ★★★ AND THE REASON IT WAS DEFERRED IS REAL, NOT A SCHEDULING EXCUSE: `reconcileAnomalies`
// AUTO-RESOLVES ANY OPEN ROW THE DETECTOR DID NOT JUST EMIT. That is correct for everything
// the pure detector owns — the condition left the ledger, so the note should go — and FATAL
// for this one, which needs the STATEMENT's stated opening, a number that is not in the
// ledger and can never be re-detected by re-running over it. Inserted without the exemption
// below, the note would appear and be resolved a second later, forever: **a feature that
// flickers is indistinguishable from one that was never built.**
// ═════════════════════════════════════════════════════════════════════════════

describe("★★★ a note nobody detects must survive the scan", () => {
  const detectorRow = { id: 1, fingerprint: "dup:a", status: "open", type: "duplicate_payment" };
  const imperativeRow = { id: 2, fingerprint: "opening:1000:2026-03-01", status: "open", type: "opening_discrepancy" };

  it("★★★ the detector's own note still auto-resolves when its condition goes", () => {
    // The exemption must be NARROW: if it swallowed everything, notes would pile up forever
    // and the queue would stop meaning anything.
    const r = reconcileAnomalies({ detected: [], rows: [detectorRow] });
    expect(r.toResolve.map((x) => x.type)).toEqual(["duplicate_payment"]);
  });

  it("★★★ and the imperative one does NOT", () => {
    const r = reconcileAnomalies({ detected: [], rows: [detectorRow, imperativeRow] });
    expect(r.toResolve.map((x) => x.type)).toEqual(["duplicate_payment"]);
  });

  it("★ the exempt set is small and every member owes its own way out", () => {
    // Adding a type here without a resolve condition turns "it vanishes on reload" into "it
    // can never be cleared" — the opposite failure, and just as bad.
    expect([...IMPERATIVE_ANOMALY_TYPES]).toEqual(["opening_discrepancy"]);
  });
});

describe("★★ the note itself", () => {
  const note = openingDiscrepancyAnomaly({
    companyId: "c1", accountCode: "1000", accountName: "Checking",
    periodStart: "2026-03-01", stated: 5000, recorded: 4725, diff: 275,
  });

  it("★★ is keyed on the ACCOUNT and PERIOD, never the amount", () => {
    // Re-uploading the same statement must not stack notes — and the difference CHANGING is
    // not a new problem, it is the same problem still there.
    expect(note.fingerprint).toBe("opening:1000:2026-03-01");
    const other = openingDiscrepancyAnomaly({ companyId: "c1", accountCode: "1000", accountName: "Checking", periodStart: "2026-03-01", stated: 5000, recorded: 4000, diff: 1000 });
    expect(other.fingerprint).toBe(note.fingerprint);
  });

  it("★★★ is MEDIUM, not high — and that is a decision, not a default", () => {
    // HIGH blocks sign-off. C179 established that a difference the outstanding-items chain
    // fully explains is not an alarm: frightening a client over a $275 uncleared cheque is
    // the exact false alarm this product keeps removing. Worth attention, not a block.
    expect(note.severity).toBe("medium");
  });

  it("★ says what it could be, in plain language, without asserting which", () => {
    expect(note.detail).toMatch(/uncleared item, or a starting balance that needs correcting/);
    expect(note.detail).toContain("$275.00");
    expect(note.detail).not.toMatch(/GL|debit|credit|journal/i);
  });

  it("refuses to build without the things that key it", () => {
    expect(openingDiscrepancyAnomaly({ companyId: "c1", accountCode: "1000" })).toBeNull();
    expect(openingDiscrepancyAnomaly({ accountCode: "1000", periodStart: "2026-03-01" })).toBeNull();
  });
});

describe("★★ what settles it", () => {
  const rows = [
    { id: "a", status: "open", type: "opening_discrepancy", fingerprint: "opening:1000:2026-03-01" },
    { id: "b", status: "open", type: "opening_discrepancy", fingerprint: "opening:1000:2026-09-01" },
    { id: "c", status: "open", type: "opening_discrepancy", fingerprint: "opening:2000:2026-03-01" },
    { id: "d", status: "dismissed", type: "opening_discrepancy", fingerprint: "opening:1000:2026-01-01" },
  ];

  it("★★★ a LATER period's note is not settled by an earlier reconciliation", () => {
    // That would clear a note nobody has looked at, on a question this reconciliation did
    // not answer.
    const settled = openingNotesSettledBy({ rows, accountCode: "1000", throughDate: "2026-03-31" });
    expect(settled.map((r) => r.id)).toEqual(["a"]);
  });

  it("★ another account's note is untouched", () => {
    expect(openingNotesSettledBy({ rows, accountCode: "1000", throughDate: "2026-12-31" }).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("★ and an already-dismissed note is not re-resolved", () => {
    expect(openingNotesSettledBy({ rows, accountCode: "1000", throughDate: "2026-12-31" }).map((r) => r.id)).not.toContain("d");
  });

  it("without an account or a date it settles nothing", () => {
    expect(openingNotesSettledBy({ rows, accountCode: "1000" })).toEqual([]);
    expect(openingNotesSettledBy({ rows, throughDate: "2026-12-31" })).toEqual([]);
  });
});

describe("★★ it is inserted and settled where it should be", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");

  it("★★ inserted at detection, deduped on the open-fingerprint index", () => {
    expect(app).toMatch(/openingDiscrepancyAnomaly\(\{/);
    expect(app).toMatch(/onConflict: "company_id,fingerprint", ignoreDuplicates: true/);
  });

  it("★★★ and settled when a reconciliation completes — it owes its own way out", () => {
    expect(app).toMatch(/openingNotesSettledBy\(\{ rows: anomalyRowsRef\.current/);
    const settle = app.slice(app.indexOf("openingNotesSettledBy({ rows"), app.indexOf("openingNotesSettledBy({ rows") + 900);
    expect(settle).toMatch(/status: "resolved"/);
    expect(settle).toMatch(/\.select\("id"\)/);           // checked, like every other write
    expect(settle).toMatch(/opening_discrepancy_settled/); // and audited
  });
});
