import React from "react";
import { useERP } from "../ERPContext";
import { reconBooksSet, cashLegSigned } from "../../lib/reconcile";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { AI_PROXY_URL } from "../../lib/constants";
import { okAIResponse } from "../../lib/ai";

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
    CHART_OF_ACCOUNTS, setView, getAccountByRole, cashGlCodes,
  } = useERP();

  const fmt = n => (n<0?"-":"")+"$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
  const today = new Date();
  const lastMonthStart = new Date(today.getFullYear(), today.getMonth()-1, 1).toISOString().slice(0,10);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0,10);

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
  const saveTimer = React.useRef(null);

  const inProgress = (reconciliations||[]).find(r => r.status==="in_progress");
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
  const booksRows = reconBooksSet(invoices, { cashCodes: reconCashCodes, from: periodStart, to: periodEnd });
  const bookSigned = i => cashLegSigned(i, reconCashCodes);
  const matchedBookIds = new Set(bankTxns.filter(t=>t._matchBook).map(t=>t._matchBook));
  const unmatchedBank = bankTxns.filter(t=>!t._matchBook && !t._ignored);
  const unmatchedBooks = booksRows.filter(b=>!matchedBookIds.has(b.id) && !outstanding[b.id]);
  const diff = Math.round((unmatchedBank.reduce((s,t)=>s+t.amount,0) - unmatchedBooks.reduce((s,b)=>s+bookSigned(b),0))*100)/100;
  const stmtNum = parseFloat(statementBalance)||0;
  const booksBalance = Math.round((stmtNum - diff)*100)/100;
  const matchedCount = bankTxns.filter(t=>t._matchBook).length;

  const serialize = (status) => ({
    company_id: currentCompany?.id,
    account_id: accountId && accountId!=="manual" ? accountId : null,
    account_name: accountName,
    period_start: periodStart, period_end: periodEnd,
    statement_balance: stmtNum, books_balance: booksBalance, difference: diff,
    status: status || "in_progress",
    matched_transactions: bankTxns.filter(t=>t._matchBook).map(t=>({ bank:t, bookId:t._matchBook, conf:t._conf })),
    unmatched_bank: bankTxns.filter(t=>!t._matchBook),
    unmatched_books: unmatchedBooks.map(b=>b.id),
    added_during_reconciliation: bankTxns.filter(t=>t._added).map(t=>t._added),
  });
  const reconIdRef = React.useRef(null);   // synchronous mirror of reconId
  const savingRef = React.useRef(false);   // true while an insert is in flight
  const saveNow = async (status) => {
    if (!currentCompany?.id) return;
    const existingId = reconId || reconIdRef.current;
    // Don't fire a second INSERT before the first one has returned an id.
    if (!existingId && savingRef.current) return;
    const payload = serialize(status);
    try {
      if (existingId) {
        await supabase.from("reconciliations").update(payload).eq("id", existingId).eq("company_id", currentCompany.id);
      } else {
        savingRef.current = true;
        const { data, error } = await supabase.from("reconciliations").insert(payload).select("id").single();
        if (error) console.warn("[reconciliations] save:", error.message);
        if (data?.id) { reconIdRef.current = data.id; setReconId(data.id); }
      }
    } catch(e){ console.warn("[reconciliations] save failed:", e.message); }
    finally { savingRef.current = false; }
  };
  const queueSave = () => { if (saveTimer.current) clearTimeout(saveTimer.current); saveTimer.current = setTimeout(()=>saveNow("in_progress"), 2000); };

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
  const voidBook = (b) => { setInvoices(prev=>prev.map(i=>i.id===b.id?{...i,status:"voided",voided_at:new Date().toISOString(),voided_reason:"Voided during reconciliation"}:i)); logAudit && logAudit("invoice_voided",`Voided ${b.vendor} ${fmt(b.amount)} during reconciliation`,b,null); queueSave(); };

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
    const at=new Date().toISOString(); const uid=session?.user?.id||null;  // reconciliations.completed_by is a uuid column
    const ids = bankTxns.filter(t=>t._matchBook).map(t=>t._matchBook);
    setInvoices(prev=>prev.map(i=>ids.includes(i.id)?{...i,cleared:true,cleared_at:at}:i));
    try {
      const payload = { ...serialize("complete"), completed_at:at, completed_by:uid };
      let rid=reconId;
      if (rid) await supabase.from("reconciliations").update(payload).eq("id",rid).eq("company_id",currentCompany.id);
      else { const { data } = await supabase.from("reconciliations").insert(payload).select("id").single(); rid=data?.id; setReconId(rid); }
      const dbIds = invoices.filter(i=>ids.includes(i.id) && i.db_entry_id).map(i=>i.db_entry_id);
      if (dbIds.length) {
        const { error } = await supabase.from("journal_entries").update({ cleared:true, cleared_at:at, reconciliation_id:rid||null }).in("id", dbIds).eq("company_id", currentCompany.id);
        if (error) console.warn("[reconciliations] cleared update failed (apply migration 006?):", error.message);
      }
    } catch(e){ console.warn("[reconciliations] complete failed:", e.message); }
    // Auto-update the reconciled bank account's current balance to the statement
    // ending balance (migration 026). loadAllData() below re-derives dashboard cash.
    if (accountId && accountId !== "manual") {
      try { await supabase.from("bank_accounts").update({ current_balance: stmtNum }).eq("id", accountId).eq("company_id", currentCompany.id); }
      catch(e){ console.warn("[bank_accounts] balance update failed (apply migration 026?):", e?.message||e); }
    }
    logAudit && logAudit("reconciliation_completed", `Bank reconciliation completed for ${accountName} ${periodStart}→${periodEnd} — balance ${fmt(stmtNum)}`, null, { account:accountName, period:`${periodStart}→${periodEnd}`, balance:stmtNum });
    showNotification && showNotification("Your books match your bank ✓");
    loadAllData && loadAllData();
    setStep("done");
  };

  const fileToB64 = (file) => new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result).split(",")[1]||""); r.onerror=rej; r.readAsDataURL(file); });

  // The only way to start: upload a bank statement (PDF via AI vision, or CSV parsed locally).
  const processFile = async (file) => {
    if (!file) return;
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
        const text = data.content?.find(b=>b.type==="text")?.text || "[]";
        const arr = JSON.parse(text.replace(/```json|```/g,"").trim());
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
    setBankTxns([...matched, ...unm]); setStep("match");
  };
  const startFresh = () => { setReconId(null); setBankTxns([]); setOutstanding({}); setStatementBalance(""); setStep("setup"); };

  const card = { background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, boxShadow:"0 1px 3px rgba(0,0,0,.08)" };
  const inp = { width:"100%", boxSizing:"border-box", background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:9, padding:"10px 12px", fontSize:14, color:"var(--sc-text)", outline:"none" };
  const lbl = { fontSize:11, color:"var(--sc-text-2)", letterSpacing:0.5, marginBottom:6, fontWeight:500 };

  // ════════ LANDING ════════
  if (step==="landing") {
    const viewing = viewRecId ? completed.find(r=>r.id===viewRecId) : null;
    if (viewing) return (
      <div>
        <button onClick={()=>setViewRecId(null)} style={{ marginBottom:16, padding:"7px 14px", borderRadius:9, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>← Back</button>
        <div style={{ ...card, padding:24, maxWidth:560 }}>
          <div style={{ fontSize:11, color:"var(--sc-success)", letterSpacing:1, marginBottom:8, fontWeight:600 }}>✓ COMPLETE</div>
          <h2 style={{ margin:"0 0 14px", fontSize:20 }}>{viewing.account_name} · {viewing.period_start} → {viewing.period_end}</h2>
          {[["Your bank's ending balance",fmt(viewing.statement_balance)],["What your books showed",fmt(viewing.books_balance)],["Difference",fmt(viewing.difference||0)],["Transactions matched",(viewing.matched_transactions||[]).length],["Completed",viewing.completed_at?new Date(viewing.completed_at).toLocaleString():"—"],["By",nameForUser(viewing.completed_by)]].map(([k,v])=>(
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
            <button onClick={completeMatch} style={{ flex:1, padding:"13px", borderRadius:11, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:14, fontWeight:600, cursor:"pointer" }}>Lock and Complete</button>
            <button onClick={()=>setStep("match")} style={{ padding:"13px 18px", borderRadius:11, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:14, cursor:"pointer" }}>Go back and review</button>
          </div>
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
        <button onClick={()=>{ saveNow("in_progress"); showNotification && showNotification("Progress saved ✓"); }} style={{ padding:"8px 16px", borderRadius:9, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Save Progress</button>
      </div>

      {autoBanner && (
        <div style={{ ...card, padding:"12px 16px", marginBottom:14, background:"var(--sc-gold-soft)", borderColor:"var(--sc-gold-soft)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
          <div style={{ fontSize:13, color:"var(--sc-gold)" }}>✦ {autoBanner}</div>
          <button onClick={()=>setAutoBanner(null)} style={{ background:"none", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:16 }}>×</button>
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
            <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{booksRows.length-unmatchedBooks.length}/{booksRows.length} matched</div>
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
              <div style={{ fontSize:13, color:"var(--sc-warning)", marginBottom:6 }}>This is in your books but hasn't cleared the bank — <strong>{b.vendor}</strong> ({fmt(b.amount)}, {fmtDate(b.date)})</div>
              <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                <button onClick={()=>markOutstanding(b)} style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:12, cursor:"pointer" }}>Mark as outstanding</button>
                <button onClick={()=>voidBook(b)} style={{ padding:"6px 12px", borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-error-soft)", color:"var(--sc-error)", fontSize:12, cursor:"pointer" }}>Entered in error (void)</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* BOTTOM BAR */}
      <div style={{ position:"fixed", left:0, right:0, bottom:0, background:"var(--sc-surface)", borderTop:"1px solid var(--sc-border)", boxShadow:"0 -4px 20px rgba(0,0,0,.06)", padding:"12px 28px", display:"flex", alignItems:"center", gap:24, zIndex:50, flexWrap:"wrap" }}>
        <div><div style={{ fontSize:10, color:"var(--sc-text-2)", letterSpacing:0.5, marginBottom:2 }}>BANK ENDING BALANCE</div><input type="number" value={statementBalance} onChange={e=>{ setStatementBalance(e.target.value); queueSave(); }} placeholder="enter from statement" style={{ width:140, fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"4px 8px", color:"var(--sc-text)", outline:"none" }} /></div>
        <div><div style={{ fontSize:10, color:"var(--sc-text-2)", letterSpacing:0.5 }}>WHAT YOUR BOOKS SHOW</div><div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{fmt(booksBalance)}</div></div>
        <div><div style={{ fontSize:10, color:"var(--sc-text-2)", letterSpacing:0.5 }}>DIFFERENCE</div><div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color: Math.abs(diff)<0.005?"var(--sc-success)":"var(--sc-error)" }}>{fmt(diff)}</div></div>
        <div style={{ flex:1, minWidth:140, fontSize:11, color:"var(--sc-text-2)" }}>{Math.abs(diff)<0.005?"Balanced — ready to complete.":"Difference must be $0.00 to complete."}</div>
        <button disabled={Math.abs(diff)>=0.005 || !statementBalance} onClick={()=>setStep("summary")}
          style={{ padding:"11px 22px", borderRadius:10, border:"none", fontSize:14, fontWeight:600, cursor: Math.abs(diff)<0.005?"pointer":"not-allowed", background: Math.abs(diff)<0.005?"var(--sc-gold)":"var(--sc-border)", color: Math.abs(diff)<0.005?"var(--sc-surface)":"var(--sc-text-mut)" }}>Complete Match</button>
      </div>
    </div>
  );
}
