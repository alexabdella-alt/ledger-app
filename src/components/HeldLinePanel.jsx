import React from "react";
import { useERP } from "./ERPContext";
import { fmtMoney } from "../lib/format";
import { planHeldLine, findExistingMoves, findExistingLoanPayments, pickUnclaimed, heldLineOutcome } from "../lib/balanceSheetMoves";

// ═════════════════════════════════════════════════════════════════════════════
// ★★ C655 — THE BANK LINE THAT ISN'T INCOME OR SPENDING, RECORDED THE WAY THE OPERATOR CHOSE.
// Shown on a bank-line question card when the line reads (C651/C653), or the owner says
// (C649/C650), that it's the owner's own money, a credit-card payoff, a transfer or a loan. One
// tap records the standard entry (lib/balanceSheetMoves.js); the only things asked are the ones
// the app cannot know — which account, and how much of a loan payment was interest.
// ═════════════════════════════════════════════════════════════════════════════
const btn = (primary) => ({ fontSize: 13, fontWeight: 600, padding: "8px 14px", borderRadius: 9, cursor: "pointer",
  background: primary ? "var(--sc-gold)" : "var(--sc-surface)", color: primary ? "var(--sc-on-accent)" : "var(--sc-text)",
  border: primary ? "none" : "1px solid var(--sc-border-2)" });

export default function HeldLinePanel({ kind, item, inv, run, onDone }) {
  const { bankAccounts, CHART_OF_ACCOUNTS, getAccountByRole, companySettings, persistMultiLineEntry, addCustomAccount,
    loadAllData, invoices, settleStatementLine, settleClarification, logAudit, setView, supabase, currentCompany } = useERP();
  const [interest, setInterest] = React.useState("");
  const [error, setError] = React.useState(null);
  const moneyIn = inv.money_in === true;
  const sl = item.statementLine || {};
  const lineAccount = (bankAccounts || []).find((b) => String(b.id) === String(sl.accountId))
    || (sl.accountCode ? { id: sl.accountId, gl_code: sl.accountCode, name: inv.secondary_gl_name || "your bank account" } : null);
  const base = { kind, moneyIn, amount: inv.amount, date: inv.date, description: inv.description || inv.vendor, lineAccount,
    bankAccounts, chart: CHART_OF_ACCOUNTS, getAccountByRole, legalForm: companySettings?.legalForm || "" };
  const preview = planHeldLine({ ...base, interest: kind === "loan" && !moneyIn ? (interest === "" ? null : Number(interest)) : null });
  const amt = fmtMoney(Math.abs(Number(inv.amount) || 0));

  const record = (extra = {}) => run(async () => {
    setError(null);
    const plan = planHeldLine({ ...base, ...extra });
    if (plan.noEntry) {   // C662 — both accounts are one account in the books: nothing to record
      const text = `${plan.other?.name || "That account"} and ${lineAccount?.name || "this account"} are kept together in your books, so moving money between them doesn't change anything — marked as done.`;
      logAudit("held_line_no_entry", text, null, { kind, line_id: sl.lineId || null });
      await settleStatementLine?.({ ...sl, noEntry: true });
      onDone(text);
      return true;
    }
    if (!plan.entry) { setError(plan.invalid ? `The interest has to be between $0 and ${amt}.` : "This one needs a detail we don't have — skip it for now."); return false; }
    if (plan.account?.create) {
      const ok = await addCustomAccount({ code: plan.account.code, name: plan.account.name, category: /^3/.test(plan.account.code) ? "Equity" : "Liabilities" });
      if (ok === false) return false;
    }
    const kindOf = plan.entry.meta.kind;
    const twoSided = kindOf === "transfer" || kindOf === "card_payment";
    // C659 — an entry for this exact move may already exist: from the other account's statement
    // (a transfer or card payoff), or from an earlier answer whose line never got marked (a held
    // signed-month booking approved later). Link to one nobody on THIS account has claimed;
    // otherwise record it. If the claims can't be read, record it rather than guess a link.
    const candidates = kindOf === "loan_payment" ? findExistingLoanPayments(invoices, plan.entry) : findExistingMoves(invoices, plan.entry);   // C660
    let existing = null;
    if (candidates.length && supabase && currentCompany?.id) {
      try {
        const { data: lines, error: le } = await supabase.from("bank_statement_lines").select("statement_id, journal_entry_id").eq("company_id", currentCompany.id).in("journal_entry_id", candidates);
        if (le) throw le;
        const stmtIds = [...new Set((lines || []).map((l) => String(l.statement_id)))];
        let acctOf = new Map();
        if (stmtIds.length) {
          const { data: stmts, error: se } = await supabase.from("bank_statements").select("id, bank_account_id").eq("company_id", currentCompany.id).in("id", stmtIds);
          if (se) throw se;
          acctOf = new Map((stmts || []).map((x) => [String(x.id), x.bank_account_id]));
        }
        const claims = (lines || []).map((l) => ({ jeId: String(l.journal_entry_id), accountId: acctOf.get(String(l.statement_id)) ?? null }));
        existing = pickUnclaimed(candidates, claims, { lineAccountId: lineAccount?.id ?? null, twoSided });
      } catch (e) { console.warn("[held line] couldn't read which entries are linked — recording it:", e?.message || e); existing = null; }
    }
    const jeId = existing || await persistMultiLineEntry(plan.entry);
    if (!jeId) return false;   // the writer said why (or a signed month is holding it for a decision)
    const text = existing
      ? (twoSided ? "This was already recorded from your other account's statement — matched to it, nothing new added." : "This was already recorded — matched to it, nothing new added.")
      : heldLineOutcome(plan.entry, kindOf, fmtMoney, plan);
    logAudit(existing ? "held_line_matched" : "held_line_recorded", text, null, { kind: kindOf, entry_id: String(jeId), line_id: sl.lineId || null });
    if (!existing) await loadAllData();
    await settleStatementLine?.({ ...sl, jeId });
    settleClarification?.(item, { kind: "booked", jeId });
    onDone(text);
    return true;
  });

  const wrap = (children) => (
    <div data-held-line={kind} style={{ background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-line)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
      {children}
      {error && <div style={{ fontSize: 13, color: "var(--sc-error)", marginTop: 8 }}>{error}</div>}
    </div>
  );
  const ask = (text) => <div style={{ fontSize: 14, color: "var(--sc-text)", marginBottom: 10 }}>{text}</div>;

  if (preview.needs === "add_card" || preview.needs === "add_account") {
    return wrap(<>
      {ask(preview.needs === "add_card"
        ? "Add this credit card under Settings → Your business → Bank accounts first, so its purchases are recorded too. Then come back to this question."
        : "Add your other account under Settings → Your business → Bank accounts first, then come back to this question.")}
      {/* C665 — straight to the Bank accounts section, as Home's setup checklist does */}
      <button style={btn(false)} onClick={() => { setView && setView("settings"); setTimeout(() => document.getElementById("bank-accounts-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250); }}>Add it in Settings</button>
    </>);
  }
  if (preview.needs === "pick_account") {
    const q = kind === "card"
      ? (moneyIn ? "Which account paid this card?" : "Which card did this pay off?")
      : (moneyIn ? "Which account did it come from?" : "Which account did it go to?");
    return wrap(<>{ask(q)}<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {preview.options.map((b) => <button key={b.id} style={btn(false)} onClick={() => record({ otherAccountId: b.id })}>{b.name}</button>)}
    </div></>);
  }
  if (kind === "loan" && !moneyIn) {
    return wrap(<>
      {ask(`How much of the ${amt} was interest? Your loan statement shows it — put 0 if none.`)}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input type="number" inputMode="decimal" min="0" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="0.00"
          style={{ width: 130, height: 38, padding: "0 10px", borderRadius: 9, border: "1px solid var(--sc-border-2)", background: "var(--sc-surface)", color: "var(--sc-text)", fontSize: 14 }} />
        <button style={btn(true)} disabled={interest === ""} onClick={() => record({ interest: Number(interest) })}>Record the payment</button>
      </div>
    </>);
  }
  if (preview.entry || preview.noEntry) {
    const q = kind === "owner" ? (moneyIn ? "Was this your own money going into the business?" : "Was this money you took out for yourself?")
      : kind === "loan" ? "Was this money the business borrowed?"
      : kind === "card" ? `Was this paying off ${preview.to?.name || "your card"}${moneyIn ? ` from ${preview.from?.name}` : ""}?`
      : `Was this money moved ${moneyIn ? "from" : "to"} ${preview.other?.name}?`;
    const yes = kind === "owner" ? (moneyIn ? "Yes — money I put in" : "Yes — money I took out")
      : kind === "loan" ? "Yes — it's a loan" : kind === "card" ? "Yes — a card payment" : "Yes — a move between my accounts";
    return wrap(<>{ask(q)}<button style={btn(true)} onClick={() => record()}>{yes}</button></>);
  }
  return wrap(ask("This one needs a detail we don't have — skip it for now, or ask your accountant."));
}
