import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ THE UNCHECKED-WRITE CLASS, CLOSED AS A CLASS.
//
// PostgREST reports NO error for an update that matched zero rows. `if (error)` therefore
// READS as a check and is not one — which is how, in a single day, we found: a delete
// function whose ids every "✓ Deleted" message was built from; two Undo buttons; a payment
// compensation; a recode; the opening-balance supersede; and a fix written that same morning
// carrying the gap it was fixing.
//
// ★ SO THE RULE IS MECHANICAL, NOT ADVISORY. Every row-targeted `.update()`/`.upsert()` in
// `src/` either calls `.select()`, goes through `checkedRowUpdate`/`checkedIdsUpdate`, or
// appears below WITH A REASON. A blanket allow-list would be the same as no rule; each
// exception has to say why nobody needs to know it failed.
// ═════════════════════════════════════════════════════════════════════════════

// ── EXCUSED, EACH FOR A STATED REASON ────────────────────────────────────────
// The test is the reason's home: if one of these ever matters, the line is deleted and the
// write gets checked like everything else.
const EXCUSED = {
  // A read/dismiss marker on a notification. Failure means the badge stays lit — the user
  // SEES the wrong state and can act on it, which is the opposite of a silent failure.
  notifications: "a failed read/dismiss marker leaves the badge visibly lit",
  // Auto-resolve, sign-off expiry and reopen. A failed transition leaves the note OPEN, i.e.
  // still on the review queue, still visible. The DISMISS path is checked (it is the one a
  // human is told succeeded).
  anomalies: "a failed status transition leaves the note visibly open; the dismiss path IS checked",
  // Upload telemetry. It records what happened for us, not for the user, and the intake
  // ledger (O60) is the durable record the completeness net actually reads.
  upload_log: "telemetry; the intake ledger is the durable record",
  // Re-linking a document to a different entry. The document and the entry both survive; the
  // link is a convenience the doc library re-derives.
  documents: "a failed relink loses a convenience link, not a record",
  // Flipping an asset to fully_depreciated once its last row posts. Derived from the
  // schedule, so the next run recomputes it.
  fixed_assets: "derived from the schedule and recomputed on the next run",
  // The review approve path's confidence bump. If it fails the flag simply reappears in the
  // queue — visibly, and the reviewer can act again.
  journal_entries: "ONLY the review confidence bump; every ledger-changing write is checked",
  // Contract edit/soft-delete: both check `error` and surface it; the zero-row case leaves
  // the contract visibly unchanged in a list the user is looking at.
  contracts: "a failed edit leaves the contract visibly unchanged on screen",
  // Learned vendor→GL profile. Best-effort learning: a lost write means the next correction
  // teaches it again.
  client_ai_profile: "learning signal; re-taught by the next correction",
};

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, f.name);
    if (f.isDirectory()) walk(full);
    else if (/\.(js|jsx)$/.test(f.name)) files.push(full);
  }
})(path.join(process.cwd(), "src"));

function unchecked() {
  const out = [];
  for (const f of files) {
    const rel = path.relative(process.cwd(), f);
    if (rel.endsWith("lib/checkedWrite.js")) continue;          // the helper itself
    const src = fs.readFileSync(f, "utf8");
    const lines = src.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith("//")) continue;
      const m = /\.from\("([a-z_]+)"\)/.exec(lines[i]);
      if (!m) continue;
      const block = lines.slice(i, i + 5).join("\n");
      if (!/\.(update|upsert)\(/.test(block)) continue;
      if (/\.select\(/.test(block)) continue;
      const before = lines.slice(Math.max(0, i - 5), i + 1).join("\n");
      if (/checkedRowUpdate|checkedIdsUpdate/.test(before)) continue;
      out.push({ rel, table: m[1], line: i + 1 });
    }
  }
  return out;
}

describe("★★★ no row-targeted write is unchecked without a stated reason", () => {
  const found = unchecked();

  it("the scan actually finds writes — an empty scan would pass everything", () => {
    // C195(7): a guard whose input is always empty is indistinguishable from a clean queue.
    const anyWrite = files.some((f) => /\.(update|upsert)\(/.test(fs.readFileSync(f, "utf8")));
    expect(anyWrite).toBe(true);
  });

  it("★★★ every unchecked write is on an EXCUSED table", () => {
    const rogue = found.filter((w) => !EXCUSED[w.table]).map((w) => `${w.rel}:${w.line} → ${w.table}`);
    expect(rogue).toEqual([]);
  });

  it("★★ and no excuse is unused — a stale exemption is how the rule rots", () => {
    // An excuse for a table nobody writes unchecked any more is a licence sitting open for
    // the next person who adds one. Same reasoning as removing the five dead destructures.
    const seen = new Set(found.map((w) => w.table));
    const unused = Object.keys(EXCUSED).filter((t) => !seen.has(t));
    expect(unused).toEqual([]);
  });

  it("★ the ledger tables are not excusable at all", () => {
    // journal_entry_lines never appears: every line write moves money.
    expect(EXCUSED.journal_entry_lines).toBeUndefined();
    expect(EXCUSED.accounts).toBeUndefined();
    expect(EXCUSED.companies).toBeUndefined();
    expect(EXCUSED.bank_accounts).toBeUndefined();
  });
});
