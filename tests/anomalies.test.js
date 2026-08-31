import { describe, it, expect } from "vitest";
import { runAnomalyDetection } from "../src/lib/insights.js";
import {
  reconcileAnomalies, anomalyTouchesPeriod, anomalySubjectPeriod, openHighAnomaliesInPeriod, anomalyInsertRow, isHighAnomaly,
} from "../src/lib/anomalies.js";

// ════════════════════════════════════════════════════════════════════════════
// O83 — anomalies become persisted, deduped, auto-resolving records.
// The FIXTURE is the exact O83 scenario: a duplicate payment fires, persists as one
// row (fingerprint-stable across re-detection), and AUTO-RESOLVES the moment the
// duplicate is cleaned up — clearing is an event, not amnesia.
// ════════════════════════════════════════════════════════════════════════════

// ★★ LOCAL COMPONENTS, NOT A UTC INSTANT. `new Date("2026-01-31T12:00:00Z")` is noon UTC —
// which is already 1am on 1 FEBRUARY in Auckland, so `thisMonth` (deliberately local, to match
// how entry dates are stored) became "2026-02" and the January spike was never found. The
// PRODUCT is right; this fixture was pinning a UTC instant while asserting a local-month
// outcome, so the test passed or failed depending on where it ran.
const NOW = new Date(2026, 0, 31, 12, 0, 0);
// Two identical charges to the same vendor within a week → duplicate_payment (HIGH).
const dupLedger = [
  { id: "je1", vendor: "Sysco", amount: 1200, date: "2026-01-10", gl_code: "5000", gl_name: "COGS" },
  { id: "je2", vendor: "Sysco", amount: 1200, date: "2026-01-12", gl_code: "5000", gl_name: "COGS" },
];

describe("fingerprint stability — same condition re-detected yields ONE row", () => {
  it("duplicate detection carries a stable fingerprint across runs", () => {
    const a = runAnomalyDetection(dupLedger, [], NOW);
    const b = runAnomalyDetection(dupLedger, [], new Date("2026-02-15T09:00:00Z")); // later scan, same ledger
    const dupA = a.find((x) => x.type === "duplicate_payment");
    const dupB = b.find((x) => x.type === "duplicate_payment");
    expect(dupA).toBeTruthy();
    expect(dupA.severity).toBe("high");
    expect(dupA.fingerprint).toBe(dupB.fingerprint);        // stable across time
    // C198·3b (f3) — keyed on CONTENT (vendor · amount in cents · the two dates, sorted
    // so the pair stays symmetric), not on the two row ids. The old id-keyed recipe is
    // exactly what let a statement re-upload open a second card for the same charge.
    expect(dupA.fingerprint).toBe("dup:sysco:120000:2026-01-10+2026-01-12");
  });

  it("and survives the ledger renumbering the rows underneath it", () => {
    const renumbered = dupLedger.map((r, i) => ({ ...r, id: `other_${i}`, db_entry_id: `other_${i}` }));
    const before = runAnomalyDetection(dupLedger, [], NOW).find((x) => x.type === "duplicate_payment");
    const after = runAnomalyDetection(renumbered, [], NOW).find((x) => x.type === "duplicate_payment");
    expect(after.fingerprint).toBe(before.fingerprint);
  });

  it("re-detecting an already-open row is a no-op INSERT (toTouch, not toInsert)", () => {
    const detected = runAnomalyDetection(dupLedger, [], NOW);
    const rows = detected.map((d) => ({ ...anomalyInsertRow("co1", d), status: "open" }));
    const { toInsert, toResolve, toTouch } = reconcileAnomalies({ detected, rows });
    expect(toInsert).toHaveLength(0);
    expect(toResolve).toHaveLength(0);
    expect(toTouch.length).toBe(detected.length);
  });

  it("category_spike fingerprint keys on GL CODE (rename-stable), not the name", () => {
    const ledger = [
      { id: "a", vendor: "V", amount: 100, date: "2025-11-05", gl_code: "6200", gl_name: "Utilities" },
      { id: "b", vendor: "V", amount: 100, date: "2025-12-05", gl_code: "6200", gl_name: "Utilities" },
      { id: "c", vendor: "V", amount: 900, date: "2026-01-05", gl_code: "6200", gl_name: "Power & Water" }, // renamed
    ];
    const found = runAnomalyDetection(ledger, [], NOW).find((x) => x.type === "category_spike");
    expect(found).toBeTruthy();
    expect(found.fingerprint).toBe("category_spike:6200:2026-01");   // code, not "Utilities"/"Power & Water"
  });
});

describe("auto-resolve on condition disappearance — the O83 duplicate-cleanup fixture", () => {
  it("a persisted open row auto-resolves when the duplicate is deleted", () => {
    const detected0 = runAnomalyDetection(dupLedger, [], NOW);
    // C198·3b (f3) — the fingerprint is now keyed on CONTENT (vendor + amount + the two
    // dates), not on the pair of row ids, so a re-run over the same statement can't mint
    // a second card for the same fact. Derive it rather than hardcode the recipe.
    const DUP_FP = detected0.find((d) => d.type === "duplicate_payment").fingerprint;
    const openRow = { ...anomalyInsertRow("co1", detected0.find((d) => d.type === "duplicate_payment")), status: "open", fingerprint: DUP_FP };

    // Remediation: the duplicate je2 is soft-deleted → next scan detects NOTHING.
    const detected1 = runAnomalyDetection([dupLedger[0]], [], new Date("2026-02-01T12:00:00Z"));
    expect(detected1.find((d) => d.type === "duplicate_payment")).toBeFalsy();

    const { toInsert, toResolve, toTouch } = reconcileAnomalies({ detected: detected1, rows: [openRow] });
    expect(toInsert).toHaveLength(0);
    expect(toTouch).toHaveLength(0);
    expect(toResolve).toHaveLength(1);
    expect(toResolve[0].fingerprint).toBe(DUP_FP);   // survives as history, now resolved
  });
});

describe("durable dismissal — a dismissed fingerprint is NOT re-inserted", () => {
  const dupFingerprint = () =>
    runAnomalyDetection(dupLedger, [], NOW).find((d) => d.type === "duplicate_payment").fingerprint;

  it("dismissed row suppresses re-creation across sessions/devices", () => {
    const detected = runAnomalyDetection(dupLedger, [], NOW);
    const fp = dupFingerprint();
    const dismissed = { fingerprint: fp, status: "dismissed", dismissed_reason: "known vendor deposit, not a dup" };
    const { toInsert } = reconcileAnomalies({ detected, rows: [dismissed] });
    expect(toInsert.find((d) => d.fingerprint === fp)).toBeFalsy();
  });
  it("a RESOLVED fingerprint does NOT suppress — a genuine recurrence re-opens", () => {
    const detected = runAnomalyDetection(dupLedger, [], NOW);
    const fp = dupFingerprint();
    const resolved = { fingerprint: fp, status: "resolved", resolution: "auto" };
    const { toInsert } = reconcileAnomalies({ detected, rows: [resolved] });
    expect(toInsert.find((d) => d.fingerprint === fp)).toBeTruthy();
  });
});

describe("period-scoped HIGH counting for the sign-off gate", () => {
  const invoices = [
    { id: "je1", date: "2026-01-10" },
    { id: "je2", date: "2026-01-12" },
    { id: "feb1", date: "2026-02-03" },
  ];
  const highJan = { status: "open", severity: "high", fingerprint: "dup:je1-je2", entity_refs: ["je1", "je2"] };
  const medJan = { status: "open", severity: "medium", fingerprint: "large_txn:je1", entity_refs: ["je1"] };
  const highFeb = { status: "open", severity: "high", fingerprint: "vendor_spike:v:feb1", entity_refs: ["feb1"] };

  it("counts an open HIGH anomaly touching the period", () => {
    expect(openHighAnomaliesInPeriod([highJan], "2026-01", invoices)).toBe(1);
  });
  it("does NOT count it for a different period", () => {
    expect(openHighAnomaliesInPeriod([highJan], "2026-02", invoices)).toBe(0);
    expect(openHighAnomaliesInPeriod([highFeb], "2026-01", invoices)).toBe(0);
  });
  it("medium/low never counts even when in-period", () => {
    expect(openHighAnomaliesInPeriod([medJan], "2026-01", invoices)).toBe(0);
  });
  it("aggregate anomaly (no refs) period-matches on the fingerprint month tail", () => {
    const catJan = { status: "open", severity: "high", fingerprint: "category_spike:6200:2026-01", entity_refs: [] };
    expect(anomalyTouchesPeriod(catJan, "2026-01", invoices)).toBe(true);
    expect(anomalyTouchesPeriod(catJan, "2026-02", invoices)).toBe(false);
  });
  it("isHighAnomaly guards severity", () => {
    expect(isHighAnomaly(highJan)).toBe(true);
    expect(isHighAnomaly(medJan)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C198·3c (D1) — THE HIGH BLOCKER MUST NOT UNDER-COUNT WHEN REFS GO DEAD.
//
// (v) fixed anomalySubjectPeriod — the sweep that RETIRES notes — and left
// anomalyTouchesPeriod, the one that BLOCKS sign-off, reading the old way. Same root
// cause, opposite consequence: a duplicate_payment is emitted at severity HIGH with an
// f3 date-pair fingerprint, so a persisted row whose entity_refs stopped resolving
// after a reload vanished from the blocker entirely. The sweep failing is a note left
// open; the blocker failing is a month signed off over an unresolved HIGH.
// ─────────────────────────────────────────────────────────────────────────────
describe("(D1) refs that no longer resolve still block the sign-off", () => {
  // THE EXACT LIVE SHAPE: persisted rows, refs pointing at ledger ids that are gone,
  // f3 date-pair content key. Same trio as the (v) tests, at their real severity.
  const DEAD_REFS = { status: "open", severity: "high", entity_refs: ["gone-1", "gone-2"],
                      fingerprint: "dup:bluebonnet:14500:2026-07-08+2026-07-10" };
  const RELOADED = [{ id: "other", date: "2026-07-02" }];   // resolves none of the refs

  it("★ openHighAnomaliesInPeriod counts it for July — it used to count zero", () => {
    expect(openHighAnomaliesInPeriod([DEAD_REFS], "2026-07", RELOADED)).toBe(1);
  });

  it("and still does not count it for a month it doesn't touch", () => {
    expect(openHighAnomaliesInPeriod([DEAD_REFS], "2026-06", RELOADED)).toBe(0);
    expect(openHighAnomaliesInPeriod([DEAD_REFS], "2026-08", RELOADED)).toBe(0);
  });

  it("TOUCHES is a set membership, not a single month — a straddle blocks BOTH", () => {
    // The difference from anomalySubjectPeriod, which reports the LATEST month only.
    const straddle = { ...DEAD_REFS, fingerprint: "dup:sysco:120000:2026-07-30+2026-08-02" };
    expect(anomalyTouchesPeriod(straddle, "2026-07", [])).toBe(true);
    expect(anomalyTouchesPeriod(straddle, "2026-08", [])).toBe(true);
    expect(anomalySubjectPeriod(straddle, [])).toBe("2026-08");
    expect(anomalyTouchesPeriod(straddle, "2026-09", [])).toBe(false);
  });

  it("REFS STILL WIN when they resolve — a live ledger is never overridden by a key", () => {
    const live = [{ id: "gone-1", date: "2026-08-04" }, { id: "gone-2", date: "2026-08-06" }];
    expect(openHighAnomaliesInPeriod([DEAD_REFS], "2026-08", live)).toBe(1);
    expect(openHighAnomaliesInPeriod([DEAD_REFS], "2026-07", live)).toBe(0);   // the key says July; the ledger says August
  });

  it("PARTIALLY dead refs count as resolved — the surviving entries are the record", () => {
    const half = [{ id: "gone-1", date: "2026-08-04" }];
    expect(anomalyTouchesPeriod(DEAD_REFS, "2026-08", half)).toBe(true);
    expect(anomalyTouchesPeriod(DEAD_REFS, "2026-07", half)).toBe(false);
  });

  it("`rapid:` IS read here though anomalySubjectPeriod refuses it — the asymmetry is deliberate", () => {
    // Retiring on an under-inclusive month closes a note early (unsafe); blocking on one
    // blocks a month that genuinely contains the window's first charge (safe).
    const rapid = { ...DEAD_REFS, fingerprint: "rapid:sysco:2026-07-31:3" };
    expect(anomalyTouchesPeriod(rapid, "2026-07", [])).toBe(true);
    expect(openHighAnomaliesInPeriod([rapid], "2026-07", [])).toBe(1);
    expect(anomalySubjectPeriod(rapid, [])).toBe(null);
  });

  it("unplaceable is still unplaceable — no fingerprint, no dates, no block", () => {
    for (const fp of ["missing_recurring:bluebonnet", "fp-a", ""]) {
      expect(anomalyTouchesPeriod({ ...DEAD_REFS, fingerprint: fp }, "2026-07", []), fp).toBe(false);
    }
    expect(anomalyTouchesPeriod(null, "2026-07", [])).toBe(false);
    expect(anomalyTouchesPeriod(DEAD_REFS, null, [])).toBe(false);
  });

  it("a CLOSED row never blocks, however well it is placed", () => {
    for (const status of ["dismissed", "resolved"]) {
      expect(openHighAnomaliesInPeriod([{ ...DEAD_REFS, status }], "2026-07", RELOADED)).toBe(0);
    }
  });

  it("ONE PARSER, TWO CONSUMERS — the two functions agree on every real f3 key", () => {
    // The (v) bug was a producer and a consumer disagreeing about a fingerprint format.
    // Two independent parsers of the same key is that trap with the sides swapped, so
    // this pins that a month anomalySubjectPeriod names is always a month TOUCHES agrees
    // with. (rapid: is the documented exception — subject declines to name one at all.)
    const keys = [
      "dup:bluebonnet:14500:2026-07-08+2026-07-10",
      "dup:sysco:120000:2026-07-30+2026-08-02",
      "vendor_spike:sysco:2026-07-15:400000",
      "large_txn:equipment co:2026-07-15:250000",
      "round:office supply:2026-07-15:100000",
      "category_spike:6200:2026-07",
    ];
    for (const fingerprint of keys) {
      const a = { status: "open", severity: "high", entity_refs: ["gone"], fingerprint };
      const subject = anomalySubjectPeriod(a, []);
      expect(subject, fingerprint).not.toBe(null);
      expect(anomalyTouchesPeriod(a, subject, []), fingerprint).toBe(true);
    }
  });
});
