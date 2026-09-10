import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { recordedEntryLinks } from "../src/lib/intakeEntryLinks.js";
import { INTAKE_STATUS, setIntakeStatus } from "../src/lib/documentIntake.js";
import { computeControlTotals } from "../src/lib/controlTotals.js";

// ── O134 — THE BOUNDARY THE OTHER TWO SUITES COULD NOT CROSS ─────────────────
//
// `documentIntake.test.js` hands `setIntakeStatus` a hand-made `["je-99"]` and confirms it
// stores it. `controlTotals.test.js` hands the check hand-made intake rows. Both halves of
// the contract are proved against fixtures and the SEAM BETWEEN THEM was untested — so a
// caller that could only ever produce an empty array passed both suites, on every invoice,
// for as long as the path has existed. That is the ·3a shape for the fourth time in this
// repo, and this file is written specifically to cross it: an id is produced the way the
// real booking produces one, collected by the real collector, written by the real
// `setIntakeStatus`, read back the way `fetchIntakeRows` shapes it, and checked by the real
// `computeControlTotals`.

// A faithful stand-in for `bookToDb`. THE DETAIL THAT MATTERS IS THE ONE THAT CAUSED THE BUG:
// the durable id is written into React state via `setInvoices(prev => prev.map(...))`, which
// builds a NEW object — so the array the caller captured keeps the ORIGINALS and never gains
// `db_entry_id`. A fixture that simply stamped the field onto the captured object would be
// unable to express the defect, and would pass identically before and after the fix.
function makeBooker() {
  const state = [];                       // stands in for the `invoices` React state
  let n = 0;
  return {
    state,
    bookToDb(invoice, { fails = false } = {}) {
      return Promise.resolve().then(() => {
        if (fails) {                      // persistJournalEntry rejected → optimistic add rolled back
          const i = state.findIndex(r => r.id === invoice.id);
          if (i >= 0) state.splice(i, 1);
          return null;
        }
        const jeId = `je-${++n}`;
        // `setInvoices(prev => prev.map(...))` — the slot is REPLACED with a NEW object, so
        // the array the caller captured still holds the original, which never gains the field.
        const idx = state.findIndex(r => r.id === invoice.id);
        const next = { ...(idx >= 0 ? state[idx] : invoice), db_entry_id: jeId };
        if (idx >= 0) state[idx] = next; else state.push(next);
        return jeId;
      });
    },
  };
}

const inv = (id) => ({ id, vendor: `V${id}`, amount: 100, date: "2026-08-01" });

function fakeDB(rows) {
  const tables = { document_intake: JSON.parse(JSON.stringify(rows)) };
  const from = (t) => {
    const list = tables[t];
    const q = { op: null, patch: null, filters: [] };
    const api = {
      update(p) { q.op = "update"; q.patch = p; return api; },
      select() { if (!q.op) q.op = "select"; return api; },
      eq(k, v) { q.filters.push([k, v]); return api; },
      async single() {
        const hit = list.filter(r => q.filters.every(([k, v]) => String(r[k]) === String(v)));
        if (q.op === "update") { hit.forEach(r => Object.assign(r, q.patch)); return { data: hit[0] || null, error: null }; }
        return { data: hit[0] || null, error: null };
      },
    };
    return api;
  };
  return { from, _rows: tables.document_intake };
}

// The whole chain, end to end: book → collect → write the intake row → read it back → check.
async function driveDocument({ invoices = [], fails = new Set(), attached = [], collect }) {
  const booker = makeBooker();
  const captured = invoices.map(inv);          // exactly what `highConfidence` is
  captured.forEach(i => booker.state.push(i)); // the optimistic `setInvoices([...highConfidence, ...prev])`
  const jeIds = await Promise.all(captured.map(i => booker.bookToDb(i, { fails: fails.has(i.id) })));

  const links = collect
    ? collect({ captured, jeIds, attached })
    : recordedEntryLinks({ bookedCount: captured.length, bookedIds: jeIds, attached });

  const db = fakeDB([{ id: "intake-1", status: "processing", journal_entry_ids: [] }]);
  const status = links.complete ? INTAKE_STATUS.RECORDED : INTAKE_STATUS.HELD;
  const res = await setIntakeStatus(db, "intake-1", status, { journalEntryIds: links.ids, detail: "d" });

  const row = db._rows[0];
  const totals = computeControlTotals({ invoices: [], intakeRows: [row], codes: {} });
  const check = totals.checks.find(c => c.key === "docs_recorded") || null;
  return { links, res, row, check, totals, booker };
}

describe("O134 — the caller's ids reach the intake row and the control total ties", () => {
  it("BOUNDARY: two booked invoices → recorded, both entries linked, docs_recorded TIES", async () => {
    const { links, res, row, check } = await driveDocument({ invoices: ["a", "b"] });
    expect(res.ok).toBe(true);
    expect(links.ids).toEqual(["je-1", "je-2"]);
    expect(links.complete).toBe(true);
    expect(row.status).toBe("recorded");
    expect(row.journal_entry_ids).toEqual(["je-1", "je-2"]);   // the patch was NOT skipped
    expect(check.a).toBe(1);
    expect(check.b).toBe(1);
    expect(check.ties).toBe(true);
  });

  it("THE BUG, REPRODUCED — reading db_entry_id off the CAPTURED array yields nothing, and the check fails", async () => {
    // This is the shipped code, restored verbatim. It must fail, or this fixture is not
    // capable of expressing the defect and the passing test above proves nothing.
    const old = ({ captured }) => {
      const ids = captured.map(i => i.db_entry_id).filter(Boolean);
      return { ids, expected: captured.length, missing: captured.length - ids.length, complete: true };
    };
    const { links, row, check, booker } = await driveDocument({ invoices: ["a", "b"], collect: old });
    expect(links.ids).toEqual([]);                       // undefined, every time
    expect(row.status).toBe("recorded");                 // terminal…
    expect(row.journal_entry_ids).toEqual([]);           // …and unlinked: the guard skipped the patch
    expect(check.ties).toBe(false);                      // the accuracy net fails on correct books
    // …while the durable ids existed the whole time, on the objects in state.
    expect(booker.state.map(r => r.db_entry_id)).toEqual(["je-1", "je-2"]);
  });

  it("ATTACH-ONLY (O128) — nothing posted, but the payment it was filed against IS the entry behind it", async () => {
    const attached = [{ target: { db_entry_id: "je-pay-7", id: 123.45 } }];
    const { links, row, check } = await driveDocument({ invoices: [], attached });
    expect(links.ids).toEqual(["je-pay-7"]);   // the DURABLE id, not the in-session one
    expect(links.complete).toBe(true);
    expect(row.status).toBe("recorded");
    expect(check.ties).toBe(true);             // would have failed forever on work that was correct
  });

  it("a booking that rolled back is NOT recorded — held, carrying the id that did land", async () => {
    const { links, row, check } = await driveDocument({ invoices: ["a", "b"], fails: new Set(["b"]) });
    expect(links.ids).toEqual(["je-1"]);
    expect(links.expected).toBe(2);
    expect(links.missing).toBe(1);
    expect(links.complete).toBe(false);
    expect(row.status).toBe("held_for_review");
    expect(row.journal_entry_ids).toEqual(["je-1"]);   // nothing is lost
    expect(check).toBe(null);                          // held rows are not part of the recorded population
  });
});

describe("recordedEntryLinks — the rule stated on its own", () => {
  it("an id comes from what the write RESOLVED to, never from the object handed to the write", () => {
    // A stale invoice object carrying a db_entry_id must contribute nothing: the collector
    // is not given the invoices at all, which is what makes that unreachable by construction.
    const r = recordedEntryLinks({ bookedCount: 1, bookedIds: ["je-real"], attached: [] });
    expect(r.ids).toEqual(["je-real"]);
  });

  it("a total failure to resolve reads as 0 of N, never as 0 of 0", () => {
    // `Promise.all` threw → jeIds is []. Without `bookedCount` this would look complete.
    const r = recordedEntryLinks({ bookedCount: 3, bookedIds: [], attached: [] });
    expect(r.expected).toBe(3);
    expect(r.missing).toBe(3);
    expect(r.complete).toBe(false);
  });

  it("nothing to record is not 'complete' — an empty document must not claim to be booked", () => {
    expect(recordedEntryLinks({}).complete).toBe(false);
    expect(recordedEntryLinks({ bookedCount: 0, bookedIds: [], attached: [] }).expected).toBe(0);
  });

  it("duplicate ids fall SHORT rather than masking a miss", () => {
    // Two transactions, one id twice → deduped to one, so it reads incomplete (visible)
    // rather than counting the same entry as backing both.
    const r = recordedEntryLinks({ bookedCount: 2, bookedIds: ["je-1", "je-1"] });
    expect(r.ids).toEqual(["je-1"]);
    expect(r.complete).toBe(false);
    expect(r.missing).toBe(1);
  });

  it("an attach target with no durable id falls back to its ledger id, and a blank one counts as missing", () => {
    expect(recordedEntryLinks({ attached: [{ target: { id: "je-x" } }] }).ids).toEqual(["je-x"]);
    const none = recordedEntryLinks({ attached: [{ target: { id: null } }] });
    expect(none.ids).toEqual([]);
    expect(none.missing).toBe(1);
  });
});

describe("the caller is wired to the seam (the defect's own shape cannot come back)", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it("the invoice path's RECORDED stamp passes recordedEntryLinks' ids, not a map over the invoices", () => {
    expect(src).toMatch(/const entryLinks = recordedEntryLinks\(\{ bookedCount: highConfidence\.length, bookedIds: jeIds, attached \}\)/);
    expect(src).toMatch(/INTAKE_STATUS\.RECORDED, \{ journalEntryIds: entryLinks\.ids/);
  });

  it("NO RECORDED stamp anywhere reads db_entry_id — that field is written into state, not held by the caller", () => {
    // The bug's signature, scoped to the place it can do this damage. Reading `db_entry_id`
    // off the live `invoices` state is legitimate (those objects have it); reading it off an
    // array a booking was HANDED is not, and the four RECORDED stamps are where that read
    // turns into a terminal-and-unlinked row. Deliberately NOT a blanket ban on the field:
    // a guard that fails for a reason it does not mean is a guard nobody will trust.
    const stamps = [...src.matchAll(/INTAKE_STATUS\.RECORDED/g)].map(m => src.slice(m.index, m.index + 300));
    expect(stamps.length).toBeGreaterThanOrEqual(3);   // invoice, payroll (x2), statement
    for (const s of stamps) expect(s).not.toContain("db_entry_id");
  });

  it("RECORDED is gated on holding every entry — an incomplete document is held, not called done", () => {
    expect(src).toMatch(/if \(entryLinks\.complete\)/);
    expect(src).toMatch(/invoice_entry_link_incomplete/);   // a failed stamp says so
  });
});
