import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import DocumentPreviewModal, { docIcon, isImageDoc } from "../DocumentPreviewModal";

export default function BooksView() {
  const {
    invoices, setInvoices, markPaid, persistRecode, logAudit,
    setSelectedInvoice, setView, CHART_OF_ACCOUNTS,
    booksFilter, setBooksFilter,
    contracts, setSelectedContract, setContractView, postAllContractEntries, CONTRACT_TYPES, showNotification,
    reconciliations, docLibrary, storeDocument, fileToBase64,
  } = useERP();
  const [showReconHistory, setShowReconHistory] = React.useState(false);
  const [srcDocPreview, setSrcDocPreview] = React.useState(null); // source-document modal
  const [srcUploading, setSrcUploading] = React.useState(false);
  const srcFileRef = React.useRef(null);

  const [search, setSearch] = React.useState("");
  const [selId, setSelId] = React.useState(null);
  const [selContract, setSelContract] = React.useState(null);
  const [payRowId, setPayRowId] = React.useState(null);
  const [payMethod, setPayMethod] = React.useState("ach");
  const [payDate, setPayDate] = React.useState(new Date().toISOString().slice(0,10));
  const [recodeOpen, setRecodeOpen] = React.useState(false);

  // Find the source document linked to an invoice (by linked_invoice_id matching
  // its in-session id or its durable db_entry_id).
  const findSourceDoc = (inv) => (docLibrary || []).find(d =>
    d.linked_invoice_id && (String(d.linked_invoice_id) === String(inv?.id) || String(d.linked_invoice_id) === String(inv?.db_entry_id))
  );
  const handleSourceUpload = async (file, inv) => {
    if (!file || !inv) return;
    setSrcUploading(true);
    try {
      const base64 = await fileToBase64(file);
      // Link to the durable DB entry id when available, else the in-session id.
      await storeDocument(file.name, base64, file.type, inv.type || "invoice", inv.db_entry_id || inv.id, ["source"], null, file);
      showNotification("Source document attached ✓");
    } catch (e) { console.error(e); showNotification("Couldn't attach document.", "error"); }
    setSrcUploading(false);
  };

  const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
  const filter = booksFilter || "all";
  const methodOpts = [["ach","ACH / Bank Transfer"],["check","Check"],["wire","Wire Transfer"],["card","Credit Card"],["zelle","Zelle"],["venmo","Venmo"],["paypal","PayPal"],["other","Other"]];
  const methodLabel = m => (methodOpts.find(([v])=>v===m)?.[1]) || (m?String(m).toUpperCase():"—");
  const needsReview = i => i.approval_status==="pending_approval" || i.approval_status==="flagged" || i.approval_status==="info_requested" || (i.confidence!=null && i.confidence<70);
  const isExpense = i => glIsExpense(i.gl_code) || i.type==="expense";
  const isRevenue = i => glIsRevenue(i.gl_code) || i.type==="revenue";

  // Filter + search
  const base = invoices.filter(i => glPLType(i.gl_code) || i.type==="expense" || i.type==="revenue");
  const byFilter = base.filter(i => {
    if (filter==="revenue") return isRevenue(i);
    if (filter==="expenses") return isExpense(i);
    if (filter==="unpaid") return isExpense(i) && i.payment_status!=="paid" && i.status!=="voided";
    if (filter==="review") return needsReview(i) && i.status!=="voided";
    return true;
  });
  const q = search.trim().toLowerCase();
  const rows = byFilter.filter(i => !q ||
    (i.vendor||"").toLowerCase().includes(q) ||
    (i.description||"").toLowerCase().includes(q) ||
    (i.gl_name||"").toLowerCase().includes(q) ||
    (i.date||"").includes(q) ||
    String(i.amount||"").includes(q)
  ).sort((a,b)=>(b.date||"").localeCompare(a.date||""));

  const sel = invoices.find(i => i.id === selId) || null;

  const statusBadge = (i) => {
    if (i.status==="voided") return <span style={pill("#475467")}>Voided</span>;
    if (i.payment_status==="paid") return <span style={pill("#039855")}>Paid · {methodLabel(i.payment_method_used).split(" ")[0]}</span>;
    if (i.payment_status==="collected") return <span style={pill("#039855")}>Collected</span>;
    if (needsReview(i)) return <span style={pill("#DC6803")}>Needs Review</span>;
    return <span style={pill("#4F46E5")}>Booked</span>;
  };
  function pill(c){ return { fontSize:10, fontWeight:600, color:c, background:c+"14", border:`1px solid ${c}33`, borderRadius:20, padding:"2px 9px", whiteSpace:"nowrap" }; }

  const doRecode = (inv, code) => {
    const acct = (CHART_OF_ACCOUNTS||[]).find(a => a.code === code);
    if (!acct) return;
    setInvoices(prev => prev.map(i => i.id===inv.id ? { ...i, gl_code:acct.code, gl_name:acct.name } : i));
    logAudit && logAudit("recode", `Recoded ${inv.vendor} → ${acct.name}`, { gl_code:inv.gl_code }, { gl_code:acct.code, gl_name:acct.name });
    persistRecode && persistRecode([{ ...inv, gl_code:acct.code }], acct.code, acct.name);
    setRecodeOpen(false);
  };
  const doVoid = (inv) => {
    setInvoices(prev => prev.map(i => i.id===inv.id ? { ...i, status:"voided", voided_at:new Date().toISOString(), voided_reason:"Voided from Books" } : i));
    logAudit && logAudit("invoice_voided", `Voided ${inv.vendor} · ${fmt(inv.amount)}`, inv, null);
    setSelId(null);
  };

  const fpill = (id,label) => (
    <button key={id} onClick={()=>setBooksFilter(id)} style={{ padding:"7px 14px", borderRadius:8, fontSize:13, fontWeight:filter===id?600:400, background:filter===id?"#4F46E5":"#FFFFFF", border:`1px solid ${filter===id?"#4F46E5":"#E4E7EC"}`, color:filter===id?"#fff":"#374151", cursor:"pointer" }}>{label}</button>
  );

  return (
    <div>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:8 }}>BOOKS</div>
        <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>All transactions</h1>
        <div style={{ fontSize:13, color:"#475467", marginTop:6 }}>Every entry in one place. Click a row for full detail, AI reasoning, and actions.</div>
      </div>

      {/* Search + filters */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendor, amount, date, description…"
          style={{ flex:"1 1 280px", minWidth:0, background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:10, padding:"10px 14px", fontSize:14, color:"#101828", outline:"none" }} />
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {fpill("all","All")}{fpill("revenue","Revenue")}{fpill("expenses","Expenses")}{fpill("contracts","Contracts")}{fpill("unpaid","Unpaid")}{fpill("review","Needs Review")}
        </div>
      </div>

      {/* ── CONTRACTS TABLE (filter = contracts) ── */}
      {filter==="contracts" && (
        <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"hidden" }}>
          <table style={{ width:"100%", borderCollapse:"collapse" }}>
            <thead><tr style={{ background:"#F3F4F6" }}>
              {["Counterparty","Type","Monthly","Term","Status",""].map((h,i)=>(
                <th key={i} style={{ padding:"11px 16px", textAlign:h==="Monthly"?"right":"left", fontSize:11, color:"#475467", letterSpacing:1, fontWeight:600, borderBottom:"1px solid #E4E7EC", whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
              ))}
            </tr></thead>
            <tbody>
              {(contracts||[]).length===0 ? (
                <tr><td colSpan={6} style={{ padding:"44px", textAlign:"center", color:"#475467", fontSize:13 }}>No contracts yet. Drop a lease or contract on Home — AI extracts the ASC 842 schedule automatically.</td></tr>
              ) : (contracts||[]).filter(c => !q || (c.counterparty||"").toLowerCase().includes(q) || (c.contract_type||"").toLowerCase().includes(q) || (c.description||"").toLowerCase().includes(q)).map((c,idx)=>{
                const posted = (c.posted_entries?.length||0) >= (c.journal_entries?.length||0) && (c.journal_entries?.length||0)>0;
                const ct = (CONTRACT_TYPES && CONTRACT_TYPES[c.contract_type]) || { label:c.contract_type||"Contract", color:"#4F46E5", icon:"📄" };
                return (
                  <tr key={c.id||idx} onClick={()=>setSelContract(c)} style={{ cursor:"pointer", background:idx%2?"#F9FAFB":"#FFFFFF", borderBottom:"1px solid #F3F4F6" }}
                    onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background=idx%2?"#F9FAFB":"#FFFFFF"}>
                    <td style={{ padding:"12px 16px", fontSize:13, fontWeight:500, color:"#101828" }}>{c.counterparty||"—"}</td>
                    <td style={{ padding:"12px 16px" }}><span style={{ fontSize:11, fontWeight:600, color:ct.color, background:ct.color+"14", border:`1px solid ${ct.color}33`, borderRadius:20, padding:"2px 9px" }}>{ct.icon} {ct.label}</span></td>
                    <td style={{ padding:"12px 16px", textAlign:"right", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>{c.payment_amount?fmt(c.payment_amount):"—"}</td>
                    <td style={{ padding:"12px 16px", fontSize:12, color:"#475467" }}>{c.lease_term_months?`${c.lease_term_months} mo`:"—"}</td>
                    <td style={{ padding:"12px 16px" }}><span style={pill(posted?"#039855":"#DC6803")}>{posted?"Posted":"Draft"}</span></td>
                    <td style={{ padding:"12px 16px", textAlign:"right", color:"#98A2B3" }}>›</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {filter!=="contracts" && (<>
      {/* Table */}
      <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:"#F3F4F6" }}>
            {["Date","Vendor","Description","GL Account","Amount","Status",""].map((h,i)=>(
              <th key={i} style={{ padding:"11px 16px", textAlign:h==="Amount"?"right":"left", fontSize:11, color:"#475467", letterSpacing:1, fontWeight:600, borderBottom:"1px solid #E4E7EC", whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.length===0 ? (
              <tr><td colSpan={7} style={{ padding:"44px", textAlign:"center", color:"#475467", fontSize:13 }}>No transactions match.{search||filter!=="all"?" Try clearing the search or filter.":" Upload a document on Home to get started."}</td></tr>
            ) : rows.map((inv,idx)=>{
              const rev = isRevenue(inv);
              const unpaidExp = isExpense(inv) && inv.payment_status!=="paid" && inv.status!=="voided";
              return (
                <React.Fragment key={inv.id}>
                  <tr onClick={()=>setSelId(inv.id)} style={{ cursor:"pointer", background: selId===inv.id?"#EEF2FF":idx%2?"#F9FAFB":"#FFFFFF", borderBottom:"1px solid #F3F4F6", opacity: inv.status==="voided"?0.55:1 }}
                    onMouseEnter={e=>{ if(selId!==inv.id) e.currentTarget.style.background="#EEF2FF"; }} onMouseLeave={e=>{ if(selId!==inv.id) e.currentTarget.style.background=idx%2?"#F9FAFB":"#FFFFFF"; }}>
                    <td style={{ padding:"11px 16px", fontSize:12, color:"#475467", fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap" }}>{inv.date||"—"}</td>
                    <td style={{ padding:"11px 16px" }}><div style={{ display:"flex", alignItems:"center", gap:9 }}><span style={{ width:26,height:26,borderRadius:7,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(inv.vendor)}</span><span style={{ fontSize:13, fontWeight:500, color:"#101828" }}>{inv.vendor||"—"}</span></div></td>
                    <td style={{ padding:"11px 16px", fontSize:12, color:"#475467", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description||"—"}</td>
                    <td style={{ padding:"11px 16px", fontSize:12, color:"#374151", whiteSpace:"nowrap" }}><span style={{ fontFamily:"'DM Mono',monospace", color:"#475467" }}>{inv.gl_code}</span> {inv.gl_name}</td>
                    <td style={{ padding:"11px 16px", textAlign:"right", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color: rev?"#039855":"#D92D20", whiteSpace:"nowrap" }}>{rev?"+":"-"}{fmt(inv.amount)}</td>
                    <td style={{ padding:"11px 16px" }}>{statusBadge(inv)}</td>
                    <td style={{ padding:"11px 16px", textAlign:"right", whiteSpace:"nowrap" }}>
                      {unpaidExp && (
                        <button onClick={e=>{ e.stopPropagation(); setPayRowId(payRowId===inv.id?null:inv.id); setPayMethod("ach"); setPayDate(new Date().toISOString().slice(0,10)); }}
                          style={{ padding:"5px 11px", borderRadius:7, fontSize:11, fontWeight:600, background:"#ECFDF5", border:"1px solid #03985544", color:"#039855", cursor:"pointer" }}>Mark Paid</button>
                      )}
                    </td>
                  </tr>
                  {payRowId===inv.id && (
                    <tr style={{ background:"#F9FAFB" }}>
                      <td colSpan={7} style={{ padding:"12px 16px", borderBottom:"1px solid #F3F4F6" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                          <span style={{ fontSize:12, color:"#475467" }}>Pay {inv.vendor} · {fmt(inv.amount)}:</span>
                          <input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#101828", outline:"none" }} />
                          <select value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#101828", outline:"none" }}>
                            {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>
                          <button onClick={()=>{ markPaid(inv.id, payMethod, { date: payDate }); setPayRowId(null); }} style={{ padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"#039855", border:"none", color:"#fff", cursor:"pointer" }}>Confirm</button>
                          <button onClick={()=>setPayRowId(null)} style={{ padding:"6px 12px", borderRadius:7, fontSize:12, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", cursor:"pointer" }}>Cancel</button>
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
      <div style={{ fontSize:12, color:"#475467", marginTop:10 }}>{rows.length} transaction{rows.length!==1?"s":""}{filter!=="all"?` · ${filter}`:""}</div>
      </>)}

      {/* ── RECONCILIATION HISTORY ── */}
      {(reconciliations||[]).length>0 && (
        <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, marginTop:16, overflow:"hidden" }}>
          <div onClick={()=>setShowReconHistory(s=>!s)} style={{ padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
            <div style={{ fontSize:13, fontWeight:600 }}>🏦 Bank reconciliation history</div>
            <span style={{ fontSize:12, color:"#4F46E5", fontWeight:600 }}>{showReconHistory?"Hide ▲":"Show ▼"}</span>
          </div>
          {showReconHistory && (
            <div style={{ borderTop:"1px solid #F3F4F6" }}>
              {[...(reconciliations||[])].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).map(r=>{
                const od = r.status==="complete" && r.completed_at && (Date.now()-new Date(r.completed_at).getTime())/86400000>35;
                const color = r.status==="in_progress"?"#DC6803":od?"#D92D20":"#039855";
                const label = r.status==="in_progress"?"In Progress":od?"Overdue":"Complete";
                return (
                  <div key={r.id} onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 18px", borderTop:"1px solid #F3F4F6" }}>
                    <div><div style={{ fontSize:13, fontWeight:500 }}>{r.account_name} · {r.period_start} → {r.period_end}</div><div style={{ fontSize:11, color:"#475467" }}>{fmt(r.statement_balance)}{r.completed_at?` · ${new Date(r.completed_at).toLocaleDateString()}`:""}</div></div>
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
        const ct = (CONTRACT_TYPES && CONTRACT_TYPES[c.contract_type]) || { label:c.contract_type||"Contract", color:"#4F46E5", icon:"📄" };
        const entries = c.journal_entries || [];
        const postedCount = c.posted_entries?.length || 0;
        return (
          <div onClick={()=>setSelContract(null)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(17,24,39,0.35)", display:"flex", justifyContent:"flex-end" }}>
            <style>{`@keyframes booksIn2{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div onClick={e=>e.stopPropagation()} style={{ width:520, maxWidth:"94vw", height:"100%", background:"#FFFFFF", borderLeft:"1px solid #E4E7EC", boxShadow:"-12px 0 40px rgba(17,24,39,0.12)", display:"flex", flexDirection:"column", animation:"booksIn2 .25s cubic-bezier(.22,1,.36,1)" }}>
              <div style={{ padding:"20px 24px", borderBottom:"1px solid #F3F4F6", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                <div style={{ minWidth:0 }}>
                  <span style={{ fontSize:11, fontWeight:600, color:ct.color, background:ct.color+"14", border:`1px solid ${ct.color}33`, borderRadius:20, padding:"2px 9px" }}>{ct.icon} {ct.label}</span>
                  <div style={{ fontSize:18, fontWeight:600, marginTop:8, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.counterparty||"Contract"}</div>
                </div>
                <button onClick={()=>setSelContract(null)} style={{ background:"none", border:"none", color:"#475467", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
              </div>
              <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
                {c.description && <div style={{ fontSize:13, color:"#374151", lineHeight:1.6, marginBottom:16 }}>{c.description}</div>}
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
                  <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:14, padding:"10px 0", borderBottom:"1px solid #F3F4F6", fontSize:13 }}>
                    <span style={{ color:"#475467", flexShrink:0 }}>{k}</span>
                    <span style={{ color:"#101828", textAlign:"right", wordBreak:"break-word", fontFamily:/payment|value|asset|liability/i.test(k)?"'DM Mono',monospace":"inherit" }}>{v}</span>
                  </div>
                ))}
                {/* Journal entry schedule */}
                <div style={{ marginTop:18 }}>
                  <div style={{ fontSize:11, letterSpacing:1, color:"#475467", marginBottom:8, fontWeight:600 }}>JOURNAL ENTRY SCHEDULE ({postedCount}/{entries.length} posted)</div>
                  {entries.length===0 ? <div style={{ fontSize:13, color:"#475467" }}>No entries generated.</div> :
                    entries.map((e,i)=>(
                      <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid #F3F4F6", fontSize:12 }}>
                        <span style={{ color:"#374151" }}>{e.description||e.memo||`Entry ${i+1}`}{e.date?` · ${e.date}`:""}</span>
                        <span style={{ fontFamily:"'DM Mono',monospace", color:"#101828" }}>{e.amount!=null?fmt(e.amount):""}{(c.posted_entries||[]).includes(i)?" ✓":""}</span>
                      </div>
                    ))
                  }
                </div>
              </div>
              <div style={{ padding:"16px 24px", borderTop:"1px solid #F3F4F6", display:"flex", gap:10 }}>
                <button onClick={()=>{ postAllContractEntries && postAllContractEntries(c); showNotification && showNotification("Posting contract entries…"); setSelContract(null); }} style={{ flex:1, padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>Post entries</button>
                <button onClick={()=>{ setSelectedContract(c); setContractView && setContractView("detail"); setView("contracts"); setSelContract(null); }} style={{ padding:"11px 16px", borderRadius:10, fontSize:13, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", cursor:"pointer" }}>Full ASC 842 view →</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── SLIDE-IN DETAIL PANEL ── */}
      {sel && (
        <div onClick={()=>{ setSelId(null); setRecodeOpen(false); }} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(17,24,39,0.35)", display:"flex", justifyContent:"flex-end" }}>
          <style>{`@keyframes booksIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ width:880, maxWidth:"94vw", height:"100%", background:"#FFFFFF", borderLeft:"1px solid #E4E7EC", boxShadow:"-20px 0 60px rgba(16,24,40,0.18)", display:"flex", flexDirection:"column", animation:"booksIn .25s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ padding:"20px 24px", borderBottom:"1px solid #F3F4F6", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                <span style={{ width:42,height:42,borderRadius:11,background:vendorColor(sel.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(sel.vendor)}</span>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:16, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{sel.vendor||"—"}</div>
                  <div style={{ fontSize:12, color:"#475467" }}>{sel.date}</div>
                </div>
              </div>
              <button onClick={()=>{ setSelId(null); setRecodeOpen(false); }} style={{ background:"none", border:"none", color:"#475467", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
              <div style={{ fontSize:30, fontWeight:700, fontFamily:"'DM Mono',monospace", color: isRevenue(sel)?"#039855":"#D92D20", marginBottom:6 }}>{isRevenue(sel)?"+":"-"}{fmt(sel.amount)}</div>
              <div style={{ marginBottom:18 }}>{statusBadge(sel)}</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(300px,1fr))", gap:28, alignItems:"start" }}>
              <div>
              {[
                ["Description", sel.description||"—"],
                ["GL account", `${sel.gl_code||""} ${sel.gl_name||""}`],
                ["Offset account", sel.secondary_gl_code ? `${sel.secondary_gl_code} ${sel.secondary_gl_name||""}` : "—"],
                ["Type", isRevenue(sel)?"Revenue":"Expense"],
                ["AI confidence", sel.confidence!=null ? `${sel.confidence}%` : "—"],
                sel.payment_status==="paid" ? ["Payment", `${methodLabel(sel.payment_method_used)}${sel.paid_at?` · ${new Date(sel.paid_at).toLocaleDateString()}`:""}${sel.payment_reference?` · ${sel.payment_reference}`:""}`] : null,
                (sel.payment_status==="paid"||sel.payment_status==="collected") ? ["How paid", (sel.auto_matched || sel.payment_method_used==="bank_transfer") ? `Auto-matched from bank statement${sel.matched_bank_date?` (${sel.matched_bank_date})`:""}` : "Manually marked paid"] : null,
              ].filter(Boolean).map(([k,v])=>(
                <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:14, padding:"11px 0", borderBottom:"1px solid #F3F4F6", fontSize:13 }}>
                  <span style={{ color:"#475467", flexShrink:0 }}>{k}</span>
                  <span style={{ color:"#101828", textAlign:"right", wordBreak:"break-word" }}>{v}</span>
                </div>
              ))}
              {sel.reasoning && (
                <div style={{ marginTop:16, background:"#F5F3FF", borderLeft:"3px solid #4F46E5", borderRadius:"0 10px 10px 0", padding:"14px 16px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8 }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink:0 }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>
                    <div style={{ fontSize:11, letterSpacing:1.5, color:"#4F46E5", fontWeight:600 }}>AI REASONING</div>
                  </div>
                  <div style={{ fontSize:13, color:"#475467", lineHeight:1.6 }}>{sel.reasoning}</div>
                </div>
              )}
              </div>
              <div>
              {/* Source Document */}
              {(() => {
                const srcDoc = findSourceDoc(sel);
                return (
                  <div style={{ marginTop:16 }}>
                    <div style={{ fontSize:10, letterSpacing:1, color:"#4F46E5", marginBottom:8, fontWeight:600 }}>SOURCE DOCUMENT</div>
                    {srcDoc ? (
                      <div onClick={()=>setSrcDocPreview(srcDoc)} style={{ display:"flex", alignItems:"center", gap:12, background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:10, padding:"12px 14px", cursor:"pointer", transition:"border-color 0.15s" }}
                        onMouseEnter={e=>e.currentTarget.style.borderColor="#4F46E5"} onMouseLeave={e=>e.currentTarget.style.borderColor="#E4E7EC"}>
                        <div style={{ width:42, height:42, borderRadius:8, background:"#F3F4F6", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                          <span style={{ fontSize:22 }}>{srcDoc.mediaType==="application/pdf"?"📄":isImageDoc(srcDoc.mediaType)?"🖼":docIcon(srcDoc.type)}</span>
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:500, wordBreak:"break-word" }}>{srcDoc.name}</div>
                          <div style={{ fontSize:11, color:"#475467", marginTop:2 }}>{srcDoc.uploaded_at?.slice(0,10)}{srcDoc.mediaType?` · ${srcDoc.mediaType}`:""}</div>
                        </div>
                        <button onClick={(e)=>{ e.stopPropagation(); setSrcDocPreview(srcDoc); }} style={{ flexShrink:0, padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#EEF2FF", border:"1px solid #4F46E533", color:"#4F46E5", cursor:"pointer", whiteSpace:"nowrap" }}>View Document</button>
                      </div>
                    ) : (
                      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, background:"#F9FAFB", border:"1px dashed #D0D5DD", borderRadius:10, padding:"12px 14px" }}>
                        <div style={{ fontSize:12, color:"#98A2B3" }}>No source document attached.</div>
                        <button onClick={()=>srcFileRef.current?.click()} disabled={srcUploading} style={{ flexShrink:0, padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:srcUploading?"#E4E7EC":"#4F46E5", border:"none", color:srcUploading?"#98A2B3":"#fff", cursor:srcUploading?"default":"pointer", whiteSpace:"nowrap" }}>{srcUploading?"Uploading…":"↑ Upload"}</button>
                        <input ref={srcFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:"none" }} onChange={e=>{ const f=e.target.files?.[0]; e.target.value=""; handleSourceUpload(f, sel); }} />
                      </div>
                    )}
                  </div>
                );
              })()}
              </div>
              </div>

              {/* Recode */}
              <div style={{ marginTop:18 }}>
                {recodeOpen ? (
                  <div>
                    <div style={{ fontSize:11, color:"#475467", marginBottom:6, letterSpacing:0.5 }}>RECODE GL ACCOUNT</div>
                    <select defaultValue={sel.gl_code} onChange={e=>doRecode(sel, e.target.value)} style={{ width:"100%", background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:9, padding:"10px 12px", fontSize:13, color:"#101828", outline:"none" }}>
                      {(CHART_OF_ACCOUNTS||[]).filter(a=>a.code>="4000").map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                    <button onClick={()=>setRecodeOpen(false)} style={{ marginTop:8, background:"none", border:"none", color:"#475467", fontSize:12, cursor:"pointer", padding:0 }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={()=>setRecodeOpen(true)} style={{ fontSize:12, color:"#4F46E5", background:"#EEF2FF", border:"1px solid #4F46E533", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontWeight:600 }}>Recode GL account</button>
                )}
              </div>
            </div>
            {/* Actions footer */}
            <div style={{ padding:"16px 24px", borderTop:"1px solid #F3F4F6", display:"flex", gap:10, flexWrap:"wrap" }}>
              {isExpense(sel) && sel.payment_status!=="paid" && sel.status!=="voided" && (
                <button onClick={()=>{ setSelId(null); setPayRowId(sel.id); }} style={{ flex:1, padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, background:"#039855", border:"none", color:"#fff", cursor:"pointer" }}>Mark as Paid</button>
              )}
              <button onClick={()=>{ setSelectedInvoice(sel); setView("detail"); }} style={{ flex:1, padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>Full entry →</button>
              {sel.status!=="voided" && <button onClick={()=>doVoid(sel)} style={{ padding:"11px 16px", borderRadius:10, fontSize:13, background:"#FFFFFF", border:"1px solid #D92D2044", color:"#D92D20", cursor:"pointer" }}>Void</button>}
            </div>
          </div>
        </div>
      )}

      {srcDocPreview && <DocumentPreviewModal doc={srcDocPreview} onClose={() => setSrcDocPreview(null)} />}
    </div>
  );
}
