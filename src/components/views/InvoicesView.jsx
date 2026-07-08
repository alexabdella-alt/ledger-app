import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { classifyTxn } from "../../lib/txnPresent";
import { initials, vendorColor, fmtDate, todayLocal } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function InvoicesView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setReturnTo, softDeleteInvoice, voidInvoiceWithUndo, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div>
              <div style={{ marginBottom:28, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>LEDGER</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>{vendorFilter==="all"?"All Invoices":vendorFilter}</h1>
                  {vendorFilter!=="all" && <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:4 }}>{filteredInvoices.length} invoice{filteredInvoices.length!==1?"s":""} · ${filteredInvoices.reduce((s,i)=>s+i.amount,0).toLocaleString("en-US",{minimumFractionDigits:2})} total</div>}
                </div>
                <button onClick={()=>setView("add")} style={{ padding:"10px 20px", borderRadius:8, background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", color:"var(--sc-gold)", fontSize:13, cursor:"pointer" }}>+ New Invoice</button>
              </div>
              {allVendorNames.length>0 && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
                  <button onClick={()=>setVendorFilter("all")} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, background:vendorFilter==="all"?"var(--sc-border)":"transparent", border:`1px solid ${vendorFilter==="all"?"var(--sc-gold)":"var(--sc-border-2)"}`, color:vendorFilter==="all"?"var(--sc-gold)":"var(--sc-text-2)", cursor:"pointer" }}>All</button>
                  {allVendorNames.map(v=>(
                    <button key={v} onClick={()=>setVendorFilter(v)} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, display:"flex", alignItems:"center", gap:6, background:vendorFilter===v?vendorColor(v)+"33":"transparent", border:`1px solid ${vendorFilter===v?vendorColor(v):"var(--sc-border-2)"}`, color:vendorFilter===v?"var(--sc-text)":"var(--sc-text-2)", cursor:"pointer" }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:vendorColor(v), display:"inline-block" }} />{v}
                    </button>
                  ))}
                </div>
              )}
              {filteredInvoices.length===0 ? <div style={{ color:"var(--sc-text-2)", fontSize:14 }}>No invoices yet.</div> : (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"var(--sc-surface-2)" }}>
                        {["Vendor","Date","Description","GL Account","Project","Amount",""].map(h=>(
                          <th key={h} style={{ padding:"13px 16px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.5, fontWeight:500 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map((inv,i)=>{
                        // Sign from GL truth (settlement-aware), not the `type` flag — a bank-matched
                        // collection is money IN even though it flattens to gl_code=Cash+type="expense".
                        const cls = classifyTxn(inv, { apCode: getAccountByRole?.("accounts_payable")?.code, arCode: getAccountByRole?.("accounts_receivable")?.code });
                        return (
                        <tr key={inv.id} style={{ borderTop:"1px solid var(--sc-border)", background:inv.status==="voided"?"var(--sc-error-soft)":i%2===0?"transparent":"var(--sc-bg)", opacity:inv.status==="voided"?0.5:1 }}>
                          <td style={{ padding:"13px 16px", cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"invoices",label:"Invoices"}); setSelectedInvoice(inv); setView("detail"); }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ width:28, height:28, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(inv.vendor)}</div>
                              <div>
                                <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                {inv.status==="voided" && <span style={{ fontSize:10, color:"var(--sc-error)", marginLeft:6, background:"var(--sc-error-soft)", padding:"1px 6px", borderRadius:10 }}>VOIDED</span>}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"var(--sc-text-2)", cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"invoices",label:"Invoices"}); setSelectedInvoice(inv); setView("detail"); }}>
                            <div>{fmtDate(inv.date)}</div>
                            {inv.due_date && (() => {
                              const unpaid = inv.payment_status !== "paid" && inv.payment_status !== "collected";
                              const overdue = unpaid && String(inv.due_date) < todayLocal();
                              return <div style={{ fontSize:11, marginTop:2, color: overdue ? "var(--sc-error)" : "var(--sc-text-mut)" }}>Due {fmtDate(inv.due_date)}{overdue ? " · overdue" : ""}</div>;
                            })()}
                          </td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"var(--sc-text-2)", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"invoices",label:"Invoices"}); setSelectedInvoice(inv); setView("detail"); }}>{inv.description}</td>
                          <td style={{ padding:"13px 16px", fontSize:12, cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"invoices",label:"Invoices"}); setSelectedInvoice(inv); setView("detail"); }}><span style={{ background:"var(--sc-border)", padding:"3px 10px", borderRadius:20, color:"var(--sc-gold)" }}>{inv.gl_code} · {inv.gl_name}</span></td>
                          <td style={{ padding:"13px 16px", fontSize:12, color:"var(--sc-text-2)", cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"invoices",label:"Invoices"}); setSelectedInvoice(inv); setView("detail"); }}>{inv.project||"General"}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, fontFamily:"'DM Mono', monospace", color:cls.inflow?"var(--sc-success)":"var(--sc-error)", cursor:"pointer" }} onClick={()=>{ setReturnTo({view:"invoices",label:"Invoices"}); setSelectedInvoice(inv); setView("detail"); }}>
                            {cls.inflow?"+":"-"}${inv.amount.toLocaleString("en-US",{minimumFractionDigits:2})}
                          </td>
                          <td style={{ padding:"8px 16px" }}>
                            <div style={{ display:"flex", gap:4 }}>
                              {inv.status !== "voided" && (
                                <button
                                  onClick={e=>{ e.stopPropagation(); setDeleteConfirm({ label:`Void entry for ${inv.vendor} · $${inv.amount} on ${fmtDate(inv.date)}?

Voiding keeps an audit trail.`, onConfirm:()=>{ voidInvoiceWithUndo(inv); }}); }}
                                  style={{ padding:"4px 8px", borderRadius:6, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:11, cursor:"pointer" }}
                                  title="Void (keeps audit trail)">
                                  Void
                                </button>
                              )}
                              <button
                                onClick={e=>{ e.stopPropagation(); setDeleteConfirm({ label:`Delete ${inv.vendor} · $${inv.amount} on ${fmtDate(inv.date)}? You'll have 30 seconds to undo, and an admin can restore it later.`, onConfirm:()=>{ softDeleteInvoice(inv); }}); }}
                                style={{ padding:"4px 8px", borderRadius:6, background:"transparent", border:"1px solid var(--sc-error-soft)", color:"var(--sc-error)", fontSize:11, cursor:"pointer" }}
                                title="Delete permanently">
                                ×
                              </button>
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
  );
}
