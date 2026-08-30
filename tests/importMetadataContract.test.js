import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ O95 — THE CLASS, GUARDED. Not another instance: the SHAPE.
//
// `post_journal_entry` cherry-picks six named scalars out of `p_meta` and silently discards
// everything else, so **any key put in `p_meta` is written nowhere**. That single fact has
// now produced five separate defects, each found by hand, months apart:
//
//   · the payroll auto-post gate — could never fire, for a whole release
//   · payroll bank-line matching — inert by the same mechanism
//   · depreciation's idempotency marker — inert
//   · the reversal marker — inert, and it FAILED OPEN: one bill reversed three times
//   · the sales-tax control total — not inert but INVERTED, flagging correct books and
//     passing the one failure it exists to catch
//   · "the original date is kept on file" — kept nowhere, and displayed nowhere
//
// ★★ EVERY ONE WAS FOUND BY A PERSON READING CODE. None was found by a test, because a test
// that hands the reader its fixture proves the reader works GIVEN the data and says nothing
// about whether the data arrives (the ·3a lesson). This file asserts the CONTRACT instead:
// **every key read off `import_metadata` must be written by something.**
//
// It cannot prove the write lands at runtime — only a live drive does that. It can prove
// nobody has added a SIXTH reader with no writer, which is how all six of the above began.
// ═════════════════════════════════════════════════════════════════════════════

const srcFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, f.name);
    if (f.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(f.name)) srcFiles.push(full);
  }
})(path.join(process.cwd(), "src"));

const sources = srcFiles.map((f) => ({
  file: path.relative(process.cwd(), f),
  // Comments are stripped: this file's own neighbours DOCUMENT these keys in prose, and a
  // guard that matches its own explanation is a false positive we have now hit four times.
  text: fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n"),
}));
const all = sources.map((s) => s.text).join("\n");

// Keys READ: `x.import_metadata.KEY`, `x.import_metadata?.KEY`, and the PostgREST
// `import_metadata->>KEY` form used in `.eq()` filters.
function keysRead(text) {
  const out = new Set();
  for (const m of text.matchAll(/import_metadata\s*(?:\?\.|\.)\s*([a-z_][a-z0-9_]*)/gi)) out.add(m[1]);
  for (const m of text.matchAll(/import_metadata->>'?([a-z_][a-z0-9_]*)'?/gi)) out.add(m[1]);
  return out;
}

// Keys WRITTEN: inside `import_metadata: { … }` object literals, plus any object handed to
// a checked write as the metadata patch.
function keysWritten(text) {
  const out = new Set();
  for (const m of text.matchAll(/import_metadata:\s*\{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/([a-z_][a-z0-9_]*)\s*:/gi)) out.add(k[1]);
    for (const k of m[1].matchAll(/\.\.\.\(?\s*[a-z0-9_.]*\s*\?\s*\{\s*([a-z_][a-z0-9_]*)\s*:/gi)) out.add(k[1]);
  }
  // The spread form: `patch: { import_metadata: stamp }` with `stamp` built above it.
  for (const m of text.matchAll(/const stamp = \{([\s\S]*?)\n\s*\};/g)) {
    for (const k of m[1].matchAll(/\{\s*([a-z_][a-z0-9_]*)\s*:/gi)) out.add(k[1]);
  }
  return out;
}

describe("★★★ every key read off import_metadata has a writer", () => {
  const read = keysRead(all);
  const written = keysWritten(all);

  it("the reader set is the six keys we know about — a seventh must be deliberate", () => {
    // Not a style rule: a new reader is exactly how each of the six defects above started,
    // and the cost of noticing late has been a release each time.
    expect([...read].sort()).toEqual([
      "kind", "original_date", "payment_for", "rebooked_from_signed_period", "reverses", "tax_amount",
    ]);
  });

  it("★★★ and NONE of them is read without something writing it", () => {
    const orphans = [...read].filter((k) => !written.has(k));
    expect(orphans).toEqual([]);
  });

  it("★★ nothing reaches `p_meta` except the six scalars the RPC actually keeps", () => {
    // The RPC's contract, restated where a person adding a key will trip over it. Anything
    // else placed in `p_meta` is written NOWHERE and the comment describing it becomes a
    // description of an intention — which is the whole of O95.
    const KEPT = ["ai_reasoning", "ai_confidence", "approval_status", "payment_status", "payment_method", "due_date"];
    const app = sources.find((s) => s.file.endsWith("App.jsx")).text;
    const start = app.indexOf("const persistJournalEntry");
    const meta = app.slice(app.indexOf("const meta = {", start), app.indexOf('rpc("post_journal_entry"', start));
    const keys = [...meta.matchAll(/^\s{8}([a-z_][a-z0-9_]*):/gim)].map((m) => m[1]);
    expect(keys.filter((k) => !KEPT.includes(k))).toEqual([]);
  });

  it("★ each writer goes through a CHECKED write, so a failed stamp is not silent", () => {
    // The stamp is the only thing standing between a reader and inertness. An unchecked
    // update that matches zero rows reports no error (C192), which would put the field back
    // exactly where O95 had it.
    for (const s of sources) {
      for (const m of s.text.matchAll(/import_metadata:\s*\{[^}]*\}/g)) {
        const before = s.text.slice(Math.max(0, m.index - 300), m.index);
        // Either it is a checked write, or it is the pure builder in signedPeriod.js that
        // hands its object to a caller rather than to the database.
        const ok = /checkedRowUpdate\(\{|checkedIdsUpdate\(\{/.test(before) || s.file.endsWith("signedPeriod.js");
        expect(ok, `unchecked import_metadata write in ${s.file}`).toBe(true);
      }
    }
  });
});
