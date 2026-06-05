import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ApView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const today = new Date().toISOString().slice(0,10);

            // All open expense invoices that have been AP-screened or are payable
            const apAll = invoices.filter(i => glIsExpense(i.gl_code) || i.type==="expense");
            const apOpen = apAll.filter(i => i.payment_status !== "paid" && i.approval_status !== "rejected");
            const apPending = apAll.filter(i => i.approval_status === "pending_approval" || i.approval_status === "flagged");
            const apApproved = apOpen.filter(i => i.approval_status === "approved" || i.approval_status === "auto_approved");
            const apOverdue = apOpen.filter(i => i.due_date && i.due_date < today);

            // Aging buckets (based on invoice date)
            const agingBuckets = { current:{count:0,total:0,items:[]}, d60:{count:0,total:0,items:[]}, d90:{count:0,total:0,items:[]}, d90plus:{count:0,total:0,items:[]} };
            apOpen.forEach(inv => {
              const days = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
              const bucket = days<=30?"current":days<=60?"d60":days<=90?"d90":"d90plus";
              agingBuckets[bucket].count++; agingBuckets[bucket].total+=inv.amount; agingBuckets[bucket].items.push(inv);
            });

            const totalOpen = apOpen.reduce((s,i)=>s+i.amount,0);
            const cashAmt = parseFloat(cashBalance)||0;

            const priorityConfig = {
              critical:{ color:"#EF4444", bg:"#2A0A0A", label:"Critical" },
              high:    { color:"#F59E0B", bg:"#1A1200", label:"High" },
              normal:  { color:"#C8B8FF", bg:"#1A1A2E", label:"Normal" },
              low:     { color:"#6B6B8A", bg:"#14141A", label:"Low" },
            };
            const approvalConfig = {
              auto_approved:    { color:"#10B981", label:"Auto-approved" },
              approved:         { color:"#10B981", label:"Approved" },
              pending_approval: { color:"#F59E0B", label:"Needs approval" },
              flagged:          { color:"#EF4444", label:"Flagged" },
              rejected:         { color:"#6B6B8A", label:"Rejected" },
            };

            return (
              <div>
                {/* Header */}
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>ACCOUNTS PAYABLE</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>AP Management</h1>
                  </div>
                  {/* Cash input */}
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:12, color:"#6B6B8A" }}>Available cash:</span>
                    <div style={{ position:"relative" }}>
                      <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#6B6B8A", fontSize:13 }}>$</span>
                      <input value={cashBalance} onChange={e=>setCashBalance(e.target.value.replace(/[^0-9.]/g,""))}
                        placeholder="0.00" style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 12px 8px 22px", color:"#E8E8F0", fontSize:13, outline:"none", width:130 }} />
                    </div>
                  </div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                  {[
                    { label:"Total Open AP",    value:fmt(totalOpen),        sub:`${apOpen.length} invoices`,              color:"#E8E8F0" },
                    { label:"Needs Approval",   value:apPending.length,      sub:`${fmt(apPending.reduce((s,i)=>s+i.amount,0))} held`, color:"#F59E0B" },
                    { label:"Overdue",          value:apOverdue.length,      sub:`${fmt(apOverdue.reduce((s,i)=>s+i.amount,0))} past due`, color:"#EF4444" },
                    { label:"Cash vs AP",       value:cashAmt>0?fmt(cashAmt-totalOpen):"—", sub:cashAmt>0?(cashAmt>=totalOpen?"Sufficient to pay all":"Shortfall — prioritize"):"Enter cash balance", color:cashAmt>0?(cashAmt>=totalOpen?"#10B981":"#EF4444"):"#6B6B8A" },
                  ].map(c=>(
                    <div key={c.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"16px 18px" }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:1, marginBottom:8 }}>{c.label.toUpperCase()}</div>
                      <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace", color:c.color }}>{c.value}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Tab bar */}
                <div style={{ display:"flex", gap:2, background:"#0F0F13", borderRadius:10, padding:3, border:"1px solid #1E1E2E", marginBottom:20, width:"fit-content" }}>
                  {[["inbox","📥 Inbox"],["queue","💳 Payment Queue"],["approvals","✓ Approvals"],["aging","📊 Aging"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setApView(id)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:apView===id?600:400,
                      background:apView===id?"#1E1E2E":"transparent", border:"none", color:apView===id?"#C8B8FF":"#6B6B8A", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:6 }}>
                      {label}
                      {id==="approvals"&&apPending.length>0&&<span style={{ background:"#F59E0B", color:"#000", borderRadius:20, fontSize:10, fontWeight:700, padding:"1px 6px" }}>{apPending.length}</span>}
                    </button>
                  ))}
                </div>

                {/* ── INBOX TAB ── */}
                {apView==="inbox" && (
                  <div>
                    {apAll.length===0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                        <div style={{ fontSize:32, marginBottom:12 }}>📥</div>
                        <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No invoices yet</div>
                        <div style={{ fontSize:13, color:"#6B6B8A" }}>Upload invoices from the dashboard — each one is automatically screened for duplicates, anomalies, and routed for approval.</div>
                      </div>
                    )}
                    {apAll.length>0 && (
                      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                        {apAll.sort((a,b)=>{
                          const po = {critical:0,high:1,normal:2,low:3};
                          return (po[a.payment_priority==="1"?"critical":a.payment_priority==="2"?"high":"low"]||2) - (po[b.payment_priority==="1"?"critical":b.payment_priority==="2"?"high":"low"]||2);
                        }).map(inv => {
                          const pc = priorityConfig[inv.payment_priority==="1"?"critical":inv.payment_priority==="2"?"high":inv.payment_priority==="3"?"low":"normal"] || priorityConfig.normal;
                          const ac = approvalConfig[inv.approval_status] || approvalConfig.pending_approval;
                          const daysUntilDue = inv.due_date ? Math.floor((new Date(inv.due_date)-new Date(today))/86400000) : null;
                          const isPaid = inv.payment_status==="paid";
                          return (
                            <div key={inv.id} style={{ background:"#14141A", border:`1px solid ${isPaid?"#1E1E2E":(inv.duplicate_flag||inv.anomaly_flag)?"#EF444433":inv.approval_status==="pending_approval"?"#F59E0B33":"#1E1E2E"}`, borderRadius:14, overflow:"hidden", opacity:isPaid?0.5:1 }}>
                              <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                                {/* Vendor avatar */}
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                {/* Main info */}
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    <span style={{ fontSize:11, background:ac.color+"22", color:ac.color, borderRadius:20, padding:"2px 8px" }}>{ac.label}</span>
                                    {inv.early_pay_discount && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>💰 Early discount</span>}
                                    {inv.duplicate_flag && <span style={{ fontSize:11, background:"#EF444422", color:"#EF4444", borderRadius:20, padding:"2px 8px" }}>⚠ Possible duplicate</span>}
                                    {inv.anomaly_flag && <span style={{ fontSize:11, background:"#F59E0B22", color:"#F59E0B", borderRadius:20, padding:"2px 8px" }}>⚠ Unusual amount</span>}
                                    {isPaid && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>✓ Paid{inv.payment_method_used ? ` via ${inv.payment_method_used.toUpperCase()}` : ""}</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:"#9CA3AF" }}>
                                    {inv.description} · {inv.gl_name} · {inv.date}
                                    {inv.payment_terms && <span style={{ marginLeft:8, color:"#6B6B8A" }}>{inv.payment_terms}</span>}
                                  </div>
                                  {inv.notes_for_reviewer && <div style={{ fontSize:11, color:"#C8B8FF", marginTop:4 }}>✦ {inv.notes_for_reviewer}</div>}
                                  {inv.duplicate_reason && <div style={{ fontSize:11, color:"#EF4444", marginTop:3 }}>⚠ {inv.duplicate_reason}</div>}
                                  {inv.anomaly_reason && <div style={{ fontSize:11, color:"#F59E0B", marginTop:3 }}>⚠ {inv.anomaly_reason}</div>}
                                </div>
                                {/* Amount + due date */}
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(inv.amount)}</div>
                                  {daysUntilDue!==null && !isPaid && (
                                    <div style={{ fontSize:11, marginTop:3, color:daysUntilDue<0?"#EF4444":daysUntilDue<=7?"#F59E0B":"#6B6B8A" }}>
                                      {daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Due today":`Due in ${daysUntilDue}d`}
                                    </div>
                                  )}
                                  {inv.due_date && <div style={{ fontSize:10, color:"#6B6B8A" }}>{inv.due_date}</div>}
                                </div>
                              </div>
                              {/* Action row */}
                              {!isPaid && (
                                <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"flex", gap:8, alignItems:"center" }}>
                                  {(inv.approval_status==="pending_approval"||inv.approval_status==="flagged") && <>
                                    <button onClick={()=>approveInvoice(inv.id)} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#065F4622", border:"1px solid #10B98144", color:"#10B981", cursor:"pointer" }}>✓ Approve</button>
                                    <button onClick={()=>rejectInvoice(inv.id)} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>✗ Reject</button>
                                    <div style={{ width:1, height:20, background:"#2A2A3E", margin:"0 4px" }} />
                                  </>}
                                  {(inv.approval_status==="approved"||inv.approval_status==="auto_approved") && <>
                                    <button onClick={()=>markPaid(inv.id,"ach")} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#1A1A2E", border:"1px solid #C8B8FF44", color:"#C8B8FF", cursor:"pointer" }}>Pay ACH</button>
                                    <button onClick={()=>markPaid(inv.id,"check")} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>Pay Check</button>
                                  </>}
                                  <button onClick={()=>{ setApView("queue"); }} style={{ marginLeft:"auto", padding:"6px 12px", borderRadius:8, fontSize:11, background:"transparent", border:"none", color:"#6B6B8A", cursor:"pointer" }}>Add to queue →</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PAYMENT QUEUE TAB ── */}
                {apView==="queue" && (
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                      <div style={{ fontSize:13, color:"#6B6B8A" }}>
                        {apApproved.length} approved invoices ready to pay · {fmt(apApproved.reduce((s,i)=>s+i.amount,0))} total
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        {checkRunMode ? <>
                          <button onClick={()=>{ const ids=[...selectedPayments]; markPaid(ids,"check"); setCheckRunMode(false); }} disabled={selectedPayments.size===0}
                            style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:600, background:selectedPayments.size>0?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"none", color:selectedPayments.size>0?"#6EE7B7":"#6B6B8A", cursor:selectedPayments.size>0?"pointer":"not-allowed" }}>
                            Print Check Run ({selectedPayments.size})
                          </button>
                          <button onClick={()=>{ setCheckRunMode(false); setSelectedPayments(new Set()); }} style={{ padding:"8px 14px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>Cancel</button>
                        </> : <>
                          <button onClick={()=>setCheckRunMode(true)} style={{ padding:"8px 16px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>🗒 Check Run</button>
                          <button onClick={()=>{ const ids=apApproved.map(i=>i.id); markPaid(ids,"ach"); }} disabled={apApproved.length===0}
                            style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:600, background:apApproved.length>0?"linear-gradient(135deg,#6D28D9,#4C1D95)":"#1E1E2E", border:"none", color:apApproved.length>0?"#E8E8F0":"#6B6B8A", cursor:apApproved.length>0?"pointer":"not-allowed" }}>
                            Pay All via ACH
                          </button>
                        </>}
                      </div>
                    </div>

                    {/* Cash coverage bar */}
                    {cashAmt>0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"14px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:14 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:6 }}>
                            <span style={{ color:"#6B6B8A" }}>Cash available: {fmt(cashAmt)}</span>
                            <span style={{ color: cashAmt>=totalOpen?"#10B981":"#EF4444" }}>Total open AP: {fmt(totalOpen)}</span>
                          </div>
                          <div style={{ height:6, background:"#1E1E2E", borderRadius:3 }}>
                            <div style={{ height:"100%", width:`${Math.min(100,(cashAmt/totalOpen)*100||0)}%`, background:cashAmt>=totalOpen?"#10B981":"#EF4444", borderRadius:3, transition:"width 0.4s" }} />
                          </div>
                        </div>
                        <div style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:cashAmt>=totalOpen?"#10B981":"#EF4444", flexShrink:0 }}>
                          {cashAmt>=totalOpen ? "✓ Can pay all" : `${fmt(totalOpen-cashAmt)} shortfall`}
                        </div>
                      </div>
                    )}

                    {apApproved.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:32, textAlign:"center", color:"#6B6B8A", fontSize:13 }}>
                        No approved invoices ready for payment.{apPending.length>0?` ${apPending.length} awaiting approval.`:""}
                      </div>
                    ) : (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {checkRunMode && <th style={{ padding:"10px 16px", width:40 }}><input type="checkbox" onChange={e=>{ if(e.target.checked)setSelectedPayments(new Set(apApproved.map(i=>i.id))); else setSelectedPayments(new Set()); }} /></th>}
                            {["Vendor","Due Date","Terms","Amount","Method","Action"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {[...apApproved].sort((a,b)=>{
                              if(!a.due_date) return 1; if(!b.due_date) return -1;
                              return a.due_date.localeCompare(b.due_date);
                            }).map((inv,i)=>{
                              const daysUntilDue = inv.due_date ? Math.floor((new Date(inv.due_date)-new Date(today))/86400000) : 30;
                              const isSelected = selectedPayments.has(inv.id);
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:isSelected?"#1A1A2E":i%2===0?"transparent":"#0A0A10" }}
                                  onClick={()=>checkRunMode&&setSelectedPayments(prev=>{ const n=new Set(prev); isSelected?n.delete(inv.id):n.add(inv.id); return n; })}>
                                  {checkRunMode && <td style={{ padding:"12px 16px" }}><input type="checkbox" checked={isSelected} readOnly /></td>}
                                  <td style={{ padding:"12px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                                        <div style={{ fontSize:11, color:"#6B6B8A" }}>{inv.description?.slice(0,30)}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding:"12px 16px" }}>
                                    <div style={{ fontSize:13, color:daysUntilDue<0?"#EF4444":daysUntilDue<=7?"#F59E0B":"#E8E8F0" }}>{inv.due_date||"—"}</div>
                                    <div style={{ fontSize:11, color:"#6B6B8A" }}>{daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Today":`${daysUntilDue}d`}</div>
                                  </td>
                                  <td style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.payment_terms||"Net 30"}</td>
                                  <td style={{ padding:"12px 16px", fontSize:14, fontFamily:"'DM Mono',monospace", color:"#EF4444", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"12px 16px" }}>
                                    <span style={{ fontSize:11, background:"#1E1E2E", borderRadius:20, padding:"3px 10px", color:"#9CA3AF" }}>{inv.payment_method==="ach"?"ACH":"Check"}</span>
                                    {inv.early_pay_discount && <div style={{ fontSize:10, color:"#10B981", marginTop:3 }}>💰 Discount available</div>}
                                  </td>
                                  <td style={{ padding:"12px 16px" }}>
                                    {!checkRunMode && (
                                      <div style={{ display:"flex", gap:6 }}>
                                        <button onClick={()=>markPaid(inv.id,"ach")} style={{ padding:"5px 12px", borderRadius:7, fontSize:11, fontWeight:600, background:"#1A1A2E", border:"1px solid #C8B8FF44", color:"#C8B8FF", cursor:"pointer" }}>ACH</button>
                                        <button onClick={()=>markPaid(inv.id,"check")} style={{ padding:"5px 10px", borderRadius:7, fontSize:11, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>Check</button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop:"2px solid #2A2A3E", background:"#0F0F13" }}>
                              {checkRunMode && <td />}
                              <td colSpan={3} style={{ padding:"12px 16px", fontSize:13, fontWeight:600 }}>Total</td>
                              <td style={{ padding:"12px 16px", fontSize:15, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#EF4444" }}>{fmt(apApproved.reduce((s,i)=>s+i.amount,0))}</td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── APPROVALS TAB ── */}
                {apView==="approvals" && (
                  <div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:16 }}>
                      Auto-approve threshold: <strong style={{ color:"#C8B8FF" }}>${apSettings.autoApproveThreshold.toLocaleString()}</strong> · Invoices above this amount need manual approval.
                    </div>
                    {apPending.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:32, textAlign:"center", color:"#6B6B8A", fontSize:13 }}>
                        ✓ No invoices pending approval
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                        {apPending.map(inv => {
                          const ac = approvalConfig[inv.approval_status] || approvalConfig.pending_approval;
                          return (
                            <div key={inv.id} style={{ background:"#14141A", border:`1px solid ${inv.approval_status==="flagged"?"#EF444433":"#F59E0B33"}`, borderRadius:14, padding:"18px 20px" }}>
                              <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                <div style={{ flex:1 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    <span style={{ fontSize:11, background:ac.color+"22", color:ac.color, borderRadius:20, padding:"2px 8px" }}>{ac.label}</span>
                                  </div>
                                  <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:8 }}>{inv.description} · {inv.date} · {inv.gl_name}</div>
                                  {inv.notes_for_reviewer && (
                                    <div style={{ background:"#0A0A14", border:"1px solid #C8B8FF33", borderRadius:8, padding:"10px 14px", marginBottom:10 }}>
                                      <div style={{ fontSize:11, color:"#C8B8FF", marginBottom:4 }}>✦ AI REVIEW NOTE</div>
                                      <div style={{ fontSize:12, color:"#C8C8D8", lineHeight:1.6 }}>{inv.notes_for_reviewer}</div>
                                    </div>
                                  )}
                                  {inv.duplicate_reason && <div style={{ fontSize:12, color:"#EF4444", marginBottom:6 }}>⚠ Duplicate flag: {inv.duplicate_reason}</div>}
                                  {inv.anomaly_reason && <div style={{ fontSize:12, color:"#F59E0B", marginBottom:6 }}>⚠ Anomaly: {inv.anomaly_reason}</div>}
                                  {inv.approval_reason && <div style={{ fontSize:12, color:"#6B6B8A", marginBottom:8 }}>Reason: {inv.approval_reason}</div>}
                                  <div style={{ display:"flex", gap:8 }}>
                                    <button onClick={()=>approveInvoice(inv.id)} style={{ padding:"8px 20px", borderRadius:9, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>✓ Approve {fmt(inv.amount)}</button>
                                    <button onClick={()=>rejectInvoice(inv.id)} style={{ padding:"8px 16px", borderRadius:9, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>✗ Reject</button>
                                  </div>
                                </div>
                                <div style={{ fontSize:20, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444", flexShrink:0 }}>{fmt(inv.amount)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Audit trail */}
                    {apAll.filter(i=>i.approved_at||i.rejected_at).length>0 && (
                      <div style={{ marginTop:24 }}>
                        <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:12 }}>AUDIT TRAIL</div>
                        <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, overflow:"hidden" }}>
                          {apAll.filter(i=>i.approved_at||i.rejected_at).map((inv,i)=>(
                            <div key={inv.id} style={{ padding:"12px 18px", borderTop:i>0?"1px solid #1E1E2E":"none", display:"flex", alignItems:"center", gap:10 }}>
                              <div style={{ width:20, height:20, borderRadius:"50%", background:inv.approved_at?"#10B98122":"#EF444422", border:`1px solid ${inv.approved_at?"#10B98155":"#EF444455"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10 }}>
                                {inv.approved_at?"✓":"✗"}
                              </div>
                              <div style={{ flex:1, fontSize:12 }}>
                                <span style={{ fontWeight:500 }}>{inv.vendor}</span>
                                <span style={{ color:"#6B6B8A", marginLeft:8 }}>{inv.approved_at?"Approved":"Rejected"} · {fmt(inv.amount)}</span>
                              </div>
                              <div style={{ fontSize:11, color:"#6B6B8A" }}>{(inv.approved_at||inv.rejected_at||"").slice(0,10)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── AGING TAB ── */}
                {apView==="aging" && (
                  <div>
                    {/* Aging buckets */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                      {[
                        { label:"Current (0–30d)",  bucket:agingBuckets.current, color:"#10B981" },
                        { label:"31–60 Days",        bucket:agingBuckets.d60,     color:"#F59E0B" },
                        { label:"61–90 Days",        bucket:agingBuckets.d90,     color:"#EF4444" },
                        { label:"90+ Days",          bucket:agingBuckets.d90plus, color:"#7F1D1D" },
                      ].map(({label,bucket,color})=>(
                        <div key={label} style={{ background:"#14141A", border:`1px solid ${color}33`, borderRadius:12, padding:"16px 18px" }}>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:8 }}>{label}</div>
                          <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmt(bucket.total)}</div>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{bucket.count} invoice{bucket.count!==1?"s":""}</div>
                          <div style={{ marginTop:10, height:3, background:"#1E1E2E", borderRadius:2 }}>
                            <div style={{ height:"100%", width:totalOpen>0?`${Math.min(100,(bucket.total/totalOpen)*100)}%`:"0%", background:color, borderRadius:2 }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI commentary */}
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:apAgingNarration||apAgingLoading?16:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>✦ CFO Commentary</div>
                        <button onClick={()=>handleAgingNarration(agingBuckets)} disabled={apAgingLoading}
                          style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:apAgingLoading?"wait":"pointer" }}>
                          {apAgingLoading?"⟳ Analyzing...":"Generate Analysis"}
                        </button>
                      </div>
                      {apAgingLoading && <div style={{ display:"flex", gap:5, alignItems:"center" }}>{[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#6B6B8A",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>}
                      {apAgingNarration && <div style={{ fontSize:13, color:"#C8C8D8", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{apAgingNarration}</div>}
                      {!apAgingNarration && !apAgingLoading && <div style={{ fontSize:13, color:"#6B6B8A" }}>Click Generate Analysis for AI commentary on your AP aging position.</div>}
                    </div>

                    {/* Aged invoice detail */}
                    {apOpen.length>0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"14px 20px", borderBottom:"1px solid #1E1E2E", fontSize:13, fontWeight:600 }}>All Open Payables</div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Vendor","Invoice Date","Due Date","Age","Amount","Status"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {[...apOpen].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map((inv,i)=>{
                              const ageDays = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
                              const ageColor = ageDays<=30?"#10B981":ageDays<=60?"#F59E0B":ageDays<=90?"#EF4444":"#7F1D1D";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"11px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:24,height:24,borderRadius:6,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date||"—"}</td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:inv.due_date&&inv.due_date<today?"#EF4444":"#9CA3AF" }}>{inv.due_date||"—"}</td>
                                  <td style={{ padding:"11px 16px" }}><span style={{ fontSize:12, color:ageColor, fontFamily:"'DM Mono',monospace" }}>{ageDays}d</span></td>
                                  <td style={{ padding:"11px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#EF4444", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"11px 16px" }}>
                                    <span style={{ fontSize:11, background:(approvalConfig[inv.approval_status]?.color||"#6B6B8A")+"22", color:approvalConfig[inv.approval_status]?.color||"#6B6B8A", borderRadius:20, padding:"2px 9px" }}>
                                      {approvalConfig[inv.approval_status]?.label||"Pending"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
}
