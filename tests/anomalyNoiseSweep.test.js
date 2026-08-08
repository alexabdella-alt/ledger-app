import { describe, it, expect } from "vitest";
import {
  reconcileAnomalies, anomaliesExpiredBySignoff, anomaliesReopenedByRevoke,
  anomalySubjectPeriod, priorDismissalFor, ANOMALY_RESOLUTION, ATTESTED_NOTE,
} from "../src/lib/anomalies.js";
import { runAnomalyDetection, booksFrontier } from "../src/lib/insights.js";
import { ownerAnomalyLine } from "../src/lib/ownerTrust.js";
import { businessHealth } from "../src/lib/reports.js";
import { bankImportToastCopy } from "../src/lib/workbench.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ─────────────────────────────────────────────────────────────────────────────
// C198·3b — the noise sweep. Every case below is a live O86 repro.
// ─────────────────────────────────────────────────────────────────────────────

const exp = (over) => ({ id: "x", vendor: "Vendor", amount: 100, date: "2026-06-01", gl_code: "6500", status: "booked", ...over });

// ── (f2) STALENESS READS THE BOOKS' CLOCK ────────────────────────────────────
describe("(f2) staleness is measured against the books' frontier, never wall-clock", () => {
  // Live O86: "Lone Star hasn't charged you in 59 days" rendered fifty pixels from
  // that vendor's June 8 charge, because the books ran to June and the clock didn't.
  const monthlyVendor = [
    exp({ id: "a", vendor: "Lone Star", amount: 240, date: "2026-04-08" }),
    exp({ id: "b", vendor: "Lone Star", amount: 240, date: "2026-05-08" }),
    exp({ id: "c", vendor: "Lone Star", amount: 240, date: "2026-06-08" }),
  ];
  const stale = (out) => out.filter(a => a.type === "missing_recurring");

  it("THE LIVE REPRO — books frontier June 30, vendor charged June 8 → NOT stale", () => {
    const books = [...monthlyVendor, exp({ id: "z", vendor: "Someone Else", date: "2026-06-30" })];
    // Deliberately run "today" months later — the answer must not move.
    expect(stale(runAnomalyDetection(books, [], new Date("2026-08-08")))).toHaveLength(0);
    expect(stale(runAnomalyDetection(books, [], new Date("2026-12-25")))).toHaveLength(0);
    expect(stale(runAnomalyDetection(books, [], new Date("2027-06-01")))).toHaveLength(0);
  });

  it("does not depend on the date the test runs", () => {
    const books = [...monthlyVendor, exp({ id: "z", vendor: "Someone Else", date: "2026-06-30" })];
    expect(stale(runAnomalyDetection(books, [], new Date()))).toHaveLength(0);
  });

  it("still fires when the BOOKS themselves show the vendor has gone quiet", () => {
    // Books run to July 31; the vendor's last charge was June 8 → 53 days by the ledger.
    const books = [...monthlyVendor, exp({ id: "z", vendor: "Someone Else", date: "2026-07-31" })];
    const found = stale(runAnomalyDetection(books, [], new Date("2026-08-08")));
    expect(found).toHaveLength(1);
    expect(found[0].title).toMatch(/53 days/);
  });

  it("a future-dated entry cannot drag the frontier forward", () => {
    expect(booksFrontier([exp({ date: "2026-06-30" }), exp({ id: "f", date: "2027-01-01" })], new Date("2026-08-08")))
      .toBe("2026-06-30");
  });

  it("voided entries don't set the frontier", () => {
    expect(booksFrontier([exp({ date: "2026-06-30" }), exp({ id: "v", date: "2026-07-15", status: "voided" })], new Date("2026-08-08")))
      .toBe("2026-06-30");
  });

  it("an explicit period under review overrides the derived frontier", () => {
    const books = [...monthlyVendor, exp({ id: "z", vendor: "Someone Else", date: "2026-07-31" })];
    expect(stale(runAnomalyDetection(books, [], new Date("2026-08-08"), { frontier: "2026-06-30" }))).toHaveLength(0);
  });
});

// ── (f3) EMISSION DEDUPE ─────────────────────────────────────────────────────
describe("(f3) anomaly emission is content-keyed, so a re-run emits nothing new", () => {
  // Live O86: a statement re-upload took the queue from 5 cards to 10.
  const ledger = [
    exp({ id: "1", vendor: "Sysco", amount: 4000, date: "2026-06-03" }),
    exp({ id: "2", vendor: "Sysco", amount: 4000, date: "2026-06-05" }),
    exp({ id: "3", vendor: "Bluebonnet", amount: 3000, date: "2026-06-10" }),
  ];
  // The same statement re-derived: identical content, renumbered rows.
  const reRun = ledger.map((r, i) => ({ ...r, id: `re_${i}`, db_entry_id: `re_${i}` }));
  const now = new Date("2026-06-30");

  it("THE LIVE REPRO — re-running over identical content yields identical fingerprints", () => {
    const a = runAnomalyDetection(ledger, [], now).map(x => x.fingerprint).sort();
    const b = runAnomalyDetection(reRun, [], now).map(x => x.fingerprint).sort();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  });

  it("so the reconcile inserts ZERO new rows on the re-run", () => {
    const first = runAnomalyDetection(ledger, [], now);
    const rows = first.map((d, i) => ({ id: `row${i}`, fingerprint: d.fingerprint, status: "open", severity: d.severity }));
    const { toInsert, toResolve } = reconcileAnomalies({ detected: runAnomalyDetection(reRun, [], now), rows });
    expect(toInsert).toHaveLength(0);
    expect(toResolve).toHaveLength(0);
  });

  it("no fingerprint carries a database row id", () => {
    for (const a of runAnomalyDetection(ledger, [], now)) {
      expect(a.fingerprint, `id-keyed fingerprint: ${a.fingerprint}`).not.toMatch(/\bre_\d|\brow\d/);
    }
  });

  it("a genuinely NEW charge still emits — dedupe is not blanket suppression", () => {
    const before = runAnomalyDetection(ledger, [], now).map(x => x.fingerprint);
    const after = runAnomalyDetection([...ledger, exp({ id: "9", vendor: "Sysco", amount: 4000, date: "2026-06-04" })], [], now).map(x => x.fingerprint);
    expect(after.length).toBeGreaterThan(before.length);
  });

  it("a dismissed or attested fingerprint is never re-inserted", () => {
    const detected = runAnomalyDetection(ledger, [], now);
    const [d0, d1] = detected;
    const rows = [
      { id: "r0", fingerprint: d0.fingerprint, status: "dismissed" },
      { id: "r1", fingerprint: d1.fingerprint, status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: "2026-06" },
    ];
    const { toInsert } = reconcileAnomalies({ detected: [d0, d1], rows });
    expect(toInsert).toHaveLength(0);
  });

  it("category_spike keeps its :YYYY-MM tail — anomalyTouchesPeriod parses it", () => {
    const spike = [
      exp({ id: "p1", vendor: "A", amount: 100, date: "2026-05-02", gl_code: "6300" }),
      exp({ id: "p2", vendor: "A", amount: 900, date: "2026-06-02", gl_code: "6300" }),
    ];
    const found = runAnomalyDetection(spike, [], new Date("2026-06-15")).find(a => a.type === "category_spike");
    expect(found).toBeTruthy();
    expect(found.fingerprint).toMatch(/:2026-06$/);
    expect(anomalySubjectPeriod({ fingerprint: found.fingerprint, entity_refs: [] })).toBe("2026-06");
  });
});

// ── (f1) AUTO-EXPIRE ON SIGN-OFF, AND COMING BACK ON REVOKE ──────────────────
describe("(f1) anomalies expire with the month", () => {
  const invoices = [
    { id: "apr", date: "2026-04-10" }, { id: "may", date: "2026-05-10" }, { id: "jun", date: "2026-06-10" },
  ];
  const rows = [
    { id: "A", status: "open", severity: "low",    entity_refs: ["apr"], fingerprint: "fp-a" },
    { id: "B", status: "open", severity: "medium", entity_refs: ["may"], fingerprint: "fp-b" },
    { id: "C", status: "open", severity: "high",   entity_refs: ["may"], fingerprint: "fp-c" },
    { id: "D", status: "open", severity: "low",    entity_refs: ["jun"], fingerprint: "fp-d" },
  ];

  it("signing off May retires the open LOW/MEDIUM notes at or before May", () => {
    const out = anomaliesExpiredBySignoff(rows, "2026-05", invoices).map(a => a.id);
    expect(out).toEqual(["A", "B"]);
  });

  it("HIGH is never retired by the act it was supposed to block", () => {
    expect(anomaliesExpiredBySignoff(rows, "2026-05", invoices).map(a => a.id)).not.toContain("C");
    expect(anomaliesExpiredBySignoff(rows, "2026-06", invoices).map(a => a.id)).not.toContain("C");
  });

  it("a LATER month's note is untouched", () => {
    expect(anomaliesExpiredBySignoff(rows, "2026-05", invoices).map(a => a.id)).not.toContain("D");
  });

  it("a note straddling into an unattested month is NOT retired early", () => {
    const straddle = [{ id: "S", status: "open", severity: "high", entity_refs: ["may", "jun"], fingerprint: "fp-s" }];
    expect(anomalySubjectPeriod(straddle[0], invoices)).toBe("2026-06");
    expect(anomaliesExpiredBySignoff(straddle, "2026-05", invoices)).toHaveLength(0);
  });

  it("already-closed rows are not re-closed", () => {
    const closed = [{ id: "Z", status: "dismissed", severity: "low", entity_refs: ["apr"], fingerprint: "fp-z" }];
    expect(anomaliesExpiredBySignoff(closed, "2026-05", invoices)).toHaveLength(0);
  });

  it("expiring does NOT look like a human dismissal to pattern suppression", () => {
    // priorDismissalFor reads dismissals as vendor+amount judgements and quiets later
    // duplicates on the strength of them. An attestation is not that judgement — if it
    // were folded into 'dismissed', attesting a month would silently downgrade next
    // month's genuine duplicate alarms for every vendor named in it.
    const attested = [{
      id: "A", status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: "2026-05",
      type: "duplicate_payment", title: "Possible duplicate payment to Bluebonnet",
      detail: "Two charges to Bluebonnet for $145.00 within a week", resolved_at: "2026-05-31T00:00:00Z",
    }];
    expect(priorDismissalFor(attested, { vendor: "Bluebonnet", amount: 145, now: new Date("2026-06-05") })).toBe(null);
  });

  it("an attested note stays closed across the next scan", () => {
    const detected = [{ fingerprint: "fp-a", type: "round_number", severity: "low" }];
    const attested = [{ id: "A", fingerprint: "fp-a", status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: "2026-05" }];
    expect(reconcileAnomalies({ detected, rows: attested }).toInsert).toHaveLength(0);
  });

  it("the resolution note names why it closed", () => {
    expect(ATTESTED_NOTE).toBe("period attested over this note");
    expect(ANOMALY_RESOLUTION.ATTESTED).toBe("attested");
    expect(ANOMALY_RESOLUTION.ATTESTED).not.toBe(ANOMALY_RESOLUTION.DISMISSED);
  });
});

describe("(f1) REVOKE gives back exactly what attestation took", () => {
  const closed = [
    { id: "A", status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: "2026-05", fingerprint: "fp-a" },
    { id: "B", status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: "2026-06", fingerprint: "fp-b" },
    { id: "C", status: "dismissed", resolution: ANOMALY_RESOLUTION.DISMISSED, fingerprint: "fp-c" },
    { id: "D", status: "resolved", resolution: ANOMALY_RESOLUTION.AUTO, fingerprint: "fp-d" },
  ];

  it("revoking May reopens the notes MAY retired", () => {
    expect(anomaliesReopenedByRevoke(closed, "2026-05").map(a => a.id)).toEqual(["A"]);
  });

  it("a note attested by a DIFFERENT month stays closed", () => {
    expect(anomaliesReopenedByRevoke(closed, "2026-05").map(a => a.id)).not.toContain("B");
  });

  it("a human dismissal and an auto-resolve are never reopened by a revoke", () => {
    const ids = anomaliesReopenedByRevoke(closed, "2026-05").map(a => a.id);
    expect(ids).not.toContain("C");
    expect(ids).not.toContain("D");
  });

  it("FULL CYCLE — attest → expire → revoke → the note is open again", () => {
    const invoices = [{ id: "may", date: "2026-05-10" }];
    const open = [{ id: "A", status: "open", severity: "low", entity_refs: ["may"], fingerprint: "fp-a" }];

    const expired = anomaliesExpiredBySignoff(open, "2026-05", invoices);
    expect(expired.map(a => a.id)).toEqual(["A"]);

    // what the DB write produces
    const afterAttest = [{ ...open[0], status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: "2026-05" }];
    expect(reconcileAnomalies({ detected: [{ fingerprint: "fp-a" }], rows: afterAttest }).toInsert).toHaveLength(0);

    const reopening = anomaliesReopenedByRevoke(afterAttest, "2026-05");
    expect(reopening.map(a => a.id)).toEqual(["A"]);

    const afterRevoke = [{ ...afterAttest[0], status: "open", resolution: null, attested_period: null }];
    expect(anomaliesReopenedByRevoke(afterRevoke, "2026-05")).toHaveLength(0);
    expect(afterRevoke[0].status).toBe("open");
  });
});

// ── (d) THE OWNER HEARS ONE CALM LINE ────────────────────────────────────────
describe("(d) owner seat renders at most ONE muted line, never a card list", () => {
  const anom = (severity, n) => Array.from({ length: n }, (_, i) => ({ id: `${severity}${i}`, severity }));

  it("THE LIVE REPRO — five LOW notes become one line, not an amber box with five cards", () => {
    const line = ownerAnomalyLine(anom("low", 5));
    expect(typeof line).toBe("string");
    expect(line.split("\n")).toHaveLength(1);
    expect(line).toBe("5 small things noted — your accountant will look them over.");
  });

  it("nothing open → nothing said", () => {
    expect(ownerAnomalyLine([])).toBe(null);
  });

  it("HIGH is left to the trust panel — no second statement of the same thing", () => {
    expect(ownerAnomalyLine(anom("high", 3))).toBe(null);
    expect(ownerAnomalyLine([...anom("high", 2), ...anom("low", 1)]))
      .toBe("One small thing noted — your accountant will look it over.");
  });

  it("MEDIUM reads calm, and drops 'small'", () => {
    expect(ownerAnomalyLine(anom("medium", 1))).toBe("One thing noted — your accountant will look it over.");
    expect(ownerAnomalyLine([...anom("medium", 1), ...anom("low", 2)])).toBe("3 things noted — your accountant will look them over.");
  });

  it("never alarms and never counts cards", () => {
    for (const n of [1, 2, 5, 12, 25]) {
      for (const sev of ["low", "medium"]) {
        const line = ownerAnomalyLine(anom(sev, n));
        expect(line).not.toMatch(/⚠|unusual pattern|HIGH|MEDIUM|LOW/i);
        expect(containsOwnerJargon(line), `leaked jargon: "${line}"`).toBe(false);
      }
    }
  });
});

// ── (e) A PROFITABLE BUSINESS IS NOT BURNING ─────────────────────────────────
describe("(e) burn/runway stops contradicting itself", () => {
  // Profitable on the year, but only a few months of cash at the current spend pace.
  const profitableShortCash = [
    { id: "r1", type: "revenue", gl_code: "4000", amount: 60000, date: "2026-05-01", status: "booked" },
    { id: "e1", type: "expense", gl_code: "6500", amount: 10000, date: "2026-04-01", status: "booked" },
    { id: "e2", type: "expense", gl_code: "6500", amount: 10000, date: "2026-05-01", status: "booked" },
    { id: "e3", type: "expense", gl_code: "6500", amount: 10000, date: "2026-06-01", status: "booked" },
  ];
  const health = (cash) => businessHealth(profitableShortCash, { cash, now: new Date("2026-06-15") });

  it("THE LIVE REPRO — profitable + short cash renders no self-contradictory pairing", () => {
    const h = health(30000);
    expect(h.headline).toMatch(/You're profitable/);
    expect(h.headline).not.toMatch(/runway/i);          // a profitable business is not counting down
    expect(h.concerns.find(c => c.key === "runway")).toBeUndefined();
  });

  it("the number is still there — reframed as coverage, not deleted", () => {
    const h = health(30000);
    expect(h.headline).toMatch(/Cash covers about \d+ months? of spending/);
    const runwayFact = h.facts.find(f => f.key === "runway");
    expect(runwayFact.value).toMatch(/^~\d/);            // the figure survives
    expect(runwayFact.label).toBe("Cash covers");
    expect(runwayFact.tone).not.toBe("concern");         // and carries no alarm badge
  });

  it("the alarm is reserved for unprofitable AND short of cash", () => {
    const loss = [
      { id: "e1", type: "expense", gl_code: "6500", amount: 10000, date: "2026-04-01", status: "booked" },
      { id: "e2", type: "expense", gl_code: "6500", amount: 10000, date: "2026-05-01", status: "booked" },
      { id: "e3", type: "expense", gl_code: "6500", amount: 10000, date: "2026-06-01", status: "booked" },
    ];
    const h = businessHealth(loss, { cash: 20000, now: new Date("2026-06-15") });
    expect(h.headline).toMatch(/running at a loss/);
    expect(h.headline).toMatch(/runway/);
    expect(h.concerns.find(c => c.key === "runway")).toBeTruthy();
    expect(h.tone).toBe("concern");
  });

  it("plenty of cash and profitable reads healthy", () => {
    const h = health(500000);
    expect(h.headline).toMatch(/You're profitable/);
    expect(h.tone).toBe("good");
  });

  it("no state pairs 'profitable' with an alarm about running out", () => {
    for (const cash of [1000, 15000, 30000, 90000, 500000]) {
      const h = health(cash);
      const contradictory = /You're profitable/.test(h.headline) && /runway|running out/i.test(h.headline);
      expect(contradictory, `contradiction at cash=${cash}: "${h.headline}"`).toBe(false);
    }
  });
});

// ── COPY NIT — the Bank Import re-upload toast ───────────────────────────────
describe("the Bank Import toast says the already-have truth", () => {
  it("THE LIVE REPRO — all 21 deduped is not '21 transactions imported'", () => {
    const msg = bankImportToastCopy({ total: 21, alreadyBooked: 21, needReview: 0 });
    expect(msg).toBe("All 21 transactions were already in your books ✓ — nothing added.");
    expect(msg).not.toMatch(/21 transactions imported/);
    expect(msg).not.toMatch(/0 need/);
  });

  it("one line, already held", () => {
    expect(bankImportToastCopy({ total: 1, alreadyBooked: 1 })).toBe("That transaction was already in your books ✓ — nothing added.");
  });

  it("a partial re-upload counts what was actually added", () => {
    expect(bankImportToastCopy({ total: 21, alreadyBooked: 18, needReview: 2 }))
      .toBe("3 transactions imported · 18 already in your books · 2 need review");
  });

  it("a clean first import is unchanged in spirit, and never says '0 need review'", () => {
    expect(bankImportToastCopy({ total: 21, alreadyBooked: 0, needReview: 0 })).toBe("21 transactions imported · nothing needs review ✓");
    expect(bankImportToastCopy({ total: 21, alreadyBooked: 0, needReview: 1 })).toBe("21 transactions imported · 1 needs review");
  });

  it("an empty statement doesn't claim an import", () => {
    expect(bankImportToastCopy({ total: 0 })).toBe("No transactions found on that statement.");
  });
});
