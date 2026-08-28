import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  INTAKE_STATUS, TERMINAL_INTAKE_STATUSES, isTerminalIntake,
  buildIntakeRow, reconcileIntake, insertIntake, setIntakeStatus,
} from "../src/lib/documentIntake.js";

// Minimal fake of the Supabase query builder over an in-memory table (insert/update + select).
function fakeDB(initial = {}, opts = {}) {
  const tables = JSON.parse(JSON.stringify(initial));
  const { failOn = null } = opts;
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
      if (failOn === `${table}.${q.op}`) return { data: null, error: { message: "simulated DB failure" } };
      if (q.op === "insert") { const row = { id: q.payload.id || _id++, ...q.payload }; rows.push(row); return { data: row, error: null }; }
      if (q.op === "update") { const hit = rows.filter(matches); hit.forEach(r => Object.assign(r, q.patch)); return { data: hit[0] || null, error: null }; }
      return { data: rows.filter(matches)[0] || null, error: null };
    }
    return api;
  };
  return { from, _tables: tables };
}

const MIN = 60000;
const ago = (mins, base = Date.now()) => new Date(base - mins * MIN).toISOString();

describe("intake status model", () => {
  it("only recorded / held_for_review / rejected are terminal", () => {
    expect(TERMINAL_INTAKE_STATUSES).toEqual(["recorded", "held_for_review", "rejected"]);
    expect(isTerminalIntake("recorded")).toBe(true);
    expect(isTerminalIntake("held_for_review")).toBe(true);
    expect(isTerminalIntake("rejected")).toBe(true);
    expect(isTerminalIntake("received")).toBe(false);
    expect(isTerminalIntake("processing")).toBe(false);
    expect(isTerminalIntake("failed")).toBe(false);   // a hard error must NOT count as resolved
  });
});

describe("(a) a document's ARRIVAL creates a 'received' intake row before any processing", () => {
  it("buildIntakeRow is a dead-simple received row with the identity fields", () => {
    const row = buildIntakeRow({ companyId: "co", filename: "invoice.pdf", contentHash: "abc123", source: "upload", uploadedBy: "u1" });
    expect(row).toMatchObject({ company_id: "co", filename: "invoice.pdf", content_hash: "abc123", source: "upload", uploaded_by: "u1", status: "received" });
  });
  it("insertIntake persists it (and is verifiable / honest on failure)", async () => {
    const db = fakeDB();
    const res = await insertIntake(db, buildIntakeRow({ companyId: "co", filename: "a.pdf" }));
    expect(res.ok).toBe(true);
    expect(db._tables.document_intake).toHaveLength(1);
    expect(db._tables.document_intake[0].status).toBe("received");
    expect((await insertIntake(fakeDB({}, { failOn: "document_intake.insert" }), buildIntakeRow({ companyId: "co" }))).ok).toBe(false);
  });
});

describe("(b) successful booking flips the intake row to 'recorded' + links the JE id", () => {
  it("setIntakeStatus recorded writes status + journal_entry_ids, verified", async () => {
    const db = fakeDB({ document_intake: [{ id: "i1", status: "received", journal_entry_ids: [] }] });
    const res = await setIntakeStatus(db, "i1", INTAKE_STATUS.RECORDED, { journalEntryIds: ["je-99"], detail: "1 invoice booked" });
    expect(res.ok).toBe(true);
    expect(db._tables.document_intake[0].status).toBe("recorded");
    expect(db._tables.document_intake[0].journal_entry_ids).toEqual(["je-99"]);
    // and it's now terminal → reconciliation ignores it
    expect(reconcileIntake(db._tables.document_intake, { now: new Date() })).toEqual([]);
  });
  it("honest on failure: a DB error → ok:false (no false 'recorded')", async () => {
    const db = fakeDB({ document_intake: [{ id: "i1", status: "received" }] }, { failOn: "document_intake.update" });
    expect((await setIntakeStatus(db, "i1", INTAKE_STATUS.RECORDED, { journalEntryIds: ["je-1"] })).ok).toBe(false);
  });
});

describe("(c) a doc that errors / never books stays non-terminal and reconciliation SURFACES it", () => {
  it("a 'failed' row is flagged immediately; a stuck 'processing' row is flagged past the threshold", () => {
    const rows = [
      { id: "ok", status: "recorded", received_at: ago(120) },              // resolved — ignored
      { id: "failed", status: "failed", received_at: ago(2), detail: "AI extract crashed" },
      { id: "stuck", status: "processing", received_at: ago(90) },          // past 30m → stuck
      { id: "inflight", status: "processing", received_at: ago(2) },        // recent → not a false positive
    ];
    const dropped = reconcileIntake(rows, { now: new Date(), stuckMinutes: 30 });
    const ids = dropped.map(d => d.id).sort();
    expect(ids).toEqual(["failed", "stuck"]);
    expect(dropped.find(d => d.id === "failed").reason).toMatch(/failed/);
    expect(dropped.find(d => d.id === "stuck").reason).toMatch(/stuck/);
  });
  it("a 'received' row that was never advanced is flagged once it ages out", () => {
    const dropped = reconcileIntake([{ id: "lost", status: "received", received_at: ago(45) }], { stuckMinutes: 30 });
    expect(dropped.map(d => d.id)).toEqual(["lost"]);
    expect(dropped[0].reason).toMatch(/never recorded/);
  });
});

describe("(d) THE GUARANTEE: reconciliation is INDEPENDENT — it catches what the pipeline LOST", () => {
  it("a doc the pipeline dropped (intake row exists, but NO journal entry was ever created and status never advanced) is still flagged — without consulting journal_entries/documents", async () => {
    // Arrival logged independently, first.
    const db = fakeDB();
    await insertIntake(db, { id: "ghost", ...buildIntakeRow({ companyId: "co", filename: "dropped.pdf" }) });
    // Simulate the recording pipeline LOSING it: no booking, no markIntake — the row just
    // sits at 'received'. Crucially there is NO journal_entries / documents table here at
    // all; reconciliation reads ONLY the intake population.
    db._tables.document_intake[0].received_at = ago(60);   // age it past the threshold
    const dropped = reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 });
    expect(dropped.map(d => d.id)).toEqual(["ghost"]);     // the lost doc is detectable
    expect(dropped[0].filename).toBe("dropped.pdf");
    // Contrast: had the pipeline RECORDED it, the same independent check would clear it.
    db._tables.document_intake[0].status = "recorded";
    expect(reconcileIntake(db._tables.document_intake, { stuckMinutes: 30 })).toEqual([]);
  });

  it("empty intake → nothing dropped (no false positives on a clean company)", () => {
    expect(reconcileIntake([], {})).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ O97 STEP 1 — THE BYTES ARE STORED BEFORE THE FIRST AI CALL.
//
// This feature IS an ordering. There is no new module and no new table to assert on —
// `document_intake` + `documents.storage_path` + `upload_log` were already a durable work
// queue; the defect was that we wrote to it AFTER the work it was meant to schedule.
//
// So the only thing that can regress is the ORDER, and an order regresses silently: move
// the store back below the classify and everything still works, right up until a browser
// refresh eats a file — which is O97's original symptom (the live orphan of 2026-08-06).
//
// Comments are stripped before scanning. Guards in this project have tripped on their own
// prose three times.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ O97 — durable-first intake ordering", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  const fn = code.slice(code.indexOf("const processUploadItem = async"),
                       code.indexOf("const processUploadItem = async") + 9000);

  it("★ storeDocument is called BEFORE classifyFile", () => {
    const store = fn.indexOf("storeDocument(");
    const classify = fn.indexOf("classifyFile(");
    expect(store, "storeDocument not found in processUploadItem").toBeGreaterThan(-1);
    expect(classify, "classifyFile not found in processUploadItem").toBeGreaterThan(-1);
    expect(store).toBeLessThan(classify);
  });

  it("★ the first store does not wait for a document type — it stores `pending`", () => {
    // The type is an OUTPUT of classification. Requiring it before keeping the file is
    // exactly what forced the store to happen last.
    const store = fn.slice(fn.indexOf("storeDocument("), fn.indexOf("storeDocument(") + 160);
    expect(store).toContain('"pending"');
  });

  it("★ the stored document id is stamped onto the intake row", () => {
    // Without this the two halves of the queue cannot be joined, and a drain (step 2)
    // has no way to find rows that have bytes and no outcome.
    expect(fn).toMatch(/markIntake\([^)]*INTAKE_STATUS\.PROCESSING[\s\S]{0,120}documentId/);
  });

  it("★ the real type is stamped once classification returns", () => {
    // Otherwise every document sits in the library as `pending` forever — the dedup branch
    // of storeDocument returns an existing id WITHOUT updating the type, so a later call
    // cannot fix it.
    expect(fn).toMatch(/o97_stamp_doc_type/);
    expect(fn).toMatch(/document_type: docType/);
  });

  it("★ a failed store must NOT block processing, and must NOT be silent", () => {
    const guard = fn.slice(fn.indexOf("durableDocId = await storeDocument"), fn.indexOf("durableDocId = await storeDocument") + 700);
    expect(guard).toMatch(/catch/);
    expect(guard).toMatch(/console\.error/);
  });
});
