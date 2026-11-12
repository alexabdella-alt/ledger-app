import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { alignDirectionToAccount, incomeAccountForAnswer } from "../src/lib/bookingDirection";
import { buildUploadedInvoice } from "../src/lib/uploadedInvoice";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants";

// ═════════════════════════════════════════════════════════════════════════════
// C591 — THE CATEGORY DECIDES THE DIRECTION. Review findings U1 and U5.
// ═════════════════════════════════════════════════════════════════════════════
const ar = { code: "1100", name: "Accounts Receivable" };
const ap = { code: "2000", name: "Accounts Payable" };
const byRole = (r) => DEFAULT_CHART_OF_ACCOUNTS.find((a) => a.system_role === r) || null;
const rc = (r) => byRole(r)?.code;
const rn = (r) => byRole(r)?.name;

// What `persistJournalEntry` posts for a two-line entry: `isDebit = debit_credit !== "credit"`.
const posts = (inv) => (inv.debit_credit !== "credit"
  ? { dr: inv.gl_code, cr: inv.secondary_gl_code } : { dr: inv.secondary_gl_code, cr: inv.gl_code });

describe("U1 — 'We sent it' books income the right way round", () => {
  // The card's own shape: the AI guessed a bill (debit, against bills-to-pay); the person
  // says it is theirs, and the answer carries the income category and the A/R offset.
  const guessedBill = { vendor: "Harbor Cafe", amount: 900, gl_code: "6800", gl_name: "Professional Services", type: "expense",
    debit_credit: "debit", secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable", _contact: { name: "Harbor Cafe", type: "vendor" } };
  const answered = { ...guessedBill, gl_code: "4100", gl_name: "Service Revenue", type: "revenue", secondary_gl_code: "1100", secondary_gl_name: "Accounts Receivable" };

  it("★ before the rule this was Dr Income / Cr Receivable — the defect, stated", () => {
    expect(posts(answered)).toEqual({ dr: "4100", cr: "1100" });
  });

  it("★ with it: Dr Receivable / Cr Income, and the other party is a customer", () => {
    const out = alignDirectionToAccount(answered, { ar, ap });
    expect(posts(out)).toEqual({ dr: "1100", cr: "4100" });
    expect(out.type).toBe("revenue");
    expect(out._contact.type).toBe("customer");
  });

  it("an income category still pointing at bills-to-pay is moved to money-owed-to-you", () => {
    const out = alignDirectionToAccount({ ...guessedBill, gl_code: "4000", gl_name: "Product Revenue" }, { ar, ap });
    expect([out.secondary_gl_code, out.secondary_gl_name, out.debit_credit]).toEqual(["1100", "Accounts Receivable", "credit"]);
  });

  it("★ and the reverse: an expense category on a document first read as income", () => {
    const out = alignDirectionToAccount({ vendor: "Ace", gl_code: "6250", type: "revenue", debit_credit: "credit", secondary_gl_code: "1100", _contact: { type: "customer" } }, { ar, ap });
    expect(posts(out)).toEqual({ dr: "6250", cr: "2000" });
    expect(out.type).toBe("expense");
    expect(out._contact.type).toBe("vendor");
  });

  it("★ an offset that is neither (already paid from the bank, a card) is left alone", () => {
    const paid = alignDirectionToAccount({ gl_code: "6250", debit_credit: "debit", secondary_gl_code: "1000", secondary_gl_name: "Cash" }, { ar, ap });
    expect(paid.secondary_gl_code).toBe("1000");
    const cashSale = alignDirectionToAccount({ gl_code: "4000", debit_credit: "debit", secondary_gl_code: "1000" }, { ar, ap });
    expect(posts(cashSale)).toEqual({ dr: "1000", cr: "4000" });
  });

  it("a balance-sheet category is returned untouched, and a correct document is unchanged", () => {
    const asset = { gl_code: "1500", debit_credit: "debit", secondary_gl_code: "2000", type: "expense" };
    expect(alignDirectionToAccount(asset, { ar, ap })).toBe(asset);
    const bill = { gl_code: "6250", type: "expense", debit_credit: "debit", secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable" };
    expect(alignDirectionToAccount(bill, { ar, ap })).toEqual(bill);
  });

  it("★ every answer that books goes through it", () => {
    const src = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    const fn = src.slice(src.indexOf("const doBookGl = "), src.indexOf("// ── Free-text booking"));
    expect(fn).toMatch(/const finalInv = alignDirectionToAccount\(\{\s*\n\s*\.\.\.inv,/);
    expect(fn).toMatch(/\}, \{ ar: role\("accounts_receivable", "1100", "Money owed to you"\), ap: role\("accounts_payable", "2000", "Bills to pay"\) \}\);/);
    // and the write path still reads the side from the one field the rule sets
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/const isDebit = invoice\.debit_credit !== "credit";/);
  });
});

describe("U5 — a rule's category and the AI's 'this is income' cannot disagree in the entry", () => {
  const build = (extracted, rule, coding = {}) => buildUploadedInvoice({ extracted: { vendor: "Ace Plumbing", amount: "500", date: "2026-03-01", ...extracted }, coding, rule, rc, rn, id: 1, bookedAt: "x", today: "2026-03-02" }).invoice;

  it("★ an expense rule on a document read as income posts Dr expense / Cr bills-to-pay", () => {
    const inv = build({ type: "revenue" }, { gl_code: "6250", gl_name: "Repairs & Maintenance" });
    expect(posts(inv)).toEqual({ dr: "6250", cr: rc("accounts_payable") });
    expect(inv.type).toBe("expense");
    expect(inv._contact.type).toBe("vendor");
  });

  it("★ an income rule posts against money-owed-to-you, not bills-to-pay", () => {
    const inv = build({ type: "revenue" }, { gl_code: "4100", gl_name: "Service Revenue" });
    expect(posts(inv)).toEqual({ dr: rc("accounts_receivable"), cr: "4100" });
  });

  it("the ordinary cases are what they were", () => {
    expect(posts(build({ type: "expense" }, null, { gl_code: "6250", gl_name: "Repairs" }))).toEqual({ dr: "6250", cr: rc("accounts_payable") });
    expect(posts(build({ type: "revenue" }, null, { gl_code: "4000", gl_name: "Product Revenue" }))).toEqual({ dr: rc("accounts_receivable"), cr: "4000" });
  });

  it("the AI calling it income while coding it to an expense category books an expense", () => {
    const inv = build({ type: "revenue" }, null, { gl_code: "6250", gl_name: "Repairs" });
    expect(posts(inv)).toEqual({ dr: "6250", cr: rc("accounts_payable") });
  });
});

describe("an income document's answer lands on an income category", () => {
  const chart = DEFAULT_CHART_OF_ACCOUNTS;
  const opts = { getAccountByRole: byRole, chart, fallback: { gl_code: "4000", gl_name: "Product Revenue" } };

  it.each([["a consulting project", "4100"], ["monthly retainer work", "4100"], ["their annual subscription", "4200"],
    ["we sold them goods", "4000"], ["interest on the deposit", "4300"]])("%s → %s", (text, code) => {
    expect(incomeAccountForAnswer(text, opts).gl_code).toBe(code);
  });

  it("★ words it does not know fall back to the category the card suggested — never an expense one", () => {
    expect(incomeAccountForAnswer("the thing from last week", opts)).toEqual({ gl_code: "4000", gl_name: "Product Revenue" });
    // a fallback that is not income is ignored: the chart's first income category instead
    expect(incomeAccountForAnswer("the thing", { ...opts, fallback: { gl_code: "6800", gl_name: "Professional Services" } }).gl_code).toBe("4000");
  });

  it("a role this company does not have is skipped", () => {
    const small = chart.filter((a) => a.code !== "4100");
    expect(incomeAccountForAnswer("consulting", { getAccountByRole: byRole, chart: small, fallback: { gl_code: "4000", gl_name: "Product Revenue" } }).gl_code).toBe("4000");
  });

  it("★ the card reads an income answer here BEFORE the expense vocabulary", () => {
    const src = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    const fn = src.slice(src.indexOf("const submitAnswer = "), src.indexOf("const tapChip = "));
    const income = fn.indexOf('if (inv.type === "revenue") {');
    expect(income).toBeGreaterThan(-1);
    expect(income).toBeLessThan(fn.indexOf("const mapped = answerToAccount("));
    expect(fn).toMatch(/incomeAccountForAnswer\(text, \{ getAccountByRole, chart: CHART_OF_ACCOUNTS, fallback: inv \}\)/);
  });

  it("'We received it' keeps the document's own expense category instead of the chart's first", () => {
    const src = readFileSync("src/components/ClarificationFlow.jsx", "utf8");
    expect(src).toMatch(/const own = \(isRev \? glIsRevenue : glIsExpense\)\(String\(baseInv\.gl_code \?\? ""\)\) \? \{ code: baseInv\.gl_code, name: baseInv\.gl_name \} : null;\s*\n\s*const acct = own \|\|/);
  });
});
