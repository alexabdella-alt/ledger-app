import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { nextUrgentDeadline, taxEstimate } from "../../lib/tax";
import { financialHealthScore, computeNetIncome, computeRevenue, computeExpenses, computeBurnRate, computeRunway, computeAR, computeAP, glAccountBalance } from "../../lib/reports";
import ClarificationFlow from "../ClarificationFlow";

export default function DashboardView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyGaapAnswer, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, glCash, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, glDrilldown, setGlDrilldown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, reconciliations, recurring, recurringNewRec, recurringSuggestions, acceptRecurringSuggestion, dismissRecurringSuggestion, anomalies, dismissAnomaly, onboardingUploadDone, businessModalOpen, setBusinessModalOpen, saveBusinessProfile, accountantDismissed, dismissAccountantStep, completeOnboarding, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setReturnTo, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  const [burnModalOpen, setBurnModalOpen] = React.useState(false);
  const [burnDrill, setBurnDrill] = React.useState({ cat:null, vendor:null }); // expense drill-down path
  const [dashDrill, setDashDrill] = React.useState(null); // unified dashboard drill-down
  const [anomExpanded, setAnomExpanded] = React.useState(false); // anomaly card expand/collapse
  const [bizType, setBizType] = React.useState(""); // business-type modal draft
  const [bizFye, setBizFye] = React.useState("12-31");
  const [accountantNotice, setAccountantNotice] = React.useState(false); // "coming soon" inline message
  const [healthOpen, setHealthOpen] = React.useState(false); // financial health breakdown modal

  // Navigate to a Settings view, then scroll to a specific section once it renders.
  const goToSection = (view, anchorId) => {
    setView(view);
    setTimeout(() => document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  };

  // ── Onboarding step completion (Item 54) ──
  const obHasBiz = !!(companySettings.name && companySettings.businessType);
  // A bank account only counts once the user has added a REAL one — not the
  // "Primary Checking" placeholder seeded at company setup (which has a real DB id
  // but no institution/last4). A renamed account, or one with institution/last4
  // filled in, counts as real.
  const obIsPlaceholderBank = (b) => {
    const nm = (b.name || "").trim().toLowerCase();
    const noDetails = !(b.institution || "").trim() && !(b.last4 || "").trim();
    return nm === "primary checking" && noDetails;
  };
  const obHasBank = (bankAccounts||[]).some(b => b.id && b.id !== "default" && (b.name || "").trim() && !obIsPlaceholderBank(b));
  // Durable across reloads: opening balances post journal entries (source "opening_balance").
  const obHasOpening = (openingBalances||[]).length > 0 || (invoices||[]).some(i => i.source === "opening_balance");
  const obHasUpload = !!onboardingUploadDone;
  const obAllDone = obHasBiz && obHasBank && obHasOpening && obHasUpload;
  // When everything's done, show the success card briefly, then persist completion.
  React.useEffect(() => {
    if (!companySettings.onboardingComplete && obAllDone && completeOnboarding) {
      const t = setTimeout(() => completeOnboarding(), 2500);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obAllDone, companySettings.onboardingComplete]);
  const [feedCount, setFeedCount] = React.useState(20); // activity feed page size
  const [showCommit, setShowCommit] = React.useState(false); // active commitments expander
  const [apPayId, setApPayId] = React.useState(null); // inline "mark paid" row in the AP drill
  const [apPayMethod, setApPayMethod] = React.useState("ach");
  const [apPayDate, setApPayDate] = React.useState(new Date().toISOString().slice(0,10));
  const goReports = () => { setReportType && setReportType("pl"); setView("reports"); };
  const cardHover = (on) => (e) => { e.currentTarget.style.borderColor = on ? "#6366F1" : "#E4E7EC"; e.currentTarget.style.transform = on ? "translateY(-2px)" : "none"; };

  // ── UNIFIED DASHBOARD DRILL-DOWN (breadcrumbed, in-place) ──
  if (dashDrill) {
    const d = dashDrill;
    const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
    const today = new Date();
    const exp = invoices.filter(i => glIsExpense(i.gl_code) && i.status!=="voided");
    const rev = invoices.filter(i => glIsRevenue(i.gl_code) && i.status!=="voided");
    // The Net Income drill is the BREAKDOWN of the dashboard tile's number, so it MUST
    // use the same period boundary as the tile (current fiscal year). exp/rev above are
    // all-time (kept for the trailing-6-month burn chart, which crosses the year start);
    // the revenue/expenses/net DRILLS use these fiscal-year-scoped views so they tie to
    // the tile by construction (was all-time → pulled prior-period expenses).
    const fyYear = today.getFullYear();
    const fyFrom = `${fyYear}-01-01`, fyTo = `${fyYear}-12-31`;
    const inFY = i => i.date && i.date >= fyFrom && i.date <= fyTo;
    const expFY = exp.filter(inFY);
    const revFY = rev.filter(inFY);
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

    const txnRows = (arr, color="#101828") => arr.length===0
      ? <div style={{ padding:"28px 18px", fontSize:13, color:"#475467", textAlign:"center" }}>No transactions here.</div>
      : [...arr].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(inv=>(
          <div key={inv.id} onClick={()=>{ setReturnTo({view:"home",label:"Home"}); setSelectedInvoice(inv); setView("detail"); }}
            onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"11px 18px", cursor:"pointer", borderTop:"1px solid #F3F4F6" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
              <span style={{ fontSize:11, color:"#475467", width:80, flexShrink:0 }}>{fmtDate(inv.date)||"—"}</span>
              <span style={{ width:28, height:28, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</span>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, color:"#101828", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"—"}</div>
                <div style={{ fontSize:11, color:"#475467", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.description||"—"}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"#475467", fontFamily:"monospace", background:"#F3F4F6", padding:"1px 6px", borderRadius:4 }}>{inv.gl_code}</span>
              <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color, width:104, textAlign:"right" }}>{fmt(inv.amount)}</span>
            </div>
          </div>
        ));

    const clickableRow = (key, left, right, onClick) => (
      <div key={key} onClick={onClick} onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"13px 18px", cursor:"pointer", borderTop:"1px solid #F3F4F6" }}>
        {left}
        <span style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>{right}<span style={{ color:"#98A2B3" }}>›</span></span>
      </div>
    );

    let title, subtitle, body;
    if (d.type==="revenue") {
      title = "Revenue transactions"; subtitle = `${revFY.length} entr${revFY.length!==1?"ies":"y"} · ${fmt(revFY.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(revFY, "#039855");
    } else if (d.type==="expenses" && !d.cat) {
      const cats = Object.values(expFY.reduce((a,i)=>{const k=i.gl_name||"Uncoded"; if(!a[k])a[k]={name:k,total:0,count:0}; a[k].total+=i.amount; a[k].count++; return a;},{})).sort((x,y)=>y.total-x.total);
      title = "Expenses by category"; subtitle = `${cats.length} categories · ${fmt(expFY.reduce((s,i)=>s+i.amount,0))}`;
      body = cats.length===0 ? <div style={{ padding:"28px 18px", fontSize:13, color:"#475467", textAlign:"center" }}>No expenses yet.</div> :
        cats.map(c=>clickableRow(c.name,
          <span style={{ fontSize:13, color:"#374151" }}>{c.name} <span style={{ fontSize:11, color:"#98A2B3" }}>· {c.count}</span></span>,
          <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>{fmt(c.total)}</span>,
          ()=>setDashDrill({type:"expenses",cat:c.name})));
    } else if (d.type==="expenses" && d.cat && !d.vendor) {
      const inCat = expFY.filter(i=>(i.gl_name||"Uncoded")===d.cat);
      const vends = Object.values(inCat.reduce((a,i)=>{const v=i.vendor||"Unknown"; if(!a[v])a[v]={vendor:v,total:0,count:0}; a[v].total+=i.amount; a[v].count++; return a;},{})).sort((x,y)=>y.total-x.total);
      title = `${d.cat} — by vendor`; subtitle = `${vends.length} vendors · ${fmt(inCat.reduce((s,i)=>s+i.amount,0))}`;
      body = vends.map(v=>clickableRow(v.vendor,
        <span style={{ fontSize:13, color:"#374151", display:"flex", alignItems:"center", gap:9 }}><span style={{ width:24, height:24, borderRadius:6, background:vendorColor(v.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(v.vendor)}</span>{v.vendor} <span style={{ fontSize:11, color:"#98A2B3" }}>· {v.count}</span></span>,
        <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>{fmt(v.total)}</span>,
        ()=>setDashDrill({type:"expenses",cat:d.cat,vendor:v.vendor})));
    } else if (d.type==="expenses" && d.vendor) {
      const txns = expFY.filter(i=>(i.gl_name||"Uncoded")===d.cat && (i.vendor||"Unknown")===d.vendor);
      title = `${d.vendor} — ${d.cat}`; subtitle = `${txns.length} transactions · ${fmt(txns.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(txns, "#D92D20");
    } else if (d.type==="net") {
      // SAME source/period as the Net Income (YTD) tile (computeNetIncome over the FY
      // range) → the breakdown ties to the tile by construction, not a parallel sum.
      const r = computeRevenue(invoices, { from: fyFrom, to: fyTo });
      const e = computeExpenses(invoices, { from: fyFrom, to: fyTo });
      title = "Net income"; subtitle = `Profit & loss summary · ${fyYear}`;
      body = (<div style={{ padding:"8px 0" }}>
        {clickableRow("rev", <span style={{ fontSize:14, color:"#374151" }}>Total Revenue</span>, <span style={{ fontSize:14, fontFamily:"'DM Mono',monospace", color:"#039855" }}>{fmt(r)}</span>, ()=>setDashDrill({type:"revenue"}))}
        {clickableRow("exp", <span style={{ fontSize:14, color:"#374151" }}>Total Expenses</span>, <span style={{ fontSize:14, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>({fmt(e)})</span>, ()=>setDashDrill({type:"expenses"}))}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 18px", borderTop:"2px solid #E4E7EC", marginTop:4 }}>
          <span style={{ fontSize:16, fontWeight:700 }}>Net {r-e>=0?"Income":"Loss"}</span>
          <span style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:r-e>=0?"#039855":"#D92D20" }}>{r-e<0?"-":""}{fmt(r-e)}</span>
        </div>
        <div style={{ padding:"12px 18px" }}><button onClick={goReports} style={{ padding:"8px 16px", borderRadius:9, fontSize:12, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>Open full P&amp;L report →</button></div>
      </div>);
    } else if (d.type==="cash") {
      const cashTxns = invoices.filter(i => (i.source==="bank_feed" || i.payment_status==="paid" || i.payment_status==="collected") && i.status!=="voided");
      title = "Cash & bank"; subtitle = `${(bankAccounts||[]).length} account${(bankAccounts||[]).length!==1?"s":""} · ${cashTxns.length} cash transactions`;
      body = (<div>
        <div style={{ padding:"12px 18px", display:"flex", gap:10, flexWrap:"wrap" }}>
          {(bankAccounts||[]).length===0 ? <span style={{ fontSize:13, color:"#475467" }}>No bank accounts yet — add one in Settings.</span> :
            (bankAccounts||[]).map((b,i)=>(
              <div key={b.id||i} onClick={()=>setView("settings")} style={{ cursor:"pointer", border:"1px solid #E4E7EC", borderRadius:10, padding:"10px 14px", background:"#F9FAFB" }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{b.name||"Account"}</div>
                <div style={{ fontSize:11, color:"#475467" }}>{b.type||"bank"} · Settings ›</div>
              </div>
            ))}
        </div>
        <div style={{ fontSize:10, letterSpacing:1.5, color:"#475467", padding:"6px 18px", borderTop:"1px solid #F3F4F6" }}>RECENT CASH TRANSACTIONS</div>
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
            <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>{fmt(m.total)} ›</span>
          </div>
          <div style={{ height:5, background:"#F3F4F6", borderRadius:3 }}><div style={{ height:"100%", width:`${Math.min(100,m.total/max*100)}%`, background:"linear-gradient(90deg,#D92D20,#DC6803)", borderRadius:3 }} /></div>
        </div>
      ));
    } else if (d.type==="burn" && d.month) {
      const txns = exp.filter(i=>i.date?.startsWith(d.month));
      title = `Burn — ${d.monthLabel||d.month}`; subtitle = `${txns.length} transactions · ${fmt(txns.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(txns, "#D92D20");
    } else if (d.type==="runway") {
      const tdy=new Date();
      const mk=k=>new Date(tdy.getFullYear(),tdy.getMonth()-k,1).toISOString().slice(0,7);
      const burns=[0,1,2].map(k=>exp.filter(i=>i.date?.startsWith(mk(k))).reduce((s,i)=>s+i.amount,0)).filter(b=>b>0);
      const avgBurn=burns.length?burns.reduce((s,b)=>s+b,0)/burns.length:0;
      const cash=glCash;   // GL cash on hand — the one canonical source (no ad-hoc cash math)
      const runway=avgBurn>0?Math.floor(cash/avgBurn):null;
      title="Runway"; subtitle="How long your cash lasts at the current burn rate";
      body=(<div style={{ padding:"18px 20px" }}>
        <div style={{ fontSize:30, fontWeight:700, fontFamily:"'DM Mono',monospace", color: runway===null?"#475467":runway<6?"#D92D20":runway<=12?"#DC6803":"#039855", marginBottom:14 }}>{runway===null?"∞":`${runway} months`}</div>
        {[["Estimated cash on hand", fmt(cash)],["Average monthly burn (3-mo)", fmt(avgBurn)],["Runway = cash ÷ avg burn", runway===null?"—":`${fmt(cash)} ÷ ${fmt(avgBurn)} ≈ ${runway} mo`]].map(([k,v])=>(
          <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"1px solid #F3F4F6", fontSize:13 }}><span style={{ color:"#475467" }}>{k}</span><span style={{ fontFamily:"'DM Mono',monospace" }}>{v}</span></div>
        ))}
        <div style={{ marginTop:14, display:"flex", gap:10 }}>
          <button onClick={()=>setDashDrill({type:"burn"})} style={{ padding:"8px 14px", borderRadius:9, fontSize:12, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>See burn breakdown →</button>
          <button onClick={()=>setView("opening-balances")} style={{ padding:"8px 14px", borderRadius:9, fontSize:12, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", cursor:"pointer" }}>Update cash balance</button>
        </div>
      </div>);
    } else if (d.type==="ap") {
      title = "Open accounts payable"; subtitle = `${openAP.length} unpaid · ${fmt(openAP.reduce((s,i)=>s+i.amount,0))}`;
      const methodOpts = [["ach","ACH / Bank Transfer"],["check","Check"],["wire","Wire Transfer"],["card","Credit Card"],["zelle","Zelle"],["venmo","Venmo"],["paypal","PayPal"],["other","Other"]];
      body = openAP.length===0
        ? <div style={{ padding:"28px 18px", fontSize:13, color:"#475467", textAlign:"center" }}>Nothing outstanding — you're all paid up.</div>
        : [...openAP].sort((a,b)=>(a.due_date||a.date||"9999").localeCompare(b.due_date||b.date||"9999")).map(inv=>(
            <div key={inv.id} style={{ borderTop:"1px solid #F3F4F6" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"11px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0, cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"home",label:"Home"}); setSelectedInvoice(inv); setView("detail"); }}>
                  <span style={{ fontSize:11, color:"#475467", width:80, flexShrink:0 }}>{fmtDate(inv.date)||"—"}</span>
                  <span style={{ width:28, height:28, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500, color:"#101828", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"—"}</div>
                    <div style={{ fontSize:11, color:"#475467" }}>{inv.gl_code} {inv.gl_name}</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
                  <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20", width:96, textAlign:"right" }}>{fmt(inv.amount)}</span>
                  {apPayId!==inv.id && <button onClick={()=>{ setApPayId(inv.id); setApPayMethod("ach"); setApPayDate(new Date().toISOString().slice(0,10)); }} style={{ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600, background:"#ECFDF5", border:"1px solid #03985544", color:"#039855", cursor:"pointer", whiteSpace:"nowrap" }}>Mark Paid</button>}
                </div>
              </div>
              {apPayId===inv.id && (
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", padding:"0 18px 12px 110px" }}>
                  <input type="date" value={apPayDate} onChange={e=>setApPayDate(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#101828", outline:"none" }} />
                  <select value={apPayMethod} onChange={e=>setApPayMethod(e.target.value)} style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:7, padding:"6px 9px", fontSize:12, color:"#101828", outline:"none" }}>
                    {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={()=>{ markPaid(inv.id, apPayMethod, { date: apPayDate }); setApPayId(null); }} style={{ padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"#039855", border:"none", color:"#fff", cursor:"pointer" }}>Confirm</button>
                  <button onClick={()=>setApPayId(null)} style={{ padding:"6px 12px", borderRadius:7, fontSize:12, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", cursor:"pointer" }}>Cancel</button>
                </div>
              )}
            </div>
          ));
    } else if (d.type==="ar") {
      title = "Open accounts receivable"; subtitle = `${openAR.length} uncollected · ${fmt(openAR.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(openAR, "#039855");
    }

    return (
      <div className="sc-rise">
        <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:16, flexWrap:"wrap" }}>
          <button onClick={()=>setDashDrill(back)} style={{ padding:"7px 14px", borderRadius:9, fontSize:13, fontWeight:600, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", cursor:"pointer", boxShadow:"0 1px 3px rgba(0,0,0,.08)" }}>← Back</button>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", fontSize:13 }}>
            {crumbs.map((c,i)=>(
              <span key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span onClick={()=>setDashDrill(c.to)} style={{ cursor:"pointer", color: i===crumbs.length-1?"#101828":"#475467", fontWeight: i===crumbs.length-1?600:400 }}>{c.label}</span>
                {i<crumbs.length-1 && <span style={{ color:"#98A2B3" }}>›</span>}
              </span>
            ))}
          </div>
        </div>
        <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"hidden" }}>
          <div style={{ padding:"16px 18px", borderBottom:"1px solid #F3F4F6" }}>
            <div style={{ fontSize:15, fontWeight:600 }}>{title}</div>
            <div style={{ fontSize:12, color:"#475467", marginTop:2 }}>{subtitle}</div>
          </div>
          {body}
        </div>
      </div>
    );
  }

  return (
            <div>
              {/* ── ONBOARDING CHECKLIST (Item 54) ── */}
              {!companySettings.onboardingComplete && (() => {
                const steps = [
                  { key:"biz",     done: obHasBiz,     label:"Tell us about your business", hint:"Business type & fiscal year", go:()=>setBusinessModalOpen(true) },
                  { key:"bank",    done: obHasBank,    label:"Add your bank account",       hint:"Settings → Bank Accounts",   go:()=>goToSection("settings","bank-accounts-section") },
                  { key:"opening", done: obHasOpening, label:"Set your opening balances",   hint:"Settings → Opening Balances", go:()=>goToSection("opening-balances","opening-balances-section") },
                  { key:"upload",  done: obHasUpload,  label:"Upload your first document",  hint:"Drag a doc onto the zone below", go:()=>document.getElementById("universal-upload")?.scrollIntoView({behavior:"smooth"}) },
                ];
                const optional = { key:"accountant", done: false, label:"Connect with your accountant", hint:"Optional", go:()=>{ setAccountantNotice(true); dismissAccountantStep(); }, optional:true };
                const required = steps.filter(s=>s.done).length;
                if (obAllDone) {
                  // The effect above persists onboarding_complete after a short delay.
                  return (
                    <div style={{ background:"#ECFDF5", border:"1px solid #A6F4C5", borderRadius:14, padding:"18px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ width:30, height:30, borderRadius:"50%", background:"#039855", color:"#fff", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>✓</span>
                      <div style={{ fontSize:14, fontWeight:600, color:"#101828" }}>You're all set! Your books are ready.</div>
                    </div>
                  );
                }
                const renderStep = (s) => (
                  <div key={s.key} onClick={()=>{ if(!s.done) s.go && s.go(); }} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderTop:"1px solid #F3F4F6", cursor:s.done?"default":"pointer" }}>
                    <span style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, background:s.done?"#039855":"#FFFFFF", color:s.done?"#fff":"#98A2B3", border:s.done?"none":"2px solid #D0D5DD" }}>{s.done?"✓":""}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13.5, fontWeight:500, color:s.done?"#98A2B3":"#101828", textDecoration:s.done?"line-through":"none" }}>{s.label}{s.optional?" (optional)":""}</div>
                      <div style={{ fontSize:11.5, color:"#98A2B3", marginTop:1 }}>{s.hint}</div>
                    </div>
                    {!s.done && <span style={{ fontSize:13, color:"#4F46E5", fontWeight:600 }}>{s.optional?"Dismiss":"Set up →"}</span>}
                  </div>
                );
                return (
                  <div style={{ background:"#FFFFFF", border:"1px solid #C7D2FE", borderRadius:16, padding:"20px 22px", marginBottom:20 }}>
                    <div style={{ fontSize:17, fontWeight:700, color:"#101828" }}>Welcome to Shadow CFO — let's get your books set up</div>
                    <div style={{ fontSize:13, color:"#475467", marginTop:3, marginBottom:6 }}>{required} of {steps.length} done. Knock these out and you're ready to roll.</div>
                    {steps.map(renderStep)}
                    {(accountantNotice || accountantDismissed) ? (
                      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderTop:"1px solid #F3F4F6" }}>
                        <span style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, background:"#EEF2FF", color:"#4F46E5" }}>✦</span>
                        <div style={{ fontSize:12.5, color:"#475467", lineHeight:1.4 }}>Team invites are coming soon — we'll notify you when this feature is available.</div>
                      </div>
                    ) : renderStep(optional)}
                  </div>
                );
              })()}

              {/* ── BUSINESS-TYPE MODAL (Item 54.5) — portaled to body to escape the
                   .sc-rise transform's containing-block trap ── */}
              {businessModalOpen && createPortal((
                <div onClick={()=>setBusinessModalOpen(false)} style={{ position:"fixed", inset:0, zIndex:1002, background:"rgba(16,24,40,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
                  <div onClick={e=>e.stopPropagation()} style={{ background:"#FFFFFF", borderRadius:16, width:420, maxWidth:"100%", boxShadow:"0 20px 60px rgba(16,24,40,0.25)", overflow:"hidden" }}>
                    <div style={{ padding:"18px 22px", borderBottom:"1px solid #F3F4F6", fontSize:16, fontWeight:700, color:"#101828" }}>Tell us about your business</div>
                    <div style={{ padding:"20px 22px" }}>
                      <label style={{ fontSize:12, fontWeight:600, color:"#475467", display:"block", marginBottom:6 }}>Business type</label>
                      <select value={bizType||companySettings.businessType||""} onChange={e=>setBizType(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid #D0D5DD", fontSize:14, color:"#101828", background:"#fff", marginBottom:16 }}>
                        <option value="">Select…</option>
                        {["SaaS/Software","Consulting/Services","Restaurant/Food","Retail","Construction","Healthcare","Real Estate","Other"].map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <label style={{ fontSize:12, fontWeight:600, color:"#475467", display:"block", marginBottom:6 }}>Fiscal year end</label>
                      <select value={bizFye||companySettings.fiscalYearEnd||"12-31"} onChange={e=>setBizFye(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid #D0D5DD", fontSize:14, color:"#101828", background:"#fff" }}>
                        <option value="12-31">December 31</option>
                        <option value="03-31">March 31</option>
                        <option value="06-30">June 30</option>
                        <option value="09-30">September 30</option>
                      </select>
                    </div>
                    <div style={{ padding:"0 22px 20px", display:"flex", gap:10, justifyContent:"flex-end" }}>
                      <button onClick={()=>setBusinessModalOpen(false)} style={{ padding:"9px 16px", borderRadius:9, fontSize:13, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer" }}>Cancel</button>
                      <button onClick={()=>saveBusinessProfile({ businessType: bizType||companySettings.businessType||"Other", fiscalYearEnd: bizFye||companySettings.fiscalYearEnd||"12-31" })}
                        disabled={!(bizType||companySettings.businessType)}
                        style={{ padding:"9px 18px", borderRadius:9, fontSize:13, fontWeight:600, color:"#fff", background:(bizType||companySettings.businessType)?"#4F46E5":"#C7D2FE", border:"none", cursor:(bizType||companySettings.businessType)?"pointer":"default" }}>Save</button>
                    </div>
                  </div>
                </div>
              ), document.body)}

              {/* ── UNIVERSAL UPLOAD ZONE ── */}
              <style>{`
                .sc-dropzone{ transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
                .sc-dropzone:hover{ border-color:#4F46E5 !important; background:#FAFAFF !important; box-shadow:0 0 0 4px rgba(79,70,229,0.07), 0 10px 30px rgba(79,70,229,0.10) !important; }
                .sc-dropzone:hover .sc-dropzone-icon{ opacity:1 !important; transform:translateY(-3px); }
                .sc-dropzone .sc-dropzone-icon{ transition: opacity .18s ease, transform .18s ease; }
                @keyframes scDropPulse{0%,100%{box-shadow:0 0 0 4px rgba(79,70,229,0.10),0 10px 32px rgba(79,70,229,0.16)}50%{box-shadow:0 0 0 9px rgba(79,70,229,0.05),0 10px 36px rgba(79,70,229,0.24)}}
                .sc-dropzone.dragging{ animation:scDropPulse 1.3s ease-in-out infinite; }
              `}</style>
              <div
                id="universal-upload-zone"
                className={`sc-dropzone${universalDragOver?" dragging":""}`}
                onDragOver={e=>{e.preventDefault();setUniversalDragOver(true);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setUniversalDragOver(false);}}
                onDrop={e=>{e.preventDefault();setUniversalDragOver(false);handleUniversalUpload(e.dataTransfer.files);}}
                onClick={()=>document.getElementById("universal-upload").click()}
                style={{
                  border:`2px dashed ${universalDragOver?"#4F46E5":"#D0D5DD"}`,
                  borderRadius:16, padding:"64px 32px", textAlign:"center", cursor:"pointer",
                  background:universalDragOver?"#FAFAFF":"#FFFFFF",
                  marginBottom:20,
                }}>
                <input id="universal-upload" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleUniversalUpload(e.target.files)} />
                <div className="sc-dropzone-icon" style={{ width:64, height:64, margin:"0 auto 18px", borderRadius:18, background:universalDragOver?"#4F46E5":"#EEF2FF", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, color:universalDragOver?"#fff":"#4F46E5", opacity: universalDragOver?1:0.92 }}>⬆</div>
                <div style={{ fontSize:22, fontWeight:700, color:"#101828", marginBottom:8, letterSpacing:-0.4 }}>
                  {universalDragOver ? "Release to upload" : "Drop anything here"}
                </div>
                <div style={{ fontSize:14, color:"#667085", marginBottom:18, lineHeight:1.5 }}>
                  Invoices, receipts, bank statements, contracts — your AI controller handles the rest
                </div>
                <div style={{ display:"inline-flex", gap:8, flexWrap:"wrap", justifyContent:"center" }}>
                  {["PDF","JPG","PNG","CSV","XLSX"].map(f=>(
                    <span key={f} style={{ fontSize:10, fontWeight:600, color:"#667085", background:"#F2F4F7", border:"1px solid #E4E7EC", borderRadius:6, padding:"3px 9px", letterSpacing:0.5 }}>{f}</span>
                  ))}
                </div>
              </div>

              {/* ── RECURRING SUGGESTIONS (detected monthly patterns) ── */}
              {Array.isArray(recurringSuggestions) && recurringSuggestions.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:11, color:"#475467", letterSpacing:2, marginBottom:12 }}>RECURRING SUGGESTIONS</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {recurringSuggestions.map(s => {
                      const m = n => "$" + (Number(n)||0).toLocaleString("en-US", { minimumFractionDigits:2 });
                      const range = Math.abs((s.maxAmount||0)-(s.minAmount||0)) < 0.5 ? m(s.avgAmount) : `${m(s.minAmount)}–${m(s.maxAmount)}`;
                      return (
                        <div key={s.id} style={{ background:"#FFFFFF", border:"1px solid #C7D2FE", borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", gap:14 }}>
                          <div style={{ width:34, height:34, borderRadius:9, background:"linear-gradient(135deg,#6366F1,#4338CA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"#fff", flexShrink:0 }}>↻</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13.5, color:"#101828", lineHeight:1.5 }}>
                              I noticed <strong>{s.vendor}</strong> has charged you {range} every month for the last {s.count} months. Want me to set up a recurring rule so it's always expected and auto-coded to {s.gl_name || s.gl_code}?
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:8, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
                            <button onClick={()=>acceptRecurringSuggestion(s)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer", whiteSpace:"nowrap" }}>Yes, set it up</button>
                            <button onClick={()=>dismissRecurringSuggestion(s, false)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:500, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer", whiteSpace:"nowrap" }}>No thanks</button>
                            <button onClick={()=>dismissRecurringSuggestion(s, true)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:500, background:"none", border:"none", color:"#98A2B3", cursor:"pointer", whiteSpace:"nowrap" }}>Remind me later</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* ── UPLOAD QUEUE ── */}
              {uploadQueue.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"#475467", letterSpacing:2 }}>PROCESSING QUEUE</div>
                    {uploadQueue.every(q=>q.status==="done"||q.status==="error") && (
                      <button onClick={()=>setUploadQueue([])} style={{ background:"none", border:"none", color:"#475467", fontSize:12, cursor:"pointer", padding:0 }}>Clear ×</button>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {uploadQueue.map(item => {
                      const typeConfig = {
                        invoice:       { icon:"🧾", label:"Invoice",         color:"#4F46E5" },
                        bank_statement:{ icon:"🏦", label:"Bank Statement",  color:"#6366F1" },
                        contract:      { icon:"📋", label:"Contract",        color:"#DC6803" },
                        unknown:       { icon:"❓", label:"Unknown",         color:"#D92D20" },
                      };
                      const tc = typeConfig[item.type] || { icon:"📄", label:"Document", color:"#475467" };
                      const pendingReview = item.status==="done" && clarificationQueue.some(c => c.queueItemId === item.id && !c.resolved);
                      return (
                        <div key={item.id} style={{ background:"#FFFFFF", border:`1px solid ${item.status==="error"?"#D92D2033":pendingReview?"#DC680366":item.status==="done"?"#03985533":"#E4E7EC"}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                          {/* File icon */}
                          <div style={{ width:38, height:38, borderRadius:10, background:"#E4E7EC", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                            {item.status==="done" ? tc.icon : item.status==="error" ? "⚠" : "📄"}
                          </div>
                          {/* Info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                            <div style={{ fontSize:11, marginTop:3, color:item.status==="error"?"#D92D20":item.status==="done"?tc.color:"#475467" }}>
                              {item.status==="classifying" && "⟳ Identifying document type..."}
                              {item.status==="processing" && `⟳ Processing as ${tc.label}...`}
                              {item.status==="error" && item.error}
                              {item.status==="done" && item.type==="invoice" && item.result && (() => {
                                const r = item.result;
                                const money = n => `$${(Number(n)||0).toLocaleString("en-US",{minimumFractionDigits:2})}`;
                                // Nothing booked at upload time, only items needing review.
                                if (!(r.invoiceCount > 0) && r.needsClarification > 0) {
                                  // Once the clarification has been answered & booked, flip to ✓ Booked.
                                  if (!pendingReview)
                                    return `✓ Booked${r.reviewVendor ? `: ${r.reviewVendor}` : ""}${r.reviewAmount!=null ? ` · ${money(r.reviewAmount)}` : ""}`;
                                  return `⚠ Needs your input · ${r.reviewVendor || "this entry"}${r.reviewAmount!=null ? ` · ${money(r.reviewAmount)}` : ""}${r.needsClarification > 1 ? ` (+${r.needsClarification-1} more)` : ""}`;
                                }
                                let txt = r.invoiceCount === 1
                                  ? `✓ Booked: ${r.vendor || "entry"} · ${money(r.amount)}${r.gl_name ? ` → ${r.gl_name}` : ""}${r.confidence!=null ? ` (${r.confidence}% confidence)` : ""}`
                                  : `✓ ${r.invoiceCount} invoices booked · ${money(r.amount)} total${r.confidence!=null ? ` · ${r.confidence}% avg confidence` : ""}`;
                                // Only show the outstanding-review suffix while items are still pending.
                                if (r.needsClarification > 0 && pendingReview) txt += ` · ${r.needsClarification} need${r.needsClarification===1 ? "s" : ""} your review`;
                                return txt;
                              })()}
                              {item.status==="done" && item.type==="bank_statement" && item.result && (
                                <span onClick={()=>setView("matching")} style={{ cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }} title="Open matching detail">
                                  ✓ Matched {item.result.matchedCount||0} of {item.result.txnCount||0} transactions — ${ (item.result.stillOpenTotal||0).toLocaleString("en-US",{minimumFractionDigits:2}) } in open items still unmatched{item.result.newBooked>0?` · ${item.result.newBooked} new booked`:""}{item.result.needsReview>0?` · ${item.result.needsReview} match${item.result.needsReview!==1?"es":""} to review`:""}
                                </span>
                              )}
                              {item.status==="done" && item.type==="contract" && item.result && `✓ ${tc.label} · ${item.result.counterparty} · ${item.result.entries} journal entries generated`}
                              {item.status==="done" && item.type==="unknown" && item.result && `⚠ ${item.result.document_type||"Unknown"} · ${item.result.entry_needed?"Entry proposed — needs review":"No entry needed — flagged for review"}`}
                              {item.docError && (
                                <div style={{ marginTop:5, fontSize:11, color:"#D92D20", background:"#FEF2F2", border:"1px solid #D92D2033", borderRadius:7, padding:"6px 9px", lineHeight:1.45, whiteSpace:"normal" }}>
                                  ⚠ Document not saved to cloud: {item.docError}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Status pill */}
                          <div style={{ flexShrink:0 }}>
                            {(item.status==="classifying"||item.status==="processing") && (
                              <div style={{ display:"flex", gap:3 }}>
                                {[0,1,2].map(i=><div key={i} style={{ width:5, height:5, borderRadius:"50%", background:"#475467", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                              </div>
                            )}
                            {item.status==="done" && pendingReview && (
                              <span onClick={()=>{ document.getElementById("clarification-section")?.scrollIntoView({behavior:"smooth"}); }}
                                style={{ fontSize:11, color:"#DC6803", background:"#FEF3C7", border:"1px solid #DC680366", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>
                                ⚠ Needs Review
                              </span>
                            )}
                            {item.status==="done" && !pendingReview && <span style={{ fontSize:11, color:"#039855", background:"#ECFDF5", border:"1px solid #03985533", borderRadius:20, padding:"3px 10px" }}>Done</span>}
                            {item.status==="error" && <span style={{ fontSize:11, color:"#D92D20", background:"#FEF2F2", border:"1px solid #D92D2033", borderRadius:20, padding:"3px 10px" }}>Error</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Invoice clarification prompt */}
                  {clarificationQueue.filter(c=>!c.resolved).length > 0 && (
                    <div style={{ marginTop:12, background:"#FEF3C7", border:"1px solid #DC680344", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#DC6803" }}>⚠ {clarificationQueue.filter(c=>!c.resolved).length} invoice{clarificationQueue.filter(c=>!c.resolved).length!==1?"s":""} need your input before booking — scroll down to review</div>
                      <button onClick={()=>{ window.scrollTo({top:9999,behavior:"smooth"}); }} style={{ background:"#DC680322", border:"1px solid #DC680344", color:"#DC6803", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Below ↓</button>
                    </div>
                  )}
                  {/* Bank reconciliation review prompt — opens the matching detail */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="bank_statement"&&q.result?.needsReview>0) && (
                    <div style={{ marginTop:12, background:"#FEF3C7", border:"1px solid #DC680344", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#DC6803" }}>⚠ Some bank transactions need your review before clearing</div>
                      <button onClick={()=>setView("matching")} style={{ background:"#DC680322", border:"1px solid #DC680344", color:"#DC6803", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Matches →</button>
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
                    <div style={{ marginTop:8, background:"#FEF2F2", border:"1px solid #D92D2033", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#D92D20" }}>❓ Some documents need accountant review</div>
                      <button onClick={()=>setView("review")} style={{ background:"#D92D2022", border:"1px solid #D92D2033", color:"#D92D20", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Now →</button>
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
                // AP total = the canonical GL balance of the Accounts Payable account (same
                // source as the Balance Sheet + Payables), so all three reconcile.
                const total = glAccountBalance(getAccountByRole("accounts_payable")?.code, invoices);
                const overdue = unpaid.filter(i=>i.due_date && i.due_date<today);
                const arTotal = glAccountBalance(getAccountByRole("accounts_receivable")?.code, invoices);   // GL-derived, same source as AP/Balance Sheet
                return (
                  <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
                    {unpaid.length>0 && (
                      <div onClick={()=>setDashDrill({type:"ap"})} style={{ flex:"1 1 280px", cursor:"pointer", background:"#FFFFFF", border:"1px solid #E4E7EC", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color .2s" }} onMouseEnter={e=>e.currentTarget.style.borderColor="#4F46E5"} onMouseLeave={e=>e.currentTarget.style.borderColor="#E4E7EC"}>
                        <div><div style={{ fontSize:13, fontWeight:600, color:"#101828" }}>🧾 {unpaid.length} unpaid bill{unpaid.length!==1?"s":""} · ${total.toLocaleString("en-US",{maximumFractionDigits:0})} payable</div><div style={{ fontSize:11, color:"#475467", marginTop:3 }}>{overdue.length>0?`⚠ ${overdue.length} overdue · `:""}Drill into open payables</div></div>
                        <span style={{ fontSize:12, color:"#4F46E5", fontWeight:600 }}>Open AP →</span>
                      </div>
                    )}
                    {openAR.length>0 && (
                      <div onClick={()=>setDashDrill({type:"ar"})} style={{ flex:"1 1 280px", cursor:"pointer", background:"#FFFFFF", border:"1px solid #E4E7EC", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color .2s" }} onMouseEnter={e=>e.currentTarget.style.borderColor="#039855"} onMouseLeave={e=>e.currentTarget.style.borderColor="#E4E7EC"}>
                        <div><div style={{ fontSize:13, fontWeight:600, color:"#101828" }}>💰 {openAR.length} open receivable{openAR.length!==1?"s":""} · ${arTotal.toLocaleString("en-US",{maximumFractionDigits:0})} due in</div><div style={{ fontSize:11, color:"#475467", marginTop:3 }}>Drill into money owed to you</div></div>
                        <span style={{ fontSize:12, color:"#039855", fontWeight:600 }}>Open AR →</span>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── CLARIFICATION QUEUE (conversational flow) ── */}
              <ClarificationFlow />

              {/* ── TAX DEADLINE ALERT (impossible to miss) ── */}
              {(() => {
                const dl = nextUrgentDeadline(new Date(), 30);
                if (!dl) return null;
                const est = taxEstimate(invoices, new Date().getFullYear());
                const amt = dl.est && est.total > 0 ? ` — estimated amount $${Math.round(est.quarterly).toLocaleString("en-US")}` : "";
                const urgent = dl.days<=14;
                const bg = urgent?"#FEF3F2":"#FFFAEB";
                return (
                  <div onClick={()=>setView("tax")} style={{ cursor:"pointer", background:bg, border:`1px solid ${dl.color}40`, borderLeft:`4px solid ${dl.color}`, borderRadius:12, padding:"18px 20px", marginBottom:16, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", boxShadow:`0 1px 3px ${dl.color}14` }}
                    onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 4px 14px ${dl.color}22`;}} onMouseLeave={e=>{e.currentTarget.style.boxShadow=`0 1px 3px ${dl.color}14`;}}>
                    <div style={{ width:42, height:42, borderRadius:11, background:dl.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:"#fff", flexShrink:0 }}>⚠</div>
                    <div style={{ flex:"1 1 280px", minWidth:0 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:dl.color, letterSpacing:-0.2 }}>{dl.plain} {dl.days===0?"due today":`in ${dl.days} day${dl.days!==1?"s":""}`}{amt}</div>
                      <div style={{ fontSize:12.5, color:"#667085", marginTop:4 }}>Pay or file at <a href={dl.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ color:dl.color, fontWeight:600 }}>{dl.est?"irs.gov/payments":"irs.gov"} ↗</a> · click for your full tax picture</div>
                    </div>
                    <span style={{ fontSize:13, color:"#fff", fontWeight:600, background:dl.color, borderRadius:8, padding:"8px 14px", whiteSpace:"nowrap" }}>Open Taxes →</span>
                  </div>
                );
              })()}

              {/* ── BANK MATCH REMINDER ── */}
              {(() => {
                const completed = (reconciliations||[]).filter(r=>r.status==="complete").sort((a,b)=>String(b.completed_at).localeCompare(String(a.completed_at)));
                const last = completed[0];
                const days = last?.completed_at ? Math.floor((Date.now()-new Date(last.completed_at).getTime())/86400000) : null;
                const hasBooks = invoices.some(i=>i.status!=="voided");
                const overdue = hasBooks && (days===null || days>35);
                if (!overdue) return null;
                return (
                  <div onClick={()=>setView("home")} style={{ ...{}, cursor:"pointer", background:"#FFFBEB", border:"1px solid #DC680344", borderRadius:14, padding:"16px 20px", marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="#DC6803"} onMouseLeave={e=>e.currentTarget.style.borderColor="#DC680344"}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:"#92400E" }}>⚠ {days===null ? "Your books haven't been matched to your bank yet." : `Your books haven't been matched to your bank in ${days} days.`}</div>
                      <div style={{ fontSize:12, color:"#92400E", opacity:0.8, marginTop:3 }}>Upload your latest bank statement above — we'll match it and mark paid items automatically.</div>
                    </div>
                    <span style={{ fontSize:13, color:"#DC6803", fontWeight:600 }}>Upload statement →</span>
                  </div>
                );
              })()}

              {/* ── KEY NUMBERS ── */}
              {(() => {
                const tdy = new Date();
                const cm = tdy.toISOString().slice(0,7);
                const today = tdy.toISOString().slice(0,10);
                const year = String(tdy.getFullYear());
                // Canonical figures (reports.js) — identical to P&L, monthly report, and the AI.
                const burnThisMonth = computeBurnRate(invoices, { asOf: `${cm}-31`, months: 1 });
                const avgBurn = computeBurnRate(invoices, { asOf: today });          // trailing 3-mo
                const cash = glCash;      // GL cash on hand — same source as the Balance Sheet cash line
                const runwayExact = computeRunway(cash, avgBurn);
                const runway = runwayExact === null ? null : Math.floor(runwayExact);
                const runwayColor = runway===null?"#475467":runway<6?"#D92D20":runway<=12?"#DC6803":"#039855";
                const ytdNet = computeNetIncome(invoices, { from: `${year}-01-01`, to: `${year}-12-31` });
                const fmt0 = n => "$"+Math.round(Math.abs(n)).toLocaleString("en-US");
                const cards = [
                  { label:"CASH BALANCE", value:(cash<0?"-":"")+fmt0(cash), color:cash>=0?"#101828":"#D92D20", sub:"Cash on hand", drill:{type:"cash"} },
                  { label:"MONTHLY BURN", value:fmt0(burnThisMonth), color:"#D92D20", sub:"Expenses this month", drill:{type:"burn"} },
                  { label:"RUNWAY", value: runway===null?"∞":`${runway} mo`, color:runwayColor, sub: runway===null?"Add cash to calculate":runway<6?"Less than 6 months":runway<=12?"6–12 months":"Healthy", drill:{type:"runway"} },
                  { label:"NET INCOME (YTD)", value:(ytdNet<0?"-":"")+fmt0(ytdNet), color:ytdNet>=0?"#039855":"#D92D20", sub:`Revenue − expenses · ${year}`, drill:{type:"net"} },
                ];
                return (
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:16, marginBottom:24 }}>
                    {cards.map(c=>(
                      <div key={c.label} onClick={()=>setDashDrill(c.drill)} className="sc-card"
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="#D0D5DD"; e.currentTarget.style.transform="translateY(-1px)";}}
                        onMouseLeave={e=>{e.currentTarget.style.borderColor="#E4E7EC"; e.currentTarget.style.transform="translateY(0)";}}
                        style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:12, padding:"22px 24px", cursor:"pointer", transition:"border-color 0.12s, transform 0.12s" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
                          <div style={{ fontSize:12, color:"#667085", letterSpacing:0.4, fontWeight:600 }}>{c.label}</div>
                          <span style={{ fontSize:14, color:"#98A2B3", fontWeight:600 }}>›</span>
                        </div>
                        <div style={{ fontSize:32, fontWeight:700, color:c.color, fontFamily:"'DM Mono',monospace", letterSpacing:-1, lineHeight:1.1 }}>{c.value}</div>
                        <div style={{ fontSize:12, color:"#667085", marginTop:8 }}>{c.sub}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── FINANCIAL HEALTH SCORE (Item 63) — below the metric cards ── */}
              {invoices.length > 0 && (() => {
                const h = financialHealthScore({ invoices, cashBalance: glCash, reconciliations, anomalies, onboardingComplete: companySettings.onboardingComplete });
                const ring = `conic-gradient(${h.color} ${h.score * 3.6}deg, #EEF0F4 0deg)`;
                return (
                  <div style={{ marginBottom:24 }}>
                    <div onClick={()=>setHealthOpen(o=>!o)} className="sc-card"
                      onMouseEnter={e=>e.currentTarget.style.borderColor="#D0D5DD"} onMouseLeave={e=>e.currentTarget.style.borderColor="#E4E7EC"}
                      style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:"18px 22px", cursor:"pointer", display:"flex", alignItems:"center", gap:18, transition:"border-color .12s" }}>
                      <div style={{ width:64, height:64, borderRadius:"50%", background:ring, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                        <div style={{ width:50, height:50, borderRadius:"50%", background:"#FFFFFF", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" }}>
                          <span style={{ fontSize:18, fontWeight:800, color:h.color, fontFamily:"'DM Mono',monospace", lineHeight:1 }}>{h.score}</span>
                          <span style={{ fontSize:9, color:"#98A2B3", fontWeight:700 }}>/ 100</span>
                        </div>
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          <span style={{ fontSize:15, fontWeight:700, color:"#101828" }}>Financial Health</span>
                          <span style={{ fontSize:11, fontWeight:700, color:h.color, background:h.color+"16", border:`1px solid ${h.color}33`, borderRadius:6, padding:"2px 9px" }}>Grade {h.grade} · {h.tier}</span>
                        </div>
                        <div style={{ fontSize:12.5, color:"#475467", marginTop:4, lineHeight:1.5 }}>{h.summary}</div>
                      </div>
                      <span style={{ fontSize:12, color:"#4F46E5", fontWeight:600, flexShrink:0 }}>{healthOpen?"Hide ▲":"Breakdown ▼"}</span>
                    </div>
                    {healthOpen && (
                      <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:"6px 22px 14px", marginTop:8 }}>
                        {h.items.map((it,i)=>(
                          <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderTop:i>0?"1px solid #F3F4F6":"none" }}>
                            <span style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, background:it.met?"#039855":"#FEF3F2", color:it.met?"#fff":"#D92D20", border:it.met?"none":"1px solid #FDA29B" }}>{it.met?"✓":"!"}</span>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ fontSize:13, fontWeight:500, color:"#101828" }}>{it.label}</div>
                              <div style={{ fontSize:11.5, color:"#98A2B3", marginTop:1 }}>{it.detail}</div>
                            </div>
                            <span style={{ fontSize:13, fontWeight:700, fontFamily:"'DM Mono',monospace", color:it.met?"#039855":"#98A2B3", flexShrink:0 }}>{it.met?"+":""}{it.points}<span style={{ color:"#98A2B3", fontWeight:400 }}>/{it.max}</span></span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── ANOMALY DETECTION (Item 32) — below the metric cards ── */}
              {Array.isArray(anomalies) && anomalies.length > 0 && (() => {
                const SEV = { high:{ c:"#D92D20", bg:"#FEF3F2", b:"#FDA29B" }, medium:{ c:"#DC6803", bg:"#FFFAEB", b:"#FEDF89" }, low:{ c:"#2E90FA", bg:"#EFF8FF", b:"#B2DDFF" } };
                const openTxn = (a) => { const inv=(invoices||[]).find(i=>String(i.id)===String((a.invoice_ids||[])[0])); if(inv){ setReturnTo && setReturnTo({view:"home"}); setSelectedInvoice(inv); setView("detail"); } else { setView("books"); } };
                return (
                  <div style={{ background:"#FFFAEB", border:"1px solid #FEDF89", borderRadius:14, marginBottom:24, overflow:"hidden" }}>
                    <div onClick={()=>setAnomExpanded(v=>!v)} style={{ padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                      <div style={{ fontSize:13.5, fontWeight:600, color:"#B54708" }}>⚠ {anomalies.length} unusual {anomalies.length===1?"pattern":"patterns"} detected</div>
                      <span style={{ fontSize:12, color:"#B54708", fontWeight:600 }}>{anomExpanded?"Hide ▲":"Review ▼"}</span>
                    </div>
                    {anomExpanded && (
                      <div style={{ borderTop:"1px solid #FEDF89", background:"#FFFFFF" }}>
                        {anomalies.map(a => {
                          const sev = SEV[a.severity] || SEV.low;
                          return (
                            <div key={a.id} style={{ display:"flex", gap:12, padding:"13px 18px", borderBottom:"1px solid #F3F4F6" }}>
                              <div style={{ width:4, borderRadius:3, background:sev.c, flexShrink:0 }} />
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  <span style={{ fontSize:10, fontWeight:700, letterSpacing:0.5, color:sev.c, background:sev.bg, border:`1px solid ${sev.b}`, borderRadius:6, padding:"1px 7px", textTransform:"uppercase" }}>{a.severity}</span>
                                  <span style={{ fontSize:13, fontWeight:600, color:"#101828" }}>{a.title}</span>
                                </div>
                                <div style={{ fontSize:12, color:"#475467", marginTop:4, lineHeight:1.5 }}>{a.description}</div>
                                <div style={{ display:"flex", gap:14, marginTop:7 }}>
                                  {(a.invoice_ids||[]).length>0 && <button onClick={()=>openTxn(a)} style={{ fontSize:12, fontWeight:600, color:"#4F46E5", background:"none", border:"none", cursor:"pointer", padding:0 }}>View transaction →</button>}
                                  <button onClick={()=>dismissAnomaly(a.id)} style={{ fontSize:12, color:"#98A2B3", background:"none", border:"none", cursor:"pointer", padding:0 }}>Dismiss</button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
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
                  <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, marginBottom:24, overflow:"hidden" }}>
                    <div onClick={()=>setShowCommit(s=>!s)} style={{ padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:"#101828" }}>📋 {active.length} active {active.length===1?"commitment":"commitments"} · ${monthly.toLocaleString("en-US",{maximumFractionDigits:0})}/mo total</div>
                        <div style={{ fontSize:11, color:"#475467", marginTop:3 }}>Leases &amp; recurring contracts (ASC 842)</div>
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
                                <div style={{ fontSize:13, fontWeight:500, color:"#101828" }}>{c.counterparty||"Contract"}</div>
                                <div style={{ fontSize:11, color:"#475467" }}>{c.contract_type||"contract"}{ml!=null?` · ${ml} mo remaining`:""}</div>
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>${(c.payment_amount||0).toLocaleString("en-US",{maximumFractionDigits:0})}/mo</span>
                                <span style={{ color:"#98A2B3" }}>›</span>
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
                const ago = ts => { if(!ts) return ""; const s=(Date.now()-new Date(ts).getTime())/1000; if(s<60)return "just now"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago"; if(s<604800)return Math.floor(s/86400)+"d ago"; return fmtDate(ts); };
                const shown = items.slice(0, feedCount);
                return (
                  <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:12, overflow:"hidden" }}>
                    <div style={{ padding:"16px 24px", borderBottom:"1px solid #EEF0F4", fontSize:14, fontWeight:600, color:"#101828" }}>Activity</div>
                    {shown.length===0 ? <div style={{ padding:"44px", textAlign:"center", color:"#667085", fontSize:13 }}>Nothing yet — drop a document above to get started.</div> :
                      shown.map((it,idx)=>(
                        <div key={idx} onClick={()=>{ if(it.inv){ setReturnTo({view:"home",label:"Home"}); setSelectedInvoice(it.inv); setView("detail"); } }}
                          onMouseEnter={e=>{ if(it.inv) e.currentTarget.style.background="#F9FAFB"; }} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                          style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 24px", borderTop: idx?"1px solid #F2F4F7":"none", cursor: it.inv?"pointer":"default", transition:"background 0.1s" }}>
                          <div style={{ width:36, height:36, borderRadius:10, background: it.amount!=null?(it.rev?"#ECFDF3":"#FEF3F2"):"#F2F4F7", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{it.icon}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13.5, fontWeight:500, color:"#101828", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{it.text}</div>
                            <div style={{ fontSize:12, color:"#98A2B3", marginTop:2 }}>{ago(it.ts)}</div>
                          </div>
                          {it.amount!=null && <div style={{ fontSize:13.5, fontWeight:600, fontFamily:"'DM Mono',monospace", color: it.rev?"#039855":"#D92D20", flexShrink:0 }}>{it.rev?"+":"−"}${Math.abs(it.amount).toLocaleString("en-US",{minimumFractionDigits:2})}</div>}
                        </div>
                      ))
                    }
                    {items.length > feedCount && (
                      <div style={{ padding:"14px", textAlign:"center", borderTop:"1px solid #EEF0F4" }}>
                        <button onClick={()=>setFeedCount(c=>c+20)} style={{ background:"none", border:"none", color:"#4F46E5", fontSize:13, fontWeight:600, cursor:"pointer" }}>Load more</button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
  );
}
