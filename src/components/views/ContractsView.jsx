import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ContractsView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, softDeleteContract, softDeleteContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div>
              {contractView==="list" && (
                <div>
                  <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                    <div>
                      <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>CONTRACTS & AGREEMENTS</div>
                      <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Contracts</h1>
                      <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Upload any contract — loans, leases, subscriptions, revenue agreements. AI reads it and generates the correct journal entries automatically.</div>
                    </div>
                  </div>

                  {/* Upload zone */}
                  <div onDragOver={e=>{e.preventDefault();setContractDragOver(true);}} onDragLeave={()=>setContractDragOver(false)}
                    onDrop={e=>{e.preventDefault();setContractDragOver(false);handleContractFile(e.dataTransfer.files[0]);}}
                    onClick={()=>!contractProcessing&&document.getElementById("contract-upload").click()}
                    style={{ border:`2px dashed ${contractDragOver?"var(--sc-gold)":"var(--sc-border-2)"}`, borderRadius:16, padding:contractProcessing?"36px":"44px 32px", textAlign:"center", cursor:contractProcessing?"default":"pointer", background:contractDragOver?"var(--sc-surface-2)":"var(--sc-surface)", transition:"all 0.2s", marginBottom:24 }}>
                    {contractProcessing ? (
                      <div>
                        <div style={{ fontSize:13, color:"var(--sc-gold)", marginBottom:16 }}>⟳ Reading contract and generating journal entries...</div>
                        <div style={{ height:4, background:"var(--sc-border)", borderRadius:2, overflow:"hidden", maxWidth:360, margin:"0 auto" }}>
                          <div style={{ height:"100%", background:"linear-gradient(90deg,var(--sc-gold),var(--sc-gold))", borderRadius:2, width:"70%", animation:"pulse 1.5s ease-in-out infinite" }} />
                        </div>
                        <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:12 }}>This may take 15–20 seconds for complex contracts</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
                        <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop a contract or agreement here</div>
                        <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:16 }}>PDF or image · Loans · Leases · Revenue contracts · Subscriptions · Equipment financing · Service agreements</div>
                        <div style={{ display:"flex", justifyContent:"center", gap:8, flexWrap:"wrap" }}>
                          {Object.values(CONTRACT_TYPES).map(t=><span key={t.label} style={{ background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", borderRadius:20, padding:"4px 12px", fontSize:11, color:"var(--sc-text-2)" }}>{t.icon} {t.label}</span>)}
                        </div>
                      </div>
                    )}
                    <input id="contract-upload" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:"none" }} onChange={e=>handleContractFile(e.target.files[0])} />
                  </div>

                  {/* Contract list */}
                  {contracts.length===0 ? null : (
                    <div>
                      {contracts.length > 1 && (
                        <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:12 }}>
                          <button onClick={()=>setDeleteConfirm({
                            label:`Delete ALL ${contracts.length} contracts? You'll have 30 seconds to undo, and an admin can restore them later.`,
                            onConfirm: async () => { softDeleteContracts(contracts); }
                          })} style={{ padding:"6px 14px", borderRadius:8, background:"transparent", border:"1px solid var(--sc-error-soft)", color:"var(--sc-error)", fontSize:12, cursor:"pointer" }}>
                            Delete All
                          </button>
                        </div>
                      )}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:16 }}>
                      {contracts.map(c => {
                        const ct = CONTRACT_TYPES[c.contract_type] || { label:c.contract_type, color:"var(--sc-text-2)", icon:"📄" };
                        const postedCount = c.posted_entries?.length||0;
                        const totalEntries = c.journal_entries?.length||0;
                        return (
                          <div key={c.id}
                            style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:22, transition:"border-color 0.15s", position:"relative" }}
                            onMouseEnter={e=>e.currentTarget.style.borderColor=ct.color}
                            onMouseLeave={e=>e.currentTarget.style.borderColor="#E4E7EC"}>
                            {/* Delete button on card */}
                            <button
                              onClick={e=>{ e.stopPropagation(); setDeleteConfirm({
                                label:`Permanently delete contract with ${c.counterparty}?\n\n${c.description}\n\nThis removes it from the database permanently.`,
                                onConfirm: async () => { softDeleteContract(c); }
                              }); }}
                              style={{ position:"absolute", top:12, right:12, width:24, height:24, borderRadius:6, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1 }}
                              title="Delete contract">
                              ×
                            </button>
                            <div onClick={()=>{ setSelectedContract(c); setContractView("detail"); }} style={{ cursor:"pointer" }}>
                            <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
                              <div style={{ width:42, height:42, borderRadius:10, background:ct.color+"22", border:`1px solid ${ct.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{ct.icon}</div>
                              <div style={{ flex:1, minWidth:0, paddingRight:24 }}>
                                <div style={{ fontSize:11, color:ct.color, letterSpacing:1, marginBottom:4 }}>{ct.label.toUpperCase()}</div>
                                <div style={{ fontSize:14, fontWeight:600, lineHeight:1.3 }}>{c.counterparty}</div>
                                <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.description}</div>
                              </div>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                              <div>
                                <div style={{ fontSize:10, color:"var(--sc-text-2)", marginBottom:3 }}>TOTAL VALUE</div>
                                <div style={{ fontSize:16, fontWeight:600, fontFamily:"'DM Mono',monospace" }}>${(c.total_value||0).toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                              </div>
                              <div>
                                <div style={{ fontSize:10, color:"var(--sc-text-2)", marginBottom:3 }}>TERM</div>
                                <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>{c.start_date||"—"} → {c.end_date||"—"}</div>
                              </div>
                            </div>
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                                <span style={{ fontSize:11, color:"var(--sc-text-2)" }}>Journal entries posted</span>
                                <span style={{ fontSize:11, color: postedCount===totalEntries&&totalEntries>0?"var(--sc-success)":"var(--sc-text-2)", fontFamily:"'DM Mono',monospace" }}>{postedCount}/{totalEntries}</span>
                              </div>
                              <div style={{ height:4, background:"var(--sc-border)", borderRadius:2 }}>
                                <div style={{ height:"100%", width:totalEntries>0?`${(postedCount/totalEntries)*100}%`:"0%", background:postedCount===totalEntries&&totalEntries>0?"var(--sc-success)":ct.color, borderRadius:2, transition:"width 0.4s" }} />
                              </div>
                            </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                  )}
                </div>
              )}

              {/* CONTRACT DETAIL */}
              {contractView==="detail" && selectedContract && (() => {
                const ct = CONTRACT_TYPES[selectedContract.contract_type] || { label:selectedContract.contract_type, color:"var(--sc-text-2)", icon:"📄" };
                const fmt = n => "$"+(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
                return (
                  <div>
                    <button onClick={()=>setContractView("list")} style={{ background:"none", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:14, marginBottom:24, padding:0 }}>← Back to contracts</button>

                    {/* Header */}
                    <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:20 }}>
                      <div style={{ width:52, height:52, borderRadius:14, background:ct.color+"22", border:`1px solid ${ct.color}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{ct.icon}</div>
                      <div>
                        <div style={{ fontSize:11, color:ct.color, letterSpacing:2, marginBottom:4 }}>{ct.label.toUpperCase()}</div>
                        <h1 style={{ fontSize:24, fontWeight:600, margin:0 }}>{selectedContract.counterparty}</h1>
                        <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:2 }}>{selectedContract.description}</div>
                      </div>
                      <div style={{ marginLeft:"auto", display:"flex", gap:10 }}>
                        <button onClick={()=>{
                          setDeleteConfirm({ label:`Delete contract with ${selectedContract.counterparty}? You'll have 30 seconds to undo, and an admin can restore it later.`, onConfirm:async ()=>{
                            setContractView("list");
                            softDeleteContract(selectedContract);
                          }});
                        }} style={{ padding:"10px 16px", borderRadius:10, fontSize:12, background:"transparent", border:"1px solid var(--sc-error-soft)", color:"var(--sc-error)", cursor:"pointer" }}>
                          Delete
                        </button>
                        <button onClick={()=>postAllContractEntries(selectedContract)}
                          disabled={(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)}
                          style={{ padding:"10px 20px", borderRadius:10, fontSize:13, fontWeight:600, background:(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"var(--sc-border)":"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))", border:"none", color:(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"var(--sc-text-2)":"var(--sc-success)", cursor:(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"not-allowed":"pointer" }}>
                          {(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"✓ All Posted":`Post All ${selectedContract.journal_entries?.length||0} Entries`}
                        </button>
                      </div>
                    </div>

                    {/* ASC 842 Rate disclosure banner */}
                    {selectedContract.contract_type==="lease" && (
                      <div style={{ background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:10, padding:"12px 18px", marginBottom:20, display:"flex", gap:16, alignItems:"flex-start" }}>
                        <div style={{ fontSize:18, flexShrink:0 }}>📊</div>
                        <div>
                          <div style={{ fontSize:12, fontWeight:600, color:"var(--sc-success)", marginBottom:4 }}>ASC 842 Measurement Disclosure</div>
                          <div style={{ fontSize:12, color:"var(--sc-text-2)", lineHeight:1.7 }}>
                            <strong style={{color:"var(--sc-text)"}}>Lease type:</strong> {selectedContract.lease_type==="operating"?"Operating lease (ASC 842-20)":"Finance lease (ASC 842-20)"} &nbsp;·&nbsp;
                            <strong style={{color:"var(--sc-text)"}}>Discount rate:</strong> {selectedContract.discount_rate_used ? `${(selectedContract.discount_rate_used*100).toFixed(2)}%` : "5.00%"} &nbsp;·&nbsp;
                            <strong style={{color:"var(--sc-text)"}}>Rate basis:</strong> {selectedContract.lease_type==="operating" ? "Risk-free rate practical expedient (ASC 842-20-30-3) or IBR" : "Incremental borrowing rate"} &nbsp;·&nbsp;
                            <strong style={{color:"var(--sc-text)"}}>ROU Asset:</strong> {fmt(selectedContract.rou_asset_value)} &nbsp;·&nbsp;
                            <strong style={{color:"var(--sc-text)"}}>Lease liability:</strong> {fmt((selectedContract.lease_liability_current||0)+(selectedContract.lease_liability_noncurrent||0))} (Current: {fmt(selectedContract.lease_liability_current||0)} / LT: {fmt(selectedContract.lease_liability_noncurrent||0)})
                          </div>
                          <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:6 }}>
                            Note: Non-public entities may elect the risk-free rate practical expedient per ASC 842-20-30-3. Current US Treasury rates: verify at treasury.gov/resource-center/data-chart-center/interest-rates. Update the discount rate in Settings if needed.
                          </div>
                        </div>
                      </div>
                    )}

                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
                      {/* Key terms */}
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:22 }}>
                        <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginBottom:16 }}>CONTRACT TERMS</div>
                        {[
                          ["Total Value", fmt(selectedContract.total_value)],
                          ["Payment", `${fmt(selectedContract.payment_amount)} / ${selectedContract.payment_frequency||"—"}`],
                          ["Start Date", selectedContract.start_date||"—"],
                          ["End Date", selectedContract.end_date||"—"],
                          ...(selectedContract.contract_type==="lease" ? [
                            ["Lease Term", selectedContract.lease_term_months ? `${selectedContract.lease_term_months} months` : "—"],
                            ["Lease Type", selectedContract.lease_type==="operating" ? "Operating (ASC 842)" : selectedContract.lease_type==="finance" ? "Finance (ASC 842)" : "—"],
                            ["Discount Rate", selectedContract.discount_rate_used ? `${(selectedContract.discount_rate_used*100).toFixed(2)}% (IBR/Risk-free)` : "5.00%"],
                            ["ROU Asset", fmt(selectedContract.rou_asset_value||0)],
                            ["Liability - Current", fmt(selectedContract.lease_liability_current||0)],
                            ["Liability - LT", fmt(selectedContract.lease_liability_noncurrent||0)],
                            ["Straight-line Exp/mo", fmt(selectedContract.monthly_straight_line_expense||selectedContract.payment_amount||0)],
                          ] : [
                            ["Interest Rate", selectedContract.interest_rate ? `${(selectedContract.interest_rate*100).toFixed(2)}%` : "N/A"],
                          ]),
                          ["File", selectedContract.file_name],
                        ].map(([l,v])=>(
                          <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0", borderBottom:"1px solid var(--sc-border)" }}>
                            <span style={{ fontSize:12, color:"var(--sc-text-2)" }}>{l}</span>
                            <span style={{ fontSize:13, color:"var(--sc-text)", fontWeight:500, textAlign:"right", maxWidth:"55%" }}>{v}</span>
                          </div>
                        ))}
                        {selectedContract.key_terms?.length>0 && (
                          <div style={{ marginTop:14 }}>
                            <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:8 }}>KEY TERMS</div>
                            {selectedContract.key_terms.map((t,i)=>(
                              <div key={i} style={{ fontSize:12, color:"var(--sc-text-2)", padding:"4px 0", borderBottom:"1px solid #E4E7EC11" }}>· {t}</div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Accounting treatment */}
                      <div style={{ background:"var(--sc-bg)", border:`1px solid ${ct.color}44`, borderRadius:14, padding:22 }}>
                        <div style={{ fontSize:11, color:ct.color, letterSpacing:2, marginBottom:12 }}>✦ AI ACCOUNTING TREATMENT</div>
                        <div style={{ fontSize:13, color:"var(--sc-text-2)", lineHeight:1.8 }}>{selectedContract.accounting_treatment}</div>
                      </div>
                    </div>

                    {/* Journal entry schedule */}
                    <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"hidden" }}>
                      <div style={{ padding:"16px 22px", borderBottom:"1px solid var(--sc-border)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:600 }}>Full Journal Entry Schedule</div>
                          <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2 }}>
                            {selectedContract.journal_entries?.length||0} entries · {selectedContract.posted_entries?.length||0} posted · {(selectedContract.journal_entries?.length||0)-(selectedContract.posted_entries?.length||0)} pending
                            {selectedContract.contract_type==="lease" && " · Future-dated entries are scheduled — post all at once or individually"}
                          </div>
                        </div>
                        {(selectedContract.posted_entries?.length||0) < (selectedContract.journal_entries?.length||0) && (
                          <button onClick={()=>postAllContractEntries(selectedContract)} style={{ padding:"8px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))", border:"none", color:"var(--sc-success)", cursor:"pointer" }}>
                            Post All Remaining
                          </button>
                        )}
                      </div>
                      {(selectedContract.journal_entries||[]).map((entry, idx) => {
                        const isPosted = selectedContract.posted_entries?.includes(idx);
                        const isFuture = entry.date > new Date().toISOString().slice(0,10);
                        return (
                          <div key={idx} style={{ borderBottom:"1px solid var(--sc-border)", background:isPosted?"var(--sc-success-soft)":isFuture?"var(--sc-bg)":idx%2===0?"transparent":"var(--sc-bg)" }}>
                            <div style={{ padding:"14px 22px", display:"flex", alignItems:"center", gap:14 }}>
                              <div style={{ flexShrink:0 }}>
                                {isPosted
                                  ? <div style={{ width:28, height:28, borderRadius:8, background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>✓</div>
                                  : <div style={{ width:28, height:28, borderRadius:8, background:isFuture?"var(--sc-surface-2)":"var(--sc-border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:isFuture?"var(--sc-text-2)":"var(--sc-text-2)", fontFamily:"'DM Mono',monospace" }}>{idx+1}</div>
                                }
                              </div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:2 }}>
                                  <span style={{ fontSize:13, fontWeight:600 }}>{entry.description}</span>
                                  <span style={{ fontSize:11, color:"var(--sc-text-2)" }}>{fmtDate(entry.date)}</span>
                                  {isFuture && <span style={{ fontSize:10, color:"var(--sc-text-2)", background:"var(--sc-border)", borderRadius:10, padding:"1px 7px" }}>Scheduled</span>}
                                  {idx===0 && selectedContract.contract_type==="lease" && <span style={{ fontSize:10, color:"var(--sc-warning)", background:"var(--sc-warning-soft)", borderRadius:10, padding:"1px 7px" }}>Day 1 — Commencement</span>}
                                </div>
                                <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{entry.memo}</div>
                                {/* Entry lines */}
                                <div style={{ marginTop:10, background:"var(--sc-surface-2)", borderRadius:8, padding:"10px 14px" }}>
                                  <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 120px 120px", gap:8, marginBottom:6 }}>
                                    <span style={{ fontSize:10, color:"var(--sc-text-mut)" }}>CODE</span>
                                    <span style={{ fontSize:10, color:"var(--sc-text-mut)" }}>ACCOUNT</span>
                                    <span style={{ fontSize:10, color:"var(--sc-text-mut)", textAlign:"right" }}>DEBIT</span>
                                    <span style={{ fontSize:10, color:"var(--sc-text-mut)", textAlign:"right" }}>CREDIT</span>
                                  </div>
                                  {entry.lines?.map((line,li)=>(
                                    <div key={li} style={{ display:"grid", gridTemplateColumns:"80px 1fr 120px 120px", gap:8, marginBottom:li<entry.lines.length-1?6:0, alignItems:"center" }}>
                                      <span style={{ fontSize:11, color:"var(--sc-gold)", fontFamily:"'DM Mono',monospace" }}>{line.account_code}</span>
                                      <span style={{ fontSize:12, color:"var(--sc-text-2)" }}>{line.account_name}</span>
                                      <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:"var(--sc-success)", textAlign:"right" }}>{line.debit>0?fmt(line.debit):""}</span>
                                      <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:"var(--sc-text-2)", textAlign:"right" }}>{line.credit>0?fmt(line.credit):""}</span>
                                    </div>
                                  ))}
                                  <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 120px 120px", gap:8, marginTop:8, paddingTop:8, borderTop:"1px solid var(--sc-border)" }}>
                                    <span /><span style={{ fontSize:11, color:"var(--sc-text-2)" }}>TOTALS</span>
                                    <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:"var(--sc-success)", textAlign:"right" }}>{fmt(entry.lines?.reduce((s,l)=>s+(l.debit||0),0))}</span>
                                    <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:"var(--sc-text-2)", textAlign:"right" }}>{fmt(entry.lines?.reduce((s,l)=>s+(l.credit||0),0))}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ flexShrink:0 }}>
                                {isPosted
                                  ? <span style={{ fontSize:11, color:"var(--sc-success)" }}>Posted</span>
                                  : <button onClick={e=>{e.stopPropagation();postContractEntry(selectedContract,idx);}} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", color:"var(--sc-gold)", cursor:"pointer" }}>Post</button>
                                }
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
  );
}
