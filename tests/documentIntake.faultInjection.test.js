import { describe, it, expect } from "vitest";
import {
  INTAKE_STATUS, buildIntakeRow, insertIntake, setIntakeStatus, reconcileIntake,
} from "../src/lib/documentIntake.js";

// ─────────────────────────────────────────────────────────────────────────────
// O60 FAULT INJECTION — break the pipeline on purpose, prove the net catches it.
// A safety net is only proven by deliberately dropping a document mid-pipeline and
// confirming reconciliation surfaces EXACTLY the dropped one (and the survivors don't
// false-positive). This simulates the REAL failure: a doc gets its intake row on arrival,
// then processing throws / produces nothing / never marks a terminal state.
// ─────────────────────────────────────────────────────────────────────────────

function fakeDB(initial = {}) {
  const tables = JSON.parse(JSON.stringify(initial));
  let _id = 1;
  const from = (table) => {
    tables[table] = tables[table] || [];
    const rows = tables[table];
    const q = { op: null, payload: null, patch: null, filters: [] };
    const matches = (r) => q.filters.every(([k, v]) => String(r[k]) === String(v));
    const api = {
      insert(p) { q.op = "insert"; q.payload = p; return api; },
      update(p) { q.op = "update"; q.patch = p; return api; },
      select() { if (!q.op) q.op = "select"; return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      async single() { return run(); },
      async maybeSingle() { return run(); },
    };
    function run() {
      if (q.op === "insert") { const row = { id: q.payload.id || _id++, ...q.payload }; rows.push(row); return { data: row, error: null }; }
      if (q.op === "update") { const hit = rows.filter(matches); hit.forEach(r => Object.assign(r, q.patch)); return { data: hit[0] || null, error: null }; }
      return { data: rows.filter(matches)[0] || null, error: null };
    }
    return api;
  };
  return { from, _tables: tables };
}

const MIN = 60000;
const ageRow = (db, id, mins) => { const r = db._tables.document_intake.find(x => x.id === id); r.received_at = new Date(Date.now() - mins * MIN).toISOString(); };

// A faithful mini-pipeline: arrival ALWAYS logs intake first; then processing runs per the
// injected outcome. "crash" throws (the doc never advances). "zero" succeeds-but-produces-
// nothing (a bug: marks processing, never reaches a terminal). Others reach a terminal state.
async function processDoc(db, name, outcome) {
  const id = `i_${name}`;
  await insertIntake(db, { id, ...buildIntakeRow({ companyId: "co", filename: name }) });   // received — BEFORE processing
  try {
    if (outcome === "book") { await setIntakeStatus(db, id, INTAKE_STATUS.PROCESSING); await setIntakeStatus(db, id, INTAKE_STATUS.RECORDED, { journalEntryIds: [`je_${name}`] }); }
    else if (outcome === "reject") { await setIntakeStatus(db, id, INTAKE_STATUS.REJECTED, { detail: "duplicate" }); }
    else if (outcome === "held") { await setIntakeStatus(db, id, INTAKE_STATUS.HELD, { detail: "routed" }); }
    else if (outcome === "zero") { await setIntakeStatus(db, id, INTAKE_STATUS.PROCESSING); /* BUG: "done" but never terminal, no JE */ }
    else if (outcome === "inflight") { await setIntakeStatus(db, id, INTAKE_STATUS.PROCESSING); /* genuinely still running */ }
    else if (outcome === "crash") { throw new Error("AI extract threw mid-pipeline"); }   // doc dropped: stays 'received'
  } catch { /* pipeline crashed — the intake row is left exactly where it was (the real drop) */ }
  return id;
}

describe("O60 fault injection: one doc dropped mid-pipeline → caught, and ONLY it", () => {
  it("3 docs book successfully, 1 crashes → reconciliation surfaces exactly the crashed one", async () => {
    const db = fakeDB();
    await processDoc(db, "invoice_ok1", "book");
    await processDoc(db, "invoice_ok2", "book");
    await processDoc(db, "receipt_ok3", "book");
    await processDoc(db, "broken_scan", "crash");      // ← deliberately dropped
    // time passes (the dropped one ages past the stuck threshold; the booked ones are terminal)
    db._tables.document_intake.forEach(r => ageRow(db, r.id, 60));

    const dropped = reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 });
    expect(dropped.map(d => d.id)).toEqual(["i_broken_scan"]);   // EXACTLY the dropped doc
    expect(dropped[0].filename).toBe("broken_scan");
    expect(dropped[0].reason).toMatch(/never recorded/);
    // the 3 successes do NOT false-positive (exactly one dropped)
    expect(dropped).toHaveLength(1);
    expect(dropped.map(d => d.id)).not.toContain("i_invoice_ok1");
  });
});

describe("O60 fault injection: pipeline 'succeeds' but produces a ZERO/WRONG result", () => {
  it("a doc that finished processing but never reached a terminal (no JE) stays non-terminal → caught", async () => {
    const db = fakeDB();
    await processDoc(db, "good", "book");
    await processDoc(db, "zero_result", "zero");        // ← "done" but produced nothing, left at 'processing'
    db._tables.document_intake.forEach(r => ageRow(db, r.id, 90));

    const dropped = reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 });
    expect(dropped.map(d => d.id)).toEqual(["i_zero_result"]);
    expect(dropped[0].status).toBe("processing");
    expect(dropped[0].reason).toMatch(/stuck/);
  });
});

describe("O60 edge cases: no false positives on legitimate states", () => {
  it("an in-flight doc (recently received, still processing) is NOT flagged", async () => {
    const db = fakeDB();
    await processDoc(db, "still_running", "inflight");
    ageRow(db, "i_still_running", 3);                   // only 3 min old — genuinely in-flight
    expect(reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 })).toEqual([]);
  });

  it("a legitimately REJECTED doc (terminal) is NOT shown as dropped", async () => {
    const db = fakeDB();
    await processDoc(db, "dupe", "reject");
    ageRow(db, "i_dupe", 240);                          // old, but terminal → resolved
    expect(reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 })).toEqual([]);
  });

  it("a HELD doc (routed to another queue, terminal) is NOT shown as dropped", async () => {
    const db = fakeDB();
    await processDoc(db, "bank_stmt", "held");
    ageRow(db, "i_bank_stmt", 240);
    expect(reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 })).toEqual([]);
  });
});

describe("O60 COVERAGE BOUNDARY (documented limit): a FALSELY-'recorded' doc is trusted", () => {
  it("a doc marked 'recorded' but linking ZERO journal entries is NOT caught by status-only reconciliation", async () => {
    // This is the honest boundary. reconcileIntake trusts the terminal mark — it checks the
    // intake STATUS, not whether a real JE actually exists. A pipeline bug that marks
    // 'recorded' while booking nothing slips past THIS net. (Note: our own wiring can leave a
    // recorded row with empty journal_entry_ids when db_entry_id resolves after the mark, so
    // we deliberately do NOT flag recorded-with-no-JE here to avoid false positives.)
    const db = fakeDB();
    const id = await processDoc(db, "ghost_record", "book");
    db._tables.document_intake.find(r => r.id === id).journal_entry_ids = [];   // claims recorded, links nothing
    ageRow(db, id, 120);

    const dropped = reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 });
    expect(dropped).toEqual([]);   // ← NOT caught — this is the known gap O60 does not cover
    // What WOULD catch it: control-total reconciliation against the GL (every recorded doc's
    // JE actually posted, debits=credits, derived==raw) — O59 Layer 1/2 + the O49 accuracy-recon
    // work, NOT the intake completeness net. Catalogued so we know the net's edge.
  });
});
