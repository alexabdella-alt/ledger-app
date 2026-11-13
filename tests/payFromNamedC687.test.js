// C687 — the assistant pays from the account its confirm card names, or asks (review of C676).
import { describe, it, expect } from "vitest";
import { pickPayFrom, OWN_MONEY } from "../src/lib/payFrom.js";
import { buildPendingConfirmation, resolveActionTargets, resolvePayFrom } from "../src/lib/aiActionGate.js";
import { readFileSync } from "node:fs";

const OPTS = [
  { key: "acct:K", label: "Chase Checking", name: "Chase Checking" },
  { key: "acct:S", label: "Chase Savings", name: "Chase Savings" },
  { key: "acct:C", label: "Amex Business (card)", name: "Amex Business" },
  { key: OWN_MONEY, label: "My own money (personal card or cash)" },
];
const LEDGER = [
  { id: "b1", vendor: "Sam's Design", amount: 500, gl_code: "6800", entry_date: "2026-10-01", payment_status: "unpaid", secondary_gl_code: "2000", status: "booked" },
  { id: "b2", vendor: "Samsara", amount: 300, gl_code: "6500", entry_date: "2026-10-02", payment_status: "unpaid", secondary_gl_code: "2000", status: "booked" },
  { id: "b3", vendor: "Adobe", amount: 59.99, gl_code: "6500", entry_date: "2026-10-03", payment_status: "unpaid", secondary_gl_code: "2000", status: "booked" },
];

describe("C687 — the owner's words pick one account, or none", () => {
  const cases = { "": "acct:K", "the Amex": "acct:C", "Amex card": "acct:C", "my savings": "acct:S", "checking": "acct:K",
    "Chase Checking": "acct:K", "the card": "acct:C", "my own money": OWN_MONEY, "my personal card": OWN_MONEY, "cash": OWN_MONEY };
  for (const [said, key] of Object.entries(cases)) it(`"${said}" → ${key}`, () => expect(pickPayFrom(OPTS, said)?.key).toBe(key));
  for (const said of ["chase", "bank", "Wells Fargo", "some bank we don't have"]) it(`"${said}" → asks (null)`, () => expect(pickPayFrom(OPTS, said)).toBe(null));
  it("an account called cash wins over own money", () => {
    expect(pickPayFrom([...OPTS, { key: "acct:P", label: "Petty Cash", name: "Petty Cash" }], "cash").key).toBe("acct:P");
  });
});

describe("C687 — the card names the account the payment posts to", () => {
  it("staging carries the resolved key and the card names that account", () => {
    const st = buildPendingConfirmation([{ type: "record_payment", invoice_id: "b3", paid_from: "the Amex" }], { invoices: LEDGER, payFromOptions: OPTS, apCode: "2000" });
    expect(st.actions[0].pay_from_key).toBe("acct:C");
    expect(st.items[0].description).toMatch(/from Amex Business \(card\)/);
    expect(resolvePayFrom(st.actions[0], OPTS).key).toBe("acct:C");
  });
  it("an account it can't pin down is said on the card, and the executor records nothing", () => {
    const st = buildPendingConfirmation([{ type: "record_payment", invoice_id: "b3", paid_from: "Wells Fargo" }], { invoices: LEDGER, payFromOptions: OPTS, apCode: "2000" });
    expect(st.actions[0].pay_from_key).toBe(null);
    expect(st.items[0].description).toMatch(/couldn't tell which account "Wells Fargo" is — nothing would be recorded/);
    expect(resolvePayFrom(st.actions[0], OPTS)).toBe(null);
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const from = resolvePayFrom\(action, opts\);[\s\S]{0,120}if \(!from\) summary\.push\(`Couldn't tell which account/);
    expect(app).toMatch(/buildPendingConfirmation\(destructiveActions, \{[^}]*contactsList: contacts,[^\n]*\s*payFromOptions: payFromOptions\(/);
  });
});

describe("C687 — one vendor's bills only", () => {
  it("'Sam' does not also pay Samsara", () => {
    expect(resolveActionTargets({ type: "record_payment", vendor: "sam" }, { invoices: LEDGER, apCode: "2000" })).toEqual([]);
    expect(resolveActionTargets({ type: "record_payment", vendor: "Samsara" }, { invoices: LEDGER, apCode: "2000" }).map((i) => i.id)).toEqual(["b2"]);
    expect(resolveActionTargets({ type: "record_payment", vendor: "adobe" }, { invoices: LEDGER, apCode: "2000" }).map((i) => i.id)).toEqual(["b3"]);
  });
});
