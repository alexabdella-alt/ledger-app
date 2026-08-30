import React from "react";
import { useERP } from "../ERPContext";
import { prefillEndingBalance, statementForPeriod, READY_TO_RECONCILE_COPY } from "../../lib/statementLifecycle";
import { reconBooksSet, cashLegSigned, statementBalanceVerified, canCompleteReconciliation, isOpeningPositionRow, reconBooksBalance, reconOutstandingBooks, reconMarkedOutstanding, reconcileDifference, supersedableOpenReconciliations, reconCompletionGate, resolveReconRowId, reconCompletionCopy, reconciliationActivityLine, RECON_COMPLETE_SUCCESS_COPY, RECON_COMPLETE_FAILURE_COPY } from "../../lib/reconcile";
import { checkedRowUpdate, checkedIdsUpdate } from "../../lib/checkedWrite";
import { statementsCoveredByReconciliation, outstandingCheckCopy, openingMismatchCopy, outstandingClearedCopy, MATCH_EXISTING_ACTION_LABEL } from "../../lib/workbench";
import { openingDiscrepancy } from "../../lib/openingBalanceProposal";
import { priorOutstandingCandidates, matchOutstandingClears } from "../../lib/outstandingItems";
import { initials, vendorColor, fmtDate , fmtSignedMoney, ymdLocal, addDaysYMD } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { AI_PROXY_URL } from "../../lib/constants";
import { okAIResponse } from "../../lib/ai";
import { validateUpload } from "../../lib/uploadGuard";
import { normalizeBankParse } from "../../lib/openingBalanceProposal";
import { aiJson } from "../../lib/aiJson";

// ── CSV helpers (Chase / Bank of America / generic 3-column) ──
const splitRow = (l) => { const out=[]; let cur="",q=false; for (const ch of l){ if(ch==='"'){q=!q;} else if(ch===","&&!q){out.push(cur);cur="";} else cur+=ch; } out.push(cur); return out.map(s=>s.trim().replace(/^"|"$/g,"")); };
const parseAmt = (s) => { if(s==null) return null; s=String(s).replace(/[$,\s]/g,""); if(s==="") return null; let neg=false; if(/^\(.*\)$/.test(s)){neg=true;s=s.replace(/[()]/g,"");} const n=parseFloat(s); if(isNaN(n)) return null; return neg?-Math.abs(n):n; };
const normDate = (s) => { if(!s) return ""; s=String(s).trim(); let m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/); if(m){let[,a,b,y]=m; if(y.length===2)y="20"+y; return `${y}-${String(a).padStart(2,"0")}-${String(b).padStart(2,"0")}`;} m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return m[0]; const d=new Date(s); return isNaN(d.getTime())?s:d.toISOString().slice(0,10); };
function parseBankCSV(text){
  const lines=text.split(/\r?\n/).filter(l=>l.trim());
  if(!lines.length) return [];
  const header=splitRow(lines[0]).map(h=>h.toLowerCase());
  const findIdx=(...names)=>header.findIndex(h=>names.some(n=>h.includes(n)));
  let di=findIdx("posting date","transaction date","trans date","date");
  let descI=findIdx("description","payee","name","memo","details");
  let amtI=findIdx("amount");
  const debitI=findIdx("debit","withdrawal");
  const creditI=findIdx("credit","deposit");
  const hasHeader=di>=0||amtI>=0||descI>=0||debitI>=0;
  let dataLines=hasHeader?lines.slice(1):lines;
  if(!hasHeader){ di=0; descI=1; amtI=2; }
  const rows=[];
  dataLines.forEach((l,idx)=>{
    const c=splitRow(l); if(c.length<2) return;
    const date=normDate(c[di]||"");
    const desc=((descI>=0?c[descI]:"")||"").slice(0,140);
    let amount;
    if(amtI>=0 && c[amtI]!=null && c[amtI]!=="") amount=parseAmt(c[amtI]);
    else if(debitI>=0||creditI>=0){ const d=parseAmt(c[debitI]||"0")||0; const cr=parseAmt(c[creditI]||"0")||0; amount=cr-Math.abs(d); }
    else amount=parseAmt(c[2]||"0");
    if(amount===null||isNaN(amount)) return;
    rows.push({ id:"b_"+idx+"_"+Math.random().toString(36).slice(2,7), date, description:desc||"Bank transaction", amount });
  });
  return rows;
}
// keyword → GL suggestion (smart default for "add to books")
// Suggest a stable system_role from a bank-transaction description. The caller
// resolves the role to the company's current account via getAccountByRole.
function suggestRole(desc, amount){
  const d=(desc||"").toLowerCase();
  if(amount>0) return "product_revenue";
  const map=[
    [/stripe|square|paypal|processing/, "technology_software"],
    [/aws|amazon web|google cloud|gcp|azure|digitalocean|heroku|vercel|netlify/, "technology_software"],
    [/rent|lease|wework|office/, "rent_occupancy"],
    [/payroll|gusto|adp|salary|wages/, "salaries_wages"],
    [/google ads|facebook|meta|ad spend|marketing|mailchimp|hubspot/, "marketing_advertising"],
    [/uber|lyft|flight|hotel|airbnb|travel/, "travel_entertainment"],
    [/insurance/, "insurance"],
    [/electric|water|utility|comcast|internet|phone|verizon|at&t/, "utilities"],
    [/legal|accounting|consult|attorney|lawyer/, "professional_services"],
    [/staples|office depot/, "office_supplies"],
    [/fee|bank charge/, "miscellaneous_expense"],
    [/interest/, "interest_expense"],
  ];
  for(const [re,role] of map) if(re.test(d)) return role;
  return "miscellaneous_expense";
}

export default function ReconView() {
  const {
    bankAccounts, invoices, setInvoices, reconciliations,
    currentCompany, session, supabase, bookToDb, logAudit, showNotification, loadAllData,
    CHART_OF_ACCOUNTS, setView, getAccountByRole, cashGlCodes, loadStatementExceptions,
    reconcileOffer, setReconcileOffer, offerReconciliation,
  } = useERP();

  const fmt = fmtSignedMoney;
  const today = new Date();
  // Local month boundaries (period keys) — ymdLocal, not toISOString (which UTC-shifts the day).
  const lastMonthStart = ymdLocal(new Date(today.getFullYear(), today.getMonth()-1, 1));
  const lastMonthEnd = ymdLocal(new Date(today.getFullYear(), today.getMonth(), 0));

  const [step, setStep] = React.useState("landing"); // landing | setup | match | summary | done
  const [accountId, setAccountId] = React.useState((bankAccounts||[])[0]?.id || "manual");
  const [accountName, setAccountName] = React.useState((bankAccounts||[])[0]?.name || "Primary Checking");
  const [periodStart, setPeriodStart] = React.useState(lastMonthStart);
  const [periodEnd, setPeriodEnd] = React.useState(lastMonthEnd);
  const [statementBalance, setStatementBalance] = React.useState("");
  const [bankTxns, setBankTxns] = React.useState([]);
  const [outstanding, setOutstanding] = React.useState({});
  const [reconId, setReconId] = React.useState(null);
  const [addQuick, setAddQuick] = React.useState(null);
  const [processing, setProcessing] = React.useState(false);
  const [autoBanner, setAutoBanner] = React.useState(null);
  const [viewRecId, setViewRecId] = React.useState(null);
  const [emptyConfirmed, setEmptyConfirmed] = React.useState(false);   // O83: explicit "account is empty/closed" for a real $0 ending balance
  const [stmtOpening, setStmtOpening] = React.useState(null);          // O83: statement's STATED opening balance (for the books-opening discrepancy flag)
  const [saveError, setSaveError] = React.useState(false);             // autosave persistence failed → surfaced (never silent)
  const saveErrorRef = React.useRef(false);
  const saveTimer = React.useRef(null);
  const savingPromiseRef = React.useRef(null);          // C194 — in-flight autosave, awaited by completion
  const [completing, setCompleting] = React.useState(false);
  const [completeError, setCompleteError] = React.useState(null);   // C194 — set ONLY when the completion write did not verify

  // O83: in-progress reconciliations persist with status 'open' (RECON_STATUSES = open|complete;
  // 'open' = "not fully reconciled", CHECK-allowed). (Was 'in_progress', which the CHECK rejected
  // → autosave silently failed and mid-reconciliation work was lost.)
  const inProgress = (reconciliations||[]).find(r => r.status==="open");
  const completed = (reconciliations||[]).filter(r => r.status==="complete");

  // completed_by is a uuid (matches every other actor column). Resolve it to a
  // display name for the "By" field: the current user is known from the session;
  // other members are looked up from public.users (best-effort — falls back to
  // "—" if RLS blocks the read). Keeps writing the uuid; only the read resolves.
  const [memberNames, setMemberNames] = React.useState({});
  React.useEffect(() => {
    const ids = [...new Set((reconciliations||[]).map(r=>r.completed_by).filter(Boolean))]
      .filter(id => id !== session?.user?.id && !(id in memberNames));
    if (!ids.length) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("users").select("id, full_name, email").in("id", ids);
        if (!cancelled && Array.isArray(data))
          setMemberNames(prev => ({ ...prev, ...Object.fromEntries(data.map(u => [u.id, u.full_name || u.email || u.id])) }));
      } catch { /* users table / RLS may block — graceful fallback below */ }
    })();
    return () => { cancelled = true; };
  }, [reconciliations, session]);  // eslint-disable-line react-hooks/exhaustive-deps
  // ── C198·1 (j)+(l) — THE OFFERED SESSION ────────────────────────────────────
  // When every line of a statement is already in the books, the system hands over a
  // READY session instead of an empty screen that demands the file a third time: the
  // account, the month, the statement's own lines, and its stated ending balance
  // (O86 (j)/(l), live — the operator had to upload twice more and hand-type a number
  // the database was already holding). The balance lands in the field EDITABLE: it is
  // still the CPA's independent check, and anything they type governs from then on.
  const [offerTaken, setOfferTaken] = React.useState(false);
  const [prefilledFromStatement, setPrefilledFromStatement] = React.useState(false);
  React.useEffect(() => {
    if (!reconcileOffer || offerTaken || !currentCompany?.id) return;
    let cancelled = false;
    (async () => {
      setOfferTaken(true);
      try {
        const { data: lines } = await supabase.from("bank_statement_lines")
          .select("id, line_date, description, vendor, amount")
          .eq("company_id", currentCompany.id).eq("statement_id", reconcileOffer.statementId);
        if (cancelled) return;
        const rows = (lines || []).map((l) => ({
          id: "s_" + l.id, date: l.line_date, description: l.description || l.vendor || "Transaction",
          amount: Number(l.amount) || 0, _matchBook: null,
        }));
        if (reconcileOffer.accountId) setAccountId(reconcileOffer.accountId);
        if (reconcileOffer.accountName) setAccountName(reconcileOffer.accountName);
        if (reconcileOffer.periodStart) setPeriodStart(reconcileOffer.periodStart);
        if (reconcileOffer.periodEnd) setPeriodEnd(reconcileOffer.periodEnd);
        // (l) — prefill ONLY into an empty field; a typed value is never overwritten.
        const pre = prefillEndingBalance({ statement: { stated_ending_balance: reconcileOffer.statedEnding }, current: statementBalance });
        if (pre != null) { setStatementBalance(pre); setPrefilledFromStatement(true); }
        if (rows.length) { setBankTxns(rows); setStep("match"); setTimeout(() => runAutoMatch(rows), 50); }
        setReconcileOffer && setReconcileOffer(null);
      } catch (e) { console.warn("[recon] offered session skipped:", e?.message || e); }
    })();
    return () => { cancelled = true; };
  }, [reconcileOffer, offerTaken, currentCompany?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // (l) — the same prefill for a session started by hand: once an account + month are
  // chosen and a statement exists for them, its stated ending balance fills the field.
  // Empty-field-only, so it can never clobber the CPA's own number.
  const [periodStatements, setPeriodStatements] = React.useState([]);
  React.useEffect(() => {
    if (!currentCompany?.id || step === "landing") return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("bank_statements")
          .select("id, bank_account_id, period_start, period_end, stated_ending_balance, status, created_at")
          .eq("company_id", currentCompany.id).neq("status", "superseded");
        if (!cancelled) setPeriodStatements(data || []);
      } catch { /* pre-058 */ }
    })();
    return () => { cancelled = true; };
  }, [currentCompany?.id, step]);
  React.useEffect(() => {
    if (statementBalance !== "") return;                       // never overwrite a typed value
    const st = statementForPeriod(periodStatements, { accountId, periodStart, periodEnd });
    const pre = prefillEndingBalance({ statement: st, current: statementBalance });
    if (pre != null) { setStatementBalance(pre); setPrefilledFromStatement(true); }
  }, [periodStatements, accountId, periodStart, periodEnd]);   // eslint-disable-line react-hooks/exhaustive-deps

  const nameForUser = (uid) => {
    if (!uid) return "—";
    if (uid === session?.user?.id) return session?.user?.email || "You";
    return memberNames[uid] || "—";
  };

  // Books side = entries that actually HIT the reconciled cash account (GL-derived, §9/§12).
  // The bank only sees cash, so an accrual bill (Dr Expense / Cr A/P) or an uncollected AR
  // invoice (Dr A/R / Cr Revenue) — which move no cash — must NOT be here (they were before,
  // as permanent unmatchable phantoms that corrupted the difference). Each cash entry appears
  // once, signed by its cash-leg direction (cash debited = in +, credited = out −).
  const reconCashCodes = React.useMemo(() => {
    const acct = (bankAccounts||[]).find(b => String(b.id)===String(accountId));
    if (acct?.gl_code) return [String(acct.gl_code)];                 // the specific reconciled bank account
    const all = [...(cashGlCodes||[])].map(String);
    if (all.length) return all;                                        // manual/unlinked → any cash account
    const role = getAccountByRole?.("cash")?.code;
    return role ? [String(role)] : [];
  }, [accountId, bankAccounts, cashGlCodes]);   // eslint-disable-line react-hooks/exhaustive-deps
  const bookSigned = i => cashLegSigned(i, reconCashCodes);
  // Matchable book rows EXCLUDE the opening-balance entry (the cleared starting position, not a
  // transaction to match/sort out — BUG 2). It stays reflected in booksBalance below via the GL.
  const booksRowsAll = reconBooksSet(invoices, { cashCodes: reconCashCodes, from: periodStart, to: periodEnd });
  const booksRows = booksRowsAll.filter(b => !isOpeningPositionRow(b, periodStart));
  const matchedBookIds = new Set(bankTxns.filter(t=>t._matchBook).map(t=>t._matchBook));
  const unmatchedBank = bankTxns.filter(t=>!t._matchBook && !t._ignored);
  // Two DISTINCT sets (O83 Feb fix): the still-UNDECIDED sort-out queue (not matched, not yet
  // marked) and the DECIDED outstanding items ("hasn't hit the bank yet"). They're exact
  // complements. Only the DECIDED-outstanding items net the difference; undecided items keep it
  // open until resolved (so un-marking an item restores the gap). Previously the marking was fed
  // ONLY to `hidden`, so a marked item vanished from BOTH the queue and the sum — read as
  // "matched" in the count yet the difference never netted it, blocking completion.
  const unmatchedBooks   = reconOutstandingBooks(booksRows, { matchedBookIds, hidden: outstanding, periodStart });
  const outstandingBooks = reconMarkedOutstanding(booksRows, { matchedBookIds, marked: outstanding, periodStart });
  const stmtNum = parseFloat(statementBalance)||0;
  // BUG 1 FIX: "What your books show" = GL cash for THIS account at period end, from the ledger
  // — independent of the bank-balance input (the old `stmtNum − diff` mutated it and mis-read
  // the opening entry as the whole books figure).
  const booksBalance = reconBooksBalance(invoices, reconCashCodes, { asOf: periodEnd });
  const outstandingSigned = outstandingBooks.reduce((s,b)=>s+bookSigned(b),0);
  const unmatchedBankSigned = unmatchedBank.reduce((s,t)=>s+(Number(t.amount)||0),0);
  const diff = reconcileDifference({ statementBalance: stmtNum, booksBalance, outstandingSigned, unmatchedBankSigned });
  const matchedCount = bankTxns.filter(t=>t._matchBook).length;
  const matchedBooksCount = booksRows.filter(b=>matchedBookIds.has(b.id)).length;
  // BUG 2 (discrepancy): the statement's stated opening vs GL CASH AT PERIOD START — the balance
  // the books carry INTO the period (cash as of the day before periodStart), NOT the opening ENTRY
  // alone. The opening entry is only the first month's starting position; from month 2 on, books
  // cash at period start = opening + all prior activity, so comparing to the opening entry false-
  // fires by exactly the prior period's net income (O83 Feb). Same reconBooksBalance source as the
  // "what your books show" figure above. Auto-resolved either way (a real gap is a flag, not a task).
  const glCashAtPeriodStart = reconBooksBalance(invoices, reconCashCodes, { asOf: addDaysYMD(periodStart, -1) });
  const openingMismatch = (stmtOpening != null) ? openingDiscrepancy({ statedOpening: stmtOpening, recordedOpening: glCashAtPeriodStart }) : { mismatch:false, diff:0 };
  // C195(8) — how many KNOWN uncashed items (from the prior period's chain) account for the gap?
  const openingExplainedCount = React.useMemo(() => {
    if (!openingMismatch.mismatch) return 0;
    const cands = priorOutstandingCandidates({ reconciliations, accountId, accountName, periodStart });
    const total = cands.reduce((s2, c) => s2 + (Number(c.signed) || 0), 0);
    return Math.abs(total + Number(openingMismatch.diff || 0)) < 0.005 ? cands.length : 0;
  }, [openingMismatch.mismatch, openingMismatch.diff, reconciliations, accountId, accountName, periodStart]);

  // ── C196(1) — THE HEADLINE FIX. "Things we need to sort out" offered **Accept & add** for a
  // bank line that was actually a PRIOR PERIOD'S OUTSTANDING CHECK clearing — one human click on
  // a product suggestion produced the program's first wrong ledger entry (a duplicate expense).
  // The pipeline already answers this exact question (C187); this surface simply never asked.
  // Map: bank-line id → the outstanding candidate it clears (if any).
  const chainClears = React.useMemo(() => {
    const cands = priorOutstandingCandidates({ reconciliations, accountId, accountName, periodStart });
    if (!cands.length) return {};
    const { clears } = matchOutstandingClears(unmatchedBank, cands);
    const m = {};
    for (const c of clears) m[String(c.line.id)] = c.candidate;
    return m;
  }, [reconciliations, accountId, accountName, periodStart, unmatchedBank]);

  // Match a bank line to the existing entry it clears: stamp the ENTRY cleared (the same write the
  // pipeline's clear path makes, via checkedRowUpdate) and mark the line matched to that jeId so it
  // counts on the statement side and the difference resolves through the outstanding math.
  // BOOKS NOTHING — that is the whole point.
  const matchToOutstanding = async (t, candidate) => {
    if (!candidate?.jeId) return;
    const r = await checkedRowUpdate({ supabase, table: "journal_entries", id: candidate.jeId, companyId: currentCompany.id,
      patch: { cleared: true, cleared_at: t.date || null }, label: "recon:match-outstanding" });
    if (!r.ok) { showNotification && showNotification("We couldn't link that — nothing was changed. Please try again.", "error"); return; }
    setInvoices(prev => prev.map(i => (String(i.db_entry_id) === String(candidate.jeId) || String(i.id) === String(candidate.jeId)) ? { ...i, cleared: true, cleared_at: t.date || null } : i));
    setBankTxns(prev => prev.map(x => x.id === t.id ? { ...x, _matchBook: candidate.jeId, _auto: false, _conf: 100 } : x));
    logAudit && logAudit("recon_matched_outstanding", `Matched ${fmt(t.amount)} on ${fmtDate(t.date)} to the existing entry it cleared (no new entry created)`, null, { bank_line: t.id, journal_entry_id: candidate.jeId });
    queueSave();
  };

  // A statement balance is "verified" when it's a real non-zero ending balance OR the user
  // explicitly confirmed a genuinely-empty/closed account ($0). Distinguishes a real
  // reconciliation from the unverified-$0 phantom the hardened gate ignores (O83).
  const balanceVerified = statementBalanceVerified(statementBalance, emptyConfirmed);
  const serialize = (status) => ({
    company_id: currentCompany?.id,
    account_id: accountId && accountId!=="manual" ? accountId : null,
    account_name: accountName,
    period_start: periodStart, period_end: periodEnd,
    statement_balance: stmtNum, books_balance: booksBalance, difference: diff,
    statement_balance_verified: balanceVerified,
    status: status || "open",
    matched_transactions: bankTxns.filter(t=>t._matchBook).map(t=>({ bank:t, bookId:t._matchBook, conf:t._conf })),
    unmatched_bank: bankTxns.filter(t=>!t._matchBook),
    unmatched_books: unmatchedBooks.map(b=>b.id),
    // The DECIDED-outstanding book items ("hasn't hit the bank yet") — persisted so the marking
    // survives Save Progress/resume AND a completed record's history shows what was outstanding
    // (migration 057). `signed` is the cash-signed amount (a check = negative), so the trust-layer
    // bank-match control can NET the reconciliation the same way the completion bar does (C183) —
    // without re-deriving the sign from the ledger.
    outstanding_books: outstandingBooks.map(b=>({ id:b.id, date:b.date, amount:b.amount, signed:bookSigned(b), gl_code:b.gl_code, description:b.description })),
    added_during_reconciliation: bankTxns.filter(t=>t._added).map(t=>t._added),
  });
  const reconIdRef = React.useRef(null);   // synchronous mirror of reconId
  const savingRef = React.useRef(false);   // true while an insert is in flight
  // Persist the session. Surfaces failures — silent failed persistence is never acceptable
  // (the 'in_progress' CHECK violation that lost work). Notifies once on failure and once on
  // recovery (deduped via saveErrorRef so autosave retries don't spam).
  // C194 — the completion path AWAITS any in-flight autosave (savingPromiseRef) before deciding
  // whether a row exists. Without this, clicking "Lock and Complete" inside the 2s autosave
  // debounce window meant the insert was still in flight, `reconId` (state) was null, and
  // completion inserted a SECOND row — the ordering-dependent seam behind the live failure.
  const saveNow = async (status) => {
    const p = runSave(status);
    savingPromiseRef.current = p;
    try { return await p; } finally { if (savingPromiseRef.current === p) savingPromiseRef.current = null; }
  };
  const runSave = async (status) => {
    if (!currentCompany?.id) return;
    const existingId = reconId || reconIdRef.current;
    // Don't fire a second INSERT before the first one has returned an id.
    if (!existingId && savingRef.current) return;
    const payload = serialize(status);
    let err = null;
    try {
      if (existingId) {
        // C194 — CHECKED: a zero-row update (the row was superseded/deleted under us) is a real
        // failure, not a silent success. Falling back to an insert would duplicate; surfacing it
        // lets the retry path re-create cleanly.
        const r = await checkedRowUpdate({ supabase, table: "reconciliations", id: existingId, companyId: currentCompany.id, patch: payload, label: "recon:autosave" });
        err = r.ok ? null : { message: `autosave did not persist (${r.reason})` };
      } else {
        savingRef.current = true;
        const { data, error } = await supabase.from("reconciliations").insert(payload).select("id").single();
        err = error;
        if (data?.id) { reconIdRef.current = data.id; setReconId(data.id); }
      }
    } catch(e){ err = e; }
    finally { savingRef.current = false; }
    if (err) {
      console.warn("[reconciliations] save failed:", err.message || err);
      if (!saveErrorRef.current) { saveErrorRef.current = true; setSaveError(true); showNotification && showNotification("Couldn't save your reconciliation progress — check your connection. Your matches are still on screen; we'll keep trying.", "error"); }
      return false;
    }
    if (saveErrorRef.current) { saveErrorRef.current = false; setSaveError(false); showNotification && showNotification("Progress saved ✓"); }
    return true;
  };
  const queueSave = () => { if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(()=>saveNow("open"), 2000); };

  const runAutoMatch = (txns) => {
    const books = reconBooksSet(invoices, { cashCodes: reconCashCodes, from: periodStart, to: periodEnd });
    const used = new Set(); let n=0;
    const out = txns.map(t => {
      if (t._matchBook) return t;
      let best=null, bestScore=1e9;
      for (const b of books) {
        if (used.has(b.id)) continue;
        if (Math.abs(bookSigned(b) - t.amount) > 0.01) continue;
        const dd = Math.abs((new Date(t.date)-new Date(b.date))/86400000);
        if (isNaN(dd) || dd>7) continue;
        if (dd < bestScore) { bestScore=dd; best=b; }
      }
      if (best) { used.add(best.id); n++; const conf=Math.max(70,100-Math.round(bestScore*5)); return { ...t, _matchBook:best.id, _auto:true, _conf:conf }; }
      return t;
    });
    setBankTxns(out);
    const rem = out.filter(t=>!t._matchBook && !t._ignored).length;
    setAutoBanner(`I automatically matched ${n} transaction${n!==1?"s":""}. Review the ${rem} unmatched item${rem!==1?"s":""} below.`);
  };

  const toggleMatch = (t) => {
    if (t._matchBook) setBankTxns(prev=>prev.map(x=>x.id===t.id?{...x,_matchBook:null,_auto:false,_conf:0}:x));
    else {
      const cand = booksRows.find(b=>!matchedBookIds.has(b.id) && Math.abs(bookSigned(b)-t.amount)<0.01);
      if (cand) setBankTxns(prev=>prev.map(x=>x.id===t.id?{...x,_matchBook:cand.id,_auto:false,_conf:100}:x));
      else showNotification && showNotification("No matching book entry — use the resolution options below.", "error");
    }
    queueSave();
  };
  const ignoreBank = (t) => { setBankTxns(prev=>prev.map(x=>x.id===t.id?{...x,_ignored:true,_matchBook:null}:x)); queueSave(); };
  const markOutstanding = (b) => { setOutstanding(p=>({...p,[b.id]:true})); queueSave(); };
  const voidBook = (b) => {
    // Destructive — confirm before removing a booked entry (O83: the void option sits next to
    // a client-visible sort-out prompt; a mis-click must not silently delete a real entry).
    if (typeof window !== "undefined" && window.confirm && !window.confirm(`Remove "${b.vendor}" (${fmt(b.amount)}) from your books? This voids the entry.`)) return;
    setInvoices(prev=>prev.map(i=>i.id===b.id?{...i,status:"voided",voided_at:new Date().toISOString(),voided_reason:"Voided during reconciliation"}:i));
    logAudit && logAudit("invoice_voided",`Voided ${b.vendor} ${fmt(b.amount)} during reconciliation`,b,null); queueSave();
  };

  const addToBooks = (t, gl) => {
    const isRev = t.amount>0;
    const inv = {
      id: Date.now()+Math.random(), vendor: (t.description||"Bank transaction").slice(0,60), description: t.description||"Added during reconciliation",
      amount: Math.abs(t.amount), date: t.date, type: isRev?"revenue":"expense",
      gl_code: gl.gl_code, gl_name: gl.gl_name, secondary_gl_code:getAccountByRole("cash")?.code, secondary_gl_name:getAccountByRole("cash")?.name,
      debit_credit: isRev?"credit":"debit", confidence: 90, reasoning:"Added during bank reconciliation",
      status:"booked", booked_at:new Date().toISOString(), source:"reconciliation", payment_status: isRev?"collected":"paid",
      _added: { date:t.date, vendor:t.description, amount:t.amount, gl_code:gl.gl_code },
    };
    setInvoices(prev=>[inv, ...prev]);
    bookToDb && bookToDb(inv);
    setBankTxns(prev=>prev.map(x=>x.id===t.id?{...x,_matchBook:inv.id,_auto:false,_conf:100,_added:inv._added}:x));
    setAddQuick(null);
    logAudit && logAudit("recon_add","Added "+inv.vendor+" "+fmt(inv.amount)+" during reconciliation",null,inv._added);
    queueSave();
  };

  const completeMatch = async () => {
    // O83 — GUARD AT THE SOURCE: never finish a reconciliation without a real, verified bank
    // ending balance. A blank balance is blocked; a genuine $0 needs the explicit empty-account
    // confirmation (which sets statement_balance_verified so the gate treats it as verified-zero).
    if (!statementBalance || !balanceVerified) {
      showNotification && showNotification(!statementBalance ? "Enter your bank statement's ending balance to finish." : "Confirm the account is empty/closed (its balance is $0.00) to finish.", "error");
      return;
    }
    const at=new Date().toISOString(); const uid=session?.user?.id||null;  // reconciliations.completed_by is a uuid column
    const ids = bankTxns.filter(t=>t._matchBook).map(t=>t._matchBook);

    // ── C194 — WRITE, THEN VERIFY. Nothing below runs until a row has been RE-SELECTED at
    // status='complete'. This is the gate that the live false-success bypassed entirely. ──
    setCompleting(true); setCompleteError(null);
    const payload = { ...serialize("complete"), completed_at:at, completed_by:uid };
    // Never race the autosave: wait for an in-flight insert so we see its id (ordering fix).
    if (savingPromiseRef.current) { try { await savingPromiseRef.current; } catch {} }
    let rid = resolveReconRowId({ stateId: reconId, refId: reconIdRef.current });   // ref FIRST (sync mirror)
    let writeErr = null;
    if (rid) {
      const r = await checkedRowUpdate({ supabase, table:"reconciliations", id: rid, companyId: currentCompany.id, patch: payload, label: "recon:complete" });
      if (!r.ok) rid = null;   // the row is gone (superseded/deleted) → fall through and create one
    }
    if (!rid) {
      try {
        const { data, error } = await supabase.from("reconciliations").insert(payload).select("id").single();
        if (error || !data?.id) writeErr = error || new Error("insert returned no id");
        else { rid = data.id; reconIdRef.current = rid; setReconId(rid); }
      } catch (e) { writeErr = e; }
    }
    // VERIFY by re-select — the row must actually exist AND read 'complete'.
    let verifyRow = null, verifyErr = writeErr;
    if (rid && !writeErr) {
      try {
        const { data, error } = await supabase.from("reconciliations").select("id, status").eq("id", rid).eq("company_id", currentCompany.id).maybeSingle();
        verifyRow = data || null; verifyErr = error || null;
      } catch (e) { verifyErr = e; }
    }
    const gate = reconCompletionGate({ rid, error: verifyErr, row: verifyRow });
    if (!gate.proceed) {
      // NO success screen, NO ✓, NO completion audit event — and say plainly that nothing saved.
      console.error("[reconciliations] completion NOT verified:", gate.reason, verifyErr?.message || "");
      logAudit && logAudit("reconciliation_complete_failed", `Reconciliation completion did not persist for ${accountName} ${periodStart}→${periodEnd} (${gate.reason}) — nothing was locked in`, null, { account: accountName, period: `${periodStart}→${periodEnd}`, reason: gate.reason });
      setCompleteError(gate.reason);
      setCompleting(false);
      showNotification && showNotification(reconCompletionCopy(gate), "error");
      return;
    }

    // ── VERIFIED. Only now may anything downstream run. ──
    setInvoices(prev=>prev.map(i=>ids.includes(i.id)?{...i,cleared:true,cleared_at:at}:i));
    try {
      // HARDEN (O83 Bug 2): completing SUPERSEDES any OTHER open/in-progress autosave row for the
      // SAME account+period — so a mid-session save failure that stranded a phantom row can't leave
      // a period both Complete (in History) AND resumable (the operator completed Feb twice this way).
      // The Complete record is the source of truth; the orphan open rows are deleted.
      try {
        const { data: openRows } = await supabase.from("reconciliations")
          .select("id, status, account_id, account_name, period_start, period_end")
          .eq("company_id", currentCompany.id).eq("status", "open");
        const stale = supersedableOpenReconciliations(openRows || [], { accountId, accountName, periodStart, periodEnd, keepId: rid });
        if (stale.length) {
          const { error: supErr } = await supabase.from("reconciliations").delete().in("id", stale.map(r=>r.id)).eq("company_id", currentCompany.id);
          if (supErr) console.warn("[reconciliations] supersede open rows failed:", supErr.message);
          else logAudit && logAudit("reconciliation_superseded_open", `Completing ${accountName} ${periodStart}→${periodEnd} closed ${stale.length} stale in-progress reconciliation${stale.length===1?"":"s"} for the same period`, null, { account: accountName, period: `${periodStart}→${periodEnd}`, completed_id: rid, superseded: stale.map(r=>r.id) });
        }
      } catch(e) { console.warn("[reconciliations] supersede skipped:", e?.message||e); }
      const dbIds = invoices.filter(i=>ids.includes(i.id) && i.db_entry_id).map(i=>i.db_entry_id);
      if (dbIds.length) {
        // C194 — checked batch: the cleared stamps are part of the attestation record.
        await checkedIdsUpdate({ supabase, table: "journal_entries", ids: dbIds, companyId: currentCompany.id,
          patch: { cleared:true, cleared_at:at, reconciliation_id: rid }, label: "recon:cleared-stamp" });
      }
    } catch(e){ console.warn("[reconciliations] post-verify step failed:", e.message); }
    // Auto-update the reconciled bank account's current balance to the statement
    // ending balance (migration 026). loadAllData() below re-derives dashboard cash.
    if (accountId && accountId !== "manual") {
      await checkedRowUpdate({ supabase, table: "bank_accounts", id: accountId, companyId: currentCompany.id,
        patch: { current_balance: stmtNum }, label: "recon:bank-balance" });
    }
    // C195(2) — the reconciliation ANSWERS any statement it covers: retire 'attention' statements
    // for this account whose period sits inside the reconciled period and which have no unresolved
    // excepted lines, so their cards stop outliving the signed-off month.
    try {
      const { data: stmts } = await supabase.from("bank_statements")
        .select("id, bank_account_id, period_start, period_end, status")
        .eq("company_id", currentCompany.id).eq("status", "attention");
      if ((stmts || []).length) {
        const { data: excLines } = await supabase.from("bank_statement_lines")
          .select("statement_id").eq("company_id", currentCompany.id).eq("status", "excepted");
        const covered = statementsCoveredByReconciliation(stmts || [], {
          accountId, periodStart, periodEnd,
          exceptedStatementIds: (excLines || []).map(l => l.statement_id),
        });
        for (const sid of covered) {
          await checkedRowUpdate({ supabase, table: "bank_statements", id: sid, companyId: currentCompany.id,
            patch: { status: "complete" }, label: "recon:retire-covered-statement" });
        }
        if (covered.length) {
          logAudit && logAudit("statement_retired_by_reconciliation", `${covered.length} statement${covered.length===1?"":"s"} covered by the ${periodStart}→${periodEnd} reconciliation ${covered.length===1?"was":"were"} closed out`, null, { statements: covered, period: `${periodStart}→${periodEnd}` });
          try { await loadStatementExceptions && loadStatementExceptions(currentCompany.id); } catch {}
        }
      }
    } catch (e) { console.warn("[reconciliations] retire covered statements skipped:", e?.message || e); }

    setCompleting(false);
    logAudit && logAudit("reconciliation_completed", `Bank reconciliation completed for ${accountName} ${periodStart}→${periodEnd} — balance ${fmt(stmtNum)}`, null, { account:accountName, period:`${periodStart}→${periodEnd}`, balance:stmtNum, reconciliation_id: rid });
    showNotification && showNotification(RECON_COMPLETE_SUCCESS_COPY);
    loadAllData && loadAllData();
    setStep("done");
  };

  const fileToB64 = (file) => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]||""); r.onerror=rej; r.readAsDataURL(file); });

  // The only way to start: upload a bank statement (PDF via AI vision, or CSV parsed locally).
  const processFile = async (file) => {
    if (!file) return;
    const v = validateUpload(file, "bank");   // size + type guard (CR-34)
    if (!v.ok) { showNotification && showNotification(v.error, "error"); return; }
    if (/\.csv$/i.test(file.name)) {
      const r=new FileReader();
      r.onload=e=>{ const rows=parseBankCSV(String(e.target.result||"")); if(!rows.length){ showNotification && showNotification("Couldn't read that CSV — it needs date, description and amount columns.","error"); return;} setBankTxns(rows.map(x=>({...x,_matchBook:null}))); showNotification && showNotification(`Imported ${rows.length} transactions ✓`); };
      r.readAsText(file);
      return;
    }
    if (/\.pdf$/i.test(file.name)) {
      setProcessing(true);
      try {
        const base64 = await fileToB64(file);
        const res = await fetch(AI_PROXY_URL, {
          method:"POST", headers:getAuthHeaders(),
          body: JSON.stringify({ profile:"parse-bank-pdf", messages:[{ role:"user", content:[
            { type:"document", source:{ type:"base64", media_type:"application/pdf", data:base64 } },
            { type:"text", text:'Extract EVERY transaction from this bank statement. Use NEGATIVE amounts for money out (debits/withdrawals/payments) and POSITIVE for money in (deposits/credits). Include every single row.' },
          ] }] }),
        });
        const data = await okAIResponse(res);

        // The parse profile now returns { opening_balance, period_start, transactions[] }
        // (165b075) — the SHARED normalizer accepts that OR a legacy bare array, so the
        // Reconcile flow can't go stale on the shape (O83 "can't read PDF" regression).
        const { transactions: arr, statedOpening } = normalizeBankParse(aiJson(data, []));
        setStmtOpening(statedOpening != null && !isNaN(Number(statedOpening)) ? Number(statedOpening) : null);   // for the books-opening discrepancy flag (O83)
        const rows = (Array.isArray(arr)?arr:[]).map((t,i)=>({ id:"p_"+i+"_"+Math.random().toString(36).slice(2,6), date: normDate(t.date), description:(t.description||"Transaction").slice(0,140), amount: parseFloat(t.amount), _matchBook:null })).filter(r=>!isNaN(r.amount));
        if (!rows.length) showNotification && showNotification("Couldn't read transactions from that PDF — try a CSV export instead.","error");
        else { setBankTxns(rows); showNotification && showNotification(`Extracted ${rows.length} transactions from your statement ✓`); }
      } catch(e){ console.error("[recon] PDF extract failed:", e); showNotification && showNotification("Couldn't read that PDF: "+(e.message||"error"),"error"); }
      setProcessing(false);
      return;
    }
    showNotification && showNotification("Please upload a PDF or CSV bank statement.","error");
  };

  const resume = (rec) => {
    setReconId(rec.id);
    setAccountId(rec.account_id||"manual"); setAccountName(rec.account_name||"Account");
    setPeriodStart(rec.period_start); setPeriodEnd(rec.period_end);
    setStatementBalance(String(rec.statement_balance ?? ""));
    const matched=(rec.matched_transactions||[]).map(m=>({ ...m.bank, _matchBook:m.bookId, _auto:false, _conf:m.conf||100 }));
    const unm=(rec.unmatched_bank||[]).map(b=>({ ...b, _matchBook:null }));
    setBankTxns([...matched, ...unm]);
    // Restore the "hasn't hit the bank yet" markings so the difference stays netted across a
    // resume (O83 Feb: these were dropped on save, so a resumed rec silently lost its
    // outstanding items and the gap reappeared). Tolerates the legacy id-array shape too.
    const outMap = {};
    for (const o of (rec.outstanding_books || [])) { const id = (o && typeof o === "object") ? o.id : o; if (id != null) outMap[id] = true; }
    setOutstanding(outMap);
    setStep("match");
  };
  // C196(7) — ABANDON THIS MATCH. An accidentally-started session left an `open` reconciliation
  // row that needed manual SQL to clean up; there was no in-app way to discard it. Deletes THIS
  // session's row only (id-pinned + status='open' guarded, so a completed reconciliation can never
  // be destroyed by this button), audits it, and returns to the Reconcile home.
  const [abandoning, setAbandoning] = React.useState(false);
  const abandonMatch = async () => {
    const rid = resolveReconRowId({ stateId: reconId, refId: reconIdRef.current });
    if (!window.confirm("Discard this match session? Nothing in your books changes — we'll just throw away this unfinished session.")) return;
    setAbandoning(true);
    if (savingPromiseRef.current) { try { await savingPromiseRef.current; } catch {} }
    if (rid && currentCompany?.id) {
      try {
        const { error } = await supabase.from("reconciliations").delete()
          .eq("id", rid).eq("company_id", currentCompany.id).eq("status", "open").select("id");
        if (error) {
          setAbandoning(false);
          showNotification && showNotification("We couldn't discard that session — nothing was changed. Please try again.", "error");
          return;
        }
        logAudit && logAudit("reconciliation_abandoned", `Discarded an unfinished match session for ${accountName} ${periodStart}→${periodEnd}`, null, { reconciliation_id: rid, account: accountName, period: `${periodStart}→${periodEnd}` });
      } catch (e) { console.warn("[reconciliations] abandon failed:", e?.message || e); }
    }
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    setAbandoning(false);
    startFresh();
    setStep("landing");
    showNotification && showNotification("Match session discarded — your books are unchanged.");
  };

  const startFresh = () => { setReconId(null); setBankTxns([]); setOutstanding({}); setStatementBalance(""); setEmptyConfirmed(false); setStmtOpening(null); setStep("setup"); };

  const card = { background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, boxShadow:"0 1px 3px rgba(0,0,0,.08)" };
  const inp = { width:"100%", boxSizing:"border-box", background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:9, padding:"10px 12px", fontSize:14, color:"var(--sc-text)", outline:"none" };
  const lbl = { fontSize:11, color:"var(--sc-text-2)", letterSpacing:0.5, marginBottom:6, fontWeight:500 };

  // ════════ LANDING ════════
  if (step==="landing") {
    const viewing = viewRecId ? completed.find(r=>r.id===viewRecId) : null;
    // C198·3c (iii) — count what's actually in the books for THIS record's account + period, so
    // the auto-path detail can say what happened instead of scoring a match run that never ran.
    // Scoped to the reconciled account (its own cash code) exactly like reconCashCodes; when the
    // account can't be resolved we pass null and the helper prints an em dash rather than a
    // number derived from the wrong account.
    const viewingBooksCount = (() => {
      if (!viewing || !viewing.period_start || !viewing.period_end) return null;
      // STRICTLY this record's own account. Deliberately NO fallback to every cash code:
      // a multi-bank company would then be shown a figure summed across accounts (and a
      // cash-to-cash transfer counted twice) on a card whose whole job is to be exact.
      // An unresolvable account (a manual session, a deleted bank account) yields null and
      // the helper prints an em dash — the auto path always has a bound account, so nothing
      // that needs this number loses it.
      const acct = (bankAccounts||[]).find(b => String(b.id)===String(viewing.account_id));
      if (!acct?.gl_code) return null;
      return reconBooksSet(invoices, { cashCodes: [String(acct.gl_code)], from: viewing.period_start, to: viewing.period_end })
        .filter(b => !isOpeningPositionRow(b, viewing.period_start)).length;
    })();
    const viewingActivity = viewing ? reconciliationActivityLine(viewing, { booksCount: viewingBooksCount }) : null;
    if (viewing) return (
      <div>
        <button onClick={()=>setViewRecId(null)} style={{ marginBottom:16, padding:"7px 14px", borderRadius:9, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>← Back</button>
        <div style={{ ...card, padding:24, maxWidth:560 }}>
          <div style={{ fontSize:11, color:"var(--sc-success)", letterSpacing:1, marginBottom:8, fontWeight:600 }}>✓ COMPLETE</div>
          <h2 style={{ margin:"0 0 14px", fontSize:20 }}>{viewing.account_name} · {viewing.period_start} → {viewing.period_end}</h2>
          {[["Your bank's ending balance",fmt(viewing.statement_balance)],["What your books showed",fmt(viewing.books_balance)],["Difference",fmt(viewing.difference||0)],[viewingActivity.label,viewingActivity.value],["Completed",viewing.completed_at?new Date(viewing.completed_at).toLocaleString():"—"],["By",nameForUser(viewing.completed_by)]].map(([k,v])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderBottom:"1px solid var(--sc-surface-2)", fontSize:13 }}><span style={{ color:"var(--sc-text-2)" }}>{k}</span><span style={{ fontWeight:500 }}>{v}</span></div>
          ))}
        </div>
      </div>
    );
    return (
      <div>
        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>BANK MATCHING</div>
          <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Match your bank statement</h1>
          <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Tell us your bank's ending balance, match it to your books, and we'll lock it in. No jargon.</div>
        </div>
        {inProgress && (
          <div style={{ ...card, padding:"16px 20px", marginBottom:14, borderColor:"var(--sc-warning-soft)", background:"var(--sc-warning-soft)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
            <div style={{ fontSize:13, color:"var(--sc-warning)" }}>You have a match in progress for <strong>{inProgress.account_name}</strong> ({inProgress.period_start} → {inProgress.period_end}).</div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>resume(inProgress)} style={{ padding:"8px 16px", borderRadius:9, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:13, fontWeight:600, cursor:"pointer" }}>Resume</button>
              <button onClick={startFresh} style={{ padding:"8px 14px", borderRadius:9, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Start fresh</button>
            </div>
          </div>
        )}
        <button onClick={startFresh} className="sc-cta" style={{ padding:"13px 22px", borderRadius:11, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", fontSize:14, fontWeight:600, cursor:"pointer", marginBottom:24, boxShadow:"0 6px 18px rgba(109,94,246,.3)" }}>+ Start a new match</button>
        <div style={{ ...card, overflow:"hidden" }}>
          <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--sc-surface-2)", fontSize:13, fontWeight:600 }}>History</div>
          {completed.length===0 ? <div style={{ padding:"28px", textAlign:"center", color:"var(--sc-text-2)", fontSize:13 }}>No completed matches yet.</div> :
            completed.map(r=>{
              const od = r.completed_at && (Date.now()-new Date(r.completed_at).getTime())/86400000 > 35;
              return (
                <div key={r.id} onClick={()=>setViewRecId(r.id)} onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                  style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"13px 20px", borderTop:"1px solid var(--sc-surface-2)", cursor:"pointer" }}>
                  <div><div style={{ fontSize:13, fontWeight:500 }}>{r.account_name} · {fmtDate(r.period_start)} → {fmtDate(r.period_end)}</div><div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{fmt(r.statement_balance)} · {r.completed_at?fmtDate(r.completed_at):""}</div></div>
                  <span style={{ fontSize:11, fontWeight:600, color: od?"var(--sc-error)":"var(--sc-success)", background:(od?"var(--sc-error)":"var(--sc-success)")+"14", border:`1px solid ${(od?"var(--sc-error)":"var(--sc-success)")}33`, borderRadius:20, padding:"3px 10px" }}>{od?"Overdue":"Complete"}</span>
                </div>
              );
            })}
        </div>
      </div>
    );
  }

  // ════════ SETUP ════════
  if (step==="setup") return (
    <div style={{ maxWidth:560 }}>
      <button onClick={()=>setStep("landing")} style={{ marginBottom:16, background:"none", border:"none", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer", padding:0 }}>← Back</button>
      <h1 style={{ fontSize:24, fontWeight:600, margin:"0 0 6px" }}>Start a match</h1>
      <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:22 }}>Upload your bank statement — we'll read it and match it to your books.</div>

      {/* ★★ DON'T ASK FOR A FILE WE ALREADY HAVE. The saved statement was already being
          looked up ON THIS SCREEN — `statementForPeriod` feeds the balance prefill a few
          lines down — so at the exact moment we ask someone to upload it again, we know we
          are holding it and its parsed lines.
          The OFFERED route (from a pipeline or a Review card) has read saved lines since
          C185; only a manual start still demanded the file. Live cost, O83: the operator
          uploaded the same statement THREE TIMES and hand-typed a balance the database had.
          `offerReconciliation` is the same call the Review card makes, so this reuses that
          whole path rather than growing a second one. */}
      {(() => {
        const saved = statementForPeriod(periodStatements, { accountId, periodStart, periodEnd });
        if (!saved || !offerReconciliation) return null;
        return (
          <div style={{ ...card, padding:"14px 18px", marginBottom:14, display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", borderColor:"var(--sc-gold)" }}>
            <div style={{ flex:"1 1 260px", minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:600 }}>We already have this statement</div>
              <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2 }}>
                {accountName || "This account"} · {(periodStart||"").slice(0,7)} — read when it was uploaded, with its transactions and closing balance.
              </div>
            </div>
            <button onClick={()=>{ setOfferTaken(false); offerReconciliation(saved); }}
              style={{ padding:"9px 16px", borderRadius:9, fontSize:13, fontWeight:600, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer", flexShrink:0 }}>
              Use it →
            </button>
          </div>
        );
      })()}

      <div style={{ ...card, padding:24 }}>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:18 }}>
          <div>
            <div style={lbl}>WHICH ACCOUNT?</div>
            <select value={accountId} onChange={e=>{ setAccountId(e.target.value); const b=(bankAccounts||[]).find(x=>String(x.id)===e.target.value); setAccountName(b?.name||"Account"); }} style={inp}>
              {(bankAccounts||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="manual">Other / manual</option>
            </select>
          </div>
          <div>
            <div style={lbl}>WHICH MONTH?</div>
            <input type="month" value={(periodStart||"").slice(0,7)} onChange={e=>{ const ym=e.target.value; if(!ym) return; const [y,m]=ym.split("-").map(Number); setPeriodStart(`${ym}-01`); setPeriodEnd(`${ym}-${String(new Date(y,m,0).getDate()).padStart(2,"0")}`); }} style={inp} />
          </div>
        </div>
        <div style={{ marginBottom:18 }}>
          <div style={lbl}>UPLOAD YOUR BANK STATEMENT — PDF OR CSV</div>
          <label style={{ display:"block", border:`1.5px dashed ${bankTxns.length>0?"var(--sc-success)":"var(--sc-border-2)"}`, borderRadius:10, padding:"22px 16px", textAlign:"center", cursor: processing?"wait":"pointer", fontSize:13, color:"var(--sc-text-2)", background:bankTxns.length>0?"var(--sc-success-soft)":"var(--sc-bg)" }}>
            <input type="file" accept=".csv,.pdf" disabled={processing} style={{ display:"none" }} onChange={e=>{ const f=e.target.files?.[0]; e.target.value=""; processFile(f); }} />
            <div style={{ fontSize:26, marginBottom:8, opacity:0.6 }}>{processing?"⟳":bankTxns.length>0?"✓":"📄"}</div>
            {processing
              ? <span style={{ color:"var(--sc-gold)", fontWeight:600 }}>Reading your statement with AI…</span>
              : bankTxns.length>0
                ? <span style={{ color:"var(--sc-success)", fontWeight:600 }}>{bankTxns.length} transactions ready — upload a different file to redo</span>
                : <span>Drop a PDF or CSV here, or click to browse. PDFs are read with AI; CSVs from Chase, BofA, or any date/description/amount export import automatically.</span>}
          </label>
        </div>
        <button disabled={bankTxns.length===0 || processing} onClick={()=>{ setStep("match"); setTimeout(()=>runAutoMatch(bankTxns),50); }}
          style={{ width:"100%", padding:"13px", borderRadius:11, border:"none", fontSize:14, fontWeight:600, cursor: (bankTxns.length>0&&!processing)?"pointer":"not-allowed", background:(bankTxns.length>0&&!processing)?"var(--sc-gold)":"var(--sc-border)", color:(bankTxns.length>0&&!processing)?"var(--sc-surface)":"var(--sc-text-mut)" }}>{processing?"Reading statement…":"Start →"}</button>
      </div>
    </div>
  );

  // ════════ SUMMARY ════════
  if (step==="summary") {
    const addedN = bankTxns.filter(t=>t._added).length;
    return (
      <div style={{ maxWidth:520 }}>
        <h1 style={{ fontSize:24, fontWeight:600, margin:"0 0 6px" }}>Ready to lock it in</h1>
        <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:20 }}>Your books match your bank. Review and complete.</div>
        <div style={{ ...card, padding:24 }}>
          {[["Period matched",`${periodStart} → ${periodEnd}`],["Account",accountName],["Your bank's ending balance",fmt(stmtNum)],["Transactions matched",matchedCount],["Items added to books",addedN]].map(([k,v])=>(
            <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"11px 0", borderBottom:"1px solid var(--sc-surface-2)", fontSize:14 }}><span style={{ color:"var(--sc-text-2)" }}>{k}</span><span style={{ fontWeight:600 }}>{v}</span></div>
          ))}
          <div style={{ display:"flex", gap:10, marginTop:20 }}>
            <button onClick={completeMatch} disabled={completing} style={{ flex:1, padding:"13px", borderRadius:11, background: completing?"var(--sc-border)":"var(--sc-gold)", border:"none", color: completing?"var(--sc-text-mut)":"var(--sc-on-accent)", fontSize:14, fontWeight:600, cursor: completing?"wait":"pointer" }}>{completing?"Saving…":"Lock and Complete"}</button>
            <button onClick={()=>setStep("match")} style={{ padding:"13px 18px", borderRadius:11, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:14, cursor:"pointer" }}>Go back and review</button>
          </div>
          {/* C194 — the completion write did NOT verify. Say plainly that nothing was locked in
              (never imply a period is reconciled when the database disagrees) and offer a retry
              that re-attempts the same checked+verified write. */}
          {completeError && (
            <div style={{ marginTop:16, padding:"14px 16px", borderRadius:11, background:"var(--sc-error-soft)", border:"1px solid var(--sc-error)" }}>
              <div style={{ fontSize:13.5, fontWeight:600, color:"var(--sc-error)" }}>{RECON_COMPLETE_FAILURE_COPY}</div>
              <div style={{ display:"flex", gap:10, marginTop:12 }}>
                <button onClick={completeMatch} disabled={completing}
                  style={{ padding:"9px 16px", borderRadius:9, background:"var(--sc-error)", border:"none", color:"var(--sc-on-accent)", fontSize:13, fontWeight:600, cursor: completing?"wait":"pointer" }}>
                  {completing ? "Trying again…" : "Try again"}
                </button>
                <button onClick={()=>setStep("match")}
                  style={{ padding:"9px 16px", borderRadius:9, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>
                  Back to my matches
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ════════ DONE ════════
  if (step==="done") {
    const csv = () => {
      const lines=[["date","description","amount","matched"]];
      bankTxns.forEach(t=>lines.push([t.date,(t.description||"").replace(/,/g," "),t.amount, t._matchBook?"yes":"no"]));
      const blob=new Blob([lines.map(r=>r.join(",")).join("\n")],{type:"text/csv"}); const u=URL.createObjectURL(blob);
      const a=document.createElement("a"); a.href=u; a.download=`reconciliation_${accountName}_${periodEnd}.csv`; a.click(); URL.revokeObjectURL(u);
    };
    return (
      <div style={{ maxWidth:480, textAlign:"center", margin:"40px auto" }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"var(--sc-success-soft)", border:"2px solid var(--sc-success-soft)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, margin:"0 auto 18px" }}>✓</div>
        <h1 style={{ fontSize:24, fontWeight:700, margin:"0 0 8px" }}>Your books match your bank</h1>
        <div style={{ fontSize:14, color:"var(--sc-text-2)", marginBottom:24 }}>{accountName} · {periodStart} → {periodEnd} · {fmt(stmtNum)}</div>
        <div style={{ display:"flex", gap:10, justifyContent:"center", flexWrap:"wrap" }}>
          <button onClick={()=>{ setStep("landing"); setViewRecId(null); }} style={{ padding:"11px 20px", borderRadius:10, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:13, fontWeight:600, cursor:"pointer" }}>Done</button>
          <button onClick={csv} style={{ padding:"11px 20px", borderRadius:10, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Download report (CSV)</button>
          <button onClick={()=>setView("books")} style={{ padding:"11px 20px", borderRadius:10, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Back to Books</button>
        </div>
      </div>
    );
  }

  // ════════ MATCH (split screen) ════════
  const rowBase = { display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderTop:"1px solid var(--sc-surface-2)", fontSize:13 };
  return (
    <div style={{ paddingBottom:96 }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:10 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:600, margin:0 }}>Match your bank statement</h1>
          <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:3 }}>{accountName} · {periodStart} → {periodEnd}</div>
        </div>
        <button onClick={async()=>{ const ok = await saveNow("open"); if (ok) showNotification && showNotification("Progress saved ✓"); }} style={{ padding:"8px 16px", borderRadius:9, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Save Progress</button>
        {/* C196(7) — an accidental session must be discardable without a DBA. */}
        <button onClick={abandonMatch} disabled={abandoning} style={{ padding:"8px 14px", borderRadius:9, background:"transparent", border:"none", color:"var(--sc-text-mut)", fontSize:12.5, textDecoration:"underline", cursor: abandoning?"wait":"pointer" }}>{abandoning ? "Discarding…" : "Abandon this match"}</button>
      </div>

      {autoBanner && (
        <div style={{ ...card, padding:"12px 16px", marginBottom:14, background:"var(--sc-gold-soft)", borderColor:"var(--sc-gold-soft)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:13, color:"var(--sc-gold)" }}>✦ {autoBanner}</div>
          <button onClick={()=>setAutoBanner(null)} style={{ background:"none", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:16 }}>×</button>
        </div>
      )}
      {/* O83: persistent, honest banner when autosave can't persist — never fail silently. */}
      {saveError && (
        <div style={{ ...card, padding:"12px 16px", marginBottom:14, background:"var(--sc-error-soft)", borderColor:"var(--sc-error-soft)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:13, color:"var(--sc-error)" }}>⚠ We couldn't save your progress. Your matches are still here — check your connection, then <strong>Save Progress</strong>.</div>
          <button onClick={async()=>{ const ok = await saveNow("open"); if (ok) showNotification && showNotification("Progress saved ✓"); }} style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-error-soft)", color:"var(--sc-error)", fontSize:12, fontWeight:600, cursor:"pointer" }}>Retry</button>
        </div>
      )}
      {/* O83 — opening-balance discrepancy: the statement's stated opening ≠ the books' opening
          entry. The opening is auto-resolved either way (never a sort-out prompt); a genuine
          disagreement is surfaced here as a trust-layer flag, and the difference below reflects it. */}
      {openingMismatch.mismatch && (
        <div style={{ ...card, padding:"12px 16px", marginBottom:14, background:"var(--sc-warning-soft)", borderColor:"var(--sc-warning-soft)" }}>
          {/* C195(8) — consult the KNOWN uncashed items first: a gap the chain already explains is a
              ✓, not an alarm (the C179 false-alarm class). Only an unexplained gap gets flagged. */}
          <div style={{ fontSize:13, color: openingExplainedCount>0 ? "var(--sc-success)" : "var(--sc-warning)" }}>
            {openingExplainedCount>0 ? "" : "⚠ "}{openingMismatchCopy({ diff: openingMismatch.diff, explainedCount: openingExplainedCount, accountName })}
          </div>
        </div>
      )}

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
        {/* LEFT — bank */}
        <div style={{ ...card, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--sc-surface-2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:13, fontWeight:600 }}>Your bank statement</div>
            <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{matchedCount}/{bankTxns.length} matched · {fmt(unmatchedBank.reduce((s,t)=>s+t.amount,0))} remaining</div>
          </div>
          <div style={{ maxHeight:440, overflowY:"auto" }}>
            {bankTxns.length===0 ? <div style={{ padding:24, fontSize:13, color:"var(--sc-text-2)", textAlign:"center" }}>No bank transactions — go back and upload a statement.</div> :
              bankTxns.map(t=>(
                <div key={t.id} style={{ ...rowBase, background: t._ignored?"var(--sc-bg)":t._matchBook?"var(--sc-gold-soft)":"var(--sc-warning-soft)", opacity:t._ignored?0.6:1 }}>
                  <input type="checkbox" checked={!!t._matchBook} onChange={()=>toggleMatch(t)} title="This matches my bank" />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", color:"var(--sc-text)" }}>{t.description}{t._auto && <span style={{ marginLeft:6, fontSize:10, color:"var(--sc-gold)" }}>✦ auto {t._conf}%</span>}</div>
                    <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{fmtDate(t.date)}{t._ignored?" · ignored":""}</div>
                  </div>
                  <div style={{ fontFamily:"'DM Mono',monospace", color: t.amount>=0?"var(--sc-success)":"var(--sc-error)", flexShrink:0 }}>{fmt(t.amount)}</div>
                </div>
              ))}
          </div>
        </div>

        {/* RIGHT — books */}
        <div style={{ ...card, overflow:"hidden" }}>
          <div style={{ padding:"12px 16px", borderBottom:"1px solid var(--sc-surface-2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div style={{ fontSize:13, fontWeight:600 }}>Your books</div>
            <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{matchedBooksCount}/{booksRows.length} matched{outstandingBooks.length?` · ${outstandingBooks.length} outstanding`:""}{unmatchedBooks.length?` · ${unmatchedBooks.length} to sort out`:""}</div>
          </div>
          <div style={{ maxHeight:440, overflowY:"auto" }}>
            {booksRows.length===0 ? <div style={{ padding:24, fontSize:13, color:"var(--sc-text-2)", textAlign:"center" }}>No book transactions in this period.</div> :
              booksRows.map(b=>{
                const matched = matchedBookIds.has(b.id); const out = outstanding[b.id];
                return (
                  <div key={b.id} style={{ ...rowBase, background: out?"var(--sc-bg)":matched?"var(--sc-gold-soft)":"var(--sc-warning-soft)", opacity:out?0.6:1 }}>
                    <span style={{ width:24, height:24, borderRadius:7, background:vendorColor(b.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(b.vendor)}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", color:"var(--sc-text)" }}>{b.vendor}</div>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{fmtDate(b.date)} · {b.gl_code}{out?" · outstanding":""}</div>
                    </div>
                    <div style={{ fontFamily:"'DM Mono',monospace", color: bookSigned(b)>=0?"var(--sc-success)":"var(--sc-error)", flexShrink:0 }}>{fmt(bookSigned(b))}</div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      {/* RESOLUTION */}
      {(unmatchedBank.length>0 || unmatchedBooks.length>0) && (
        <div style={{ ...card, marginTop:14, padding:"16px 20px" }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>Things we need to sort out</div>
          {unmatchedBank.map(t=>{
            const _acct=getAccountByRole(suggestRole(t.description, t.amount));
            const gl={gl_code:_acct?.code, gl_name:_acct?.name};
            // C196(1) — chain-explained line: this is a prior entry CLEARING, not new activity.
            // Explain it and offer MATCH. Accept-&-add is NOT rendered — offering it here is what
            // produced the duplicate entry.
            const cleared = chainClears[String(t.id)];
            if (cleared) return (
              <div key={t.id} style={{ padding:"12px 0", borderTop:"1px solid var(--sc-surface-2)" }}>
                <div style={{ fontSize:13, color:"var(--sc-success)", marginBottom:4, fontWeight:600 }}>{outstandingClearedCopy({ date: cleared.date, amount: cleared.amount })}</div>
                <div style={{ fontSize:12.5, color:"var(--sc-text-2)", marginBottom:8, maxWidth:620, lineHeight:1.5 }}>
                  It's already in your books from when you wrote it — we'll link the two, not add it again.
                </div>
                <button onClick={()=>matchToOutstanding(t, cleared)}
                  style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-success)", border:"none", color:"var(--sc-on-accent)", fontSize:12, fontWeight:600, cursor:"pointer" }}>
                  {MATCH_EXISTING_ACTION_LABEL}
                </button>
              </div>
            );
            return (
              <div key={t.id} style={{ padding:"12px 0", borderTop:"1px solid var(--sc-surface-2)" }}>
                <div style={{ fontSize:13, color:"var(--sc-warning)", marginBottom:6 }}>This is in your bank but not your books — <strong>{t.description}</strong> ({fmt(t.amount)}, {fmtDate(t.date)})</div>
                {addQuick===t.id ? (
                  <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", background:"var(--sc-bg)", padding:"10px", borderRadius:9 }}>
                    <span style={{ fontSize:12, color:"var(--sc-text-2)" }}>Add as:</span>
                    <select id={`gl_${t.id}`} defaultValue={gl.gl_code} style={{ ...inp, width:260 }}>
                      {(CHART_OF_ACCOUNTS||[]).filter(a=>a.code>="4000").map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                    <button onClick={()=>{ const code=document.getElementById(`gl_${t.id}`).value; const a=(CHART_OF_ACCOUNTS||[]).find(x=>x.code===code)||gl; addToBooks(t,{gl_code:a.code,gl_name:a.name}); }} style={{ padding:"9px 14px", borderRadius:8, background:"var(--sc-success)", border:"none", color:"var(--sc-on-accent)", fontSize:12, fontWeight:600, cursor:"pointer" }}>Add to books</button>
                    <button onClick={()=>setAddQuick(null)} style={{ padding:"9px 12px", borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:12, cursor:"pointer" }}>Cancel</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                    <span style={{ fontSize:12, color:"var(--sc-gold)", background:"var(--sc-gold-soft)", border:"1px solid var(--sc-gold-soft)", borderRadius:8, padding:"5px 10px" }}>✦ Looks like {gl.gl_name}</span>
                    <button onClick={()=>addToBooks(t,gl)} style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-success)", border:"none", color:"var(--sc-on-accent)", fontSize:12, fontWeight:600, cursor:"pointer" }}>Accept &amp; add</button>
                    <button onClick={()=>setAddQuick(t.id)} style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:12, cursor:"pointer" }}>Choose account</button>
                    <button onClick={()=>ignoreBank(t)} style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:12, cursor:"pointer" }}>Ignore this time</button>
                  </div>
                )}
              </div>
            );
          })}
          {unmatchedBooks.map(b=>(
            <div key={b.id} style={{ padding:"12px 0", borderTop:"1px solid var(--sc-surface-2)" }}>
              {/* C195(8) — the "knows nothing" bar: say WHAT happened, WHY the two numbers differ,
                  that it's normal, and what we'll do — not just jargon-free words. */}
              <div style={{ fontSize:13, color:"var(--sc-text)", marginBottom:4 }}><strong>{b.vendor}</strong> — {fmt(b.amount)} on {fmtDate(b.date)}</div>
              <div style={{ fontSize:12.5, color:"var(--sc-text-2)", marginBottom:8, maxWidth:620, lineHeight:1.5 }}>{outstandingCheckCopy({ amount: b.amount, date: b.date })}</div>
              <div style={{ display:"flex", gap:14, alignItems:"center", flexWrap:"wrap" }}>
                {/* Primary, plain-language, safe option. */}
                <button onClick={()=>markOutstanding(b)} style={{ padding:"6px 14px", borderRadius:8, background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text)", fontSize:12, fontWeight:600, cursor:"pointer" }}>Hasn't hit the bank yet</button>
                {/* Destructive, de-emphasized (muted text link, no fill) + confirm-guarded in voidBook. */}
                <button onClick={()=>voidBook(b)} style={{ padding:"6px 4px", background:"none", border:"none", color:"var(--sc-text-mut)", fontSize:12, textDecoration:"underline", cursor:"pointer" }}>This shouldn't be here — remove it</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BOTTOM BAR */}
      <div style={{ position:"fixed", left:0, right:0, bottom:0, background:"var(--sc-surface)", borderTop:"1px solid var(--sc-border)", boxShadow:"0 -4px 20px rgba(0,0,0,.06)", padding:"12px 28px", display:"flex", alignItems:"center", gap:24, zIndex:50, flexWrap:"wrap" }}>
        <div><div style={{ fontSize:10, color:"var(--sc-text-2)", letterSpacing:0.5, marginBottom:2 }}>BANK ENDING BALANCE{statementBalance!=="" && prefilledFromStatement ? " · from your statement" : ""}</div><input type="number" value={statementBalance} onChange={e=>{ setStatementBalance(e.target.value); setPrefilledFromStatement(false); setEmptyConfirmed(false); queueSave(); }} placeholder="enter from statement" style={{ width:140, fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", border:`1px solid ${!statementBalance?"var(--sc-warning)":"var(--sc-border-2)"}`, borderRadius:8, padding:"4px 8px", background:"var(--sc-surface-2)", color:"var(--sc-text)", outline:"none" }} /></div>
        {/* O83: a genuine $0 ending balance (empty/closed account) must be EXPLICITLY confirmed —
            otherwise an unverified $0 completion becomes a phantom the sign-off gate ignores. */}
        {statementBalance!=="" && stmtNum===0 && (
          <label style={{ display:"flex", alignItems:"center", gap:7, fontSize:12, color:"var(--sc-text-2)", maxWidth:220, cursor:"pointer" }}>
            <input type="checkbox" checked={emptyConfirmed} onChange={e=>{ setEmptyConfirmed(e.target.checked); queueSave(); }} style={{ width:16, height:16, cursor:"pointer", accentColor:"var(--sc-gold)" }} />
            This account is empty or closed — its balance really is $0.00.
          </label>
        )}
        <div><div style={{ fontSize:10, color:"var(--sc-text-2)", letterSpacing:0.5 }}>WHAT YOUR BOOKS SHOW</div><div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{fmt(booksBalance)}</div></div>
        <div><div style={{ fontSize:10, color:"var(--sc-text-2)", letterSpacing:0.5 }}>DIFFERENCE</div><div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color: Math.abs(diff)<0.005?"var(--sc-success)":"var(--sc-error)" }}>{fmt(diff)}</div></div>
        <div style={{ flex:1, minWidth:140, fontSize:11, color:"var(--sc-text-2)" }}>{Math.abs(diff)<0.005?"Balanced — ready to complete.":"Difference must be $0.00 to complete."}</div>
        {(() => { const ready = canCompleteReconciliation({ statementBalance, difference: diff, emptyConfirmed });
          return (
            <button disabled={!ready} onClick={()=>setStep("summary")}
              style={{ padding:"11px 22px", borderRadius:10, border:"none", fontSize:14, fontWeight:600, cursor: ready?"pointer":"not-allowed", background: ready?"var(--sc-gold)":"var(--sc-border)", color: ready?"var(--sc-surface)":"var(--sc-text-mut)" }}
              title={!statementBalance?"Enter your bank statement's ending balance to finish":(stmtNum===0&&!emptyConfirmed)?"Confirm the account is empty/closed to finish":(Math.abs(diff)>=0.005?"Difference must be $0.00 to complete":"")}>Complete Match</button>
          ); })()}
      </div>
    </div>
  );
}
