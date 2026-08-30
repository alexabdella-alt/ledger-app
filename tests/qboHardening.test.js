import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// QUICKBOOKS IMPORT HARDENING — audited against the anti-patterns this repo has already
// paid for, rather than guessing at what "hardening" means.
//
// ★★★ THE FIND THAT MATTERS: MIGRATION `078`, APPLIED THIS MORNING, TURNED A LATENT
// SILENT-SUCCESS BUG INTO A LIVE ONE. The database now refuses to soft-delete an entry
// inside a signed-off month. A QuickBooks import spanning an attested period therefore
// cannot be undone — the trigger raises and the statement aborts. The old `undoImport`
// would have caught that, marked the batch `undone` anyway, and told the operator N entries
// were removed **while every one of them was still in the books.**
//
// A guard added in the morning made an existing bug dangerous by the afternoon. That
// interaction is precisely what a hardening pass is for, and it is not something any single
// commit's own tests would have caught.
// ═════════════════════════════════════════════════════════════════════════════

const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/QBOImportView.jsx"), "utf8");
const undo = view.slice(view.indexOf("const undoImport"), view.indexOf("const downloadSkipped"));

describe("★★ undoing an import reports what actually happened", () => {
  it("★ the delete RETURNS its rows — a zero-row update is not an error in PostgREST", () => {
    // Without `.select()`, removing nothing and removing everything are the same value.
    expect(undo).toMatch(/\.select\("id"\)/);
  });

  it("★★ the count said out loud is COUNTED, not read off the batch record", () => {
    // It announced `batch.imported_count` — the number stored when the import ran, which is
    // the intent. §9: describe from the outcome.
    expect(undo).toMatch(/const n = \(removed \|\| \[\]\)\.length/);
    expect(undo).not.toMatch(/\$\{batch\.imported_count\} entries removed/);
  });

  it("★★★ a REFUSED delete never marks the batch undone", () => {
    // The worst available outcome: the record says undone, the books still hold the
    // entries, and a later working undo is impossible because the batch no longer looks
    // undoable. Both the error path and the zero-row path return before the mark.
    const markAt = undo.indexOf('status: "undone"');
    const errReturn = undo.indexOf("setUndoing(null);\n        return;");
    expect(errReturn).toBeGreaterThan(-1);
    expect(errReturn).toBeLessThan(markAt);
    expect(undo).toMatch(/if \(!n\) \{/);
  });

  it("★ a signed-period refusal gets its own sentence, in the database's own words", () => {
    // `signed_period_error` (078) is already written for a person — "January 2026 has been
    // signed off by your accountant…" — so passing it through beats paraphrasing it.
    expect(undo).toMatch(/signed off by your accountant/i);
    expect(undo).toMatch(/can't be undone/);
  });

  it("★★ and the entries-gone-but-label-failed case says the BOOKS are right", () => {
    // The opposite of the old failure, and worth its own sentence: the removal committed
    // and only the list is stale. Telling someone to retry there would risk nothing, but
    // telling them it failed would be false.
    expect(undo).toMatch(/still shows as active in the list/);
    expect(undo).toMatch(/the entries are gone either way/);
    expect(undo).toMatch(/qbo_import_undo_unmarked/);
  });

  it("every failure branch is audited, not just toasted", () => {
    for (const action of ["qbo_import_undo_failed", "qbo_import_undo_unmarked", "qbo_import_undone"]) {
      expect(undo, action).toContain(action);
    }
  });
});

describe("★ the import path's other guards are still in place", () => {
  it("account-creation failures are surfaced by name (O110)", () => {
    expect(view).toMatch(/qbo_account_create_failed/);
  });

  it("the post-booking visibility invariant still runs", () => {
    expect(view).toMatch(/flagBookingVisibilityFailure/);
  });

  it("and the source file is stored (C231)", () => {
    expect(view).toMatch(/storeDocument\(/);
  });
});
