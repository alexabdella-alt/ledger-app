import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { computeAP, openPayables, paidPayables } from "../../lib/reports";

export default function ApView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, requestInfo, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setReturnTo, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  const [payFormId, setPayFormId] = React.useState(null);
  const [payDate, setPayDate] = React.useState(new Date().toISOString().slice(0,10));
  const [payMethod, setPayMethod] = React.useState("ach");
  const [payRef, setPayRef] = React.useState("");
  const [payNotes, setPayNotes] = React.useState("");

  const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
  const today = new Date().toISOString().slice(0,10);

  // Canonical AP lists — the rows behind computeAP, so the bills shown reconcile
  // exactly with the headline total below, the AP aging report, and the AI.
  // (No inline AP math here — see openPayables/paidPayables in lib/reports.js.)
  const unpaid = openPayables(invoices).sort((a,b)=>(a.due_date||"9999").localeCompare(b.due_date||"9999"));
  const paid   = paidPayables(invoices).sort((a,b)=>(b.paid_at||"").localeCompare(a.paid_at||""));
  const unpaidTotal = computeAP(invoices).total;   // canonical — matches the dashboard, reports, and AI

  const methodOpts = [["ach","ACH / Bank Transfer"],["check","Check"],["wire","Wire Transfer"],["card","Credit Card"],["zelle","Zelle"],["venmo","Venmo"],["paypal","PayPal"],["other","Other"]];
  const methodLabel = m => (methodOpts.find(([v])=>v===m)?.[1]) || (m?String(m).toUpperCase():"—");

  // Vendor → contact lookup (case-insensitive)
  const contactByName = {};
  (contacts||[]).forEach(c => { if (c.name) contactByName[c.name.toLowerCase()] = c; });
  const normalizeUrl = u => !u ? null : (/^https?:\/\//i.test(u) ? u : "https://"+u);
  const payLink = (inv) => {
    const c = contactByName[(inv.vendor||"").toLowerCase()];
    if (c?.payment_url) return { url: normalizeUrl(c.payment_url), label: "Pay on vendor portal →" };
    const n = (inv.vendor||"").toLowerCase();
    if (/\bgoogle\b/.test(n))            return { url:"https://payments.google.com", label:"Pay on Google →" };
    if (/amazon|\baws\b/.test(n))        return { url:"https://aws.amazon.com/billing", label:"Pay on AWS →" };
    if (/microsoft|azure/.test(n))       return { url:"https://azure.microsoft.com/billing", label:"Pay on Azure →" };
    if (/stripe/.test(n))                return { url:"https://dashboard.stripe.com/billing", label:"Pay on Stripe →" };
    if (c?.website) return { url: normalizeUrl(c.website), label: "Pay on vendor site →" };
    return null;
  };
  const vendorSite = (inv) => { const c = contactByName[(inv.vendor||"").toLowerCase()]; return c?.website ? normalizeUrl(c.website) : null; };

  const openForm = (inv) => { setPayFormId(inv.id); setPayDate(today); setPayMethod("ach"); setPayRef(""); setPayNotes(""); };
  const confirmPay = (inv) => { markPaid(inv.id, payMethod, { date: payDate, reference: payRef, notes: payNotes }); setPayFormId(null); };

  const Avatar = ({name,size=38}) => <div style={{ width:size,height:size,borderRadius:10,background:vendorColor(name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.34,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(name)}</div>;
  const fieldLabel = { fontSize:10, color:"#475467", letterSpacing:1, marginBottom:5, fontWeight:500 };
  const fieldInput = { width:"100%", boxSizing:"border-box", background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:8, padding:"9px 11px", color:"#101828", fontSize:13, outline:"none", fontFamily:"'DM Sans',sans-serif" };

  const tabs = [["unpaid","Unpaid",unpaid.length],["paid","Paid",paid.length]];
  const active = apView==="paid" ? "paid" : "unpaid";

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:8 }}>MONEY OUT</div>
        <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Bills & Payments</h1>
        <div style={{ fontSize:13, color:"#475467", marginTop:6 }}>Your outstanding bills and payment history. Mark a bill paid in one step — it's logged to the audit trail.</div>
      </div>

      {/* Summary */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:18 }}>
        <div onClick={()=>setApView("unpaid")} className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:"16px 20px", cursor:"pointer" }}>
          <div style={{ fontSize:10, color:"#475467", letterSpacing:1.5, marginBottom:8 }}>OUTSTANDING · UNPAID</div>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
            <div style={{ fontSize:24, fontWeight:700, color:"#D92D20", fontFamily:"'DM Mono',monospace" }}>{fmt(unpaidTotal)}</div>
            <div style={{ fontSize:13, color:"#475467" }}>{unpaid.length} bill{unpaid.length!==1?"s":""}</div>
          </div>
        </div>
        <div onClick={()=>setApView("paid")} className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:"16px 20px", cursor:"pointer" }}>
          <div style={{ fontSize:10, color:"#475467", letterSpacing:1.5, marginBottom:8 }}>PAID</div>
          <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
            <div style={{ fontSize:24, fontWeight:700, color:"#039855", fontFamily:"'DM Mono',monospace" }}>{fmt(paid.reduce((s,i)=>s+i.amount,0))}</div>
            <div style={{ fontSize:13, color:"#475467" }}>{paid.length} payment{paid.length!==1?"s":""}</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:18, borderBottom:"1px solid #E4E7EC" }}>
        {tabs.map(([id,label,count])=>(
          <button key={id} onClick={()=>setApView(id)} style={{ padding:"9px 18px", borderRadius:"8px 8px 0 0", fontSize:13, fontWeight:active===id?600:400, background:"transparent", border:"none", borderBottom:active===id?"2px solid #4F46E5":"2px solid transparent", color:active===id?"#4F46E5":"#475467", cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
            {label}
            {count>0 && <span style={{ fontSize:10, fontWeight:700, color:active===id?"#fff":"#374151", background:active===id?"#4F46E5":"#E4E7EC", borderRadius:20, padding:"1px 7px" }}>{count}</span>}
          </button>
        ))}
      </div>

      {/* ── UNPAID ── */}
      {active==="unpaid" && (
        unpaid.length===0
          ? <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:48, textAlign:"center", color:"#475467" }}><div style={{ fontSize:30, marginBottom:10 }}>🎉</div><div style={{ fontSize:14, color:"#101828", marginBottom:4 }}>All caught up</div>No outstanding bills. Upload a bill and it'll appear here.</div>
          : <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {unpaid.map(inv=>{
                const link = payLink(inv);
                const overdue = inv.due_date && inv.due_date < today;
                return (
                  <div key={inv.id} className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:"16px 18px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:13, minWidth:0 }}>
                        <Avatar name={inv.vendor} />
                        <div style={{ minWidth:0 }}>
                          <div style={{ fontSize:14, fontWeight:600, color:"#101828", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"Unknown vendor"}</div>
                          <div style={{ fontSize:11, color:"#475467", display:"flex", gap:10, flexWrap:"wrap", marginTop:2, alignItems:"center" }}>
                            <span style={{ fontFamily:"'DM Mono',monospace", background:"#F3F4F6", padding:"1px 6px", borderRadius:4, color:"#374151" }}>{inv.gl_code} · {inv.gl_name}</span>
                            <span style={{ color: overdue ? "#D92D20" : "#475467" }}>{inv.due_date ? `Due ${fmtDate(inv.due_date)}${overdue?" · overdue":""}` : "No due date"}</span>
                            {link && <a href={link.url} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()} style={{ color:"#4F46E5", fontWeight:600, textDecoration:"none" }}>{link.label}</a>}
                          </div>
                        </div>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                        <div style={{ fontSize:17, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>{fmt(inv.amount)}</div>
                        {payFormId!==inv.id && <button onClick={()=>openForm(inv)} style={{ padding:"8px 16px", borderRadius:9, fontSize:13, fontWeight:600, background:"#4F46E5", border:"none", color:"#fff", cursor:"pointer" }}>Mark as Paid</button>}
                      </div>
                    </div>

                    {payFormId===inv.id && (
                      <div className="sc-rise" style={{ marginTop:14, paddingTop:14, borderTop:"1px solid #E4E7EC" }}>
                        <div style={{ display:"grid", gridTemplateColumns:"1fr 1.4fr 1fr", gap:12, marginBottom:12 }}>
                          <div><div style={fieldLabel}>PAYMENT DATE</div><input type="date" value={payDate} onChange={e=>setPayDate(e.target.value)} style={fieldInput} /></div>
                          <div><div style={fieldLabel}>PAYMENT METHOD</div>
                            <select value={payMethod} onChange={e=>setPayMethod(e.target.value)} style={fieldInput}>
                              {methodOpts.map(([v,l])=><option key={v} value={v}>{l}</option>)}
                            </select>
                          </div>
                          <div><div style={fieldLabel}>REFERENCE / CHECK #</div><input value={payRef} onChange={e=>setPayRef(e.target.value)} placeholder="optional" style={fieldInput} /></div>
                        </div>
                        <div style={{ marginBottom:12 }}><div style={fieldLabel}>NOTES</div><input value={payNotes} onChange={e=>setPayNotes(e.target.value)} placeholder="optional note for the audit trail" style={fieldInput} /></div>
                        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
                          {vendorSite(inv) && <a href={vendorSite(inv)} target="_blank" rel="noopener noreferrer" style={{ fontSize:12, color:"#4F46E5", fontWeight:600, textDecoration:"none", border:"1px solid #E4E7EC", borderRadius:8, padding:"8px 12px" }}>Open Vendor Portal →</a>}
                          <button onClick={()=>confirmPay(inv)} style={{ marginLeft:"auto", padding:"9px 18px", borderRadius:9, fontSize:13, fontWeight:600, background:"#039855", border:"none", color:"#fff", cursor:"pointer" }}>✓ Confirm Payment</button>
                          <button onClick={()=>setPayFormId(null)} style={{ padding:"9px 14px", borderRadius:9, fontSize:13, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#374151", cursor:"pointer" }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
      )}

      {/* ── PAID ── */}
      {active==="paid" && (
        paid.length===0
          ? <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:48, textAlign:"center", color:"#475467" }}><div style={{ fontSize:30, marginBottom:10 }}>💸</div>No payments recorded yet.</div>
          : <div className="sc-card" style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"clip" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr style={{ background:"#F3F4F6" }}>{["Vendor","GL Account","Method","Reference","Date Paid","Amount"].map(h=><th key={h} style={{ padding:"12px 18px", textAlign:h==="Amount"?"right":"left", fontSize:11, color:"#475467", letterSpacing:1, fontWeight:600, borderBottom:"1px solid #E4E7EC" }}>{h.toUpperCase()}</th>)}</tr></thead>
                <tbody>
                  {paid.map((inv,i)=>(
                    <tr key={inv.id} onClick={()=>{ setReturnTo({view:"ap",label:"Payables"}); setSelectedInvoice(inv); setView("detail"); }} style={{ cursor:"pointer", background:i%2?"#F9FAFB":"#FFFFFF", borderBottom:"1px solid #F3F4F6" }} onMouseEnter={e=>e.currentTarget.style.background="#EEF2FF"} onMouseLeave={e=>e.currentTarget.style.background=i%2?"#F9FAFB":"#FFFFFF"}>
                      <td style={{ padding:"12px 18px" }}><div style={{ display:"flex", alignItems:"center", gap:10 }}><Avatar name={inv.vendor} size={28} /><span style={{ fontSize:13, fontWeight:500, color:"#101828" }}>{inv.vendor}</span></div></td>
                      <td style={{ padding:"12px 18px", fontSize:12, color:"#475467", fontFamily:"'DM Mono',monospace" }}>{inv.gl_code}</td>
                      <td style={{ padding:"12px 18px" }}><span style={{ fontSize:11, fontWeight:600, color:"#4F46E5", background:"#EEF2FF", border:"1px solid #E4E7EC", borderRadius:20, padding:"2px 10px" }}>{methodLabel(inv.payment_method_used)}</span></td>
                      <td style={{ padding:"12px 18px", fontSize:12, color:"#475467" }}>{inv.payment_reference || "—"}</td>
                      <td style={{ padding:"12px 18px", fontSize:12, color:"#475467" }}>{inv.paid_at ? fmtDate(inv.paid_at) : "—"}</td>
                      <td style={{ padding:"12px 18px", textAlign:"right", fontSize:14, fontWeight:600, fontFamily:"'DM Mono',monospace", color:"#039855" }}>{fmt(inv.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      )}
    </div>
  );
}
