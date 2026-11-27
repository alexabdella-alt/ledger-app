// ★ C776 — "I GOT PAID $500": money received, told to the assistant. There was no action for it, so the
// model used record_purchase and the card said "I need the amount you paid — nothing was recorded" after
// promising "Confirm below and it's in the books". Now record_income records it once, in the right place.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkToldIncome, pickReceivedInto, existingIncomeMatch, openInvoiceMatch, toldIncomeDescription, buildToldIncome } from "../src/lib/toldIncome.js";
import { receivedIntoOptions, PERSONAL } from "../src/lib/payFrom.js";
import { buildPendingConfirmation } from "../src/lib/aiActionGate.js";
import { AI_ALLOWED_ACTIONS, AI_DESTRUCTIVE_ACTIONS } from "../src/lib/aiCapabilities.js";
import { markAlreadyBooked } from "../src/lib/openingBalanceProposal.js";
import { glAccountBalance } from "../src/lib/reports.js";

const CHART = [
  { code: "1000", name: "Cash", category: "Assets", system_role: "cash" },
  { code: "1100", name: "Accounts Receivable", category: "Assets", system_role: "accounts_receivable" },
  { code: "3300", name: "Owner's Draw / Distributions", category: "Equity", system_role: "owners_draw" },
  { code: "4100", name: "Service Revenue", category: "Revenue", system_role: "service_revenue" },
  { code: "6600", name: "Office Supplies", category: "Expenses" },
];
const byRole = (r) => CHART.find((a) => a.system_role === r) || null;
const BANKS = [{ id: "b1", name: "Business Checking", type: "checking", gl_code: "1000" }];
const OPTS = receivedIntoOptions({ bankAccounts: BANKS, getAccountByRole: byRole });
const TODAY = "2026-11-27";
const ZELLE = { type: "record_income", customer: "AllDay Pizza", amount: 500, description: "sponsored content", gl_code: "4100", received_into: "personal account" };

describe("C776 — the action exists and is confirmed first", () => {
  it("★★★ allowed and staged behind Confirm", () => {
    expect(AI_ALLOWED_ACTIONS).toContain("record_income");
    expect(AI_DESTRUCTIVE_ACTIONS.has("record_income")).toBe(true);
  });
  it("★★★ the assistant is told to use it, and never record_purchase for money coming in", () => {
    const g = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(g).toContain('"type": "record_income"');
    expect(g).toContain("NEVER use record_purchase for money coming IN");
    expect(g).toContain("record_income (record money the owner says they received");
  });
  it("★★ the 1099 goes from the payer — never 'the owner owes the customer a 1099'", () => {
    const g = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(g).toContain("it is the CUSTOMER who may send the owner a 1099-NEC — never say the owner owes the customer a 1099");
  });
});

describe("C776 — checking what was said", () => {
  it("★★ amount, who paid, an income category", () => {
    expect(checkToldIncome({ ...ZELLE, amount: 0 }, { chart: CHART, today: TODAY }).reason).toBe("I need the amount you received — nothing would be recorded.");
    expect(checkToldIncome({ ...ZELLE, customer: "" }, { chart: CHART, today: TODAY }).reason).toBe("I need who paid you — nothing would be recorded.");
    expect(checkToldIncome({ ...ZELLE, gl_code: "6600" }, { chart: CHART, today: TODAY }).reason).toBe("Office Supplies isn't an income category — nothing would be recorded.");
    expect(checkToldIncome({ ...ZELLE, gl_code: "4999" }, { chart: CHART, today: TODAY }).ok).toBe(false);
  });
  it("★ no category given → the default income account; the date defaults to today", () => {
    const c = checkToldIncome({ ...ZELLE, gl_code: undefined }, { chart: CHART, today: TODAY, defaultIncomeCode: "4100" });
    expect(c).toMatchObject({ ok: true, amount: 500, customer: "AllDay Pizza", date: TODAY });
    expect(c.acct.code).toBe("4100");
  });
});

describe("C776 — where the money landed", () => {
  it("★★★ 'personal account' → the owner's personal account; nothing said → the business account; unknown → ask", () => {
    expect(pickReceivedInto(OPTS, "personal account").key).toBe(PERSONAL);
    expect(pickReceivedInto(OPTS, "my own account").key).toBe(PERSONAL);
    expect(pickReceivedInto(OPTS, "").code).toBe("1000");
    expect(pickReceivedInto(OPTS, "business checking").code).toBe("1000");
    expect(pickReceivedInto(OPTS, "the Wells Fargo savings")).toBeNull();
  });
});

describe("C776 — a personal account the books track", () => {
  it("★★★ 'personal account' → that tracked account (cash goes up), not money taken out", () => {
    const opts = receivedIntoOptions({ bankAccounts: [...BANKS, { id: "b2", name: "Personal Checking", type: "checking", gl_code: "1020" }], getAccountByRole: byRole });
    const into = pickReceivedInto(opts, "my personal account");
    expect(into.code).toBe("1020");
    const inv = buildToldIncome(ZELLE, { chart: [...CHART, { code: "1020", name: "Personal Checking", category: "Assets" }], receivedInto: into, today: TODAY, id: 1, bookedAt: "x" });
    expect(glAccountBalance("1020", [inv])).toBe(500);
    expect(glAccountBalance("3300", [inv])).toBe(0);
  });
});

describe("C776 — the entry (the real ledger effect)", () => {
  it("★★★ Zelle to the owner personally: income +$500, $500 counted as taken out (equity −$500), cash unchanged", () => {
    const into = pickReceivedInto(OPTS, "personal account");
    const inv = buildToldIncome(ZELLE, { chart: CHART, receivedInto: into, today: TODAY, id: 1, bookedAt: "x" });
    expect(inv).toMatchObject({ vendor: "AllDay Pizza", amount: 500, date: TODAY, gl_code: "4100", secondary_gl_code: "3300", debit_credit: "credit", type: "revenue", payment_status: "paid" });
    expect(inv.import_metadata).toEqual({ told: "assistant" });
    expect(glAccountBalance("4100", [inv])).toBe(500);
    expect(glAccountBalance("3300", [inv])).toBe(-500);   // equity down by what the owner took out
    expect(glAccountBalance("1000", [inv])).toBe(0);
  });
  it("★★★ into the business account: income +$500, cash +$500", () => {
    const inv = buildToldIncome({ ...ZELLE, received_into: "" }, { chart: CHART, receivedInto: pickReceivedInto(OPTS, ""), today: TODAY, id: 1, bookedAt: "x" });
    expect(glAccountBalance("4100", [inv])).toBe(500);
    expect(glAccountBalance("1000", [inv])).toBe(500);
  });
  it("★ nothing is built when it doesn't check out", () => {
    expect(buildToldIncome({ ...ZELLE, amount: 0 }, { chart: CHART, receivedInto: OPTS[0], today: TODAY })).toBeNull();
    expect(buildToldIncome(ZELLE, { chart: CHART, receivedInto: null, today: TODAY })).toBeNull();
  });
});

describe("C776 — never counted twice", () => {
  const deposit = { id: 9, vendor: "ALLDAY PIZZA ZELLE", amount: 500, date: "2026-11-25", gl_code: "4100", secondary_gl_code: "1000", debit_credit: "credit", type: "revenue", status: "booked", source: "bank_import" };
  it("★★★ already a deposit in the books → the card says so and the action resolves to it", () => {
    expect(existingIncomeMatch(ZELLE, [deposit], { today: TODAY })?.id).toBe(9);
    const { actions, items } = buildPendingConfirmation([ZELLE], { invoices: [deposit], chart: CHART, today: TODAY, receivedIntoOptions: OPTS, openItems: [], arCode: "1100" });
    expect(String(actions[0].existing_entry_id)).toBe("9");
    expect(items[0].description).toMatch(/already in your books .* nothing would be recorded twice/);
    expect(items[0].count).toBe(0);
  });
  it("★★★ an invoice already sent to them for that amount → recorded as paid, not new income", () => {
    const ar = { id: 21, vendor: "AllDay Pizza", amount: 500, gl_code: "1100", secondary_gl_code: "4100" };
    expect(openInvoiceMatch(ZELLE, [ar], { arCode: "1100" })?.id).toBe(21);
    expect(openInvoiceMatch({ ...ZELLE, amount: 450 }, [ar], { arCode: "1100" })).toBeNull();
    const { actions, items } = buildPendingConfirmation([ZELLE], { invoices: [], chart: CHART, today: TODAY, receivedIntoOptions: OPTS, openItems: [ar], arCode: "1100" });
    expect(actions[0].invoice_id).toBe(21);
    expect(items[0].description).toBe("AllDay Pizza already has an invoice for $500.00 — record it as paid · into your personal account (counted as money you took out). It isn't counted as new income twice.");
  });
  it("★★★ a statement arriving later recognises the told income (money in), and not a money-out line", () => {
    const told = buildToldIncome({ ...ZELLE, received_into: "" }, { chart: CHART, receivedInto: OPTS[0], today: TODAY, id: 5, bookedAt: "x" });
    const lines = [
      { date: "2026-11-29", amount: 500, money_in: false, description: "SOMETHING ELSE" },   // first, so only the direction keeps it out
      { date: "2026-11-29", amount: 500, money_in: true, description: "ZELLE FROM ALLDAY" },
    ];
    const out = markAlreadyBooked(lines, [told], { offsetCode: "1000" });
    expect(out[1]).toMatchObject({ already_booked: true, told_match: "5" });
    expect(out[0].already_booked).toBe(false);
  });
});

describe("C776 — the card for the screenshot's conversation", () => {
  it("★★★ names the amount, who paid, the category, the date and the personal account", () => {
    const { actions, items } = buildPendingConfirmation([ZELLE], { invoices: [], chart: CHART, today: TODAY, receivedIntoOptions: OPTS, openItems: [], arCode: "1100" });
    expect(actions[0]).toMatchObject({ received_into_key: PERSONAL, existing_entry_id: null, invoice_id: null, date: TODAY });
    expect(items[0].count).toBe(1);
    expect(items[0].description).toBe("Record $500.00 received from AllDay Pizza (sponsored content) · Service Revenue · Nov 27, 2026 · into your personal account (counted as money you took out).");
  });
  it("★★ words that name no account → nothing would be recorded, and it says why", () => {
    const { items } = buildPendingConfirmation([{ ...ZELLE, received_into: "the Wells Fargo savings" }], { invoices: [], chart: CHART, today: TODAY, receivedIntoOptions: OPTS, openItems: [], arCode: "1100" });
    expect(items[0].count).toBe(0);
    expect(items[0].description).toMatch(/^I couldn't tell which account "the Wells Fargo savings" is — nothing would be recorded/);
  });
  it("★ the executor posts collections through markBillPaid (side ar) and new income through bookToDb", () => {
    const a = readFileSync("src/App.jsx", "utf8");
    const i = a.indexOf('if (action.type === "record_income")');
    const block = a.slice(i, a.indexOf('if (action.type === "reverse_entry")', i));
    expect(block).toContain('markBillPaid(r.openInvoice.id, { side: "ar", cashCode: r.into.code');
    expect(block).toContain("buildToldIncome(action");
    expect(block).toContain("await bookToDb(inv)");
  });
});

// ★ C778 — "Do you use that account for the business too?" — asked once when the money landed in a
// personal account the books don't track; yes → the account is added and the money counts as cash there.
import { trackedAccountFor } from "../src/lib/toldIncome.js";
import { CHECKLIST_COPY } from "../src/lib/firstRun.js";
describe("C778 — yes, I use it for the business too", () => {
  it("★★★ track_account → a NEW account on the card, and Confirm adds it (staged as new:<name>)", () => {
    const a = { ...ZELLE, track_account: "Personal Checking" };
    const { actions, items } = buildPendingConfirmation([a], { invoices: [], chart: CHART, today: TODAY, receivedIntoOptions: OPTS, openItems: [], arCode: "1100" });
    expect(actions[0].received_into_key).toBe("new:Personal Checking");
    expect(items[0].count).toBe(1);
    expect(items[0].description).toBe("Record $500.00 received from AllDay Pizza (sponsored content) · Service Revenue · Nov 27, 2026 · into Personal Checking (added to your accounts, so its money counts in your books).");
  });
  it("★★ an account already tracked under that name is used, never added twice", () => {
    const opts = receivedIntoOptions({ bankAccounts: [...BANKS, { id: "b2", name: "Personal Checking", type: "checking", gl_code: "1020" }], getAccountByRole: byRole });
    expect(trackedAccountFor(opts, "personal checking")).toMatchObject({ code: "1020" });
    expect(trackedAccountFor(opts, "personal checking").create).toBeUndefined();
    expect(trackedAccountFor(opts, "")).toBeNull();
  });
  it("★★★ the executor adds the account before booking, and books into it", () => {
    const s = readFileSync("src/App.jsx", "utf8");
    const i = s.indexOf('if (action.type === "record_income")');
    const block = s.slice(i, s.indexOf('if (action.type === "reverse_entry")', i));
    expect(block.indexOf("createBankAccountInline({ name: r.into.name")).toBeGreaterThan(0);
    expect(block.indexOf("createBankAccountInline(")).toBeLessThan(block.indexOf("buildToldIncome(action"));
  });
  it("★★★ the assistant sees which accounts are tracked, and asks the question once", () => {
    const ai = readFileSync("src/lib/ai.js", "utf8");
    expect(ai).toContain("ACCOUNTS THE BOOKS TRACK (their statements come in here):");
    expect(readFileSync("src/App.jsx", "utf8")).toContain("trackedAccountLabels: (bankAccounts || [])");
    const g = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(g).toContain('"Do you use that account for the business too? If so, I\'ll add it here so its money counts in your books."');
    expect(g).toContain('"track_account"');
    expect(g).toContain("Ask this at most once per account");
  });
  it("★★ setup asks for every account used for the business, personal ones included", () => {
    expect(CHECKLIST_COPY.bank.label).toBe("Add every account you use for the business");
    expect(CHECKLIST_COPY.bank.hint).toMatch(/^Including a personal account or card you also use for it — then its money counts here\./);
  });
});
