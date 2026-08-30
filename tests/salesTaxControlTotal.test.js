import { describe, it, expect } from "vitest";
import { computeControlTotals } from "../src/lib/controlTotals.js";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ O95 — THE SALES-TAX NET IS NOT INERT. IT IS INVERTED.
//
// `taxChargedOnInvoices` reads `import_metadata.tax_amount`. `persistJournalEntry` puts
// that key in `p_meta` — and `post_journal_entry` cherry-picks six named scalars and
// discards the rest, so **`import_metadata` is NULL on every entry the RPC has ever
// posted**. The writer's own comment says the figure is "persisted INDEPENDENT of how it
// was booked"; it is not persisted at all.
//
// The consequence is not that the check does nothing. It is that it does the OPPOSITE of
// its purpose, and these two cases are the proof:
//   · tax booked CORRECTLY → the liability is credited, charged reads 0 → MISMATCH, and
//     an accuracy flag BLOCKS SIGN-OFF on books that are right.
//   · tax MIS-BOOKED INTO REVENUE — the Riverside case the whole net was built for →
//     liability 0, charged 0 → TIES, and the one bug it exists to catch passes silently.
//
// ★ A guard that fires on correct work and stays quiet on the failure it was written for
// is worse than an absent guard: the absent one at least does not train you to ignore it.
// ═════════════════════════════════════════════════════════════════════════════

const codes = { ar: "1200", ap: "2000", salesTax: "2350" };
const tie = (rows) => {
  const out = computeControlTotals({ invoices: rows, reconciliations: [], intakeRows: [], codes });
  return (out.checks || []).find((c) => c.key === "sales_tax_tie");
};

// A $1,000 sale with $80 tax, booked correctly: Dr A/R 1080 / Cr Revenue 1000 / Cr Tax 80.
// Same shape as `tests/controlTotals.test.js` — one flattened row per line, each carrying
// the entry's `import_metadata`. `meta` is the variable under test: null is what the
// database ACTUALLY holds, because `post_journal_entry` drops the key.
const correctlyBooked = (meta) => [
  { id: "e1_0", gl_code: "1200", amount: 1080, debit_credit: "debit",  date: "2026-08-01", type: "revenue", payment_status: "unpaid", import_metadata: meta },
  { id: "e1_1", gl_code: "4000", amount: 1000, debit_credit: "credit", date: "2026-08-01", type: "revenue", ar_amount: 1080, payment_status: "unpaid", import_metadata: meta },
  { id: "e1_2", gl_code: "2350", amount: 80,   debit_credit: "credit", date: "2026-08-01", type: "revenue", import_metadata: meta },
];

// The same sale with the tax swept into revenue — nothing reaches the liability.
const misbooked = (meta) => [
  { id: "e2_0", gl_code: "1200", amount: 1080, debit_credit: "debit",  date: "2026-08-01", type: "revenue", payment_status: "unpaid", import_metadata: meta },
  { id: "e2_1", gl_code: "4000", amount: 1080, debit_credit: "credit", date: "2026-08-01", type: "revenue", ar_amount: 1080, payment_status: "unpaid", import_metadata: meta },
];

describe("★★★ what the dropped field actually costs", () => {
  it("★★ WITHOUT the stamp, correct books are FLAGGED", () => {
    const c = tie(correctlyBooked(null));
    expect(c.a).toBe(0);        // charged — the figure that never persisted
    expect(c.b).toBe(80);       // the liability, which is right
    expect(c.ties).toBe(false);   // → an accuracy flag that BLOCKS SIGN-OFF on correct books
  });

  it("★★★ WITHOUT the stamp, the Riverside bug it exists to catch TIES SILENTLY", () => {
    const c = tie(misbooked(null));
    expect(c.a).toBe(0);
    expect(c.b).toBe(0);
    expect(c.ties).toBe(true);    // 0 === 0 — the exact failure the net was built for, passing
  });

  it("★★ WITH the stamp, both verdicts invert to the right way round — correct books tie", () => {
    const c = tie(correctlyBooked({ tax_amount: 80 }));
    expect(c.a).toBe(80);
    expect(c.b).toBe(80);
    expect(c.ties).toBe(true);
  });

  it("★★★ and the mis-booking is CAUGHT, which is the whole point of the net", () => {
    const c = tie(misbooked({ tax_amount: 80 }));
    expect(c.a).toBe(80);       // the invoice charged 80…
    expect(c.b).toBe(0);        // …and the liability is empty
    expect(c.ties).toBe(false);
  });

  it("★ the tax figure is counted ONCE per entry, not once per line", () => {
    // Every line of a multi-line entry carries the same `import_metadata` after flattening,
    // so a naive sum would treble an 80 into 240 and manufacture a mismatch of its own.
    const c = tie(correctlyBooked({ tax_amount: 80 }));
    expect(c.a).toBe(80);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ AND WHY A GREEN SUITE NEVER SAID SO — the ·3a lesson, in this file's own neighbour.
//
// `tests/controlTotals.test.js` hands its fixtures `import_metadata: { tax_amount: 8 }`
// directly. The reader and the fixture therefore agree with each other, while neither
// agrees with the database — which is precisely how the payroll gate shipped unable to
// fire for a whole release. A test that supplies the field production never writes proves
// the check works GIVEN the data, and says nothing about whether the data arrives.
//
// So this asserts the WRITE SIDE: the stamp is issued, and it is issued after the post.
// ═════════════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";

describe("★★ the tax figure is actually written", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const start = app.indexOf("const persistJournalEntry");
  const fn = app.slice(start, app.indexOf("const persistMultiLineEntry", start));
  const code = fn.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("★ a checked write stamps it AFTER the RPC returns", () => {
    // It cannot go in `p_meta`: the RPC discards every key outside its six named scalars.
    const post = code.indexOf('rpc("post_journal_entry"');
    const stamp = code.indexOf('label: "entryMetaStamp"');
    expect(post).toBeGreaterThan(-1);
    expect(stamp).toBeGreaterThan(post);
    expect(code).toMatch(/patch: \{ import_metadata: stamp \}/);
    expect(code).toMatch(/taxAmt2 > 0 \? \{ tax_amount: taxAmt2 \}/);
  });

  it("★ only when there IS something to stamp — an empty write would be noise on every entry", () => {
    expect(code).toMatch(/if \(newId && Object\.keys\(stamp\)\.length\)/);
  });

  it("★★ a failed stamp is SAID, not swallowed", () => {
    // The entry is correct either way, so this cannot fail silently into a mismatch the
    // accountant then has to explain. It is audited and it is on screen.
    const after = code.slice(code.indexOf('label: "entryMetaStamp"'));
    expect(after.slice(0, 900)).toMatch(/if \(!r\.ok\)/);
    expect(after.slice(0, 900)).toMatch(/logAudit\("entry_meta_stamp_failed"/);
    expect(after.slice(0, 900)).toMatch(/showNotification\(/);
  });

  it("★ and the message says what the accountant will see, not what broke", () => {
    expect(app).toMatch(/may see a sales-tax mismatch that isn't real/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE SECOND O95 VICTIM ON THE SAME PATH, AND IT IS A BROKEN PROMISE TO THE USER.
//
// An entry dated into a signed month offers three choices; one is "record it in the current
// month instead", and the confirmation says **"the original date is kept on file"**.
// `rebookedIntoOpenMonth` duly builds `original_date` — onto the invoice object, which
// `persistJournalEntry` never forwarded into `p_meta`, and which the RPC would have dropped
// anyway. So the date was kept nowhere.
//
// ★ AND IT HAD NO READER EITHER: nothing in `src/` displayed `original_date` even in
// principle, so fixing only the write would have produced a field that is stored, correct,
// and invisible — the rule this project keeps relearning is that a write needs a named
// reader, and here BOTH were missing.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ 'the original date is kept on file' is now true", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/TransactionDetailPanel.jsx"), "utf8");
  const start = app.indexOf("const persistJournalEntry");
  const code = app.slice(start, app.indexOf("const persistMultiLineEntry", start))
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("★ the invoice's own metadata is carried into the stamp", () => {
    expect(code).toMatch(/const carried = \(invoice && invoice\.import_metadata\) \|\| \{\}/);
    expect(code).toMatch(/carried\.original_date \? \{ original_date: carried\.original_date \}/);
    expect(code).toMatch(/carried\.rebooked_from_signed_period/);
  });

  it("★★ nothing is added to `p_meta` any more — that is where these went to die", () => {
    // A key placed in p_meta is written NOWHERE, and the comment describing it becomes a
    // description of an intention. Both fields now travel by the checked update instead.
    const meta = code.slice(code.indexOf("const meta = {"), code.indexOf("rpc(\"post_journal_entry\""));
    expect(meta).not.toMatch(/tax_amount/);
    expect(meta).not.toMatch(/original_date/);
  });

  it("★ the stamp only fires when there is something to say", () => {
    expect(code).toMatch(/if \(newId && Object\.keys\(stamp\)\.length\)/);
  });

  it("★★ a failed stamp does not repeat the promise it just failed to keep", () => {
    // The old message talked only about sales tax. On the rebook path that would have left
    // the toast still claiming the date was kept — the §9 defect, inside the fix for it.
    expect(app).toMatch(/couldn't record its original date of/);
    expect(app).toMatch(/It's in the activity log, not on the entry\./);
  });

  it("★★★ AND THERE IS A READER — the panel shows it", () => {
    expect(panel).toMatch(/sel\.import_metadata\?\.original_date/);
    expect(panel).toMatch(/Originally dated /);
    expect(panel).toMatch(/moved here because that month was already signed off/);
  });
});
