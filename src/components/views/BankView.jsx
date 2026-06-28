import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function BankView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, bankPreview, bankPreviewLoading, setBankPreview, runBankPreview, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, createBankAccountInline, pendingImportFile, setPendingImportFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  // Which account this statement belongs to — its GL is the offset for direct
  // bookings (Cr 1000 bank / Cr 2200 credit card). Defaults to the first account.
  const [importAccountId, setImportAccountId] = React.useState(null);
  const importAccount = (bankAccounts||[]).find(a => a.id === importAccountId) || (bankAccounts||[])[0] || null;
  // A bank/card statement dropped on the universal "drop anything" zone is routed
  // here pre-loaded (not booked inline) so the account-picker below can set the offset
  // (Cash 1000 vs Credit Card 2200 — O57/C63). We stash it and wait for the user to
  // confirm the account, rather than auto-processing with a guessed offset.
  const [pendingBankFile, setPendingBankFile] = React.useState(null);
  React.useEffect(() => {
    if (pendingImportFile?.type === "bank_statement" && pendingImportFile.file) {
      const f = pendingImportFile.file; setPendingImportFile(null); setPendingBankFile(f);
    }
  }, [pendingImportFile]);
  // Re-run the match PREVIEW when the chosen account changes (a card vs bank flips whether
  // matching applies, and the offset). Keeps "what you see" in sync with "what books".
  React.useEffect(() => {
    const lines = (bankTransactions || []).filter(t => !t.needs_review);
    if (lines.length && runBankPreview) runBankPreview(importAccount, lines);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importAccountId]);
  // Inline "+ Add account" (O63) — create a money source at the point of need so a
  // user with a card statement but no card source set up doesn't dead-end at Settings.
  // The offset GL follows the type (credit_card → 2200, bank → 1000, loan → 2500).
  const [showAddAccount, setShowAddAccount] = React.useState(false);
  const [addBusy, setAddBusy] = React.useState(false);
  const [newAcct, setNewAcct] = React.useState({ name:"", type:"credit_card", institution:"" });
  const fieldStyle = { background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"8px 12px", fontSize:13, color:"var(--sc-text)", outline:"none" };
  const submitNewAccount = async () => {
    if (!createBankAccountInline || addBusy) return;
    setAddBusy(true);
    const acct = await createBankAccountInline(newAcct);
    setAddBusy(false);
    if (acct) {
      setImportAccountId(acct.id);               // auto-select so the user imports immediately
      setShowAddAccount(false);
      setNewAcct({ name:"", type:"credit_card", institution:"" });
    }
  };
  const hasAccounts = (bankAccounts||[]).length > 0;
  const accountPicker = (hasAccounts || pendingBankFile || showAddAccount) && (
    <div style={{ marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:13, fontWeight:600, color:"var(--sc-text-2)" }}>Account</span>
        {hasAccounts && (
          <select value={importAccount?.id || ""} onChange={e=>setImportAccountId(e.target.value)}
            style={{ ...fieldStyle, minWidth:240 }}>
            {(bankAccounts||[]).map(a => <option key={a.id} value={a.id}>{a.name||"Account"} · {(a.type||"checking").replace("_"," ")}</option>)}
          </select>
        )}
        {!showAddAccount && (
          <button onClick={()=>setShowAddAccount(true)}
            style={{ background:"transparent", border:"1px dashed var(--sc-border-2)", borderRadius:8, padding:"8px 14px", fontSize:12, color:"var(--sc-gold)", cursor:"pointer", fontWeight:600 }}>
            + Add account…
          </button>
        )}
        {hasAccounts && !showAddAccount && (
          <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>Charges offset to this account {importAccount?.type==="credit_card" ? "(credit card → liability 2200)" : "(bank → cash 1000)"}</span>
        )}
      </div>
      {showAddAccount && (
        <div style={{ marginTop:12, padding:16, border:"1px solid var(--sc-border)", borderRadius:12, background:"var(--sc-bg)", display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <input autoFocus value={newAcct.name} onChange={e=>setNewAcct(p=>({...p,name:e.target.value}))}
            placeholder="Account name (e.g. Amex Business)" style={{ ...fieldStyle, minWidth:220 }} />
          <select value={newAcct.type} onChange={e=>setNewAcct(p=>({...p,type:e.target.value}))} style={fieldStyle}>
            {["credit_card","checking","savings","loan","other"].map(t=><option key={t} value={t}>{t.replace("_"," ")}</option>)}
          </select>
          <input value={newAcct.institution} onChange={e=>setNewAcct(p=>({...p,institution:e.target.value}))}
            placeholder="Issuer / bank (optional)" style={{ ...fieldStyle, minWidth:180 }} />
          <span style={{ fontSize:12, color:"var(--sc-text-mut)" }}>Offsets to {newAcct.type==="credit_card" ? "Credit Card Liability (2200)" : newAcct.type==="loan" ? "Long-Term Debt (2500)" : "Cash (1000)"}</span>
          <button onClick={submitNewAccount} disabled={addBusy || !newAcct.name.trim()}
            style={{ background: (addBusy||!newAcct.name.trim())?"var(--sc-gold)":"var(--sc-gold)", color:"var(--sc-on-accent)", border:"none", borderRadius:8, padding:"8px 18px", fontSize:13, fontWeight:600, cursor:(addBusy||!newAcct.name.trim())?"default":"pointer" }}>
            {addBusy ? "Creating…" : "Create & select"}
          </button>
          <button onClick={()=>{ setShowAddAccount(false); setNewAcct({ name:"", type:"credit_card", institution:"" }); }}
            style={{ background:"var(--sc-surface)", color:"var(--sc-text-2)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"8px 16px", fontSize:13, fontWeight:500, cursor:"pointer" }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
  return (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>BANK FEED</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Import Bank Transactions</h1>
                <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Upload a CSV, Excel, or PDF bank statement — AI reads every transaction, auto-categorizes, and flags anything it's unsure about.</div>
              </div>

              {/* Upload zone */}
              {!bankProcessing && bankTransactions.length === 0 && (
                <>
                {accountPicker}
                {pendingBankFile && (
                  <div style={{ border:"2px solid var(--sc-gold)", borderRadius:16, padding:"28px 32px", background:"var(--sc-gold-soft)", marginBottom:24 }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>🏦</div>
                    <div style={{ fontSize:16, fontWeight:600, marginBottom:6 }}>Ready to import: {pendingBankFile.name}</div>
                    <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:18 }}>
                      Confirm the account above — charges offset to {importAccount?.type==="credit_card" ? "your credit card (liability 2200)" : "cash (1000)"} — then import.
                    </div>
                    <div style={{ display:"flex", gap:10 }}>
                      <button onClick={()=>{ const f=pendingBankFile; setPendingBankFile(null); handleBankFile(f, importAccount); }}
                        style={{ background:"var(--sc-gold)", color:"var(--sc-on-accent)", border:"none", borderRadius:8, padding:"10px 20px", fontSize:14, fontWeight:600, cursor:"pointer" }}>
                        Import to {importAccount?.name || "account"}
                      </button>
                      <button onClick={()=>setPendingBankFile(null)}
                        style={{ background:"var(--sc-surface)", color:"var(--sc-text-2)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"10px 20px", fontSize:14, fontWeight:500, cursor:"pointer" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!pendingBankFile &&
                <div onDragOver={e=>{e.preventDefault();setBankDragOver(true);}} onDragLeave={()=>setBankDragOver(false)}
                  onDrop={e=>{e.preventDefault();setBankDragOver(false);handleBankFile(e.dataTransfer.files[0], importAccount);}}
                  onClick={()=>document.getElementById("bank-upload").click()}
                  style={{ border:`2px dashed ${bankDragOver?"var(--sc-gold)":"var(--sc-border-2)"}`, borderRadius:16, padding:"52px 32px", textAlign:"center", cursor:"pointer", background:bankDragOver?"var(--sc-gold-soft)":"var(--sc-surface)", transition:"all 0.2s", marginBottom:24 }}>
                  <div style={{ fontSize:40, marginBottom:14 }}>🏦</div>
                  <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop your bank statement here</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:16 }}>CSV · Excel (.xlsx) · PDF — from any bank</div>
                  <div style={{ display:"flex", justifyContent:"center", gap:10 }}>
                    {["CSV","XLSX","PDF"].map(f=><span key={f} style={{ background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", borderRadius:6, padding:"4px 12px", fontSize:11, color:"var(--sc-text-2)" }}>{f}</span>)}
                  </div>
                  <input id="bank-upload" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display:"none" }} onChange={e=>handleBankFile(e.target.files[0], importAccount)} />
                </div>
                }
                </>
              )}

              {/* Processing state */}
              {bankProcessing && (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, padding:36, textAlign:"center", marginBottom:24 }}>
                  <div style={{ fontSize:13, color:"var(--sc-gold)", marginBottom:20 }}>
                    {bankStep==="parsing" ? "⟳ Reading bank statement..." : "⟳ AI is categorizing all transactions..."}
                  </div>
                  <div style={{ height:6, background:"var(--sc-border)", borderRadius:3, overflow:"hidden", maxWidth:400, margin:"0 auto 12px" }}>
                    <div style={{ height:"100%", background:"linear-gradient(90deg,var(--sc-gold),var(--sc-gold))", borderRadius:3, width:`${bankProgress}%`, transition:"width 0.8s ease", animation:"pulse 2s ease-in-out infinite" }} />
                  </div>
                  <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{bankFileName}</div>
                </div>
              )}

              {/* Transaction review table */}
              {bankTransactions.length > 0 && (
                <div>
                  {/* Summary bar */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                    {[
                      { label:"Total Transactions", value:bankTransactions.length, color:"var(--sc-text)" },
                      { label:"Auto-Categorized", value:bankTransactions.filter(t=>!t.needs_review).length, color:"var(--sc-success)" },
                      { label:"Needs Review", value:bankTransactions.filter(t=>t.needs_review).length, color:"var(--sc-warning)" },
                    ].map(s=>(
                      <div key={s.label} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:6, letterSpacing:1 }}>{s.label.toUpperCase()}</div>
                        <div style={{ fontSize:24, fontWeight:600, color:s.color, fontFamily:"'DM Mono', monospace" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Needs review section */}
                  {bankTransactions.filter(t=>t.needs_review).length > 0 && (
                    <div style={{ background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ fontSize:12, color:"var(--sc-warning)", marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
                        <span>⚠</span> <span>These transactions need your input — AI wasn't confident enough to auto-categorize</span>
                      </div>
                      {bankTransactions.filter(t=>t.needs_review).map(t=>(
                        <div key={t.id} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:10, padding:"14px 16px", marginBottom:10 }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 160px 40px", gap:12, alignItems:"center" }}>
                            <div>
                              <div style={{ fontSize:13, fontWeight:500 }}>{t.description}</div>
                              <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:2 }}>{fmtDate(t.date)} · Detected vendor: <span style={{ color:"var(--sc-gold)" }}>{t.vendor||"Unknown"}</span></div>
                            </div>
                            <div style={{ fontSize:14, fontFamily:"'DM Mono', monospace", color:t.type==="revenue"?"var(--sc-success)":"var(--sc-error)", textAlign:"right" }}>
                              {t.type==="revenue"?"+":"-"}${Math.abs(t.amount).toLocaleString("en-US",{minimumFractionDigits:2})}
                            </div>
                            <select value={t.gl_code} onChange={e=>{
                              const acct = CHART_OF_ACCOUNTS.find(a=>a.code===e.target.value);
                              setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,gl_code:acct.code,gl_name:acct.name,needs_review:false,checked:true}:tx));
                            }} style={{ background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"6px 10px", color:"var(--sc-text)", fontSize:12, outline:"none", cursor:"pointer" }}>
                              <option value="">— Select GL Account —</option>
                              {CHART_OF_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                            </select>
                            <input type="checkbox" checked={t.checked||false} onChange={e=>setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,checked:e.target.checked}:tx))}
                              style={{ width:18, height:18, cursor:"pointer", accentColor:"var(--sc-success)" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Auto-categorized table */}
                  {bankTransactions.filter(t=>!t.needs_review).length > 0 && (
                    <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip", marginBottom:20 }}>
                      <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        {(() => {
                          // Preview summary — what WILL book, from the shared matching result.
                          if (bankPreviewLoading) return <div style={{ fontSize:12, color:"var(--sc-text-mut)" }}>⟳ Matching against your open invoices & bills…</div>;
                          const fates = bankPreview?.fates || {};
                          const vals = Object.values(fates);
                          const clears = vals.filter(f => f.fate === "clear_ar" || f.fate === "clear_ap").length;
                          const review = vals.filter(f => f.fate === "review").length;
                          if (bankPreview && clears > 0) return <div style={{ fontSize:12, color:"var(--sc-success)" }}>✓ {clears} will <strong>clear an open A/R / A/P</strong> · {vals.length - clears - review} book as new{review ? ` · ${review} need review` : ""} — this is exactly what books</div>;
                          return <div style={{ fontSize:12, color:"var(--sc-success)" }}>✓ Auto-categorized — review & uncheck any you want to skip</div>;
                        })()}
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>setBankTransactions(prev=>prev.map(t=>t.needs_review?t:{...t,checked:true}))} style={{ background:"none", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Select all</button>
                          <button onClick={()=>setBankTransactions(prev=>prev.map(t=>t.needs_review?t:{...t,checked:false}))} style={{ background:"none", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Deselect all</button>
                        </div>
                      </div>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead>
                          <tr style={{ background:"var(--sc-surface-2)" }}>
                            {["","Vendor","Date","Description","GL Account","Amount"].map((h,i)=>(
                              <th key={i} style={{ padding:"11px 14px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bankTransactions.filter(t=>!t.needs_review).map((t,i)=>(
                            <tr key={t.id} style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)", opacity:t.checked?1:0.45 }}>
                              <td style={{ padding:"11px 14px" }}>
                                <input type="checkbox" checked={t.checked||false} onChange={e=>setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,checked:e.target.checked}:tx))}
                                  style={{ width:16, height:16, cursor:"pointer", accentColor:"var(--sc-success)" }} />
                              </td>
                              <td style={{ padding:"11px 14px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(t.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(t.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{t.vendor}</span>
                                  {t.rule_applied && <span style={{ fontSize:10, color:"var(--sc-gold)", background:"var(--sc-border)", borderRadius:10, padding:"1px 6px" }}>⚡rule</span>}
                                </div>
                              </td>
                              <td style={{ padding:"11px 14px", fontSize:12, color:"var(--sc-text-2)" }}>{fmtDate(t.date)}</td>
                              <td style={{ padding:"11px 14px", fontSize:12, color:"var(--sc-text-2)", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.description}</td>
                              <td style={{ padding:"11px 14px" }}>
                                {(() => {
                                  // PREVIEW = EXECUTOR: a matched line shows its actual booking fate (clears
                                  // A/R / A/P, with the open item it'll clear) — NOT the raw categorization,
                                  // which would mislead the user into thinking it books as fresh revenue/expense.
                                  const fate = bankPreview?.fates?.[t.id];
                                  if (fate && (fate.fate === "clear_ar" || fate.fate === "clear_ap")) {
                                    const isAr = fate.fate === "clear_ar";
                                    return (
                                      <span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:11.5, fontWeight:600, color: isAr ? "var(--sc-success)" : "var(--sc-warning)", background: isAr ? "var(--sc-success-soft)" : "var(--sc-warning-soft)", border:`1px solid ${isAr ? "var(--sc-success-soft)" : "var(--sc-warning-soft)"}`, borderRadius:8, padding:"4px 9px" }} title={`This deposit/payment clears an open ${isAr ? "receivable" : "payable"} — it posts ${isAr ? "Dr Cash / Cr A/R" : "Dr A/P / Cr Cash"}, not a fresh ${t.type}.`}>
                                        ↔ Clears {isAr ? "A/R" : "A/P"} · {fate.clearsVendor || (isAr ? "receivable" : "payable")}
                                      </span>
                                    );
                                  }
                                  if (fate && fate.fate === "review") {
                                    return <span style={{ fontSize:11.5, fontWeight:600, color:"var(--sc-gold)" }} title="Uncertain match — you'll confirm it in Matching.">⌛ Needs review</span>;
                                  }
                                  return (
                                    <select value={t.gl_code} onChange={e=>{
                                      const acct=CHART_OF_ACCOUNTS.find(a=>a.code===e.target.value);
                                      if(acct) setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,gl_code:acct.code,gl_name:acct.name}:tx));
                                    }} style={{ background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:6, padding:"4px 8px", color:"var(--sc-gold)", fontSize:11, outline:"none", cursor:"pointer" }}>
                                      {CHART_OF_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                                    </select>
                                  );
                                })()}
                              </td>
                              <td style={{ padding:"11px 14px", fontSize:13, fontFamily:"'DM Mono', monospace", color:t.type==="revenue"?"var(--sc-success)":"var(--sc-error)" }}>
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
                    <button onClick={()=>bookBankTransactions(importAccount)} disabled={bankProcessing} style={{
                      flex:1, padding:"14px", borderRadius:12, fontSize:14, fontWeight:600,
                      background:"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))", border:"none", color:"var(--sc-success)", cursor:bankProcessing?"wait":"pointer", opacity:bankProcessing?0.6:1
                    }}>
                      {bankProcessing ? "Booking…" : `✓ Book ${bankTransactions.filter(t=>t.checked).length} Selected Transaction${bankTransactions.filter(t=>t.checked).length!==1?"s":""} to Ledger`}
                    </button>
                    <button onClick={()=>{setBankTransactions([]);setBankFileName("");setBankPreview&&setBankPreview(null);}} style={{ padding:"14px 20px", borderRadius:12, fontSize:13, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Upload new while reviewing */}
              {bankTransactions.length > 0 && !bankProcessing && (
                <div style={{ marginTop:16, textAlign:"center" }}>
                  <button onClick={()=>document.getElementById("bank-upload-2").click()} style={{ background:"none", border:"none", color:"var(--sc-gold)", fontSize:13, cursor:"pointer" }}>
                    + Upload another statement
                  </button>
                  <input id="bank-upload-2" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display:"none" }} onChange={e=>handleBankFile(e.target.files[0], importAccount)} />
                </div>
              )}
            </div>
  );
}
