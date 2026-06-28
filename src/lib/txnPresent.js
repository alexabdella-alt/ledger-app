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
import { glIsRevenue, glIsExpense } from "./gl";

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
  const inflow = settle ? settle === "ar_collection" : isRev;

  // Account to display. A collection's primary leg is Cash — show the A/R it CLEARED (the
  // offset) instead, which is what the entry is about. A payment's primary already IS the A/P.
  const account = settle === "ar_collection"
    ? { code: inv.secondary_gl_code, name: inv.secondary_gl_name }
    : { code: inv.gl_code, name: inv.gl_name };

  // Settle action only on a genuinely OPEN item (GL-side: booked to A/P/A/R and not yet
  // paid/collected) — never on a settlement entry or a voided/paid/collected one.
  let settleAction = null;
  if (!settle && inv.status !== "voided") {
    const onAP = eq(inv.secondary_gl_code, apCode) || eq(inv.gl_code, apCode);
    const onAR = eq(inv.secondary_gl_code, arCode) || eq(inv.gl_code, arCode);
    if (onAP && isExp && inv.payment_status !== "paid") settleAction = "pay";
    else if (onAR && isRev && inv.payment_status !== "collected") settleAction = "collect";
  }

  return { settle, inflow, account, settleAction };
}

// Plain-language status for a non-accountant: Open / Received / Paid (reversed/voided/review
// are handled by the caller, which has the reversal index). Tone keys into the pill colors.
export function txnStatus(inv = {}, cls = {}) {
  if (cls.settleAction) return { label: "Open", tone: "warning" };
  if (cls.inflow) return { label: "Received", tone: "success" };
  return { label: "Paid", tone: "info" };
}
