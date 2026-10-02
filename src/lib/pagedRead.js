// ─────────────────────────────────────────────────────────────────────────────
// C568 / C569 — READ EVERY ROW, OR SAY THE READ FAILED. NEVER A QUIET FIRST THOUSAND.
//
// Supabase (PostgREST) answers an unbounded select with at most 1,000 rows and NO
// error — the response looks exactly like a table that happens to hold 1,000 rows. So
// any list loaded with a bare `select("*")` stops growing on screen at 1,000 while the
// table keeps growing underneath: the 1,001st document is stored and never shown, and
// nothing anywhere says so. `fetchLedgerEntries` (ledger.js) already pages for this
// reason; this is the same loop for every other table.
//
// `build()` must return a FRESH query each call, ordered with a unique tiebreaker
// (`.order("id")`) so pages never overlap or skip. Resolves to `{ data, error }` — the
// shape a single Supabase call has — so it drops into `Promise.allSettled` and
// `settledFailures` unchanged. A page that errors fails the WHOLE read: a partial list
// returned as if complete is the defect this exists to remove.
// ─────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 1000;
export const MAX_PAGES = 500;

export async function readAllRows(build, { pageSize = PAGE_SIZE, maxPages = MAX_PAGES } = {}) {
  const all = [];
  for (let page = 0; page < maxPages; page++) {
    const from = page * pageSize;
    let res;
    try { res = await build().range(from, from + pageSize - 1); }
    catch (e) { return { data: undefined, error: e }; }
    const { data, error } = res || {};
    if (error) return { data: undefined, error };
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
  // Ran out of pages before the table ran out of rows. Refuse rather than hand back a
  // list that looks complete and is not.
  return { data: undefined, error: new Error(`More than ${maxPages * pageSize} rows — too many to read in one go.`) };
}
