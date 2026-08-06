import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney, fmtApprox, todayLocal, ymdLocal } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { nextUrgentDeadline, taxEstimate } from "../../lib/tax";
import { businessHealth, computeNetIncome, computeRevenue, computeExpenses, computeBurnRate, burnRateDetail, computeRunway, computeAR, computeAP, glAccountBalance, openReceivablesGL, openPayablesGL } from "../../lib/reports";
import { onboardingSteps, onboardingChecklistVisible } from "../../lib/onboarding";
import { statementSummaryCopy } from "../../lib/workbench";
import ClarificationFlow from "../ClarificationFlow";
import TrustPanel from "./TrustPanel";
import { t } from "../../lib/theme";
import { useDrillStack } from "../../lib/useDrillStack";
import DrillNav from "../ui/DrillNav";
import TransactionDetailPanel from "../TransactionDetailPanel";

// Breadcrumb label for a dashboard drill layer (used by the shared onion-nav stack).
const drillLabel = (l) => {
  if (!l) return "";
  if (l.type === "txn") return l.label || "Transaction";
  if (l.type === "expenses") return l.vendor || l.cat || "Expenses";
  if (l.type === "burn") return l.month ? (l.monthLabel || l.month) : "Burn Rate";
  return ({ revenue: "Revenue", net: "Net Income", cash: "Cash & Bank", runway: "Runway", ap: "Accounts Payable", ar: "Accounts Receivable", expenses: "Expenses" })[l.type] || l.type;
};

export default function DashboardView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyGaapAnswer, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, glCash, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, glDrilldown, setGlDrilldown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, reconciliations, bankMatch, recurring, recurringNewRec, recurringSuggestions, acceptRecurringSuggestion, dismissRecurringSuggestion, anomalies, dismissAnomaly, onboardingUploadDone, businessModalOpen, setBusinessModalOpen, saveBusinessProfile, accountantDismissed, dismissAccountantStep, completeOnboarding, companyDataLoaded, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, runDepreciationThrough, depreciationDueInfo, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setReturnTo, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view, navSeat } = useERP();
  // C197 — CPA cockpit vs client seat. Home is the ONE surface both seats share, so
  // every link out of it that lands in the workbench must become plain status text for
  // a client: a button that bounces you straight back is worse than no button at all.
  const cockpit = navSeat ? navSeat.isReviewerSeat : true;
  // THE ONE DOOR from Home into the cockpit. Every workbench destination goes through
  // it, and it simply refuses for a client seat — so a gated link can never fire from
  // the client experience even if a future edit forgets to hide the button. Enforced by
  // grep (tests/iaCollapse.test.js): no direct setView("bank"|"matching"|…) in this file.
  const goCockpit = (viewId, before) => { if (!cockpit) return; if (before) before(); setView(viewId); };
  const [burnModalOpen, setBurnModalOpen] = React.useState(false);
  const [burnDrill, setBurnDrill] = React.useState({ cat:null, vendor:null }); // expense drill-down path
  // Shared onion-layer drill navigation (drillStack) — drilling pushes a layer, Back pops
  // exactly one, Forward re-advances, the breadcrumb jumps to any level. setDashDrill is kept
  // as a thin push/reset shim so every existing "drill here" call site works unchanged.
  const drill = useDrillStack({ rootLabel: "Dashboard", labelOf: drillLabel });
  const setDashDrill = (layer) => { if (layer == null) drill.reset(); else drill.push(layer); };
  const [anomExpanded, setAnomExpanded] = React.useState(false); // anomaly card expand/collapse
  const [bizType, setBizType] = React.useState(""); // business-type modal draft
  const [bizFye, setBizFye] = React.useState("12-31");
  const [accountantNotice, setAccountantNotice] = React.useState(false); // "coming soon" inline message

  // Navigate to a Settings view, then scroll to a specific section once it renders.
  const goToSection = (view, anchorId) => {
    setView(view);
    setTimeout(() => document.getElementById(anchorId)?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
  };

  // ── Onboarding step completion (Item 54) — pure logic in src/lib/onboarding.js ──
  const { obHasBiz, obHasBank, obHasOpening, obHasUpload, obAllDone, requiredDone } =
    onboardingSteps({ companySettings, bankAccounts, openingBalances, invoices, onboardingUploadDone });
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
  const [apPayDate, setApPayDate] = React.useState(todayLocal());
  const goReports = () => { setReportType && setReportType("pl"); setView("reports"); };
  const cardHover = (on) => (e) => { e.currentTarget.style.borderColor = on ? "var(--sc-gold)" : "var(--sc-border)"; e.currentTarget.style.transform = on ? "translateY(-2px)" : "none"; };

  // ── UNIFIED DASHBOARD DRILL-DOWN (shared onion-nav stack, in-place) ──
  if (drill.current) {
    // A transaction is the deepest onion layer; it renders as a slide-in over its PARENT list
    // (so Back pops the txn → the exact list it came from, never home). `d` = the list layer.
    const cur = drill.current;
    const _stack = drill.state.stack;
    const isTxn = cur.type === "txn";
    const d = isTxn ? (_stack[_stack.length - 2] || cur) : cur;
    const fmt = fmtMoney;
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
    // Open payables/receivables: GL-truth — only entries that actually touch the A/P (A/R)
    // account leg and are still unpaid (uncollected), so the drill list matches the card's
    // count/total and ties to glAccountBalance. (Was "any expense/revenue not paid/collected",
    // which pulled in direct-cash entries — e.g. a Stripe payout booked Dr Cash / Cr Revenue —
    // that never created a payable/receivable.)
    const openAP = openPayablesGL(invoices, getAccountByRole?.("accounts_payable")?.code);
    const openAR = openReceivablesGL(invoices, getAccountByRole?.("accounts_receivable")?.code);

    // Breadcrumb + forward/back now come from the shared drill stack (drill.crumbs / drill.canBack…).

    const txnRows = (arr, color="var(--sc-text)") => arr.length===0
      ? <div style={{ padding:"28px 18px", fontSize:13, color:"var(--sc-text-2)", textAlign:"center" }}>No transactions here.</div>
      : [...arr].sort((a,b)=>(b.date||"").localeCompare(a.date||"")).map(inv=>(
          <div key={inv.id} onClick={()=>drill.push({ type:"txn", id: inv.id, label: inv.vendor||"Transaction" })}
            onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
            style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"11px 18px", cursor:"pointer", borderTop:"1px solid var(--sc-surface-2)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
              <span style={{ fontSize:11, color:"var(--sc-text-2)", width:80, flexShrink:0 }}>{fmtDate(inv.date)||"—"}</span>
              <span style={{ width:28, height:28, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(inv.vendor)}</span>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:500, color:"var(--sc-text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"—"}</div>
                <div style={{ fontSize:11, color:"var(--sc-text-2)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.description||"—"}</div>
              </div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
              <span style={{ fontSize:10, color:"var(--sc-text-2)", fontFamily:"monospace", background:"var(--sc-surface-2)", padding:"1px 6px", borderRadius:4 }}>{inv.gl_code}</span>
              <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color, width:104, textAlign:"right" }}>{fmt(inv.amount)}</span>
            </div>
          </div>
        ));

    const clickableRow = (key, left, right, onClick) => (
      <div key={key} onClick={onClick} onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
        style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"13px 18px", cursor:"pointer", borderTop:"1px solid var(--sc-surface-2)" }}>
        {left}
        <span style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>{right}<span style={{ color:"var(--sc-text-mut)" }}>›</span></span>
      </div>
    );

    let title, subtitle, body;
    if (d.type==="revenue") {
      title = "Revenue transactions"; subtitle = `${revFY.length} entr${revFY.length!==1?"ies":"y"} · ${fmt(revFY.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(revFY, "var(--sc-success)");
    } else if (d.type==="expenses" && !d.cat) {
      const cats = Object.values(expFY.reduce((a,i)=>{const k=i.gl_name||"Uncoded"; if(!a[k])a[k]={name:k,total:0,count:0}; a[k].total+=i.amount; a[k].count++; return a;},{})).sort((x,y)=>y.total-x.total);
      title = "Expenses by category"; subtitle = `${cats.length} categories · ${fmt(expFY.reduce((s,i)=>s+i.amount,0))}`;
      body = cats.length===0 ? <div style={{ padding:"28px 18px", fontSize:13, color:"var(--sc-text-2)", textAlign:"center" }}>No expenses yet.</div> :
        cats.map(c=>clickableRow(c.name,
          <span style={{ fontSize:13, color:"var(--sc-text-2)" }}>{c.name} <span style={{ fontSize:11, color:"var(--sc-text-mut)" }}>· {c.count}</span></span>,
          <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)" }}>{fmt(c.total)}</span>,
          ()=>setDashDrill({type:"expenses",cat:c.name})));
    } else if (d.type==="expenses" && d.cat && !d.vendor) {
      const inCat = expFY.filter(i=>(i.gl_name||"Uncoded")===d.cat);
      const vends = Object.values(inCat.reduce((a,i)=>{const v=i.vendor||"Unknown"; if(!a[v])a[v]={vendor:v,total:0,count:0}; a[v].total+=i.amount; a[v].count++; return a;},{})).sort((x,y)=>y.total-x.total);
      title = `${d.cat} — by vendor`; subtitle = `${vends.length} vendors · ${fmt(inCat.reduce((s,i)=>s+i.amount,0))}`;
      body = vends.map(v=>clickableRow(v.vendor,
        <span style={{ fontSize:13, color:"var(--sc-text-2)", display:"flex", alignItems:"center", gap:9 }}><span style={{ width:24, height:24, borderRadius:6, background:vendorColor(v.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"var(--sc-on-accent)" }}>{initials(v.vendor)}</span>{v.vendor} <span style={{ fontSize:11, color:"var(--sc-text-mut)" }}>· {v.count}</span></span>,
        <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)" }}>{fmt(v.total)}</span>,
        ()=>setDashDrill({type:"expenses",cat:d.cat,vendor:v.vendor})));
    } else if (d.type==="expenses" && d.vendor) {
      const txns = expFY.filter(i=>(i.gl_name||"Uncoded")===d.cat && (i.vendor||"Unknown")===d.vendor);
      title = `${d.vendor} — ${d.cat}`; subtitle = `${txns.length} transactions · ${fmt(txns.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(txns, "var(--sc-error)");
    } else if (d.type==="net") {
      // SAME source/period as the Net Income (YTD) tile (computeNetIncome over the FY
      // range) → the breakdown ties to the tile by construction, not a parallel sum.
      const r = computeRevenue(invoices, { from: fyFrom, to: fyTo });
      const e = computeExpenses(invoices, { from: fyFrom, to: fyTo });
      title = "Net income"; subtitle = `Profit & loss summary · ${fyYear}`;
      body = (<div style={{ padding:"8px 0" }}>
        {clickableRow("rev", <span style={{ fontSize:14, color:"var(--sc-text-2)" }}>Total Revenue</span>, <span style={{ fontSize:14, fontFamily:"'DM Mono',monospace", color:"var(--sc-success)" }}>{fmt(r)}</span>, ()=>setDashDrill({type:"revenue"}))}
        {clickableRow("exp", <span style={{ fontSize:14, color:"var(--sc-text-2)" }}>Total Expenses</span>, <span style={{ fontSize:14, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)" }}>({fmt(e)})</span>, ()=>setDashDrill({type:"expenses"}))}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"16px 18px", borderTop:"2px solid var(--sc-border)", marginTop:4 }}>
          <span style={{ fontSize:16, fontWeight:700 }}>Net {r-e>=0?"Income":"Loss"}</span>
          <span style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:r-e>=0?"var(--sc-success)":"var(--sc-error)" }}>{r-e<0?"-":""}{fmt(r-e)}</span>
        </div>
        <div style={{ padding:"12px 18px" }}><button onClick={goReports} style={{ padding:"8px 16px", borderRadius:9, fontSize:12, fontWeight:600, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>Open full P&amp;L report →</button></div>
      </div>);
    } else if (d.type==="cash") {
      const cashTxns = invoices.filter(i => (i.source==="bank_feed" || i.payment_status==="paid" || i.payment_status==="collected") && i.status!=="voided");
      title = "Cash & bank"; subtitle = `${(bankAccounts||[]).length} account${(bankAccounts||[]).length!==1?"s":""} · ${cashTxns.length} cash transactions`;
      body = (<div>
        <div style={{ padding:"12px 18px", display:"flex", gap:10, flexWrap:"wrap" }}>
          {(bankAccounts||[]).length===0 ? <span style={{ fontSize:13, color:"var(--sc-text-2)" }}>No bank accounts yet — add one in Settings.</span> :
            (bankAccounts||[]).map((b,i)=>(
              <div key={b.id||i} onClick={()=>setView("settings")} style={{ cursor:"pointer", border:"1px solid var(--sc-border)", borderRadius:10, padding:"10px 14px", background:"var(--sc-bg)" }}>
                <div style={{ fontSize:13, fontWeight:600 }}>{b.name||"Account"}</div>
                <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{b.type||"bank"} · Settings ›</div>
              </div>
            ))}
        </div>
        <div style={{ fontSize:10, letterSpacing:1.5, color:"var(--sc-text-2)", padding:"6px 18px", borderTop:"1px solid var(--sc-surface-2)" }}>RECENT CASH TRANSACTIONS</div>
        {txnRows(cashTxns.slice(0,40))}
      </div>);
    } else if (d.type==="burn" && !d.month) {
      // Drive the breakdown from the SAME source as the card/runway headline
      // (burnRateDetail): the "counted" months average EXACTLY to the value shown, and
      // the excluded ones (current partial month + one-off spikes) are shown struck-out
      // with the reason — so the list always reconciles to the number above it.
      const detail = burnRateDetail(invoices, { asOf: ymdLocal(today) });
      const mLabel = (key)=>{ const [y,m]=key.split("-").map(Number); return new Date(y,m-1,1).toLocaleDateString("en-US",{month:"long",year:"numeric"}); };
      const curKey = detail.asOfMonth;
      const curTotal = exp.filter(i=>i.date?.startsWith(curKey)).reduce((s,i)=>s+i.amount,0);
      const winKeys = new Set(detail.window.map(w=>w.ym));
      // The counted/dropped window, most-recent first, plus the current partial month.
      const rows = [];
      if (!winKeys.has(curKey)) rows.push({ key:curKey, label:mLabel(curKey), total:curTotal, excluded:true, note:"this month so far — not counted yet" });
      for (const w of [...detail.window].reverse()) rows.push({ key:w.ym, label:mLabel(w.ym), total:w.total, excluded:w.dropped, note:w.dropped?"one-off spike — excluded from the average":"counted in the average" });
      // A few earlier months for trend context (not part of the average).
      for (let cur=detail.window[0]?.ym, n=0; cur && n<3; n++){ const [y,m]=cur.split("-").map(Number); const dd=new Date(y,m-2,1); cur=`${dd.getFullYear()}-${String(dd.getMonth()+1).padStart(2,"0")}`; const t=exp.filter(i=>i.date?.startsWith(cur)).reduce((s,i)=>s+i.amount,0); if(t>0) rows.push({ key:cur, label:mLabel(cur), total:t, excluded:true, note:"earlier — outside the 3-month window" }); }
      const max = Math.max(1,...rows.map(m=>m.total));
      title = "Monthly burn"; subtitle = `Average ${fmt(detail.value)}/mo · trailing ${detail.window.length} complete month${detail.window.length===1?"":"s"} — one-off & current months excluded`;
      body = rows.map(m=>(
        <div key={m.key} onClick={()=>setDashDrill({type:"burn",month:m.key,monthLabel:m.label})} onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
          style={{ padding:"12px 18px", cursor:"pointer", borderTop:"1px solid var(--sc-surface-2)", opacity:m.excluded?0.55:1 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
            <span style={{ fontSize:13, color:"var(--sc-text-2)" }}>{m.label}</span>
            <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)", textDecoration:m.excluded?"line-through":"none" }}>{fmt(m.total)} ›</span>
          </div>
          <div style={{ fontSize:10, color:"var(--sc-text-2)", marginBottom:6 }}>{m.note}</div>
          <div style={{ height:5, background:"var(--sc-surface-2)", borderRadius:3 }}><div className="sc-bar" style={{ height:"100%", width:`${Math.min(100,m.total/max*100)}%`, background:m.excluded?"var(--sc-surface-2)":"linear-gradient(90deg,var(--sc-error),var(--sc-warning))", borderRadius:3 }} /></div>
        </div>
      ));
    } else if (d.type==="burn" && d.month) {
      const txns = exp.filter(i=>i.date?.startsWith(d.month));
      title = `Burn — ${d.monthLabel||d.month}`; subtitle = `${txns.length} transactions · ${fmt(txns.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(txns, "var(--sc-error)");
    } else if (d.type==="runway") {
      // Compute from the SAME canonical source as the card face (computeBurnRate trailing 3-mo
      // over the months that HAVE expense data + computeRunway), so the breakdown ties to the
      // headline. The old inline math averaged a fixed last-3-CALENDAR-month window
      // (e.g. June/May/Apr); when activity sat in an earlier month (a Feb statement viewed in
      // June) that window was empty → avgBurn 0 → the drill showed "∞ / —" while the card
      // showed a real finite runway (same summary-vs-detail divergence as the report drill).
      const today=todayLocal();
      const avgBurn=computeBurnRate(invoices, { asOf: today });   // trailing 3-mo, canonical
      const cash=glCash;   // GL cash on hand — the one canonical source (no ad-hoc cash math)
      const runwayExact=computeRunway(cash, avgBurn);
      const runway=runwayExact===null?null:Math.floor(runwayExact);
      title="Runway"; subtitle="How long your cash lasts at the current burn rate";
      body=(<div style={{ padding:"18px 20px" }}>
        <div style={{ fontSize:30, fontWeight:700, fontFamily:"'DM Mono',monospace", color: runway===null?"var(--sc-text-2)":runway<6?"var(--sc-error)":runway<=12?"var(--sc-warning)":"var(--sc-success)", marginBottom:14 }}>{runway===null?"∞":`${runway} months`}</div>
        {[["Cash on hand", fmt(cash)],["Average monthly burn (trailing 3 complete mo, one-offs excluded)", fmt(avgBurn)],["Runway = cash ÷ monthly burn", runway===null?"—":`${fmt(cash)} ÷ ${fmt(avgBurn)} ≈ ${runway} mo`]].map(([k,v])=>(
          <div key={k} style={{ display:"flex", justifyContent:"space-between", padding:"10px 0", borderTop:"1px solid var(--sc-surface-2)", fontSize:13 }}><span style={{ color:"var(--sc-text-2)" }}>{k}</span><span style={{ fontFamily:"'DM Mono',monospace" }}>{v}</span></div>
        ))}
        <div style={{ marginTop:14, display:"flex", gap:10 }}>
          <button onClick={()=>setDashDrill({type:"burn"})} style={{ padding:"8px 14px", borderRadius:9, fontSize:12, fontWeight:600, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>See burn breakdown →</button>
          <button onClick={()=>setView("opening-balances")} style={{ padding:"8px 14px", borderRadius:9, fontSize:12, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>Update cash balance</button>
        </div>
      </div>);
    } else if (d.type==="ap") {
      title = "Open accounts payable"; subtitle = `${openAP.length} unpaid · ${fmt(openAP.reduce((s,i)=>s+i.amount,0))}`;
      const methodOpts = [["ach","ACH / Bank Transfer"],["check","Check"],["wire","Wire Transfer"],["card","Credit Card"],["zelle","Zelle"],["venmo","Venmo"],["paypal","PayPal"],["other","Other"]];
      body = openAP.length===0
        ? <div style={{ padding:"28px 18px", fontSize:13, color:"var(--sc-text-2)", textAlign:"center" }}>Nothing outstanding — you're all paid up.</div>
        : [...openAP].sort((a,b)=>(a.due_date||a.date||"9999").localeCompare(b.due_date||b.date||"9999")).map(inv=>(
            <div key={inv.id} style={{ borderTop:"1px solid var(--sc-surface-2)" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, padding:"11px 18px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0, cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"home",label:"Home"}); setSelectedInvoice(inv); setView("detail"); }}>
                  <span style={{ fontSize:11, color:"var(--sc-text-2)", width:80, flexShrink:0 }}>{fmtDate(inv.date)||"—"}</span>
                  <span style={{ width:28, height:28, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(inv.vendor)}</span>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500, color:"var(--sc-text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"—"}</div>
                    <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{inv.gl_code} {inv.gl_name}</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
                  <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)", width:96, textAlign:"right" }}>{fmt(inv.amount)}</span>
                  {apPayId!==inv.id && <button onClick={()=>{ setApPayId(inv.id); setApPayMethod("ach"); setApPayDate(todayLocal()); }} style={{ padding:"6px 12px", borderRadius:8, fontSize:12, fontWeight:600, background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", color:"var(--sc-success)", cursor:"pointer", whiteSpace:"nowrap" }}>Mark Paid</button>}
                </div>
              </div>
              {apPayId===inv.id && (
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", padding:"0 18px 12px 110px" }}>
                  <input type="date" value={apPayDate} onChange={e=>setApPayDate(e.target.value)} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:7, padding:"6px 9px", fontSize:12, color:"var(--sc-text)", outline:"none" }} />
                  <select value={apPayMethod} onChange={e=>setApPayMethod(e.target.value)} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:7, padding:"6px 9px", fontSize:12, color:"var(--sc-text)", outline:"none" }}>
                    {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  <button onClick={()=>{ markPaid(inv.id, apPayMethod, { date: apPayDate }); setApPayId(null); }} style={{ padding:"6px 14px", borderRadius:7, fontSize:12, fontWeight:600, background:"var(--sc-success)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>Confirm</button>
                  <button onClick={()=>setApPayId(null)} style={{ padding:"6px 12px", borderRadius:7, fontSize:12, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>Cancel</button>
                </div>
              )}
            </div>
          ));
    } else if (d.type==="ar") {
      title = "Open accounts receivable"; subtitle = `${openAR.length} uncollected · ${fmt(openAR.reduce((s,i)=>s+i.amount,0))}`;
      body = txnRows(openAR, "var(--sc-success)");
    }

    return (
      <div className="sc-rise">
        {/* Shared onion-nav: ‹ back / › forward + breadcrumb, identical to every other drill. */}
        <div style={{ marginBottom:16 }}>
          <DrillNav crumbs={drill.crumbs} canBack={drill.canBack} canForward={drill.canForward}
            onBack={drill.back} onForward={drill.forward} onJump={drill.jumpTo} />
        </div>
        <div className="sc-card" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"hidden" }}>
          <div style={{ padding:"16px 18px", borderBottom:"1px solid var(--sc-surface-2)" }}>
            <div style={{ fontSize:15, fontWeight:600 }}>{title}</div>
            <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2 }}>{subtitle}</div>
          </div>
          {body}
        </div>
        {/* Transaction = the deepest onion layer: a slide-in over its parent list. onClose/onNavigate
            step the SAME stack, so Back returns to the exact list (never home). */}
        {isTxn && (
          <TransactionDetailPanel invoiceId={cur.id} onClose={drill.back}
            onNavigate={(id)=>{ const nx = invoices.find(x=>x.id===id); drill.push({ type:"txn", id, label: nx?.vendor||"Transaction" }); }}
            returnContext={{ view:"home", label:"Dashboard" }} />
        )}
      </div>
    );
  }

  return (
            <div>
              {/* O90 — owner trust panel (CR-27): the owner's at-a-glance "my books are handled
                  and correct," a plain-language projection of the same trust data the CPA reviews.
                  Frame paints INSTANTLY: TrustPanel renders a shimmer skeleton while data loads
                  (never a blank gap, never a false all-clear), then fills in once companyDataLoaded.
                  companyDataLoaded is the safe readiness signal — it guarantees the ledger +
                  reconciliations (the panel's inputs) are loaded, so no green flashes prematurely. */}
              <TrustPanel loading={!companyDataLoaded} />
              {/* Depreciation is deterministic → it AUTO-POSTS when due (App.jsx autoPostDepreciation),
                  no owner nudge. (Removed the "N months due · Run depreciation now" prompt — accounting
                  machinery is Shadow's job, not the owner's; incomplete schedules flag to CPA review.) */}
              {/* ── ONBOARDING CHECKLIST (Item 54) ── */}
              {/* Gate on companyDataLoaded so the checklist never flashes its "0 of 4 done"
                  welcome card on refresh before companySettings/bankAccounts/invoices arrive
                  ("not loaded" ≠ "not done"). Once loaded, an onboarded company has
                  onboardingComplete=true and this stays hidden; a genuinely-new one shows it. */}
              {onboardingChecklistVisible({ companyDataLoaded, onboardingComplete: companySettings.onboardingComplete }) && (() => {
                const steps = [
                  { key:"biz",     done: obHasBiz,     label:"Tell us about your business", hint:"Business type & fiscal year", go:()=>setBusinessModalOpen(true) },
                  { key:"bank",    done: obHasBank,    label:"Add your bank account",       hint:"Settings → Bank Accounts",   go:()=>goToSection("settings","bank-accounts-section") },
                  { key:"opening", done: obHasOpening, label:"Confirm your opening balances",   hint:"We'll pull your starting cash from a bank statement — or set it in Settings", go:()=>goToSection("opening-balances","opening-balances-section") },
                  { key:"upload",  done: obHasUpload,  label:"Upload your first document",  hint:"Drag a doc onto the zone below", go:()=>document.getElementById("universal-upload")?.scrollIntoView({behavior:"smooth"}) },
                ];
                const optional = { key:"accountant", done: false, label:"Connect with your accountant", hint:"Optional", go:()=>{ setAccountantNotice(true); dismissAccountantStep(); }, optional:true };
                const required = requiredDone;
                if (obAllDone) {
                  // The effect above persists onboarding_complete after a short delay.
                  return (
                    <div style={{ background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:14, padding:"18px 20px", marginBottom:20, display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ width:30, height:30, borderRadius:"50%", background:"var(--sc-success)", color:"var(--sc-on-accent)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>✓</span>
                      <div style={{ fontSize:14, fontWeight:600, color:"var(--sc-text)" }}>You're all set! Your books are ready.</div>
                    </div>
                  );
                }
                const renderStep = (s) => (
                  <div key={s.key} onClick={()=>{ if(!s.done) s.go && s.go(); }} style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderTop:"1px solid var(--sc-surface-2)", cursor:s.done?"default":"pointer" }}>
                    <span style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, background:s.done?"var(--sc-success)":"var(--sc-surface)", color:s.done?"var(--sc-surface)":"var(--sc-text-mut)", border:s.done?"none":"2px solid var(--sc-border-2)" }}>{s.done?"✓":""}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize: 13, fontWeight:500, color:s.done?"var(--sc-text-mut)":"var(--sc-text)", textDecoration:s.done?"line-through":"none" }}>{s.label}{s.optional?" (optional)":""}</div>
                      <div style={{ fontSize: 12, color:"var(--sc-text-mut)", marginTop:1 }}>{s.hint}</div>
                    </div>
                    {!s.done && <span style={{ fontSize:13, color:"var(--sc-gold)", fontWeight:600 }}>{s.optional?"Dismiss":"Set up →"}</span>}
                  </div>
                );
                return (
                  <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-gold)", borderRadius:16, padding:"20px 22px", marginBottom:20 }}>
                    <div style={{ fontSize:17, fontWeight:700, color:"var(--sc-text)" }}>Welcome to Shadow — let's get your books set up</div>
                    <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:3, marginBottom:6 }}>{required} of {steps.length} done. Knock these out and you're ready to roll.</div>
                    {steps.map(renderStep)}
                    {(accountantNotice || accountantDismissed) ? (
                      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"11px 0", borderTop:"1px solid var(--sc-surface-2)" }}>
                        <span style={{ width:22, height:22, borderRadius:"50%", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, background:"var(--sc-gold-soft)", color:"var(--sc-gold)" }}>✦</span>
                        <div style={{ fontSize: 13, color:"var(--sc-text-2)", lineHeight:1.4 }}>Team invites are coming soon — we'll notify you when this feature is available.</div>
                      </div>
                    ) : renderStep(optional)}
                  </div>
                );
              })()}

              {/* ── BUSINESS-TYPE MODAL (Item 54.5) — portaled to body to escape the
                   .sc-rise transform's containing-block trap ── */}
              {businessModalOpen && createPortal((
                <div onClick={()=>setBusinessModalOpen(false)} style={{ position:"fixed", inset:0, zIndex:1002, background:"rgba(16,24,40,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
                  <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sc-surface)", borderRadius:16, width:420, maxWidth:"100%", boxShadow:"0 20px 60px rgba(16,24,40,0.25)", overflow:"hidden" }}>
                    <div style={{ padding:"18px 22px", borderBottom:"1px solid var(--sc-surface-2)", fontSize:16, fontWeight:700, color:"var(--sc-text)" }}>Tell us about your business</div>
                    <div style={{ padding:"20px 22px" }}>
                      <label style={{ fontSize:12, fontWeight:600, color:"var(--sc-text-2)", display:"block", marginBottom:6 }}>Business type</label>
                      <select value={bizType||companySettings.businessType||""} onChange={e=>setBizType(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid var(--sc-border-2)", fontSize:14, color:"var(--sc-text)", background:"var(--sc-surface)", marginBottom:16 }}>
                        <option value="">Select…</option>
                        {["SaaS/Software","Consulting/Services","Restaurant/Food","Retail","Construction","Healthcare","Real Estate","Other"].map(t=><option key={t} value={t}>{t}</option>)}
                      </select>
                      <label style={{ fontSize:12, fontWeight:600, color:"var(--sc-text-2)", display:"block", marginBottom:6 }}>Fiscal year end</label>
                      <select value={bizFye||companySettings.fiscalYearEnd||"12-31"} onChange={e=>setBizFye(e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:"1px solid var(--sc-border-2)", fontSize:14, color:"var(--sc-text)", background:"var(--sc-surface)" }}>
                        <option value="12-31">December 31</option>
                        <option value="03-31">March 31</option>
                        <option value="06-30">June 30</option>
                        <option value="09-30">September 30</option>
                      </select>
                    </div>
                    <div style={{ padding:"0 22px 20px", display:"flex", gap:10, justifyContent:"flex-end" }}>
                      <button onClick={()=>setBusinessModalOpen(false)} style={{ padding:"9px 16px", borderRadius:9, fontSize:13, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>Cancel</button>
                      <button onClick={()=>saveBusinessProfile({ businessType: bizType||companySettings.businessType||"Other", fiscalYearEnd: bizFye||companySettings.fiscalYearEnd||"12-31" })}
                        disabled={!(bizType||companySettings.businessType)}
                        style={{ padding:"9px 18px", borderRadius:9, fontSize:13, fontWeight:600, color:"var(--sc-on-accent)", background:(bizType||companySettings.businessType)?"var(--sc-gold)":"var(--sc-gold)", border:"none", cursor:(bizType||companySettings.businessType)?"pointer":"default" }}>Save</button>
                    </div>
                  </div>
                </div>
              ), document.body)}

              {/* ── UNIVERSAL UPLOAD ZONE ── */}
              <style>{`
                .sc-dropzone{ transition: border-color .18s ease, background .18s ease, box-shadow .18s ease; }
                .sc-dropzone:hover{ border-color:var(--sc-gold) !important; background:var(--sc-bg) !important; box-shadow:0 0 0 4px rgba(79,70,229,0.07), 0 10px 30px rgba(79,70,229,0.10) !important; }
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
                  border:`2px dashed ${universalDragOver?"var(--sc-gold)":"var(--sc-border-2)"}`,
                  borderRadius:16, padding:"64px 32px", textAlign:"center", cursor:"pointer",
                  background:universalDragOver?"var(--sc-bg)":"var(--sc-surface)",
                  marginBottom:20,
                }}>
                <input id="universal-upload" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleUniversalUpload(e.target.files)} />
                <div className="sc-dropzone-icon" style={{ width:64, height:64, margin:"0 auto 18px", borderRadius:18, background:universalDragOver?"var(--sc-gold)":"var(--sc-gold-soft)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:28, color:universalDragOver?"var(--sc-surface)":"var(--sc-gold)", opacity: universalDragOver?1:0.92 }}>⬆</div>
                <div style={{ fontSize:22, fontWeight:700, color:"var(--sc-text)", marginBottom:8, letterSpacing:-0.4 }}>
                  {universalDragOver ? "Release to upload" : "Drop anything here"}
                </div>
                <div style={{ fontSize:14, color:"var(--sc-text-mut)", marginBottom:18, lineHeight:1.5 }}>
                  Invoices, receipts, bank statements, contracts — your AI controller handles the rest
                </div>
                <div style={{ display:"inline-flex", gap:8, flexWrap:"wrap", justifyContent:"center" }}>
                  {["PDF","JPG","PNG","CSV","XLSX"].map(f=>(
                    <span key={f} style={{ fontSize:10, fontWeight:600, color:"var(--sc-text-mut)", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border)", borderRadius:6, padding:"3px 9px", letterSpacing:0.5 }}>{f}</span>
                  ))}
                </div>
              </div>

              {/* ── RECURRING SUGGESTIONS (detected monthly patterns) ── */}
              {Array.isArray(recurringSuggestions) && recurringSuggestions.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginBottom:12 }}>RECURRING SUGGESTIONS</div>
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {recurringSuggestions.map(s => {
                      const m = fmtMoney;
                      const range = Math.abs((s.maxAmount||0)-(s.minAmount||0)) < 0.5 ? m(s.avgAmount) : `${m(s.minAmount)}–${m(s.maxAmount)}`;
                      return (
                        <div key={s.id} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-gold)", borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", gap:14 }}>
                          <div style={{ width:34, height:34, borderRadius:9, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, color:"var(--sc-on-accent)", flexShrink:0 }}>↻</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize: 13, color:"var(--sc-text)", lineHeight:1.5 }}>
                              I noticed <strong>{s.vendor}</strong> has charged you {range} every month for the last {s.count} months. Want me to set up a recurring rule so it's always expected and auto-coded to {s.gl_name || s.gl_code}?
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:8, flexShrink:0, flexWrap:"wrap", justifyContent:"flex-end" }}>
                            <button onClick={()=>acceptRecurringSuggestion(s)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:600, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer", whiteSpace:"nowrap" }}>Yes, set it up</button>
                            <button onClick={()=>dismissRecurringSuggestion(s, false)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:500, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer", whiteSpace:"nowrap" }}>No thanks</button>
                            <button onClick={()=>dismissRecurringSuggestion(s, true)} style={{ padding:"7px 13px", borderRadius:8, fontSize:12, fontWeight:500, background:"none", border:"none", color:"var(--sc-text-mut)", cursor:"pointer", whiteSpace:"nowrap" }}>Remind me later</button>
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
                    <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2 }}>PROCESSING QUEUE</div>
                    {uploadQueue.every(q=>q.status==="done"||q.status==="error") && (
                      <button onClick={()=>setUploadQueue([])} style={{ background:"none", border:"none", color:"var(--sc-text-2)", fontSize:12, cursor:"pointer", padding:0 }}>Clear ×</button>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {uploadQueue.map(item => {
                      const typeConfig = {
                        invoice:       { icon:"🧾", label:"Invoice",         color:"var(--sc-gold)" },
                        bank_statement:{ icon:"🏦", label:"Bank Statement",  color:"var(--sc-gold)" },
                        contract:      { icon:"📋", label:"Contract",        color:"var(--sc-warning)" },
                        unknown:       { icon:"❓", label:"Unknown",         color:"var(--sc-error)" },
                      };
                      const tc = typeConfig[item.type] || { icon:"📄", label:"Document", color:"var(--sc-text-2)" };
                      const pendingReview = item.status==="done" && clarificationQueue.some(c => c.queueItemId === item.id && !c.resolved);
                      return (
                        <div key={item.id} style={{ background:"var(--sc-surface)", border:`1px solid ${item.status==="error"?"var(--sc-error-soft)":pendingReview?"var(--sc-warning-soft)":item.status==="done"?"var(--sc-success-soft)":"var(--sc-border)"}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                          {/* File icon */}
                          <div style={{ width:38, height:38, borderRadius:10, background:"var(--sc-border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                            {item.status==="done" ? tc.icon : item.status==="error" ? "⚠" : "📄"}
                          </div>
                          {/* Info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                            <div style={{ fontSize:11, marginTop:3, color:item.status==="error"?"var(--sc-error)":item.status==="done"?tc.color:"var(--sc-text-2)" }}>
                              {item.status==="classifying" && "⟳ Identifying document type..."}
                              {item.status==="processing" && `⟳ Processing as ${tc.label}...`}
                              {item.status==="error" && item.error}
                              {item.status==="done" && item.type==="invoice" && item.result && (() => {
                                const r = item.result;
                                const money = fmtMoney;
                                // Nothing booked at upload time, only items needing review.
                                if (!(r.invoiceCount > 0) && r.needsClarification > 0) {
                                  // Once the clarification has been answered & booked, flip to ✓ Booked.
                                  if (!pendingReview)
                                    return `✓ Booked${r.reviewVendor ? `: ${r.reviewVendor}` : ""}${r.reviewAmount!=null ? ` · ${money(r.reviewAmount)}` : ""}`;
                                  return `⚠ Needs your input · ${r.reviewVendor || "this entry"}${r.reviewAmount!=null ? ` · ${money(r.reviewAmount)}` : ""}${r.needsClarification > 1 ? ` (+${r.needsClarification-1} more)` : ""}`;
                                }
                                // Plain-language trail (Cardinal Principle): "as a client meal",
                                // never "→ 6420 Meals & Entertainment" or a confidence score.
                                let txt = r.invoiceCount === 1
                                  ? `✓ Booked: ${r.vendor || "entry"} · ${money(r.amount)}${r.bookedAs ? ` as ${r.bookedAs}` : ""}`
                                  : `✓ ${r.invoiceCount} invoices booked · ${money(r.amount)} total`;
                                // Only show the outstanding-review suffix while items are still pending.
                                if (r.needsClarification > 0 && pendingReview) txt += ` · ${r.needsClarification} need${r.needsClarification===1 ? "s" : ""} your review`;
                                return txt;
                              })()}
                              {item.status==="done" && item.type==="bank_statement" && item.result && (
                                item.result.txnCount == null ? (
                                  // Routed to Bank Import — matching/booking happens THERE (after the
                                  // user reviews), so there are no match numbers at upload time. Don't
                                  // fabricate a "Matched 0 of 0" summary; tell the truth + link there.
                                  // C197: a client can't open Bank Import, so they get the same truth
                                  // as status — what happened to their file and who has it next.
                                  cockpit ? (
                                    <span onClick={()=>goCockpit("bank")} style={{ cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }} title="Open Bank Import">
                                      📄 Ready in Bank Import — review &amp; book your transactions there →
                                    </span>
                                  ) : (
                                    <span>📄 We've got your statement — your accountant will add these to your books.</span>
                                  )
                                ) : (
                                  cockpit ? (
                                    <span onClick={()=>goCockpit("matching")} style={{ cursor:"pointer", textDecoration:"underline", textUnderlineOffset:2 }} title="Open matching detail">
                                      ✓ Matched {item.result.matchedCount||0} of {item.result.txnCount||0} transactions — ${ (item.result.stillOpenTotal||0).toLocaleString("en-US",{minimumFractionDigits:2}) } in open items still unmatched{item.result.newBooked>0?` · ${item.result.newBooked} new booked`:""}{item.result.needsReview>0?` · ${item.result.needsReview} match${item.result.needsReview!==1?"es":""} to review`:""}
                                    </span>
                                  ) : (
                                    <span>{statementSummaryCopy({ total:item.result.txnCount||0, handled:(item.result.matchedCount||0)+(item.result.newBooked||0), needInput:item.result.needsReview||0 })}</span>
                                  )
                                )
                              )}
                              {item.status==="done" && item.type==="contract" && item.result && `✓ ${tc.label} · ${item.result.counterparty} · ${item.result.entries} record${item.result.entries===1?"":"s"} created`}
                              {item.status==="done" && item.type==="unknown" && item.result && `⚠ ${item.result.document_type||"Unknown"} · ${item.result.entry_needed?"Entry proposed — needs review":"No entry needed — flagged for review"}`}
                              {item.docError && (
                                <div style={{ marginTop:5, fontSize:11, color:"var(--sc-error)", background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:7, padding:"6px 9px", lineHeight:1.45, whiteSpace:"normal" }}>
                                  ⚠ Document not saved to cloud: {item.docError}
                                </div>
                              )}
                            </div>
                          </div>
                          {/* Status pill */}
                          <div style={{ flexShrink:0 }}>
                            {(item.status==="classifying"||item.status==="processing") && (
                              <div style={{ display:"flex", gap:3 }}>
                                {[0,1,2].map(i=><div key={i} style={{ width:5, height:5, borderRadius:"50%", background:"var(--sc-text-2)", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                              </div>
                            )}
                            {item.status==="done" && pendingReview && (
                              <span onClick={()=>{ document.getElementById("clarification-section")?.scrollIntoView({behavior:"smooth"}); }}
                                style={{ fontSize:11, color:"var(--sc-warning)", background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>
                                ⚠ Needs Review
                              </span>
                            )}
                            {item.status==="done" && !pendingReview && <span style={{ fontSize:11, color:"var(--sc-success)", background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:20, padding:"3px 10px" }}>Done</span>}
                            {item.status==="error" && <span style={{ fontSize:11, color:"var(--sc-error)", background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:20, padding:"3px 10px" }}>Error</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Invoice clarification prompt */}
                  {clarificationQueue.filter(c=>!c.resolved).length > 0 && (
                    <div style={{ marginTop:12, background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"var(--sc-warning)" }}>⚠ {clarificationQueue.filter(c=>!c.resolved).length} invoice{clarificationQueue.filter(c=>!c.resolved).length!==1?"s":""} need your input before booking — scroll down to review</div>
                      <button onClick={()=>{ window.scrollTo({top:9999,behavior:"smooth"}); }} style={{ background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", color:"var(--sc-warning)", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Below ↓</button>
                    </div>
                  )}
                  {/* Bank reconciliation review prompt — opens the matching detail */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="bank_statement"&&q.result?.needsReview>0) && (
                    <div style={{ marginTop:12, background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"var(--sc-warning)" }}>{cockpit ? "⚠ Some bank transactions need your review before they're added" : "A few things from your statement need a second look — your accountant is on it."}</div>
                      {cockpit && <button onClick={()=>goCockpit("matching")} style={{ background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", color:"var(--sc-warning)", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Matches →</button>}
                    </div>
                  )}
                  {/* Contract review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="contract") && (
                    <div style={{ marginTop:8, background:"var(--sc-gold-soft)", border:"1px solid var(--sc-gold-soft)", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"var(--sc-gold)" }}>{cockpit ? "📋 A contract is ready to record" : "📋 We've read your agreement — your accountant will record it."}</div>
                      {cockpit && <button onClick={()=>goCockpit("contracts", ()=>setContractView("list"))} style={{ background:"var(--sc-gold-soft)", border:"1px solid var(--sc-gold-soft)", color:"var(--sc-gold)", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Contracts →</button>}
                    </div>
                  )}
                  {/* Unknown docs review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="unknown") && (
                    <div style={{ marginTop:8, background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"var(--sc-error)" }}>{cockpit ? "❓ Some documents need accountant review" : "❓ We couldn't tell what one of your files was — your accountant will take a look."}</div>
                      {cockpit && <button onClick={()=>goCockpit("review")} style={{ background:"var(--sc-error-soft)", border:"1px solid var(--sc-error-soft)", color:"var(--sc-error)", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Now →</button>}
                    </div>
                  )}
                </div>
              )}

              {/* ── AP ACTIONABLE ALERTS ── */}
              {(() => {
                // GL-truth open A/P & A/R LISTS — only entries that actually touch the A/P (A/R)
                // account leg and are still unpaid/uncollected, so the card's COUNT and the drill
                // LIST tie to the GL TOTAL below. (Was "any expense/revenue not paid/collected",
                // which counted direct-cash entries — e.g. a Stripe payout Dr Cash / Cr Revenue —
                // that are not receivables/payables: count/list disagreed with the total.)
                const apCode = getAccountByRole("accounts_payable")?.code;
                const arCode = getAccountByRole("accounts_receivable")?.code;
                const unpaid = openPayablesGL(invoices, apCode);
                const openAR = openReceivablesGL(invoices, arCode);
                if (unpaid.length===0 && openAR.length===0) return null;
                const today = todayLocal();
                // AP/AR totals = the canonical GL balance of the A/P / A/R accounts (same source
                // as the Balance Sheet + Payables), so card total, count, and drill list reconcile.
                const total = glAccountBalance(apCode, invoices);
                const overdue = unpaid.filter(i=>i.due_date && i.due_date<today);
                const arTotal = glAccountBalance(arCode, invoices);   // GL-derived, same source as AP/Balance Sheet
                return (
                  <div style={{ display:"flex", gap:12, marginBottom:24, flexWrap:"wrap" }}>
                    {unpaid.length>0 && (
                      <div onClick={()=>setDashDrill({type:"ap"})} style={{ flex:"1 1 280px", cursor:"pointer", background:"var(--sc-surface)", border:"1px solid var(--sc-border)", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color .2s" }} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--sc-gold)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--sc-border)"}>
                        <div><div style={{ fontSize:13, fontWeight:600, color:"var(--sc-text)" }}>🧾 {unpaid.length} unpaid bill{unpaid.length!==1?"s":""} · {fmtMoney(total)} payable</div><div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:3 }}>{overdue.length>0?`⚠ ${overdue.length} overdue · `:""}Drill into open payables</div></div>
                        <span style={{ fontSize:12, color:"var(--sc-gold)", fontWeight:600 }}>Open AP →</span>
                      </div>
                    )}
                    {openAR.length>0 && (
                      <div onClick={()=>setDashDrill({type:"ar"})} style={{ flex:"1 1 280px", cursor:"pointer", background:"var(--sc-surface)", border:"1px solid var(--sc-border)", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"border-color .2s" }} onMouseEnter={e=>e.currentTarget.style.borderColor="var(--sc-success)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--sc-border)"}>
                        <div><div style={{ fontSize:13, fontWeight:600, color:"var(--sc-text)" }}>💰 {openAR.length} open receivable{openAR.length!==1?"s":""} · {fmtMoney(arTotal)} due in</div><div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:3 }}>Drill into money owed to you</div></div>
                        <span style={{ fontSize:12, color:"var(--sc-success)", fontWeight:600 }}>Open AR →</span>
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
                const amt = dl.est && est.total > 0 ? ` — estimated amount ${fmtApprox(est.quarterly)}` : "";
                const urgent = dl.days<=14;
                const bg = urgent?"var(--sc-error-soft)":"var(--sc-warning-soft)";
                return (
                  <div onClick={()=>setView("tax")} style={{ cursor:"pointer", background:bg, border:`1px solid ${dl.color}40`, borderLeft:`4px solid ${dl.color}`, borderRadius:12, padding:"18px 20px", marginBottom:16, display:"flex", alignItems:"center", gap:16, flexWrap:"wrap", boxShadow:`0 1px 3px ${dl.color}14` }}
                    onMouseEnter={e=>{e.currentTarget.style.boxShadow=`0 4px 14px ${dl.color}22`;}} onMouseLeave={e=>{e.currentTarget.style.boxShadow=`0 1px 3px ${dl.color}14`;}}>
                    <div style={{ width:42, height:42, borderRadius:11, background:dl.color, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, color:"var(--sc-on-accent)", flexShrink:0 }}>⚠</div>
                    <div style={{ flex:"1 1 280px", minWidth:0 }}>
                      <div style={{ fontSize:15, fontWeight:700, color:dl.color, letterSpacing:-0.2 }}>{dl.plain} {dl.days===0?"due today":`in ${dl.days} day${dl.days!==1?"s":""}`}{amt}</div>
                      <div style={{ fontSize: 13, color:"var(--sc-text-mut)", marginTop:4 }}>Pay or file at <a href={dl.url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()} style={{ color:dl.color, fontWeight:600 }}>{dl.est?"irs.gov/payments":"irs.gov"} ↗</a> · click for your full tax picture</div>
                    </div>
                    <span style={{ fontSize:13, color:"var(--sc-on-accent)", fontWeight:600, background:dl.color, borderRadius:8, padding:"8px 14px", whiteSpace:"nowrap" }}>Open Taxes →</span>
                  </div>
                );
              })()}

              {/* ── BANK MATCH REMINDER ──
                   Same `bankMatch` (bankMatchStatus) the O90 TrustPanel consumes, so this alert
                   and the panel's "matched to your bank" line can never contradict. */}
              {(() => {
                const { overdue, days } = bankMatch || {};
                if (!overdue) return null;
                return (
                  <div onClick={()=>setView("home")} style={{ ...{}, cursor:"pointer", background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:14, padding:"16px 20px", marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}
                    onMouseEnter={e=>e.currentTarget.style.borderColor="var(--sc-warning)"} onMouseLeave={e=>e.currentTarget.style.borderColor="var(--sc-warning-soft)"}>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:"var(--sc-warning)" }}>⚠ {days===null ? "Your books haven't been matched to your bank yet." : `Your books haven't been matched to your bank in ${days} days.`}</div>
                      <div style={{ fontSize:12, color:"var(--sc-warning)", opacity:0.8, marginTop:3 }}>Upload your latest bank statement above — we'll match it and mark paid items automatically.</div>
                    </div>
                    <span style={{ fontSize:13, color:"var(--sc-warning)", fontWeight:600 }}>Upload statement →</span>
                  </div>
                );
              })()}

              {/* ── HOW YOUR BUSINESS IS DOING — the SINGLE "how you're doing" block ──
                   Plain-language headline + the FOUR key numbers (cash / monthly burn / runway /
                   net income) as facts + real concerns/actions. This replaced BOTH the old
                   four-metric-card row AND a separate narrative card, which showed the same figures
                   twice. Books-health (reconciled/setup/anomalies) is deliberately NOT here — that's
                   Shadow's job, surfaced in the CPA Review queue (O50), not a demerit on the owner. */}
              {invoices.length > 0 && (() => {
                const bh = businessHealth(invoices, { cash: glCash });
                const toneColor = bh.tone === "good" ? "var(--sc-success)" : bh.tone === "watch" ? "var(--sc-warning)" : "var(--sc-error)";
                const toneSoft  = bh.tone === "good" ? "var(--sc-success-soft)" : bh.tone === "watch" ? "var(--sc-warning-soft)" : "var(--sc-error-soft)";
                const toneLabel = bh.tone === "good" ? "Healthy" : bh.tone === "watch" ? "Worth a look" : "Needs attention";
                const factColor = t => t === "good" ? "var(--sc-success)" : t === "watch" ? "var(--sc-warning)" : t === "concern" ? "var(--sc-error)" : "var(--sc-text)";
                return (
                  <div className="sc-card" style={{ marginBottom:24, background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderLeft:`3px solid ${toneColor}`, borderRadius:14, padding:"18px 22px" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8, flexWrap:"wrap" }}>
                      <span style={{ fontSize:15, fontWeight:700, color:"var(--sc-text)" }}>How your business is doing</span>
                      <span style={{ fontSize:11, fontWeight:700, color:toneColor, background:toneSoft, border:`1px solid ${toneColor}33`, borderRadius:6, padding:"2px 9px" }}>{toneLabel}</span>
                    </div>
                    <div style={{ fontSize: 13, color:"var(--sc-text)", lineHeight:1.55 }}>{bh.headline}</div>
                    {/* The four key numbers — clickable to drill, tone-colored, once (no metric-card row anymore). */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:14, marginTop:16, paddingTop:14, borderTop:"1px solid var(--sc-surface-2)" }}>
                      {bh.facts.map(f => (
                        <div key={f.key} onClick={f.drill ? ()=>setDashDrill({ type:f.drill }) : undefined}
                          onMouseEnter={f.drill ? e=>e.currentTarget.style.background="var(--sc-surface-2)" : undefined}
                          onMouseLeave={f.drill ? e=>e.currentTarget.style.background="transparent" : undefined}
                          style={{ cursor:f.drill?"pointer":"default", borderRadius:9, padding:"6px 8px", margin:"-6px -8px", transition:"background .1s" }}>
                          <div style={{ fontSize:10, letterSpacing:0.8, color:"var(--sc-text-2)", fontWeight:600, textTransform:"uppercase" }}>{f.label}</div>
                          <div style={{ fontSize:20, fontWeight:700, fontFamily:"'DM Mono',monospace", color:factColor(f.tone), marginTop:3 }}>{f.value}</div>
                        </div>
                      ))}
                    </div>
                    {bh.concerns.length > 0 && (
                      <div style={{ marginTop:14, borderTop:"1px solid var(--sc-surface-2)", paddingTop:12, display:"flex", flexDirection:"column", gap:9 }}>
                        {bh.concerns.map(c => (
                          <div key={c.key} style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                            <span style={{ width:6, height:6, borderRadius:"50%", background: c.severity==="high"?"var(--sc-error)":"var(--sc-warning)", flexShrink:0 }} />
                            <span style={{ fontSize: 13, color:"var(--sc-text-2)", flex:1, minWidth:120 }}>{c.text}</span>
                            {c.actionView && <button onClick={()=>setDashDrill({ type:c.actionView })} style={{ padding:"5px 12px", borderRadius:8, fontSize:12, fontWeight:600, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer", flexShrink:0 }}>{c.actionLabel} →</button>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── ANOMALY DETECTION (Item 32) — below the metric cards ── */}
              {Array.isArray(anomalies) && anomalies.length > 0 && (() => {
                const SEV = { high:{ c:"var(--sc-error)", bg:"var(--sc-error-soft)", b:"var(--sc-error-soft)" }, medium:{ c:"var(--sc-warning)", bg:"var(--sc-warning-soft)", b:"var(--sc-warning-soft)" }, low:{ c:"var(--sc-info)", bg:"var(--sc-info-soft)", b:"var(--sc-info-soft)" } };
                // C197: the transaction itself stays open to both seats (it's the client's own
                // entry, reached from their own home page). The BOOKS fallback is cockpit-only —
                // a client never gets bounced into the workbench because a lookup missed.
                const openTxn = (a) => { const inv=(invoices||[]).find(i=>String(i.id)===String((a.invoice_ids||[])[0])); if(inv){ setReturnTo && setReturnTo({view:"home"}); setSelectedInvoice(inv); setView("detail"); } else { goCockpit("books"); } };
                return (
                  <div style={{ background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:14, marginBottom:24, overflow:"hidden" }}>
                    <div onClick={()=>setAnomExpanded(v=>!v)} style={{ padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                      <div style={{ fontSize: 13, fontWeight:600, color:"var(--sc-warning)" }}>⚠ {anomalies.length} unusual {anomalies.length===1?"pattern":"patterns"} detected</div>
                      <span style={{ fontSize:12, color:"var(--sc-warning)", fontWeight:600 }}>{anomExpanded?"Hide ▲":"Review ▼"}</span>
                    </div>
                    {anomExpanded && (
                      <div style={{ borderTop:"1px solid var(--sc-warning-soft)", background:"var(--sc-surface)" }}>
                        {anomalies.map(a => {
                          const sev = SEV[a.severity] || SEV.low;
                          return (
                            <div key={a.id} style={{ display:"flex", gap:12, padding:"13px 18px", borderBottom:"1px solid var(--sc-surface-2)" }}>
                              <div style={{ width:4, borderRadius:3, background:sev.c, flexShrink:0 }} />
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  <span style={{ fontSize:10, fontWeight:700, letterSpacing:0.5, color:sev.c, background:sev.bg, border:`1px solid ${sev.b}`, borderRadius:6, padding:"1px 7px", textTransform:"uppercase" }}>{a.severity}</span>
                                  <span style={{ fontSize:13, fontWeight:600, color:"var(--sc-text)" }}>{a.title}</span>
                                </div>
                                <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:4, lineHeight:1.5 }}>{a.description}</div>
                                <div style={{ display:"flex", gap:14, marginTop:7, alignItems:"center" }}>
                                  {(a.invoice_ids||[]).length>0 && <button onClick={()=>openTxn(a)} style={{ fontSize:12, fontWeight:600, color:"var(--sc-gold)", background:"none", border:"none", cursor:"pointer", padding:0 }}>View transaction →</button>}
                                  {/* Dismissal (with a required reason) is a reviewer action in the CPA Review
                                      queue — not a one-click here. These clear themselves once the underlying
                                      cause is fixed (auto-resolve). */}
                                  {cockpit
                                    ? <button onClick={()=>goCockpit("review")} style={{ fontSize:12, fontWeight:600, color:"var(--sc-warning)", background:"none", border:"none", cursor:"pointer", padding:0 }}>Review →</button>
                                    : <span style={{ fontSize:12, color:"var(--sc-text-2)" }}>Your accountant is taking a look at this.</span>}
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
                  <div className="sc-card" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, marginBottom:24, overflow:"hidden" }}>
                    <div onClick={()=>setShowCommit(s=>!s)} style={{ padding:"16px 20px", display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer" }}>
                      <div>
                        <div style={{ fontSize:13, fontWeight:600, color:"var(--sc-text)" }}>📋 {active.length} active {active.length===1?"commitment":"commitments"} · {fmtMoney(monthly)}/mo total</div>
                        <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:3 }}>Leases &amp; recurring contracts (ASC 842)</div>
                      </div>
                      <span style={{ fontSize:12, color:"var(--sc-gold)", fontWeight:600 }}>{showCommit?"Hide":"Show"} {showCommit?"▲":"▼"}</span>
                    </div>
                    {showCommit && (
                      <div style={{ borderTop:"1px solid var(--sc-surface-2)" }}>
                        {active.map((c,i)=>{
                          const ml = monthsLeft(c);
                          return (
                            <div key={c.id||i} onClick={cockpit ? ()=>goCockpit("contracts", ()=>{ setSelectedContract(c); setContractView("detail"); }) : undefined}
                              onMouseEnter={cockpit ? (e=>e.currentTarget.style.background="var(--sc-surface-2)") : undefined} onMouseLeave={cockpit ? (e=>e.currentTarget.style.background="transparent") : undefined}
                              style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 20px", borderTop: i?"1px solid var(--sc-surface-2)":"none", cursor: cockpit?"pointer":"default" }}>
                              <div style={{ minWidth:0 }}>
                                <div style={{ fontSize:13, fontWeight:500, color:"var(--sc-text)" }}>{c.counterparty||"Contract"}</div>
                                <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{c.contract_type||"contract"}{ml!=null?` · ${ml} mo remaining`:""}</div>
                              </div>
                              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                <span style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)" }}>{fmtMoney(c.payment_amount||0)}/mo</span>
                                {cockpit && <span style={{ color:"var(--sc-text-mut)" }}>›</span>}
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
                  <div className="sc-card" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, overflow:"hidden" }}>
                    <div style={{ padding:"16px 24px", borderBottom:"1px solid var(--sc-border)", fontSize:14, fontWeight:600, color:"var(--sc-text)" }}>Activity</div>
                    {shown.length===0 ? <div style={{ padding:"44px", textAlign:"center", color:"var(--sc-text-mut)", fontSize:13 }}>Nothing yet — drop a document above to get started.</div> :
                      shown.map((it,idx)=>(
                        <div key={idx} onClick={()=>{ if(it.inv){ setReturnTo({view:"home",label:"Home"}); setSelectedInvoice(it.inv); setView("detail"); } }}
                          onMouseEnter={e=>{ if(it.inv) e.currentTarget.style.background="var(--sc-surface-2)"; }} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                          style={{ display:"flex", alignItems:"center", gap:14, padding:"14px 24px", borderTop: idx?"1px solid var(--sc-surface-2)":"none", cursor: it.inv?"pointer":"default", transition:"background 0.1s" }}>
                          <div style={{ width:36, height:36, borderRadius:10, background: it.amount!=null?(it.rev?"var(--sc-success-soft)":"var(--sc-error-soft)"):"var(--sc-surface-2)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{it.icon}</div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize: 13, fontWeight:500, color:"var(--sc-text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{it.text}</div>
                            <div style={{ fontSize:12, color:"var(--sc-text-mut)", marginTop:2 }}>{ago(it.ts)}</div>
                          </div>
                          {it.amount!=null && <div style={{ fontSize: 13, fontWeight:600, fontFamily:"'DM Mono',monospace", color: it.rev?"var(--sc-success)":"var(--sc-error)", flexShrink:0 }}>{it.rev?"+":"−"}${Math.abs(it.amount).toLocaleString("en-US",{minimumFractionDigits:2})}</div>}
                        </div>
                      ))
                    }
                    {items.length > feedCount && (
                      <div style={{ padding:"14px", textAlign:"center", borderTop:"1px solid var(--sc-border)" }}>
                        <button onClick={()=>setFeedCount(c=>c+20)} style={{ background:"none", border:"none", color:"var(--sc-gold)", fontSize:13, fontWeight:600, cursor:"pointer" }}>Load more</button>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
  );
}
