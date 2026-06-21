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
