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
import { existingToldMatch, toldPurchaseDescription, checkToldPurchase } from "./toldPurchase.js";   // C755
import { existingIncomeMatch, openInvoiceMatch, toldIncomeDescription, checkToldIncome, pickReceivedInto } from "./toldIncome.js";   // C776

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
      // C712 — the amount and date narrow a void as they narrow a delete (the ambiguity guard
      // already filtered on them, so "void the $6,000 Sysco bill from Nov 1" saw one, then
      // the card and the executor took every Sysco entry)
      if (a.vendor) return liveInv.filter((i) => norm(i.vendor).includes(norm(a.vendor)) &&
        (a.amount == null || Math.abs((Number(i.amount) || 0) - parseFloat(a.amount)) < 1) &&
        (!a.date || i.date === a.date));
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
  record_purchase: "record a purchase at",   // C755
  record_income: "record money received from",   // C776
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

export function describeDestructiveAction(action, ctx = {}) {
  const { invoices = [], contracts = [], rules = [], contactsList = [], payFromOptions = null, apCode = null, chart = null } = ctx;
  const a = action || {};
  const verb = VERB[a.type] || "change";

  // C633 — the replacing actions say exactly what will be replaced.
  if (["add_rule", "set_contact_rule", "update_contact", "pause_recurring"].includes(a.type)) {
    const r = replacesSavedValue(a, { rules, contacts: contactsList });
    const label = a.vendor || a.name || "this item";
    return { type: a.type, verb, count: 1, targets: [{ label }], description: r.what || `Change ${label}.` };
  }

  // ★ C755 — a purchase the owner told us about: one target, and a sentence read from what WILL be
  // written (the category the code is, the account the money came from), or — when the statement
  // already holds it — that it will only be marked "receipt to come".
  if (a.type === "record_purchase") {
    const existing = a.existing_entry_id != null
      ? (perEntry(invoices || []).find((e) => entryBaseOf(e) === String(a.existing_entry_id)) || null)
      : existingToldMatch(a, invoices, { today: ctx.today || "" });
    const payFrom = payFromOptions ? (a.pay_from_key !== undefined || a.paid_from != null ? resolvePayFrom(a, payFromOptions) : (payFromOptions[0] || null)) : undefined;
    const c = checkToldPurchase(a, { chart: chart || [], today: ctx.today || "" });
    const label = `${a.vendor || "A purchase"}${Number(a.amount) > 0 ? ` · ${money(a.amount)}` : ""}`;
    return { type: a.type, verb, count: existing || c.ok ? 1 : 0, targets: [{ label }],
      description: toldPurchaseDescription(a, { chart: chart || [], payFrom, existing, today: ctx.today || "" }) };
  }

  // ★ C776 — money the owner says they received: one target; the sentence reads what WILL be
  // written (the deposit already in the books, the invoice it pays, or the new income and where it
  // landed). The match and the account are fixed at staging (`buildPendingConfirmation`).
  if (a.type === "record_income") {
    const r = resolveIncome(a, ctx);
    const label = `${a.customer || a.vendor || "A payment"}${Number(a.amount) > 0 ? ` · ${money(a.amount)}` : ""}`;
    const c = checkToldIncome(a, { chart: chart || [], today: ctx.today || "", defaultIncomeCode: ctx.defaultIncomeCode || null });
    return { type: a.type, verb, count: r.existing ? 0 : (r.openInvoice || c.ok) && r.into ? 1 : 0, targets: [{ label }],
      description: toldIncomeDescription(a, { chart: chart || [], receivedInto: r.into, existing: r.existing, openInvoice: r.openInvoice, today: ctx.today || "", defaultIncomeCode: ctx.defaultIncomeCode || null }) };
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
  // ★ C712 — the card names the category the CODE is (what gets written), not the model's label for
  // it: code 6600 + "Software" said "to Software" and booked Office Supplies. A code not on the
  // chart is said, and the executor refuses it (no category is created behind the owner's back).
  if (a.type === "recode") {
    const acct = chart ? (chart || []).find((x) => String(x.code) === String(a.gl_code)) : null;
    description = chart && !acct
      ? `There's no category numbered ${a.gl_code} on your chart — nothing will be changed. Add it in Settings → Categories first, or name an existing one.`
      : `Recategorize ${n} transaction${n === 1 ? "" : "s"}${acct ? ` to ${acct.name}` : a.gl_name ? ` to ${a.gl_name}` : ""}.`;
  }
  else if (a.type === "retag_project") description = `Re-tag ${n} transaction${n === 1 ? "" : "s"}${a.project ? ` to project “${a.project}”` : ""}.`;
  else if (a.type === "delete_invoice") description = `Delete ${n} transaction${n === 1 ? "" : "s"} (recoverable from the audit trail).`;
  else if (a.type === "void_invoice") description = `Undo ${n} transaction${n === 1 ? "" : "s"} (kept on the audit trail).`;
  else if (a.type === "reverse_entry") description = `Undo ${n} transaction${n === 1 ? "" : "s"} by posting an offsetting entry.`;
  else if (a.type === "record_payment") description = recordPaymentDescription(a, n, payFromOptions ? resolvePayFrom(a, payFromOptions) : undefined);   // C676, C687
  else description = `${verb} ${n} transaction${n === 1 ? "" : "s"}.`;

  return { type: a.type, verb, count: n, targets, description };
}

// C776 — what a record_income resolves to, from the action as staged (ids/keys fixed) or, before
// staging, from the data: a deposit already booked, an open invoice it pays, and where it landed.
export function resolveIncome(a = {}, ctx = {}) {
  const live = ctx.invoices || [];
  const opts = ctx.receivedIntoOptions || [];
  const existing = a.existing_entry_id !== undefined
    ? (a.existing_entry_id == null ? null : (perEntry(live).find((e) => entryBaseOf(e) === String(a.existing_entry_id)) || null))
    : existingIncomeMatch(a, live, { today: ctx.today || "" });
  const openInvoice = a.invoice_id !== undefined
    ? (a.invoice_id == null ? null : ((ctx.openItems || []).find((i) => String(i.id) === String(a.invoice_id)) || null))
    : openInvoiceMatch(a, ctx.openItems || [], { arCode: ctx.arCode ?? null });
  const into = a.received_into_key !== undefined
    ? (a.received_into_key == null ? null : (opts.find((o) => o.key === a.received_into_key) || null))
    : pickReceivedInto(opts, a.received_into);
  return { existing, openInvoice, into };
}

// Build the full pending-confirmation payload from the destructive actions to stage.
export function buildPendingConfirmation(stageActions = [], ctx = {}) {
  // C687 — a payment carries the account its card names, so Confirm posts exactly there
  const actions = stageActions.map((a) => {
    if (a && a.type === "record_payment" && ctx.payFromOptions) return { ...a, pay_from_key: resolvePayFrom(a, ctx.payFromOptions)?.key ?? null };
    // C755 — the card and Confirm must do the same thing: the entry already in the books (if the
    // statement holds this purchase) and the account the money came from are fixed HERE, at staging.
    if (a && a.type === "record_purchase") {
      const existing = existingToldMatch(a, ctx.invoices || [], { today: ctx.today || "" });
      const opts = ctx.payFromOptions || null;
      const from = opts ? (a.paid_from != null && String(a.paid_from).trim() ? resolvePayFrom(a, opts) : (opts[0] || null)) : null;
      return { ...a, existing_entry_id: existing ? entryBaseOf(existing) : null, pay_from_key: existing ? null : (from ? from.key : null), date: a.date || ctx.today || "" };
    }
    // C776 — the card and Confirm do the same thing: the match and the account are fixed here.
    if (a && a.type === "record_income") {
      const r = resolveIncome(a, ctx);
      return { ...a, existing_entry_id: r.existing ? entryBaseOf(r.existing) : null, invoice_id: r.openInvoice ? r.openInvoice.id : null,
        received_into_key: r.into ? r.into.key : null, date: a.date || ctx.today || "" };
    }
    return a;
  });
  const items = actions.map((a) => ({ action: a, ...describeDestructiveAction(a, ctx) }));
  return { actions, items };
}
