import { describe, it, expect } from "vitest";
import {
  AI_ALLOWED_ACTIONS, AI_DESTRUCTIVE_ACTIONS, isDestructiveAIAction, isMutatingAIAction,
} from "../src/lib/aiCapabilities.js";
import {
  partitionAIActions, routeAIActions, describeDestructiveAction, resolveActionTargets, buildPendingConfirmation,
} from "../src/lib/aiActionGate.js";

// ════════════════════════════════════════════════════════════════════════════
// CR-9 / O81 part 2 — the code-level confirmation gate for destructive AI actions.
// Destructive actions (void/delete/recode/retag/reverse/delete-rule) must NOT
// execute from the chat tool loop; the dispatch STAGES them behind a human Confirm,
// and the mutation runs only on Confirm. These tests lock the gate logic:
//   • classification is complete (no destructive action routed as safe)
//   • destructive actions STAGE, never execute inline (no mutation until confirm)
//   • confirm runs the staged actions; cancel discards them with no write
//   • the confirm proposal shows the FULL affected list (no confirm-one-do-many)
// ════════════════════════════════════════════════════════════════════════════

const DESTRUCTIVE = ["recode", "retag_project", "delete_invoice", "void_invoice", "reverse_entry", "delete_contract", "delete_rule"];

describe("classification is complete and correct", () => {
  it("the destructive set is exactly the 7 mandated actions", () => {
    expect([...AI_DESTRUCTIVE_ACTIONS].sort()).toEqual([...DESTRUCTIVE].sort());
  });
  it("every allowed action is classified; no destructive action is ever 'safe'", () => {
    for (const type of AI_ALLOWED_ACTIONS) {
      const { safe, destructive } = partitionAIActions([{ type }]);
      if (type === "none") { expect(safe).toEqual([]); expect(destructive).toEqual([]); continue; }
      if (DESTRUCTIVE.includes(type)) {
        expect(destructive.map(a => a.type)).toEqual([type]);
        expect(safe).toEqual([]);   // a destructive action must NEVER land in the safe bucket
      } else {
        expect(safe.map(a => a.type)).toEqual([type]);
        expect(destructive).toEqual([]);
      }
    }
  });
  it("destructive actions are a subset of mutating actions (read-only never staged)", () => {
    for (const type of AI_ALLOWED_ACTIONS) {
      if (isDestructiveAIAction(type)) expect(isMutatingAIAction(type)).toBe(true);
    }
  });
});

describe("routing: destructive STAGES, safe EXECUTES", () => {
  const actions = [
    { type: "render_chart", data: [{ label: "a", value: 1 }] },   // safe
    { type: "add_rule", vendor: "Acme" },                          // safe (additive/reversible)
    { type: "void_invoice", invoice_id: "i1" },                    // destructive
    { type: "delete_invoice", vendor: "Acme" },                    // destructive
    { type: "none" },                                              // dropped
  ];
  it("routes safe→execute, destructive→stage", () => {
    const { execute, stage } = routeAIActions(actions);
    expect(execute.map(a => a.type)).toEqual(["render_chart", "add_rule"]);
    expect(stage.map(a => a.type)).toEqual(["void_invoice", "delete_invoice"]);
  });
  it("a blocked batch (member/ambiguous/bulk) stages NOTHING", () => {
    const { execute, stage } = routeAIActions(actions, { blocked: true });
    expect(stage).toEqual([]);
    expect(execute.map(a => a.type)).toEqual(["render_chart", "add_rule"]);  // safe still allowed; reply handles refusal
  });
});

describe("the gate: no mutation until confirm; cancel writes nothing", () => {
  // A faithful simulation of the dispatch: safe actions run immediately; destructive
  // ones only run when the human "confirms". The executor is the write path.
  const run = (actions, decision /* "confirm" | "cancel" */) => {
    const executed = [];
    const executor = (a) => executed.push(a.type);
    const { execute, stage } = routeAIActions(actions);
    execute.forEach(executor);                 // immediate (safe only)
    const afterSend = [...executed];           // snapshot: what ran on send
    if (decision === "confirm") stage.forEach(executor);   // confirmAIActions
    // decision === "cancel" → stage discarded, nothing runs
    return { afterSend, afterDecision: executed };
  };

  const actions = [
    { type: "render_summary", metrics: [{ label: "x", value: 1 }] },
    { type: "void_invoice", invoice_id: "i1" },
    { type: "recode", invoiceIds: ["i2"], gl_code: "6500" },
  ];

  it("on send, ONLY the safe action executes — destructive ones are staged, not run", () => {
    const { afterSend } = run(actions, "cancel");
    expect(afterSend).toEqual(["render_summary"]);        // void + recode did NOT run
  });
  it("CONFIRM runs the staged destructive actions (through the verified path)", () => {
    const { afterDecision } = run(actions, "confirm");
    expect(afterDecision).toEqual(["render_summary", "void_invoice", "recode"]);
  });
  it("CANCEL discards the staged actions — no write ever happens", () => {
    const { afterDecision } = run(actions, "cancel");
    expect(afterDecision).toEqual(["render_summary"]);    // still only the safe one
  });
});

describe("the confirm proposal shows the FULL affected list (no confirm-one-do-many)", () => {
  const invoices = [
    { id: "i1", vendor: "Adobe", amount: 194.83, date: "2026-06-09", gl_name: "Software", status: "posted" },
    { id: "i2", vendor: "Adobe", amount: 194.83, date: "2026-05-08", gl_name: "Software", status: "posted" },
    { id: "i3", vendor: "AWS",   amount: 500.00, date: "2026-06-01", gl_name: "Software", status: "posted" },
  ];
  const contracts = [{ id: "c1", counterparty: "WeWork" }];

  it("void by vendor resolves EVERY matching entry for the confirm list", () => {
    const d = describeDestructiveAction({ type: "void_invoice", vendor: "Adobe" }, { invoices });
    expect(d.count).toBe(2);
    expect(d.targets.map(t => t.id).sort()).toEqual(["i1", "i2"]);
    expect(d.targets[0].label).toMatch(/Adobe/);
    expect(d.targets[0].label).toMatch(/\$194\.83/);   // amount shown, to the cent
  });
  it("delete by id resolves exactly that entry", () => {
    const rows = resolveActionTargets({ type: "delete_invoice", invoice_id: "i3" }, { invoices });
    expect(rows.map(r => r.id)).toEqual(["i3"]);
  });
  it("recode describes the target count + destination category (plain language)", () => {
    const d = describeDestructiveAction({ type: "recode", invoiceIds: ["i1", "i2"], gl_name: "Marketing" }, { invoices });
    expect(d.count).toBe(2);
    expect(d.description).toMatch(/Recategorize 2 transactions to Marketing/);
    expect(d.description).not.toMatch(/\bGL\b|\b6\d{3}\b|debit|credit|journal/i);   // Cardinal Principle
  });
  it("delete_contract resolves the contract by counterparty", () => {
    const d = describeDestructiveAction({ type: "delete_contract", counterparty: "WeWork" }, { contracts });
    expect(d.count).toBe(1);
    expect(d.targets[0].label).toMatch(/WeWork/);
  });
  it("buildPendingConfirmation packages actions + items together", () => {
    const p = buildPendingConfirmation([{ type: "void_invoice", vendor: "Adobe" }], { invoices, contracts });
    expect(p.actions).toHaveLength(1);
    expect(p.items[0].type).toBe("void_invoice");
    expect(p.items[0].count).toBe(2);
  });
});
