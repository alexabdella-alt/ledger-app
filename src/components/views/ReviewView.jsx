import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ReviewView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div>
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:8 }}>DOCUMENT REVIEW</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Needs Review</h1>
                <div style={{ fontSize:13, color:"#475467", marginTop:6 }}>Documents that needed a closer look. Claude has read each one and proposed the correct accounting treatment — review and post with one click.</div>
              </div>
              {unknownDocs.length===0 ? (
                <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, padding:48, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>✓</div>
                  <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>Nothing needs review</div>
                  <div style={{ fontSize:13, color:"#475467" }}>Any document the system can't classify will land here with an AI explanation and proposed entry.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {unknownDocs.map(doc => {
                    const fmt = n => "$"+(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
                    const totalDebits = (doc.journal_entry?.lines||[]).reduce((s,l)=>s+(l.debit||0),0);

                    const postEntry = () => {
                      if (!doc.journal_entry) return;
                      // Build a ledger entry from the first debit line
                      const debitLine = doc.journal_entry.lines.find(l=>l.debit>0);
                      const creditLine = doc.journal_entry.lines.find(l=>l.credit>0);
                      if (!debitLine) return;
                      const newInvoice = {
                        id: Date.now()+Math.random(),
                        vendor: doc.document_type,
                        description: doc.journal_entry.description,
                        amount: debitLine.debit,
                        date: doc.journal_entry.date || new Date().toISOString().slice(0,10),
                        type: "expense",
                        gl_code: debitLine.account_code,
                        gl_name: debitLine.account_name,
                        secondary_gl_code: creditLine?.account_code || getAccountByRole("accounts_payable")?.code,
                        secondary_gl_name: creditLine?.account_name || getAccountByRole("accounts_payable")?.name,
                        debit_credit: "debit",
                        confidence: 95,
                        reasoning: `Posted from Needs Review: ${doc.document_type}`,
                        status: "booked",
                        booked_at: new Date().toISOString(),
                        source: "needs_review",
                        payment_status: "unpaid",
                      };
                      setInvoices(prev => [newInvoice, ...prev]);
                      setUnknownDocs(prev => prev.map(d => d.id===doc.id ? {...d, posted:true} : d));
                      showNotification(`Entry posted: ${doc.document_type} · ${fmt(debitLine.debit)} ✓`);
                    };

                    const dismiss = () => setUnknownDocs(prev => prev.filter(d => d.id!==doc.id));

                    return (
                      <div key={doc.id} style={{ background:"#FFFFFF", border:`1px solid ${doc.posted?"#03985533":doc.entry_needed?"#4F46E522":"#E4E7EC"}`, borderRadius:14, overflow:"hidden" }}>

                        {/* Header */}
                        <div style={{ padding:"18px 20px", display:"flex", alignItems:"flex-start", gap:14 }}>
                          <div style={{ width:44, height:44, borderRadius:11, background:doc.posted?"#D1FAE522":doc.entry_needed?"#F3F4F6":"#FFFFFF", border:`1px solid ${doc.posted?"#03985544":doc.entry_needed?"#4F46E533":"#D0D5DD"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                            {doc.posted ? "✓" : doc.entry_needed ? "📋" : "📄"}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:15, fontWeight:600 }}>{doc.document_type}</span>
                              {doc.posted && <span style={{ fontSize:11, background:"#03985522", color:"#039855", borderRadius:20, padding:"2px 9px" }}>✓ Posted</span>}
                              {!doc.posted && doc.entry_needed && <span style={{ fontSize:11, background:"#4F46E522", color:"#4F46E5", borderRadius:20, padding:"2px 9px" }}>Entry proposed</span>}
                              {!doc.posted && !doc.entry_needed && <span style={{ fontSize:11, background:"#E4E7EC", color:"#475467", borderRadius:20, padding:"2px 9px" }}>No entry needed</span>}
                            </div>
                            <div style={{ fontSize:11, color:"#475467", marginBottom:12 }}>{doc.name} · Uploaded {doc.uploaded_at?.slice(0,10)}</div>

                            {/* AI explanation */}
                            <div style={{ background:"#F7F8FA", border:"1px solid #4F46E522", borderRadius:10, padding:"12px 16px", marginBottom: doc.entry_needed && !doc.posted ? 14 : 0 }}>
                              <div style={{ fontSize:10, color:"#4F46E5", marginBottom:6, letterSpacing:1.5 }}>✦ AI ANALYSIS</div>
                              <div style={{ fontSize:13, color:"#374151", lineHeight:1.75 }}>{doc.ai_explanation}</div>
                              {doc.no_entry_reason && <div style={{ fontSize:12, color:"#475467", marginTop:8, borderTop:"1px solid #E4E7EC", paddingTop:8 }}>No entry needed: {doc.no_entry_reason}</div>}
                            </div>

                            {/* Proposed journal entry */}
                            {doc.entry_needed && doc.journal_entry && !doc.posted && (
                              <div style={{ background:"#F3F4F6", border:"1px solid #D0D5DD", borderRadius:10, overflow:"hidden" }}>
                                <div style={{ padding:"10px 14px", borderBottom:"1px solid #D0D5DD", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                  <div>
                                    <div style={{ fontSize:11, color:"#4F46E5", letterSpacing:1 }}>PROPOSED JOURNAL ENTRY</div>
                                    <div style={{ fontSize:12, color:"#475467", marginTop:2 }}>{doc.journal_entry.description} · {doc.journal_entry.date}</div>
                                  </div>
                                  <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#101828" }}>{fmt(totalDebits)}</div>
                                </div>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <thead><tr style={{ background:"#F7F8FA" }}>
                                    {["Account","Debit","Credit"].map(h=><th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:10, color:"#475467", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                                  </tr></thead>
                                  <tbody>
                                    {doc.journal_entry.lines.map((line,i)=>(
                                      <tr key={i} style={{ borderTop:"1px solid #E4E7EC" }}>
                                        <td style={{ padding:"10px 14px" }}>
                                          <span style={{ fontSize:11, background:"#E4E7EC", color:"#475467", borderRadius:4, padding:"2px 7px", marginRight:8 }}>{line.account_code}</span>
                                          <span style={{ fontSize:13, color:line.debit>0?"#101828":"#475467", paddingLeft:line.credit>0?16:0 }}>{line.account_name}</span>
                                        </td>
                                        <td style={{ padding:"10px 14px", fontFamily:"'DM Mono',monospace", fontSize:13, color:"#101828" }}>{line.debit>0?fmt(line.debit):"—"}</td>
                                        <td style={{ padding:"10px 14px", fontFamily:"'DM Mono',monospace", fontSize:13, color:"#475467" }}>{line.credit>0?fmt(line.credit):"—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Already posted confirmation */}
                            {doc.posted && (
                              <div style={{ marginTop:12, fontSize:13, color:"#039855" }}>✓ Entry posted to ledger · {doc.journal_entry?.date}</div>
                            )}

                            {/* Watch match alerts — triggered conditions */}
                            {(doc.watch_matches||[]).length > 0 && (
                              <div style={{ marginTop:14 }}>
                                {doc.watch_matches.map((match, mi) => (
                                  <div key={mi} style={{ background:"#FEF3C7", border:"1px solid #DC680344", borderRadius:10, padding:"12px 16px", marginBottom:8 }}>
                                    <div style={{ fontSize:11, color:"#DC6803", letterSpacing:1.2, marginBottom:6 }}>🔔 WATCH TRIGGERED</div>
                                    <div style={{ fontSize:13, color:"#101828", marginBottom:6, fontWeight:500 }}>{match.trigger_description}</div>
                                    <div style={{ fontSize:12, color:"#475467", marginBottom:10 }}>
                                      Matched: <strong style={{ color:"#101828" }}>{match.vendor}</strong> · {fmt(match.amount)} · {match.date}
                                    </div>
                                    {match.suggested_entry_description && (
                                      <div style={{ fontSize:12, color:"#DC6803", marginBottom:10 }}>
                                        Suggested action: {match.suggested_entry_description}
                                      </div>
                                    )}
                                    <button
                                      onClick={() => {
                                        // Post the suggested entry for this match
                                        const newInvoice = {
                                          id: Date.now()+Math.random(),
                                          vendor: doc.document_type,
                                          description: match.suggested_entry_description || match.trigger_description,
                                          amount: match.amount,
                                          date: match.date || new Date().toISOString().slice(0,10),
                                          type: "expense",
                                          gl_code: match.suggested_gl_code || getAccountByRole("miscellaneous_expense")?.code,
                                          gl_name: match.suggested_gl_name || getAccountByRole("miscellaneous_expense")?.name,
                                          secondary_gl_code: getAccountByRole("cash")?.code,
                                          secondary_gl_name: getAccountByRole("cash")?.name,
                                          debit_credit: "debit",
                                          confidence: 90,
                                          reasoning: `Watch trigger posted: ${doc.document_type}`,
                                          status: "booked",
                                          booked_at: new Date().toISOString(),
                                          source: "watch_trigger",
                                          payment_status: "unpaid",
                                        };
                                        setInvoices(prev => [newInvoice, ...prev]);
                                        setUnknownDocs(prev => prev.map(d => d.id===doc.id
                                          ? { ...d, watch_matches: d.watch_matches.map((m,i) => i===mi ? {...m, posted:true} : m) }
                                          : d
                                        ));
                                        showNotification(`Entry posted: ${doc.document_type} watch trigger ✓`);
                                      }}
                                      disabled={match.posted}
                                      style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:match.posted?"#E4E7EC":"linear-gradient(135deg,#DC6803,#DC6803)", border:"none", color:match.posted?"#475467":"#DC6803", cursor:match.posted?"default":"pointer" }}>
                                      {match.posted ? "✓ Entry Posted" : "Post Entry for This Event"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Watching for — active conditions */}
                            {!doc.posted && (doc.watch_for||[]).length > 0 && (
                              <div style={{ marginTop:14, background:"#ECFDF5", border:"1px solid #03985522", borderRadius:10, padding:"12px 16px" }}>
                                <div style={{ fontSize:10, color:"#039855", letterSpacing:1.5, marginBottom:8 }}>👁 WATCHING FOR</div>
                                {doc.watch_for.map((w, wi) => (
                                  <div key={wi} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom: wi < doc.watch_for.length-1 ? 10 : 0 }}>
                                    <div style={{ width:5, height:5, borderRadius:"50%", background:"#039855", marginTop:6, flexShrink:0 }} />
                                    <div>
                                      <div style={{ fontSize:13, color:"#374151" }}>{w.trigger_description}</div>
                                      {w.suggested_entry_description && (
                                        <div style={{ fontSize:11, color:"#475467", marginTop:2 }}>If triggered → {w.suggested_entry_description}</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <div style={{ fontSize:11, color:"#475467", marginTop:10, borderTop:"1px solid #E4E7EC", paddingTop:8 }}>
                                  The system will automatically detect related transactions and alert you here.
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Dismiss button */}
                          {doc.posted && (
                            <button onClick={dismiss} style={{ background:"transparent", border:"none", color:"#475467", cursor:"pointer", fontSize:16, padding:"2px 6px", flexShrink:0 }}>×</button>
                          )}
                        </div>

                        {/* Action bar */}
                        {!doc.posted && (
                          <div style={{ padding:"12px 20px", borderTop:"1px solid #E4E7EC", background:"#F3F4F6", display:"flex", gap:8, alignItems:"center" }}>
                            {doc.entry_needed && doc.journal_entry && (
                              <button onClick={postEntry} style={{ padding:"9px 22px", borderRadius:9, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#4F46E5,#4338CA)", border:"none", color:"#fff", cursor:"pointer" }}>
                                Post Entry to Ledger
                              </button>
                            )}
                            <button onClick={dismiss} style={{ padding:"9px 16px", borderRadius:9, fontSize:13, background:"transparent", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer" }}>
                              {doc.entry_needed ? "Dismiss Without Posting" : "Dismiss"}
                            </button>
                            <div style={{ marginLeft:"auto", fontSize:12, color:"#475467" }}>
                              {doc.entry_needed ? "Review the entry above, then post when ready." : "No accounting action required."}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
  );
}
