// ─────────────────────────────────────────────────────────────────────────────
// Ledger flattening — the SINGLE source of truth for turning journal_entries
// (+ lines + accounts) into the app's flat "invoice" display shape. Used by both
// loadAllData (initial app load) and the AI tool layer (live DB queries) so the
// two can never diverge.
// ─────────────────────────────────────────────────────────────────────────────

import { glIsRevenue, glIsExpense } from "./gl";

const isPLCode = c => c && (glIsRevenue(c) || glIsExpense(c));

// Resolve a flattened invoice row to its PARENT journal_entries.id — the row a
// payment/status UPDATE must target. Multi-line rows have a synthetic id
// `${parentId}_${lineIndex}`; the parent uuid is carried on db_entry_id, with a
// belt-and-suspenders fallback of stripping the line suffix. One bill = one entry
// = one payment_status, so any line of a multi-line entry resolves to the same id.
export function resolveEntryDbId(invoice) {
  if (!invoice) return null;
  if (invoice.db_entry_id != null && invoice.db_entry_id !== "") return String(invoice.db_entry_id);
  const id = String(invoice.id ?? "");
  if (!id) return null;
  // A uuid contains hyphens but no underscores; our synthetic suffix is `_<n>`.
  const us = id.lastIndexOf("_");
  return us > 0 ? id.slice(0, us) : id;
}

export function flattenJournalEntries(entries, chartOfAccounts = []) {
  const mapped = [];
  (entries || []).forEach(e => {
    const lines = e.journal_entry_lines || [];
    const vendor = e.description?.split(" – ")[0] || e.description;
    // Primary P&L line for display (first debit or revenue line)
    const primaryDebit = lines.find(l => l.debit > 0);
    const primaryCredit = lines.find(l => l.credit > 0);

    if (lines.length <= 2) {
      // Simple two-line entry — one invoice row (backward compat).
      // PRIMARY = the P&L (revenue/expense) line when the entry has one, so that
      // revenue/expense ALWAYS lands on `gl_code` where computeRevenue/Expenses read
      // it — never stranded on the offset leg. Without this, a Dr A/R / Cr Revenue
      // (or Dr Deferred Rev / Cr Revenue recognition) entry flattened with the asset/
      // liability debit as primary, so computeRevenue (primary-leg only) missed the
      // revenue while glAccountBalance (both legs) counted it → the two diverged.
      // For balance-sheet-only entries (a payment Dr A/P / Cr Cash, no P&L line) the
      // first debit stays primary, exactly as before.
      const plLine = lines.find(l => (l.debit > 0 || l.credit > 0) && isPLCode(l.accounts?.code));
      const primaryLine = plLine || primaryDebit || primaryCredit;
      const offsetLine = lines.find(l => l !== primaryLine && (l.debit > 0 || l.credit > 0)) || null;
      const primaryIsDebit = (primaryLine?.debit || 0) > 0;
      const primaryCode = primaryLine?.accounts?.code;
      mapped.push({
        id: e.id, vendor, description: e.description,
        amount: (primaryIsDebit ? primaryLine?.debit : primaryLine?.credit) || 0,
        date: e.entry_date,
        type: glIsRevenue(primaryCode) ? "revenue" : "expense",
        gl_code: primaryCode || offsetLine?.accounts?.code,
        gl_name: primaryLine?.accounts?.name || offsetLine?.accounts?.name,
        secondary_gl_code: offsetLine?.accounts?.code,
        secondary_gl_name: offsetLine?.accounts?.name,
        debit_credit: primaryIsDebit ? "debit" : "credit",
        status: "booked", booked_at: e.created_at, source: e.source,
        payment_status: e.payment_status || "unpaid",
        approval_status: e.approval_status || undefined,
        approved_at: e.approved_at || undefined,
        approved_by: e.approved_by || undefined,
        rejected_at: e.rejected_at || undefined,
        rejection_reason: e.rejection_reason || undefined,
        payment_method_used: e.payment_method || undefined,
        payment_reference: e.payment_reference || undefined,
        payment_notes: e.payment_notes || undefined,
        paid_at: e.paid_at || undefined,
        due_date: e.due_date || undefined,
        confidence: e.ai_confidence ?? 99,
        reasoning: e.ai_reasoning || "Loaded from database",
        db_entry_id: e.id
      });
    } else {
      // Multi-line entry (lease commencement, payroll, taxed AR invoice, …) — expand
      // each line. For a taxed AR invoice (Dr A/R / Cr Revenue / Cr Sales Tax) the
      // revenue row's `amount` is ex-tax (correct for P&L), but the RECEIVABLE owed is
      // the full A/R debit (incl. tax). Carry that as `ar_amount` on the single revenue
      // row so AR aging/collection/total reflect the full amount while revenue stays
      // ex-tax. Only when there's exactly one revenue credit line (the issued-invoice
      // shape), so multi-revenue-line entries don't over-count.
      const arDef = (chartOfAccounts || []).find(a => a.system_role === "accounts_receivable");
      const arCode = arDef?.code;
      const arDebit = arCode ? lines.filter(l => l.accounts?.code === arCode).reduce((s, l) => s + (l.debit || 0), 0) : 0;
      const revCreditCount = lines.filter(l => l.credit > 0 && String(l.accounts?.code || "")[0] === "4").length;
      const arInvoiceShape = arDebit > 0 && revCreditCount === 1;
      lines.forEach((l, li) => {
        const isDebit = l.debit > 0;
        const amount = isDebit ? l.debit : l.credit;
        if (amount === 0) return;
        const code = l.accounts?.code;
        const acctDef = (chartOfAccounts || []).find(a => a.code === code);
        const isRevenueRow = acctDef?.category === "Revenue";
        mapped.push({
          id: `${e.id}_${li}`, vendor, description: e.description,
          amount,
          // Full receivable owed (incl. tax) for the revenue row of a taxed AR invoice;
          // AR aging/collection/total read this, P&L still reads `amount` (ex-tax).
          ...(isRevenueRow && arInvoiceShape ? { ar_amount: Math.round(arDebit * 100) / 100 } : {}),
          date: e.entry_date,
          type: isRevenueRow ? "revenue" : "expense",
          gl_code: code,
          gl_name: l.accounts?.name,
          secondary_gl_code: isDebit ? primaryCredit?.accounts?.code : primaryDebit?.accounts?.code,
          secondary_gl_name: isDebit ? primaryCredit?.accounts?.name : primaryDebit?.accounts?.name,
          debit_credit: isDebit ? "debit" : "credit",
          status: "booked", booked_at: e.created_at, source: e.source,
          // Read the canonical payment state back (was hardcoded "unpaid" — which
          // silently discarded a saved "paid"/"collected" on every refresh for
          // multi-line bills). Payment state lives on the entry, shared by all lines.
          payment_status: e.payment_status || "unpaid",
          paid_at: e.paid_at || undefined,
          payment_method_used: e.payment_method || undefined,
          due_date: e.due_date || undefined,
          confidence: e.ai_confidence ?? 99,
          reasoning: e.ai_reasoning || "Loaded from database",
          db_entry_id: e.id,
          balance_sheet_account: ["Assets", "Liabilities", "Equity"].includes(acctDef?.category),
        });
      });
    }
  });
  return mapped;
}

// Fetch the FULL company ledger straight from Supabase (RLS-scoped by company_id)
// and flatten it. Used by the AI tools so they always see complete, current data
// regardless of how many transactions exist. Never throws to the caller's flow
// other than via the awaited promise (callers wrap in try/catch).
export async function fetchLedger(supabase, companyId, chartOfAccounts = []) {
  if (!supabase || !companyId) return [];
  const { data: entries, error } = await supabase
    .from("journal_entries")
    .select("*, journal_entry_lines(*, accounts(code,name))")
    .eq("company_id", companyId)        // tenant scope (also enforced by RLS)
    .eq("status", "posted")
    .is("deleted_at", null)
    .order("entry_date", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return flattenJournalEntries(entries, chartOfAccounts);
}
