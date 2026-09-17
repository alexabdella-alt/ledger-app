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
import { glIsRevenue, glIsExpense, isCancelledOrCancelling, isReversalEntry, entryBaseOf } from "./gl";

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

export function classifyTxn(inv = {}, { apCode, arCode, settled = null } = {}) {
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
  // C528 — and nothing to pay on a bill a LIVE payment already links, whatever its flag says
  // (`settled` = `settledBases(invoices)`; a caller without the ledger passes none).
  const linked = settled && settled.has(entryBaseOf(inv));
  if (!settle && !linked && inv.status !== "voided" && !isCancelledOrCancelling(inv)) {   // C468 — nothing to pay on a corrected bill, or on the correction
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

// C539 — THE PARTY A ROW IS ABOUT. A settlement's description is "Payment – Vendor" (or
// "Collection – Customer"), so the flatten's `vendor` — the left of the dash — is the literal
// word "Payment": Home's feed, the Transactions list and the detail panel all printed it as a
// vendor, with a "P" avatar. The party is the bill or invoice the settlement links (payment_for),
// else the right half of its own description; any other row's party is its vendor.
export function displayParty(inv, rows = []) {
  if (!inv) return "";
  if (!settlementKind(inv)) return inv.vendor || "";
  const base = String((inv.import_metadata && inv.import_metadata.payment_for) ?? "");
  const target = base ? (rows || []).find(r => r && entryBaseOf(r) === base) : null;
  if (target && target.vendor) return target.vendor;
  const stripped = String(inv.description || "").replace(/^(Payment|Collection)\s*[–—-]\s*/i, "").trim();
  return stripped || inv.vendor || "";
}

// C519 — ONE ROW PER ENTRY, AT THE ENTRY'S TOTAL. For any reader that treats a row as "a
// transaction" (the anomaly detectors, the AI's action targets): the representative row with
// its `amount` set to the entry's total, so a two-line $6,000 bill is one $6,000 charge and not
// two $3,000 ones. Simple rows pass through untouched.
export function perEntry(rows = []) {
  // An expanded row's id is `${entryId}_${lineIndex}` — the numeric tail is the sentinel here,
  // not any underscore (C288's collision: a fixture id like `ap_null` is a simple row).
  const expanded = r => /_\d+$/.test(String((r && r.id) ?? ""));
  const simple = [], toCollapse = [];
  for (const r of rows || []) (expanded(r) ? toCollapse : simple).push(r);
  if (!toCollapse.length) return simple;
  const collapsed = collapseExpandedRows(toCollapse).map(r => (r && r._entryTotal != null ? { ...r, amount: r._entryTotal } : r));
  // keep the ledger's order: a collapsed entry sits where its first line was
  const firstIndex = new Map(); (rows || []).forEach((r, i) => { const k = expanded(r) ? entryBaseOf(r) : String(r && r.id); if (!firstIndex.has(k)) firstIndex.set(k, i); });
  return [...simple, ...collapsed].sort((a, b) => (firstIndex.get(expanded(a) ? entryBaseOf(a) : String(a.id)) ?? 0) - (firstIndex.get(expanded(b) ? entryBaseOf(b) : String(b.id)) ?? 0));
}

// The figure the list shows for a row: an expanded entry's total, a simple row's amount.
export const listAmount = (r) => (r && r._entryTotal != null ? r._entryTotal : Number(r && r.amount) || 0);

// The whole entry's amount for any one of its rows (the panel resolves a row from the raw
// ledger, where `_entryTotal` is not stamped): an expanded entry's debits, a simple row's amount.
export function entryTotalOf(row, rows = []) {
  if (!row || !String(row.id ?? "").includes("_")) return Number(row && row.amount) || 0;
  const base = String(row.db_entry_id != null ? row.db_entry_id : String(row.id).split("_")[0]);
  const lines = (rows || []).filter((r) => r && String(r.db_entry_id != null ? r.db_entry_id : String(r.id).split("_")[0]) === base);
  return Math.round(lines.reduce((s, r) => s + (r.debit_credit === "debit" ? Number(r.amount) || 0 : 0), 0) * 100) / 100;
}
export const entryLineCount = (row, rows = []) => {
  if (!row || !String(row.id ?? "").includes("_")) return 1;
  const base = String(row.db_entry_id != null ? row.db_entry_id : String(row.id).split("_")[0]);
  return (rows || []).filter((r) => r && String(r.db_entry_id != null ? r.db_entry_id : String(r.id).split("_")[0]) === base).length;
};
