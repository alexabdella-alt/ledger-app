// ─────────────────────────────────────────────────────────────────────────────
// AI ACTION CONFIRMATION GATE (CR-9 / O81 part 2)
//
// Destructive AI actions (void / delete / recode / retag / reverse / delete-rule)
// must NOT execute straight out of the chat tool loop — a poisoned tool_result or a
// steered model could otherwise trigger a real mutation with no human in the loop.
// This module is the pure, testable core of the CODE gate: it partitions the
// model's emitted actions into SAFE (run immediately) vs DESTRUCTIVE (stage behind
// a human Confirm), and builds the human-readable proposal — resolving the EXACT
// entries/contracts/rules each destructive action would touch, so the confirm UI
// shows the full list (no "confirm one, silently do many").
//
// The App wires the real executor to this: safe actions → applyAIAction now;
// destructive actions → staged; the mutation runs ONLY when the user clicks
// Confirm, through the same verified-write path. The gate is enforced in code, not
// the prompt — even if the model "decides" to act, routing stages instead of runs.
// ─────────────────────────────────────────────────────────────────────────────

import { isDestructiveAIAction } from "./aiCapabilities";
import { fmtMoney } from "./format";

const money = (n) => (Number.isFinite(Number(n)) ? fmtMoney(n) : "");   // canonical magnitude cents
const norm = (s) => String(s || "").toLowerCase();

// Split the emitted actions into { safe, destructive }. `none` is neither (dropped).
export function partitionAIActions(actions = []) {
  const safe = [];
  const destructive = [];
  for (const a of Array.isArray(actions) ? actions : []) {
    if (!a || !a.type || a.type === "none") continue;
    (isDestructiveAIAction(a.type) ? destructive : safe).push(a);
  }
  return { safe, destructive };
}

// Route actions to EXECUTE (now) vs STAGE (behind confirm). When the batch is
// blocked (member role / ambiguous target / bulk-cap exceeded) nothing stages —
// the reply handles the refusal. This is the single decision the dispatch code
// makes: destructive → stage, never execute inline.
export function routeAIActions(actions = [], { blocked = false } = {}) {
  const { safe, destructive } = partitionAIActions(actions);
  if (blocked) return { execute: safe, stage: [] };
  return { execute: safe, stage: destructive };
}

// Resolve the concrete entries/contracts/rules a destructive action targets, purely
// from the current data — used BOTH for the confirm list and (by the caller) to keep
// the displayed set === the executed set. Mirrors the dispatch handlers' matching.
export function resolveActionTargets(action, { invoices = [], contracts = [] } = {}) {
  const a = action || {};
  const liveInv = invoices.filter((i) => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at);
  switch (a.type) {
    case "recode":
    case "retag_project": {
      const ids = Array.isArray(a.invoiceIds) ? a.invoiceIds.map(String) : [];
      return invoices.filter((i) => ids.includes(String(i.id)));
    }
    case "delete_invoice": {
      if (a.invoice_id != null) return invoices.filter((i) => String(i.id) === String(a.invoice_id));
      if (a.vendor) return invoices.filter((i) =>
        norm(i.vendor).includes(norm(a.vendor)) &&
        (a.amount == null || Math.abs((Number(i.amount) || 0) - parseFloat(a.amount)) < 1) &&
        (!a.date || i.date === a.date));
      return [];
    }
    case "void_invoice": {
      if (a.invoice_id != null) return invoices.filter((i) => String(i.id) === String(a.invoice_id));
      if (a.vendor) return liveInv.filter((i) => norm(i.vendor).includes(norm(a.vendor)));
      return [];
    }
    case "reverse_entry":
      return invoices.filter((i) => String(i.id) === String(a.invoice_id));
    case "delete_contract": {
      if (a.contract_id != null) return contracts.filter((c) => String(c.id) === String(a.contract_id));
      if (a.counterparty) return contracts.filter((c) => norm(c.counterparty).includes(norm(a.counterparty)));
      return [];
    }
    default:
      return [];
  }
}

// A human, jargon-free verb for the confirm card (Cardinal Principle — no "void",
// "reverse", "GL", "journal" shown to the owner).
const VERB = {
  recode: "recategorize",
  retag_project: "re-tag",
  delete_invoice: "delete",
  void_invoice: "undo",
  reverse_entry: "undo",
  delete_contract: "remove the contract for",
  delete_rule: "delete the coding rule for",
};

// Build the confirmation proposal for a destructive action: a plain-English title,
// the affected line items (with vendor/amount/date), and a count. This is what the
// human approves — resolved from the CURRENT data so it shows exactly what will run.
export function describeDestructiveAction(action, { invoices = [], contracts = [] } = {}) {
  const a = action || {};
  const verb = VERB[a.type] || "change";

  if (a.type === "delete_rule") {
    const label = a.vendor || "this vendor";
    return { type: a.type, verb, count: 1, targets: [{ label }], description: `Delete the automatic coding rule for ${label}.` };
  }

  if (a.type === "delete_contract") {
    const targets = resolveActionTargets(a, { contracts }).map((c) => ({ id: c.id, label: c.counterparty || c.description || "a contract" }));
    const list = targets.length ? targets.map((t) => t.label) : [a.counterparty || a.contract_id || "a contract"];
    return { type: a.type, verb, count: targets.length || 1, targets: targets.length ? targets : list.map((l) => ({ label: l })),
      description: `Remove the contract for ${list.join(", ")} and its generated entries.` };
  }

  // Invoice-targeting actions (recode / retag / delete / void / reverse).
  const rows = resolveActionTargets(a, { invoices });
  const targets = rows.map((i) => ({
    id: i.id,
    label: `${i.vendor || "a transaction"}${i.amount != null ? ` · ${money(i.amount)}` : ""}${i.date ? ` (${i.date})` : ""}`,
    vendor: i.vendor, amount: i.amount, date: i.date, gl_name: i.gl_name,
  }));
  const n = targets.length;
  let description;
  if (a.type === "recode") description = `Recategorize ${n} transaction${n === 1 ? "" : "s"}${a.gl_name ? ` to ${a.gl_name}` : ""}.`;
  else if (a.type === "retag_project") description = `Re-tag ${n} transaction${n === 1 ? "" : "s"}${a.project ? ` to project “${a.project}”` : ""}.`;
  else if (a.type === "delete_invoice") description = `Delete ${n} transaction${n === 1 ? "" : "s"} (recoverable from the audit trail).`;
  else if (a.type === "void_invoice") description = `Undo ${n} transaction${n === 1 ? "" : "s"} (kept on the audit trail).`;
  else if (a.type === "reverse_entry") description = `Undo ${n} transaction${n === 1 ? "" : "s"} by posting an offsetting entry.`;
  else description = `${verb} ${n} transaction${n === 1 ? "" : "s"}.`;

  return { type: a.type, verb, count: n, targets, description };
}

// Build the full pending-confirmation payload from the destructive actions to stage.
export function buildPendingConfirmation(stageActions = [], ctx = {}) {
  const items = stageActions.map((a) => ({ action: a, ...describeDestructiveAction(a, ctx) }));
  return { actions: stageActions, items };
}
