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

import { perEntry } from "./txnPresent.js";
import { openPayablesGL } from "./reports.js";   // C710
import { pickPayFrom, OWN_MONEY } from "./payFrom.js";   // C687
// C687 — the account a record_payment action names: its staged key if it has one, else the words.
export function resolvePayFrom(a = {}, options = []) {
  if (a.pay_from_key !== undefined) return a.pay_from_key == null ? null : ((options || []).find((o) => o.key === a.pay_from_key) || null);
  return pickPayFrom(options, a.paid_from);
}
import { glIsRevenue, glIsExpense, entryBaseOf } from "./gl.js";
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

// ★ C633 — AN ACTION THAT REPLACES SOMETHING SAVED ASKS FIRST. "Additive" actions ran straight
// through, but three of them overwrite what a person set: a rule for a vendor that already has a
// DIFFERENT one (the old rule is gone), a contact field that already holds a DIFFERENT value, and
// pausing a recurring charge (it stops being tracked). A steered model — or a misread request —
// could change all three with no card. New rules and new details still go straight through.
const key = (s) => norm(s).replace(/[^a-z0-9]/g, "");
const CONTACT_FIELD_ALIASES = { expected_min: "expected_min", expected_max: "expected_max" };
export function replacesSavedValue(action, { rules = [], contacts = [] } = {}) {
  const a = action || {};
  if (a.type === "pause_recurring") return { replaces: true, what: `Pause the recurring charge “${a.name || "this charge"}”.` };
  if (a.type === "add_rule" || a.type === "set_contact_rule") {
    const vendor = a.vendor || a.name;
    if (!a.gl_code || !vendor) return { replaces: false };
    const existing = (rules || []).find((r) => r && key(r.vendor) === key(vendor));
    if (existing && String(existing.gl_code) !== String(a.gl_code)) {
      return { replaces: true, what: `Change the rule for ${vendor} from ${existing.gl_name || existing.gl_code} to ${a.gl_name || a.gl_code}.` };
    }
    return { replaces: false };
  }
  if (a.type === "update_contact") {
    const c = (contacts || []).find((x) => x && key(x.name) === key(a.name));
    if (!c) return { replaces: false };
    const changed = Object.entries(a.updates || {}).filter(([k, v]) => {
      const before = c[CONTACT_FIELD_ALIASES[k] || k];
      const had = before != null && before !== "" && !(Array.isArray(before) && before.length === 0);
      return had && JSON.stringify(before) !== JSON.stringify(v);
    }).map(([k]) => k.replace(/_/g, " "));
    if (changed.length) return { replaces: true, what: `Change ${a.name}'s saved ${changed.join(", ")}.` };
    return { replaces: false };
  }
  return { replaces: false };
}

// Route actions to EXECUTE (now) vs STAGE (behind confirm). When the batch is
// blocked (member role / ambiguous target / bulk-cap exceeded) nothing stages —
// the reply handles the refusal. This is the single decision the dispatch code
// makes: destructive → stage, never execute inline.
export function routeAIActions(actions = [], { blocked = false, rules = [], contacts = [] } = {}) {
  const { safe, destructive } = partitionAIActions(actions);
  // C633 — a "safe" action that would replace something saved joins the staged set.
  const replacing = safe.filter((a) => replacesSavedValue(a, { rules, contacts }).replaces);
  const execute = safe.filter((a) => !replacing.includes(a));
  if (blocked) return { execute, stage: [] };
  return { execute, stage: [...destructive, ...replacing] };
}

// Resolve the concrete entries/contracts/rules a destructive action targets, purely
// from the current data — used BOTH for the confirm list and (by the caller) to keep
// the displayed set === the executed set. Mirrors the dispatch handlers' matching.
export function resolveActionTargets(action, { invoices = [], contracts = [], apCode = null } = {}) {
  const a = action || {};
  // C519 — TARGETS ARE ENTRIES, NOT LINES. `flattenJournalEntries` expands a multi-line bill
  // into one row per line, and this matched rows: "delete the $6,000 Sysco bill" found nothing
  // (each line is $3,000), a four-line bill counted as FOUR items against the bulk cap of three,
  // and the confirm card read "Delete 3 transactions" for one bill. One representative row per
  // entry, at the entry's total; an id cited off any of the entry's lines resolves to the entry.
  const entries = invoices || [];   // C546 — recode reads LINES; the per-entry view is built below
  const perEntryRows = perEntry(invoices);
  const liveInv = perEntryRows.filter((i) => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at);
  const baseOf = (id) => String(id ?? "").split("_")[0];
  const byId = (id) => perEntryRows.filter((i) => String(i.id) === String(id) || String(i.db_entry_id ?? "") === String(id) || (String(id ?? "").includes("_") && baseOf(i.id) === baseOf(id)));
  switch (a.type) {
    case "recode":
    case "retag_project": {
      // A recode is per LINE (each line has its own category), so an exact row-id match is the
      // primary rule — unchanged.
      const ids = Array.isArray(a.invoiceIds) ? a.invoiceIds.map(String) : [];
      const exact = invoices.filter((i) => ids.includes(String(i.id)));
      if (exact.length) return exact;
      // ★★ C546 — AND THE ENTRY'S ID RESOLVES TOO. `delete_invoice` has accepted "the id of any
      // line of the entry" since C519; recode was left on the exact row id alone, so a model
      // naming the CHARGE — the natural thing for a one-line bill, and what it had just been
      // handed — resolved to nothing, the executor moved nothing, and the reply blamed the
      // connection. Ambiguity is refused rather than guessed at: an entry with several category
      // lines returns none, because which line was meant is not ours to decide.
      const lines = entries.filter((i) => ids.includes(entryBaseOf(i)));
      if (!lines.length) return [];
      const pl = lines.filter((i) => glIsRevenue(i.gl_code) || glIsExpense(i.gl_code));
      const byEntry = new Map();
      for (const l of pl) byEntry.set(entryBaseOf(l), (byEntry.get(entryBaseOf(l)) || 0) + 1);
      return pl.filter((l) => byEntry.get(entryBaseOf(l)) === 1);
    }
    case "delete_invoice": {
      if (a.invoice_id != null) return byId(a.invoice_id);
      if (a.vendor) return liveInv.filter((i) =>
        norm(i.vendor).includes(norm(a.vendor)) &&
        (a.amount == null || Math.abs((Number(i.amount) || 0) - parseFloat(a.amount)) < 1) &&
        (!a.date || i.date === a.date));
      return [];
    }
    case "void_invoice": {
      if (a.invoice_id != null) return byId(a.invoice_id);
      if (a.vendor) return liveInv.filter((i) => norm(i.vendor).includes(norm(a.vendor)));
      return [];
    }
    case "reverse_entry":
      return byId(a.invoice_id);
    // C676 — the bill being paid: by its id, or by vendor (and amount). Only bills still OPEN —
    // recording a second payment against a paid bill would take the money out twice.
    case "record_payment": {
      // ★ C710 — an OPEN BILL is what the Bills screen lists (openPayablesGL: owed through Accounts
      // Payable, no live payment linking it) — not "any entry for that vendor whose flag isn't
      // paid": the flag defaults to unpaid, so an old payment, a cash receipt, or a customer's
      // invoice under the same name was "recorded as paid" too (the card said "3 bills"). With no
      // Accounts Payable account known, nothing qualifies.
      const openBills = apCode ? openPayablesGL(invoices, apCode) : [];
      const openKeys = new Set(openBills.map((i) => entryBaseOf(i)));
      const open = (rows) => {
        const seen = new Set();
        return rows.filter((i) => openKeys.has(entryBaseOf(i)) && !seen.has(entryBaseOf(i)) && seen.add(entryBaseOf(i)))
          .map((i) => openBills.find((b) => entryBaseOf(b) === entryBaseOf(i)) || i);
      };
      if (a.invoice_id != null) return open(byId(a.invoice_id));
      if (a.vendor) {
        const hits = open(openBills.filter((i) =>
          norm(i.vendor).includes(norm(a.vendor)) &&
          (a.amount == null || Math.abs((Number(i.amount) || 0) - parseFloat(a.amount)) < 1)));
        // ★ C687 — one vendor's bills only: "Sam" must not also pay "Samsara". The exact name wins;
        // two different vendors still left → nothing (the card says no bill matched).
        const vendors = new Set(hits.map((i) => norm(i.vendor).trim()));
        if (vendors.size <= 1) return hits;
        const exact = hits.filter((i) => norm(i.vendor).trim() === norm(a.vendor).trim());
        return exact.length ? exact : [];
      }
      return [];
    }
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
  add_rule: "change the rule for",          // C633
  set_contact_rule: "change the rule for",
  update_contact: "change the details for",
  pause_recurring: "pause",
  record_payment: "record a payment for",   // C676
};

// Build the confirmation proposal for a destructive action: a plain-English title,
// the affected line items (with vendor/amount/date), and a count. This is what the
// human approves — resolved from the CURRENT data so it shows exactly what will run.
// C676 — what the confirm card says for "mark these bills paid". Read from the action the model
// proposed; the card lists the bills it resolved to, so the owner sees exactly what will be recorded.
// ★ C687 — the account named on the card is the account the payment will be posted to: resolved
// once here (lib/payFrom.js pickPayFrom) and carried on the action as `pay_from_key`, which the
// executor uses. An account the words don't pin down is said, and nothing is recorded.
export function recordPaymentDescription(a = {}, n = 0, payFrom = undefined) {
  if (!n) return "No open bill matched — nothing would be recorded.";
  if (payFrom === null) return `I couldn't tell which account "${a.paid_from}" is — nothing would be recorded. Tell me the account's name as it appears in Settings.`;
  const from = payFrom ? (payFrom.key === OWN_MONEY ? " with your own money (counted as money you put in)" : ` from ${payFrom.label}`)
    : /^(own|my own|personal|myself)/i.test(String(a.paid_from || "")) ? " with your own money (counted as money you put in)"
    : a.paid_from ? ` from ${a.paid_from}` : "";
  const when = a.paid_date ? ` on ${a.paid_date}` : "";
  return `Record ${n} bill${n === 1 ? "" : "s"} as paid${from}${when}. Nothing is sent — this only records a payment you made.`;
}

export function describeDestructiveAction(action, { invoices = [], contracts = [], rules = [], contactsList = [], payFromOptions = null, apCode = null } = {}) {
  const a = action || {};
  const verb = VERB[a.type] || "change";

  // C633 — the replacing actions say exactly what will be replaced.
  if (["add_rule", "set_contact_rule", "update_contact", "pause_recurring"].includes(a.type)) {
    const r = replacesSavedValue(a, { rules, contacts: contactsList });
    const label = a.vendor || a.name || "this item";
    return { type: a.type, verb, count: 1, targets: [{ label }], description: r.what || `Change ${label}.` };
  }

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
  const rows = resolveActionTargets(a, { invoices, apCode });   // C710 — record_payment needs the bills account
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
  else if (a.type === "record_payment") description = recordPaymentDescription(a, n, payFromOptions ? resolvePayFrom(a, payFromOptions) : undefined);   // C676, C687
  else description = `${verb} ${n} transaction${n === 1 ? "" : "s"}.`;

  return { type: a.type, verb, count: n, targets, description };
}

// Build the full pending-confirmation payload from the destructive actions to stage.
export function buildPendingConfirmation(stageActions = [], ctx = {}) {
  // C687 — a payment carries the account its card names, so Confirm posts exactly there
  const actions = stageActions.map((a) => (a && a.type === "record_payment" && ctx.payFromOptions
    ? { ...a, pay_from_key: resolvePayFrom(a, ctx.payFromOptions)?.key ?? null } : a));
  const items = actions.map((a) => ({ action: a, ...describeDestructiveAction(a, ctx) }));
  return { actions, items };
}
