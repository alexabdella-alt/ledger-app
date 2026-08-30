import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney, todayLocal } from "../../lib/format";
import { reversalIndex, reversalFor } from "../../lib/ledger";
import { planBulkRemoval } from "../../lib/signedPeriod";
import { monthLabel as signedMonthLabel } from "../../lib/ownerTrust";
import { classifyTxn, txnStatus } from "../../lib/txnPresent";
import { pill } from "../../lib/ui";
import TransactionDetailPanel from "../TransactionDetailPanel";

export default function BooksView() {
  const {
    invoices, setInvoices, markPaid, markBillPaid, loadAllData, getAccountByRole, persistRecode, logAudit,
    setSelectedInvoice, setView, CHART_OF_ACCOUNTS,
    booksFilter, setBooksFilter, softDeleteInvoices, signoffs, setDeleteConfirm,
    contracts, setSelectedContract, setContractView, postAllContractEntries, CONTRACT_TYPES, showNotification,
    reconciliations, docLibrary, storeDocument, fileToBase64,
  } = useERP();
  const apCode = getAccountByRole?.("accounts_payable")?.code;
  const arCode = getAccountByRole?.("accounts_receivable")?.code;
  const [showReconHistory, setShowReconHistory] = React.useState(false);

  const [search, setSearch] = React.useState("");
  const [selId, setSelId] = React.useState(null);
  const [picked, setPicked] = React.useState(() => new Set());   // bulk-removal selection
  const [selContract, setSelContract] = React.useState(null);
  const [payRowId, setPayRowId] = React.useState(null);
  const [payMethod, setPayMethod] = React.useState("ach");
  const [payDate, setPayDate] = React.useState(todayLocal());
  const [sort, setSort] = React.useState({ col: null, dir: null }); // col=null → default (Date desc)

  const fmt = fmtMoney;
  const filter = booksFilter || "all";
  const methodOpts = [["ach","ACH / Bank Transfer"],["check","Check"],["wire","Wire Transfer"],["card","Credit Card"],["zelle","Zelle"],["venmo","Venmo"],["paypal","PayPal"],["other","Other"]];
  const methodLabel = m => (methodOpts.find(([v])=>v===m)?.[1]) || (m?String(m).toUpperCase():"—");
  const needsReview = i => i.approval_status==="pending_approval" || i.approval_status==="flagged" || i.approval_status==="info_requested" || (i.confidence!=null && i.confidence<70);
  // GL-truth classification (CLAUDE.md §9): the account the entry hits IS the truth. Revenue =
  // credits a revenue (4xxx) account; expense = debits an expense (5–8xxx) account — read from
  // the flattened primary `gl_code`, NOT the denormalized `type` flag. The flag LIES on
  // settlement entries: an A/R collection (Dr Cash / Cr A/R) flattens to gl_code=Cash +
  // type="expense", so the old `|| i.type===…` override dropped a money-IN collection into
  // Expenses/Unpaid. Fall back to `type` ONLY for legacy rows that have no gl_code at all.
  const isExpense = i => i.gl_code ? glIsExpense(i.gl_code) : i.type==="expense";
  const isRevenue = i => i.gl_code ? glIsRevenue(i.gl_code) : i.type==="revenue";

  // Filter + search
  const base = invoices.filter(i => glPLType(i.gl_code) || i.type==="expense" || i.type==="revenue");
  const byFilter = base.filter(i => {
    if (filter==="revenue") return isRevenue(i);
    if (filter==="expenses") return isExpense(i);
    // Unpaid = genuinely OPEN BILLS you owe. Use the same GL-truth classifier as the row's
    // sign/status/Mark-Paid button (classifyTxn.settleAction==="pay" ⇒ booked to A/P, not a
    // settlement, not voided, not yet paid) so the tab and the row never disagree — no money-IN
    // collection can leak in, and direct-to-cash expenses (never payables) are excluded.
    if (filter==="unpaid") return classifyTxn(i, { apCode, arCode }).settleAction === "pay";
    if (filter==="review") return needsReview(i) && i.status!=="voided";
    return true;
  });
  const q = search.trim().toLowerCase();
  const filtered = byFilter.filter(i => !q ||
    (i.vendor||"").toLowerCase().includes(q) ||
    (i.description||"").toLowerCase().includes(q) ||
    (i.gl_name||"").toLowerCase().includes(q) ||
    (i.date||"").includes(q) ||
    fmtDate(i.date).toLowerCase().includes(q) ||
    String(i.amount||"").includes(q)
  );

  // ── Sortable columns ──────────────────────────────────────────────
  const statusKey = i => i.status==="voided" ? "1voided" : needsReview(i) ? "2review" : i.payment_status==="paid" ? "3paid" : i.payment_status==="collected" ? "4collected" : "5booked";
  const sortVal = {
    "Date": i => i.date || "",
    "Vendor": i => (i.vendor||"").toLowerCase(),
    "Description": i => (i.description||"").toLowerCase(),
    "GL Account": i => String(i.gl_code||""),
    "Amount": i => Math.abs(Number(i.amount)||0),
    "Status": i => statusKey(i),
  };
  const cycleSort = (col) => setSort(s =>
    s.col!==col ? { col, dir:"asc" } : s.dir==="asc" ? { col, dir:"desc" } : { col:null, dir:null }
  );
  const rows = (() => {
    const arr = [...filtered];
    if (!sort.col || !sortVal[sort.col]) {
      return arr.sort((a,b)=>(b.date||"").localeCompare(a.date||"")); // default: newest first
    }
    const acc = sortVal[sort.col];
    arr.sort((a,b)=>{
      const av=acc(a), bv=acc(b);
      const c = (typeof av==="number" && typeof bv==="number") ? av-bv : String(av).localeCompare(String(bv));
      return sort.dir==="asc" ? c : -c;
    });
    return arr;
  })();

  // O8 — which live originals have been reversed (a separate reversal entry points at
  // them via import_metadata.reverses). Display-only: the original stays live; we just
  // mark it "Reversed · DATE" and strike it through.
  const revIdx = React.useMemo(() => reversalIndex(invoices), [invoices]);

  // Plain-language status a non-accountant can scan: Open / Received / Paid (+ Voided /
  // Reversed / Needs Review). No raw "· BANK_TRANSFER" technical suffix in the list.
  const statusBadge = (i) => {
    const rev = reversalFor(revIdx, i);
    if (rev) return <span style={pill("var(--sc-error)")} title={`Reversed${rev.date?` on ${fmtDate(rev.date)}`:""}`}>↩ Reversed{rev.date?` · ${fmtDate(rev.date)}`:""}</span>;
    if (i.status==="voided") return <span style={pill("var(--sc-text-mut)")}>Voided</span>;
    if (needsReview(i)) return <span style={pill("var(--sc-warning)")}>Needs Review</span>;
    const cls = classifyTxn(i, { apCode, arCode });
    const st = txnStatus(i, cls);
    const tone = st.tone==="success" ? "var(--sc-success)" : st.tone==="warning" ? "var(--sc-warning)" : "var(--sc-info)";
    return <span style={pill(tone)} title={i.payment_method_used ? `${st.label} · ${methodLabel(i.payment_method_used)}` : st.label}>{st.label}</span>;
  };
  function pill(c){ return { display:"inline-flex", alignItems:"center", fontSize:11, fontWeight:600, color:c, background:c+"14", border:`1px solid ${c}29`, borderRadius:6, padding:"3px 9px", whiteSpace:"nowrap", lineHeight:1.2 }; }

  const fpill = (id,label) => (
    <button key={id} onClick={()=>setBooksFilter(id)} style={pill(filter===id)}>{label}</button>
  );

  return (
    <div>
      <div style={{ marginBottom:18, display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:16, flexWrap:"wrap" }}>
        <div>
          <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>BOOKS</div>
          <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>All transactions</h1>
          <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Every entry in one place. Click a row for full detail, AI reasoning, and actions.</div>
        </div>
        {/* C195(4) — MANUAL ENTRY IS REACHABLE. AddView was orphaned: hand-entering a transaction
            (e.g. a check written outside any statement) required direct SQL. This is its entry point. */}
        <button onClick={()=>setView && setView("add")}
          style={{ flexShrink:0, padding:"10px 18px", borderRadius:9, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:13, fontWeight:600, cursor:"pointer" }}>
          + Add entry
        </button>
      </div>

      {/* Search + filters */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendor, amount, date, description…"
          style={{ flex:"1 1 280px", minWidth:0, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:10, padding:"10px 14px", fontSize:14, color:"var(--sc-text)", outline:"none" }} />
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {fpill("all","All")}{fpill("revenue","Revenue")}{fpill("expenses","Expenses")}{fpill("contracts","Contracts")}{fpill("unpaid","Unpaid")}{fpill("review","Needs Review")}
        </div>
      </div>

      {/* ── CONTRACTS TABLE (filter = contracts) ── */}
      {filter==="contracts" && (
        <div className="sc-card" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
          {/* ── BULK REMOVAL. `softDeleteInvoices` (batch write, ONE undo toast) has existed
             since it was written and been wired to NO component — remediating the O83
             double-book took scripted database access to remove 14 entries, because the
             app could only do one at a time. That is a product you have to leave in order
             to fix it. */}
        {picked.size > 0 && (
          <div style={{ display:"flex", alignItems:"center", gap:12, flexWrap:"wrap", padding:"10px 14px", marginBottom:12, borderRadius:10, background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)" }}>
            <span style={{ fontSize:13, fontWeight:600 }}>{picked.size} selected</span>
            <button onClick={()=>setPicked(new Set())} style={{ fontSize:12, background:"none", border:"1px solid var(--sc-border-2)", borderRadius:7, padding:"4px 10px", color:"var(--sc-text-2)", cursor:"pointer" }}>Clear</button>
            <button onClick={()=>{
              const chosen = rows.filter(r => picked.has(r.id));
              const plan = planBulkRemoval(chosen, signoffs || [], { monthLabel: signedMonthLabel });
              if (!plan.removable.length) { showNotification?.(plan.blocked || "Nothing here can be removed.", "error"); return; }
              setDeleteConfirm({
                // The confirmation names what will be LEFT BEHIND, before anything happens.
                label: plan.blocked ? `${plan.confirm}\n\n${plan.blocked}` : plan.confirm,
                onConfirm: async () => { await softDeleteInvoices(plan.removable); setPicked(new Set()); },
              });
            }} style={{ marginLeft:"auto", fontSize:12, fontWeight:600, background:"transparent", border:"1px solid var(--sc-error-soft)", borderRadius:7, padding:"5px 12px", color:"var(--sc-error)", cursor:"pointer" }}>Delete selected</button>
          </div>
        )}
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr style={{ background:"var(--sc-surface-2)" }}>
              {["Counterparty","Type","Monthly","Term","Status",""].map((h,i)=>(
                <th key={i} style={{ padding:"11px 16px", textAlign:h==="Monthly"?"right":"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1, fontWeight:600, borderBottom:"1px solid var(--sc-border)", whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
              ))}
            </tr></thead>
            <tbody>
              {(contracts||[]).length===0 ? (
                <tr><td colSpan={6} style={{ padding:"44px", textAlign:"center", color:"var(--sc-text-2)", fontSize:13 }}>No contracts yet. Drop a lease or contract on Home — AI extracts the ASC 842 schedule automatically.</td></tr>
              ) : (contracts||[]).filter(c => !q || (c.counterparty||"").toLowerCase().includes(q) || (c.contract_type||"").toLowerCase().includes(q) || (c.description||"").toLowerCase().includes(q)).map((c,idx)=>{
                const posted = (c.posted_entries?.length||0) >= (c.journal_entries?.length||0) && (c.journal_entries?.length||0)>0;
                const ct = (CONTRACT_TYPES && CONTRACT_TYPES[c.contract_type]) || { label:c.contract_type||"Contract", color:"var(--sc-gold)", icon:"📄" };
                return (
                  <tr key={c.id||idx} onClick={()=>setSelContract(c)} style={{ cursor:"pointer", background:idx%2?"var(--sc-bg)":"var(--sc-surface)", borderBottom:"1px solid var(--sc-surface-2)" }}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background=idx%2?"var(--sc-bg)":"var(--sc-surface)"}>
                    <td style={{ padding:"12px 16px", fontSize:13, fontWeight:500, color:"var(--sc-text)" }}>{c.counterparty||"—"}</td>
                    <td style={{ padding:"12px 16px" }}><span style={{ fontSize:11, fontWeight:600, color:ct.color, background:ct.color+"14", border:`1px solid ${ct.color}33`, borderRadius:20, padding:"2px 9px" }}>{ct.icon} {ct.label}</span></td>
                    <td style={{ padding:"12px 16px", textAlign:"right", fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)" }}>{c.payment_amount?fmt(c.payment_amount):"—"}</td>
                    <td style={{ padding:"12px 16px", fontSize:12, color:"var(--sc-text-2)" }}>{c.lease_term_months?`${c.lease_term_months} mo`:"—"}</td>
                    <td style={{ padding:"12px 16px" }}><span style={pill(posted?"var(--sc-success)":"var(--sc-warning)")}>{posted?"Posted":"Draft"}</span></td>
                    <td style={{ padding:"12px 16px", textAlign:"right", color:"var(--sc-text-mut)" }}>›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filter!=="contracts" && (<>
      {/* Table — contained: horizontal scroll instead of clipping the right edge (Status +
          action button were running off the page). overflowX:auto keeps it within the card. */}
      <div className="sc-card" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, overflowX:"auto", overflowY:"clip" }}>
        <table style={{ width:"100%", borderCollapse:"collapse", minWidth:760 }}>
          <thead><tr style={{ background:"var(--sc-bg)" }}>
            {/* Selection column — no label; the header checkbox picks every VISIBLE row,
                which is the filtered/searched set the person is actually looking at. */}
            <th style={{ padding:"10px 0 10px 14px", width:28, borderBottom:"1px solid var(--sc-border)" }}>
              <input type="checkbox" aria-label="Select all shown"
                checked={rows.length > 0 && rows.every(r => picked.has(r.id))}
                onChange={e=>setPicked(e.target.checked ? new Set(rows.map(r=>r.id)) : new Set())}
                style={{ cursor:"pointer" }} />
            </th>
            {["Date","Vendor","Description","GL Account","Amount","Status",""].map((h,i)=>{
              const sortable = h!=="";
              const active = sort.col===h;
              const arrow = active ? (sort.dir==="asc"?"↑":"↓") : "↕";
              return (
                <th key={i} onClick={sortable?()=>cycleSort(h):undefined}
                  className={sortable?"sc-th-sort":undefined}
                  style={{ padding:"10px 16px", textAlign:h==="Amount"?"right":"left", fontSize:12, color: active?"var(--sc-gold)":"var(--sc-text-mut)", letterSpacing:0.6, fontWeight:600, borderBottom:"1px solid var(--sc-border)", whiteSpace:"nowrap", cursor:sortable?"pointer":"default", userSelect:"none" }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:5 }}>
                    {h.toUpperCase()}
                    {sortable && <span className="sc-th-arrow" style={{ fontSize:11, color: active?"var(--sc-gold)":"var(--sc-border)", opacity: active?1:0, transition:"opacity 0.12s" }}>{arrow}</span>}
                  </span>
                </th>
              );
            })}
          </tr></thead>
          <tbody>
            {rows.length===0 ? (
              <tr><td colSpan={8} style={{ padding:0 }}>
                <div style={{ padding:"56px 32px", textAlign:"center" }}>
                  <div style={{ width:52, height:52, borderRadius:14, background:"var(--sc-surface-2)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 16px", fontSize:24 }}>{search||filter!=="all"?"🔍":"📭"}</div>
                  <div style={{ fontSize:15, fontWeight:600, color:"var(--sc-text)", marginBottom:6 }}>{search||filter!=="all"?"No matching transactions":"No transactions yet"}</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-mut)", marginBottom:20, maxWidth:340, marginLeft:"auto", marginRight:"auto", lineHeight:1.6 }}>{search||filter!=="all"?"Try clearing your search or switching filters to see more.":"Upload an invoice, receipt, or bank statement and it'll appear here, fully coded."}</div>
                  {!(search||filter!=="all") && (
                    <button onClick={()=>setView("home")}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--sc-gold-deep)"} onMouseLeave={e=>e.currentTarget.style.background="var(--sc-gold)"}
                      style={{ height:36, padding:"0 18px", borderRadius:8, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:14, fontWeight:500, cursor:"pointer", transition:"background 0.12s" }}>Upload a document →</button>
                  )}
                </div>
              </td></tr>
            ) : rows.map((inv,idx)=>{
              // What this row actually IS — drives sign/color, account shown, and the action.
              const cls = classifyTxn(inv, { apCode, arCode });
              const reversedInfo = reversalFor(revIdx, inv);   // O8 — original was reversed
              return (
                <React.Fragment key={inv.id}>
                  <tr onClick={()=>setSelId(inv.id)} style={{ cursor:"pointer", height:52, background: selId===inv.id?"var(--sc-gold-soft)":"var(--sc-surface)", borderBottom:"1px solid var(--sc-border)", opacity: (inv.status==="voided"||reversedInfo)?0.55:1, textDecoration: reversedInfo?"line-through":"none", textDecorationColor: reversedInfo?"var(--sc-error)":undefined, transition:"background 0.1s" }}
                    onMouseEnter={e=>{ if(selId!==inv.id) e.currentTarget.style.background="var(--sc-surface-2)"; }} onMouseLeave={e=>{ if(selId!==inv.id) e.currentTarget.style.background="var(--sc-surface)"; }}>
                    <td onClick={e=>e.stopPropagation()} style={{ padding:"0 0 0 14px", width:28 }}>
                      <input type="checkbox" aria-label={`Select ${inv.vendor || "transaction"}`} checked={picked.has(inv.id)}
                        onChange={()=>setPicked(prev => { const n = new Set(prev); n.has(inv.id) ? n.delete(inv.id) : n.add(inv.id); return n; })}
                        style={{ cursor:"pointer" }} />
                    </td>
                    <td style={{ padding:"0 16px", fontSize:13, color:"var(--sc-text-mut)", whiteSpace:"nowrap" }}>{inv.date?fmtDate(inv.date):"—"}</td>
                    <td style={{ padding:"0 16px" }}><div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ width:28,height:28,borderRadius:8,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"var(--sc-on-accent)",flexShrink:0 }}>{initials(inv.vendor)}</span><span style={{ fontSize:13, fontWeight:500, color:"var(--sc-text)" }}>{inv.vendor||"—"}</span></div></td>
                    <td style={{ padding:"0 16px", fontSize:13, color:"var(--sc-text-2)", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description||"—"}</td>
                    <td style={{ padding:"0 16px", fontSize:13, color:"var(--sc-text-2)", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}><span style={{ fontFamily:"'DM Mono',monospace", color:"var(--sc-text-mut)", marginRight:6 }}>{cls.account.code}</span>{cls.account.name}</td>
                    <td style={{ padding:"0 16px", textAlign:"right", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color: cls.inflow?"var(--sc-success)":"var(--sc-error)", whiteSpace:"nowrap" }}>{cls.inflow?"+":"−"}{fmt(inv.amount)}</td>
                    <td style={{ padding:"0 16px" }}>{statusBadge(inv)}</td>
                    <td style={{ padding:"0 16px", textAlign:"right", whiteSpace:"nowrap" }}>
                      {/* Settle action ONLY on a genuinely open item — never on a settlement/clearing entry. */}
                      {cls.settleAction==="pay" && (
                        <button onClick={e=>{ e.stopPropagation(); setPayRowId(payRowId===inv.id?null:inv.id); setPayMethod("ach"); setPayDate(todayLocal()); }}
                          style={{ padding:"5px 11px", borderRadius:7, fontSize:11, fontWeight:600, background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", color:"var(--sc-success)", cursor:"pointer" }}>Mark Paid</button>
                      )}
                      {cls.settleAction==="collect" && (
                        <button onClick={async e=>{ e.stopPropagation(); const ok = await markBillPaid?.(inv.id, { side:"ar" }); if (ok) { try { await loadAllData?.(); } catch {} showNotification?.("Marked as received ✓"); } }}
                          style={{ padding:"5px 11px", borderRadius:7, fontSize:11, fontWeight:600, background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", color:"var(--sc-success)", cursor:"pointer" }}>Mark Received</button>
                      )}
                    </td>
                  </tr>
                  {payRowId===inv.id && (
                    <tr style={{ background:"var(--sc-bg)" }}>
                      <td colSpan={7} style={{ padding:"12px 16px", borderBottom:"1px solid var(--sc-surface-2)" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                          <span style={{ fontSize:12, color:"var(--sc-text-2)" }}>Pay {inv.vendor} · {fmt(inv.amount)}:</span>
                          <input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:7, padding:"6px 9px", fontSize:12, color:"var(--sc-text)", outline:"none" }} />
                          <select value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:7, padding:"6px 9px", fontSize:12, color:"var(--sc-text)", outline:"none" }}>
                            {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>
                          <button onClick={()=>{ markPaid(inv.id, payMethod, { date: payDate }); setPayRowId(null); }} style={{ padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"var(--sc-success)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>Confirm</button>
                          <button onClick={()=>setPayRowId(null)} style={{ padding:"6px 12px", borderRadius:7, fontSize:12, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>Cancel</button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:10 }}>{rows.length} transaction{rows.length!==1?"s":""}{filter!=="all"?` · ${filter}`:""}</div>
      </>)}

      {/* ── RECONCILIATION HISTORY ── */}
      {(reconciliations||[]).length>0 && (
        <div className="sc-card" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, marginTop:16, overflow:"hidden" }}>
          <div onClick={()=>setShowReconHistory(s=>!s)} style={{ padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
            <div style={{ fontSize:13, fontWeight:600 }}>🏦 Bank reconciliation history</div>
            <span style={{ fontSize:12, color:"var(--sc-gold)", fontWeight:600 }}>{showReconHistory?"Hide ▲":"Show ▼"}</span>
          </div>
          {showReconHistory && (
            <div style={{ borderTop:"1px solid var(--sc-surface-2)" }}>
              {[...(reconciliations||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(r=>{
                const od = r.status==="complete" && r.completed_at && (Date.now()-new Date(r.completed_at).getTime())/86400000>35;
                const color = r.status==="in_progress"?"var(--sc-warning)":od?"var(--sc-error)":"var(--sc-success)";
                const label = r.status==="in_progress"?"In Progress":od?"Overdue":"Complete";
                return (
                  <div key={r.id} onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 18px", borderTop:"1px solid var(--sc-surface-2)" }}>
                    <div><div style={{ fontSize:13, fontWeight:500 }}>{r.account_name} · {fmtDate(r.period_start)} → {fmtDate(r.period_end)}</div><div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{fmt(r.statement_balance)}{r.completed_at?` · ${fmtDate(r.completed_at)}`:""}</div></div>
                    <span style={{ fontSize:11, fontWeight:600, color, background:color+"14", border:`1px solid ${color}33`, borderRadius:20, padding:"3px 10px" }}>{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── CONTRACT SLIDE-IN ── */}
      {selContract && (() => {
        const c = selContract;
        const ct = (CONTRACT_TYPES && CONTRACT_TYPES[c.contract_type]) || { label:c.contract_type||"Contract", color:"var(--sc-gold)", icon:"📄" };
        const entries = c.journal_entries || [];
        const postedCount = c.posted_entries?.length || 0;
        return createPortal((
          <div onClick={()=>setSelContract(null)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(17,24,39,0.35)", display:"flex", justifyContent:"flex-end" }}>
            <style>{`@keyframes booksIn2{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div onClick={e=>e.stopPropagation()} style={{ width:520, maxWidth:"94vw", height:"100%", background:"var(--sc-surface)", borderLeft:"1px solid var(--sc-border)", boxShadow:"-12px 0 40px rgba(17,24,39,0.12)", display:"flex", flexDirection:"column", animation:"booksIn2 .25s cubic-bezier(.22,1,.36,1)" }}>
              <div style={{ padding:"20px 24px", borderBottom:"1px solid var(--sc-surface-2)", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                <div style={{ minWidth:0 }}>
                  <span style={{ fontSize:11, fontWeight:600, color:ct.color, background:ct.color+"14", border:`1px solid ${ct.color}33`, borderRadius:20, padding:"2px 9px" }}>{ct.icon} {ct.label}</span>
                  <div style={{ fontSize:18, fontWeight:600, marginTop:8, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.counterparty||"Contract"}</div>
                </div>
                <button onClick={()=>setSelContract(null)} style={{ background:"none", border:"none", color:"var(--sc-text-2)", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
                {c.description && <div style={{ fontSize:13, color:"var(--sc-text-2)", lineHeight:1.6, marginBottom:16 }}>{c.description}</div>}
                {[
                  ["Monthly payment", c.payment_amount?fmt(c.payment_amount):"—"],
                  ["Frequency", c.payment_frequency||"monthly"],
                  ["Term", c.lease_term_months?`${c.lease_term_months} months`:"—"],
                  ["Start / End", `${c.start_date||"—"} → ${c.end_date||"—"}`],
                  ["Total value", c.total_value?fmt(c.total_value):"—"],
                  ["ROU asset (ASC 842)", c.rou_asset_value?fmt(c.rou_asset_value):"—"],
                  ["Lease liability — current", c.lease_liability_current?fmt(c.lease_liability_current):"—"],
                  ["Lease liability — non-current", c.lease_liability_noncurrent?fmt(c.lease_liability_noncurrent):"—"],
                  ["Discount rate", c.discount_rate_used?`${(c.discount_rate_used*100).toFixed(2)}%`:"—"],
                  ["Treatment", c.accounting_treatment||"—"],
                ].map(([k,v])=>(
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:14, padding:"10px 0", borderBottom:"1px solid var(--sc-surface-2)", fontSize:13 }}>
                    <span style={{ color:"var(--sc-text-2)", flexShrink:0 }}>{k}</span>
                    <span style={{ color:"var(--sc-text)", textAlign:"right", wordBreak:"break-word", fontFamily:/payment|value|asset|liability/i.test(k)?"'DM Mono',monospace":"inherit" }}>{v}</span>
                  </div>
                ))}
                {/* Journal entry schedule */}
                <div style={{ marginTop:18 }}>
                  <div style={{ fontSize:11, letterSpacing:1, color:"var(--sc-text-2)", marginBottom:8, fontWeight:600 }}>JOURNAL ENTRY SCHEDULE ({postedCount}/{entries.length} posted)</div>
                  {entries.length===0 ? <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>No entries generated.</div> :
                    entries.map((e,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid var(--sc-surface-2)", fontSize:12 }}>
                        <span style={{ color:"var(--sc-text-2)" }}>{e.description||e.memo||`Entry ${i+1}`}{e.date?` · ${fmtDate(e.date)}`:""}</span>
                        <span style={{ fontFamily:"'DM Mono',monospace", color:"var(--sc-text)" }}>{e.amount!=null?fmt(e.amount):""}{(c.posted_entries||[]).includes(i)?" ✓":""}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div style={{ padding:"16px 24px", borderTop:"1px solid var(--sc-surface-2)", display:"flex", gap:10 }}>
                <button onClick={()=>{ postAllContractEntries && postAllContractEntries(c); showNotification && showNotification("Posting contract entries…"); setSelContract(null); }} style={{ flex:1, padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>Post entries</button>
                <button onClick={()=>{ setSelectedContract(c); setContractView && setContractView("detail"); setView("contracts"); setSelContract(null); }} style={{ padding:"11px 16px", borderRadius:10, fontSize:13, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>Full ASC 842 view →</button>
              </div>
            </div>
          </div>
        ), document.body);
      })()}

      {/* Transaction detail slide-in (shared component) */}
      <TransactionDetailPanel invoiceId={selId} onClose={()=>setSelId(null)} onNavigate={setSelId} returnContext={{ view:"books", label:"Transactions" }} />
    </div>
  );
}
