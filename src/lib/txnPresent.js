// ─────────────────────────────────────────────────────────────────────────────
// Transactions-list presentation — what a row actually IS, for a non-accountant.
// The problem this fixes: bank-matching settlement entries flatten with a misleading
// shape — a COLLECTION (Dr Cash / Cr A/R) becomes gl_code=Cash, type="expense", so the
// naive "revenue→+green / else→−red" rule showed money RECEIVED as a red negative, against
// "Cash", with a wrong "Mark Paid" button. Settlements carry import_metadata.kind
// ("ar_collection" | "ap_payment") + payment_for, which tells us the truth directly.
//
// Returns:
//   settle       : "ar_collection" | "ap_payment" | null   (is this an already-settled clearing entry?)
//   inflow       : true = money IN (green/+), false = money OUT (red/−)
//   account      : { code, name } — the MEANINGFUL account (the A/R it cleared, not "Cash")
//   settleAction : "pay" | "collect" | null — show a settle button ONLY on a genuinely
//                  OPEN bill/invoice; never on a settlement or an already-paid/collected item
// ─────────────────────────────────────────────────────────────────────────────
import { glIsRevenue, glIsExpense, isCancelledOrCancelling, isReversalEntry } from "./gl";

const eq = (a, b) => a != null && b != null && String(a) === String(b);

export function settlementKind(inv) {
  const m = (inv && inv.import_metadata) || {};
  if (m.kind === "ar_collection" || m.kind === "ap_payment") return m.kind;
  // Linked payment without an explicit kind (older data) — infer from the canonical description.
  if (m.payment_for) {
    const d = String((inv && inv.description) || "");
    if (/^\s*Collection\b/i.test(d)) return "ar_collection";
    if (/^\s*Payment\b/i.test(d)) return "ap_payment";
  }
  return null;
}

export function classifyTxn(inv = {}, { apCode, arCode } = {}) {
  const settle = settlementKind(inv);
  const isRev = glIsRevenue(inv.gl_code) || inv.type === "revenue";
  const isExp = glIsExpense(inv.gl_code) || inv.type === "expense";

  // Money direction. For a settlement the kind is authoritative (collection in, payment out);
  // for everything else the P&L nature is correct (revenue in, expense out) and the cash leg
  // already agrees (a direct deposit flattens to a 4xxx revenue primary).
  // C470 — a correction mirrors the entry it cancels, so its P&L line is a CREDIT to an
  // expense (or a debit to revenue): money direction is the opposite of what the line's
  // account says. Without the flip a correction of a $500 purchase listed as "−$500 · Paid"
  // — a second purchase, on the screen where the first one is struck through.
  const correction = isReversalEntry(inv);
  const inflow = settle ? settle === "ar_collection" : correction ? !isRev : isRev;

  // Account to display. A collection's primary leg is Cash — show the A/R it CLEARED (the
  // offset) instead, which is what the entry is about. A payment's primary already IS the A/P.
  const account = settle === "ar_collection"
    ? { code: inv.secondary_gl_code, name: inv.secondary_gl_name }
    : { code: inv.gl_code, name: inv.gl_name };

  // Settle action only on a genuinely OPEN item (GL-side: booked to A/P/A/R and not yet
  // paid/collected) — never on a settlement entry or a voided/paid/collected one.
  let settleAction = null;
  if (!settle && inv.status !== "voided" && !isCancelledOrCancelling(inv)) {   // C468 — nothing to pay on a corrected bill, or on the correction
    const onAP = eq(inv.secondary_gl_code, apCode) || eq(inv.gl_code, apCode);
    const onAR = eq(inv.secondary_gl_code, arCode) || eq(inv.gl_code, arCode);
    if (onAP && isExp && inv.payment_status !== "paid") settleAction = "pay";
    else if (onAR && isRev && inv.payment_status !== "collected") settleAction = "collect";
  }

  return { settle, inflow, account, settleAction, correction };
}

// Plain-language status for a non-accountant: Open / Received / Paid (reversed/voided/review
// are handled by the caller, which has the reversal index). Tone keys into the pill colors.
export function txnStatus(inv = {}, cls = {}) {
  if (cls.correction) return { label: "Correction", tone: "info" };   // C470 — never "Paid"
  if (cls.settleAction) return { label: "Open", tone: "warning" };
  if (cls.inflow) return { label: "Received", tone: "success" };
  return { label: "Paid", tone: "info" };
}

// ═════════════════════════════════════════════════════════════════════════════
// C503 — ONE ROW PER ENTRY ON THE TRANSACTIONS LIST. `flattenJournalEntries` expands a
// multi-line entry into one row per line for the P&L derivations, and the list rendered every
// one: a taxed invoice from Send Invoice was THREE rows — an A/R row with no amount, "Sales
// +$1,200 · Open", and "Sales Tax Payable −$99 · Paid" — and a bill with two expense lines was
// three rows with two Mark Paid buttons. The list shows one row per entry: the revenue row of
// an invoice (it carries `ar_amount`), else the first P&L row, else the first line; with the
// entry's total (its debits) and a line count, so the amount a person reads is the invoice's
// $1,299 and not one line's share. The row keeps its own id, so a click, a tick or Mark Paid
// still reach the entry through `db_entry_id` as before.
export function collapseExpandedRows(rows = []) {
  const out = [];
  const groups = new Map();
  for (const r of rows || []) {
    if (!r || !String(r.id ?? "").includes("_")) { out.push(r); continue; }
    const base = String(r.db_entry_id != null ? r.db_entry_id : String(r.id).split("_")[0]);
    if (!groups.has(base)) { groups.set(base, []); out.push(base); }
    groups.get(base).push(r);
  }
  const isPL = (r) => glIsRevenue(r.gl_code) || glIsExpense(r.gl_code);
  return out.map((slot) => {
    if (typeof slot !== "string") return slot;
    const lines = groups.get(slot);
    const rep = lines.find((r) => r.ar_amount != null) || lines.find(isPL) || lines[0];
    const total = Math.round(lines.reduce((s, r) => s + (r.debit_credit === "debit" ? Number(r.amount) || 0 : 0), 0) * 100) / 100;
    return { ...rep, _lineCount: lines.length, _entryTotal: total };
  });
}

// The figure the list shows for a row: an expanded entry's total, a simple row's amount.
export const listAmount = (r) => (r && r._entryTotal != null ? r._entryTotal : Number(r && r.amount) || 0);
