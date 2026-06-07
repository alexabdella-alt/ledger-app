import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function InvoicesView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div>
              <div style={{ marginBottom:28, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:8 }}>LEDGER</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>{vendorFilter==="all"?"All Invoices":vendorFilter}</h1>
                  {vendorFilter!=="all" && <div style={{ fontSize:13, color:"#475467", marginTop:4 }}>{filteredInvoices.length} invoice{filteredInvoices.length!==1?"s":""} · ${filteredInvoices.reduce((s,i)=>s+i.amount,0).toLocaleString("en-US",{minimumFractionDigits:2})} total</div>}
                </div>
                <button onClick={()=>setView("add")} style={{ padding:"10px 20px", borderRadius:8, background:"#E4E7EC", border:"1px solid #D0D5DD", color:"#4F46E5", fontSize:13, cursor:"pointer" }}>+ New Invoice</button>
              </div>
              {allVendorNames.length>0 && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
                  <button onClick={()=>setVendorFilter("all")} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, background:vendorFilter==="all"?"#E4E7EC":"transparent", border:`1px solid ${vendorFilter==="all"?"#4F46E5":"#D0D5DD"}`, color:vendorFilter==="all"?"#4F46E5":"#475467", cursor:"pointer" }}>All</button>
                  {allVendorNames.map(v=>(
                    <button key={v} onClick={()=>setVendorFilter(v)} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, display:"flex", alignItems:"center", gap:6, background:vendorFilter===v?vendorColor(v)+"33":"transparent", border:`1px solid ${vendorFilter===v?vendorColor(v):"#D0D5DD"}`, color:vendorFilter===v?"#101828":"#475467", cursor:"pointer" }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:vendorColor(v), display:"inline-block" }} />{v}
                    </button>
                  ))}
                </div>
              )}
              {filteredInvoices.length===0 ? <div style={{ color:"#475467", fontSize:14 }}>No invoices yet.</div> : (
                <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"clip" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#F3F4F6" }}>
                        {["Vendor","Date","Description","GL Account","Project","Amount",""].map(h=>(
                          <th key={h} style={{ padding:"13px 16px", textAlign:"left", fontSize:11, color:"#475467", letterSpacing:1.5, fontWeight:500 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map((inv,i)=>(
                        <tr key={inv.id} style={{ borderTop:"1px solid #E4E7EC", background:inv.status==="voided"?"#FEF2F2":i%2===0?"transparent":"#F7F8FA", opacity:inv.status==="voided"?0.5:1 }}>
                          <td style={{ padding:"13px 16px", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ width:28, height:28, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                              <div>
                                <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                {inv.status==="voided" && <span style={{ fontSize:10, color:"#D92D20", marginLeft:6, background:"#FEF2F2", padding:"1px 6px", borderRadius:10 }}>VOIDED</span>}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"#475467", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>{inv.date}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"#475467", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>{inv.description}</td>
                          <td style={{ padding:"13px 16px", fontSize:12, cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}><span style={{ background:"#E4E7EC", padding:"3px 10px", borderRadius:20, color:"#4F46E5" }}>{inv.gl_code} · {inv.gl_name}</span></td>
                          <td style={{ padding:"13px 16px", fontSize:12, color:"#475467", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>{inv.project||"General"}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, fontFamily:"'DM Mono', monospace", color:inv.type==="revenue"?"#039855":"#D92D20", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>
                            {inv.type==="revenue"?"+":"-"}${inv.amount.toLocaleString("en-US",{minimumFractionDigits:2})}
                          </td>
                          <td style={{ padding:"8px 16px" }}>
                            <div style={{ display:"flex", gap:4 }}>
                              {inv.status !== "voided" && (
                                <button
                                  onClick={e=>{ e.stopPropagation(); setDeleteConfirm({ label:`Void entry for ${inv.vendor} · $${inv.amount} on ${inv.date}?

Voiding keeps an audit trail.`, onConfirm:()=>{ setInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,status:"voided",voided_at:new Date().toISOString()}:i)); showNotification("Entry voided ✓"); }}); }}
                                  style={{ padding:"4px 8px", borderRadius:6, background:"transparent", border:"1px solid #D0D5DD", color:"#475467", fontSize:11, cursor:"pointer" }}
                                  title="Void (keeps audit trail)">
                                  Void
                                </button>
                              )}
                              <button
                                onClick={e=>{ e.stopPropagation(); setDeleteConfirm({ label:`Permanently delete ${inv.vendor} · $${inv.amount} on ${inv.date}? This cannot be undone.`, onConfirm:()=>{ logAudit("invoice_deleted",`Deleted: ${inv.vendor} $${inv.amount} on ${inv.date} (${inv.gl_name})`,inv,null); deleteJournalEntry(inv); setInvoices(prev=>prev.filter(i=>i.id!==inv.id)); showNotification("Entry deleted ✓"); }}); }}
                                style={{ padding:"4px 8px", borderRadius:6, background:"transparent", border:"1px solid #D92D2033", color:"#D92D20", fontSize:11, cursor:"pointer" }}
                                title="Delete permanently">
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
  );
}
