// ★ C755 — "JUST PAID FOR IT, RECEIPT LATER": a purchase told to the assistant is recorded once (never
// twice — not when the statement arrives, not when the receipt arrives), and Home lists the receipts
// worth adding, each one tap from being filed with its purchase.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  checkToldPurchase, existingToldMatch, buildToldPurchase, toldPurchaseDescription, receiptsToAdd,
  isToldPurchase, sameVendor, withEntryMetaFlag, RECEIPT_THRESHOLD,
} from "../src/lib/toldPurchase.js";
import { markAlreadyBooked } from "../src/lib/openingBalanceProposal.js";
import { settlementCandidates, planInvoiceArrival, ARRIVAL } from "../src/lib/invoicePayment.js";
import { buildPendingConfirmation, describeDestructiveAction } from "../src/lib/aiActionGate.js";
import { AI_ALLOWED_ACTIONS, AI_DESTRUCTIVE_ACTIONS } from "../src/lib/aiCapabilities.js";
import { payFromOptions, OWN_MONEY } from "../src/lib/payFrom.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import ReceiptsToAdd from "../src/components/ReceiptsToAdd.jsx";

const CHART = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities", system_role: "accounts_payable" },
  { code: "3300", name: "Owner Contributions", category: "Equity", system_role: "owner_contributions" },
  { code: "4000", name: "Sales", category: "Revenue" },
  { code: "6600", name: "Office Supplies", category: "Expenses" },
  { code: "6400", name: "Travel & Entertainment", category: "Expenses" },
];
const TODAY = "2026-11-19";
const BANK = { key: "acct:b1", label: "Chase Checking", code: "1000", name: "Chase Checking" };
const OWN = { key: OWN_MONEY, label: "My own money (personal card or cash)", code: "3300", name: "Owner Contributions" };
const said = { vendor: "Home Depot", amount: 86, date: "2026-11-10", description: "shelving", gl_code: "6600", paid_from: "business checking" };

// A bank-booked expense row (Dr expense / Cr cash), and a told purchase as the ledger holds it.
const bankRow = (id, vendor, amount, date, extra = {}) => ({ id, db_entry_id: id, vendor, amount, date, gl_code: "6600", gl_name: "Office Supplies", secondary_gl_code: "1000", debit_credit: "debit", status: "booked", source: "bank_import", import_metadata: {}, ...extra });
const told = (id, extra = {}) => ({ ...buildToldPurchase(said, { chart: CHART, payFrom: BANK, today: TODAY, id, bookedAt: "x" }), db_entry_id: id, ...extra });

describe("C755 — what the assistant proposes is checked before anything is recorded", () => {
  it("★★ a complete purchase passes; the date defaults to today", () => {
    const c = checkToldPurchase({ ...said, date: undefined }, { chart: CHART, today: TODAY });
    expect(c.ok).toBe(true);
    expect(c.date).toBe(TODAY);
    expect(c.acct.name).toBe("Office Supplies");
  });
  it("★★ no amount, no store, an unknown or non-spending category → refused, with the reason", () => {
    expect(checkToldPurchase({ ...said, amount: 0 }, { chart: CHART, today: TODAY }).reason).toMatch(/amount/);
    expect(checkToldPurchase({ ...said, vendor: " " }, { chart: CHART, today: TODAY }).reason).toMatch(/where you bought it/);
    expect(checkToldPurchase({ ...said, gl_code: "9999" }, { chart: CHART, today: TODAY }).reason).toMatch(/no category numbered 9999/);
    expect(checkToldPurchase({ ...said, gl_code: "4000" }, { chart: CHART, today: TODAY }).reason).toMatch(/Sales isn't a spending category/);
  });
  it("★★ the entry: Dr the category, Cr the account the money came from, paid, marked told + receipt to come", () => {
    const inv = buildToldPurchase(said, { chart: CHART, payFrom: BANK, today: TODAY, id: "n1", bookedAt: "t" });
    expect(inv).toMatchObject({ vendor: "Home Depot", amount: 86, date: "2026-11-10", gl_code: "6600", gl_name: "Office Supplies",
      secondary_gl_code: "1000", debit_credit: "debit", payment_status: "paid", import_metadata: { told: "assistant", receipt_to_come: true } });
    const mine = buildToldPurchase(said, { chart: CHART, payFrom: OWN, today: TODAY, id: "n2", bookedAt: "t" });
    expect(mine.secondary_gl_code).toBe("3300");
    expect(mine.payment_method_used).toBe("personal");
    expect(buildToldPurchase(said, { chart: CHART, payFrom: null, today: TODAY })).toBeNull();
  });
  it("★★ the card names the category the CODE is and the account the money came from (not the model's words)", () => {
    const d = toldPurchaseDescription({ ...said, gl_name: "Software" }, { chart: CHART, payFrom: BANK, today: TODAY });
    expect(d).toBe("Record $86.00 · Home Depot (shelving) · Office Supplies · Nov 10, 2026 · paid from Chase Checking · receipt to come.");
    expect(toldPurchaseDescription(said, { chart: CHART, payFrom: OWN, today: TODAY })).toMatch(/paid with your own money \(counted as money you put in\)/);
    expect(toldPurchaseDescription(said, { chart: CHART, payFrom: null, today: TODAY })).toMatch(/couldn't tell which account/);
  });
});

describe("C755 — never counted twice: the statement came FIRST", () => {
  it("★★★ the same store, the same amount to the cent, a few days apart → that entry", () => {
    const e = bankRow("b9", "THE HOME DEPOT #4512", 86, "2026-11-12");
    expect(existingToldMatch(said, [e], { today: TODAY })?.id).toBe("b9");
  });
  it("★★ a different amount, another store, too far apart, or two candidates → none (it's recorded as new)", () => {
    expect(existingToldMatch(said, [bankRow("b1", "Home Depot", 86.5, "2026-11-12")])).toBeNull();
    expect(existingToldMatch(said, [bankRow("b2", "Lowe's", 86, "2026-11-12")])).toBeNull();
    expect(existingToldMatch(said, [bankRow("b3", "Home Depot", 86, "2026-12-01")])).toBeNull();
    expect(existingToldMatch(said, [bankRow("b4", "Home Depot", 86, "2026-11-11"), bankRow("b5", "Home Depot", 86, "2026-11-12")])).toBeNull();
  });
  it("★★ a payment, a corrected entry, or another told purchase is never the match", () => {
    expect(existingToldMatch(said, [bankRow("p1", "Home Depot", 86, "2026-11-12", { gl_code: "2000", import_metadata: { kind: "ap_payment", payment_for: "x" } })])).toBeNull();
    expect(existingToldMatch(said, [bankRow("r1", "Home Depot", 86, "2026-11-12", { reversed_by: "r2" })])).toBeNull();
    expect(existingToldMatch(said, [told("t1")])).toBeNull();
  });
  it("★★★ staging fixes the card and Confirm to the same thing: the existing entry, no new account", () => {
    const opts = [BANK, OWN];
    const st = buildPendingConfirmation([{ type: "record_purchase", ...said }], { invoices: [bankRow("b9", "Home Depot", 86, "2026-11-12")], chart: CHART, payFromOptions: opts, today: TODAY });
    expect(st.actions[0]).toMatchObject({ existing_entry_id: "b9", pay_from_key: null });
    expect(st.items[0].description).toMatch(/already in your books .* won't be recorded twice/);
    const fresh = buildPendingConfirmation([{ type: "record_purchase", ...said }], { invoices: [], chart: CHART, payFromOptions: opts, today: TODAY });
    expect(fresh.actions[0]).toMatchObject({ existing_entry_id: null, pay_from_key: "acct:b1" });
    expect(fresh.items[0].description).toMatch(/^Record \$86\.00 · Home Depot/);
    const own = buildPendingConfirmation([{ type: "record_purchase", ...said, paid_from: "my own money" }], { invoices: [], chart: CHART, payFromOptions: opts, today: TODAY });
    expect(own.actions[0].pay_from_key).toBe(OWN_MONEY);
    const unknown = buildPendingConfirmation([{ type: "record_purchase", ...said, paid_from: "the Discover card" }], { invoices: [], chart: CHART, payFromOptions: opts, today: TODAY });
    expect(unknown.actions[0].pay_from_key).toBeNull();
    expect(unknown.items[0].description).toMatch(/couldn't tell which account/);
  });
  it("★★ it is an action the assistant may propose, and only behind the confirm card", () => {
    expect(AI_ALLOWED_ACTIONS).toContain("record_purchase");
    expect(AI_DESTRUCTIVE_ACTIONS.has("record_purchase")).toBe(true);
    expect(describeDestructiveAction({ type: "record_purchase", ...said }, { invoices: [], chart: CHART, payFromOptions: [BANK], today: TODAY }).count).toBe(1);
  });
});

describe("C755 — never counted twice: the statement comes AFTER", () => {
  const line = (date, amount, extra = {}) => ({ date, amount: -amount, description: "HOME DEPOT 4512", ...extra });
  it("★★★ the bank posts it 3 days later → that line is already in the books", () => {
    const out = markAlreadyBooked([line("2026-11-13", 86)], [told("t1")], { offsetCode: "1000" });
    expect(out[0]).toMatchObject({ already_booked: true, told_match: "t1" });
  });
  it("★★ one told purchase claims ONE line — a second identical charge is new", () => {
    const out = markAlreadyBooked([line("2026-11-12", 86), line("2026-11-13", 86)], [told("t1")], { offsetCode: "1000" });
    expect(out.map((t) => t.already_booked)).toEqual([true, false]);
  });
  it("★★ the closest date wins", () => {
    const out = markAlreadyBooked([line("2026-11-17", 86), line("2026-11-11", 86)], [told("t1")], { offsetCode: "1000" });
    expect(out.map((t) => !!t.told_match)).toEqual([false, true]);
  });
  it("★★ a different account, money in, a different amount, or outside the window → not matched", () => {
    expect(markAlreadyBooked([line("2026-11-12", 86)], [told("t1")], { offsetCode: "1010" })[0].already_booked).toBe(false);
    expect(markAlreadyBooked([{ date: "2026-11-12", amount: 86, direction: "in" }], [told("t1")], { offsetCode: "1000" })[0].already_booked).toBe(false);
    expect(markAlreadyBooked([line("2026-11-12", 86.01)], [told("t1")], { offsetCode: "1000" })[0].already_booked).toBe(false);
    expect(markAlreadyBooked([line("2026-11-25", 86)], [told("t1")], { offsetCode: "1000" })[0].already_booked).toBe(false);
    expect(markAlreadyBooked([line("2026-11-05", 86)], [told("t1")], { offsetCode: "1000" })[0].already_booked).toBe(false);
  });
  it("★★ an exact-date match is unchanged, and the told purchase isn't claimed twice through both passes", () => {
    const out = markAlreadyBooked([line("2026-11-10", 86), line("2026-11-12", 86)], [told("t1")], { offsetCode: "1000" });
    expect(out.map((t) => t.already_booked)).toEqual([true, false]);
  });
  it("★ a purchase nobody told us about: unchanged behaviour (exact date only)", () => {
    const out = markAlreadyBooked([line("2026-11-13", 86)], [bankRow("b1", "Home Depot", 86, "2026-11-10")], { offsetCode: "1000" });
    expect(out[0].already_booked).toBe(false);
  });
});

describe("C755 — never counted twice: the receipt comes later", () => {
  const receipt = { id: "u1", vendor: "Home Depot", amount: 86, date: "2026-11-10", type: "expense" };
  it("★★★ paid with the owner's own money (not a bank account) — the receipt is still filed WITH it", () => {
    const mine = told("t9", { secondary_gl_code: "3300", secondary_gl_name: "Owner Contributions" });
    const { candidates } = settlementCandidates(receipt, [mine], { cashCodes: ["1000"] });
    expect(candidates.map((c) => c.entry.id)).toEqual(["t9"]);
    expect(planInvoiceArrival(receipt, [mine], { cashCodes: ["1000"] }).action).toBe(ARRIVAL.ATTACH);
  });
  it("★ an ordinary owner-money entry nobody told us about is unchanged (not treated as paid)", () => {
    const plain = bankRow("o1", "Home Depot", 86, "2026-11-10", { secondary_gl_code: "3300" });
    expect(settlementCandidates(receipt, [plain], { cashCodes: ["1000"] }).candidates).toEqual([]);
  });
  it("★★ the upload that filed it links the document to THAT entry (it was linked to nothing)", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toContain("const primaryId = newInvoices[0]?.id ?? needsClarification[0]?.invoice?.id ?? (attached[0] ? (attached[0].target.db_entry_id ?? attached[0].target.id) : null);");
  });
});

describe("C755 — Receipts to add", () => {
  const doc = (linked) => ({ id: `d-${linked}`, linked_invoice_id: linked });
  const base = [
    told("t1"),                                                                  // told, $86, no receipt
    told("t2", { amount: 12, vendor: "Starbucks" }),                             // told, small — still listed (they said it's coming)
    bankRow("b1", "Sysco", 412.75, "2026-11-01"),                                // recent, $75+, no receipt
    bankRow("b2", "Corner Store", 40, "2026-11-02"),                             // under $75 → not chased
    bankRow("b3", "Old Supplier", 500, "2026-08-01"),                            // too old
    bankRow("b4", "Has Receipt Co", 300, "2026-11-03"),                          // has a receipt
    bankRow("b5", "Waived Co", 300, "2026-11-04", { import_metadata: { receipt_waived: true } }),
    bankRow("b6", "Payment", 300, "2026-11-05", { gl_code: "2000", import_metadata: { kind: "ap_payment", payment_for: "x" } }),
    bankRow("b7", "Gusto", 4306, "2026-11-06", { source: "payroll" }),
    bankRow("b8", "Fixed", 300, "2026-11-07", { reversed_by: "r1" }),
    { ...bankRow("s1", "Toast", 900, "2026-11-08"), gl_code: "4000" },           // money in
    bankRow("b9", "Promised Co", 30, "2026-05-01", { import_metadata: { receipt_to_come: true } }),   // marked "receipt to come" → listed whatever its age
  ];
  const items = () => receiptsToAdd({ invoices: base, docs: [doc("b4")], today: TODAY });
  it("★★★ exactly: told purchases, promised receipts, and recent spending of $75+ with nothing attached", () => {
    expect(items().map((i) => i.entryId).sort()).toEqual(["b1", "b9", "t1", "t2"].sort());
  });
  it("★★ told/promised first, then newest", () => {
    expect(items().map((i) => i.entryId)).toEqual(["t1", "t2", "b9", "b1"]);
    expect(items()[0]).toMatchObject({ vendor: "Home Depot", amount: 86, told: true });
  });
  it("★★ a receipt attached to ANY line of the entry takes it off; so does 'I don't have one'", () => {
    expect(receiptsToAdd({ invoices: base, docs: [doc("b4"), doc("t1")], today: TODAY }).map((i) => i.entryId)).not.toContain("t1");
    const waived = withEntryMetaFlag(base, "b1", "receipt_waived");
    expect(receiptsToAdd({ invoices: waived, docs: [doc("b4")], today: TODAY }).map((i) => i.entryId)).not.toContain("b1");
    expect(waived.find((r) => r.id === "b1").import_metadata).toEqual({ receipt_waived: true });
    expect(waived.find((r) => r.id === "b2").import_metadata).toEqual({});
  });
  it("★ the threshold is $75", () => { expect(RECEIPT_THRESHOLD).toBe(75); });
  it("★ suppliers match loosely, not on two letters", () => {
    expect(sameVendor("Home Depot", "THE HOME DEPOT #4512")).toBe(true);
    expect(sameVendor("Home Depot", "Lowe's")).toBe(false);
    expect(sameVendor("HD", "HD Supply")).toBe(false);
    expect(isToldPurchase(told("x"))).toBe(true);
  });

  it("★★ Home renders the list with one-tap add and 'I don't have one'; nothing when there's nothing", () => {
    const ctx = { invoices: base, docLibrary: [doc("b4")], attachReceipt: () => {}, waiveReceipt: () => {}, isViewer: false };
    const h = renderViewHtml(ReceiptsToAdd, ctx).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
    expect(h).toContain('aria-label="Receipts to add"');
    expect(h).toContain("4 receipts to add");
    expect((h.match(/data-receipt-add/g) || []).length).toBe(3);   // three shown…
    expect(h).toContain("Show 1 more");                               // …and the rest one tap away
    expect(h).toContain("I don't have one");
    expect(h).toContain("you said the receipt is coming");
    expect(h).toMatch(/accept="image\/\*,\.pdf,\.heic,\.heif"/);
    expect(h).not.toMatch(/capture=/);                                // camera AND library on a phone
    expect(renderViewHtml(ReceiptsToAdd, { ...ctx, invoices: [] })).toBe("");
    expect(renderViewHtml(ReceiptsToAdd, { ...ctx, isViewer: true })).toBe("");
    const dash = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(dash).toMatch(/<HomeWaitingList navTo=\{navTo\} \/>\s*\n\s*\{\/\*[^}]*\*\/\}\s*\n\s*<ReceiptsToAdd \/>/);
  });
});

describe("C755 — the app and the assistant are wired", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const server = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
  it("★★ the post-write stamp carries told and receipt_to_come (the RPC drops them from p_meta)", () => {
    expect(app).toContain("...(carried.told ? { told: carried.told } : {}),");
    expect(app).toContain("...(carried.receipt_to_come ? { receipt_to_come: true } : {}),");
  });
  it("★★ the executor records once: the existing entry is only marked; a new one goes through bookToDb", () => {
    const i = app.indexOf('if (action.type === "record_purchase") {');
    const body = app.slice(i, app.indexOf('if (action.type === "reverse_entry")', i));
    expect(body).toContain("stampReceiptMeta(existing, { receipt_to_come: true })");
    expect(body).toContain("assertBookable(check.date)");
    expect(body).toContain("await bookToDb(inv)");
    expect(body.indexOf("else if (existing)")).toBeLessThan(body.indexOf("await bookToDb(inv)"));
  });
  it("★★ the assistant is told how to use it: ask only what it can't tell, pick the category itself", () => {
    expect(server).toContain('"type": "record_purchase"');
    expect(server).toMatch(/Ask ONLY for what you can't tell/);
    expect(server).toMatch(/never ask the owner to choose a category/);
    expect(server).toMatch(/record_purchase \(record something the owner says they bought — they confirm first\)/);
  });
});
