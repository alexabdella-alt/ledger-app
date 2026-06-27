import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function RulesView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>AUTOMATION</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Vendor Rules</h1>
                <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Rules auto-apply when invoices are uploaded. Create them by chatting with the AI assistant.</div>
              </div>
              {rules.length===0 ? (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:40, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⚡</div>
                  <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No rules yet</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:20 }}>Tell the AI assistant things like "Always tag FedEx invoices to Shipping & Freight"</div>
                  <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                </div>
              ) : (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"var(--sc-surface-2)" }}>
                        {["Vendor","GL Account","Project",""].map(h=>(
                          <th key={h} style={{ padding:"13px 20px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.5, fontWeight:500 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule,i)=>(
                        <tr key={rule.vendor} style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)" }}>
                          <td style={{ padding:"14px 20px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                              <div style={{ width:30, height:30, borderRadius:8, background:vendorColor(rule.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"var(--sc-on-accent)" }}>{initials(rule.vendor)}</div>
                              <span style={{ fontSize:14, fontWeight:500 }}>{rule.vendor}</span>
                            </div>
                          </td>
                          <td style={{ padding:"14px 20px" }}><span style={{ background:"var(--sc-border)", padding:"4px 12px", borderRadius:20, fontSize:12, color:"var(--sc-gold)" }}>{rule.gl_code} · {rule.gl_name}</span></td>
                          <td style={{ padding:"14px 20px", fontSize:13, color:"var(--sc-text-2)" }}>{rule.project||"—"}</td>
                          <td style={{ padding:"14px 20px" }}>
                            <button onClick={()=>setRules(r=>r.filter(x=>x.vendor!==rule.vendor))} style={{ background:"none", border:"1px solid var(--sc-border-2)", color:"var(--sc-error)", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer" }}>Remove</button>
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
