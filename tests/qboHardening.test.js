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

// ═════════════════════════════════════════════════════════════════════════════
// THE CALLER SWEEP `078` DEMANDED — every site that does something the new guard can now
// refuse, checked for whether it notices.
//
// ★★ AN UNDO THAT FAILS SILENTLY IS THE WORST BUTTON IN THE PRODUCT. Both user-facing
// Undos were unchecked updates inside `console.warn` catches, so a zero-row write (never an
// error in PostgREST) and a refusal both left the toast dismissed, the entry still in the
// books, and the person believing they had undone it. §9: an invisible action will be
// repeated — and here the repeat is another Void, which is how one invoice was reversed
// three times.
//
// `078` made it REACHABLE rather than merely possible: the database now refuses to remove
// an entry in a signed month, so an Undo on anything posted into one lands straight in that
// catch.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ every Undo says so when it fails", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");

  it("the reversal Undo is checked and audited", () => {
    expect(app).toMatch(/label: "reverse:undo"/);
    expect(app).toMatch(/reversal_undo_failed/);
  });

  it("the booked-on-dismiss Undo is checked and audited", () => {
    expect(app).toMatch(/label: "dismiss-book:undo"/);
    expect(app).toMatch(/booked_on_dismiss_undo_failed/);
  });

  it("★ neither swallows the failure into a console warning any more", () => {
    const code = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/console\.warn\("\[reverse\] undo failed/);
    expect(code).not.toMatch(/console\.warn\("\[dismiss\] undo failed/);
  });

  it("★★ and each says the BOOKS still hold the entry — not that nothing happened", () => {
    // The person needs to know the state they are actually in. "Couldn't undo" alone
    // leaves them guessing whether the entry is there.
    expect(app).toMatch(/the correction is still in your books/);
    expect(app).toMatch(/the transaction is still in your books/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// THE SWEEP'S THIRD FIND — a BACKGROUND job that could raise an INTERACTIVE dialog.
//
// `persistMultiLineEntry` holds an entry dated into a signed month and pops a confirmation:
// correct for someone who has JUST dropped a document into a closed period, and asked to
// choose. **`autoPostDepreciation` runs on every company load with nobody watching.** A
// depreciation row falling in a signed month would have popped a decision about something
// the user never did, got no answer, left the row `pending`, and done it again on the next
// load — forever.
//
// ★ `078` IS WHY IT MATTERS NOW: the database refuses that insert regardless, so the
// client-side hold is the only thing between a background job and a raw trigger error.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ an automatic poster never asks a question nobody is there to answer", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  // ★ SLICED TO THE NEXT TOP-LEVEL DECLARATION. My first cut ended at `const ensureAccount`,
  // which appears EARLIER in the file (a nested helper in `persistJournalEntry`), so
  // `indexOf` returned a position BEFORE the start and the slice was empty — three tests
  // failed against correct code. An end anchor has to be after the start.
  const wStart = app.indexOf("const persistMultiLineEntry");
  const writer = app.slice(wStart, app.indexOf("const ensureAccountIdForCode", wStart));

  it("the multi-line writer takes a `background` flag", () => {
    expect(writer).toMatch(/\{ background = false \} = \{\}/);
  });

  it("★★ in the background it AUDITS and returns, instead of raising the dialog", () => {
    const held = writer.slice(writer.indexOf("if (heldPeriodML)"));
    const skip = held.indexOf("signed_period_booking_skipped");
    const prompt = held.indexOf("setPendingSignedPeriodBooking");
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(prompt);            // the background branch returns first
    expect(held).toMatch(/if \(background\) \{/);
  });

  it("★ the interactive path is untouched — a person who just acted still gets the choice", () => {
    expect(writer).toMatch(/setPendingSignedPeriodBooking\(\{ invoice: entry, period: heldPeriodML, multiLine: true \}\)/);
  });

  it("★★ depreciation is the ONE caller that passes it, and it COUNTS what it skipped", () => {
    // A row that can never post while its month stays signed would otherwise be retried on
    // every load with nobody told why — the silent-forever-retry shape.
    expect(app).toMatch(/persistMultiLineEntry\(je, \{ background: true \}\)/);
    const dep = app.slice(app.indexOf("persistMultiLineEntry(je, { background: true })"));
    expect(dep.slice(0, 400)).toMatch(/incomplete\.push\(row\)/);
  });

  it("★ every OTHER caller stays interactive — the flag is opt-in, not a default", () => {
    // If `background` were the default, every user-initiated booking would silently skip a
    // closed month instead of offering the choice: the opposite bug, and a quieter one.
    const calls = [...app.matchAll(/persistMultiLineEntry\((?!\s*entry)[^;]*?\)/g)].map((m) => m[0]);
    const backgrounded = calls.filter((c) => c.includes("background: true"));
    expect(backgrounded).toHaveLength(1);
  });
});
