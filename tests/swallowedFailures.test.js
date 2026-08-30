import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═════════════════════════════════════════════════════════════════════════════
// ★★ EMPTY CATCHES — §9 forbids them around a write, and the three that mattered were not
// all writes.
//
// Of 23 empty catches wrapping a write or an RPC, most were `localStorage`, Sentry calls,
// or the notification read-markers already excused (a failed marker leaves the badge
// VISIBLY lit). Three were real, and the most interesting was a pair of READS.
// ═════════════════════════════════════════════════════════════════════════════

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("★★ a failed READ is not an empty result (O98)", () => {
  const team = read("src/components/views/TeamView.jsx");

  it("★★★ the team screen distinguishes 'we couldn't ask' from 'nobody has access'", () => {
    // Both queries used to fail into an empty array, so a failed load rendered as "nobody
    // is on this team" and "no invites outstanding" — on the ONE screen whose entire job is
    // to tell you who can reach your books. A silently empty list is the most reassuring
    // possible way to be wrong.
    expect(team).toMatch(/if \(error\) throw error;/);
    expect(team).toMatch(/setLoadFailed\(!ok\)/);
    expect(team).not.toMatch(/\} catch \{ \/\* RPC may be absent pre-migration \*\/ \}/);
  });

  it("★ and it SAYS so, in terms of what the list does not prove", () => {
    expect(team).toMatch(/not a confirmation that nobody else has access/);
  });
});

describe("★★ two swallowed writes that removed a safety net", () => {
  it("★★ no QuickBooks batch record means no undo — and now they are told", () => {
    const qbo = read("src/components/views/QBOImportView.jsx");
    // The undo works off the `qbo_imports` row. Without one the import is booked and cannot
    // be reversed as a group — and this was an empty catch, so the person clicking Import
    // learned nothing.
    expect(qbo).toMatch(/qbo_batch_record_failed/);
    expect(qbo).toMatch(/won't be able to reverse it in one click/);
    // it still proceeds: the entries are correct and wanted
    expect(qbo).toMatch(/Importing — but we couldn't record this as an undoable batch/);
  });

  it("★ a half-created asset that cannot be rolled back is audited", () => {
    const app = read("src/App.jsx");
    // An empty catch INSIDE a catch: two layers of not knowing. If the rollback fails the
    // books hold a fixed asset with no depreciation schedule, which will never depreciate.
    expect(app).toMatch(/fixed_asset_rollback_failed/);
    expect(app).toMatch(/no depreciation schedule/);
    // ★★ THIS ASSERTION FOUND A SECOND ROLLBACK I HAD NOT FIXED. It failed against what I
    // believed was correct code, because `indexOf` reached an EARLIER, byte-identical
    // unchecked delete a few lines above the one I had hardened. Both paths now go through
    // ONE helper — which is also why the assertion can be absolute rather than positional.
    const deletes = [...app.matchAll(/from\("fixed_assets"\)\s*\n?\s*\.delete\(/g)];
    expect(deletes).toHaveLength(1);                       // exactly one place removes an asset
    const start = deletes[0].index;
    expect(app.slice(start, start + 220)).toMatch(/\.select\("id"\)/);
    // The definition is `const rollbackFixedAsset = async (…)`, which does not match a
    // bare `rollbackFixedAsset(` — so this counts CALLERS, and asserts the definition
    // separately rather than guessing at a combined number.
    expect(app).toMatch(/const rollbackFixedAsset = async/);
    expect((app.match(/await rollbackFixedAsset\(/g) || []).length).toBe(2);   // both failure paths
  });
});
