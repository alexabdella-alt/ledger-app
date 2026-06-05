import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ApView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, requestInfo, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  const [payPickerId, setPayPickerId] = React.useState(null);
  const [rejectId, setRejectId] = React.useState(null);
  const [rejectText, setRejectText] = React.useState("");
  const [infoId, setInfoId] = React.useState(null);
  const [infoText, setInfoText] = React.useState("");

  const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
  const today = new Date().toISOString().slice(0,10);
  const weekFromNow = new Date(Date.now()+7*86400000).toISOString().slice(0,10);

  // All payables (expense entries)
  const apAll = invoices.filter(i => (glIsExpense(i.gl_code) || i.type==="expense") && i.status!=="voided");
  const isPaidI = i => i.payment_status==="paid";
  const isRejectedI = i => i.approval_status==="rejected";
  const isApprovedI = i => (i.approval_status==="approved"||i.approval_status==="auto_approved") && !isPaidI(i) && !isRejectedI(i);
  const inbox    = apAll.filter(i => !isPaidI(i) && !isRejectedI(i) && i.approval_status!=="approved" && i.approval_status!=="auto_approved")
                       .sort((a,b)=>(a.due_date||"9999").localeCompare(b.due_date||"9999"));
  const approved = apAll.filter(isApprovedI).sort((a,b)=>(a.due_date||"9999").localeCompare(b.due_date||"9999"));
  const paid     = apAll.filter(isPaidI).sort((a,b)=>(b.paid_at||"").localeCompare(a.paid_at||""));
  const rejected = apAll.filter(isRejectedI).sort((a,b)=>(b.rejected_at||"").localeCompare(a.rejected_at||""));

  const approvedTotal = approved.reduce((s,i)=>s+i.amount,0);
  const dueThisWeek   = approved.filter(i=>i.due_date && i.due_date<=weekFromNow).reduce((s,i)=>s+i.amount,0);

  const methods = [["check","Check"],["ach","ACH"],["wire","Wire"],["card","Credit Card"],["other","Other"]];
  const methodLabel = m => ({check:"Check",ach:"ACH",wire:"Wire",card:"Credit Card",other:"Other"}[m] || (m?String(m).toUpperCase():"—"));
  const payNow = () => showNotification("Coming Soon — Integrated payments launching soon ✦");

  const statusBadge = (inv) => {
    const map = {
      approved:        ["#10B981","Approved"],
      auto_approved:   ["#10B981","Auto-approved"],
      rejected:        ["#86868F","Rejected"],
      info_requested:  ["#0EA5E9","Info requested"],
      flagged:         ["#EF4444","Flagged"],
      pending_approval:["#F59E0B","Pending review"],
    };
    const [c,l] = map[inv.approval_status] || ["#F59E0B","Pending review"];
    return <span style={{ fontSize:10, fontWeight:600, color:c, background:c+"22", border:`1px solid ${c}44`, borderRadius:20, padding:"2px 9px" }}>{l}</span>;
  };

  const tabs = [["inbox","Inbox",inbox.length],["approved","Approved",approved.length],["paid","Paid",paid.length],["rejected","Rejected",rejected.length],["aging","Aging",null]];
  const active = ["inbox","approved","paid","rejected","aging"].includes(apView) ? apView : "inbox";

  // Shared row chrome
  const Avatar = ({name,size=38}) => <div style={{ width:size,height:size,borderRadius:10,background:vendorColor(name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.34,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(name)}</div>;

  const InvoiceMeta = ({inv}) => (
    <div style={{ display:"flex", alignItems:"center", gap:13, minWidth:0 }}>
      <Avatar name={inv.vendor} />
      <div style={{ minWidth:0 }}>
        <div style={{ fontSize:14, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor||"Unknown vendor"}</div>
        <div style={{ fontSize:11, color:"#86868F", display:"flex", gap:10, flexWrap:"wrap", marginTop:2 }}>
          <span style={{ fontFamily:"'DM Mono',monospace", background:"#1C1C20", padding:"1px 6px", borderRadius:4, color:"#9A9AA2" }}>{inv.gl_code} · {inv.gl_name}</span>
          {inv.due_date && <span style={{ color: inv.due_date<today ? "#EF4444" : "#86868F" }}>Due {inv.due_date}{inv.due_date<today?" · overdue":""}</span>}
          {!inv.due_date && <span>No due date</span>}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom:18 }}>
        <div style={{ fontSize:10, letterSpacing:3, color:"#86868F", marginBottom:8 }}>MONEY OUT</div>
        <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Accounts Payable</h1>
        <div style={{ fontSize:13, color:"#86868F", marginTop:6 }}>Review, approve, and pay your bills — every action is logged to the audit trail.</div>
      </div>

      {/* Summary chips */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:18 }}>
        {[
          ["PENDING REVIEW", inbox.length, fmt(inbox.reduce((s,i)=>s+i.amount,0)), "#F59E0B", "inbox"],
          ["APPROVED · TO PAY", approved.length, fmt(approvedTotal), "#10B981", "approved"],
          ["PAID", paid.length, fmt(paid.reduce((s,i)=>s+i.amount,0)), "#C7BFFF", "paid"],
          ["REJECTED", rejected.length, fmt(rejected.reduce((s,i)=>s+i.amount,0)), "#86868F", "rejected"],
        ].map(([label,count,amt,color,tab])=>(
          <div key={label} onClick={()=>setApView(tab)} style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:"16px 18px", cursor:"pointer", transition:"border-color .2s" }}
            onMouseEnter={e=>e.currentTarget.style.borderColor=color} onMouseLeave={e=>e.currentTarget.style.borderColor="#1C1C20"}>
            <div style={{ fontSize:10, color:"#86868F", letterSpacing:1.5, marginBottom:8 }}>{label}</div>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
              <div style={{ fontSize:24, fontWeight:700, color }}>{count}</div>
              <div style={{ fontSize:13, color:"#9A9AA2", fontFamily:"'DM Mono',monospace" }}>{amt}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:"flex", gap:6, marginBottom:18, borderBottom:"1px solid #1C1C20", paddingBottom:2 }}>
        {tabs.map(([id,label,count])=>(
          <button key={id} onClick={()=>setApView(id)} style={{ padding:"9px 16px", borderRadius:"8px 8px 0 0", fontSize:13, fontWeight:active===id?600:400, background:"transparent", border:"none", borderBottom:active===id?"2px solid #8B7BFF":"2px solid transparent", color:active===id?"#F2F2F4":"#86868F", cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
            {label}
            {count>0 && <span style={{ fontSize:10, fontWeight:700, color:active===id?"#0C0C0E":"#0C0C0E", background:active===id?"#8B7BFF":"#33333A", borderRadius:20, padding:"1px 7px" }}>{count}</span>}
          </button>
        ))}
      </div>

      {/* ── INBOX ── */}
      {active==="inbox" && (
        inbox.length===0
          ? <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:48, textAlign:"center", color:"#86868F" }}><div style={{ fontSize:30, marginBottom:10 }}>📥</div><div style={{ fontSize:14, color:"#F2F2F4", marginBottom:4 }}>Inbox zero</div>No bills pending review. Upload a bill and it'll land here.</div>
          : <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {inbox.map(inv=>(
                <div key={inv.id} className="sc-card" style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:"16px 18px" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                    <InvoiceMeta inv={inv} />
                    <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                      {statusBadge(inv)}
                      <div style={{ fontSize:17, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(inv.amount)}</div>
                    </div>
                  </div>
                  {inv.approval_status==="info_requested" && inv.approval_reason && <div style={{ marginTop:10, fontSize:12, color:"#0EA5E9", background:"#0EA5E911", border:"1px solid #0EA5E933", borderRadius:8, padding:"7px 12px" }}>ℹ {inv.approval_reason}</div>}
                  {rejectId===inv.id ? (
                    <div style={{ marginTop:12, display:"flex", gap:8 }}>
                      <input autoFocus value={rejectText} onChange={e=>setRejectText(e.target.value)} placeholder="Reason for rejection…" onKeyDown={e=>{ if(e.key==="Enter"){ rejectInvoice(inv.id, rejectText); setRejectId(null); setRejectText(""); } }}
                        style={{ flex:1, background:"#0C0C0E", border:"1px solid #262629", borderRadius:8, padding:"8px 12px", color:"#F2F2F4", fontSize:13, outline:"none" }} />
                      <button onClick={()=>{ rejectInvoice(inv.id, rejectText); setRejectId(null); setRejectText(""); }} style={{ padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#3B0A0A", border:"1px solid #EF444444", color:"#FCA5A5", cursor:"pointer" }}>Confirm reject</button>
                      <button onClick={()=>{ setRejectId(null); setRejectText(""); }} style={{ padding:"8px 12px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #262629", color:"#86868F", cursor:"pointer" }}>Cancel</button>
                    </div>
                  ) : infoId===inv.id ? (
                    <div style={{ marginTop:12, display:"flex", gap:8 }}>
                      <input autoFocus value={infoText} onChange={e=>setInfoText(e.target.value)} placeholder="What info do you need?" onKeyDown={e=>{ if(e.key==="Enter"){ requestInfo(inv.id, infoText); setInfoId(null); setInfoText(""); } }}
                        style={{ flex:1, background:"#0C0C0E", border:"1px solid #262629", borderRadius:8, padding:"8px 12px", color:"#F2F2F4", fontSize:13, outline:"none" }} />
                      <button onClick={()=>{ requestInfo(inv.id, infoText); setInfoId(null); setInfoText(""); }} style={{ padding:"8px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#0EA5E922", border:"1px solid #0EA5E944", color:"#7DD3FC", cursor:"pointer" }}>Send request</button>
                      <button onClick={()=>{ setInfoId(null); setInfoText(""); }} style={{ padding:"8px 12px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #262629", color:"#86868F", cursor:"pointer" }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                      <button onClick={()=>approveInvoice(inv.id)} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"#065F4622", border:"1px solid #10B98144", color:"#10B981", cursor:"pointer" }}>✓ Approve</button>
                      <button onClick={()=>{ setRejectId(inv.id); setInfoId(null); }} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #262629", color:"#9A9AA2", cursor:"pointer" }}>✗ Reject</button>
                      <button onClick={()=>{ setInfoId(inv.id); setRejectId(null); }} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #262629", color:"#9A9AA2", cursor:"pointer" }}>ℹ Request Info</button>
                      <button onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }} style={{ marginLeft:"auto", padding:"7px 12px", borderRadius:8, fontSize:12, background:"transparent", border:"none", color:"#86868F", cursor:"pointer" }}>View entry →</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
      )}

      {/* ── APPROVED ── */}
      {active==="approved" && (
        approved.length===0
          ? <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:48, textAlign:"center", color:"#86868F" }}><div style={{ fontSize:30, marginBottom:10 }}>✅</div>Nothing approved yet. Approve bills in the Inbox to queue them for payment.</div>
          : <div>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap", background:"#0C0C0E", border:"1px solid #1C1C20", borderRadius:12, padding:"14px 18px", marginBottom:14 }}>
                <div>
                  <div style={{ fontSize:12, color:"#86868F" }}>{approved.length} bill{approved.length!==1?"s":""} ready to pay · <span style={{ color:"#F59E0B" }}>{fmt(dueThisWeek)} due this week</span></div>
                  <div style={{ fontSize:24, fontWeight:700, color:"#10B981", fontFamily:"'DM Mono',monospace", marginTop:2 }}>{fmt(approvedTotal)} <span style={{ fontSize:12, color:"#86868F", fontWeight:400 }}>total due</span></div>
                </div>
                <button onClick={payNow} className="sc-cta" style={{ padding:"11px 22px", borderRadius:10, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#6D5EF6,#4A3DB8)", border:"none", color:"#fff", cursor:"pointer", boxShadow:"0 6px 18px rgba(109,94,246,.3)" }}>⚡ Pay Now</button>
              </div>
              <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                {approved.map(inv=>(
                  <div key={inv.id} className="sc-card" style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:"16px 18px" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                      <InvoiceMeta inv={inv} />
                      <div style={{ display:"flex", alignItems:"center", gap:14 }}>
                        {inv.approved_by && <span style={{ fontSize:11, color:"#86868F" }}>Approved by {inv.approved_by}</span>}
                        <div style={{ fontSize:17, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#F2F2F4" }}>{fmt(inv.amount)}</div>
                      </div>
                    </div>
                    {payPickerId===inv.id ? (
                      <div style={{ marginTop:12, display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                        <span style={{ fontSize:12, color:"#86868F", marginRight:2 }}>Pay via:</span>
                        {methods.map(([m,l])=>(
                          <button key={m} onClick={()=>{ markPaid(inv.id, m); setPayPickerId(null); }} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#18181C", border:"1px solid #8B7BFF44", color:"#C7BFFF", cursor:"pointer" }}>{l}</button>
                        ))}
                        <button onClick={()=>setPayPickerId(null)} style={{ padding:"7px 12px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #262629", color:"#86868F", cursor:"pointer" }}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ marginTop:12, display:"flex", gap:8, flexWrap:"wrap" }}>
                        <button onClick={()=>setPayPickerId(inv.id)} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"#065F4622", border:"1px solid #10B98144", color:"#10B981", cursor:"pointer" }}>💵 Mark as Paid</button>
                        <button onClick={payNow} style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #8B7BFF44", color:"#C7BFFF", cursor:"pointer" }}>⚡ Pay Now</button>
                        <button onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }} style={{ marginLeft:"auto", padding:"7px 12px", borderRadius:8, fontSize:12, background:"transparent", border:"none", color:"#86868F", cursor:"pointer" }}>View entry →</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
      )}

      {/* ── PAID ── */}
      {active==="paid" && (
        paid.length===0
          ? <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:48, textAlign:"center", color:"#86868F" }}><div style={{ fontSize:30, marginBottom:10 }}>💸</div>No payments recorded yet.</div>
          : <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden" }}>
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr>{["Vendor","GL Account","Method","Date Paid","Amount"].map(h=><th key={h} style={{ padding:"12px 18px", textAlign:h==="Amount"?"right":"left", fontSize:11, color:"#86868F", letterSpacing:1, fontWeight:500, borderBottom:"1px solid #1C1C20" }}>{h.toUpperCase()}</th>)}</tr></thead>
                <tbody>
                  {paid.map(inv=>(
                    <tr key={inv.id} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }} style={{ cursor:"pointer", borderBottom:"1px solid #161619" }} onMouseEnter={e=>e.currentTarget.style.background="#18181C"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <td style={{ padding:"12px 18px" }}><div style={{ display:"flex", alignItems:"center", gap:10 }}><Avatar name={inv.vendor} size={28} /><span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span></div></td>
                      <td style={{ padding:"12px 18px", fontSize:12, color:"#9A9AA2", fontFamily:"'DM Mono',monospace" }}>{inv.gl_code}</td>
                      <td style={{ padding:"12px 18px" }}><span style={{ fontSize:11, fontWeight:600, color:"#C7BFFF", background:"#8B7BFF1F", border:"1px solid #8B7BFF33", borderRadius:20, padding:"2px 10px" }}>{methodLabel(inv.payment_method_used)}</span></td>
                      <td style={{ padding:"12px 18px", fontSize:12, color:"#9A9AA2" }}>{inv.paid_at ? new Date(inv.paid_at).toLocaleDateString() : "—"}</td>
                      <td style={{ padding:"12px 18px", textAlign:"right", fontSize:14, fontWeight:600, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(inv.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
      )}

      {/* ── REJECTED ── */}
      {active==="rejected" && (
        rejected.length===0
          ? <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:48, textAlign:"center", color:"#86868F" }}><div style={{ fontSize:30, marginBottom:10 }}>🚫</div>No rejected bills.</div>
          : <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
              {rejected.map(inv=>(
                <div key={inv.id} style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:"16px 18px", opacity:0.92 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:14, flexWrap:"wrap" }}>
                    <InvoiceMeta inv={inv} />
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <span style={{ fontSize:11, color:"#86868F" }}>{inv.rejected_at ? new Date(inv.rejected_at).toLocaleDateString() : ""}</span>
                      <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#86868F", textDecoration:"line-through" }}>{fmt(inv.amount)}</div>
                    </div>
                  </div>
                  <div style={{ marginTop:10, fontSize:12, color:"#FCA5A5", background:"#3B0A0A", border:"1px solid #EF444433", borderRadius:8, padding:"8px 12px" }}>
                    ✗ Rejected{inv.approved_by?` by ${inv.approved_by}`:""} — {inv.rejection_reason || inv.approval_reason || "No reason given"}
                  </div>
                </div>
              ))}
            </div>
      )}

      {/* ── AGING ── */}
      {active==="aging" && (() => {
        const open = apAll.filter(i => !isPaidI(i) && !isRejectedI(i));
        const buckets = [["Current (0–30d)",0,30,"#10B981"],["31–60 days",31,60,"#F59E0B"],["61–90 days",61,90,"#EF4444"],["90+ days",91,1e9,"#7F1D1D"]];
        const aged = buckets.map(([label,lo,hi,color])=>{
          const items = open.filter(i=>{ const d=Math.floor((new Date(today)-new Date(i.date||today))/86400000); return d>=lo && d<=hi; });
          return { label, color, total: items.reduce((s,i)=>s+i.amount,0), count: items.length };
        });
        const grand = open.reduce((s,i)=>s+i.amount,0);
        return (
          <div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:14 }}>
              {aged.map(b=>(
                <div key={b.label} style={{ background:"#141416", border:`1px solid ${b.color}33`, borderRadius:14, padding:"16px 18px" }}>
                  <div style={{ fontSize:10, color:b.color, letterSpacing:1, marginBottom:8 }}>{b.label.toUpperCase()}</div>
                  <div style={{ fontSize:20, fontWeight:700, fontFamily:"'DM Mono',monospace", color:b.color }}>{fmt(b.total)}</div>
                  <div style={{ fontSize:11, color:"#86868F", marginTop:4 }}>{b.count} bill{b.count!==1?"s":""}</div>
                </div>
              ))}
            </div>
            <div style={{ background:"#0C0C0E", border:"1px solid #1C1C20", borderRadius:12, padding:"14px 18px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:13, color:"#86868F" }}>Total outstanding payables</span>
              <span style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(grand)}</span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
