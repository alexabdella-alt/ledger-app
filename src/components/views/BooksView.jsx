import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";

export default function BooksView() {
  const {
    invoices, setInvoices, markPaid, persistRecode, logAudit,
    setSelectedInvoice, setView, CHART_OF_ACCOUNTS,
    booksFilter, setBooksFilter,
  } = useERP();

  const [search, setSearch] = React.useState("");
  const [selId, setSelId] = React.useState(null);
  const [payRowId, setPayRowId] = React.useState(null);
  const [payMethod, setPayMethod] = React.useState("ach");
  const [payDate, setPayDate] = React.useState(new Date().toISOString().slice(0,10));
  const [recodeOpen, setRecodeOpen] = React.useState(false);

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
    if (i.status==="voided") return <span style={pill("#6B7280")}>Voided</span>;
    if (i.payment_status==="paid") return <span style={pill("#059669")}>Paid · {methodLabel(i.payment_method_used).split(" ")[0]}</span>;
    if (i.payment_status==="collected") return <span style={pill("#059669")}>Collected</span>;
    if (needsReview(i)) return <span style={pill("#D97706")}>Needs Review</span>;
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
    <button key={id} onClick={()=>setBooksFilter(id)} style={{ padding:"7px 14px", borderRadius:8, fontSize:13, fontWeight:filter===id?600:400, background:filter===id?"#4F46E5":"#FFFFFF", border:`1px solid ${filter===id?"#4F46E5":"#E5E7EB"}`, color:filter===id?"#fff":"#374151", cursor:"pointer" }}>{label}</button>
  );

  return (
    <div>
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:10, letterSpacing:3, color:"#6B7280", marginBottom:8 }}>BOOKS</div>
        <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>All transactions</h1>
        <div style={{ fontSize:13, color:"#6B7280", marginTop:6 }}>Every entry in one place. Click a row for full detail, AI reasoning, and actions.</div>
      </div>

      {/* Search + filters */}
      <div style={{ display:"flex", gap:12, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search vendor, amount, date, description…"
          style={{ flex:"1 1 320px", minWidth:0, background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:10, padding:"10px 14px", fontSize:14, color:"#111827", outline:"none" }} />
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {fpill("all","All")}{fpill("revenue","Revenue")}{fpill("expenses","Expenses")}{fpill("unpaid","Unpaid")}{fpill("review","Needs Review")}
        </div>
      </div>

      {/* Table */}
      <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, overflow:"hidden" }}>
        <table style={{ width:"100%", borderCollapse:"collapse" }}>
          <thead><tr style={{ background:"#F3F4F6" }}>
            {["Date","Vendor","Description","GL Account","Amount","Status",""].map((h,i)=>(
              <th key={i} style={{ padding:"11px 16px", textAlign:h==="Amount"?"right":"left", fontSize:11, color:"#6B7280", letterSpacing:1, fontWeight:600, borderBottom:"1px solid #E5E7EB", whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>
            ))}
          </tr></thead>
          <tbody>
            {rows.length===0 ? (
              <tr><td colSpan={7} style={{ padding:"44px", textAlign:"center", color:"#6B7280", fontSize:13 }}>No transactions match.{search||filter!=="all"?" Try clearing the search or filter.":" Upload a document on Home to get started."}</td></tr>
            ) : rows.map((inv,idx)=>{
              const rev = isRevenue(inv);
              const unpaidExp = isExpense(inv) && inv.payment_status!=="paid" && inv.status!=="voided";
              return (
                <React.Fragment key={inv.id}>
                  <tr onClick={()=>setSelId(inv.id)} style={{ cursor:"pointer", background: selId===inv.id?"#EEF2FF":idx%2?"#F9FAFB":"#FFFFFF", borderBottom:"1px solid #F3F4F6", opacity: inv.status==="voided"?0.55:1 }}
                    onMouseEnter={e=>{ if(selId!==inv.id) e.currentTarget.style.background="#EEF2FF"; }} onMouseLeave={e=>{ if(selId!==inv.id) e.currentTarget.style.background=idx%2?"#F9FAFB":"#FFFFFF"; }}>
                    <td style={{ padding:"11px 16px", fontSize:12, color:"#6B7280", fontFamily:"'DM Mono',monospace", whiteSpace:"nowrap" }}>{inv.date||"—"}</td>
                    <td style={{ padding:"11px 16px" }}><div style={{ display:"flex", alignItems:"center", gap:9 }}><span style={{ width:26,height:26,borderRadius:7,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(inv.vendor)}</span><span style={{ fontSize:13, fontWeight:500, color:"#111827" }}>{inv.vendor||"—"}</span></div></td>
                    <td style={{ padding:"11px 16px", fontSize:12, color:"#6B7280", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description||"—"}</td>
                    <td style={{ padding:"11px 16px", fontSize:12, color:"#374151", whiteSpace:"nowrap" }}><span style={{ fontFamily:"'DM Mono',monospace", color:"#6B7280" }}>{inv.gl_code}</span> {inv.gl_name}</td>
                    <td style={{ padding:"11px 16px", textAlign:"right", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color: rev?"#059669":"#DC2626", whiteSpace:"nowrap" }}>{rev?"+":"-"}{fmt(inv.amount)}</td>
                    <td style={{ padding:"11px 16px" }}>{statusBadge(inv)}</td>
                    <td style={{ padding:"11px 16px", textAlign:"right", whiteSpace:"nowrap" }}>
                      {unpaidExp && (
                        <button onClick={e=>{ e.stopPropagation(); setPayRowId(payRowId===inv.id?null:inv.id); setPayMethod("ach"); setPayDate(new Date().toISOString().slice(0,10)); }}
                          style={{ padding:"5px 11px", borderRadius:7, fontSize:11, fontWeight:600, background:"#ECFDF5", border:"1px solid #05966944", color:"#059669", cursor:"pointer" }}>Mark Paid</button>
                      )}
                    </td>
                  </tr>
                  {payRowId===inv.id && (
                    <tr style={{ background:"#F9FAFB" }}>
                      <td colSpan={7} style={{ padding:"12px 16px", borderBottom:"1px solid #F3F4F6" }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                          <span style={{ fontSize:12, color:"#6B7280" }}>Pay {inv.vendor} · {fmt(inv.amount)}:</span>
                          <input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#111827", outline:"none" }} />
                          <select value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#111827", outline:"none" }}>
                            {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                          </select>
                          <button onClick={()=>{ markPaid(inv.id, payMethod, { date: payDate }); setPayRowId(null); }} style={{ padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"#059669", border:"none", color:"#fff", cursor:"pointer" }}>Confirm</button>
                          <button onClick={()=>setPayRowId(null)} style={{ padding:"6px 12px", borderRadius:7, fontSize:12, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", cursor:"pointer" }}>Cancel</button>
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
      <div style={{ fontSize:12, color:"#6B7280", marginTop:10 }}>{rows.length} transaction{rows.length!==1?"s":""}{filter!=="all"?` · ${filter}`:""}</div>

      {/* ── SLIDE-IN DETAIL PANEL ── */}
      {sel && (
        <div onClick={()=>{ setSelId(null); setRecodeOpen(false); }} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(17,24,39,0.35)", display:"flex", justifyContent:"flex-end" }}>
          <style>{`@keyframes booksIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
          <div onClick={e=>e.stopPropagation()} style={{ width:480, maxWidth:"94vw", height:"100%", background:"#FFFFFF", borderLeft:"1px solid #E5E7EB", boxShadow:"-12px 0 40px rgba(17,24,39,0.12)", display:"flex", flexDirection:"column", animation:"booksIn .25s cubic-bezier(.22,1,.36,1)" }}>
            <div style={{ padding:"20px 24px", borderBottom:"1px solid #F3F4F6", display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
              <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                <span style={{ width:42,height:42,borderRadius:11,background:vendorColor(sel.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(sel.vendor)}</span>
                <div style={{ minWidth:0 }}>
                  <div style={{ fontSize:16, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{sel.vendor||"—"}</div>
                  <div style={{ fontSize:12, color:"#6B7280" }}>{sel.date}</div>
                </div>
              </div>
              <button onClick={()=>{ setSelId(null); setRecodeOpen(false); }} style={{ background:"none", border:"none", color:"#6B7280", fontSize:24, cursor:"pointer", lineHeight:1 }}>×</button>
            </div>
            <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
              <div style={{ fontSize:30, fontWeight:700, fontFamily:"'DM Mono',monospace", color: isRevenue(sel)?"#059669":"#DC2626", marginBottom:6 }}>{isRevenue(sel)?"+":"-"}{fmt(sel.amount)}</div>
              <div style={{ marginBottom:18 }}>{statusBadge(sel)}</div>
              {[
                ["Description", sel.description||"—"],
                ["GL account", `${sel.gl_code||""} ${sel.gl_name||""}`],
                ["Offset account", sel.secondary_gl_code ? `${sel.secondary_gl_code} ${sel.secondary_gl_name||""}` : "—"],
                ["Type", isRevenue(sel)?"Revenue":"Expense"],
                ["AI confidence", sel.confidence!=null ? `${sel.confidence}%` : "—"],
                sel.payment_status==="paid" ? ["Payment", `${methodLabel(sel.payment_method_used)}${sel.paid_at?` · ${new Date(sel.paid_at).toLocaleDateString()}`:""}${sel.payment_reference?` · ${sel.payment_reference}`:""}`] : null,
              ].filter(Boolean).map(([k,v])=>(
                <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:14, padding:"11px 0", borderBottom:"1px solid #F3F4F6", fontSize:13 }}>
                  <span style={{ color:"#6B7280", flexShrink:0 }}>{k}</span>
                  <span style={{ color:"#111827", textAlign:"right", wordBreak:"break-word" }}>{v}</span>
                </div>
              ))}
              {sel.reasoning && (
                <div style={{ marginTop:16, background:"#F9FAFB", border:"1px solid #E5E7EB", borderRadius:10, padding:"14px 16px" }}>
                  <div style={{ fontSize:10, letterSpacing:1, color:"#4F46E5", marginBottom:6, fontWeight:600 }}>AI REASONING</div>
                  <div style={{ fontSize:13, color:"#374151", lineHeight:1.6 }}>{sel.reasoning}</div>
                </div>
              )}
              {/* Recode */}
              <div style={{ marginTop:18 }}>
                {recodeOpen ? (
                  <div>
                    <div style={{ fontSize:11, color:"#6B7280", marginBottom:6, letterSpacing:0.5 }}>RECODE GL ACCOUNT</div>
                    <select defaultValue={sel.gl_code} onChange={e=>doRecode(sel, e.target.value)} style={{ width:"100%", background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:9, padding:"10px 12px", fontSize:13, color:"#111827", outline:"none" }}>
                      {(CHART_OF_ACCOUNTS||[]).filter(a=>a.code>="4000").map(a=><option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                    </select>
                    <button onClick={()=>setRecodeOpen(false)} style={{ marginTop:8, background:"none", border:"none", color:"#6B7280", fontSize:12, cursor:"pointer", padding:0 }}>Cancel</button>
                  </div>
                ) : (
                  <button onClick={()=>setRecodeOpen(true)} style={{ fontSize:12, color:"#4F46E5", background:"#EEF2FF", border:"1px solid #4F46E533", borderRadius:8, padding:"8px 14px", cursor:"pointer", fontWeight:600 }}>Recode GL account</button>
                )}
              </div>
            </div>
            {/* Actions footer */}
            <div style={{ padding:"16px 24px", borderTop:"1px solid #F3F4F6", display:"flex", gap:10, flexWrap:"wrap" }}>
              {isExpense(sel) && sel.payment_status!=="paid" && sel.status!=="voided" && (
                <button onClick={()=>{ setSelId(null); setPayRowId(sel.id); }} style={{ flex:1, padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, background:"#059669", border:"none", color:"#fff", cursor:"pointer" }}>Mark as Paid</button>
              )}
              <button onClick={()=>{ setSelectedInvoice(sel); setView("detail"); }} style={{ flex:1, padding:"11px", borderRadius:10, fontSize:13, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>Full entry →</button>
              {sel.status!=="voided" && <button onClick={()=>doVoid(sel)} style={{ padding:"11px 16px", borderRadius:10, fontSize:13, background:"#FFFFFF", border:"1px solid #DC262644", color:"#DC2626", cursor:"pointer" }}>Void</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
