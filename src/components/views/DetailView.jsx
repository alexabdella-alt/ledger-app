import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function DetailView() {
  const { returnTo, goBackFromDetail, setBooksFilter, CHART_OF_ACCOUNTS, CONTRACT_TYPES, aiStep, aiSuggestion, allProjects, allVendorNames, apView, applyMatch, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatLoading, chatOpen, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, recurring, recurringNewRec, reportDateFrom, reportDateTo, reportRange, reportType, rules, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setAiStep, setAiSuggestion, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setChatHistory, setChatLoading, setChatOpen, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchQueue, setNotification, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div style={{ maxWidth:580 }}>
              <button onClick={goBackFromDetail} style={{ background:"none", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:14, marginBottom:24, padding:0 }}>← Back to {returnTo?.label || "All transactions"}</button>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
                <div style={{ width:48, height:48, borderRadius:12, background:vendorColor(selectedInvoice.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:700, color:"var(--sc-on-accent)" }}>{initials(selectedInvoice.vendor)}</div>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:4 }}>INVOICE DETAIL</div>
                  <h1 style={{ fontSize:24, fontWeight:600, margin:0 }}>{selectedInvoice.vendor}</h1>
                </div>
              </div>
              <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, padding:28 }}>
                {/* ★ C354 — A MISSING FIELD RENDERS AS NOTHING, NOT AS "undefined — undefined".
                    A payment, a clearing or an opening balance has no confidence and may carry
                    no offset on the flattened row; this page (reachable from a Documents card
                    since C326) printed the word `undefined` for both. A row is shown only when
                    there is something to show. */}
                {[
                  ["Vendor", selectedInvoice.vendor],
                  ["Description", selectedInvoice.description],
                  ["Date", fmtDate(selectedInvoice.date)],
                  ["Project", selectedInvoice.project||"General"],
                  ["Amount", fmtMoney(selectedInvoice.amount)],
                  ["Category", [selectedInvoice.gl_code, selectedInvoice.gl_name].filter(Boolean).join(" — ") || null],
                  ["Against", [selectedInvoice.secondary_gl_code, selectedInvoice.secondary_gl_name].filter(Boolean).join(" — ") || null],
                  ["How sure we were", selectedInvoice.confidence != null && selectedInvoice.confidence !== "" ? `${selectedInvoice.confidence}%` : null],
                ].filter(([,value]) => value != null && value !== "").map(([label,value])=>(
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid var(--sc-border)" }}>
                    <span style={{ fontSize:12, color:label==="Vendor"?"var(--sc-gold)":"var(--sc-text-2)", letterSpacing:0.5, fontWeight:label==="Vendor"?600:400 }}>{label}</span>
                    <span style={{ fontSize:14, color:"var(--sc-text)", fontWeight:label==="Vendor"?600:500, textAlign:"right", maxWidth:"60%" }}>{value}</span>
                  </div>
                ))}
                {selectedInvoice.reasoning && (
                  <div style={{ marginTop:20, padding:"14px 16px", background:"var(--sc-gold-soft)", borderLeft:"3px solid var(--sc-gold)", borderRadius:"0 10px 10px 0" }}>
                    <div style={{ fontSize:11, color:"var(--sc-gold)", marginBottom:8, letterSpacing:1.5, fontWeight:600 }}>WHY IT WAS BOOKED THIS WAY</div>
                    <div style={{ fontSize:13, color:"var(--sc-text-2)", lineHeight:1.7 }}>{selectedInvoice.reasoning}</div>
                  </div>
                )}
                {/* ★★ C315 — THIS WENT TO `invoices`, WHICH NO SEAT CAN NAVIGATE TO. For a
                    CLIENT the route guard bounced it Home — dead since C197, because `detail`
                    was already theirs and nothing checked where its buttons led. For a CPA it
                    "worked" and landed them on a screen with no nav row, so the sidebar could
                    not say where they were. `books` + the vendor filter shows the same rows on
                    the screen both seats actually have. */}
                <button onClick={()=>{ setVendorFilter(selectedInvoice.vendor); setBooksFilter && setBooksFilter("all"); setView("books"); }}
                  onMouseEnter={e=>{ e.currentTarget.style.background="var(--sc-surface-2)"; e.currentTarget.style.borderColor="var(--sc-text-mut)"; }}
                  onMouseLeave={e=>{ e.currentTarget.style.background="var(--sc-surface)"; e.currentTarget.style.borderColor="var(--sc-border-2)"; }}
                  style={{ marginTop:20, height:40, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"0 16px", color:"var(--sc-text-2)", fontSize:14, fontWeight:500, cursor:"pointer", width:"100%", transition:"all 0.12s" }}>
                  View all invoices for {selectedInvoice.vendor} →
                </button>
              </div>
            </div>
  );
}
