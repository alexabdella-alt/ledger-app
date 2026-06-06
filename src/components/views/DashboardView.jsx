import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function DashboardView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, glDrilldown, setGlDrilldown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, reconciliations, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  const [burnModalOpen, setBurnModalOpen] = React.useState(false);
  const [burnDrill, setBurnDrill] = React.useState({ cat:null, vendor:null }); // expense drill-down path
  const [dashDrill, setDashDrill] = React.useState(null); // unified dashboard drill-down
  const [feedCount, setFeedCount] = React.useState(20); // activity feed page size
  const [showCommit, setShowCommit] = React.useState(false); // active commitments expander
  const [apPayId, setApPayId] = React.useState(null); // inline "mark paid" row in the AP drill
  const [apPayMethod, setApPayMethod] = React.useState("ach");
  const [apPayDate, setApPayDate] = React.useState(new Date().toISOString().slice(0,10));
  const goReports = () => { setReportType && setReportType("pl"); setView("reports"); };
  const cardHover = (on) => (e) => { e.currentTarget.style.borderColor = on ? "#6366F1" : "#E5E7EB"; e.currentTarget.style.transform = on ? "translateY(-2px)" : "none"; };

  // ── UNIFIED DASHBOARD DRILL-DOWN (breadcrumbed, in-place) ──
  if (dashDrill) {
    const d = dashDrill;
    const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
    const today = new Date();
    const exp = invoices.filter(i => glIsExpense(i.gl_code) && i.status!=="voided");
    const rev = invoices.filter(i => glIsRevenue(i.gl_code) && i.status!=="voided");
    // Open payables: any expense (gl 5xxx/6xxx), not paid, not voided — SAME logic as the Home alert count.
    const openAP = exp.filter(i => i.payment_status!=="paid");
    const openAR = rev.filter(i => i.payment_status!=="collected");

    const crumbs = [{ label:"Dashboard", to:null }];
    if (d.type==="revenue") crumbs.push({ label:"Revenue", to:{type:"revenue"} });
    if (d.type==="net")     crumbs.push({ label:"Net Income", to:{type:"net"} });
    if (d.type==="cash")    crumbs.push({ label:"Cash & Bank", to:{type:"cash"} });
    if (d.type==="runway")  crumbs.push({ label:"Runway", to:{type:"runway"} });
    if (d.type==="ap")      crumbs.push({ label:"Accounts Payable", to:{type:"ap"} });
    if (d.type==="ar")      crumbs.push({ label:"Accounts Receivable", to:{type:"ar"} });
    if (d.type==="burn")    { crumbs.push({ label:"Burn Rate", to:{type:"burn"} }); if (d.month) crumbs.push({ label:d.monthLabel||d.month, to:d }); }
    if (d.type==="expenses"){ crumbs.push({ label:"Expenses", to:{type:"expenses"} }); if (d.cat) crumbs.push({ label:d.cat, to:{type:"expenses",cat:d.cat} }); if (d.vendor) crumbs.push({ label:d.vendor, to:d }); }
    const back = crumbs.length>1 ? crumbs[crumbs.length-2].to : null;

    const txnRows = (arr, color="#111827") => arr.length===0
      ? <div style={{ padding:"28px 18px", fontSize:13, color:"#6B7280", textAlign:"center" }}>No transactions here.</div>
      : [...arr].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(inv=>(
          <div key={inv.id} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}
            onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"11px 18px", cursor:"pointer", borderTop:"1px solid #F3F4F6" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
              <span style={{ fontSize:11, color:"#6B7280", fontFamily:"'DM Mono',monospace", width:80, flexShrink:0 }}>{inv.date||"—"}</span>
              <span style={{ width:28, height:28, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</span>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, color:"#111827", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"—"}</div>
                <div style={{ fontSize:11, color:"#6B7280", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.description||"—"}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"#6B7280", fontFamily:"monospace", background:"#F3F4F6", padding:"1px 6px", borderRadius:4 }}>{inv.gl_code}</span>
              <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color, width:104, textAlign:"right" }}>{fmt(inv.amount)}</span>
            </div>
          </div>
        ));

    const clickableRow = (key, left, right, onClick) => (
      <div key={key} onClick={onClick} onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"13px 18px", cursor:"pointer", borderTop:"1px solid #F3F4F6" }}>
        {left}
        <span style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>{right}<span style={{ color:"#9CA3AF" }}>›</span></span>
      </div>
    );

    let title, subtitle, body;
    if (d.type==="revenue") {
      title = "Revenue transactions"; subtitle = `${rev.length} entr${rev.length!==1?"ies":"y"} · ${fmt(rev.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(rev, "#059669");
    } else if (d.type==="expenses" && !d.cat) {
      const cats = Object.values(exp.reduce((a,i)=>{const k=i.gl_name||"Uncoded"; if(!a[k])a[k]={name:k,total:0,count:0}; a[k].total+=i.amount; a[k].count++; return a;},{})).sort((x,y)=>y.total-x.total);
      title = "Expenses by category"; subtitle = `${cats.length} categories · ${fmt(exp.reduce((s,i)=>s+i.amount,0))}`;
      body = cats.length===0 ? <div style={{ padding:"28px 18px", fontSize:13, color:"#6B7280", textAlign:"center" }}>No expenses yet.</div> :
        cats.map(c=>clickableRow(c.name,
          <span style={{ fontSize:13, color:"#374151" }}>{c.name} <span style={{ fontSize:11, color:"#9CA3AF" }}>· {c.count}</span></span>,
          <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#DC2626" }}>{fmt(c.total)}</span>,
          ()=>setDashDrill({type:"expenses",cat:c.name})));
    } else if (d.type==="expenses" && d.cat && !d.vendor) {
      const inCat = exp.filter(i=>(i.gl_name||"Uncoded")===d.cat);
      const vends = Object.values(inCat.reduce((a,i)=>{const v=i.vendor||"Unknown"; if(!a[v])a[v]={vendor:v,total:0,count:0}; a[v].total+=i.amount; a[v].count++; return a;},{})).sort((x,y)=>y.total-x.total);
      title = `${d.cat} — by vendor`; subtitle = `${vends.length} vendors · ${fmt(inCat.reduce((s,i)=>s+i.amount,0))}`;
      body = vends.map(v=>clickableRow(v.vendor,
        <span style={{ fontSize:13, color:"#374151", display:"flex", alignItems:"center", gap:9 }}><span style={{ width:24, height:24, borderRadius:6, background:vendorColor(v.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(v.vendor)}</span>{v.vendor} <span style={{ fontSize:11, color:"#9CA3AF" }}>· {v.count}</span></span>,
        <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#DC2626" }}>{fmt(v.total)}</span>,
        ()=>setDashDrill({type:"expenses",cat:d.cat,vendor:v.vendor})));
    } else if (d.type==="expenses" && d.vendor) {
      const txns = exp.filter(i=>(i.gl_name||"Uncoded")===d.cat && (i.vendor||"Unknown")===d.vendor);
      title = `${d.vendor} — ${d.cat}`; subtitle = `${txns.length} transactions · ${fmt(txns.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(txns, "#DC2626");
    } else if (d.type==="net") {
      const r = rev.reduce((s,i)=>s+i.amount,0), e = exp.reduce((s,i)=>s+i.amount,0);
      title = "Net income"; subtitle = "Profit & loss summary";
      body = (<div style={{ padding:"8px 0" }}>
        {clickableRow("rev", <span style={{ fontSize:14, color:"#374151" }}>Total Revenue</span>, <span style={{ fontSize:14, fontFamily:"'DM Mono',monospace", color:"#059669" }}>{fmt(r)}</span>, ()=>setDashDrill({type:"revenue"}))}
        {clickableRow("exp", <span style={{ fontSize:14, color:"#374151" }}>Total Expenses</span>, <span style={{ fontSize:14, fontFamily:"'DM Mono',monospace", color:"#DC2626" }}>({fmt(e)})</span>, ()=>setDashDrill({type:"expenses"}))}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 18px", borderTop:"2px solid #E5E7EB", marginTop:4 }}>
          <span style={{ fontSize:16, fontWeight:700 }}>Net {r-e>=0?"Income":"Loss"}</span>
          <span style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:r-e>=0?"#059669":"#DC2626" }}>{r-e<0?"-":""}{fmt(r-e)}</span>
        </div>
        <div style={{ padding:"12px 18px" }}><button onClick={goReports} style={{ padding:"8px 16px", borderRadius:9, fontSize:12, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>Open full P&amp;L report →</button></div>
      </div>);
    } else if (d.type==="cash") {
      const cashTxns = invoices.filter(i => (i.source==="bank_feed" || i.payment_status==="paid" || i.payment_status==="collected") && i.status!=="voided");
      title = "Cash & bank"; subtitle = `${(bankAccounts||[]).length} account${(bankAccounts||[]).length!==1?"s":""} · ${cashTxns.length} cash transactions`;
      body = (<div>
        <div style={{ padding:"12px 18px", display:"flex", gap:10, flexWrap:"wrap" }}>
          {(bankAccounts||[]).length===0 ? <span style={{ fontSize:13, color:"#6B7280" }}>No bank accounts yet — add one in Settings.</span> :
            (bankAccounts||[]).map((b,i)=>(
              <div key={b.id||i} onClick={()=>setView("settings")} style={{ cursor:"pointer", border:"1px solid #E5E7EB", borderRadius:10, padding:"10px 14px", background:"#F9FAFB" }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{b.name||"Account"}</div>
                <div style={{ fontSize:11, color:"#6B7280" }}>{b.type||"bank"} · Settings ›</div>
              </div>
            ))}
        </div>
        <div style={{ fontSize:10, letterSpacing:1.5, color:"#6B7280", padding:"6px 18px", borderTop:"1px solid #F3F4F6" }}>RECENT CASH TRANSACTIONS</div>
        {txnRows(cashTxns.slice(0,40))}
      </div>);
    } else if (d.type==="burn" && !d.month) {
      const months = Array.from({length:6},(_,k)=>{ const dd=new Date(today.getFullYear(), today.getMonth()-k, 1); const key=dd.toISOString().slice(0,7); const total=exp.filter(i=>i.date?.startsWith(key)).reduce((s,i)=>s+i.amount,0); return { key, label: dd.toLocaleDateString("en-US",{month:"long",year:"numeric"}), total }; });
      const max = Math.max(1,...months.map(m=>m.total));
      title = "Monthly burn"; subtitle = "Last 6 months — click a month to see its transactions";
      body = months.map(m=>(
        <div key={m.key} onClick={()=>setDashDrill({type:"burn",month:m.key,monthLabel:m.label})} onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
          style={{ padding:"12px 18px", cursor:"pointer", borderTop:"1px solid #F3F4F6" }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:13, color:"#374151" }}>{m.label}</span>
            <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#DC2626" }}>{fmt(m.total)} ›</span>
          </div>
          <div style={{ height:5, background:"#F3F4F6", borderRadius:3 }}><div style={{ height:"100%", width:`${Math.min(100,m.total/max*100)}%`, background:"linear-gradient(90deg,#DC2626,#D97706)", borderRadius:3 }} /></div>
        </div>
      ));
    } else if (d.type==="burn" && d.month) {
      const txns = exp.filter(i=>i.date?.startsWith(d.month));
      title = `Burn — ${d.monthLabel||d.month}`; subtitle = `${txns.length} transactions · ${fmt(txns.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(txns, "#DC2626");
    } else if (d.type==="runway") {
      const tdy=new Date();
      const mk=k=>new Date(tdy.getFullYear(),tdy.getMonth()-k,1).toISOString().slice(0,7);
      const burns=[0,1,2].map(k=>exp.filter(i=>i.date?.startsWith(mk(k))).reduce((s,i)=>s+i.amount,0)).filter(b=>b>0);
      const avgBurn=burns.length?burns.reduce((s,b)=>s+b,0)/burns.length:0;
      const openingCash=openingBalances.filter(b=>b.account_code==="1000"||b.account_code==="1010").reduce((s,b)=>s+(parseFloat(b.balance)||0),0);
      const cashIn=rev.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").reduce((s,i)=>s+i.amount,0);
      const cashOut=exp.filter(i=>i.payment_status==="paid").reduce((s,i)=>s+i.amount,0);
      const cash=openingCash+cashIn-cashOut;
      const runway=avgBurn>0?Math.floor(cash/avgBurn):null;
      title="Runway"; subtitle="How long your cash lasts at the current burn rate";
      body=(<div style={{ padding:"18px 20px" }}>
        <div style={{ fontSize:30, fontWeight:700, fontFamily:"'DM Mono',monospace", color: runway===null?"#6B7280":runway<6?"#DC2626":runway<=12?"#D97706":"#059669", marginBottom:14 }}>{runway===null?"∞":`${runway} months`}</div>
        {[["Estimated cash on hand", fmt(cash)],["Average monthly burn (3-mo)", fmt(avgBurn)],["Runway = cash ÷ avg burn", runway===null?"—":`${fmt(cash)} ÷ ${fmt(avgBurn)} ≈ ${runway} mo`]].map(([k,v])=>(
          <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"1px solid #F3F4F6", fontSize:13 }}><span style={{ color:"#6B7280" }}>{k}</span><span style={{ fontFamily:"'DM Mono',monospace" }}>{v}</span></div>
        ))}
        <div style={{ marginTop:14, display:"flex", gap:10 }}>
          <button onClick={()=>setDashDrill({type:"burn"})} style={{ padding:"8px 14px", borderRadius:9, fontSize:12, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>See burn breakdown →</button>
          <button onClick={()=>setView("opening-balances")} style={{ padding:"8px 14px", borderRadius:9, fontSize:12, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", cursor:"pointer" }}>Update cash balance</button>
        </div>
      </div>);
    } else if (d.type==="ap") {
      title = "Open accounts payable"; subtitle = `${openAP.length} unpaid · ${fmt(openAP.reduce((s,i)=>s+i.amount,0))}`;
      const methodOpts = [["ach","ACH / Bank Transfer"],["check","Check"],["wire","Wire Transfer"],["card","Credit Card"],["zelle","Zelle"],["venmo","Venmo"],["paypal","PayPal"],["other","Other"]];
      body = openAP.length===0
        ? <div style={{ padding:"28px 18px", fontSize:13, color:"#6B7280", textAlign:"center" }}>Nothing outstanding — you're all paid up.</div>
        : [...openAP].sort((a,b)=>(a.due_date||a.date||"9999").localeCompare(b.due_date||b.date||"9999")).map(inv=>(
            <div key={inv.id} style={{ borderTop:"1px solid #F3F4F6" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"11px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0, cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>
                  <span style={{ fontSize:11, color:"#6B7280", fontFamily:"'DM Mono',monospace", width:80, flexShrink:0 }}>{inv.date||"—"}</span>
                  <span style={{ width:28, height:28, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500, color:"#111827", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"—"}</div>
                    <div style={{ fontSize:11, color:"#6B7280" }}>{inv.gl_code} {inv.gl_name}</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
                  <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#DC2626", width:96, textAlign:"right" }}>{fmt(inv.amount)}</span>
                  {apPayId!==inv.id && <button onClick={()=>{ setApPayId(inv.id); setApPayMethod("ach"); setApPayDate(new Date().toISOString().slice(0,10)); }} style={{ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600, background:"#ECFDF5", border:"1px solid #05966944", color:"#059669", cursor:"pointer", whiteSpace:"nowrap" }}>Mark Paid</button>}
                </div>
              </div>
              {apPayId===inv.id && (
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", padding:"0 18px 12px 110px" }}>
                  <input type="date" value={apPayDate} onChange={e=>setApPayDate(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#111827", outline:"none" }} />
                  <select value={apPayMethod} onChange={e=>setApPayMethod(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#111827", outline:"none" }}>
                    {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={()=>{ markPaid(inv.id, apPayMethod, { date: apPayDate }); setApPayId(null); }} style={{ padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"#059669", border:"none", color:"#fff", cursor:"pointer" }}>Confirm</button>
                  <button onClick={()=>setApPayId(null)} style={{ padding:"6px 12px", borderRadius:7, fontSize:12, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", cursor:"pointer" }}>Cancel</button>
                </div>
              )}
            </div>
          ));
    } else if (d.type==="ar") {
      title = "Open accounts receivable"; subtitle = `${openAR.length} uncollected · ${fmt(openAR.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(openAR, "#059669");
    }

    return (
      <div className="sc-rise">
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
          <button onClick={()=>setDashDrill(back)} style={{ padding:"7px 14px", borderRadius:9, fontSize:13, fontWeight:600, background:"#FFFFFF", border:"1px solid #D1D5DB", color:"#374151", cursor:"pointer", boxShadow:"0 1px 3px rgba(0,0,0,.08)" }}>← Back</button>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:13 }}>
            {crumbs.map((c,i)=>(
              <span key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span onClick={()=>setDashDrill(c.to)} style={{ cursor:"pointer", color: i===crumbs.length-1?"#111827":"#6B7280", fontWeight: i===crumbs.length-1?600:400 }}>{c.label}</span>
                {i<crumbs.length-1 && <span style={{ color:"#9CA3AF" }}>›</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, overflow:"hidden" }}>
          <div style={{ padding:"16px 18px", borderBottom:"1px solid #F3F4F6" }}>
            <div style={{ fontSize:15, fontWeight:600 }}>{title}</div>
            <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>{subtitle}</div>
          </div>
          {body}
        </div>
      </div>
    );
  }

  return (
            <div>
              {/* ── UNIVERSAL UPLOAD ZONE ── */}
              <div
                onDragOver={e=>{e.preventDefault();setUniversalDragOver(true);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setUniversalDragOver(false);}}
                onDrop={e=>{e.preventDefault();setUniversalDragOver(false);handleUniversalUpload(e.dataTransfer.files);}}
                onClick={()=>document.getElementById("universal-upload").click()}
                style={{
                  border:`2px dashed ${universalDragOver?"#4F46E5":"#D1D5DB"}`,
                  borderRadius:16, padding:"52px 32px", textAlign:"center", cursor:"pointer",
                  background:universalDragOver?"#F3F4F6":"#FFFFFF", transition:"all 0.18s",
                  boxShadow:universalDragOver?"0 0 48px rgba(200,184,255,0.10)":"none",
                  marginBottom:20,
                }}>
                <input id="universal-upload" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleUniversalUpload(e.target.files)} />
                <div style={{ fontSize:44, marginBottom:14, opacity: universalDragOver ? 1 : 0.5, transition:"opacity 0.18s" }}>⬆</div>
                <div style={{ fontSize:20, fontWeight:700, color:"#111827", marginBottom:6, letterSpacing:-0.3 }}>
                  {universalDragOver ? "Release to upload" : "Drop anything here"}
                </div>
                <div style={{ fontSize:14, color:"#6B7280", marginBottom:14 }}>
                  invoices, receipts, bank statements, contracts — AI handles the rest
                </div>
                <div style={{ display:"inline-flex", gap:8, flexWrap:"wrap", justifyContent:"center" }}>
                  {["PDF","JPG","PNG","CSV","XLSX"].map(f=>(
                    <span key={f} style={{ fontSize:10, fontWeight:600, color:"#6B7280", background:"#F3F4F6", border:"1px solid #E5E7EB", borderRadius:6, padding:"3px 9px", letterSpacing:0.5 }}>{f}</span>
                  ))}
                </div>
              </div>

              {/* ── UPLOAD QUEUE ── */}
              {uploadQueue.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"#6B7280", letterSpacing:2 }}>PROCESSING QUEUE</div>
                    {uploadQueue.every(q=>q.status==="done"||q.status==="error") && (
                      <button onClick={()=>setUploadQueue([])} style={{ background:"none", border:"none", color:"#6B7280", fontSize:12, cursor:"pointer", padding:0 }}>Clear ×</button>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {uploadQueue.map(item => {
                      const typeConfig = {
                        invoice:       { icon:"🧾", label:"Invoice",         color:"#4F46E5" },
                        bank_statement:{ icon:"🏦", label:"Bank Statement",  color:"#6366F1" },
                        contract:      { icon:"📋", label:"Contract",        color:"#D97706" },
                        unknown:       { icon:"❓", label:"Unknown",         color:"#DC2626" },
                      };
                      const tc = typeConfig[item.type] || { icon:"📄", label:"Document", color:"#6B7280" };
                      const pendingReview = item.status==="done" && clarificationQueue.some(c => c.queueItemId === item.id);
                      return (
                        <div key={item.id} style={{ background:"#FFFFFF", border:`1px solid ${item.status==="error"?"#DC262633":pendingReview?"#D9770666":item.status==="done"?"#05966933":"#E5E7EB"}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                          {/* File icon */}
                          <div style={{ width:38, height:38, borderRadius:10, background:"#E5E7EB", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                            {item.status==="done" ? tc.icon : item.status==="error" ? "⚠" : "📄"}
                          </div>
                          {/* Info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                            <div style={{ fontSize:11, marginTop:3, color:item.status==="error"?"#DC2626":item.status==="done"?tc.color:"#6B7280" }}>
                              {item.status==="classifying" && "⟳ Identifying document type..."}
                              {item.status==="processing" && `⟳ Processing as ${tc.label}...`}
                              {item.status==="error" && item.error}
                              {item.status==="done" && item.type==="invoice" && item.result && (
                                item.result.invoiceCount > 1
                                  ? `✓ ${item.result.invoiceCount} invoices found · $${item.result.amount?.toLocaleString("en-US",{minimumFractionDigits:2})} total · ${item.result.confidence}% avg confidence`
                                  : `✓ ${item.result.vendor} · $${item.result.amount?.toLocaleString("en-US",{minimumFractionDigits:2})} → ${item.result.gl_name} (${item.result.confidence}%)`
                              )}
                              {item.status==="done" && item.type==="bank_statement" && item.result && (
                                <span onClick={()=>setView("matching")} style={{ cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }} title="Open matching detail">
                                  ✓ Matched {item.result.matchedCount||0} of {item.result.txnCount||0} transactions — ${ (item.result.stillOpenTotal||0).toLocaleString("en-US",{minimumFractionDigits:2}) } in open items still unmatched{item.result.newBooked>0?` · ${item.result.newBooked} new booked`:""}{item.result.needsReview>0?` · ${item.result.needsReview} match${item.result.needsReview!==1?"es":""} to review`:""}
                                </span>
                              )}
                              {item.status==="done" && item.type==="contract" && item.result && `✓ ${tc.label} · ${item.result.counterparty} · ${item.result.entries} journal entries generated`}
                              {item.status==="done" && item.type==="unknown" && item.result && `⚠ ${item.result.document_type||"Unknown"} · ${item.result.entry_needed?"Entry proposed — needs review":"No entry needed — flagged for review"}`}
                            </div>
                          </div>
                          {/* Status pill */}
                          <div style={{ flexShrink:0 }}>
                            {(item.status==="classifying"||item.status==="processing") && (
                              <div style={{ display:"flex", gap:3 }}>
                                {[0,1,2].map(i=><div key={i} style={{ width:5, height:5, borderRadius:"50%", background:"#6B7280", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                              </div>
                            )}
                            {item.status==="done" && pendingReview && (
                              <span onClick={()=>{ document.getElementById("clarification-section")?.scrollIntoView({behavior:"smooth"}); }}
                                style={{ fontSize:11, color:"#D97706", background:"#FEF3C7", border:"1px solid #D9770666", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>
                                ⚠ Needs Review
                              </span>
                            )}
                            {item.status==="done" && !pendingReview && <span style={{ fontSize:11, color:"#059669", background:"#ECFDF5", border:"1px solid #05966933", borderRadius:20, padding:"3px 10px" }}>Done</span>}
                            {item.status==="error" && <span style={{ fontSize:11, color:"#DC2626", background:"#FEF2F2", border:"1px solid #DC262633", borderRadius:20, padding:"3px 10px" }}>Error</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Invoice clarification prompt */}
                  {clarificationQueue.length > 0 && (
                    <div style={{ marginTop:12, background:"#FEF3C7", border:"1px solid #D9770644", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#D97706" }}>⚠ {clarificationQueue.length} invoice{clarificationQueue.length!==1?"s":""} need your input before booking — scroll down to review</div>
                      <button onClick={()=>{ window.scrollTo({top:9999,behavior:"smooth"}); }} style={{ background:"#D9770622", border:"1px solid #D9770644", color:"#D97706", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Below ↓</button>
                    </div>
                  )}
                  {/* Bank reconciliation review prompt — opens the matching detail */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="bank_statement"&&q.result?.needsReview>0) && (
                    <div style={{ marginTop:12, background:"#FEF3C7", border:"1px solid #D9770644", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#D97706" }}>⚠ Some bank transactions need your review before clearing</div>
                      <button onClick={()=>setView("matching")} style={{ background:"#D9770622", border:"1px solid #D9770644", color:"#D97706", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Matches →</button>
                    </div>
                  )}
                  {/* Contract review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="contract") && (
                    <div style={{ marginTop:8, background:"#EEF2FF", border:"1px solid #6366F144", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#6366F1" }}>📋 Contract journal entries ready to post</div>
                      <button onClick={()=>{ setView("contracts"); setContractView("list"); }} style={{ background:"#6366F122", border:"1px solid #6366F144", color:"#6366F1", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Contracts →</button>
                    </div>
                  )}
                  {/* Unknown docs review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="unknown") && (
                    <div style={{ marginTop:8, background:"#FEF2F2", border:"1px solid #DC262633", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#DC2626" }}>❓ Some documents need accountant review</div>
                      <button onClick={()=>setView("review")} style={{ background:"#DC262622", border:"1px solid #DC262633", color:"#DC2626", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Now →</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── AP ACTIONABLE ALERTS ── */}
              {(() => {
                // Open payables: any expense (gl 5xxx/6xxx), not paid, not voided — SAME logic as the drill list.
                const ap = invoices.filter(i => glIsExpense(i.gl_code) && i.status!=="voided");
                const unpaid = ap.filter(i => i.payment_status!=="paid");
                const openAR = invoices.filter(i=>glIsRevenue(i.gl_code)&&i.payment_status!=="collected"&&i.status!=="voided");
                if (unpaid.length===0 && openAR.length===0) return null;
                const today = new Date().toISOString().slice(0,10);
                const total = unpaid.reduce((s,i)=>s+i.amount,0);
                const overdue = unpaid.filter(i=>i.due_date && i.due_date<today);
                const arTotal = openAR.reduce((s,i)=>s+i.amount,0);
                return (
                  <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
                    {unpaid.length>0 && (
                      <div onClick={()=>setDashDrill({type:"ap"})} style={{ flex:"1 1 280px", cursor:"pointer", background:"#FFFFFF", border:"1px solid #E5E7EB", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color .2s" }} onMouseEnter={e=>e.currentTarget.style.borderColor="#4F46E5"} onMouseLeave={e=>e.currentTarget.style.borderColor="#E5E7EB"}>
                        <div><div style={{ fontSize:13, fontWeight:600, color:"#111827" }}>🧾 {unpaid.length} unpaid bill{unpaid.length!==1?"s":""} · ${total.toLocaleString("en-US",{maximumFractionDigits:0})} payable</div><div style={{ fontSize:11, color:"#6B7280", marginTop:3 }}>{overdue.length>0?`⚠ ${overdue.length} overdue · `:""}Drill into open payables</div></div>
                        <span style={{ fontSize:12, color:"#4F46E5", fontWeight:600 }}>Open AP →</span>
                      </div>
                    )}
                    {openAR.length>0 && (
                      <div onClick={()=>setDashDrill({type:"ar"})} style={{ flex:"1 1 280px", cursor:"pointer", background:"#FFFFFF", border:"1px solid #E5E7EB", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color .2s" }} onMouseEnter={e=>e.currentTarget.style.borderColor="#059669"} onMouseLeave={e=>e.currentTarget.style.borderColor="#E5E7EB"}>
                        <div><div style={{ fontSize:13, fontWeight:600, color:"#111827" }}>💰 {openAR.length} open receivable{openAR.length!==1?"s":""} · ${arTotal.toLocaleString("en-US",{maximumFractionDigits:0})} due in</div><div style={{ fontSize:11, color:"#6B7280", marginTop:3 }}>Drill into money owed to you</div></div>
                        <span style={{ fontSize:12, color:"#059669", fontWeight:600 }}>Open AR →</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── CLARIFICATION QUEUE ── */}
              {clarificationQueue.length > 0 && (
                <div id="clarification-section" style={{ marginBottom:24, background:"#FEF3C7", border:"2px solid #D97706", borderRadius:16, padding:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                    <span style={{ fontSize:20 }}>⚠</span>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, color:"#D97706" }}>{clarificationQueue.length} Invoice{clarificationQueue.length>1?"s":""} Need Your Review</div>
                      <div style={{ fontSize:12, color:"#6B7280", marginTop:2 }}>These items cannot be booked until you review them. Click a category below to confirm or reject each one.</div>
                    </div>
                  </div>
                  {clarificationQueue.map(item => (
                    <div key={item.id} style={{ background: item.isDuplicate ? "#FEF2F2" : "#FEF3C7", border: `1px solid ${item.isDuplicate ? "#DC262644" : "#D9770644"}`, borderRadius:14, padding:20, marginBottom:12 }}>
                      {item.isDuplicate ? (
                        /* ── DUPLICATE WARNING CARD ── */
                        <>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                            <div>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                                <span style={{ fontSize:16, lineHeight:1 }}>⚠</span>
                                <div style={{ fontSize:15, fontWeight:700, color:"#DC2626" }}>Possible Duplicate Invoice</div>
                              </div>
                              <div style={{ fontSize:13, color:"#6B7280", lineHeight:1.5 }}>{item.question}</div>
                            </div>
                            <div style={{ fontSize:11, color:"#DC2626", background:"#DC262622", borderRadius:20, padding:"3px 10px", flexShrink:0, marginLeft:12, whiteSpace:"nowrap" }}>
                              Duplicate
                            </div>
                          </div>
                          <div style={{ background:"#F3F4F6", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
                            <div style={{ fontSize:11, color:"#6B7280", marginBottom:6, letterSpacing:1 }}>NEW — ABOUT TO BOOK:</div>
                            <div style={{ fontSize:13, color:"#111827" }}>
                              {item.invoice.vendor} · <span style={{ fontFamily:"'DM Mono',monospace" }}>${item.invoice.amount.toFixed(2)}</span> · {item.invoice.date}
                              {item.invoice.invoice_number && <span style={{ color:"#6B7280" }}> · #{item.invoice.invoice_number}</span>}
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={() => {
                              logAudit("invoice_rejected", `Rejected (duplicate): ${item.invoice.vendor} · $${(item.invoice.amount||0).toFixed(2)} on ${item.invoice.date} — already booked`, item.invoice, null);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification("Duplicate rejected ✓");
                            }} style={{ fontSize:12, padding:"7px 16px", borderRadius:8, background:"#FEF2F2", border:"1px solid #DC262666", color:"#DC2626", cursor:"pointer", fontWeight:600 }}>
                              ✕ Reject — already booked
                            </button>
                            <button onClick={() => {
                              const finalInv = {...item.invoice, confidence:100, status:"booked"};
                              logAudit("invoice_booked", `${finalInv.vendor} · $${(finalInv.amount||0).toFixed(2)} → ${finalInv.gl_name} (confirmed — different charge)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                              setInvoices(prev => [finalInv, ...prev]);
                              bookToDb(finalInv);
                              if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type==="revenue"?"customer":"vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification(`Booked to ${item.invoice.gl_name} ✓`);
                            }} style={{ fontSize:12, padding:"7px 16px", borderRadius:8, background:"transparent", border:"1px solid #D1D5DB", color:"#6B7280", cursor:"pointer" }}>
                              Book anyway (different charge)
                            </button>
                          </div>
                        </>
                      ) : (
                        /* ── NORMAL GL CLARIFICATION CARD ── */
                        <>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                            <div>
                              <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>{item.invoice.vendor} — ${item.invoice.amount.toFixed(2)}</div>
                              <div style={{ fontSize:13, color:"#6B7280" }}>{item.question}</div>
                            </div>
                            <div style={{ fontSize:11, color:"#D97706", background:"#D9770622", borderRadius:20, padding:"3px 10px", flexShrink:0, marginLeft:12 }}>
                              {Math.round(item.invoice.confidence)}% confident
                            </div>
                          </div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                            {item.options.map(opt => (
                              <button key={opt.code}
                                onClick={() => {
                                  const finalInv = {...item.invoice, gl_code: opt.code, gl_name: opt.name, confidence: 100, status:"booked", ...(opt.typeOverride || {})};
                                  logAudit("invoice_booked", `${finalInv.vendor} · $${(finalInv.amount||0).toFixed(2)} → ${opt.name} (user confirmed)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: opt.code, gl_name: opt.name });
                                  setInvoices(prev => [finalInv, ...prev]);
                                  bookToDb(finalInv);
                              if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type==="revenue"?"customer":"vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                                  setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                                  showNotification(`Booked to ${opt.name} ✓`);
                                }}
                                style={{
                                  padding:"8px 16px", borderRadius:20, fontSize:12, cursor:"pointer",
                                  background: opt.code === item.suggestedCode ? "#4338CA" : "#E5E7EB",
                                  border: `1px solid ${opt.code === item.suggestedCode ? "#6366F1" : "#D1D5DB"}`,
                                  color: opt.code === item.suggestedCode ? "#4F46E5" : "#6B7280",
                                  fontWeight: opt.code === item.suggestedCode ? 600 : 400,
                                }}>
                                {opt.code === item.suggestedCode ? "★ " : ""}{opt.name}
                              </button>
                            ))}
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={() => {
                              const finalInv = {...item.invoice, confidence:100, status:"booked"};
                              logAudit("invoice_booked", `${finalInv.vendor} · $${(finalInv.amount||0).toFixed(2)} → ${finalInv.gl_name} (user confirmed)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                              setInvoices(prev => [finalInv, ...prev]);
                              bookToDb(finalInv);
                              if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, type: finalInv.type==="revenue"?"customer":"vendor", gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification(`Booked to ${item.invoice.gl_name} ✓`);
                            }} style={{ fontSize:12, padding:"6px 14px", borderRadius:8, background:"#D1FAE5", border:"1px solid #05966944", color:"#059669", cursor:"pointer" }}>
                              ✓ Use suggested: {item.suggestedName}
                            </button>
                            <button onClick={() => {
                              logAudit("invoice_rejected", `Rejected: ${item.invoice.vendor} · $${(item.invoice.amount||0).toFixed(2)} on ${item.invoice.date} — not relevant or not approved`, item.invoice, null);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification("Invoice rejected ✓");
                            }} style={{ fontSize:12, padding:"6px 14px", borderRadius:8, background:"#FEF2F2", border:"1px solid #DC262633", color:"#DC2626", cursor:"pointer" }}>
                              ✕ Reject
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── BANK MATCH REMINDER ── */}
              {(() => {
                const completed = (reconciliations||[]).filter(r=>r.status==="complete").sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at)));
                const last = completed[0];
                const days = last?.completed_at ? Math.floor((Date.now()-new Date(last.completed_at).getTime())/86400000) : null;
                const hasBooks = invoices.some(i=>i.status!=="voided");
                const overdue = hasBooks && (days===null || days>35);
                if (!overdue) return null;
                return (
                  <div onClick={()=>setView("home")} style={{ ...{}, cursor:"pointer", background:"#FFFBEB", border:"1px solid #D9770644", borderRadius:14, padding:"16px 20px", marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#D97706"} onMouseLeave={e=>e.currentTarget.style.borderColor="#D9770644"}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:"#92400E" }}>⚠ {days===null ? "Your books haven't been matched to your bank yet." : `Your books haven't been matched to your bank in ${days} days.`}</div>
                      <div style={{ fontSize:12, color:"#92400E", opacity:0.8, marginTop:3 }}>Upload your latest bank statement above — we'll match it and mark paid items automatically.</div>
                    </div>
                    <span style={{ fontSize:13, color:"#D97706", fontWeight:600 }}>Upload statement →</span>
                  </div>
                );
              })()}

              {/* ── KEY NUMBERS ── */}
              {(() => {
                const tdy = new Date();
                const cm = tdy.toISOString().slice(0,7);
                const burnThisMonth = invoices.filter(i=>glIsExpense(i.gl_code)&&i.date?.startsWith(cm)&&i.status!=="voided").reduce((s,i)=>s+i.amount,0);
                const mk = k => new Date(tdy.getFullYear(),tdy.getMonth()-k,1).toISOString().slice(0,7);
                const burns=[0,1,2].map(k=>invoices.filter(i=>glIsExpense(i.gl_code)&&i.date?.startsWith(mk(k))).reduce((s,i)=>s+i.amount,0)).filter(b=>b>0);
                const avgBurn = burns.length? burns.reduce((s,b)=>s+b,0)/burns.length : burnThisMonth;
                const openingCash = openingBalances.filter(b=>b.account_code==="1000"||b.account_code==="1010").reduce((s,b)=>s+(parseFloat(b.balance)||0),0);
                const cashIn = invoices.filter(i=>glIsRevenue(i.gl_code)&&(i.payment_status==="collected"||i.payment_status==="paid")).reduce((s,i)=>s+i.amount,0);
                const cashOut = invoices.filter(i=>glIsExpense(i.gl_code)&&i.payment_status==="paid").reduce((s,i)=>s+i.amount,0);
                const estimatedCash = openingCash + cashIn - cashOut;
                const runway = avgBurn>0 ? Math.floor(estimatedCash/avgBurn) : null;
                const runwayColor = runway===null?"#6B7280":runway<6?"#DC2626":runway<=12?"#D97706":"#059669";
                const ytdNet = invoices.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0) - invoices.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                const fmt0 = n => "$"+Math.round(Math.abs(n)).toLocaleString("en-US");
                const cards = [
                  { label:"CASH BALANCE", value:(estimatedCash<0?"-":"")+fmt0(estimatedCash), color:estimatedCash>=0?"#111827":"#DC2626", sub:"Cash on hand", drill:{type:"cash"} },
                  { label:"MONTHLY BURN", value:fmt0(burnThisMonth), color:"#DC2626", sub:"Expenses this month", drill:{type:"burn"} },
                  { label:"RUNWAY", value: runway===null?"∞":`${runway} mo`, color:runwayColor, sub: runway===null?"Add cash to calculate":runway<6?"Less than 6 months":runway<=12?"6–12 months":"Healthy", drill:{type:"runway"} },
                  { label:"NET INCOME (YTD)", value:(ytdNet<0?"-":"")+fmt0(ytdNet), color:ytdNet>=0?"#059669":"#DC2626", sub:"Revenue − expenses", drill:{type:"net"} },
                ];
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:14, marginBottom:24 }}>
                    {cards.map(c=>(
                      <div key={c.label} onClick={()=>setDashDrill(c.drill)} className="sc-card"
                        style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, padding:"20px 22px", cursor:"pointer" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                          <div style={{ fontSize:11, color:"#6B7280", letterSpacing:1 }}>{c.label}</div>
                          <span style={{ fontSize:13, color:"#4F46E5", fontWeight:600 }}>›</span>
                        </div>
                        <div style={{ fontSize:26, fontWeight:700, color:c.color, fontFamily:"'DM Mono',monospace" }}>{c.value}</div>
                        <div style={{ fontSize:11, color:"#6B7280", marginTop:6 }}>{c.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── ACTIVE COMMITMENTS (contracts / leases) ── */}
              {(() => {
                const active = (contracts||[]).filter(c => c.end_date ? new Date(c.end_date) >= new Date() : true);
                if (active.length===0) return null;
                const monthly = active.reduce((s,c)=>s+(c.payment_amount||0),0);
                const monthsLeft = (c) => { if(!c.end_date) return null; const d=Math.ceil((new Date(c.end_date)-new Date())/(86400000*30)); return d>0?d:0; };
                return (
                  <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, marginBottom:24, overflow:"hidden" }}>
                    <div onClick={()=>setShowCommit(s=>!s)} style={{ padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:"#111827" }}>📋 {active.length} active {active.length===1?"commitment":"commitments"} · ${monthly.toLocaleString("en-US",{maximumFractionDigits:0})}/mo total</div>
                        <div style={{ fontSize:11, color:"#6B7280", marginTop:3 }}>Leases &amp; recurring contracts (ASC 842)</div>
                      </div>
                      <span style={{ fontSize:12, color:"#4F46E5", fontWeight:600 }}>{showCommit?"Hide":"Show"} {showCommit?"▲":"▼"}</span>
                    </div>
                    {showCommit && (
                      <div style={{ borderTop:"1px solid #F3F4F6" }}>
                        {active.map((c,i)=>{
                          const ml = monthsLeft(c);
                          return (
                            <div key={c.id||i} onClick={()=>{ setSelectedContract(c); setContractView("detail"); setView("contracts"); }}
                              onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 20px", borderTop: i?"1px solid #F3F4F6":"none", cursor:"pointer" }}>
                              <div style={{ minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:500, color:"#111827" }}>{c.counterparty||"Contract"}</div>
                                <div style={{ fontSize:11, color:"#6B7280" }}>{c.contract_type||"contract"}{ml!=null?` · ${ml} mo remaining`:""}</div>
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#DC2626" }}>${(c.payment_amount||0).toLocaleString("en-US",{maximumFractionDigits:0})}/mo</span>
                                <span style={{ color:"#9CA3AF" }}>›</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── ACTIVITY FEED ── */}
              {(() => {
                const items = [];
                invoices.forEach(inv => items.push({ ts: inv.booked_at||inv.date||"", inv, icon: glIsRevenue(inv.gl_code)?"💰":"🧾", text:`${inv.vendor||"Entry"} — ${inv.gl_name||"Booked"}`, amount: inv.amount, rev: glIsRevenue(inv.gl_code) }));
                (auditLog||[]).forEach(a => { if (/paid|approv|reject|recode|void|flag|info_requested/i.test(a.action||"")) items.push({ ts:a.ts||a.created_at||"", icon: /paid/i.test(a.action)?"✅":/reject|void/i.test(a.action)?"🚫":/flag|info/i.test(a.action)?"⚠":"✦", text:a.detail||a.action }); });
                items.sort((x,y)=>String(y.ts).localeCompare(String(x.ts)));
                const ago = ts => { if(!ts) return ""; const s=(Date.now()-new Date(ts).getTime())/1000; if(s<60)return "just now"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago"; if(s<604800)return Math.floor(s/86400)+"d ago"; return new Date(ts).toLocaleDateString(); };
                const shown = items.slice(0, feedCount);
                return (
                  <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, overflow:"hidden" }}>
                    <div style={{ padding:"16px 20px", borderBottom:"1px solid #F3F4F6", fontSize:13, fontWeight:600 }}>Activity</div>
                    {shown.length===0 ? <div style={{ padding:"36px", textAlign:"center", color:"#6B7280", fontSize:13 }}>Nothing yet — drop a document above to get started.</div> :
                      shown.map((it,idx)=>(
                        <div key={idx} onClick={()=>{ if(it.inv){ setSelectedInvoice(it.inv); setView("detail"); } }}
                          onMouseEnter={e=>{ if(it.inv) e.currentTarget.style.background="#F9FAFB"; }} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                          style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 20px", borderTop: idx?"1px solid #F3F4F6":"none", cursor: it.inv?"pointer":"default" }}>
                          <div style={{ width:32, height:32, borderRadius:9, background:"#F3F4F6", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, flexShrink:0 }}>{it.icon}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, color:"#111827", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{it.text}</div>
                            <div style={{ fontSize:11, color:"#6B7280" }}>{ago(it.ts)}</div>
                          </div>
                          {it.amount!=null && <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color: it.rev?"#059669":"#DC2626", flexShrink:0 }}>{it.rev?"+":"-"}${Math.abs(it.amount).toLocaleString("en-US",{minimumFractionDigits:2})}</div>}
                        </div>
                      ))
                    }
                    {items.length > feedCount && (
                      <div style={{ padding:"12px", textAlign:"center", borderTop:"1px solid #F3F4F6" }}>
                        <button onClick={()=>setFeedCount(c=>c+20)} style={{ background:"none", border:"none", color:"#4F46E5", fontSize:13, fontWeight:600, cursor:"pointer" }}>Load more</button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
  );
}
