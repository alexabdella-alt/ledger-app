// ─────────────────────────────────────────────────────────────────────────────
// Payroll (#13) — deterministic builder (the AI only EXTRACTS totals; the entry is
// built by code), posted through the canonical multi-line write path.
//
// Standard "already-disbursed" run (net pay → Cash):
//   Dr Salaries & Wages (gross)
//   Dr Payroll Tax Expense (employer payroll taxes)
//   Cr Cash (net pay = gross − employee withholdings)
//   Cr Payroll Taxes Payable (employee withholdings + employer taxes)
//
// Balance identity: debits = gross + employer; credits = net + (withholdings +
// employer) = (gross − withholdings) + withholdings + employer = gross + employer. ✓
//
// Accounts are passed in as CODES — the caller resolves them by ROLE
// (salaries_wages, payroll_tax, cash, payroll_taxes_payable), so this works whether
// a company's Payroll Tax Expense is 6010 or a legacy 5101.
//
// Variant deferred (CLAUDE.md §11): accrue-then-pay two-step. This is the common case.
// ─────────────────────────────────────────────────────────────────────────────

import { buildJournalEntry } from "./journalEntries.js";
import { containsOwnerJargon } from "./clarify.js";
import { fmtMoney } from "./format.js";

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Provide `employeeWithholdings` OR `netPay` (withholdings = gross − net). Returns a
// balanced buildJournalEntry result, or null on invalid inputs.
export function buildPayrollEntry({
  gross, employerTaxes = 0, employeeWithholdings = null, netPay = null,
  salariesCode, payrollTaxExpCode, cashCode, payrollTaxesPayableCode,
  date = null, description = "Payroll", memo = null, meta = null,
} = {}) {
  const g = r2(gross);
  const emp = r2(employerTaxes);
  if (!(g > 0) || !salariesCode || !cashCode) return null;
  if (emp < 0) return null;

  const wh = employeeWithholdings != null ? r2(employeeWithholdings)
           : netPay != null ? r2(g - r2(netPay))
           : 0;
  if (wh < 0 || wh > g) return null;                 // net pay can't be negative or exceed gross

  const net = r2(g - wh);
  const payable = r2(wh + emp);
  if (emp > 0 && !payrollTaxExpCode) return null;     // employer tax needs its expense account
  if (payable > 0 && !payrollTaxesPayableCode) return null;

  const lines = [{ code: salariesCode, debit: g, credit: 0 }];                       // Dr Salaries & Wages (gross)
  if (emp > 0) lines.push({ code: payrollTaxExpCode, debit: emp, credit: 0 });       // Dr Payroll Tax Expense (employer)
  if (net > 0) lines.push({ code: cashCode, debit: 0, credit: net });                // Cr Cash (net pay)
  if (payable > 0) lines.push({ code: payrollTaxesPayableCode, debit: 0, credit: payable }); // Cr Payroll Taxes Payable

  return buildJournalEntry({
    lines, date, source: "payroll", description, memo,
    // The caller's meta (kind/source/period/payment_status) FIRST, then the figures
    // derived from the lines actually being posted — so the metadata can never
    // describe a different run than the entry does. C198·3a made this load-bearing:
    // `gross` is the trailing-average input for the next run's norm check, and `net`
    // is what matchPayrollBankLine compares a bank net-pay line against (it used to
    // fall through to the flattened row's own amount, which only lined up because
    // the Cr Cash row happens to carry net).
    meta: { ...(meta || { kind: "payroll" }), gross: g, net, withholdings: wh, employer_taxes: emp },
  });
}

// The SINGLE entry builder for a parsed register — shared by the confirm-card
// preview, the manual Post button, and the C198·3a auto-post. One function is the
// point: auto-post writes the IDENTICAL journal entry the human path writes, and
// cannot drift into a parallel posting implementation.
export function payrollEntryForImport(imp = {}, codes = {}) {
  return buildPayrollEntry({
    gross: Number(imp.total_gross) || 0,
    netPay: imp.total_net != null ? Number(imp.total_net) : null,
    employerTaxes: Number(imp.total_employer_taxes) || 0,
    salariesCode: codes.salariesCode || "6000",
    payrollTaxExpCode: codes.payrollTaxExpCode || "6010",
    cashCode: codes.cashCode || "1000",
    payrollTaxesPayableCode: codes.payrollTaxesPayableCode || "2101",
    date: imp.pay_date,
    description: `${imp.source} Payroll — ${imp.period}`,
    // C189 — payroll cash is DISBURSED at post time: stamp payment_status 'paid' so the
    // expense legs (Salaries + Payroll Tax Exp) don't satisfy apUnpaid (reports.js) and
    // leak into the open-bills sub-ledger, failing the ap_tie control by gross+employer.
    // The withholding liability is tracked by its own GL (Payroll Taxes Payable), not the
    // bills list. persistMultiLineEntry passes meta as p_meta → post_journal_entry writes
    // payment_status → flattenJournalEntries carries it. Every write path that creates a
    // cash-settled entry must stamp this (§9).
    meta: { kind: "payroll", source: imp.source, period: imp.period, payment_status: "paid" },
  });
}

// ── C198·3a — THE AUTO-POST GATE ─────────────────────────────────────────────
// A CPA clicking "Post to Ledger" on a standard biweekly register is OPERATING,
// not reviewing (O86 finding (b)). So standard registers post themselves. But
// auto-post sits downstream of AI extraction, which has hallucinated before —
// the O86 phantom (06-20, $10,000/$7,335) matched no register on file. The GATE
// is the whole design: a hallucinated extraction must STRUCTURALLY fail to
// auto-post and fall back to the human confirm card that already exists.
//
// Pure, so every condition is mutation-testable. ALL five must hold; any failure
// returns the plain-CPA reason(s) the card shows and the audit row records.
//
// On the withholdings input: use the register's OWN deductions total, never
// gross − net. Deriving it would make FOOTS a tautology (net = gross − (gross −
// net) is true for any two numbers) — the check only means something when the
// register states all three independently and they agree.
// ─────────────────────────────────────────────────────────────────────────────

export const PAYROLL_GATE = {
  SHAPE: "shape",             // 1. recognized format — the full field set, no nulls
  FOOTS: "foots",             // 2. net = gross − withholdings, to the cent
  CONSISTENT: "consistent",   // 3. internal consistency
  PAY_DATE: "pay_date",       // 4. pay date within/adjacent to the period
  NORM: "norm",               // 5. within this company's own norms
};

// Gross may sit this far either side of the trailing average before a human looks.
export const PAYROLL_NORM_TOLERANCE = 0.5;
// A pay date may fall this many days AFTER period end and still be "adjacent".
export const PAYROLL_PAY_DATE_GRACE_DAYS = 7;

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const numOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;   // Number(null) is 0 — check first
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ymdOrNull = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  return YMD_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) ? s : null;
};
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// ── C198·3c (i) — THE STAMP THAT UN-INERTS THE GATE ──────────────────────────
// `post_journal_entry` (migrations 010 / 036) cherry-picks SIX named scalars out of
// `p_meta` — ai_reasoning, ai_confidence, approval_status, payment_status,
// payment_method, due_date — into their own columns and NEVER writes
// `import_metadata`. Every other key the poster hands it (`kind`, `gross`, `net`,
// `withholdings`, `employer_taxes`, `period`) is silently discarded at the RPC
// boundary. Since that RPC is the single canonical write path (§7), every payroll
// entry ever posted carries `import_metadata = NULL` — so
// `payrollHistoryFromLedger`, which selects on `import_metadata.kind === 'payroll'`,
// has always returned an empty history, so gate condition 5 has failed for every
// company since C198·3a shipped. The gate failed CLOSED, which is the one mercy.
//
// The fix is a FOLLOW-UP CHECKED UPDATE after the RPC returns — the shape the
// payment path already uses (markBillPaid, App.jsx:6087) — NOT a change to
// `post_journal_entry`, which would move ·3c off "migrations unchanged" and would
// change the canonical write path for every caller. (Making `import_metadata` a
// first-class RPC parameter is the right end state and is recorded as separate,
// unscheduled work; it is not a bug-fix rider.)
//
// PURE, so the shape is assertable without a database. The keys are the gate's own
// inputs: `gross` feeds the trailing-average norm, `pay_date`/`period_start`/
// `period_end` place the run, `register_import_id` links the entry back to the
// intake row the register arrived on (document_intake.id — durable, unlike the
// in-session import record's id, which is regenerated on every reload).
//
// ★ `net` IS NOT OPTIONAL, and it is here for a reason the gate doesn't need.
// Stamping `kind:'payroll'` does not only wake the gate — it wakes EVERY reader that
// selects on that key, and `matchPayrollBankLine` is one of them. That matcher
// compares a bank net-pay line against `m.net`, and its fallback when `m.net` is
// absent is the FLATTENED ROW'S OWN AMOUNT. Since flattenJournalEntries copies one
// entry's `import_metadata` onto every leg, that fallback offers the matcher FOUR
// amounts — gross, employer taxes, net, and withholdings+employer — and a match
// SUPPRESSES the bank line (no re-book, by design, because the register already
// booked that cash). Gusto drafts net pay and the tax remittance as separate ACHs, so
// a stamp without `net` would silently swallow a real tax-remittance outflow and
// leave Payroll Taxes Payable un-relieved. Un-inerting a reader is only safe if you
// give it the field it was written to read. (`matchPayrollBankLine` now also REFUSES
// that fallback — belt and braces, so a backfilled entry carrying only kind+gross
// can never match on a leg amount either.)
export function payrollImportMetadata(imp = {}) {
  const g = numOrNull(imp.total_gross);
  const n = numOrNull(imp.total_net);
  return {
    kind: "payroll",
    gross: g === null ? null : r2(g),
    net: n === null ? null : r2(n),
    pay_date: ymdOrNull(imp.pay_date),
    period_start: ymdOrNull(imp.period_start),
    period_end: ymdOrNull(imp.period_end),
    register_import_id: imp._intakeId != null ? String(imp._intakeId) : null,
  };
}

// The parsed AI payload → the gate's register shape. `total_deductions` is the
// employee-withholdings total the parse already returns and the app has been
// dropping on the floor; it is what makes condition 2 a real check.
export function registerFromParsedPayroll(parsed = {}) {
  return {
    periodStart: parsed?.period_start ?? null,
    periodEnd: parsed?.period_end ?? null,
    payDate: parsed?.pay_date ?? null,
    gross: parsed?.total_gross ?? null,
    net: parsed?.total_net ?? null,
    withholdings: parsed?.total_deductions ?? null,
    employerTax: parsed?.total_employer_taxes ?? null,
  };
}

// Prior POSTED payroll runs, oldest → newest, as { id, date, gross }.
// Gross comes from the entry's own metadata where present; entries posted before
// C198·3a stamped only { kind, source, period }, so fall back to the Salaries &
// Wages DEBIT, which IS gross by construction (buildPayrollEntry line 1).
// Voided/deleted runs never count toward a norm.
export function payrollHistoryFromLedger(ledger = [], { salariesCode = null } = {}) {
  const byEntry = new Map();
  for (const row of ledger || []) {
    const m = row && row.import_metadata;
    if (!m || m.kind !== "payroll") continue;
    if (row.status === "voided" || row.status === "deleted") continue;
    const id = String(row.db_entry_id ?? row.id ?? "");
    if (!id) continue;
    if (!byEntry.has(id)) byEntry.set(id, { id, date: row.date || null, metaGross: null, salaryDebit: 0 });
    const rec = byEntry.get(id);
    const mg = numOrNull(m.gross);
    if (mg !== null) rec.metaGross = r2(mg);
    if (salariesCode && String(row.gl_code) === String(salariesCode) && row.debit_credit === "debit") {
      rec.salaryDebit = r2(rec.salaryDebit + (Number(row.amount) || 0));
    }
  }
  return [...byEntry.values()]
    .map(r => ({ id: r.id, date: r.date, gross: r.metaGross !== null ? r.metaGross : r.salaryDebit }))
    .filter(r => r.gross > 0)
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
}

// Accepts [{gross}] or bare numbers.
const historyGrosses = (history) =>
  (history || [])
    .map(h => numOrNull(h && typeof h === "object" ? h.gross : h))
    .filter(g => g !== null && g > 0);

export function payrollAutoPostGate(register = {}, history = []) {
  const reasons = [];
  const fail = (code, text) => reasons.push({ code, text });

  const periodStart = ymdOrNull(register.periodStart);
  const periodEnd = ymdOrNull(register.periodEnd);
  const payDate = ymdOrNull(register.payDate);
  const gross = numOrNull(register.gross);
  const net = numOrNull(register.net);
  const withholdings = numOrNull(register.withholdings);
  const employerTax = numOrNull(register.employerTax);

  // 1. RECOGNIZED FORMAT — the parse produced the whole field set.
  const missing = [];
  if (!periodStart) missing.push("pay period start");
  if (!periodEnd) missing.push("pay period end");
  if (!payDate) missing.push("pay date");
  if (gross === null) missing.push("gross pay");
  if (withholdings === null) missing.push("employee withholdings");
  if (net === null) missing.push("net pay");
  if (employerTax === null) missing.push("employer taxes");
  if (missing.length) {
    fail(PAYROLL_GATE.SHAPE, `We couldn't read the whole register — no ${missing.join(", ")}.`);
  }

  // 2. TOTALS FOOT — net = gross − withholdings, exactly, and employer tax is real.
  // A figure we never got is a FAILED footing, not a skipped one: the gate's job is
  // to PROVE the register adds up, and absence of proof is not proof. (This is what
  // gives the O86 phantom — gross and net, no period, no withholdings — a second
  // independent failure rather than sliding through on the shape check alone.)
  if (gross === null || net === null || withholdings === null || employerTax === null) {
    fail(PAYROLL_GATE.FOOTS, "We couldn't check that the register adds up — gross, withholdings, net and employer taxes didn't all come through.");
  } else {
    if (r2(gross - withholdings) !== r2(net)) {
      fail(PAYROLL_GATE.FOOTS, `The register doesn't foot: gross ${fmtMoney(gross)} less withholdings ${fmtMoney(withholdings)} is ${fmtMoney(r2(gross - withholdings))}, but it states net pay of ${fmtMoney(net)}.`);
    }
    if (employerTax < 0) {
      fail(PAYROLL_GATE.FOOTS, `Employer taxes came through as ${fmtMoney(employerTax)} — that can't be negative.`);
    }
  }

  // 3. INTERNAL CONSISTENCY. (net < gross is the binding constraint — it also rules
  // out a zero-withholding run, which is not a shape we auto-post unreviewed.)
  const inconsistent = [];
  if (gross !== null && !(gross > 0)) inconsistent.push(`gross pay is ${fmtMoney(gross)}`);
  if (net !== null && !(net > 0)) inconsistent.push(`net pay is ${fmtMoney(net)}`);
  if (withholdings !== null && withholdings < 0) inconsistent.push(`withholdings are ${fmtMoney(withholdings)}`);
  if (gross !== null && net !== null && !(net < gross)) inconsistent.push(`net pay ${fmtMoney(net)} isn't less than gross ${fmtMoney(gross)}`);
  if (inconsistent.length) {
    fail(PAYROLL_GATE.CONSISTENT, `The numbers don't hold together — ${inconsistent.join("; ")}.`);
  }

  // 4. PAY DATE within, or within a week after, the stated period.
  if (periodStart && periodEnd && payDate) {
    if (daysBetween(periodStart, periodEnd) < 0) {
      fail(PAYROLL_GATE.PAY_DATE, `The pay period runs backwards — it ends ${periodEnd}, before it starts ${periodStart}.`);
    } else {
      const afterEnd = daysBetween(periodEnd, payDate);
      const beforeStart = daysBetween(payDate, periodStart);
      if (beforeStart > 0 || afterEnd > PAYROLL_PAY_DATE_GRACE_DAYS) {
        fail(PAYROLL_GATE.PAY_DATE, `The pay date ${payDate} doesn't sit in the pay period ${periodStart} to ${periodEnd}, or the week after it.`);
      }
    }
  }

  // 5. WITHIN THIS COMPANY'S NORMS. No prior payroll FOUND → no norm exists → never
  // auto-post. The first register is ALWAYS confirmed by a person; the norm only
  // means something once a human has attested at least one run.
  //
  // C198·3c — THE REASON IS A CLAIM ABOUT THE QUERY, NOT ABOUT THE WORLD (O87 Q2).
  // This string used to read "This is the first payroll we've recorded for this
  // company." Franklin Ave had TWELVE priors; the gate was structurally inert, found
  // an empty history, and rendered absence of evidence as evidence of absence. That
  // is the failure the operator rubric is built to catch — worse than the missed
  // feature, because the ledger was perfect and the system still asserted a falsehood.
  // Fixing the extractor does not fix this: ANY future lookup failure re-tells the
  // same lie with the same confidence. An empty result set may only ever be reported
  // as an empty result set, so the sentence now describes what we looked for and
  // didn't find. It stays true whether the history is genuinely empty or merely
  // unreadable — which is exactly the property the old one lacked.
  const priors = historyGrosses(history);
  if (!priors.length) {
    fail(PAYROLL_GATE.NORM, "We couldn't find any prior payroll for this company — someone should check this one by hand.");
  } else if (gross !== null && gross > 0) {
    const avg = r2(priors.reduce((s, g) => s + g, 0) / priors.length);
    if (avg > 0 && Math.abs(gross - avg) > avg * PAYROLL_NORM_TOLERANCE) {
      fail(PAYROLL_GATE.NORM, `Gross pay of ${fmtMoney(gross)} is well outside this company's usual ${fmtMoney(avg)} a run.`);
    }
  }

  return { pass: reasons.length === 0, reasons };
}

// Plain narration for a run that posted itself. Jargon-scanned with a plain
// fallback, the same safety net pipelineOutcomeCopy uses — the owner reads an
// outcome, never an entry. (fmtMoney's thousands separators also keep a bare
// 4-digit amount from tripping the GL-code lint.)
export function payrollAutoPostNarration({ periodLabel = "", net = 0, headcount = 0 } = {}) {
  const people = Number(headcount) > 0
    ? ` to ${headcount} ${Number(headcount) === 1 ? "person" : "people"}`
    : "";
  const period = String(periodLabel || "").trim();
  const msg = `Payroll${period ? ` for ${period}` : ""} is in your books — ${fmtMoney(net)} net${people}.`;
  return containsOwnerJargon(msg) ? `Payroll${period ? ` for ${period}` : ""} is in your books.` : msg;
}

// ── O72: bank net-pay line ↔ payroll register reconciliation ─────────────────
// A bank line like "PAYROLL JANE SMITH NET $4,401" is the SAME cash disbursement the register
// already recorded (Cr Cash net). Booking it as a fresh salary expense (a) loses the payroll
// detail and (b) double-counts salaries when the register is also uploaded. So a payroll bank
// line MATCHES the register's net (and is suppressed — no re-book); with no register, it books
// net but is FLAGGED incomplete (ties O49) rather than pretending net = full salary.

const _num = (n) => Number(n) || 0;

// Detect a payroll NET-pay bank line (targeted, to avoid false positives on generic expenses).
const PAYROLL_LINE_RE = /\bpayroll\b|\bnet pay\b|\bpaychex\b|\bgusto\b|\badp\b|\brippling\b|\bjustworks\b|\bonpay\b|\btrinet\b|\bzenefits\b/i;
export function isPayrollBankLine(txn = {}) {
  return PAYROLL_LINE_RE.test(`${txn.vendor || ""} ${txn.description || ""}`);
}

// Find a booked payroll REGISTER entry (import_metadata.kind==="payroll") whose NET matches this
// bank line's amount within a date window. Returns the matching ledger row, or null. `usedIds`
// prevents two bank lines matching the same register run (and dedupes an entry's own flat rows).
export function matchPayrollBankLine(bankLine = {}, ledger = [], { dateWindowDays = 10, usedIds = new Set() } = {}) {
  const amt = Math.abs(_num(bankLine.amount));
  if (!(amt > 0)) return null;
  for (const i of (ledger || [])) {
    const m = i && i.import_metadata;
    if (!m || m.kind !== "payroll") continue;
    if (i.status === "voided" || i.status === "deleted") continue;
    const id = String(i.db_entry_id ?? i.id);
    if (usedIds.has(id)) continue;
    // C198·3c — the register must STATE its net. This used to fall through to `i.amount`,
    // the flattened row's own figure, which "worked" only because the Cr Cash leg happens
    // to carry net — while the Salaries leg carries GROSS and the payable leg carries
    // withholdings+employer, and every leg carries the same import_metadata. A match here
    // SUPPRESSES the bank line, so that fallback could swallow a genuine separate outflow
    // (a Gusto tax remittance) as though the register had already booked it. No stated
    // net, no match: the line then falls to `incomplete`, which books it and FLAGS it —
    // visible and wrong-way-safe, rather than silently absent from the books.
    //
    // ★ PROVEN BY `tests/payroll.test.js` → "a register with NO stated net suppresses
    // nothing". Restore the `?? _num(i.amount)` fallback here and four assertions go
    // red; that was run, not assumed. The pin lives in the MATCHER suite deliberately.
    // It was missing from there at first — every other fixture in that file carries
    // `net`, so this branch was unreachable from all of them and the suite stayed green
    // under the mutation. A guard nobody can falsify from the file that tests the guard
    // is a claim, not a guarantee.
    const stated = numOrNull(m.net);
    if (stated === null) continue;
    if (Math.abs(Math.abs(stated) - amt) > 0.01) continue;
    if (bankLine.date && i.date) {
      const dd = Math.abs((new Date(bankLine.date) - new Date(i.date)) / 86400000);
      if (isNaN(dd) || dd > dateWindowDays) continue;
    }
    return i;
  }
  return null;
}

export const PAYROLL_INCOMPLETE_NOTE = "Net pay booked from the bank line — the payroll register (gross wages + tax withholdings) wasn't uploaded, so this understates salary expense and omits the payroll-tax liability. Upload the register to record the full entry.";

// Mark a payroll bank line that has NO register to complete it: book its net, but at low
// confidence + an honest note so O49 flags it for review (don't pretend partial payroll is whole).
export function flagIncompletePayroll(txn = {}) {
  return { ...txn, confidence: 40, reasoning: PAYROLL_INCOMPLETE_NOTE, payroll_incomplete: true };
}

// Partition bank "standalone" lines (the ones about to be direct-booked) for payroll safety:
//   matched     → payroll net lines that clear a booked register run  → SUPPRESS (no re-book)
//   incomplete  → payroll net lines with no register                  → book net + flag (flagIncompletePayroll)
//   rest        → everything else                                     → book unchanged
export function planPayrollBankLines(standalone = [], ledger = [], { dateWindowDays = 10 } = {}) {
  const rest = [], matched = [], incomplete = [];
  const used = new Set();
  for (const t of (standalone || [])) {
    if (!isPayrollBankLine(t)) { rest.push(t); continue; }
    const m = matchPayrollBankLine(t, ledger, { dateWindowDays, usedIds: used });
    if (m) { used.add(String(m.db_entry_id ?? m.id)); matched.push({ line: t, matchId: m.db_entry_id ?? m.id }); }
    else { incomplete.push(t); }
  }
  return { rest, matched, incomplete };
}
