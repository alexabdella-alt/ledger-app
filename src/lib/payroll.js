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
    meta: meta || { kind: "payroll", gross: g, net, withholdings: wh, employer_taxes: emp },
  });
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
    const net = Math.abs(_num(m.net != null ? m.net : i.amount));
    if (Math.abs(net - amt) > 0.01) continue;
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
