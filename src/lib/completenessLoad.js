// ─────────────────────────────────────────────────────────────────────────────
// ★ C738/C740 — THE ONE READER behind both completeness views: the operator's page (every company)
// and the owner's month list (one company). Same tables, same rules (lib/completeness.js), so the
// two can't disagree. Paged, because PostgREST returns 1,000 rows at most. ★ A failed read is NOT
// an empty one: if any table can't be read, the result carries `failed` and NO report — a caller
// must never show a verdict built on a read that didn't run.
// ─────────────────────────────────────────────────────────────────────────────
import { completenessReport } from "./completeness.js";

export async function pageAll(build) {
  const rows = [];
  for (let from = 0; from < 500000; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) return { ok: false, error: error.message || String(error), rows };
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { ok: true, rows };
}

export async function loadCompleteness(supabase, now = new Date(), { companyId = null } = {}) {
  const scope = (q, col = "company_id") => (companyId ? q.eq(col, companyId) : q);
  const [companies, intake, accounts, statements, openLines, recons, signoffs, entries] = await Promise.all([
    pageAll(() => scope(supabase.from("companies").select("id, name, cutoff_date"), "id").order("id")),
    pageAll(() => scope(supabase.from("document_intake").select("company_id, status, received_at, updated_at, filename, detail")).order("id")),
    pageAll(() => scope(supabase.from("bank_accounts").select("id, company_id, name, active, institution, last4, current_balance, created_at, updated_at")).order("id")),
    pageAll(() => scope(supabase.from("bank_statements").select("id, company_id, bank_account_id, period_start, period_end, status")).order("id")),
    pageAll(() => scope(supabase.from("bank_statement_lines").select("company_id, statement_id, line_date, status").in("status", ["pending", "excepted"])).order("id")),
    pageAll(() => scope(supabase.from("reconciliations").select("company_id, account_id, status, statement_balance, statement_balance_verified, period_start, period_end")).order("id")),
    pageAll(() => scope(supabase.from("period_signoffs").select("company_id, period, revoked_at")).order("id")),
    // C746 — books that came in some other way (starting balances, typed in, imported) count as books
    pageAll(() => scope(supabase.from("journal_entries").select("company_id, entry_date").is("deleted_at", null).neq("status", "voided")).order("id")),
  ]);
  const parts = { companies, uploads: intake, "bank accounts": accounts, "bank statements": statements, "statement lines": openLines, "bank matches": recons, "closed months": signoffs, "journal entries": entries };
  const failed = Object.entries(parts).filter(([, r]) => !r.ok).map(([k, r]) => `${k} (${r.error})`);
  if (failed.length) return { loading: false, failed };
  const report = completenessReport({ companies: companies.rows, intake: intake.rows, accounts: accounts.rows, statements: statements.rows, openLines: openLines.rows, recons: recons.rows, signoffs: signoffs.rows, entries: entries.rows, now });
  return { loading: false, report, at: now };
}
