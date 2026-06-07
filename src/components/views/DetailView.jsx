import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function DetailView() {
  const { returnTo, goBackFromDetail, AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div style={{ maxWidth:580 }}>
              <button onClick={goBackFromDetail} style={{ background:"none", border:"none", color:"#475467", cursor:"pointer", fontSize:14, marginBottom:24, padding:0 }}>← Back to {returnTo?.label || "All transactions"}</button>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
                <div style={{ width:48, height:48, borderRadius:12, background:vendorColor(selectedInvoice.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:700, color:"#fff" }}>{initials(selectedInvoice.vendor)}</div>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:4 }}>INVOICE DETAIL</div>
                  <h1 style={{ fontSize:24, fontWeight:600, margin:0 }}>{selectedInvoice.vendor}</h1>
                </div>
              </div>
              <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:16, padding:28 }}>
                {[
                  ["Vendor", selectedInvoice.vendor],
                  ["Description", selectedInvoice.description],
                  ["Date", fmtDate(selectedInvoice.date)],
                  ["Type", selectedInvoice.type],
                  ["Project", selectedInvoice.project||"General"],
                  ["Amount", `$${selectedInvoice.amount.toLocaleString("en-US",{minimumFractionDigits:2})}`],
                  ["GL Account", `${selectedInvoice.gl_code} — ${selectedInvoice.gl_name}`],
                  ["Offset Account", `${selectedInvoice.secondary_gl_code} — ${selectedInvoice.secondary_gl_name}`],
                  ["AI Confidence", `${selectedInvoice.confidence}%`],
                ].map(([label,value])=>(
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #E4E7EC" }}>
                    <span style={{ fontSize:12, color:label==="Vendor"?"#4F46E5":"#475467", letterSpacing:0.5, fontWeight:label==="Vendor"?600:400 }}>{label}</span>
                    <span style={{ fontSize:14, color:"#101828", fontWeight:label==="Vendor"?600:500, textAlign:"right", maxWidth:"60%" }}>{value}</span>
                  </div>
                ))}
                {selectedInvoice.reasoning && (
                  <div style={{ marginTop:20, padding:"14px 16px", background:"#F5F3FF", borderLeft:"3px solid #4F46E5", borderRadius:"0 10px 10px 0" }}>
                    <div style={{ fontSize:11, color:"#4F46E5", marginBottom:8, letterSpacing:1.5, fontWeight:600 }}>AI REASONING</div>
                    <div style={{ fontSize:13, color:"#475467", lineHeight:1.7 }}>{selectedInvoice.reasoning}</div>
                  </div>
                )}
                <button onClick={()=>{ setVendorFilter(selectedInvoice.vendor); setView("invoices"); }}
                  onMouseEnter={e=>{ e.currentTarget.style.background="#F9FAFB"; e.currentTarget.style.borderColor="#98A2B3"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background="#FFFFFF"; e.currentTarget.style.borderColor="#D0D5DD"; }}
                  style={{ marginTop:20, height:40, background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:8, padding:"0 16px", color:"#344054", fontSize:14, fontWeight:500, cursor:"pointer", width:"100%", transition:"all 0.12s" }}>
                  View all invoices for {selectedInvoice.vendor} →
                </button>
              </div>
            </div>
  );
}
