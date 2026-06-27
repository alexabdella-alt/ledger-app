import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate, fmtSignedMoney } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { agingReport, trialBalance, computeKPIs, computeRevenue, computeExpenses, computeVendorTotals, fiscalYearSplit, glAccountBalance, currentPeriodRange } from "../../lib/reports";
import { downloadCSV } from "../../lib/insights";
import TransactionDetailPanel, { txnStatusBadge } from "../TransactionDetailPanel";
import MonthlyReportsPanel from "./MonthlyReportsPanel";

export default function ReportsView() {
  const { runDepreciationThrough, attachDepreciationToExistingAsset, isOwner, isAdmin, cutoffDate, glCash, getAccountByRole, reconciliations, anomalies, setReturnTo, AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  const [plDrill, setPlDrill] = React.useState(null); // {type:"rev-acct"|"exp-acct"|"exp-vendor", code, name, vendor?}
  // Drill-down for the other reports: {scope:"vendor"|"gl"|"cashflow"|"project"|"bsacct", value, label}
  const [drill, setDrill] = React.useState(null);
  const [drillSel, setDrillSel] = React.useState(null); // selected transaction id for the slide-in
  const [tbAdjusted, setTbAdjusted] = React.useState(true); // trial balance: adjusted (exclude voided) vs unadjusted
  const [depRunDate, setDepRunDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [depRunning, setDepRunning] = React.useState(false);
  const runDep = async () => {
    if (depRunning) return;
    setDepRunning(true);
    try { await runDepreciationThrough(depRunDate); } finally { setDepRunning(false); }
  };
  // Maintenance: attach depreciation to an already-capitalized asset (existing JE).
  const [attachOpen, setAttachOpen] = React.useState(false);
  const [attachJe, setAttachJe] = React.useState("");
  const [attachLifeY, setAttachLifeY] = React.useState("5");
  const [attachSalvage, setAttachSalvage] = React.useState("0");
  const [attachDate, setAttachDate] = React.useState("");
  const [attaching, setAttaching] = React.useState(false);
  const runAttach = async () => {
    if (attaching || !attachJe.trim()) return;
    setAttaching(true);
    try {
      await attachDepreciationToExistingAsset({
        journalEntryId: attachJe.trim(),
        usefulLifeMonths: Math.max(1, Math.round((parseFloat(attachLifeY) || 5) * 12)),
        salvageValue: parseFloat(attachSalvage) || 0,
        inServiceDate: attachDate || null,
      });
    } finally { setAttaching(false); }
  };
  React.useEffect(() => { setDrill(null); setDrillSel(null); }, [reportType]);
  // O70: on open, the report window auto-defaults to the CURRENT period — "to" is
  // always today (never a stale saved value from sessionStorage), "from" is the
  // fiscal-year start (respects fiscal_year_end + cutoff). The user can still change
  // the range while on the page; reopening Reports resets to the current period.
  React.useEffect(() => {
    const { from, to } = currentPeriodRange("fy", { fiscalYearEnd: companySettings?.fiscalYearEnd || "12-31", cutoffDate });
    setReportDateFrom(from); setReportDateTo(to); setReportRange("custom");
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- run once on open
            // Date filter helper
            const filterByRange = (invList) => {
              if (reportRange === "all") return invList;
              const now = new Date();
              return invList.filter(inv => {
                if (!inv.date) return false;
                const d = new Date(inv.date);
                if (reportRange === "custom") return (!reportDateFrom || d >= new Date(reportDateFrom)) && (!reportDateTo || d <= new Date(reportDateTo));
                if (reportRange === "thismonth") return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
                if (reportRange === "lastmonth") { const lm=new Date(now.getFullYear(),now.getMonth()-1,1); return d.getMonth()===lm.getMonth()&&d.getFullYear()===lm.getFullYear(); }
                if (reportRange === "q1") return d.getMonth()<3 && d.getFullYear()===now.getFullYear();
                if (reportRange === "q2") return d.getMonth()>=3&&d.getMonth()<6&&d.getFullYear()===now.getFullYear();
                if (reportRange === "q3") return d.getMonth()>=6&&d.getMonth()<9&&d.getFullYear()===now.getFullYear();
                if (reportRange === "q4") return d.getMonth()>=9&&d.getFullYear()===now.getFullYear();
                if (reportRange === "ytd") return d.getFullYear()===now.getFullYear();
                return true;
              });
            };
            const filtered = filterByRange(invoices);
            // P&L filter: date range + voided + P&L accounts + optional basis mode
            const plFiltered = filtered.filter(i => {
              if (i.status === "voided" || !glPLType(i.gl_code)) return false;
              if (basisMode === "cash") {
                // Cash basis: bank feed entries are actual cash; otherwise require marked paid/collected
                return i.source === "bank_feed" || i.payment_status === "paid" || i.payment_status === "collected";
              }
              return true; // accrual: all posted entries
            });
            // Accrual headline flows through the canonical layer (identical to the
            // dashboard, monthly report, and AI). Cash basis stays a P&L-only view.
            const revenue  = basisMode==="cash" ? plFiltered.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0) : computeRevenue(filtered);
            const expenses = basisMode==="cash" ? plFiltered.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0) : computeExpenses(filtered);
            const net = revenue - expenses;

            // Group revenue by GL
            const byRevGL = {};
            plFiltered.filter(i=>glIsRevenue(i.gl_code)).forEach(inv => {
              const k = inv.gl_code;
              if (!byRevGL[k]) byRevGL[k] = { name: inv.gl_name, code: inv.gl_code, total:0, count:0 };
              byRevGL[k].total += inv.amount; byRevGL[k].count++;
            });
            const revRows = Object.values(byRevGL).sort((a,b)=>b.total-a.total);

            // GAAP P&L groupings: COGS (5000 only) vs Operating Expenses (all other 5xxx/6xxx)
            const allExpGL = {};
            plFiltered.filter(i=>glIsExpense(i.gl_code)).forEach(inv => {
              const k = inv.gl_code;
              if (!allExpGL[k]) allExpGL[k] = { name: inv.gl_name, code: inv.gl_code, total:0, count:0 };
              allExpGL[k].total += inv.amount; allExpGL[k].count++;
            });
            const cogsRows = Object.values(allExpGL).filter(r=>String(r.code).startsWith("5"));
            const opexRows = Object.values(allExpGL).filter(r=>!String(r.code).startsWith("5")).sort((a,b)=>a.code.localeCompare(b.code));
            const cogs = cogsRows.reduce((s,r)=>s+r.total, 0);
            const opex = opexRows.reduce((s,r)=>s+r.total, 0);
            const grossProfit = revenue - cogs;
            const operatingIncome = grossProfit - opex;
            // glRows used by "By Category" tab
            const byGL = allExpGL;
            const glRows = Object.values(byGL).sort((a,b) => a.code?.localeCompare(b.code));

            // Group by vendor — canonical (P&L accounts only); equals the AI's get_vendor_summary.
            const vendorRows = computeVendorTotals(filtered).map(v => ({ name: v.vendor, total: v.total, count: v.count }));

            // Cash flow by month — ACTUAL cash only (collected receivables + paid expenses)
            const byMonth = {};
            filtered.forEach(inv => {
              if (!inv.date) return;
              const m = inv.date.slice(0,7);
              if (!byMonth[m]) byMonth[m] = { month:m, inflow:0, outflow:0 };
              // Cash in = revenue that has been collected
              if (glIsRevenue(inv.gl_code) && (inv.payment_status==="collected" || inv.payment_status==="paid")) {
                byMonth[m].inflow += inv.amount;
              }
              // Cash out = expenses that have been paid
              if (glIsExpense(inv.gl_code) && inv.payment_status==="paid") {
                byMonth[m].outflow += inv.amount;
              }
            });
            const cashRows = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month));

            // By project — only P&L accounts
            const byProject = {};
            filtered.filter(i=>glPLType(i.gl_code)).forEach(inv => {
              const p = inv.project||"General";
              if (!byProject[p]) byProject[p] = { name:p, expenses:0, revenue:0, count:0 };
              if (glIsExpense(inv.gl_code)) byProject[p].expenses+=inv.amount;
              else byProject[p].revenue+=inv.amount;
              byProject[p].count++;
            });
            const projectRows = Object.values(byProject).sort((a,b)=>b.expenses-a.expenses);

            const fmt = (n) => "$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2});
            const rangeLabels = { all:"All Time", thismonth:"This Month", lastmonth:"Last Month", q1:"Q1", q2:"Q2", q3:"Q3", q4:"Q4", ytd:"Year to Date", custom: reportDateFrom && reportDateTo ? `${reportDateFrom} → ${reportDateTo}` : "Custom Range" };
            // Friendly report name for the transaction detail back button.
            const reportName = { pl:"Income Statement", balance:"Balance Sheet", trial:"Trial Balance", araging:"AR Aging", apaging:"AP Aging", kpis:"KPIs", vendor:"By Vendor", gl:"By Category", cashflow:"Cash Flow", project:"By Project" }[reportType] || "Reports";
            const reportReturn = { view:"reports", label:reportName, reportType };

            // ── Report drill-downs ──────────────────────────────────────────────
            // The transactions behind a clicked row, honoring the active date range.
            const drillTxns = () => {
              if (!drill) return [];
              const byDate = (a,b)=>(b.date||"").localeCompare(a.date||"");
              if (drill.scope==="vendor")   return filtered.filter(i=>glIsExpense(i.gl_code) && (i.vendor||"Unknown")===drill.value).sort(byDate);  // expenses only — matches the By-Vendor list (no revenue items)
              if (drill.scope==="gl")       return plFiltered.filter(i=>glIsExpense(i.gl_code) && i.gl_code===drill.value).sort(byDate);
              if (drill.scope==="cashflow") return filtered.filter(i=>i.date && i.date.slice(0,7)===drill.value).sort(byDate);
              if (drill.scope==="project")  return filtered.filter(i=>glPLType(i.gl_code) && (i.project||"General")===drill.value).sort(byDate);
              if (drill.scope==="bsacct") {
                const asOf = reportDateTo || new Date().toISOString().slice(0,10);
                return invoices.filter(i => i.status!=="voided" && (!i.date || i.date<=asOf) &&
                  (i.gl_code===drill.value || (!String(i.id).includes("_") && i.secondary_gl_code===drill.value))).sort(byDate);
              }
              return [];
            };
            const renderDrill = () => {
              const txns = drillTxns();
              const isRev = i => glIsRevenue(i.gl_code) || i.type==="revenue";
              const total = txns.reduce((s,i)=>s+i.amount,0);
              const scopeLabel = { vendor:"By Vendor", gl:"By Category", cashflow:"Cash Flow", project:"By Project", bsacct:"Balance Sheet" }[drill.scope];
              const hideVendor = drill.scope==="vendor", hideGL = drill.scope==="gl";
              const cols = ["Date", ...(hideVendor?[]:["Vendor"]), "Description", ...(hideGL?[]:["GL Account"]), "Amount", "Status"];
              const crumbs = ["Reports", scopeLabel, drill.label];
              return (
                <div className="sc-rise" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip", marginBottom:16 }}>
                  <div style={{ padding:"16px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                    <button onClick={()=>setDrill(null)} style={{ background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", color:"var(--sc-gold)", borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer" }}>← Back</button>
                    <div style={{ fontSize:13, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                      {crumbs.map((c,ci)=>(
                        <span key={ci} style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <span onClick={ci<crumbs.length-1?()=>setDrill(null):undefined}
                            style={{ color: ci===crumbs.length-1?"var(--sc-text)":"var(--sc-gold)", fontWeight: ci===crumbs.length-1?600:500, cursor: ci<crumbs.length-1?"pointer":"default" }}>{c}</span>
                          {ci<crumbs.length-1 && <span style={{ color:"var(--sc-text-mut)" }}>→</span>}
                        </span>
                      ))}
                    </div>
                    <span style={{ marginLeft:"auto", fontSize:11, color:"var(--sc-text-2)" }}>{txns.length} transaction{txns.length!==1?"s":""}</span>
                    <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"var(--sc-text)" }}>{fmt(total)}</span>
                  </div>
                  {txns.length===0 ? <div style={{ padding:24, fontSize:13, color:"var(--sc-text-2)" }}>No transactions in this range.</div> : (
                    <table style={{ width:"100%", borderCollapse:"collapse" }}>
                      <thead><tr style={{ background:"var(--sc-bg)" }}>
                        {cols.map((h,ci)=><th key={ci} style={{ padding:"10px 16px", textAlign:h==="Amount"?"right":"left", fontSize:12, color:"var(--sc-text-mut)", letterSpacing:0.6, fontWeight:600, borderBottom:"1px solid var(--sc-border)", whiteSpace:"nowrap" }}>{h.toUpperCase()}</th>)}
                      </tr></thead>
                      <tbody>
                        {txns.map((inv,idx)=>{
                          const rev = isRev(inv);
                          return (
                            <tr key={inv.id} onClick={()=>setDrillSel(inv.id)} style={{ cursor:"pointer", height:52, background:"var(--sc-surface)", borderBottom:"1px solid var(--sc-border)", opacity:inv.status==="voided"?0.55:1, transition:"background 0.1s" }}
                              onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"} onMouseLeave={e=>e.currentTarget.style.background="#FFFFFF"}>
                              <td style={{ padding:"0 16px", fontSize:13, color:"var(--sc-text-mut)", whiteSpace:"nowrap" }}>{fmtDate(inv.date)}</td>
                              {!hideVendor && <td style={{ padding:"0 16px" }}><div style={{ display:"flex", alignItems:"center", gap:10 }}><span style={{ width:28,height:28,borderRadius:8,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"var(--sc-on-accent)",flexShrink:0 }}>{initials(inv.vendor)}</span><span style={{ fontSize:13, fontWeight:500, color:"var(--sc-text)" }}>{inv.vendor||"—"}</span></div></td>}
                              <td style={{ padding:"0 16px", fontSize:13, color:"var(--sc-text-2)", maxWidth:240, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description||"—"}</td>
                              {!hideGL && <td style={{ padding:"0 16px", fontSize:13, color:"var(--sc-text-2)", whiteSpace:"nowrap" }}><span style={{ fontFamily:"'DM Mono',monospace", color:"var(--sc-text-mut)", marginRight:6 }}>{inv.gl_code}</span>{inv.gl_name}</td>}
                              <td style={{ padding:"0 16px", textAlign:"right", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", color: rev?"var(--sc-success)":"var(--sc-error)", whiteSpace:"nowrap" }}>{rev?"+":"−"}{fmt(inv.amount)}</td>
                              <td style={{ padding:"0 16px" }}>{txnStatusBadge(inv)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              );
            };

            return (
              <div>
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>REPORTING</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Reports</h1>
                </div>

                {/* Controls */}
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24, alignItems:"center" }}>
                  {[["pl","P&L"],["balance","Balance Sheet"],["trial","Trial Balance"],["araging","AR Aging"],["apaging","AP Aging"],["kpis","KPIs"],["vendor","By Vendor"],["gl","By Category"],["cashflow","Cash Flow"],["project","By Project"],["monthly","Monthly Reports"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setReportType(id)} style={{ padding:"8px 16px", borderRadius:20, fontSize:13, background:reportType===id?"var(--sc-gold)":"transparent", border:`1px solid ${reportType===id?"var(--sc-gold)":"var(--sc-border-2)"}`, color:reportType===id?"var(--sc-surface-2)":"var(--sc-text-2)", cursor:"pointer", fontWeight:reportType===id?600:400 }}>{label}</button>
                  ))}
                  <div style={{ flex:1 }} />
                  {/* Date range — custom inputs always visible, preset buttons for quick selection */}
                  <input type="date" value={reportDateFrom} onChange={e=>{ setReportDateFrom(e.target.value); setReportRange("custom"); }} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"7px 10px", color:"var(--sc-text)", fontSize:13, outline:"none" }} />
                  <span style={{ color:"var(--sc-text-2)", fontSize:13 }}>to</span>
                  <input type="date" value={reportDateTo} onChange={e=>{ setReportDateTo(e.target.value); setReportRange("custom"); }} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"7px 10px", color:"var(--sc-text)", fontSize:13, outline:"none" }} />
                  <select value={reportRange} onChange={e=>{ setReportRange(e.target.value); const now=new Date(); if(e.target.value==="thismonth"){setReportDateFrom(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-01");setReportDateTo(now.toISOString().slice(0,10));} else if(e.target.value==="ytd"){setReportDateFrom(now.getFullYear()+"-01-01");setReportDateTo(now.toISOString().slice(0,10));} else if(e.target.value==="all"){setReportDateFrom("");setReportDateTo("");} }} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"8px 12px", color:"var(--sc-text)", fontSize:13, outline:"none", cursor:"pointer" }}>
                    {Object.entries(rangeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>

                {/* Period-end action: post straight-line depreciation due through a date.
                    Posts pending schedule rows (Dr 6900 / Cr 1510) and flips fully-depreciated assets. */}
                <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:24, padding:"12px 14px", background:"var(--sc-bg)", border:"1px solid var(--sc-border)", borderRadius:10 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:"var(--sc-text-2)" }}>Depreciation</span>
                  <span style={{ fontSize:13, color:"var(--sc-text-mut)" }}>Post all entries due through</span>
                  <input type="date" value={depRunDate} onChange={e=>setDepRunDate(e.target.value)} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"7px 10px", color:"var(--sc-text)", fontSize:13, outline:"none" }} />
                  <button onClick={runDep} disabled={depRunning} style={{ padding:"8px 16px", borderRadius:8, fontSize:13, fontWeight:600, color:"var(--sc-on-accent)", background:depRunning?"var(--sc-text-mut)":"var(--sc-gold)", border:"none", cursor:depRunning?"default":"pointer" }}>{depRunning?"Posting…":"Run depreciation"}</button>
                  <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>Straight-line · idempotent (only unposted months)</span>
                  {(isOwner || isAdmin) && <button onClick={()=>setAttachOpen(o=>!o)} style={{ marginLeft:"auto", fontSize:12, fontWeight:500, color:"var(--sc-text-2)", background:"none", border:"none", cursor:"pointer" }}>{attachOpen?"Close":"Attach to existing asset"}</button>}
                </div>

                {/* Maintenance (owner/admin): attach depreciation to an already-capitalized
                    asset whose Dr Fixed Asset / Cr AP entry already exists. Posts NO new
                    capitalization JE; idempotent (skips if already linked). */}
                {(isOwner || isAdmin) && attachOpen && (
                  <div style={{ display:"flex", alignItems:"flex-end", gap:12, flexWrap:"wrap", marginBottom:24, padding:"12px 14px", background:"#FFFBF5", border:"1px solid #FEDF89", borderRadius:10 }}>
                    <label style={{ fontSize:12, color:"var(--sc-text-2)", display:"flex", flexDirection:"column", gap:4 }}>Capitalization entry id
                      <input value={attachJe} onChange={e=>setAttachJe(e.target.value)} placeholder="journal_entries.id" style={{ width:320, height:36, borderRadius:8, border:"1px solid var(--sc-border-2)", padding:"0 10px", fontSize:13, fontFamily:"monospace" }} /></label>
                    <label style={{ fontSize:12, color:"var(--sc-text-2)", display:"flex", flexDirection:"column", gap:4 }}>Life (yrs)
                      <input type="number" min="1" value={attachLifeY} onChange={e=>setAttachLifeY(e.target.value)} style={{ width:80, height:36, borderRadius:8, border:"1px solid var(--sc-border-2)", padding:"0 10px", fontSize:13 }} /></label>
                    <label style={{ fontSize:12, color:"var(--sc-text-2)", display:"flex", flexDirection:"column", gap:4 }}>Salvage ($)
                      <input type="number" min="0" value={attachSalvage} onChange={e=>setAttachSalvage(e.target.value)} style={{ width:110, height:36, borderRadius:8, border:"1px solid var(--sc-border-2)", padding:"0 10px", fontSize:13 }} /></label>
                    <label style={{ fontSize:12, color:"var(--sc-text-2)", display:"flex", flexDirection:"column", gap:4 }}>In-service date
                      <input type="date" value={attachDate} onChange={e=>setAttachDate(e.target.value)} style={{ height:36, borderRadius:8, border:"1px solid var(--sc-border-2)", padding:"0 10px", fontSize:13 }} /></label>
                    <button onClick={runAttach} disabled={attaching || !attachJe.trim()} style={{ height:36, padding:"0 16px", borderRadius:8, fontSize:13, fontWeight:600, color:"var(--sc-on-accent)", background:(attaching||!attachJe.trim())?"var(--sc-text-mut)":"var(--sc-warning)", border:"none", cursor:(attaching||!attachJe.trim())?"default":"pointer" }}>{attaching?"Attaching…":"Attach depreciation"}</button>
                    <span style={{ fontSize:12, color:"var(--sc-warning)", width:"100%" }}>Reuses the existing capitalization entry — posts no new Dr/Cr. In-service date defaults to the entry date if blank.</span>
                  </div>
                )}

                {/* Monthly Reports — the immutable archive, always reachable regardless of live ledger state. */}
                {reportType==="monthly" && <MonthlyReportsPanel />}

                {reportType!=="monthly" && invoices.length===0 && <div style={{ color:"var(--sc-text-2)", fontSize:14 }}>No data yet. Upload invoices or a bank statement to generate reports.</div>}

                {reportType!=="monthly" && invoices.length>0 && (
                  <div>
                    {/* P&L */}
                    {reportType==="pl" && (
                      <div>
                        {plDrill ? (() => {
                          const amtColor = plDrill.type==="rev-acct" ? "var(--sc-success)" : "var(--sc-error)";
                          let crumbs, back, kind, data, total;
                          if (plDrill.type==="rev-acct") {
                            crumbs = ["Income Statement","Revenue",plDrill.name]; back = () => setPlDrill(null);
                            data = plFiltered.filter(i=>glIsRevenue(i.gl_code) && i.gl_code===plDrill.code).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
                            total = data.reduce((s,i)=>s+i.amount,0); kind = "txns";
                          } else if (plDrill.type==="exp-acct") {
                            crumbs = ["Income Statement",plDrill.name]; back = () => setPlDrill(null);
                            const byV = {}; plFiltered.filter(i=>glIsExpense(i.gl_code) && i.gl_code===plDrill.code).forEach(i=>{ const v=i.vendor||"Unknown"; if(!byV[v]) byV[v]={vendor:v,total:0,count:0}; byV[v].total+=i.amount; byV[v].count++; });
                            data = Object.values(byV).sort((a,b)=>b.total-a.total); total = data.reduce((s,r)=>s+r.total,0); kind = "vendors";
                          } else {
                            crumbs = ["Income Statement",plDrill.name,plDrill.vendor]; back = () => setPlDrill({type:"exp-acct",code:plDrill.code,name:plDrill.name});
                            data = plFiltered.filter(i=>glIsExpense(i.gl_code) && i.gl_code===plDrill.code && (i.vendor||"Unknown")===plDrill.vendor).sort((a,b)=>(b.date||"").localeCompare(a.date||""));
                            total = data.reduce((s,i)=>s+i.amount,0); kind = "txns";
                          }
                          return (
                            <div className="sc-rise" style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"hidden", marginBottom:16 }}>
                              <div style={{ padding:"16px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                                <button onClick={back} style={{ background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", color:"var(--sc-gold)", borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer" }}>← Back</button>
                                <div style={{ fontSize:13, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                  {crumbs.map((c,ci)=>(
                                    <span key={ci} style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <span style={{ color: ci===crumbs.length-1?"var(--sc-text)":"var(--sc-text-2)", fontWeight: ci===crumbs.length-1?600:400 }}>{c}</span>
                                      {ci<crumbs.length-1 && <span style={{ color:"var(--sc-text-mut)" }}>→</span>}
                                    </span>
                                  ))}
                                </div>
                                <span style={{ marginLeft:"auto", fontSize:11, color:"var(--sc-text-2)" }}>{data.length} {kind==="vendors"?"vendor":"transaction"}{data.length!==1?"s":""}</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:amtColor }}>{fmt(total)}</span>
                              </div>
                              {kind==="vendors" ? (
                                data.map(v=>(
                                  <div key={v.vendor} onClick={()=>setPlDrill({type:"exp-vendor",code:plDrill.code,name:plDrill.name,vendor:v.vendor})}
                                    onMouseEnter={e=>e.currentTarget.style.background="#F3F4F6"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px 24px", cursor:"pointer", borderTop:"1px solid var(--sc-surface-2)" }}>
                                    <span style={{ fontSize:13, color:"var(--sc-text-2)", display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ width:26, height:26, borderRadius:7, background:vendorColor(v.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--sc-on-accent)" }}>{initials(v.vendor)}</span>
                                      {v.vendor}<span style={{ fontSize:11, color:"var(--sc-text-mut)" }}>· {v.count} txn{v.count!==1?"s":""}</span>
                                    </span>
                                    <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-error)" }}>{fmt(v.total)}</span>
                                      <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>›</span>
                                    </span>
                                  </div>
                                ))
                              ) : (
                                data.length===0 ? <div style={{ padding:24, fontSize:13, color:"var(--sc-text-2)" }}>No transactions in range.</div> :
                                data.map(inv=>(
                                  <div key={inv.id} onClick={()=>{ setReturnTo(reportReturn); setSelectedInvoice(inv); setView("detail"); }}
                                    onMouseEnter={e=>e.currentTarget.style.background="#F3F4F6"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 24px", cursor:"pointer", borderTop:"1px solid var(--sc-surface-2)" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                                      <span style={{ fontSize:11, color:"var(--sc-text-2)", width:78, flexShrink:0 }}>{fmtDate(inv.date)}</span>
                                      <span style={{ width:26, height:26, borderRadius:7, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(inv.vendor)}</span>
                                      <div style={{ minWidth:0 }}>
                                        <div style={{ fontSize:13, color:"var(--sc-text)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor}</div>
                                        <div style={{ fontSize:11, color:"var(--sc-text-2)", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.description||"—"}</div>
                                      </div>
                                    </div>
                                    <div style={{ display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
                                      <span style={{ fontSize:10, color:"var(--sc-text-mut)", fontFamily:"monospace", background:"var(--sc-border)", padding:"1px 6px", borderRadius:4 }}>{inv.gl_code}</span>
                                      <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:amtColor, width:100, textAlign:"right" }}>{fmt(inv.amount)}</span>
                                    </div>
                                  </div>
                                ))
                              )}
                            </div>
                          );
                        })() : (
                        <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"hidden", marginBottom:16 }}>
                          <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                            <div>
                              <div style={{ fontSize:14, fontWeight:600 }}>Profit & Loss Statement</div>
                              <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:3 }}>{basisMode==="cash"?"Cash basis":"Accrual basis"} · {rangeLabels[reportRange]} · {plFiltered.length} transactions</div>
                            </div>
                            <div style={{ display:"flex", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:8, overflow:"hidden" }}>
                              {[["accrual","Accrual"],["cash","Cash"]].map(([m,label])=>(
                                <button key={m} onClick={()=>setBasisMode(m)} style={{ padding:"6px 14px", fontSize:12, border:"none", cursor:"pointer", background:basisMode===m?"var(--sc-border-2)":"transparent", color:basisMode===m?"var(--sc-text)":"var(--sc-text-2)", fontWeight:basisMode===m?600:400 }}>{label}</button>
                              ))}
                            </div>
                          </div>
                          <div style={{ padding:"0 24px" }}>
                            {/* Revenue */}
                            <div style={{ padding:"16px 0", borderBottom:"1px solid var(--sc-border)" }}>
                              <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginBottom:12 }}>REVENUE</div>
                              {revRows.length===0 ? <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>No revenue recorded</div> :
                                revRows.map(row=>(
                                  <div key={row.code} onClick={()=>setPlDrill({type:"rev-acct",code:row.code,name:row.name})} title="View transactions"
                                    onMouseEnter={e=>e.currentTarget.style.background="#E4E7EC"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", borderRadius:8, padding:"4px 8px", margin:"0 -8px 4px" }}>
                                    <span style={{ fontSize:13, color:"var(--sc-text-2)", paddingLeft:4, display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ fontSize:10, color:"var(--sc-text-mut)", fontFamily:"monospace", background:"var(--sc-border)", padding:"1px 6px", borderRadius:4 }}>{row.code}</span>
                                      {row.name}
                                    </span>
                                    <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-success)" }}>{fmt(row.total)}</span>
                                      <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>›</span>
                                    </span>
                                  </div>
                                ))
                              }
                              <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid var(--sc-border)" }}>
                                <span style={{ fontSize:13, fontWeight:600 }}>Total Revenue</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"var(--sc-success)" }}>{fmt(revenue)}</span>
                              </div>
                            </div>
                            {/* COGS — only shown when code 5000 has activity */}
                            {cogsRows.length > 0 && (
                              <div style={{ padding:"16px 0", borderBottom:"1px solid var(--sc-border)" }}>
                                <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginBottom:12 }}>COST OF REVENUE</div>
                                {cogsRows.map(row=>(
                                  <div key={row.code} onClick={()=>setPlDrill({type:"exp-acct",code:row.code,name:row.name})} title="Drill into vendors"
                                    onMouseEnter={e=>e.currentTarget.style.background="#E4E7EC"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", borderRadius:8, padding:"4px 8px", margin:"0 -8px 4px" }}>
                                    <span style={{ fontSize:13, color:"var(--sc-text-2)", paddingLeft:4, display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ fontSize:10, color:"var(--sc-text-mut)", fontFamily:"monospace", background:"var(--sc-border)", padding:"1px 6px", borderRadius:4 }}>{row.code}</span>
                                      {row.name}
                                    </span>
                                    <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-error)" }}>({fmt(row.total)})</span>
                                      <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>›</span>
                                    </span>
                                  </div>
                                ))}
                                <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid var(--sc-border)" }}>
                                  <span style={{ fontSize:13, fontWeight:600 }}>Gross Profit</span>
                                  <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:grossProfit>=0?"var(--sc-success)":"var(--sc-error)" }}>{grossProfit<0?"-":""}{fmt(Math.abs(grossProfit))}</span>
                                </div>
                              </div>
                            )}
                            {/* Operating Expenses */}
                            <div style={{ padding:"16px 0", borderBottom:"1px solid var(--sc-border)" }}>
                              <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginBottom:12 }}>OPERATING EXPENSES</div>
                              {opexRows.length===0 ? <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>No expenses recorded</div> :
                                opexRows.map(row=>(
                                  <div key={row.code} onClick={()=>setPlDrill({type:"exp-acct",code:row.code,name:row.name})} title="Drill into vendors"
                                    onMouseEnter={e=>e.currentTarget.style.background="#E4E7EC"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                    style={{ display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", borderRadius:8, padding:"4px 8px", margin:"0 -8px 4px" }}>
                                    <span style={{ fontSize:13, color:"var(--sc-text-2)", paddingLeft:4, display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ fontSize:10, color:"var(--sc-text-mut)", fontFamily:"monospace", background:"var(--sc-border)", padding:"1px 6px", borderRadius:4 }}>{row.code}</span>
                                      {row.name}
                                    </span>
                                    <span style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-error)" }}>({fmt(row.total)})</span>
                                      <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>›</span>
                                    </span>
                                  </div>
                                ))
                              }
                              <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid var(--sc-border)" }}>
                                <span style={{ fontSize:13, fontWeight:600 }}>Total Operating Expenses</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"var(--sc-error)" }}>({fmt(opex)})</span>
                              </div>
                            </div>
                            {/* Operating Income subtotal */}
                            <div style={{ padding:"12px 0", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                              <span style={{ fontSize:14, fontWeight:600, color:"var(--sc-text-2)" }}>Operating Income</span>
                              <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:operatingIncome>=0?"var(--sc-success)":"var(--sc-error)" }}>{operatingIncome<0?"-":""}{fmt(Math.abs(operatingIncome))}</span>
                            </div>
                            {/* Net Income */}
                            <div style={{ padding:"18px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                              <span style={{ fontSize:16, fontWeight:700 }}>Net {net>=0?"Income":"Loss"}</span>
                              <span style={{ fontSize:20, fontFamily:"'DM Mono', monospace", fontWeight:700, color:net>=0?"var(--sc-success)":"var(--sc-error)" }}>{net<0?"-":""}{fmt(Math.abs(net))}</span>
                            </div>
                          </div>
                        </div>
                        )}
                      </div>
                    )}

                    {/* BALANCE SHEET */}
                    {reportType==="balance" && (() => {
                      if (drill) return renderDrill();
                      // Sign-aware: a negative asset (e.g. overdrawn cash) renders as -$X, never
                      // as a positive magnitude (the masked-overdraft bug). Call sites that pass
                      // Math.abs(...) with their own sign prefix stay correct (abs → no extra "-").
                      const bsFmt = fmtSignedMoney;

                      // "As of" date — accumulate all transactions through reportDateTo
                      const asOf = reportDateTo || new Date().toISOString().slice(0,10);
                      const bsInvoices = invoices.filter(i => i.status !== "voided" && (!i.date || i.date <= asOf));

                      // Every balance-sheet figure (incl. Accounts Payable) reads the ONE canonical
                      // GL-balance function (lib/reports.js glAccountBalance) — the same source the
                      // Payables/Outstanding and Dashboard surfaces use, so they reconcile by
                      // construction. Opening-balance entries (source:"opening_balance") are ordinary
                      // journal entries in the ledger, so they're already included here.
                      const getBal = (code) => glAccountBalance(code, bsInvoices, { asOf });

                      // GAAP groupings — current vs non-current
                      const currentAssets    = CHART_OF_ACCOUNTS.filter(a => a.category==="Assets"      && parseInt(a.code) < 1500);
                      const nonCurrentAssets = CHART_OF_ACCOUNTS.filter(a => a.category==="Assets"      && parseInt(a.code) >= 1500);
                      const currentLiab      = CHART_OF_ACCOUNTS.filter(a => a.category==="Liabilities" && parseInt(a.code) < 2450);
                      const nonCurrentLiab   = CHART_OF_ACCOUNTS.filter(a => a.category==="Liabilities" && parseInt(a.code) >= 2450);
                      const bsEquity         = CHART_OF_ACCOUNTS.filter(a => a.category==="Equity");

                      const totalCurrentAssets    = currentAssets.reduce((s,a)=>s+getBal(a.code),0);
                      const totalNonCurrentAssets = nonCurrentAssets.reduce((s,a)=>s+getBal(a.code),0);
                      const totalAssets            = totalCurrentAssets + totalNonCurrentAssets;
                      const totalCurrentLiab       = currentLiab.reduce((s,a)=>s+getBal(a.code),0);
                      const totalNonCurrentLiab    = nonCurrentLiab.reduce((s,a)=>s+getBal(a.code),0);
                      const totalLiabilities       = totalCurrentLiab + totalNonCurrentLiab;
                      const totalEquityAccts       = bsEquity.reduce((s,a)=>s+getBal(a.code),0);

                      // Current year net income flows into retained earnings
                      const bsRevenue  = bsInvoices.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                      const bsExpenses = bsInvoices.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                      const ytdNet     = bsRevenue - bsExpenses;
                      // Derived soft-close split (Option A): prior fiscal years' net rolls into
                      // beginning Retained Earnings; current-period net is this FY only. Keyed off
                      // fiscal_year_end, floored at the cutoff. By construction priorNet+currentNet===ytdNet,
                      // so every total below (and the balance check) is unchanged — only the RE split changes.
                      const { priorNet: bsPriorNet, currentNet: bsCurrentNet } = fiscalYearSplit(bsInvoices, { asOf, fiscalYearEnd: companySettings?.fiscalYearEnd || "12-31", cutoffDate });
                      const beginningRE = getBal("3100") + bsPriorNet;   // posted RE + prior-years' closed net
                      const totalLiabEquity = totalLiabilities + totalEquityAccts + ytdNet;
                      const isBalanced = Math.abs(totalAssets - totalLiabEquity) < 1;

                      const AcctRow = ({a}) => {
                        const bal = getBal(a.code);
                        if (bal === 0) return null;
                        return (
                          <div onClick={()=>setDrill({scope:"bsacct",value:a.code,label:a.name})} title="View transactions"
                            onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                            style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 16px",borderBottom:"1px solid var(--sc-surface-2)",cursor:"pointer"}}>
                            <div style={{fontSize:13,color:"var(--sc-text-2)"}}>
                              <span style={{color:"var(--sc-text-mut)",marginRight:8,fontFamily:"monospace",fontSize:11}}>{a.code}</span>{a.name}
                            </div>
                            <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:bal<0?"var(--sc-error)":"var(--sc-text)"}}>{bsFmt(bal)}</div>
                          </div>
                        );
                      };
                      const SubtotalRow = ({label, total}) => (
                        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 8px 16px",marginTop:2}}>
                          <div style={{fontSize:12,fontWeight:600,color:"var(--sc-text-2)",fontStyle:"italic"}}>{label}</div>
                          <div style={{fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"var(--sc-gold)"}}>{bsFmt(total)}</div>
                        </div>
                      );
                      const SectionTitle = ({label}) => (
                        <div style={{fontSize:11,fontWeight:700,color:"var(--sc-gold)",letterSpacing:2,marginBottom:8,paddingBottom:6,borderBottom:"1px solid var(--sc-border-2)",marginTop:8}}>{label}</div>
                      );
                      const SubLabel = ({label}) => (
                        <div style={{fontSize:10,color:"var(--sc-text-2)",letterSpacing:1,marginTop:12,marginBottom:4,paddingLeft:4}}>{label}</div>
                      );
                      const TotalRow = ({label, total, large}) => (
                        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderTop:"2px solid var(--sc-border-2)",marginTop:4,marginBottom:large?0:20}}>
                          <div style={{fontSize:large?15:13,fontWeight:700}}>{label}</div>
                          <div style={{fontSize:large?16:14,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"var(--sc-gold)"}}>{bsFmt(total)}</div>
                        </div>
                      );

                      return (
                        <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,overflow:"hidden"}}>
                          <div style={{padding:"18px 24px",borderBottom:"1px solid var(--sc-border)",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontSize:14,fontWeight:600}}>Balance Sheet</div>
                              <div style={{fontSize:11,color:"var(--sc-text-2)",marginTop:3}}>As of {new Date(asOf+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})} · GAAP basis</div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              {!isBalanced && <div style={{fontSize:11,color:"var(--sc-warning)",background:"var(--sc-warning-soft)",border:"1px solid var(--sc-warning-soft)",borderRadius:8,padding:"4px 10px"}}>⚠ Out of balance by {bsFmt(Math.abs(totalAssets-totalLiabEquity))}</div>}
                              {isBalanced && <div style={{fontSize:11,color:"var(--sc-success)",background:"var(--sc-success-soft)",border:"1px solid var(--sc-success-soft)",borderRadius:8,padding:"4px 10px"}}>✓ Balanced</div>}
                            </div>
                          </div>
                          <div style={{padding:"24px 28px"}}>

                            {/* ASSETS */}
                            <SectionTitle label="ASSETS" />
                            <SubLabel label="Current Assets" />
                            {currentAssets.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Current Assets" total={totalCurrentAssets} />
                            <SubLabel label="Non-Current Assets" />
                            {nonCurrentAssets.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Non-Current Assets" total={totalNonCurrentAssets} />
                            <TotalRow label="Total Assets" total={totalAssets} />

                            {/* LIABILITIES */}
                            <SectionTitle label="LIABILITIES" />
                            <SubLabel label="Current Liabilities" />
                            {currentLiab.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Current Liabilities" total={totalCurrentLiab} />
                            <SubLabel label="Non-Current Liabilities" />
                            {nonCurrentLiab.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Non-Current Liabilities" total={totalNonCurrentLiab} />
                            <TotalRow label="Total Liabilities" total={totalLiabilities} />

                            {/* EQUITY — GAAP interim presentation */}
                            <SectionTitle label="STOCKHOLDERS' EQUITY" />

                            {/* Paid-in capital accounts (Common Stock, APIC) — show all except Retained Earnings (3100) */}
                            {bsEquity.filter(a => a.code !== "3100" && getBal(a.code) !== 0).map(a=>(
                              <div key={a.code} onClick={()=>setDrill({scope:"bsacct",value:a.code,label:a.name})} title="View transactions"
                                onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                                style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 16px",borderBottom:"1px solid var(--sc-surface-2)",cursor:"pointer"}}>
                                <div style={{fontSize:13,color:"var(--sc-text-2)"}}><span style={{color:"var(--sc-text-mut)",marginRight:8,fontFamily:"monospace",fontSize:11}}>{a.code}</span>{a.name}</div>
                                <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:getBal(a.code)<0?"var(--sc-error)":"var(--sc-text)"}}>{bsFmt(getBal(a.code))}</div>
                              </div>
                            ))}

                            {/* Retained Earnings detail (GAAP interim balance sheet): prior years' closed
                                earnings as a distinct beginning-RE line, current FY's net separately. */}
                            <SubLabel label="Retained Earnings" />
                            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 28px",borderBottom:"1px solid var(--sc-surface-2)"}}>
                              <div style={{fontSize:13,color:"var(--sc-text-2)"}}>Retained Earnings, beginning of year</div>
                              <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:beginningRE<0?"var(--sc-error)":"var(--sc-text)"}}>{beginningRE<0?"-":""}{bsFmt(Math.abs(beginningRE))}</div>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 28px",borderBottom:"1px solid var(--sc-surface-2)"}}>
                              <div style={{fontSize:13,color:"var(--sc-text-2)"}}>Net {bsCurrentNet>=0?"Income":"Loss"} (current period)</div>
                              <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:bsCurrentNet>=0?"var(--sc-success)":"var(--sc-error)"}}>{bsCurrentNet<0?"-":""}{bsFmt(Math.abs(bsCurrentNet))}</div>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0 7px 28px",borderBottom:"1px solid var(--sc-border-2)",marginBottom:2}}>
                              <div style={{fontSize:12,fontWeight:600,color:"var(--sc-text-2)",fontStyle:"italic"}}>Total Retained Earnings</div>
                              <div style={{fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"var(--sc-gold)"}}>{bsFmt(beginningRE+bsCurrentNet)}</div>
                            </div>

                            <TotalRow label="Total Stockholders' Equity" total={totalEquityAccts+ytdNet} />

                            {/* TOTAL L+E */}
                            <div style={{borderTop:"2px solid var(--sc-gold-soft)",paddingTop:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div style={{fontSize:15,fontWeight:700}}>Total Liabilities + Equity</div>
                              <div style={{fontSize:17,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"var(--sc-gold)"}}>{bsFmt(totalLiabEquity)}</div>
                            </div>

                            {openingBalances.length===0 && (
                              <div style={{marginTop:16,background:"var(--sc-warning-soft)",border:"1px solid var(--sc-warning-soft)",borderRadius:8,padding:"12px 16px",fontSize:12,color:"var(--sc-warning)"}}>
                                ⚠ No opening balances set. Go to Settings → Opening Balances to enter your starting balances for an accurate balance sheet.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* BY VENDOR */}
                    {reportType==="vendor" && drill && renderDrill()}
                    {reportType==="vendor" && !drill && (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Expenses by Vendor</div>
                          <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"var(--sc-surface-2)" }}>
                            {["Vendor","Invoices","Total Spend","% of Total"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {vendorRows.map((v,i)=>(
                              <tr key={v.name} onClick={()=>setDrill({scope:"vendor",value:v.name,label:v.name})} title="View transactions"
                                onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"var(--sc-bg)"}
                                style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)", cursor:"pointer" }}>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                    <div style={{ width:28, height:28, borderRadius:7, background:vendorColor(v.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--sc-on-accent)" }}>{initials(v.name)}</div>
                                    <span style={{ fontSize:13, fontWeight:500 }}>{v.name}</span>
                                  </div>
                                </td>
                                <td style={{ padding:"13px 20px", fontSize:13, color:"var(--sc-text-2)" }}>{v.count}</td>
                                <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-text)" }}>{fmt(v.total)}</td>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ height:6, width:80, background:"var(--sc-border)", borderRadius:3 }}>
                                      <div className="sc-bar" style={{ height:"100%", width:`${Math.min(100,(v.total/(expenses||1))*100)}%`, background:vendorColor(v.name), borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:12, color:"var(--sc-text-2)", fontFamily:"'DM Mono', monospace" }}>{expenses>0?((v.total/expenses)*100).toFixed(1):0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* BY GL CATEGORY */}
                    {reportType==="gl" && drill && renderDrill()}
                    {reportType==="gl" && !drill && (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Expenses by GL Category</div>
                          <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"var(--sc-surface-2)" }}>
                            {["GL Account","Transactions","Amount","% of Expenses"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {glRows.map((row,i)=>(
                              <tr key={row.code} onClick={()=>setDrill({scope:"gl",value:row.code,label:row.name})} title="View transactions"
                                onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"var(--sc-bg)"}
                                style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)", cursor:"pointer" }}>
                                <td style={{ padding:"13px 20px" }}>
                                  <span style={{ background:"var(--sc-border)", padding:"3px 10px", borderRadius:20, fontSize:12, color:"var(--sc-gold)" }}>{row.code} · {row.name}</span>
                                </td>
                                <td style={{ padding:"13px 20px", fontSize:13, color:"var(--sc-text-2)" }}>{row.count}</td>
                                <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-error)" }}>({fmt(row.total)})</td>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ height:6, width:80, background:"var(--sc-border)", borderRadius:3 }}>
                                      <div className="sc-bar" style={{ height:"100%", width:`${Math.min(100,(row.total/(expenses||1))*100)}%`, background:"var(--sc-gold)", borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:12, color:"var(--sc-text-2)", fontFamily:"'DM Mono', monospace" }}>{expenses>0?((row.total/expenses)*100).toFixed(1):0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* CASH FLOW */}
                    {reportType==="cashflow" && drill && renderDrill()}
                    {reportType==="cashflow" && !drill && (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div style={{ fontSize:14, fontWeight:600 }}>Cash Flow Statement</div>
                            <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:3 }}>Cash basis — collected receipts and paid expenses only</div>
                          </div>
                          <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        {cashRows.length===0 ? <div style={{ padding:24, color:"var(--sc-text-2)", fontSize:13 }}>No cash transactions recorded yet. Mark invoices as paid/collected to see cash flow.</div> : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr style={{ background:"var(--sc-surface-2)" }}>
                              {["Month","Inflow","Outflow","Net","Running"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                            </tr></thead>
                            <tbody>
                              {cashRows.map((row,i)=>{
                                const net = row.inflow - row.outflow;
                                const running = cashRows.slice(0,i+1).reduce((s,r)=>s+(r.inflow-r.outflow),0);
                                return (
                                  <tr key={row.month} onClick={()=>setDrill({scope:"cashflow",value:row.month,label:fmtDate(`${row.month}-01`,{month:"short",year:"numeric"})})} title="View transactions"
                                    onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"var(--sc-bg)"}
                                    style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)", cursor:"pointer" }}>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontWeight:500 }}>{fmtDate(`${row.month}-01`,{month:"short",year:"numeric"})}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-success)" }}>{fmt(row.inflow)}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-error)" }}>({fmt(row.outflow)})</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:net>=0?"var(--sc-success)":"var(--sc-error)" }}>{net<0?"-":""}{fmt(net)}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:running>=0?"var(--sc-text)":"var(--sc-error)" }}>{running<0?"-":""}{fmt(running)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {/* BY PROJECT */}
                    {reportType==="project" && drill && renderDrill()}
                    {reportType==="project" && !drill && (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Project Cost Breakdown</div>
                          <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"var(--sc-surface-2)" }}>
                            {["Project","Transactions","Revenue","Expenses","Net"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {projectRows.map((p,i)=>{
                              const pnet = p.revenue - p.expenses;
                              return (
                                <tr key={p.name} onClick={()=>setDrill({scope:"project",value:p.name,label:p.name})} title="View transactions"
                                  onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background=i%2===0?"transparent":"var(--sc-bg)"}
                                  style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)", cursor:"pointer" }}>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontWeight:500, color:"var(--sc-gold)" }}>{p.name}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, color:"var(--sc-text-2)" }}>{p.count}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-success)" }}>{fmt(p.revenue)}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"var(--sc-error)" }}>({fmt(p.expenses)})</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:pnet>=0?"var(--sc-success)":"var(--sc-error)" }}>{pnet<0?"-":""}{fmt(pnet)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* ── AR / AP AGING (Items 24, 83) ── */}
                    {(reportType==="araging" || reportType==="apaging") && (() => {
                      const side = reportType==="araging" ? "ar" : "ap";
                      const rep = agingReport(invoices, side);
                      // Headline total derives from the GL (single source — matches the Balance
                      // Sheet, Dashboard, and Payables/Receivables). The age buckets remain a
                      // due-date view; in clean books they sum to this total.
                      const agingTotal = glAccountBalance(getAccountByRole(side==="ar"?"accounts_receivable":"accounts_payable")?.code, invoices);
                      const today = new Date().toISOString().slice(0,10);
                      const sevColor = d => d>90?"var(--sc-error)":d>60?"var(--sc-warning)":d>30?"#CA8504":d>0?"var(--sc-text-2)":"var(--sc-success)";
                      const csvBtn = { background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:9, padding:"8px 14px", fontSize:12, color:"var(--sc-text-2)", cursor:"pointer", fontWeight:600 };
                      const exportCsv = () => { const rows=[]; rep.buckets.forEach(b=>b.rows.forEach(r=>rows.push([b.label,r.party,r.date||"",r.due_date||"",r.days_overdue,r.amount]))); downloadCSV(`${side}-aging-${today}.csv`, ["Bucket", side==="ar"?"Customer":"Vendor","Invoice Date","Due Date","Days Overdue","Amount"], rows); };
                      return (
                        <div className="sc-rise">
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end", marginBottom:16, flexWrap:"wrap", gap:12 }}>
                            <div>
                              <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:1, marginBottom:4 }}>{side==="ar"?"TOTAL OUTSTANDING RECEIVABLE":"TOTAL OUTSTANDING PAYABLE"}</div>
                              <div style={{ fontSize:30, fontWeight:700, fontFamily:"'DM Mono',monospace", color: side==="ar"?"var(--sc-success)":"var(--sc-error)" }}>{fmt(agingTotal)}</div>
                              <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2 }}>{rep.count} open {side==="ar"?"invoice":"bill"}{rep.count!==1?"s":""}</div>
                            </div>
                            <button onClick={exportCsv} style={csvBtn}>↓ Export CSV</button>
                          </div>
                          <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:10, marginBottom:18 }}>
                            {rep.buckets.map(b=>(
                              <div key={b.key} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:10, padding:"12px 14px" }}>
                                <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{b.label}</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:b.key==="90+"&&b.total>0?"var(--sc-error)":"var(--sc-text)" }}>{fmt(b.total)}</div>
                                <div style={{ fontSize:10, color:"var(--sc-text-mut)" }}>{b.count} item{b.count!==1?"s":""}</div>
                              </div>
                            ))}
                          </div>
                          {agingTotal===0 && rep.total===0 ? <div style={{ padding:24, fontSize:14, color:"var(--sc-text-2)" }}>Nothing outstanding — you're all caught up.</div> :
                            rep.buckets.filter(b=>b.rows.length).map(b=>(
                              <div key={b.key} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, overflow:"clip", marginBottom:14 }}>
                                <div style={{ padding:"12px 18px", background:"var(--sc-bg)", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between", fontSize:13, fontWeight:600 }}>
                                  <span>{b.label}</span><span style={{ fontFamily:"'DM Mono',monospace" }}>{fmt(b.total)}</span>
                                </div>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <tbody>
                                    {b.rows.map(r=>(
                                      <tr key={r.id} style={{ borderBottom:"1px solid var(--sc-border)", height:50 }}>
                                        <td onClick={()=>setDrillSel(r.id)} style={{ padding:"0 18px", cursor:"pointer", fontSize:13, fontWeight:500 }}>
                                          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                            <span style={{ width:28,height:28,borderRadius:8,background:vendorColor(r.party),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"var(--sc-on-accent)",flexShrink:0 }}>{initials(r.party)}</span>
                                            {r.party}
                                          </div>
                                        </td>
                                        <td style={{ padding:"0 12px", fontSize:12, color:"var(--sc-text-mut)", whiteSpace:"nowrap" }}>{r.date?fmtDate(r.date):"—"}</td>
                                        <td style={{ padding:"0 12px", fontSize:12, color:"var(--sc-text-mut)", whiteSpace:"nowrap" }}>Due {r.due_date?fmtDate(r.due_date):"—"}</td>
                                        <td style={{ padding:"0 12px", fontSize:12, fontWeight:600, color:sevColor(r.days_overdue), whiteSpace:"nowrap" }}>{r.days_overdue>0?`${r.days_overdue}d overdue`:"Not yet due"}</td>
                                        <td style={{ padding:"0 12px", textAlign:"right", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace" }}>{fmt(r.amount)}</td>
                                        <td style={{ padding:"0 16px", textAlign:"right", whiteSpace:"nowrap" }}>
                                          {side==="ar" && r.days_overdue>0 && (
                                            <a href={`mailto:${r.email||""}?subject=${encodeURIComponent(`Payment reminder from ${companySettings.name||"us"}`)}&body=${encodeURIComponent(`Hi ${r.party},\n\nA friendly reminder that ${fmt(r.amount)} is now ${r.days_overdue} days past due. Could you let us know when we can expect payment?\n\nThank you,\n${companySettings.name||""}`)}`}
                                              style={{ fontSize:12, color:"var(--sc-gold)", textDecoration:"none", fontWeight:600 }}>Send reminder →</a>
                                          )}
                                          {side==="ap" && (
                                            <button onClick={()=>{ markPaid && markPaid(r.id, "ach", { date: today }); }} style={{ fontSize:12, color:"var(--sc-success)", background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:7, padding:"5px 12px", cursor:"pointer", fontWeight:600 }}>Mark Paid</button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                        </div>
                      );
                    })()}

                    {/* ── TRIAL BALANCE (Item 100) ── */}
                    {reportType==="trial" && (() => {
                      const tb = trialBalance(invoices, { includeVoided: !tbAdjusted });
                      const csvBtn = { background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:9, padding:"8px 14px", fontSize:12, color:"var(--sc-text-2)", cursor:"pointer", fontWeight:600 };
                      const exportCsv = () => downloadCSV(`trial-balance-${new Date().toISOString().slice(0,10)}.csv`, ["Code","Account","Debit","Credit"], [...tb.accounts.map(a=>[a.code,a.name,a.debit||"",a.credit||""]), ["","TOTAL",tb.totalDebit,tb.totalCredit]]);
                      return (
                        <div className="sc-rise">
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14, gap:12, flexWrap:"wrap" }}>
                            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                              {[["Adjusted",true],["Unadjusted",false]].map(([lbl,adj])=>(
                                <button key={lbl} onClick={()=>setTbAdjusted(adj)} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, border:`1px solid ${tbAdjusted===adj?"var(--sc-gold)":"var(--sc-border-2)"}`, background:tbAdjusted===adj?"var(--sc-gold-soft)":"transparent", color:tbAdjusted===adj?"var(--sc-gold)":"var(--sc-text-2)", cursor:"pointer", fontWeight:tbAdjusted===adj?600:400 }}>{lbl}</button>
                              ))}
                              <span style={{ fontSize:11, color:"var(--sc-text-mut)" }}>{tbAdjusted?"Excludes voided / soft-deleted":"All posted entries (incl. voided)"}</span>
                            </div>
                            <button onClick={exportCsv} style={csvBtn}>↓ Export CSV</button>
                          </div>
                          <div style={{ background: tb.balanced?"var(--sc-success-soft)":"var(--sc-error-soft)", border:`1px solid ${tb.balanced?"var(--sc-success-soft)":"var(--sc-error-soft)"}`, borderRadius:10, padding:"12px 16px", marginBottom:14, fontSize:13, fontWeight:600, color: tb.balanced?"var(--sc-success)":"var(--sc-error)" }}>
                            {tb.balanced ? "✓ Books are in balance" : `⚠ Books are out of balance by ${fmt(tb.difference)}`}
                          </div>
                          <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, overflow:"clip" }}>
                            <table style={{ width:"100%", borderCollapse:"collapse" }}>
                              <thead><tr style={{ background:"var(--sc-bg)" }}>
                                {["Code","Account","Debit","Credit"].map((h,ci)=><th key={ci} style={{ padding:"10px 16px", textAlign:ci>=2?"right":"left", fontSize:12, color:"var(--sc-text-mut)", fontWeight:600, borderBottom:"1px solid var(--sc-border)" }}>{h.toUpperCase()}</th>)}
                              </tr></thead>
                              <tbody>
                                {tb.accounts.map(a=>(
                                  <tr key={a.code} style={{ borderBottom:"1px solid var(--sc-border)", height:44 }}>
                                    <td style={{ padding:"0 16px", fontFamily:"'DM Mono',monospace", fontSize:12, color:"var(--sc-text-mut)" }}>{a.code}</td>
                                    <td style={{ padding:"0 16px", fontSize:13 }}>{a.name}</td>
                                    <td style={{ padding:"0 16px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:13 }}>{a.debit?fmt(a.debit):""}</td>
                                    <td style={{ padding:"0 16px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:13 }}>{a.credit?fmt(a.credit):""}</td>
                                  </tr>
                                ))}
                                <tr style={{ background:"var(--sc-bg)", fontWeight:700 }}>
                                  <td/><td style={{ padding:"12px 16px", fontSize:13 }}>TOTAL</td>
                                  <td style={{ padding:"12px 16px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:13, color: tb.balanced?"var(--sc-text)":"var(--sc-error)" }}>{fmt(tb.totalDebit)}</td>
                                  <td style={{ padding:"12px 16px", textAlign:"right", fontFamily:"'DM Mono',monospace", fontSize:13, color: tb.balanced?"var(--sc-text)":"var(--sc-error)" }}>{fmt(tb.totalCredit)}</td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── KPIs (Item 33) ── */}
                    {reportType==="kpis" && (() => {
                      const kpis = computeKPIs(invoices, { cashBalance: glCash });
                      const SC = { good:{c:"var(--sc-success)",bg:"var(--sc-success-soft)",b:"var(--sc-success-soft)",lbl:"Healthy"}, warn:{c:"var(--sc-warning)",bg:"var(--sc-warning-soft)",b:"#FEDF89",lbl:"Watch"}, bad:{c:"var(--sc-error)",bg:"var(--sc-error-soft)",b:"var(--sc-error-soft)",lbl:"Action needed"}, na:{c:"var(--sc-text-mut)",bg:"var(--sc-bg)",b:"var(--sc-border)",lbl:"—"} };
                      const trendIcon = { up:"↑", down:"↓", flat:"→" };
                      return (
                        <div className="sc-rise" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(290px,1fr))", gap:14 }}>
                          {kpis.map(k=>{ const s=SC[k.status]||SC.na; return (
                            <div key={k.key} style={{ background:"var(--sc-surface)", border:`1px solid ${s.b}`, borderRadius:12, padding:"18px 20px" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8, gap:8 }}>
                                <div style={{ fontSize:13, fontWeight:600, color:"var(--sc-text-2)" }}>{k.label}</div>
                                <span style={{ fontSize:10, fontWeight:700, color:s.c, background:s.bg, border:`1px solid ${s.b}`, borderRadius:6, padding:"2px 8px", whiteSpace:"nowrap" }}>{s.lbl}</span>
                              </div>
                              <div style={{ display:"flex", alignItems:"baseline", gap:8, flexWrap:"wrap" }}>
                                <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color:s.c }}>{k.display}</div>
                                {k.trend && <span style={{ fontSize:12, color: k.trend==="flat"?"var(--sc-text-mut)":"var(--sc-text-2)", fontWeight:600 }}>{trendIcon[k.trend]} vs last mo</span>}
                              </div>
                              <div style={{ fontSize:12, color:"var(--sc-text-2)", lineHeight:1.5, marginTop:8 }}>{k.explanation}</div>
                            </div>
                          ); })}
                        </div>
                      );
                    })()}

                    {/* Ask AI button */}
                    <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end" }}>
                      <button onClick={()=>{ setChatOpen(true); setChatInput(`Give me a detailed analysis of my ${reportType==="pl"?"profit and loss":reportType==="vendor"?"vendor spend":reportType==="gl"?"expense categories":reportType==="cashflow"?"cash flow":"project costs"} for ${rangeLabels[reportRange]}`); }} style={{ background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", borderRadius:10, padding:"10px 20px", fontSize:13, cursor:"pointer" }}>
                        ✦ Ask AI to analyze this report
                      </button>
                    </div>

                    {/* Shared transaction detail slide-in for all report drill-downs */}
                    <TransactionDetailPanel invoiceId={drillSel} onClose={()=>setDrillSel(null)} returnContext={reportReturn} />
                  </div>
                )}
              </div>
            );
}
