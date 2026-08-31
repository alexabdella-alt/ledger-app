// ─────────────────────────────────────────────────────────────────────────────
// WHAT THE MODEL PROPOSES, AND WHAT WE ACCEPT — the safety layer between them.
//
// The matching engine runs a DETERMINISTIC pass first (exact amount + name, side keyed on the
// A/R or A/P offset code), whose matches are authoritative. The model then gets whatever is
// left. **Everything it proposes passes through the filter below**, and every rule in it
// exists because of something that actually went wrong:
//
//   · **never re-match a line the deterministic pass already took** — an LLM echoing a bank
//     id it was not offered would clear the same money twice;
//   · **never re-match an open item already claimed** — same, from the other side;
//   · **★★ refuse a proposal whose counterpart cannot be resolved in the OPEN universe.**
//     O83 February: a 99%-confidence exact-amount proposal rendered an empty "MATCHING
//     AGAINST" panel, asking a person to confirm a match against an entity they could not
//     see. **A proposal nobody can look at is not a proposal.**
//
// ★★★ AND THE REASON THIS IS ITS OWN FILE: it lived inside a 126-line component function and
// was therefore untestable — every rule above could only be verified by reading it, on the
// one path where a wrong accept clears money against the wrong bill.
//
// ★ DROPS ARE RETURNED, NOT JUST LOGGED. They were `console.warn` only, so a model quietly
// proposing nothing usable and a model proposing nothing looked identical.
//
// Pure. `id` and `createdAt` are injected, so the same proposals always yield the same rows.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveMatchedInvoices } from "./bankMatch.js";

export const DROP_REASON = {
  NO_MATCH: "no_match",                     // the model itself said there is none
  BANK_LINE_TAKEN: "bank_line_taken",       // the deterministic pass already cleared it
  ITEMS_TAKEN: "items_taken",               // every open item it named is already claimed
  COUNTERPART_UNRENDERABLE: "counterpart_unrenderable",
};

export function planLlmMatches({
  matches = [], deterministic = [], openUniverse = [], bankTxns = [], id = () => null, createdAt = null,
} = {}) {
  const handledBankIds = new Set((deterministic || []).map((m) => String(m.bank_txn_id)));
  const handledInvIds = new Set((deterministic || []).flatMap((m) => (m.invoice_ids || []).map(String)));

  const autoCleared = [...(deterministic || [])];   // deterministic matches always stand
  const queue = [];
  const dropped = [];
  let n = 0;

  for (const match of matches || []) {
    if (!match) continue;
    if (match.match_type === "no_match" || !match.invoice_ids?.length) {
      dropped.push({ bank_txn_id: match.bank_txn_id ?? null, reason: DROP_REASON.NO_MATCH });
      continue;
    }
    if (handledBankIds.has(String(match.bank_txn_id))) {
      dropped.push({ bank_txn_id: match.bank_txn_id, reason: DROP_REASON.BANK_LINE_TAKEN });
      continue;
    }
    const invoice_ids = match.invoice_ids.filter((x) => !handledInvIds.has(String(x)));
    if (!invoice_ids.length) {
      dropped.push({ bank_txn_id: match.bank_txn_id, reason: DROP_REASON.ITEMS_TAKEN });
      continue;
    }
    const matched_invoices = resolveMatchedInvoices(invoice_ids, openUniverse);
    if (!matched_invoices.length) {
      dropped.push({ bank_txn_id: match.bank_txn_id, reason: DROP_REASON.COUNTERPART_UNRENDERABLE, invoice_ids });
      continue;
    }

    const record = {
      id: id(n++),
      bank_txn_id: match.bank_txn_id,
      invoice_ids,
      match_type: match.match_type,
      confidence: match.confidence,
      amount_matched: match.amount_matched,
      amount_remaining: match.amount_remaining,
      reasoning: match.reasoning,
      clearing_entry: match.clearing_entry,
      auto_clear: match.auto_clear,
      // String-tolerant: the model may echo the id with a different type.
      bank_txn: (bankTxns || []).find((t) => String(t?.id) === String(match.bank_txn_id)),
      matched_invoices,
      status: "pending",
      created_at: createdAt,
    };
    // ★ A LINE THE DETERMINISTIC PASS DID NOT TAKE, NOW SPOKEN FOR: recorded before the next
    // proposal is read, so two model proposals for one bank line cannot both be accepted.
    handledBankIds.add(String(match.bank_txn_id));
    for (const x of invoice_ids) handledInvIds.add(String(x));

    if (match.auto_clear) autoCleared.push(record);
    else queue.push(record);
  }

  return {
    autoCleared, queue, dropped,
    deterministicCount: (deterministic || []).length,
    llmCount: autoCleared.length - (deterministic || []).length,
  };
}
