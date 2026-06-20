// ─────────────────────────────────────────────────────────────────────────────
// AP Step 3 — historical backfill (pure planner).
//
// Bills marked paid BEFORE Step 1 existed never posted their cash movement, so GL
// Accounts Payable is overstated. For each such bill this plans the missing
// Dr Accounts Payable / Cr Cash entry, dated to when it was actually paid.
//
// Encodes the SAME candidate predicate as the dry-run preview query (so what posts
// equals the preview to the penny):
//   • live (status 'posted', not deleted), payment_status='paid'
//   • not an opening-balance, payment (kind 'ap_payment') or reversal entry
//   • net credit to AP/accrued > 0 (booked to AP, not direct-to-cash)
//   • entry_date >= cutoff (pre-cutoff bills are part of opening balances)
//   • NO live payment JE already links it (import_metadata.payment_for) → idempotent
//
// Each entry: Dr <bill's AP/accrued account> / Cr Cash for the net AP amount, dated
// paid_at → entry_date, floored at the cutoff; linked via import_metadata
// {kind:'ap_payment', payment_for:<bill id>, backfill:true}. Pure & testable.
// ─────────────────────────────────────────────────────────────────────────────

const r2 = n => Math.round((Number(n) || 0) * 100) / 100;

// `entries` are DB-shaped journal entries:
//   { id, status, deleted_at, source, payment_status, entry_date, paid_at,
//     import_metadata: { kind?, payment_for? } | null,
//     ap_credit,            // net (credit − debit) on the bill's AP/accrued line(s)
//     ap_account_code }     // the liability account it credited (e.g. "2000"/"2100")
export function planApBackfill(entries, { cashCode = "1000", cutoffDate = null } = {}) {
  const live = (entries || []).filter(e => e && e.status === "posted" && !e.deleted_at);
  // Bills that already have a live payment JE (Step-1 payment OR a prior backfill).
  const alreadyPaid = new Set(
    live.filter(e => e.import_metadata && e.import_metadata.payment_for)
        .map(e => String(e.import_metadata.payment_for))
  );

  const out = [];
  for (const e of live) {
    if (e.payment_status !== "paid") continue;
    if (e.source === "opening_balance") continue;
    const kind = e.import_metadata && e.import_metadata.kind;
    if (kind === "ap_payment" || kind === "reversal") continue;
    const amount = r2(e.ap_credit);
    if (!(amount > 0)) continue;                                          // booked to AP/accrued, net credit remains
    if (cutoffDate && String(e.entry_date || "") < String(cutoffDate)) continue;  // pre-cutoff → opening balances
    if (alreadyPaid.has(String(e.id))) continue;                         // idempotent: skip already-paid bills

    const raw = e.paid_at ? String(e.paid_at).slice(0, 10) : String(e.entry_date || "");
    const date = (cutoffDate && raw < String(cutoffDate)) ? String(cutoffDate) : raw;   // floor at cutoff
    const apCode = e.ap_account_code || "2000";
    out.push({
      billId: String(e.id),
      date,
      amount,
      lines: [
        { code: apCode, debit: amount, credit: 0 },   // Dr the liability the bill credited
        { code: cashCode, debit: 0, credit: amount },  // Cr Cash
      ],
      meta: { kind: "ap_payment", payment_for: String(e.id), backfill: true },
    });
  }
  return { entries: out, total: r2(out.reduce((s, e) => s + e.amount, 0)), billCount: out.length };
}

// AR Step 3 — symmetric backfill for invoices marked COLLECTED before the AR
// collection-posting existed (never posted Dr Cash / Cr A/R), so GL A/R is overstated.
// `entries` are DB-shaped, with ar_debit = net (debit − credit) on the invoice's A/R
// line(s) and ar_account_code = the A/R account it debited (e.g. "1100"). Each →
// Dr Cash / Cr A/R for the net A/R amount, dated paid_at → entry_date floored at cutoff,
// linked import_metadata {kind:'ar_collection', payment_for:<invoice id>, backfill:true}.
export function planArBackfill(entries, { cashCode = "1000", cutoffDate = null } = {}) {
  const live = (entries || []).filter(e => e && e.status === "posted" && !e.deleted_at);
  const alreadyCollected = new Set(
    live.filter(e => e.import_metadata && e.import_metadata.payment_for)
        .map(e => String(e.import_metadata.payment_for))
  );

  const out = [];
  for (const e of live) {
    if (e.payment_status !== "collected") continue;
    if (e.source === "opening_balance") continue;
    const kind = e.import_metadata && e.import_metadata.kind;
    if (kind === "ap_payment" || kind === "ar_collection" || kind === "reversal") continue;
    const amount = r2(e.ar_debit);
    if (!(amount > 0)) continue;                                          // booked to A/R, net debit remains
    if (cutoffDate && String(e.entry_date || "") < String(cutoffDate)) continue;  // pre-cutoff → opening balances
    if (alreadyCollected.has(String(e.id))) continue;                    // idempotent: skip already-collected

    const raw = e.paid_at ? String(e.paid_at).slice(0, 10) : String(e.entry_date || "");
    const date = (cutoffDate && raw < String(cutoffDate)) ? String(cutoffDate) : raw;
    const arCode = e.ar_account_code || "1100";
    out.push({
      invoiceId: String(e.id),
      date,
      amount,
      lines: [
        { code: cashCode, debit: amount, credit: 0 },   // Dr Cash
        { code: arCode, debit: 0, credit: amount },       // Cr Accounts Receivable
      ],
      meta: { kind: "ar_collection", payment_for: String(e.id), backfill: true },
    });
  }
  return { entries: out, total: r2(out.reduce((s, e) => s + e.amount, 0)), invoiceCount: out.length };
}
