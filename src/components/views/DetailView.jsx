import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney } from "../../lib/format";
import { entryTotalOf, entryLineCount, classifyTxn } from "../../lib/txnPresent";
import { getAuthHeaders } from "../../lib/supabase";

export default function DetailView() {
  const { returnTo, goBackFromDetail, setBooksFilter, CHART_OF_ACCOUNTS, CONTRACT_TYPES, aiStep, aiSuggestion, allProjects, allVendorNames, apView, applyMatch, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatLoading, chatOpen, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, recurring, recurringNewRec, reportDateFrom, reportDateTo, reportRange, reportType, rules, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setAiStep, setAiSuggestion, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setChatHistory, setChatLoading, setChatOpen, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchQueue, setNotification, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  // C510 — the page said "INVOICE DETAIL · Vendor: Acme" over an invoice the owner SENT to
  // Acme. The direction decides the words: a sale names a Customer, a purchase a Supplier,
  // a settlement says which; the kicker follows.
  const dirCls = selectedInvoice ? classifyTxn(selectedInvoice, {}) : null;
  const settleKind = dirCls?.settle || null;
  const partyLabel = settleKind === "ar_collection" ? "Customer" : settleKind === "ap_payment" ? "Supplier" : (dirCls?.inflow ? "Customer" : "Supplier");
  const pageKicker = settleKind === "ar_collection" ? "PAYMENT RECEIVED" : settleKind === "ap_payment" ? "PAYMENT MADE" : (dirCls?.inflow ? "SALE" : "PURCHASE");
  return (
            <div style={{ maxWidth:580 }}>
              <button onClick={goBackFromDetail} style={{ background:"none", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:14, marginBottom:24, padding:0 }}>← Back to {returnTo?.label || "All transactions"}</button>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
                <div style={{ width:48, height:48, borderRadius:12, background:vendorColor(selectedInvoice.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:700, color:"var(--sc-on-accent)" }}>{initials(selectedInvoice.vendor)}</div>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:4 }}>{pageKicker}</div>
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
                  [partyLabel, selectedInvoice.vendor],   // C510 — "Customer" on a sale, "Supplier" on a purchase
                  ["Description", selectedInvoice.description],
                  ["Date", fmtDate(selectedInvoice.date)],
                  ["Project", selectedInvoice.project||"General"],
                  ["Amount", fmtMoney(entryTotalOf(selectedInvoice, invoices))],   // C509 — the whole entry's, not one line's
                  ["Category", [selectedInvoice.gl_code, selectedInvoice.gl_name].filter(Boolean).join(" — ") || null],
                  ["Against", [selectedInvoice.secondary_gl_code, selectedInvoice.secondary_gl_name].filter(Boolean).join(" — ") || null],
                  ["How sure we were", selectedInvoice.confidence != null && selectedInvoice.confidence !== "" ? `${selectedInvoice.confidence}%` : null],
                ].filter(([,value]) => value != null && value !== "").map(([label,value])=>(
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid var(--sc-border)" }}>
                    <span style={{ fontSize:12, color:label===partyLabel?"var(--sc-gold)":"var(--sc-text-2)", letterSpacing:0.5, fontWeight:label===partyLabel?600:400 }}>{label}</span>
                    <span style={{ fontSize:14, color:"var(--sc-text)", fontWeight:label===partyLabel?600:500, textAlign:"right", maxWidth:"60%" }}>{value}</span>
                  </div>
                ))}
                {/* C509 — THE FULL ENTRY, LINE BY LINE. The panel says "3 lines (see Full entry)" and this
                    page showed two accounts and one line's amount: the tax line of a taxed invoice was
                    nowhere on the screen named for showing it. */}
                {entryLineCount(selectedInvoice, invoices) > 1 && (() => {
                  const base = String(selectedInvoice.db_entry_id != null ? selectedInvoice.db_entry_id : String(selectedInvoice.id).split("_")[0]);
                  const lines = (invoices || []).filter(r => r && String(r.db_entry_id != null ? r.db_entry_id : String(r.id).split("_")[0]) === base);
                  return (
                    <div style={{ marginTop:20 }} data-entry-lines>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:8, letterSpacing:1.5, fontWeight:600 }}>THE WHOLE ENTRY · {lines.length} LINES</div>
                      {lines.map(l => (
                        <div key={l.id} style={{ display:"flex", justifyContent:"space-between", padding:"8px 0", borderBottom:"1px solid var(--sc-border)", fontSize:13 }}>
                          <span style={{ color:"var(--sc-text)" }}>{[l.gl_code, l.gl_name].filter(Boolean).join(" — ")}</span>
                          <span style={{ fontFamily:"'DM Mono',monospace", color:"var(--sc-text-2)" }}>{l.debit_credit === "debit" ? "+" : "−"}{fmtMoney(l.amount)}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
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
