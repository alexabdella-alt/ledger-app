import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  payrollEntryForImport, payrollImportMetadata, payrollHistoryFromLedger,
  payrollAutoPostGate, registerFromParsedPayroll, PAYROLL_GATE,
} from "../src/lib/payroll.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";
import { checkedRowUpdate, resetWriteFailures, getWriteFailures } from "../src/lib/checkedWrite.js";
import { planPayrollBankLines } from "../src/lib/payroll.js";

// ═════════════════════════════════════════════════════════════════════════════
// C198·3c (i) — THE ROUND-TRIP TEST THAT WOULD HAVE CAUGHT AN INERT GATE.
//
// O87: the C198·3a auto-post gate was STRUCTURALLY INERT from the day it shipped.
// `payrollHistoryFromLedger` selects on `import_metadata.kind === 'payroll'`; no
// payroll entry has ever carried `import_metadata`; so history was always empty, so
// condition 5 (within-norms) failed for every company, forever. Both July registers
// correctly fell to the confirm card — the gate failed CLOSED, which is the mercy —
// and a green suite could not tell "the gate never fires" apart from "the gate had
// nothing to do".
//
// WHY THE ·3a SUITE PASSED (the C195(7) lesson in test form): it fed the gate
// SYNTHETIC history shaped to match what the extractor reads. Extractor and fixture
// agreed with each other while neither agreed with the database. There was no
// round-trip — post → read back → extract → gate — asserting that THE POSTER'S OWN
// OUTPUT IS READABLE BY THE CONSUMER. Treat "both sides of a contract tested against
// the same fixture" as a test smell wherever it appears.
//
// So this file builds no history by hand. It runs the real builder, through a fake
// database that reproduces the RPC's actual behaviour, through the real flattener,
// into the real consumer, into the real gate.
//
// ★★ WHAT THIS FILE CANNOT COVER — AND WHO OWNS IT ★★
// This is a CLIENT-CONTRACT test. It proves the client issues the right write with
// the right shape and reads its own output back correctly. It CANNOT prove the write
// LANDS, because the bug lived on the far side of the very boundary this test stops
// at: `post_journal_entry` (migrations 010 / 036) silently discards every p_meta key
// it has no column for, and no unit test can cross the PostgREST/Postgres boundary to
// notice. The fake RPC below encodes today's understanding of that behaviour — if the
// real function changes, this file keeps passing while production breaks again.
// THE DB BOUNDARY IS OWNED BY THE DRIVE SCRIPT: ROADMAP §0 TIER 1 #12 carries a LIVE
// check — after the first August register posts, SQL-verify `import_metadata IS NOT
// NULL` on the new JE. That is not belt-and-braces; unit tests being unable to cross
// this boundary is *precisely* how the gate shipped inert for a whole release.
// ═════════════════════════════════════════════════════════════════════════════

// A Gusto register as PayrollView assembles one (importRecord, PayrollView.jsx).
const registerImport = ({ periodStart, periodEnd, payDate, gross, net, employerTaxes = 306, intakeId }) => ({
  _intakeId: intakeId,
  source: "Gusto",
  period: `${periodStart} – ${periodEnd}`,
  period_start: periodStart, period_end: periodEnd, pay_date: payDate,
  total_gross: gross, total_net: net, total_withholdings: gross - net, total_employer_taxes: employerTaxes,
});

// The parsed AI payload the same register arrives as (what the gate is handed).
const parsedFrom = (imp) => ({
  period_start: imp.period_start, period_end: imp.period_end, pay_date: imp.pay_date,
  total_gross: imp.total_gross, total_net: imp.total_net,
  total_deductions: imp.total_withholdings, total_employer_taxes: imp.total_employer_taxes,
});

const CODES = { salariesCode: "6000", payrollTaxExpCode: "6010", cashCode: "1000", payrollTaxesPayableCode: "2101" };
const CHART = [
  { code: "6000", name: "Salaries & Wages", category: "Expenses" },
  { code: "6010", name: "Payroll Tax Expense", category: "Expenses" },
  { code: "1000", name: "Cash", category: "Assets" },
  { code: "2101", name: "Payroll Taxes Payable", category: "Liabilities" },
];

// ── The fake database ────────────────────────────────────────────────────────
// `postJournalEntry` reproduces THE ACTUAL RPC (migrations 010 / 036): it inserts the
// six named scalars it cherry-picks out of p_meta and NOTHING ELSE. `import_metadata`
// is not among them, so a freshly posted entry has it NULL. That is the whole bug,
// encoded — which is what makes the assertions below load-bearing rather than
// self-fulfilling. Remove the stamp and these tests go red.
const RPC_META_KEYS = ["ai_reasoning", "ai_confidence", "approval_status", "payment_status", "payment_method", "due_date"];

function makeDb() {
  const rows = new Map();
  let n = 0;
  const updates = [];   // every `.update()` the client issued, in order
  return {
    rows, updates,
    postJournalEntry(entry, { companyId = "co1" } = {}) {
      const id = `je_${++n}`;
      const meta = entry.meta || {};
      const row = {
        id, company_id: companyId, entry_date: entry.date, description: entry.description,
        source: entry.source, status: "posted",
        import_metadata: null,                                   // ← the RPC never writes it
        journal_entry_lines: (entry.lines || []).map((l) => ({
          debit: l.debit, credit: l.credit,
          accounts: { code: l.code, name: (CHART.find((c) => c.code === l.code) || {}).name },
        })),
      };
      for (const k of RPC_META_KEYS) if (meta[k] != null) row[k] = meta[k];
      rows.set(id, row);
      return id;
    },
    // A minimal PostgREST double: `.update(patch).eq(id).eq(company_id).select("id")`
    // returns the affected rows, which is exactly what checkedRowUpdate needs to tell a
    // zero-row no-op from a real write.
    from(table) {
      const q = { _table: table, _patch: null, _filters: {} };
      q.update = (patch) => { q._patch = patch; return q; };
      q.eq = (col, val) => { q._filters[col] = String(val); return q; };
      q.select = () => {
        updates.push({ table: q._table, patch: q._patch, filters: { ...q._filters } });
        if (q._table !== "journal_entries") return Promise.resolve({ data: [], error: null });
        const row = rows.get(q._filters.id);
        if (!row || String(row.company_id) !== q._filters.company_id) return Promise.resolve({ data: [], error: null });
        Object.assign(row, q._patch);
        return Promise.resolve({ data: [{ id: row.id }], error: null });
      };
      return q;
    },
  };
}

// The exact sequence PayrollView.postPayroll runs: build → post → stamp.
async function postAndStamp(db, imp, { companyId = "co1" } = {}) {
  const je = payrollEntryForImport(imp, CODES);
  expect(je && je.balanced, "the register must build a balanced entry").toBe(true);
  const jeId = db.postJournalEntry(je, { companyId });
  const res = await checkedRowUpdate({
    supabase: db, table: "journal_entries", id: jeId, companyId,
    patch: { import_metadata: payrollImportMetadata(imp) },
    label: "payroll:stamp-import-metadata",
  });
  return { jeId, res };
}

const ledgerOf = (db) => flattenJournalEntries([...db.rows.values()], CHART);

// Franklin Ave's shape: a flat $4,000-gross biweekly Gusto run.
const JUNE = registerImport({ periodStart: "2026-06-01", periodEnd: "2026-06-14", payDate: "2026-06-19", gross: 4000, net: 3100, intakeId: "intake-june" });
const JULY = registerImport({ periodStart: "2026-07-01", periodEnd: "2026-07-14", payDate: "2026-07-17", gross: 4000, net: 3100, intakeId: "intake-july" });

describe("(i) the stamp SHAPE — payrollImportMetadata", () => {
  it("carries exactly the keys the gate and the matcher read back", () => {
    expect(payrollImportMetadata(JUNE)).toEqual({
      kind: "payroll",
      gross: 4000,
      net: 3100,
      pay_date: "2026-06-19",
      period_start: "2026-06-01",
      period_end: "2026-06-14",
      register_import_id: "intake-june",
    });
  });

  it("kind is 'payroll' — the single key every downstream reader selects on", () => {
    expect(payrollImportMetadata({}).kind).toBe("payroll");
  });

  it("a malformed register stamps nulls, never zeroes or garbage dates", () => {
    // Number(null) is 0 and a 0 gross would silently poison the trailing average.
    expect(payrollImportMetadata({ total_gross: null, total_net: "", pay_date: "not a date", period_start: "07/01/2026" }))
      .toMatchObject({ gross: null, net: null, pay_date: null, period_start: null, period_end: null, register_import_id: null });
  });

  it("register_import_id is the DURABLE intake row id, not the in-session record id", () => {
    // PayrollView's importRecord.id is Date.now()+Math.random() — meaningless after a
    // reload. `_intakeId` is the document_intake uuid, which survives.
    expect(payrollImportMetadata({ _intakeId: "b1e0…", id: 1754812345678.9 }).register_import_id).toBe("b1e0…");
  });
});

describe("(i) THE ROUND TRIP — post → stamp → read back → extract → gate", () => {
  let db;
  beforeEach(() => { db = makeDb(); resetWriteFailures(); });

  it("the RPC alone leaves import_metadata NULL — the bug, reproduced", async () => {
    const je = payrollEntryForImport(JUNE, CODES);
    // The builder DOES hand the RPC kind/gross/net/withholdings — none of it survives.
    expect(je.meta).toMatchObject({ kind: "payroll", gross: 4000, net: 3100 });
    const id = db.postJournalEntry(je);
    expect(db.rows.get(id).import_metadata).toBe(null);
    expect(db.rows.get(id).payment_status).toBe("paid");      // a key the RPC DOES have a column for
    // …and therefore the consumer sees nothing.
    expect(payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" })).toEqual([]);
  });

  it("the follow-up checked update is issued, targets the new entry, and lands", async () => {
    const { jeId, res } = await postAndStamp(db, JUNE);
    expect(res.ok).toBe(true);
    expect(getWriteFailures().count).toBe(0);
    const [u] = db.updates;
    expect(u.table).toBe("journal_entries");
    expect(u.filters).toEqual({ id: jeId, company_id: "co1" });
    expect(u.patch).toEqual({ import_metadata: payrollImportMetadata(JUNE) });
  });

  it("the stamped entry reads back through the REAL flattener with its metadata intact", async () => {
    await postAndStamp(db, JUNE);
    const ledger = ledgerOf(db);
    expect(ledger.length).toBeGreaterThan(1);                                  // multi-line: one row per leg
    expect(ledger.every((r) => r.import_metadata?.kind === "payroll")).toBe(true);
  });

  it("payrollHistoryFromLedger finds the run — ONE entry, gross from the stamp", async () => {
    await postAndStamp(db, JUNE);
    const history = payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" });
    expect(history).toEqual([{ id: "je_1", date: "2026-06-19", gross: 4000 }]);   // deduped across the 4 legs
  });

  it("★ CONDITION 5 PASSES ON THE SECOND REGISTER — the gate is no longer inert", async () => {
    // First register: no priors FOUND, so it is held for a person. That is correct.
    const first = payrollAutoPostGate(registerFromParsedPayroll(parsedFrom(JUNE)), payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" }));
    expect(first.pass).toBe(false);
    expect(first.reasons.map((r) => r.code)).toEqual([PAYROLL_GATE.NORM]);

    // A human confirms it — post + stamp.
    await postAndStamp(db, JUNE);

    // Second register, same shape. The norm now exists BECAUSE the first one was
    // stamped, so the gate fires. This is the assertion the whole commit exists for.
    const history = payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" });
    expect(history).toHaveLength(1);
    const second = payrollAutoPostGate(registerFromParsedPayroll(parsedFrom(JULY)), history);
    expect(second.reasons).toEqual([]);
    expect(second.pass).toBe(true);
  });

  it("WITHOUT the stamp the same second register is still held — the test can fail", async () => {
    // Post the first run through the RPC only (no follow-up update): exactly the
    // pre-·3c code path. If the round trip above were self-fulfilling, this would pass.
    db.postJournalEntry(payrollEntryForImport(JUNE, CODES));
    const g = payrollAutoPostGate(registerFromParsedPayroll(parsedFrom(JULY)), payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" }));
    expect(g.pass).toBe(false);
    expect(g.reasons[0].code).toBe(PAYROLL_GATE.NORM);
  });

  it("the norm is the TRAILING AVERAGE of everything stamped, not just the last run", async () => {
    await postAndStamp(db, registerImport({ periodStart: "2026-05-01", periodEnd: "2026-05-14", payDate: "2026-05-19", gross: 3800, net: 2950, intakeId: "i1" }));
    await postAndStamp(db, registerImport({ periodStart: "2026-05-15", periodEnd: "2026-05-31", payDate: "2026-06-03", gross: 4200, net: 3260, intakeId: "i2" }));
    const history = payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" });
    expect(history.map((h) => h.gross)).toEqual([3800, 4200]);                 // oldest → newest
    // Average 4,000; a 4,000 run is inside tolerance, a 9,000 run is not.
    expect(payrollAutoPostGate(registerFromParsedPayroll(parsedFrom(JULY)), history).pass).toBe(true);
    const wild = registerImport({ periodStart: "2026-07-01", periodEnd: "2026-07-14", payDate: "2026-07-17", gross: 9000, net: 6900, intakeId: "i3" });
    const g = payrollAutoPostGate(registerFromParsedPayroll(parsedFrom(wild)), history);
    expect(g.pass).toBe(false);
    expect(g.reasons[0].code).toBe(PAYROLL_GATE.NORM);
  });

  it("a stamp that matches ZERO rows is a LOUD failure, not a silent no-op", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const je = payrollEntryForImport(JUNE, CODES);
    const jeId = db.postJournalEntry(je, { companyId: "co1" });
    // Wrong company — the RLS-shaped filter matches nothing, and PostgREST reports no error.
    const res = await checkedRowUpdate({ supabase: db, table: "journal_entries", id: jeId, companyId: "co2", patch: { import_metadata: payrollImportMetadata(JUNE) }, label: "payroll:stamp-import-metadata" });
    expect(res).toEqual({ ok: false, reason: "zero_rows" });
    expect(getWriteFailures().count).toBe(1);
    expect(err).toHaveBeenCalled();
    // And the honest consequence: no history, so the next register is HELD, not auto-posted.
    expect(payrollHistoryFromLedger(ledgerOf(db), { salariesCode: "6000" })).toEqual([]);
    err.mockRestore();
  });

  it("the stamp does not disturb what the RPC already wrote (payment_status stays 'paid')", async () => {
    const { jeId } = await postAndStamp(db, JUNE);
    expect(db.rows.get(jeId).payment_status).toBe("paid");                     // C189's ap_tie guard
    expect(ledgerOf(db).every((r) => r.payment_status === "paid")).toBe(true);
  });

  it("a voided run never contributes a norm, stamped or not", async () => {
    const { jeId } = await postAndStamp(db, JUNE);
    db.rows.get(jeId).status = "voided";
    const ledger = ledgerOf(db).map((r) => ({ ...r, status: "voided" }));      // flatten hardcodes 'booked'
    expect(payrollHistoryFromLedger(ledger, { salariesCode: "6000" })).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// THE CALL SITE ITSELF. `postAndStamp` above re-implements postPayroll's write, so on
// its own it is a contract with a copy of itself — change the real call site's table,
// id or key and every test above stays green. These read the SOURCE, the way
// payrollAutoPostGate.test.js pins "auto-post must not grow a parallel posting path".
// Crude, and the only thing standing between the round trip and a false negative.
// ─────────────────────────────────────────────────────────────────────────────
describe("(i) the REAL call site issues the stamp the round trip assumes", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/PayrollView.jsx"), "utf8");
  const post = src.slice(src.indexOf("const postPayroll ="), src.indexOf("return (", src.indexOf("const postPayroll =")));

  it("stamps journal_entries with payrollImportMetadata, through a CHECKED write", () => {
    expect(post).toMatch(/checkedRowUpdate\(/);
    expect(post).toMatch(/table:\s*"journal_entries"/);
    expect(post).toMatch(/import_metadata:\s*payrollImportMetadata\(imp\)/);
    expect(post).toMatch(/id:\s*jeId/);
    expect(post).toMatch(/companyId:\s*currentCompany\?\.id/);
    // A bare .update() here is the C192 silent-write class this whole column exists in.
    expect(post).not.toMatch(/\.update\(\s*\{\s*import_metadata/);
  });

  it("stamps AFTER the post and BEFORE the reload — otherwise the ledger reloads without it", () => {
    const post_i = post.indexOf("persistMultiLineEntry");
    const stamp_i = post.indexOf("checkedRowUpdate");
    const load_i = post.indexOf("await loadAllData()");   // the call, not the comment about it
    expect(post_i).toBeGreaterThan(-1);
    expect(stamp_i).toBeGreaterThan(post_i);
    expect(load_i).toBeGreaterThan(stamp_i);
  });

  it("a failed stamp is BOTH audited and said out loud — never a silent success line", () => {
    expect(post).toMatch(/stampRes\.ok/);
    expect(post).toMatch(/payroll_history_stamp_failed/);
    // The outcome the operator reads carries the failure; C198·2b's "Done" over unfinished
    // work is the precedent for why an audit row alone is not enough.
    const notify = post.slice(post.indexOf("showNotification((auto"));
    expect(notify).toMatch(/stampRes\.ok\s*\?/);
  });

  // The post loop inside autoPostDepreciation — everything between the function and the
  // fully_depreciated flip.
  const depreciationPostBlock = () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    const start = app.indexOf("const autoPostDepreciation =");
    expect(start).toBeGreaterThan(-1);
    return app.slice(start, app.indexOf("for (const assetId of assetsToFlip)", start));
  };

  it("depreciation — the other genuinely-inert import_metadata reader — is stamped too", () => {
    const block = depreciationPostBlock();
    expect(block).toMatch(/checkedRowUpdate\(\{[^}]*table: "journal_entries"/s);
    expect(block).toMatch(/kind: "depreciation", asset_id: row\.asset_id, period: row\.period_index/);
  });

  it("(D3) and its schedule flag write is CHECKED — a zero-row flag write re-posts the period", () => {
    // §9: this was a row-targeted `.update()` with no `.select()` inside a `catch`.
    // PostgREST reports NO ERROR for an update that matched nothing, so that catch never
    // fired: the row stayed 'pending' with its GL entry committed, and the next session
    // posted the same asset-period again. That is the double-post sequence, in full.
    const block = depreciationPostBlock();
    expect(block).toMatch(/checkedRowUpdate\(\{[^}]*table: "depreciation_schedule"/s);
    expect(block).toMatch(/label: "depreciation:schedule-flag"/);
    expect(block).toMatch(/depreciation_flag_write_failed/);     // audited, not swallowed
    expect(block).not.toMatch(/from\("depreciation_schedule"\)\s*\.update\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLAST RADIUS — stamping `kind:'payroll'` wakes EVERY reader of that key, not just
// the gate. `matchPayrollBankLine` is the one with teeth: a match SUPPRESSES the bank
// line (no re-book), so a false positive removes a real cash movement from the books.
// ─────────────────────────────────────────────────────────────────────────────
describe("(i) blast radius — the payroll bank-line matcher, now that it can fire", () => {
  let db;
  beforeEach(async () => { db = makeDb(); resetWriteFailures(); await postAndStamp(db, JUNE); });

  const line = (over) => ({ id: "b1", vendor: "GUSTO", description: "GUSTO PAYROLL", date: "2026-06-19", amount: -3100, ...over });

  it("the NET-pay line matches its register and is suppressed — the O72 feature, live", () => {
    const plan = planPayrollBankLines([line()], ledgerOf(db));
    expect(plan.matched).toHaveLength(1);
    expect(plan.incomplete).toHaveLength(0);
  });

  it("★ a SEPARATE tax-remittance ACH is NOT swallowed as the same disbursement", () => {
    // Gusto commonly drafts net pay and the tax remittance as two ACHs. The register's
    // other legs are gross 4,000, employer 306 and withholdings+employer 1,206 — every
    // one of them a leg amount the matcher would have accepted before it required a
    // STATED net. A match here would suppress a real outflow: cash never credited,
    // Payroll Taxes Payable never relieved, books short by the remittance.
    for (const amt of [-4000, -306, -1206]) {
      const plan = planPayrollBankLines([line({ description: "GUSTO TAX COLLECTION", amount: amt })], ledgerOf(db));
      expect(plan.matched, `amount ${amt} must not match the register`).toHaveLength(0);
      expect(plan.incomplete).toHaveLength(1);          // booked + flagged, never silently gone
    }
  });

  it("a register with no STATED net matches nothing — no falling through to a leg amount", () => {
    // The backfill shape: {kind:'payroll', gross} and nothing else. It feeds the NORM,
    // which is its whole purpose; it must not also start suppressing bank lines.
    const backfilled = ledgerOf(db).map((r) => ({ ...r, import_metadata: { kind: "payroll", gross: 4000 } }));
    for (const amt of [-3100, -4000]) {
      expect(planPayrollBankLines([line({ amount: amt })], backfilled).matched).toHaveLength(0);
    }
  });

  it("a non-payroll bank line is untouched by any of this", () => {
    const plan = planPayrollBankLines([line({ vendor: "Sysco", description: "SYSCO FOODS", amount: -3100 })], ledgerOf(db));
    expect(plan.rest).toHaveLength(1);
    expect(plan.matched).toHaveLength(0);
  });

  it("two pay runs, two net lines — one register each, never the same one twice", async () => {
    await postAndStamp(db, JULY);
    const plan = planPayrollBankLines(
      [line({ id: "b1", date: "2026-06-19", amount: -3100 }), line({ id: "b2", date: "2026-07-17", amount: -3100 })],
      ledgerOf(db),
    );
    expect(plan.matched).toHaveLength(2);
    expect(new Set(plan.matched.map((m) => String(m.matchId))).size).toBe(2);
  });
});
