import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function BankView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  // Which account this statement belongs to — its GL is the offset for direct
  // bookings (Cr 1000 bank / Cr 2200 credit card). Defaults to the first account.
  const [importAccountId, setImportAccountId] = React.useState(null);
  const importAccount = (bankAccounts||[]).find(a => a.id === importAccountId) || (bankAccounts||[])[0] || null;
  const accountPicker = (bankAccounts||[]).length > 0 && (
    <div style={{ marginBottom:14, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
      <span style={{ fontSize:13, fontWeight:600, color:"#344054" }}>Account</span>
      <select value={importAccount?.id || ""} onChange={e=>setImportAccountId(e.target.value)}
        style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:8, padding:"8px 12px", fontSize:13, color:"#101828", outline:"none", minWidth:240 }}>
        {(bankAccounts||[]).map(a => <option key={a.id} value={a.id}>{a.name||"Account"} · {(a.type||"checking").replace("_"," ")}</option>)}
      </select>
      <span style={{ fontSize:12, color:"#98A2B3" }}>Charges offset to this account {importAccount?.type==="credit_card" ? "(credit card → liability 2200)" : "(bank → cash 1000)"}</span>
    </div>
  );
  return (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"#475467", marginBottom:8 }}>BANK FEED</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Import Bank Transactions</h1>
                <div style={{ fontSize:13, color:"#475467", marginTop:6 }}>Upload a CSV, Excel, or PDF bank statement — AI reads every transaction, auto-categorizes, and flags anything it's unsure about.</div>
              </div>

              {/* Upload zone */}
              {!bankProcessing && bankTransactions.length === 0 && (
                <>
                {accountPicker}
                <div onDragOver={e=>{e.preventDefault();setBankDragOver(true);}} onDragLeave={()=>setBankDragOver(false)}
                  onDrop={e=>{e.preventDefault();setBankDragOver(false);handleBankFile(e.dataTransfer.files[0], importAccount);}}
                  onClick={()=>document.getElementById("bank-upload").click()}
                  style={{ border:`2px dashed ${bankDragOver?"#6366F1":"#D0D5DD"}`, borderRadius:16, padding:"52px 32px", textAlign:"center", cursor:"pointer", background:bankDragOver?"#EEF2FF":"#FFFFFF", transition:"all 0.2s", marginBottom:24 }}>
                  <div style={{ fontSize:40, marginBottom:14 }}>🏦</div>
                  <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop your bank statement here</div>
                  <div style={{ fontSize:13, color:"#475467", marginBottom:16 }}>CSV · Excel (.xlsx) · PDF — from any bank</div>
                  <div style={{ display:"flex", justifyContent:"center", gap:10 }}>
                    {["CSV","XLSX","PDF"].map(f=><span key={f} style={{ background:"#E4E7EC", border:"1px solid #D0D5DD", borderRadius:6, padding:"4px 12px", fontSize:11, color:"#475467" }}>{f}</span>)}
                  </div>
                  <input id="bank-upload" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display:"none" }} onChange={e=>handleBankFile(e.target.files[0], importAccount)} />
                </div>
                </>
              )}

              {/* Processing state */}
              {bankProcessing && (
                <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:16, padding:36, textAlign:"center", marginBottom:24 }}>
                  <div style={{ fontSize:13, color:"#4F46E5", marginBottom:20 }}>
                    {bankStep==="parsing" ? "⟳ Reading bank statement..." : "⟳ AI is categorizing all transactions..."}
                  </div>
                  <div style={{ height:6, background:"#E4E7EC", borderRadius:3, overflow:"hidden", maxWidth:400, margin:"0 auto 12px" }}>
                    <div style={{ height:"100%", background:"linear-gradient(90deg,#6366F1,#4F46E5)", borderRadius:3, width:`${bankProgress}%`, transition:"width 0.8s ease", animation:"pulse 2s ease-in-out infinite" }} />
                  </div>
                  <div style={{ fontSize:12, color:"#475467" }}>{bankFileName}</div>
                </div>
              )}

              {/* Transaction review table */}
              {bankTransactions.length > 0 && (
                <div>
                  {/* Summary bar */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                    {[
                      { label:"Total Transactions", value:bankTransactions.length, color:"#101828" },
                      { label:"Auto-Categorized", value:bankTransactions.filter(t=>!t.needs_review).length, color:"#039855" },
                      { label:"Needs Review", value:bankTransactions.filter(t=>t.needs_review).length, color:"#DC6803" },
                    ].map(s=>(
                      <div key={s.label} style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontSize:11, color:"#475467", marginBottom:6, letterSpacing:1 }}>{s.label.toUpperCase()}</div>
                        <div style={{ fontSize:24, fontWeight:600, color:s.color, fontFamily:"'DM Mono', monospace" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Needs review section */}
                  {bankTransactions.filter(t=>t.needs_review).length > 0 && (
                    <div style={{ background:"#FEF3C7", border:"1px solid #DC680344", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ fontSize:12, color:"#DC6803", marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
                        <span>⚠</span> <span>These transactions need your input — AI wasn't confident enough to auto-categorize</span>
                      </div>
                      {bankTransactions.filter(t=>t.needs_review).map(t=>(
                        <div key={t.id} style={{ background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:10, padding:"14px 16px", marginBottom:10 }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 160px 40px", gap:12, alignItems:"center" }}>
                            <div>
                              <div style={{ fontSize:13, fontWeight:500 }}>{t.description}</div>
                              <div style={{ fontSize:11, color:"#475467", marginTop:2 }}>{fmtDate(t.date)} · Detected vendor: <span style={{ color:"#4F46E5" }}>{t.vendor||"Unknown"}</span></div>
                            </div>
                            <div style={{ fontSize:14, fontFamily:"'DM Mono', monospace", color:t.type==="revenue"?"#039855":"#D92D20", textAlign:"right" }}>
                              {t.type==="revenue"?"+":"-"}${Math.abs(t.amount).toLocaleString("en-US",{minimumFractionDigits:2})}
                            </div>
                            <select value={t.gl_code} onChange={e=>{
                              const acct = CHART_OF_ACCOUNTS.find(a=>a.code===e.target.value);
                              setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,gl_code:acct.code,gl_name:acct.name,needs_review:false,checked:true}:tx));
                            }} style={{ background:"#F3F4F6", border:"1px solid #D0D5DD", borderRadius:8, padding:"6px 10px", color:"#101828", fontSize:12, outline:"none", cursor:"pointer" }}>
                              <option value="">— Select GL Account —</option>
                              {CHART_OF_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                            </select>
                            <input type="checkbox" checked={t.checked||false} onChange={e=>setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,checked:e.target.checked}:tx))}
                              style={{ width:18, height:18, cursor:"pointer", accentColor:"#039855" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Auto-categorized table */}
                  {bankTransactions.filter(t=>!t.needs_review).length > 0 && (
                    <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:14, overflow:"clip", marginBottom:20 }}>
                      <div style={{ padding:"14px 20px", borderBottom:"1px solid #E4E7EC", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontSize:12, color:"#039855" }}>✓ Auto-categorized — review & uncheck any you want to skip</div>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>setBankTransactions(prev=>prev.map(t=>t.needs_review?t:{...t,checked:true}))} style={{ background:"none", border:"1px solid #D0D5DD", color:"#475467", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Select all</button>
                          <button onClick={()=>setBankTransactions(prev=>prev.map(t=>t.needs_review?t:{...t,checked:false}))} style={{ background:"none", border:"1px solid #D0D5DD", color:"#475467", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Deselect all</button>
                        </div>
                      </div>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead>
                          <tr style={{ background:"#F3F4F6" }}>
                            {["","Vendor","Date","Description","GL Account","Amount"].map((h,i)=>(
                              <th key={i} style={{ padding:"11px 14px", textAlign:"left", fontSize:11, color:"#475467", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bankTransactions.filter(t=>!t.needs_review).map((t,i)=>(
                            <tr key={t.id} style={{ borderTop:"1px solid #E4E7EC", background:i%2===0?"transparent":"#F7F8FA", opacity:t.checked?1:0.45 }}>
                              <td style={{ padding:"11px 14px" }}>
                                <input type="checkbox" checked={t.checked||false} onChange={e=>setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,checked:e.target.checked}:tx))}
                                  style={{ width:16, height:16, cursor:"pointer", accentColor:"#039855" }} />
                              </td>
                              <td style={{ padding:"11px 14px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(t.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(t.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{t.vendor}</span>
                                  {t.rule_applied && <span style={{ fontSize:10, color:"#4F46E5", background:"#E4E7EC", borderRadius:10, padding:"1px 6px" }}>⚡rule</span>}
                                </div>
                              </td>
                              <td style={{ padding:"11px 14px", fontSize:12, color:"#475467" }}>{fmtDate(t.date)}</td>
                              <td style={{ padding:"11px 14px", fontSize:12, color:"#475467", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.description}</td>
                              <td style={{ padding:"11px 14px" }}>
                                <select value={t.gl_code} onChange={e=>{
                                  const acct=CHART_OF_ACCOUNTS.find(a=>a.code===e.target.value);
                                  if(acct) setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,gl_code:acct.code,gl_name:acct.name}:tx));
                                }} style={{ background:"#F3F4F6", border:"1px solid #D0D5DD", borderRadius:6, padding:"4px 8px", color:"#4F46E5", fontSize:11, outline:"none", cursor:"pointer" }}>
                                  {CHART_OF_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                                </select>
                              </td>
                              <td style={{ padding:"11px 14px", fontSize:13, fontFamily:"'DM Mono', monospace", color:t.type==="revenue"?"#039855":"#D92D20" }}>
                                {t.type==="revenue"?"+":"-"}${Math.abs(t.amount).toLocaleString("en-US",{minimumFractionDigits:2})}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Action bar */}
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <button onClick={bookBankTransactions} style={{
                      flex:1, padding:"14px", borderRadius:12, fontSize:14, fontWeight:600,
                      background:"linear-gradient(135deg,#D1FAE5,#039855)", border:"none", color:"#039855", cursor:"pointer"
                    }}>
                      ✓ Book {bankTransactions.filter(t=>t.checked).length} Selected Transaction{bankTransactions.filter(t=>t.checked).length!==1?"s":""} to Ledger
                    </button>
                    <button onClick={()=>{setBankTransactions([]);setBankFileName("");}} style={{ padding:"14px 20px", borderRadius:12, fontSize:13, background:"transparent", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer" }}>
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Upload new while reviewing */}
              {bankTransactions.length > 0 && !bankProcessing && (
                <div style={{ marginTop:16, textAlign:"center" }}>
                  <button onClick={()=>document.getElementById("bank-upload-2").click()} style={{ background:"none", border:"none", color:"#4F46E5", fontSize:13, cursor:"pointer" }}>
                    + Upload another statement
                  </button>
                  <input id="bank-upload-2" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display:"none" }} onChange={e=>handleBankFile(e.target.files[0], importAccount)} />
                </div>
              )}
            </div>
  );
}
