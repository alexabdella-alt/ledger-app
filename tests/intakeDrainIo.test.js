import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { runIntakeDrain, readDrainableRows, fetchStoredFile, readDrainCensus } from "../src/lib/intakeDrainIo.js";
import { INTAKE_STATUS } from "../src/lib/documentIntake.js";

// ═════════════════════════════════════════════════════════════════════════════
// O97 STEP 2 — THE DRAIN, EXECUTION HALF.
//
// ★★ SAME TRAP AS THE PLANNER'S SUITE, SO THE SAME DISCIPLINE. The real input is empty
// today (every live intake row predates step 1 and has no `document_id`), so a suite that
// asserted "nothing went wrong" would pass forever on a drain that does nothing —
// indistinguishable from a clean queue (C195(7)). Every assertion below is POSITIVE: a
// named row resumed, a specific status written, a specific reason stated.
// ═════════════════════════════════════════════════════════════════════════════

const NOW = "2026-08-28T12:00:00.000Z";
const ago = (mins) => new Date(Date.parse(NOW) - mins * 60000).toISOString();

// ── A fake Supabase client that records every write ──────────────────────────
function fakeDb({ intake = [], documents = [], storage = {}, downloadError = null } = {}) {
  const writes = [];
  const rows = intake.map((r) => ({ ...r }));

  const makeQuery = (table, mode) => {
    const state = { table, mode, filters: [], patch: null };
    const q = {
      _state: state,
      select(_cols, opts) { if (opts?.head) state.head = true; return q; },
      eq(col, val) { state.filters.push([col, val]); return q; },
      in(col, vals) { state.filters.push(["in:" + col, vals]); return q; },
      not(col, op, val) { state.filters.push(["not:" + col, op, val]); return q; },
      update(patch) { state.mode = "update"; state.patch = patch; return q; },
      maybeSingle() { state.single = true; return q; },
      single() { state.single = true; return q; },
      then(res, rej) { return Promise.resolve(run(state)).then(res, rej); },
    };
    return q;
  };

  const run = (st) => {
    if (st.table === "documents") {
      const id = (st.filters.find((f) => f[0] === "id") || [])[1];
      return { data: documents.find((d) => String(d.id) === String(id)) || null, error: null };
    }
    if (st.mode === "update") {
      const id = (st.filters.find((f) => f[0] === "id") || [])[1];
      const row = rows.find((r) => String(r.id) === String(id));
      writes.push({ table: st.table, id, patch: st.patch });
      if (!row) return { data: null, error: { message: "no row" } };
      Object.assign(row, st.patch);
      return { data: { ...row }, error: null };
    }
    // selects on document_intake
    let out = rows;
    for (const f of st.filters) {
      if (f[0] === "in:status") out = out.filter((r) => f[1].includes(r.status));
      if (f[0] === "not:status") out = out.filter((r) => !String(f[2]).includes(r.status));
      if (f[0] === "not:document_id") out = out.filter((r) => r.document_id != null);
    }
    if (st.head) return { count: out.length, error: null, data: null };
    return { data: out.map((r) => ({ ...r })), error: null };
  };

  return {
    writes, rows,
    from: (table) => makeQuery(table, "select"),
    storage: {
      from: () => ({
        download: async (p) => downloadError
          ? { data: null, error: { message: downloadError } }
          : (storage[p] ? { data: new Blob([storage[p]], { type: "application/pdf" }), error: null }
                        : { data: null, error: { message: "not found" } }),
      }),
    },
  };
}

const collect = () => { const seen = []; const fn = (x) => seen.push(x); fn.seen = seen; return fn; };

// ═════════════════════════════════════════════════════════════════════════════
describe("★★ the write surface is checkable by reading the file", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/intakeDrainIo.js"), "utf8");
  // Strip comments first — a guard that trips on the prose explaining it is a guard
  // nobody will trust (C202 paid for this three times).
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("issues no insert, update or delete of its own", () => {
    // Every status write goes through `setIntakeStatus`, which verifies the row came back.
    // A raw `.update()` here would be the un-checked write class all over again (C192).
    expect(code).not.toMatch(/\.insert\(|\.delete\(|\.update\(/);
  });

  it("★ never writes to storage — the drain reads bytes, it does not create them", () => {
    expect(code).not.toMatch(/\.upload\(|\.remove\(/);
    expect(code).toMatch(/\.download\(/);
  });

  it("★ reaches no booking primitive and imports no client", () => {
    for (const forbidden of ["post_journal_entry", "persistJournalEntry", "bookToDb", "createClient", "logIntake", "insertIntake"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("touches only document_intake and documents", () => {
    const tables = [...code.matchAll(/\.from\(\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(tables)).toEqual(new Set(["document_intake", "documents"]));
  });
});

describe("★ resuming stored work", () => {
  const base = {
    intake: [{ id: "i1", status: "failed", document_id: "d1", filename: "roma.pdf", received_at: ago(120), updated_at: ago(60) }],
    documents: [{ id: "d1", name: "roma.pdf", mime_type: "application/pdf", storage_path: "co/roma.pdf" }],
    storage: { "co/roma.pdf": "PDFBYTES" },
  };

  it("hands the recovered file back to the pipeline, carrying the ORIGINAL intake id", async () => {
    const db = fakeDb(base);
    const enqueue = collect();
    const res = await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue });

    expect(res.ok).toBe(true);
    expect(res.started).toEqual(["i1"]);
    expect(enqueue.seen).toHaveLength(1);
    // ★ THE INTAKE ID IS THE ORIGINAL. A new one would be a second arrival row for one
    // document, which corrupts the population the completeness ledger exists to own (O60).
    expect(enqueue.seen[0].intakeId).toBe("i1");
    expect(enqueue.seen[0].filename).toBe("roma.pdf");
    expect(await enqueue.seen[0].file.text()).toBe("PDFBYTES");
  });

  it("★ writes NO new intake row — a retry is the same arrival, tried again", async () => {
    const db = fakeDb(base);
    await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue: collect() });
    expect(db.rows).toHaveLength(1);
    expect(db.writes.filter((w) => w.patch && w.patch.status)).toHaveLength(0); // a pick is not a status write
  });

  it("★ will not pick a row this tab is already working on", async () => {
    // Without the exclusion, a file still genuinely running here whose lease has expired
    // gets processed a second time — the O123 double-post shape wearing an intake row.
    const db = fakeDb(base);
    const enqueue = collect();
    const res = await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue, excludeIntakeIds: ["i1"] });
    expect(enqueue.seen).toHaveLength(0);
    expect(res.plan.counts.pick).toBe(0);
  });

  it("serves the oldest first and respects the caller's limit", async () => {
    const db = fakeDb({
      intake: [
        { id: "new", status: "failed", document_id: "d1", received_at: ago(10), updated_at: ago(10) },
        { id: "old", status: "failed", document_id: "d1", received_at: ago(600), updated_at: ago(60) },
      ],
      documents: base.documents, storage: base.storage,
    });
    const enqueue = collect();
    await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue, limit: 1 });
    expect(enqueue.seen.map((e) => e.intakeId)).toEqual(["old"]);
  });
});

describe("★★ a row we can never recover is TOLD, not retried forever", () => {
  it("holds a row whose document has no stored file, with a plain-language reason", async () => {
    const db = fakeDb({
      intake: [{ id: "i1", status: "failed", document_id: "d1", filename: "hill-country.pdf", received_at: ago(120), updated_at: ago(60) }],
      documents: [{ id: "d1", name: "hill-country.pdf", storage_path: null }],
    });
    const enqueue = collect();
    const res = await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue });

    expect(enqueue.seen).toHaveLength(0);
    expect(res.unrecoverable).toHaveLength(1);
    const w = db.writes.find((x) => x.patch?.status);
    expect(w.patch.status).toBe(INTAKE_STATUS.HELD);
    expect(w.patch.detail).toMatch(/hill-country\.pdf/);
    expect(w.patch.detail).toMatch(/uploading again/);
    // No jargon, and no claim about a cause we did not observe.
    expect(w.patch.detail).not.toMatch(/null|storage_path|undefined|error/i);
  });

  it("★ a DOWNLOAD failure is not a hold — that one gets tried again", async () => {
    // The distinction that matters: "there is nothing to fetch" is permanent, "the fetch
    // failed" is not. Collapsing them would abandon a file over one network blip.
    const db = fakeDb({
      intake: [{ id: "i1", status: "failed", document_id: "d1", received_at: ago(120), updated_at: ago(60) }],
      documents: [{ id: "d1", name: "x.pdf", storage_path: "co/x.pdf" }],
      downloadError: "network error",
    });
    const res = await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue: collect() });
    expect(res.unrecoverable[0].willRetry).toBe(true);
    expect(db.writes.filter((w) => w.patch?.status)).toHaveLength(0);
  });

  it("writes the give-up hold with the PLANNER's reason, not one composed here", async () => {
    const db = fakeDb({
      intake: [{ id: "i1", status: "failed", document_id: "d1", received_at: ago(60 * 40), updated_at: ago(60) }],
      documents: [{ id: "d1", storage_path: "co/x.pdf" }], storage: { "co/x.pdf": "B" },
    });
    const enqueue = collect();
    const res = await runIntakeDrain({ supabase: db, companyId: "co", now: NOW, enqueue });

    expect(enqueue.seen).toHaveLength(0);           // given up on, NOT retried on the way out
    expect(res.held).toHaveLength(1);
    expect(res.held[0].reason).toMatch(/gave_up_after_36h/);
    const w = db.writes.find((x) => x.patch?.status === INTAKE_STATUS.HELD);
    expect(w.patch.detail).toMatch(/40 hours after it arrived/);
  });
});

describe("★ the census is a real denominator or it is absent", () => {
  it("counts stored rows and the ones that finished", async () => {
    const db = fakeDb({
      intake: [
        { id: "a", status: "recorded", document_id: "d1", received_at: ago(90), updated_at: ago(90) },
        { id: "b", status: "held_for_review", document_id: "d2", received_at: ago(90), updated_at: ago(90) },
        { id: "c", status: "failed", document_id: "d3", received_at: ago(90), updated_at: ago(60) },
        { id: "legacy", status: "failed", document_id: null, received_at: ago(90), updated_at: ago(60) },
      ],
    });
    const c = await readDrainCensus({ supabase: db, companyId: "co" });
    expect(c).toMatchObject({ ok: true, stored: 3, done: 2 });   // `legacy` has no bytes — excluded
  });

  it("★ an unreadable census reports NOT-OK rather than zero", async () => {
    // A zero here would render "Nothing waiting." over a queue that is full — the false
    // green this product has spent a month removing.
    const broken = { from: () => ({ select: () => { throw new Error("boom"); } }) };
    const c = await readDrainCensus({ supabase: broken, companyId: "co" });
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/boom/);
  });
});

describe("★ the pass refuses to run without what it needs", () => {
  it("owns no clock", async () => {
    const res = await runIntakeDrain({ supabase: fakeDb(), companyId: "co", enqueue: collect() });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/clock/);
  });

  it("refuses without an enqueue — it has no second processing path of its own", async () => {
    const res = await runIntakeDrain({ supabase: fakeDb(), companyId: "co", now: NOW });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/enqueue/);
  });

  it("only asks the database for rows that have durable bytes", async () => {
    const db = fakeDb({
      intake: [
        { id: "has", status: "failed", document_id: "d1", received_at: ago(90), updated_at: ago(60) },
        { id: "none", status: "failed", document_id: null, received_at: ago(90), updated_at: ago(60) },
      ],
    });
    const r = await readDrainableRows({ supabase: db, companyId: "co" });
    expect(r.rows.map((x) => x.id)).toEqual(["has"]);
  });

  it("fetchStoredFile marks a missing document row non-retryable", async () => {
    const got = await fetchStoredFile({ supabase: fakeDb({ documents: [] }), documentId: "gone" });
    expect(got).toMatchObject({ ok: false, retryable: false });
  });
});
