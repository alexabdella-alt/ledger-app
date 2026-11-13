// C710 — fixes from the bills-and-invoices audit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolveActionTargets } from "../src/lib/aiActionGate.js";
import { payFromForMethod } from "../src/lib/payFrom.js";
import { invoiceStatusFromBooks } from "../src/lib/invoiceMarkPaid.js";
import { matchAmountProblem } from "../src/lib/bankMatch.js";

const app = readFileSync("src/App.jsx", "utf8");

describe("C710 — the assistant pays open bills only", () => {
  const L = [
    { id: "old", db_entry_id: "old", vendor: "Acme Supply", amount: 300, gl_code: "6600", secondary_gl_code: "2000", debit_credit: "debit", status: "posted", payment_status: "paid" },
    { id: "pay", db_entry_id: "pay", vendor: "Payment – Acme Supply", amount: 300, gl_code: "2000", secondary_gl_code: "1000", status: "posted", payment_status: "unpaid", import_metadata: { kind: "ap_payment", payment_for: "old" } },
    { id: "cash", db_entry_id: "cash", vendor: "Acme Supply", amount: 45, gl_code: "6600", secondary_gl_code: "1000", debit_credit: "debit", status: "posted", payment_status: "unpaid" },
    { id: "inv", db_entry_id: "inv", vendor: "Acme Supply", amount: 90, gl_code: "4000", secondary_gl_code: "1100", debit_credit: "credit", status: "posted", payment_status: "unpaid" },
    { id: "new", db_entry_id: "new", vendor: "Acme Supply", amount: 500, gl_code: "6600", secondary_gl_code: "2000", debit_credit: "debit", status: "posted", payment_status: "unpaid" },
  ];
  it("'record a payment for Acme Supply' → the one open bill, not the old payment, the cash receipt or the customer invoice", () => {
    expect(resolveActionTargets({ type: "record_payment", vendor: "Acme Supply" }, { invoices: L, apCode: "2000" }).map((r) => r.id)).toEqual(["new"]);
    expect(resolveActionTargets({ type: "record_payment", invoice_id: "cash" }, { invoices: L, apCode: "2000" })).toEqual([]);
    expect(resolveActionTargets({ type: "record_payment", vendor: "Acme Supply" }, { invoices: L })).toEqual([]);   // no bills account known → nothing
  });
  it("the app passes the bills account to both the confirm card and the executor", () => {
    expect(app).toMatch(/const bills = resolveActionTargets\(action, \{ invoices, contracts, apCode: getAccountByRole\?\.\("accounts_payable"\)\?\.code \}\);/);
    expect(app).toMatch(/contactsList: contacts, apCode: getAccountByRole\?\.\("accounts_payable"\)\?\.code,/);
  });
});

describe("C710 — 'Credit Card' as the method picks the card account", () => {
  const opts = [{ key: "acct:k", label: "Checking" }, { key: "acct:c", label: "Amex (card)" }, { key: "own", label: "My own money" }];
  it("switches to the card; leaves a chosen card alone; other methods change nothing", () => {
    expect(payFromForMethod(opts, "card", "acct:k")).toBe("acct:c");
    expect(payFromForMethod(opts, "card", "acct:c")).toBe("acct:c");
    expect(payFromForMethod(opts, "check", "acct:k")).toBe("acct:k");
    expect(payFromForMethod([{ key: "acct:k", label: "Checking" }], "card", "acct:k")).toBe("acct:k");
  });
  it("Home's bills panel has the Paid-from choice and passes it", () => {
    const home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(home).toMatch(/markPaid\(inv\.id, apPayMethod, \{ date: apPayDate, payFrom: payFromByKey\(apPayFromOpts, apPayFrom\) \}\)/);
    expect(home).toMatch(/<PayFromSelect value=\{apPayFrom\}/);
  });
  it("the toast names the account, never the method; an existing payment is said, not re-announced", () => {
    expect(app).toMatch(/showNotification\(`Payment recorded — \$\{from \? paidFromCopy\(from\) : `paid from \$\{ownerAccountName\(rn\("cash"\) \|\| "Cash"\)\}`\} ✓`\)/);
    expect(app).toMatch(/return alreadyPaid \? "already" : true;/);
    expect(app).toMatch(/That bill already had a payment recorded — nothing new was added\./);
  });
});

describe("C710 — an invoice's status follows the books", () => {
  const ledger = (status) => [{ id: "je1", db_entry_id: "je1", payment_status: status }];
  it("collected elsewhere → paid; collection removed → sent; nothing loaded → as saved", () => {
    expect(invoiceStatusFromBooks({ status: "sent", ledger_id: "je1" }, ledger("collected"))).toBe("paid");
    expect(invoiceStatusFromBooks({ status: "sent", ledger_id: "je1" }, ledger("unpaid"), new Set(["je1"]))).toBe("paid");
    expect(invoiceStatusFromBooks({ status: "paid", ledger_id: "je1" }, ledger("unpaid"))).toBe("sent");
    expect(invoiceStatusFromBooks({ status: "paid", ledger_id: "je1" }, [])).toBe("paid");
    expect(invoiceStatusFromBooks({ status: "draft", ledger_id: null }, [])).toBe("draft");
  });
});

describe("C710 — a bank match for a different amount isn't cleared or dropped", () => {
  const bill = [{ id: "b1", amount: 1000 }];
  it("$980 against $1,000 is a problem; equal amounts aren't", () => {
    expect(matchAmountProblem({ invoice_ids: ["b1"], bank_txn: { amount: -980 } }, bill)).toEqual({ bank: 980, owed: 1000 });
    expect(matchAmountProblem({ invoice_ids: ["b1"], bank_txn: { amount: -1000 } }, bill)).toBe(null);
  });
  it("applyMatch refuses and keeps it in the queue; the partial flag-only branch is gone", () => {
    const fn = app.slice(app.indexOf("const applyMatchOnce = async"), app.indexOf("const applyMatchOnce = async") + 4000);
    expect(fn).toMatch(/const amountProblem = matchAmountProblem\(matchRecord, invoicesRef\.current \|\| \[\]\);/);
    expect(fn.indexOf("return;")).toBeLessThan(fn.indexOf("setMatchQueue(prev => prev.filter("));
    expect(fn).not.toMatch(/payment_status: "partial"/);
  });
});

describe("C710 — a view-only teammate isn't offered Mark as Paid in the detail panel", () => {
  it("gated", () => {
    expect(readFileSync("src/components/TransactionDetailPanel.jsx", "utf8")).toMatch(/\{!isViewer && cls\.settleAction === "pay" && \(/);
  });
});
