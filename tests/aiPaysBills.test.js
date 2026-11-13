import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { executeAITool } from "../src/lib/aiTools.js";
import { resolveActionTargets, describeDestructiveAction, partitionAIActions } from "../src/lib/aiActionGate.js";
import { pickPayFrom, OWN_MONEY } from "../src/lib/payFrom.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// C676 — the assistant lists bills to pay and records a payment the owner made (confirmed first).
const byRole = Object.fromEntries(DEFAULT_CHART_OF_ACCOUNTS.map((a) => [a.system_role, a]));
const getAccountByRole = (r) => byRole[r] || null;
const bill = (id, vendor, amount, due, extra = {}) => ({ id, db_entry_id: id, vendor, amount, date: "2026-11-01", due_date: due, gl_code: "6500", gl_name: "Software",
  secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable", debit_credit: "debit", type: "expense", status: "posted", payment_status: "unpaid", ...extra });
const LEDGER = [
  bill("b1", "Adobe", 59.99, "2020-01-01"),
  bill("b2", "Rent LLC", 2000, "2999-01-01"),
  bill("b3", "Paid Co", 10, "2020-01-01", { payment_status: "paid" }),
];
const ctx = { getLedger: async () => LEDGER, getAccountByRole, payFromLabels: ["Checking", "Amex (card)", "My own money (personal card or cash)"] };

describe("★ get_bills_to_pay", () => {
  it("open bills only, overdue first, each with the id record_payment needs, and where a payment can come from", async () => {
    const out = await executeAITool("get_bills_to_pay", { within_days: 400000 }, ctx);
    expect(out.bills.map((b) => [b.invoice_id, b.vendor, b.status])).toEqual([["b1", "Adobe", "overdue"], ["b2", "Rent LLC", "due soon"]]);
    expect(out.due_soon_total_display).toBe("$2,059.99");   // C712 — the listed part, named for what it is
    // and everything owed — the bills account's balance, as Home shows it: "Paid Co" is flagged paid but
    // no payment was ever booked, so the books still owe its $10 (§9: the ledger, not the flag)
    expect(out.owed_in_all_display).toBe("$2,069.99");
    expect(out.paid_from_choices).toEqual(ctx.payFromLabels);
  });
  it("by default, bills due more than 30 days out are left off (overdue are always in)", async () => {
    expect((await executeAITool("get_bills_to_pay", {}, ctx)).bills.map((b) => b.invoice_id)).toEqual(["b1"]);
  });
});

describe("★ record_payment", () => {
  it("is held for the owner's confirmation, never run straight from the reply", () => {
    expect(partitionAIActions([{ type: "record_payment", invoice_id: "b1" }]).destructive.map((a) => a.type)).toEqual(["record_payment"]);
  });
  it("matches only bills still open — never a second payment against a paid one", () => {
    expect(resolveActionTargets({ type: "record_payment", invoice_id: "b3" }, { invoices: LEDGER, apCode: "2000" })).toEqual([]);
    expect(resolveActionTargets({ type: "record_payment", vendor: "adobe", amount: 59.99 }, { invoices: LEDGER, apCode: "2000" }).map((i) => i.id)).toEqual(["b1"]);
  });
  it("the confirm card says what will be recorded, from where, and that nothing is sent", () => {
    const d = describeDestructiveAction({ type: "record_payment", invoice_id: "b1", paid_from: "my own money", paid_date: "2026-11-12" }, { invoices: LEDGER, apCode: "2000" });
    expect(d.description).toBe("Record 1 bill as paid with your own money (counted as money you put in) on 2026-11-12. Nothing is sent — this only records a payment you made.");
    expect(d.targets[0].label).toMatch(/^Adobe · \$59\.99/);
  });
  it("the account the owner named, in their words", () => {
    const opts = [{ key: "acct:K", label: "Checking", name: "Checking" }, { key: "acct:C", label: "Amex (card)", name: "Amex" }, { key: OWN_MONEY, label: "My own money (personal card or cash)" }];
    expect(pickPayFrom(opts, "my own money").key).toBe(OWN_MONEY);
    expect(pickPayFrom(opts, "personal card").key).toBe(OWN_MONEY);
    expect(pickPayFrom(opts, "amex").key).toBe("acct:C");
    expect(pickPayFrom(opts, "").key).toBe("acct:K");
    expect(pickPayFrom(opts, "some bank we don't have")).toBe(null);   // C687 — never a guess: the assistant asks
  });
  it("the app records it through the same path as the payment forms", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/if \(action\.type === "record_payment"\) \{[\s\S]{0,900}const n = await markPaid\(bills\.map\(b => b\.id\), action\.method \|\| "ach", \{ date: action\.paid_date \|\| undefined, payFrom: from \}\);/);
  });
  it("the server knows the tool and the action, and says it never sends money", () => {
    const srv = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(srv).toMatch(/name: "get_bills_to_pay"/);
    expect(srv).toMatch(/"type": "record_payment"/);
    expect(srv).toMatch(/You cannot send money/);
  });
});
