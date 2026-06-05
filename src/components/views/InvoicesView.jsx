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
                  <div style={{ fontSize:10, letterSpacing:3, color:"#86868F", marginBottom:8 }}>LEDGER</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>{vendorFilter==="all"?"All Invoices":vendorFilter}</h1>
                  {vendorFilter!=="all" && <div style={{ fontSize:13, color:"#86868F", marginTop:4 }}>{filteredInvoices.length} invoice{filteredInvoices.length!==1?"s":""} · ${filteredInvoices.reduce((s,i)=>s+i.amount,0).toLocaleString("en-US",{minimumFractionDigits:2})} total</div>}
                </div>
                <button onClick={()=>setView("add")} style={{ padding:"10px 20px", borderRadius:8, background:"#1C1C20", border:"1px solid #33333A", color:"#C7BFFF", fontSize:13, cursor:"pointer" }}>+ New Invoice</button>
              </div>
              {allVendorNames.length>0 && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
                  <button onClick={()=>setVendorFilter("all")} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, background:vendorFilter==="all"?"#1C1C20":"transparent", border:`1px solid ${vendorFilter==="all"?"#C7BFFF":"#262629"}`, color:vendorFilter==="all"?"#C7BFFF":"#86868F", cursor:"pointer" }}>All</button>
                  {allVendorNames.map(v=>(
                    <button key={v} onClick={()=>setVendorFilter(v)} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, display:"flex", alignItems:"center", gap:6, background:vendorFilter===v?vendorColor(v)+"33":"transparent", border:`1px solid ${vendorFilter===v?vendorColor(v):"#262629"}`, color:vendorFilter===v?"#F2F2F4":"#86868F", cursor:"pointer" }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:vendorColor(v), display:"inline-block" }} />{v}
                    </button>
                  ))}
                </div>
              )}
              {filteredInvoices.length===0 ? <div style={{ color:"#86868F", fontSize:14 }}>No invoices yet.</div> : (
                <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#0C0C0E" }}>
                        {["Vendor","Date","Description","GL Account","Project","Amount",""].map(h=>(
                          <th key={h} style={{ padding:"13px 16px", textAlign:"left", fontSize:11, color:"#86868F", letterSpacing:1.5, fontWeight:500 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map((inv,i)=>(
                        <tr key={inv.id} style={{ borderTop:"1px solid #1C1C20", background:inv.status==="voided"?"#1A0A0A":i%2===0?"transparent":"#0A0A0C", opacity:inv.status==="voided"?0.5:1 }}>
                          <td style={{ padding:"13px 16px", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ width:28, height:28, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                              <div>
                                <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                {inv.status==="voided" && <span style={{ fontSize:10, color:"#EF4444", marginLeft:6, background:"#2A0A0A", padding:"1px 6px", borderRadius:10 }}>VOIDED</span>}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"#9A9AA2", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>{inv.date}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"#9A9AA2", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>{inv.description}</td>
                          <td style={{ padding:"13px 16px", fontSize:12, cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}><span style={{ background:"#1C1C20", padding:"3px 10px", borderRadius:20, color:"#C7BFFF" }}>{inv.gl_code} · {inv.gl_name}</span></td>
                          <td style={{ padding:"13px 16px", fontSize:12, color:"#9A9AA2", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>{inv.project||"General"}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, fontFamily:"'DM Mono', monospace", color:inv.type==="revenue"?"#10B981":"#EF4444", cursor:"pointer" }} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }}>
                            {inv.type==="revenue"?"+":"-"}${inv.amount.toLocaleString("en-US",{minimumFractionDigits:2})}
                          </td>
                          <td style={{ padding:"8px 16px" }}>
                            <div style={{ display:"flex", gap:4 }}>
                              {inv.status !== "voided" && (
                                <button
                                  onClick={e=>{ e.stopPropagation(); setDeleteConfirm({ label:`Void entry for ${inv.vendor} · $${inv.amount} on ${inv.date}?

Voiding keeps an audit trail.`, onConfirm:()=>{ setInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,status:"voided",voided_at:new Date().toISOString()}:i)); showNotification("Entry voided ✓"); }}); }}
                                  style={{ padding:"4px 8px", borderRadius:6, background:"transparent", border:"1px solid #262629", color:"#86868F", fontSize:11, cursor:"pointer" }}
                                  title="Void (keeps audit trail)">
                                  Void
                                </button>
                              )}
                              <button
                                onClick={e=>{ e.stopPropagation(); setDeleteConfirm({ label:`Permanently delete ${inv.vendor} · $${inv.amount} on ${inv.date}? This cannot be undone.`, onConfirm:()=>{ logAudit("invoice_deleted",`Deleted: ${inv.vendor} $${inv.amount} on ${inv.date} (${inv.gl_name})`,inv,null); deleteJournalEntry(inv); setInvoices(prev=>prev.filter(i=>i.id!==inv.id)); showNotification("Entry deleted ✓"); }}); }}
                                style={{ padding:"4px 8px", borderRadius:6, background:"transparent", border:"1px solid #EF444433", color:"#EF4444", fontSize:11, cursor:"pointer" }}
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
