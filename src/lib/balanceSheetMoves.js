// ═════════════════════════════════════════════════════════════════════════════
// ★★ C655 — THE MONEY THAT IS NOT PROFIT OR LOSS, RECORDED (operator decision, 2026-11-12).
//
// C649–C653 stopped the app booking these as income or spending; they then waited, unrecorded,
// because where each belongs was the operator's call. The operator chose the standard
// small-business treatments:
//   · OWNER  — money out → Owner's Draw / Distributions; money in → owner contributions
//              (Additional Paid-In Capital for a corporation, by the legal form the owner set).
//   · CARD   — a payoff is money moved from the paying account to the card account (it pays down
//              what's owed on the card). No card set up → the owner is asked to add it, so the
//              card's purchases are recorded too.
//   · TRANSFER — money moved between two of the owner's accounts; asked which, if more than one.
//   · LOAN   — money received → a loan account (what the business owes); a payment → the owner
//              says how much was interest: the interest is spending, the rest reduces the loan.
//
// §12: every entry here is a pure builder whose Dr/Cr is asserted by a test, and none of them
// moves net income except a loan payment's interest line.
// ═════════════════════════════════════════════════════════════════════════════
import { buildJournalEntry } from "./journalEntries.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const line = (code, name, debit, credit) => ({ code: String(code), name: name || null, debit, credit });
const meta = (kind) => ({ payment_status: "paid", kind });   // cash-settled (§9): never an open bill

export function buildOwnerDrawEntry({ amount, date, bankCode, bankName, drawCode, drawName, description = "Money taken out by the owner" }) {
  const a = r2(amount);
  return buildJournalEntry({ date, description, source: "bank_import", meta: meta("owner_draw"),
    lines: [line(drawCode, drawName, a, 0), line(bankCode, bankName, 0, a)] });
}
export function buildOwnerContributionEntry({ amount, date, bankCode, bankName, equityCode, equityName, description = "Money put in by the owner" }) {
  const a = r2(amount);
  return buildJournalEntry({ date, description, source: "bank_import", meta: meta("owner_contribution"),
    lines: [line(bankCode, bankName, a, 0), line(equityCode, equityName, 0, a)] });
}
// Dr where the money went / Cr where it came from. A card payoff is this with `to` = the card.
export function buildTransferEntry({ amount, date, fromCode, fromName, toCode, toName, description = "Money moved between your accounts", kind = "transfer" }) {
  const a = r2(amount);
  if (String(fromCode) === String(toCode)) return { ...buildJournalEntry({ lines: [] }), balanced: false };
  return buildJournalEntry({ date, description, source: "bank_import", meta: meta(kind),
    lines: [line(toCode, toName, a, 0), line(fromCode, fromName, 0, a)] });
}
export function buildLoanProceedsEntry({ amount, date, bankCode, bankName, loanCode, loanName, description = "Loan money received" }) {
  const a = r2(amount);
  return buildJournalEntry({ date, description, source: "bank_import", meta: meta("loan_proceeds"),
    lines: [line(bankCode, bankName, a, 0), line(loanCode, loanName, 0, a)] });
}
// The interest is spending; the rest reduces what's owed. Interest outside 0..amount is refused —
// a payment cannot be more interest than money.
export function buildLoanPaymentEntry({ amount, interest, date, bankCode, bankName, loanCode, loanName, interestCode, interestName, description = "Loan payment" }) {
  const a = r2(amount), i = r2(interest);
  if (!(i >= 0) || i > a) return { ...buildJournalEntry({ lines: [] }), balanced: false, refused: "interest" };
  return buildJournalEntry({ date, description, source: "bank_import", meta: meta("loan_payment"),
    lines: [line(loanCode, loanName, r2(a - i), 0), line(interestCode, interestName, i, 0), line(bankCode, bankName, 0, a)] });
}

// ── Which accounts. Each answers from the company's own chart, by role first (§4). ─────────
const isCard = (b) => b && (b.type === "credit_card" || /^2\d{3}$/.test(String(b.gl_code || "")));
export function otherAccountsFor(kind, { lineAccount = null, moneyIn = false, bankAccounts = [] } = {}) {
  const others = (bankAccounts || []).filter((b) => b && b.gl_code && String(b.id) !== String(lineAccount?.id ?? ""));
  if (kind === "card") {
    // on checking, money out → which card; on the card's own statement, money in → which account paid it
    return isCard(lineAccount) && moneyIn ? others.filter((b) => !isCard(b)) : others.filter(isCard);
  }
  if (kind === "transfer") return others.filter((b) => !isCard(b));
  return [];
}

const CORPORATION = new Set(["s_corp", "c_corp"]);
// C659 (review) — plurals: the name this code CREATES is "Owner Contributions", which the singular
// pattern did not match, so every contribution after the first made another account (3500, 3501…).
const OWNER_EQUITY_NAME = /\bowner'?s?\b.*\b(contributions?|investments?|capital|equity)\b|\bmember'?s?\b.*\b(contributions?|capital)\b|\bcapital contributions?\b/i;
const APIC_NAME = /\badditional paid-?in capital\b/i;
export function ownerEquityAccount({ legalForm = "", chart = [], getAccountByRole = () => null } = {}) {
  if (CORPORATION.has(legalForm)) {
    const apic = getAccountByRole("additional_paid_in_capital");
    if (apic) return { code: String(apic.code), name: apic.name, create: false };
  }
  const named = (chart || []).find((a) => /^3\d{3}$/.test(String(a.code)) && (OWNER_EQUITY_NAME.test(a.name || "") || (CORPORATION.has(legalForm) && APIC_NAME.test(a.name || ""))));
  if (named) return { code: String(named.code), name: named.name, create: false };
  const used = new Set((chart || []).map((a) => String(a.code)));
  for (let n = 3500; n <= 3599; n++) if (!used.has(String(n))) return { code: String(n), name: CORPORATION.has(legalForm) ? "Additional Paid-In Capital" : "Owner Contributions", create: true };
  return null;
}
export function loanAccount({ chart = [], getAccountByRole = () => null } = {}) {
  const a = getAccountByRole("notes_payable") || getAccountByRole("long_term_debt");
  if (a) return { code: String(a.code), name: a.name, create: false };
  const used = new Set((chart || []).map((x) => String(x.code)));
  for (let n = 2650; n <= 2699; n++) if (!used.has(String(n))) return { code: String(n), name: "Loans", create: true };
  return null;
}

// ── The plan for one held bank line. Returns { entry, describe } or { needs, ... }. ─────────
export function planHeldLine({ kind, moneyIn, amount, date, description, lineAccount, bankAccounts = [], chart = [],
  getAccountByRole = () => null, legalForm = "", otherAccountId = null, interest = null } = {}) {
  const bank = lineAccount && lineAccount.gl_code ? { code: String(lineAccount.gl_code), name: lineAccount.name } : null;
  if (!bank) return { needs: "line_account" };
  const amt = r2(Math.abs(Number(amount) || 0));
  if (!(amt > 0)) return { needs: "amount" };
  const base = { amount: amt, date, description };
  if (kind === "owner") {
    if (!moneyIn) {
      const d = getAccountByRole("owners_draw");
      if (!d) return { needs: "draw_account" };
      return { entry: buildOwnerDrawEntry({ ...base, bankCode: bank.code, bankName: bank.name, drawCode: d.code, drawName: d.name }), account: { code: String(d.code), name: d.name } };
    }
    const eq = ownerEquityAccount({ legalForm, chart, getAccountByRole });
    if (!eq) return { needs: "equity_account" };
    return { entry: buildOwnerContributionEntry({ ...base, bankCode: bank.code, bankName: bank.name, equityCode: eq.code, equityName: eq.name }), account: eq };
  }
  if (kind === "card" || kind === "transfer") {
    const options = otherAccountsFor(kind, { lineAccount, moneyIn, bankAccounts });
    const other = otherAccountId != null ? options.find((b) => String(b.id) === String(otherAccountId)) : (options.length === 1 ? options[0] : null);
    if (!options.length) return { needs: kind === "card" ? "add_card" : "add_account" };
    if (!other) return { needs: "pick_account", options };
    const o = { code: String(other.gl_code), name: other.name };
    const [from, to] = moneyIn ? [o, bank] : [bank, o];
    return { entry: buildTransferEntry({ ...base, kind: kind === "card" ? "card_payment" : "transfer", fromCode: from.code, fromName: from.name, toCode: to.code, toName: to.name,
      description: kind === "card" ? "Credit card payment" : "Money moved between your accounts" }), from, to, other };
  }
  if (kind === "loan") {
    const loan = loanAccount({ chart, getAccountByRole });
    if (!loan) return { needs: "loan_account" };
    if (moneyIn) return { entry: buildLoanProceedsEntry({ ...base, bankCode: bank.code, bankName: bank.name, loanCode: loan.code, loanName: loan.name }), account: loan };
    if (interest == null || interest === "") return { needs: "interest" };
    const intAcct = getAccountByRole("interest_expense");
    if (!intAcct) return { needs: "interest_account" };
    const entry = buildLoanPaymentEntry({ ...base, interest, bankCode: bank.code, bankName: bank.name, loanCode: loan.code, loanName: loan.name, interestCode: intAcct.code, interestName: intAcct.name });
    if (!entry.balanced) return { needs: "interest", invalid: true };
    return { entry, account: loan, loanCode: loan.code, interestCode: String(intAcct.code) };
  }
  return { needs: "kind" };
}

// What the owner is told, read FROM THE ENTRY (§9: describe from the record, never alongside it).
export function heldLineOutcome(entry, kind, fmt, { loanCode = null, interestCode = null } = {}) {
  if (!entry || !entry.balanced) return null;
  const debit = entry.lines.filter((l) => l.debit > 0), credit = entry.lines.find((l) => l.credit > 0);
  const total = fmt(entry.totalDebit);
  if (kind === "owner_draw") return `Recorded ${total} as money you took out for yourself.`;
  if (kind === "owner_contribution") return `Recorded ${total} as money you put into the business.`;
  if (kind === "card_payment") return `Recorded ${total} paid from ${credit.name} to ${debit[0].name}.`;
  if (kind === "transfer") return `Recorded ${total} moved from ${credit.name} to ${debit[0].name}.`;
  if (kind === "loan_proceeds") return `Recorded ${total} as a loan the business owes.`;
  if (kind === "loan_payment") {
    // by account, not position: a zero interest (or zero principal) line is dropped by the builder
    const debitTo = (code) => entry.lines.filter((l) => String(l.code) === String(code)).reduce((t, l) => t + l.debit, 0);
    return `Recorded the ${total} loan payment: ${fmt(debitTo(loanCode))} off the loan and ${fmt(debitTo(interestCode))} interest.`;
  }
  return null;
}

// ★ A move between two of the owner's accounts appears on BOTH statements. When the other side has
// already been recorded (same two accounts, same amount, within a few days), the line is linked
// to that entry — never booked a second time.
// ★ C659 (review) — SAME DIRECTION, and the caller rules out entries already claimed. Matching
// the two accounts as a SET linked "$500 back to checking on Wednesday" to Monday's "$500 to
// savings", and a second $500 transfer three days after the first to the first — the real move
// was never recorded. Candidates come back nearest-date first; `pickUnclaimed` chooses.
export function findExistingMoves(invoices = [], entry, { days = 5 } = {}) {
  if (!entry || !entry.balanced || entry.lines.length !== 2) return [];
  const dr = String(entry.lines.find((l) => l.debit > 0)?.code), cr = String(entry.lines.find((l) => l.credit > 0)?.code);
  const amt = entry.totalDebit;
  const t0 = Date.parse(`${entry.date}T12:00:00`);
  const out = [];
  for (const inv of invoices || []) {
    if (!inv || inv.status === "voided" || inv.status === "deleted" || inv.deleted_at || inv.reversed_by) continue;
    if (String(inv.id).includes("_")) continue;   // a multi-line entry's rows — never a two-account move
    const credit = inv.debit_credit === "credit";
    const invDr = String(credit ? inv.secondary_gl_code : inv.gl_code), invCr = String(credit ? inv.gl_code : inv.secondary_gl_code);
    if (invDr !== dr || invCr !== cr) continue;
    if (Math.abs((Number(inv.amount) || 0) - amt) > 0.005) continue;
    const t = Date.parse(`${inv.date}T12:00:00`);
    if (!Number.isFinite(t0) || !Number.isFinite(t) || Math.abs(t - t0) > days * 86400000) continue;
    out.push({ jeId: String(inv.db_entry_id || inv.id), gap: Math.abs(t - t0) });
  }
  return out.sort((a, b) => a.gap - b.gap).map((c) => c.jeId);
}
// C660 — a loan payment is three lines (loan, interest, bank), so its rows are the multi-line
// `<entry>_<n>` rows: it is the same payment when one entry credits the same bank by the same
// amount and debits the same loan, within the window.
export function findExistingLoanPayments(invoices = [], entry, { days = 5 } = {}) {
  if (!entry || !entry.balanced || entry.lines.length < 2) return [];
  const bank = entry.lines.find((l) => l.credit > 0), loan = entry.lines.find((l) => l.debit > 0 && !/^[4-8]/.test(String(l.code)));
  if (!bank || !loan) return [];
  const t0 = Date.parse(`${entry.date}T12:00:00`);
  const byEntry = new Map();
  for (const inv of invoices || []) {
    if (!inv || inv.status === "voided" || inv.status === "deleted" || inv.deleted_at || inv.reversed_by) continue;
    const base = String(inv.db_entry_id || String(inv.id).split("_")[0]);
    if (!byEntry.has(base)) byEntry.set(base, []);
    byEntry.get(base).push(inv);
  }
  const out = [];
  for (const [base, rows] of byEntry) {
    const bankHit = rows.some((r) => String(r.gl_code) === String(bank.code) && r.debit_credit === "credit" && Math.abs((Number(r.amount) || 0) - bank.credit) <= 0.005);
    const loanHit = rows.some((r) => String(r.gl_code) === String(loan.code) && r.debit_credit !== "credit");
    if (!bankHit || !loanHit) continue;
    const t = Date.parse(`${rows[0].date}T12:00:00`);
    if (!Number.isFinite(t0) || !Number.isFinite(t) || Math.abs(t - t0) > days * 86400000) continue;
    out.push({ jeId: base, gap: Math.abs(t - t0) });
  }
  return out.sort((a, b) => a.gap - b.gap).map((c) => c.jeId);
}

export function findExistingMove(invoices = [], entry, opts = {}) {
  return findExistingMoves(invoices, entry, opts)[0] || null;
}
// `claims` = [{ jeId, accountId }] — the statement lines already linked to each candidate, with the
// bank account each line's statement belongs to. A move between two accounts is linked once from
// EACH account's statement; anything else is linked once at all.
export function pickUnclaimed(candidates = [], claims = [], { lineAccountId = null, twoSided = false } = {}) {
  for (const jeId of candidates || []) {
    const mine = (claims || []).filter((c) => String(c.jeId) === String(jeId));
    if (!mine.length) return jeId;
    if (twoSided && !mine.some((c) => String(c.accountId) === String(lineAccountId))) return jeId;
  }
  return null;
}
