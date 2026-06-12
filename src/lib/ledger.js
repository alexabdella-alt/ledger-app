// ─────────────────────────────────────────────────────────────────────────────
// Ledger flattening — the SINGLE source of truth for turning journal_entries
// (+ lines + accounts) into the app's flat "invoice" display shape. Used by both
// loadAllData (initial app load) and the AI tool layer (live DB queries) so the
// two can never diverge.
// ─────────────────────────────────────────────────────────────────────────────

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
      // Simple two-line entry — one invoice row (backward compat)
      const debitLine = primaryDebit;
      const creditLine = primaryCredit;
      mapped.push({
        id: e.id, vendor, description: e.description,
        amount: debitLine?.debit || creditLine?.credit || 0,
        date: e.entry_date,
        type: debitLine?.accounts?.code?.startsWith("4") ? "revenue" : "expense",
        gl_code: debitLine?.accounts?.code || creditLine?.accounts?.code,
        gl_name: debitLine?.accounts?.name || creditLine?.accounts?.name,
        secondary_gl_code: creditLine?.accounts?.code,
        secondary_gl_name: creditLine?.accounts?.name,
        debit_credit: debitLine ? "debit" : "credit",
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
      // Multi-line entry (lease commencement, payroll, …) — expand each line
      lines.forEach((l, li) => {
        const isDebit = l.debit > 0;
        const amount = isDebit ? l.debit : l.credit;
        if (amount === 0) return;
        const code = l.accounts?.code;
        const acctDef = (chartOfAccounts || []).find(a => a.code === code);
        mapped.push({
          id: `${e.id}_${li}`, vendor, description: e.description,
          amount,
          date: e.entry_date,
          type: acctDef?.category === "Revenue" ? "revenue" : "expense",
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
