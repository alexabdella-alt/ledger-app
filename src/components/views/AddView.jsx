import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function AddView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  return (
            <div style={{ maxWidth:680 }}>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>NEW ENTRY</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Upload Invoice</h1>
              </div>
              {/* Quick nav to other upload types */}
              {!uploadedFile && (
                <div style={{ display:"flex", gap:10, marginBottom:20 }}>
                  {[
                    { label:"📄 Invoice", active:true },
                    { label:"🏦 Bank Statement", onClick:()=>setView("home") },
                    { label:"📋 Contract / Agreement", onClick:()=>{ setView("contracts"); setContractView("list"); } },
                  ].map(btn=>(
                    <button key={btn.label} onClick={btn.onClick} style={{ padding:"8px 16px", borderRadius:20, fontSize:12, background:btn.active?"var(--sc-gold)":"transparent", border:`1px solid ${btn.active?"var(--sc-gold)":"var(--sc-border-2)"}`, color:btn.active?"var(--sc-surface-2)":"var(--sc-text-2)", cursor:btn.onClick?"pointer":"default", fontWeight:btn.active?600:400 }}>{btn.label}</button>
                  ))}
                </div>
              )}
              {!uploadedFile && (
                <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
                  onDrop={e=>{e.preventDefault();setDragOver(false);handleFileSelect(e.dataTransfer.files[0]);}}
                  onClick={()=>document.getElementById("invoice-upload").click()}
                  style={{ border:`2px dashed ${dragOver?"var(--sc-gold)":"var(--sc-border-2)"}`, borderRadius:16, padding:"56px 32px", textAlign:"center", cursor:"pointer", background:dragOver?"var(--sc-surface-2)":"var(--sc-surface)", transition:"all 0.2s", marginBottom:24 }}>
                  <div style={{ fontSize:38, marginBottom:14 }}>⬆</div>
                  <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop your invoice here</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>PDF, JPG, PNG or WEBP · AI reads, extracts vendor & codes automatically</div>
                  <input id="invoice-upload" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:"none" }} onChange={e=>handleFileSelect(e.target.files[0])} />
                </div>
              )}
              {uploadedFile && (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, padding:28, marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ width:36, height:36, background:"var(--sc-border)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{uploadedFile.mediaType==="application/pdf"?"📄":"🖼"}</div>
                      <div>
                        <div style={{ fontSize:14, fontWeight:500 }}>{uploadedFile.name}</div>
                        <div style={{ fontSize:12, color:isAILoading?"var(--sc-gold)":"var(--sc-success)" }}>
                          {isAILoading?(aiStep==="extracting"?"⟳ Reading invoice & extracting vendor...":"⟳ Coding to GL accounts..."):"✓ Processed"}
                        </div>
                      </div>
                    </div>
                    <button onClick={()=>{setUploadedFile(null);setAiSuggestion(null);setForm({vendor:"",description:"",amount:"",date:"",type:"expense",notes:"",project:"General"});}}
                      style={{ background:"none", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:20 }}>×</button>
                  </div>
                  {isAILoading && (
                    <div style={{ marginBottom:20 }}>
                      <div style={{ height:3, background:"var(--sc-border)", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", background:"linear-gradient(90deg,var(--sc-gold),var(--sc-gold))", borderRadius:2, width:aiStep==="coding"?"85%":"45%", transition:"width 1.2s ease", animation:"pulse 2s ease-in-out infinite" }} />
                      </div>
                    </div>
                  )}
                  {!isAILoading && (form.vendor||form.amount) && (
                    <div>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:2, marginBottom:16 }}>EXTRACTED FIELDS — REVIEW & EDIT</div>
                      <div style={{ marginBottom:16, background:"var(--sc-bg)", border:`1px solid ${form.vendor?"var(--sc-border-2)":"var(--sc-error)"}`, borderRadius:10, padding:14 }}>
                        <label style={{ ...labelStyle, color:"var(--sc-gold)" }}>VENDOR NAME <span style={{ color:"var(--sc-error)" }}>*</span></label>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          {form.vendor && <div style={{ width:34, height:34, borderRadius:8, background:vendorColor(form.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(form.vendor)}</div>}
                          <input value={form.vendor} onChange={e=>handleFormChange("vendor",e.target.value)} placeholder="Vendor name — required" style={{ ...inputStyle, border:!form.vendor?"1px solid var(--sc-error)":"1px solid var(--sc-border-2)", background:"var(--sc-surface-2)", fontWeight:500, fontSize:14 }} />
                        </div>
                        {!form.vendor && <div style={{ fontSize:11, color:"var(--sc-error)", marginTop:6 }}>⚠ Required for tracking & rules</div>}
                        {form.vendor && rules.find(r=>r.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"var(--sc-success)", marginTop:6 }}>⚡ Vendor rule active — GL auto-applied</div>
                        )}
                        {form.vendor && allVendorNames.includes(form.vendor) && !rules.find(r=>r.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"var(--sc-success)", marginTop:6 }}>✓ Existing vendor — will group with previous invoices</div>
                        )}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                        {[{field:"amount",label:"Amount ($)",type:"number"},{field:"date",label:"Date",type:"date"}].map(({field,label,type})=>(
                          <div key={field}>
                            <label style={labelStyle}>{label.toUpperCase()}</label>
                            <input type={type} value={form[field]} onChange={e=>handleFormChange(field,e.target.value)} style={inputStyle} />
                          </div>
                        ))}
                      </div>
                      <div style={{ marginBottom:14 }}>
                        <label style={labelStyle}>DESCRIPTION</label>
                        <input value={form.description} onChange={e=>handleFormChange("description",e.target.value)} style={inputStyle} />
                      </div>
                      <div style={{ marginBottom:14 }}>
                        <label style={labelStyle}>INVOICE NUMBER <span style={{ color:"var(--sc-text-2)", fontWeight:400, fontSize:10 }}>(optional — used for duplicate detection)</span></label>
                        <input value={form.invoice_number||""} onChange={e=>handleFormChange("invoice_number",e.target.value)} placeholder="e.g. INV-2025-001" style={{
                          ...inputStyle,
                          border: form.invoice_number && invoices.find(ex=>ex.invoice_number&&ex.invoice_number.toLowerCase()===form.invoice_number.toLowerCase()&&ex.vendor?.toLowerCase()===form.vendor?.toLowerCase()) ? "1px solid var(--sc-warning)" : inputStyle.border
                        }} />
                        {form.invoice_number && invoices.find(ex=>ex.invoice_number&&ex.invoice_number.toLowerCase()===form.invoice_number.toLowerCase()&&ex.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"var(--sc-warning)", marginTop:5 }}>⚠ This invoice number already exists for {form.vendor || "this vendor"} — you'll be asked to confirm before booking</div>
                        )}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                        <div>
                          <label style={labelStyle}>TYPE</label>
                          <div style={{ display:"flex", gap:8 }}>
                            {["expense","revenue"].map(t=>(
                              <button key={t} onClick={()=>handleFormChange("type",t)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, background:form.type===t?(t==="expense"?"var(--sc-error-soft)":"var(--sc-success-soft)"):"var(--sc-surface-2)", border:`1px solid ${form.type===t?(t==="expense"?"var(--sc-error)":"var(--sc-success)"):"var(--sc-border-2)"}`, color:form.type===t?(t==="expense"?"var(--sc-error)":"var(--sc-success)"):"var(--sc-text-2)", cursor:"pointer", textTransform:"capitalize" }}>{t}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label style={labelStyle}>PROJECT</label>
                          <select value={form.project||"General"} onChange={e=>handleFormChange("project",e.target.value)} style={{ ...inputStyle, cursor:"pointer" }}>
                            {allProjects.map(p=><option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {aiSuggestion && (
                <div style={{ background:"var(--sc-bg)", border:"1px solid var(--sc-border-2)", borderRadius:14, padding:24, marginBottom:20 }}>
                  <div style={{ fontSize:11, color:"var(--sc-gold)", letterSpacing:2, marginBottom:16 }}>✦ AI GL CODING</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"var(--sc-surface)", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:6 }}>PRIMARY ACCOUNT</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"var(--sc-gold)" }}>{aiSuggestion.gl_code}</div>
                      <div style={{ fontSize:13, color:"var(--sc-text)", marginTop:2 }}>{aiSuggestion.gl_name}</div>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:4 }}>{aiSuggestion.debit_credit?.toUpperCase()}</div>
                    </div>
                    <div style={{ background:"var(--sc-surface)", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:6 }}>OFFSET ACCOUNT</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"var(--sc-text-2)" }}>{aiSuggestion.secondary_gl_code}</div>
                      <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:2 }}>{aiSuggestion.secondary_gl_name}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:12, color:"var(--sc-text-2)", marginBottom:14, lineHeight:1.7 }}>{aiSuggestion.reasoning}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ height:5, flex:1, background:"var(--sc-border)", borderRadius:3 }}>
                      <div style={{ height:"100%", width:`${aiSuggestion.confidence}%`, background:aiSuggestion.confidence>=85?"var(--sc-success)":"var(--sc-warning)", borderRadius:3 }} />
                    </div>
                    <div style={{ fontSize:12, color:aiSuggestion.confidence>=85?"var(--sc-success)":"var(--sc-warning)", fontFamily:"'DM Mono', monospace", whiteSpace:"nowrap" }}>{aiSuggestion.confidence}% confident</div>
                  </div>
                </div>
              )}
              {uploadedFile && !isAILoading && (
                <button onClick={handleBookInvoice} disabled={!aiSuggestion||!form.vendor?.trim()} style={{ width:"100%", padding:"15px", borderRadius:12, fontSize:15, fontWeight:600, background:(aiSuggestion&&form.vendor?.trim())?"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))":"var(--sc-border)", border:"none", color:(aiSuggestion&&form.vendor?.trim())?"var(--sc-success)":"var(--sc-text-2)", cursor:(aiSuggestion&&form.vendor?.trim())?"pointer":"not-allowed" }}>
                  ✓ Book Invoice to GL
                </button>
              )}
            </div>
  );
}
