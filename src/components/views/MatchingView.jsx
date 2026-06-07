import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function MatchingView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const openPayables    = invoices.filter(i => i.type==="expense" && !i.matched && i.payment_status!=="paid" && !glIsBalSheet(i.gl_code));
            const openReceivables = invoices.filter(i => i.type==="revenue" && !i.matched && i.payment_status!=="collected" && !glIsBalSheet(i.gl_code));
            const partialItems = invoices.filter(i => i.payment_status==="partial");

            const matchTypeLabel = {
              ap_clear: { label:"AP Cleared", color:"#039855", icon:"✓", desc:"Bank payment clears accrued expense" },
              ar_clear: { label:"AR Collected", color:"#6366F1", icon:"✓", desc:"Bank deposit clears receivable" },
              partial_ap: { label:"Partial Payment", color:"#DC6803", icon:"½", desc:"Partial payment against invoice" },
              partial_ar: { label:"Partial Collection", color:"#DC6803", icon:"½", desc:"Partial collection against receivable" },
            };

            return (
              <div>
                <div style={{ marginBottom:28 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:8 }}>RECONCILIATION</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Matching Engine</h1>
                  <div style={{ fontSize:13, color:"#475467", marginTop:6 }}>Bank transactions are automatically matched to open invoices and accruals. High-confidence matches are auto-cleared. Review ambiguous ones below.</div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
                  {[
                    { label:"Open Payables", value:openPayables.length, sub:fmt(openPayables.reduce((s,i)=>s+i.amount,0))+" outstanding", color:"#D92D20" },
                    { label:"Open Receivables", value:openReceivables.length, sub:fmt(openReceivables.reduce((s,i)=>s+i.amount,0))+" outstanding", color:"#039855" },
                    { label:"Needs Review", value:matchQueue.length, sub:"matches awaiting confirmation", color:"#DC6803" },
                    { label:"Cleared This Session", value:matchHistory.length, sub:fmt(matchHistory.reduce((s,m)=>s+(m.amount_matched||0),0))+" matched", color:"#4F46E5" },
                  ].map(card=>(
                    <div key={card.label} style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:12, padding:"18px 20px" }}>
                      <div style={{ fontSize:11, color:"#475467", letterSpacing:1, marginBottom:8 }}>{card.label.toUpperCase()}</div>
                      <div style={{ fontSize:26, fontWeight:700, fontFamily:"'DM Mono',monospace", color:card.color }}>{card.value}</div>
                      <div style={{ fontSize:11, color:"#475467", marginTop:4 }}>{card.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Match review queue */}
                {matchQueue.length > 0 && (
                  <div style={{ marginBottom:28 }}>
                    <div style={{ fontSize:11, color:"#DC6803", letterSpacing:2, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
                      <span>⚠ NEEDS REVIEW</span>
                      <span style={{ background:"#DC680322", border:"1px solid #DC680344", borderRadius:20, padding:"1px 10px", fontSize:11 }}>{matchQueue.length}</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                      {matchQueue.map(match => {
                        const mt = matchTypeLabel[match.match_type] || { label:match.match_type, color:"#475467", icon:"?", desc:"" };
                        return (
                          <div key={match.id} style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:14, overflow:"hidden" }}>
                            {/* Match header */}
                            <div style={{ padding:"16px 20px", borderBottom:"1px solid #E4E7EC", display:"flex", alignItems:"center", gap:14 }}>
                              <div style={{ width:38, height:38, borderRadius:10, background:mt.color+"22", border:`1px solid ${mt.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{mt.icon}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                                  <span style={{ fontSize:14, fontWeight:600 }}>{match.bank_txn?.vendor || "Unknown"}</span>
                                  <span style={{ fontSize:11, background:mt.color+"22", color:mt.color, borderRadius:20, padding:"2px 8px" }}>{mt.label}</span>
                                  <span style={{ fontSize:11, background:"#E4E7EC", color:match.confidence>=80?"#039855":"#DC6803", borderRadius:20, padding:"2px 8px", fontFamily:"'DM Mono',monospace" }}>{match.confidence}% match</span>
                                </div>
                                <div style={{ fontSize:12, color:"#475467" }}>{match.bank_txn?.date} · {match.bank_txn?.description}</div>
                              </div>
                              <div style={{ textAlign:"right", flexShrink:0 }}>
                                <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#101828" }}>{fmt(match.amount_matched)}</div>
                                {match.amount_remaining > 0.01 && <div style={{ fontSize:11, color:"#DC6803" }}>{fmt(match.amount_remaining)} remaining</div>}
                              </div>
                            </div>

                            {/* Matched invoice(s) */}
                            <div style={{ padding:"12px 20px", background:"#F7F8FA", borderBottom:"1px solid #E4E7EC" }}>
                              <div style={{ fontSize:11, color:"#475467", marginBottom:8 }}>MATCHING AGAINST</div>
                              {match.matched_invoices?.map(inv=>(
                                <div key={inv.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ width:24, height:24, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                    <div>
                                      <div style={{ fontSize:12, fontWeight:500 }}>{inv.vendor}</div>
                                      <div style={{ fontSize:11, color:"#475467" }}>{inv.description} · {inv.date}</div>
                                    </div>
                                  </div>
                                  <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:inv.type==="revenue"?"#039855":"#D92D20" }}>{fmt(inv.amount)}</div>
                                </div>
                              ))}
                            </div>

                            {/* AI reasoning */}
                            <div style={{ padding:"12px 20px", borderBottom:"1px solid #E4E7EC" }}>
                              <div style={{ fontSize:11, color:"#4F46E5", marginBottom:4 }}>✦ WHY THIS MATCHES</div>
                              <div style={{ fontSize:12, color:"#475467", lineHeight:1.6 }}>{match.reasoning}</div>
                            </div>

                            {/* Clearing entry preview */}
                            {match.clearing_entry && (
                              <div style={{ padding:"12px 20px", background:"#ECFDF5", borderBottom:"1px solid #E4E7EC" }}>
                                <div style={{ fontSize:11, color:"#039855", marginBottom:8 }}>CLEARING JOURNAL ENTRY</div>
                                <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 100px 100px", gap:8, fontSize:12 }}>
                                  <span style={{ color:"#4F46E5", fontFamily:"'DM Mono',monospace" }}>{match.clearing_entry.debit_account_code}</span>
                                  <span style={{ color:"#374151" }}>{match.clearing_entry.debit_account_name}</span>
                                  <span style={{ color:"#039855", textAlign:"right", fontFamily:"'DM Mono',monospace" }}>{fmt(match.clearing_entry.amount)}</span>
                                  <span style={{ color:"#475467", textAlign:"right" }}>—</span>
                                </div>
                                <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 100px 100px", gap:8, fontSize:12, marginTop:6 }}>
                                  <span style={{ color:"#4F46E5", fontFamily:"'DM Mono',monospace" }}>{match.clearing_entry.credit_account_code}</span>
                                  <span style={{ color:"#374151", paddingLeft:16 }}>{match.clearing_entry.credit_account_name}</span>
                                  <span style={{ color:"#475467", textAlign:"right" }}>—</span>
                                  <span style={{ color:"#475467", textAlign:"right", fontFamily:"'DM Mono',monospace" }}>{fmt(match.clearing_entry.amount)}</span>
                                </div>
                              </div>
                            )}

                            {/* Actions */}
                            <div style={{ padding:"14px 20px", display:"flex", gap:10 }}>
                              <button onClick={()=>applyMatch(match)} style={{ flex:1, padding:"10px", borderRadius:10, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#D1FAE5,#039855)", border:"none", color:"#039855", cursor:"pointer" }}>
                                ✓ Confirm Match & Post Entry
                              </button>
                              <button onClick={()=>dismissMatch(match.id)} style={{ padding:"10px 18px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer" }}>
                                Dismiss
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Open Payables */}
                {openPayables.length > 0 && (
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:11, color:"#D92D20", letterSpacing:2, marginBottom:14 }}>OPEN PAYABLES — AWAITING PAYMENT</div>
                    <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"clip" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead><tr style={{ background:"#F3F4F6" }}>
                          {["Vendor","Date","Description","GL Account","Amount","Status"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#475467", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {openPayables.map((inv,i)=>(
                            <tr key={inv.id} style={{ borderTop:"1px solid #E4E7EC", background:i%2===0?"transparent":"#F7F8FA" }}>
                              <td style={{ padding:"12px 16px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                </div>
                              </td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#475467" }}>{inv.date}</td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#475467", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                              <td style={{ padding:"12px 16px" }}><span style={{ background:"#E4E7EC", padding:"2px 8px", borderRadius:20, fontSize:11, color:"#4F46E5" }}>{inv.gl_code} · {inv.gl_name}</span></td>
                              <td style={{ padding:"12px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#D92D20" }}>{fmt(inv.balance_remaining || inv.amount)}</td>
                              <td style={{ padding:"12px 16px" }}>
                                <span style={{ fontSize:11, background:inv.payment_status==="partial"?"#FEF3C7":"#FEF2F2", border:`1px solid ${inv.payment_status==="partial"?"#DC680344":"#D92D2044"}`, color:inv.payment_status==="partial"?"#DC6803":"#D92D20", borderRadius:20, padding:"2px 10px" }}>
                                  {inv.payment_status==="partial"?"Partial":"Unpaid"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Open Receivables */}
                {openReceivables.length > 0 && (
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:11, color:"#039855", letterSpacing:2, marginBottom:14 }}>OPEN RECEIVABLES — AWAITING COLLECTION</div>
                    <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"clip" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead><tr style={{ background:"#F3F4F6" }}>
                          {["Customer","Date","Description","Amount","Status"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#475467", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {openReceivables.map((inv,i)=>(
                            <tr key={inv.id} style={{ borderTop:"1px solid #E4E7EC", background:i%2===0?"transparent":"#F7F8FA" }}>
                              <td style={{ padding:"12px 16px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                </div>
                              </td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#475467" }}>{inv.date}</td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#475467", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                              <td style={{ padding:"12px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#039855" }}>{fmt(inv.balance_remaining || inv.amount)}</td>
                              <td style={{ padding:"12px 16px" }}>
                                <span style={{ fontSize:11, background:inv.payment_status==="partial"?"#FEF3C7":"#ECFDF5", border:`1px solid ${inv.payment_status==="partial"?"#DC680344":"#03985544"}`, color:inv.payment_status==="partial"?"#DC6803":"#039855", borderRadius:20, padding:"2px 10px" }}>
                                  {inv.payment_status==="partial"?"Partial":"Outstanding"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Match history */}
                {matchHistory.length > 0 && (
                  <div>
                    <div style={{ fontSize:11, color:"#475467", letterSpacing:2, marginBottom:14 }}>CLEARED THIS SESSION</div>
                    <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"hidden" }}>
                      {matchHistory.map((m,i)=>{
                        const mt = matchTypeLabel[m.match_type] || { label:m.match_type, color:"#039855", icon:"✓" };
                        return (
                          <div key={m.id} style={{ padding:"14px 20px", borderTop:i>0?"1px solid #E4E7EC":"none", display:"flex", alignItems:"center", gap:12 }}>
                            <div style={{ width:28, height:28, borderRadius:8, background:"#03985522", border:"1px solid #03985555", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>✓</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:500 }}>{m.bank_txn?.vendor} matched → {m.matched_invoices?.map(i=>i.vendor).join(", ")}</div>
                              <div style={{ fontSize:11, color:"#475467" }}>{mt.label} · {m.confidence}% confidence · {m.bank_txn?.date}</div>
                            </div>
                            <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#039855" }}>{fmt(m.amount_matched)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {matchQueue.length===0 && openPayables.length===0 && openReceivables.length===0 && matchHistory.length===0 && (
                  <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>⇋</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No open items to match</div>
                    <div style={{ fontSize:13, color:"#475467", marginBottom:20 }}>Upload a bank statement to automatically match payments against open invoices and accruals.</div>
                    <button onClick={()=>setView("home")} style={{ background:"linear-gradient(135deg,#4F46E5,#4338CA)", border:"none", color:"#fff", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Upload a statement →</button>
                  </div>
                )}
              </div>
            );
}
