import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assessWriteResult, checkedRowUpdate, checkedIdsUpdate,
  getWriteFailures, resetWriteFailures, writeFailureSentence,
} from "../src/lib/checkedWrite.js";

// ════════════════════════════════════════════════════════════════════════════
// C192 — checked writes. A PostgREST update matching ZERO rows reports no error;
// paired with an empty catch{} that made two live O84 bugs invisible (C191's
// five vanished exceptions, C189's missing payment_status). Zero rows IS a failure.
// ════════════════════════════════════════════════════════════════════════════

// Minimal supabase stub: .from().update().eq().eq().select() → { data, error }.
// Also records the built query so we can assert `.select()` was actually called.
function stubSupabase({ data = [{ id: "x" }], error = null } = {}) {
  const calls = [];
  const chain = (op) => {
    const q = {
      update(patch) { op.patch = patch; return q; },
      eq(col, val) { (op.eq = op.eq || []).push([col, String(val)]); return q; },
      in(col, vals) { op.in = [col, vals.map(String)]; return q; },
      select(cols) { op.selected = cols || "*"; return Promise.resolve({ data, error }); },
    };
    return q;
  };
  return {
    calls,
    from(table) { const op = { table }; calls.push(op); return chain(op); },
  };
}

beforeEach(() => { resetWriteFailures(); vi.spyOn(console, "error").mockImplementation(() => {}); vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("assessWriteResult — the pure core", () => {
  it("ok when there is no error and at least one row came back", () => {
    expect(assessWriteResult({ error: null, rows: [{ id: "a" }] })).toEqual({ ok: true, reason: null });
  });
  it("db_error when the driver reported an error", () => {
    expect(assessWriteResult({ error: { message: "boom" }, rows: null })).toEqual({ ok: false, reason: "db_error" });
    // an error wins even if rows somehow came back
    expect(assessWriteResult({ error: { message: "boom" }, rows: [{ id: "a" }] }).reason).toBe("db_error");
  });
  it("zero_rows when there is NO error but nothing matched (THE silent-failure class)", () => {
    expect(assessWriteResult({ error: null, rows: [] })).toEqual({ ok: false, reason: "zero_rows" });
    expect(assessWriteResult({ error: null, rows: null }).reason).toBe("zero_rows");
    expect(assessWriteResult({}).reason).toBe("zero_rows");
  });
});

describe("checkedRowUpdate", () => {
  it("succeeds and calls .select() (required for affected rows to be observable)", async () => {
    const sb = stubSupabase({ data: [{ id: "row1" }] });
    const r = await checkedRowUpdate({ supabase: sb, table: "bank_statement_lines", id: "row1", companyId: "co1", patch: { status: "excepted" }, label: "t" });
    expect(r).toEqual({ ok: true, reason: null });
    expect(sb.calls[0].selected).toBe("id");                       // ← without this, zero rows is invisible
    expect(sb.calls[0].eq).toEqual([["id", "row1"], ["company_id", "co1"]]);
    expect(getWriteFailures().count).toBe(0);
  });

  it("ZERO ROWS → not ok, counted, and loudly logged (the C191 id-seam scenario)", async () => {
    const sb = stubSupabase({ data: [] });                          // id matched nothing
    const r = await checkedRowUpdate({ supabase: sb, table: "bank_statement_lines", id: "bank_local_3", companyId: "co1", patch: { status: "excepted" }, label: "pipeline:except-line" });
    expect(r).toEqual({ ok: false, reason: "zero_rows" });
    expect(console.error).toHaveBeenCalled();
    const f = getWriteFailures();
    expect(f.count).toBe(1);
    expect(f.records[0]).toMatchObject({ label: "pipeline:except-line", table: "bank_statement_lines", id: "bank_local_3", reason: "zero_rows" });
  });

  it("db error → not ok, counted, carries the message", async () => {
    const sb = stubSupabase({ data: null, error: { message: "permission denied" } });
    const r = await checkedRowUpdate({ supabase: sb, table: "journal_entries", id: "je1", companyId: "co1", patch: { cleared: true }, label: "pipeline:clear-outstanding" });
    expect(r).toEqual({ ok: false, reason: "db_error" });
    expect(getWriteFailures().records[0]).toMatchObject({ reason: "db_error", message: "permission denied" });
  });

  it("missing args → counted failure, never throws", async () => {
    const r = await checkedRowUpdate({ supabase: null, table: "t", id: "1", companyId: "co1", patch: {}, label: "t" });
    expect(r.ok).toBe(false);
    expect(getWriteFailures().count).toBe(1);
  });

  it("a throwing driver is caught → counted, never propagates", async () => {
    const boom = { from() { throw new Error("network down"); } };
    const r = await checkedRowUpdate({ supabase: boom, table: "t", id: "1", companyId: "co1", patch: {}, label: "t" });
    expect(r).toEqual({ ok: false, reason: "db_error" });
    expect(getWriteFailures().records[0].message).toBe("network down");
  });
});

describe("checkedIdsUpdate (batch)", () => {
  it("ok when rows come back; warns (not fails) on a PARTIAL apply", async () => {
    const sb = stubSupabase({ data: [{ id: "a" }] });               // 1 of 2 ids matched
    const r = await checkedIdsUpdate({ supabase: sb, table: "journal_entries", ids: ["a", "b"], companyId: "co1", patch: { bank_account_id: "acc1" }, label: "sweep:stamp" });
    expect(r.ok).toBe(true);
    expect(console.warn).toHaveBeenCalled();                        // partial is surfaced…
    expect(getWriteFailures().count).toBe(0);                       // …but not a hard failure
    expect(sb.calls[0].selected).toBe("id");
  });
  it("zero rows → counted failure", async () => {
    const sb = stubSupabase({ data: [] });
    const r = await checkedIdsUpdate({ supabase: sb, table: "journal_entries", ids: ["a"], companyId: "co1", patch: {}, label: "sweep:stamp" });
    expect(r).toEqual({ ok: false, reason: "zero_rows" });
    expect(getWriteFailures().count).toBe(1);
  });
});

describe("failure counter + records accumulate across calls; reset clears", () => {
  it("counts every failure and keeps the records, and reset zeroes both", async () => {
    const bad = stubSupabase({ data: [] });
    await checkedRowUpdate({ supabase: bad, table: "t1", id: "1", companyId: "co1", patch: {}, label: "a" });
    await checkedRowUpdate({ supabase: bad, table: "t2", id: "2", companyId: "co1", patch: {}, label: "b" });
    const f = getWriteFailures();
    expect(f.count).toBe(2);
    expect(f.records.map((r) => r.label)).toEqual(["a", "b"]);
    resetWriteFailures();
    expect(getWriteFailures()).toEqual({ count: 0, records: [] });
  });
  it("successful writes do NOT increment the counter", async () => {
    const good = stubSupabase({ data: [{ id: "ok" }] });
    await checkedRowUpdate({ supabase: good, table: "t", id: "1", companyId: "co1", patch: {}, label: "ok" });
    expect(getWriteFailures().count).toBe(0);
  });
});

describe("writeFailureSentence — the owner-facing outcome addendum", () => {
  it("empty when nothing failed", () => {
    expect(writeFailureSentence(0)).toBe("");
    expect(writeFailureSentence()).toBe("");
  });
  it("plain-language sentence when writes failed (singular + plural)", () => {
    expect(writeFailureSentence(1)).toBe(" — 1 update didn't save; your accountant should re-run this statement");
    expect(writeFailureSentence(3)).toBe(" — 3 updates didn't save; your accountant should re-run this statement");
  });
  it("appends to a pipeline outcome line and stays jargon-free", () => {
    const outcome = "March statement handled — 13 recorded, matched to your bank ✓";
    const full = outcome + writeFailureSentence(2);
    expect(full).toContain("2 updates didn't save");
    expect(full).not.toMatch(/debit|credit|journal|GL\b|bank_statement_lines|zero_rows/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE PAYLOAD KEY IS `patch`, AND A CALLER THAT NAMES IT ANYTHING ELSE FAILS SILENTLY.
//
// `checkedRowUpdate({ ..., patch })` destructures ONE name. A caller passing `values:`
// (or `data:`, or `set:`) hands `patch === undefined` to `.update()`, the write does
// nothing, `recordFailure` fires, and the CALLER's failure branch runs — which is a branch
// nobody exercises in the happy path and which, in the O114 case, reported a completely
// different cause to the user.
//
// COST ALREADY PAID (2026-08-27): the O114 attach passed `values:` where the helper takes
// `patch:`. Every attach on the re-drive failed, all three cards blamed a phantom "more
// than one payment of that amount", and the drive could not be diagnosed from its own
// output — author and operator both spent a session hunting a candidate-counting bug that
// did not exist. ONE misnamed key, and 13 of 14 call sites had it right.
//
// This is the cheap, mechanical check that would have caught it in the commit that
// introduced it, and it lives HERE — with the helper — because that is where someone
// doubting the calling convention will look.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ every checked-write call site names its payload `patch`", () => {
  const SRC = "src";
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? walk(full) : (/\.(js|jsx)$/.test(d.name) ? [full] : []);
  });

  it("★ no call passes `values:` / `data:` / `set:` instead of `patch:`", () => {
    const offenders = [];
    for (const file of walk(path.join(process.cwd(), SRC))) {
      const src = fs.readFileSync(file, "utf8");
      // Scan the argument object of each checked-write call: from the call to its
      // matching `});`. Comments are stripped first — three guards in this project have
      // tripped on their own prose.
      const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      // `function checkedRowUpdate({...})` is the DEFINITION, not a call — exclude it, or
      // the guard flags the very contract it is protecting.
      const re = /(?<!function\s)checked(?:RowUpdate|IdsUpdate)\(\{/g;
      let m;
      while ((m = re.exec(code))) {
        const chunk = code.slice(m.index, m.index + 900);
        const end = chunk.indexOf("});");
        const args = end > -1 ? chunk.slice(0, end) : chunk;
        // `patch` may be passed as ES6 SHORTHAND (`patch,`) as well as `patch:` — two live
        // call sites do, and a guard that rejected valid JS would be worse than none.
        if (/\b(values|data|set)\s*:/.test(args) || !/\bpatch\s*[,:}]/.test(args)) {
          offenders.push(`${path.relative(process.cwd(), file)} :: ${args.slice(0, 120).replace(/\s+/g, " ")}`);
        }
      }
    }
    expect(offenders, `checked-write call sites not naming their payload \`patch\`:\n${offenders.join("\n")}`)
      .toEqual([]);
  });

  it("the scan is not vacuous — it finds the real call sites", () => {
    let n = 0;
    for (const file of walk(path.join(process.cwd(), SRC))) {
      n += (fs.readFileSync(file, "utf8").match(/checked(?:RowUpdate|IdsUpdate)\(\{/g) || []).length;
    }
    expect(n).toBeGreaterThanOrEqual(10);   // 14 at the time of writing
  });

  it("★ and the helper still destructures exactly `patch` — the guard tracks the contract", () => {
    // If the helper is ever renamed to accept `values`, this guard must move with it
    // rather than silently pass while every caller is wrong in the other direction.
    const helper = fs.readFileSync(path.join(process.cwd(), "src/lib/checkedWrite.js"), "utf8");
    expect(helper).toMatch(/export async function checkedRowUpdate\(\{[^}]*\bpatch\b/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE UNDO BUTTONS — the mirror of the delete bug, in the same function.
//
// `softDeleteInvoices` was hardened yesterday (O124(c)): it checks whether the delete
// landed, restores the optimistically-removed rows when it did not, and says so. **The
// Undo handler ten lines below it did none of that** — it wrote, ignored the result, put
// the rows back in local state and said "Restored ✓".
//
// A failed undo is INVISIBLE by construction: local state puts the rows back on screen
// whether or not the database agreed, so success and failure render identically until the
// next reload takes them away again. That is the §9 pair at once — an invisible action, and
// a sentence composed alongside the work instead of read from it.
//
// ★ `078` MOVED THIS FROM THEORETICAL TO REACHABLE: the database now refuses to clear
// `deleted_at` inside a signed month.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ an Undo may not claim success it has not checked", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("restoreJournalEntries goes through a checked write and RETURNS the verdict", () => {
    const fn = strip(app.slice(app.indexOf("const restoreJournalEntries"), app.indexOf("const deleteJournalEntry")));
    expect(fn).toMatch(/checkedIdsUpdate\(/);
    expect(fn).toMatch(/return !!r\.ok/);
    expect(fn).not.toMatch(/\.update\(\{ deleted_at: null/);   // no raw unchecked update left
  });

  it("★★ the invoice Undo GATES on it — and writes BEFORE touching the screen", () => {
    const undo = strip(app.slice(app.indexOf("Deleted ${label} — tap Undo to restore"), app.indexOf("const softDeleteInvoice =")));
    const write = undo.indexOf("await restoreJournalEntries(allIds)");
    const paint = undo.indexOf("setInvoices(prev");
    const claim = undo.indexOf('showNotification("Restored ✓")');
    expect(write).toBeGreaterThan(-1);
    expect(write).toBeLessThan(paint);          // the screen follows the database, not the click
    expect(undo).toMatch(/if \(!ok\) \{/);
    expect(undo.indexOf("if (!ok)")).toBeLessThan(claim);
  });

  it("★ a refused Undo says what is still true, and names the likely cause", () => {
    const undo = app.slice(app.indexOf("Deleted ${label} — tap Undo to restore"), app.indexOf("const softDeleteInvoice ="));
    expect(undo).toMatch(/Couldn't undo that/);
    expect(undo).toMatch(/is still deleted/);            // the state of the world, not "an error occurred"
    expect(undo).toMatch(/signed off/);                  // the reason a person can act on
    expect(undo).toMatch(/invoice_restore_failed/);      // and it is audited, not only toasted
  });

  it("★ the contracts Undo has the same shape — one fix, not one instance", () => {
    const undo = strip(app.slice(app.indexOf("Deleted ${label} — tap Undo to restore", app.indexOf("softDeleteContracts"))));
    const head = undo.slice(0, 1400);
    // ★ ASSERT THE VERDICT IS CONSUMED, NOT MERELY THAT THE CALL APPEARS. The first version
    // of this test matched `checkedIdsUpdate(` and survived a mutation that left the call
    // in place behind `if (false)` — a checked write whose answer nobody reads is exactly
    // the unchecked write it replaced, and a source scan cannot see reachability. Pinning
    // the CONSUMPTION is what makes it a real assertion.
    expect(head).toMatch(/const r = await checkedIdsUpdate\(/);
    expect(head).toMatch(/if \(!r\.ok\) \{/);
    expect(head.indexOf("checkedIdsUpdate(")).toBeLessThan(head.indexOf("setContracts(prev"));
    expect(head).toMatch(/Couldn't undo that/);
    // and no raw un-checked restore loop survives alongside it
    expect(head).not.toMatch(/\.update\(\{ deleted_at: null/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE AUDIT TRAIL MAY NOT RECORD AN INTENTION AS AN EVENT.
//
// `softDeleteInvoices` wrote its `invoice_deleted` audit rows BEFORE attempting the write.
// A refused delete therefore left `Deleted: Roma $551.20` permanently in the audit trail,
// beside the `invoice_delete_failed` row contradicting it. The audit trail is the one
// record an accountant is entitled to trust, and it was being told what we INTENDED.
//
// The second defect is its sibling: `allIds.length` is a BATCH-level test, so five entries
// with two refused reported "Deleted 5 entries ✓" while those two sat removed from the
// screen and present in the books. Books pre-splits signed months; the AI chat path does
// not — the caller with nobody checking its work.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ a delete is audited and described from what was written", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const fn = app.slice(app.indexOf("const softDeleteInvoices"), app.indexOf("const softDeleteInvoice ="));
  const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");
  const code = strip(fn);

  it("★★ the audit row is written AFTER the write, not before it", () => {
    const write = code.indexOf("await softDeleteJournalEntry(items[i])");
    const audit = code.indexOf('logAudit("invoice_deleted"');
    expect(write).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(write);
  });

  it("★ and only for entries that actually went", () => {
    // Auditing `snaps` would record every attempt; auditing `gone` records the outcome.
    expect(code).toMatch(/const gone = results\.filter\(r => r\.ids\.length\)/);
    expect(code).toMatch(/gone\.forEach\(\(\{ snap: s \}\) => logAudit\("invoice_deleted"/);
    expect(code).not.toMatch(/snaps\.forEach\(s => logAudit\("invoice_deleted"/);
  });

  it("★★ a PARTIAL refusal is reported as partial, with a count of each side", () => {
    expect(code).toMatch(/const kept = results\.filter\(r => !r\.ids\.length\)/);
    expect(code).toMatch(/Deleted \$\{gone\.length\} of \$\{items\.length\}/);
    expect(code).toMatch(/\$\{kept\.length\} left in your books/);
  });

  it("★ the refused rows go back on screen — they were removed optimistically", () => {
    // Without this they vanish from the list while remaining in the books, and the next
    // reload resurrects them: the worst order in which to learn it.
    // ★★ PINS THE FIRST STATEMENT OF THE BLOCK, NOT THE PRESENCE OF A CALL. The first
    // version matched `setInvoices(prev =>` anywhere in the block and SURVIVED a mutation
    // that wrapped it in `if (false)` — the second time today a source scan proved unable
    // to see reachability (the contracts Undo was the first). Asserting what the block
    // BEGINS with kills that: a guarded call no longer starts it.
    const body = code.slice(code.indexOf("if (kept.length) {") + "if (kept.length) {".length);
    expect(body.trimStart().startsWith("setInvoices(prev =>")).toBe(true);
    expect(body.slice(0, 700)).toMatch(/logAudit\("invoice_delete_failed"/);
  });

  it("★ the success sentence counts what was written, never what was asked for", () => {
    // §9: every clause names a field of the outcome. `items.length` is the request.
    const claim = code.slice(code.indexOf("const doneLabel"), code.indexOf("showNotification(doneLabel"));
    expect(claim).toMatch(/gone\.length/);
    expect(claim).toMatch(/kept\.length/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ O17 — A PAYMENT POSTS IN TWO STEPS, AND THE THING THAT MAKES THAT SAFE WAS UNCHECKED.
//
// `markBillPaid` posts the GL movement (Dr A/P · Cr Cash) and THEN flips the paid flag. If
// the second step fails, a compensating reversal removes the movement — that reversal is
// the entire safety property. It was an unchecked `.update()` inside a `console.warn`
// catch, and PostgREST reports no error for an update that matched nothing (C192), so "it
// didn't throw" was never evidence it worked.
//
// ★★★ AND THE COPY MATTERED AS MUCH AS THE WRITE. The generic "please try again" invited a
// SECOND payment on top of an orphaned movement — the O123 shape, in money instead of
// reversals. A failure that cannot be retried must not be described as one.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ the payment compensation is checked, and says what it left behind", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const start = app.indexOf("let postedPaymentId = null;");
  const fn = app.slice(start, app.indexOf("if (!dbId) return await fail", start));
  const code = fn.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

  it("★ the reversal goes through a checked write and its verdict is consumed", () => {
    expect(code).toMatch(/const c = await checkedRowUpdate\(\{/);
    expect(code).toMatch(/compensationFailed = !c\.ok/);
    expect(code).not.toMatch(/console\.warn\("\[markBillPaid\] compensation/);
  });

  it("★★ a failed compensation is audited AND sent to Sentry — it is a money-state break", () => {
    expect(code).toMatch(/logAudit\("payment_compensation_failed"/);
    expect(code).toMatch(/payment_compensation_failure/);
  });

  it("★★★ and it does NOT tell the user to try again", () => {
    // Retrying would post a second payment movement on top of the orphan.
    const msg = code.slice(code.indexOf("showNotification(compensationFailed"));
    expect(msg.slice(0, 500)).toMatch(/Don't try again/);
    expect(msg.slice(0, 500)).toMatch(/send this to your accountant/);
    // the ordinary failure keeps its retry wording — the two paths are genuinely different
    expect(msg.slice(0, 500)).toMatch(/Couldn't save the payment — please try again/);
  });

  it("★ the sentence describes the state of the books, not the error", () => {
    expect(app).toMatch(/recorded the money leaving but couldn't finish marking/);
  });
});
