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
                <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>NEW ENTRY</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Upload Invoice</h1>
              </div>
              {/* Quick nav to other upload types */}
              {!uploadedFile && (
                <div style={{ display:"flex", gap:10, marginBottom:20 }}>
                  {[
                    { label:"📄 Invoice", active:true },
                    { label:"🏦 Bank Statement", onClick:()=>setView("bank") },
                    { label:"📋 Contract / Agreement", onClick:()=>{ setView("contracts"); setContractView("list"); } },
                  ].map(btn=>(
                    <button key={btn.label} onClick={btn.onClick} style={{ padding:"8px 16px", borderRadius:20, fontSize:12, background:btn.active?"#C8B8FF":"transparent", border:`1px solid ${btn.active?"#C8B8FF":"#2A2A3E"}`, color:btn.active?"#0F0F13":"#6B6B8A", cursor:btn.onClick?"pointer":"default", fontWeight:btn.active?600:400 }}>{btn.label}</button>
                  ))}
                </div>
              )}
              {!uploadedFile && (
                <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
                  onDrop={e=>{e.preventDefault();setDragOver(false);handleFileSelect(e.dataTransfer.files[0]);}}
                  onClick={()=>document.getElementById("invoice-upload").click()}
                  style={{ border:`2px dashed ${dragOver?"#C8B8FF":"#2A2A3E"}`, borderRadius:16, padding:"56px 32px", textAlign:"center", cursor:"pointer", background:dragOver?"#1A1A2E":"#14141A", transition:"all 0.2s", marginBottom:24 }}>
                  <div style={{ fontSize:38, marginBottom:14 }}>⬆</div>
                  <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop your invoice here</div>
                  <div style={{ fontSize:13, color:"#6B6B8A" }}>PDF, JPG, PNG or WEBP · AI reads, extracts vendor & codes automatically</div>
                  <input id="invoice-upload" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:"none" }} onChange={e=>handleFileSelect(e.target.files[0])} />
                </div>
              )}
              {uploadedFile && (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:16, padding:28, marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ width:36, height:36, background:"#1E1E2E", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{uploadedFile.mediaType==="application/pdf"?"📄":"🖼"}</div>
                      <div>
                        <div style={{ fontSize:14, fontWeight:500 }}>{uploadedFile.name}</div>
                        <div style={{ fontSize:12, color:isAILoading?"#C8B8FF":"#10B981" }}>
                          {isAILoading?(aiStep==="extracting"?"⟳ Reading invoice & extracting vendor...":"⟳ Coding to GL accounts..."):"✓ Processed"}
                        </div>
                      </div>
                    </div>
                    <button onClick={()=>{setUploadedFile(null);setAiSuggestion(null);setForm({vendor:"",description:"",amount:"",date:"",type:"expense",notes:"",project:"General"});}}
                      style={{ background:"none", border:"none", color:"#6B6B8A", cursor:"pointer", fontSize:20 }}>×</button>
                  </div>
                  {isAILoading && (
                    <div style={{ marginBottom:20 }}>
                      <div style={{ height:3, background:"#1E1E2E", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", background:"linear-gradient(90deg,#6D28D9,#C8B8FF)", borderRadius:2, width:aiStep==="coding"?"85%":"45%", transition:"width 1.2s ease", animation:"pulse 2s ease-in-out infinite" }} />
                      </div>
                    </div>
                  )}
                  {!isAILoading && (form.vendor||form.amount) && (
                    <div>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:16 }}>EXTRACTED FIELDS — REVIEW & EDIT</div>
                      <div style={{ marginBottom:16, background:"#0A0A14", border:`1px solid ${form.vendor?"#3B3B5E":"#EF4444"}`, borderRadius:10, padding:14 }}>
                        <label style={{ ...labelStyle, color:"#C8B8FF" }}>VENDOR NAME <span style={{ color:"#EF4444" }}>*</span></label>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          {form.vendor && <div style={{ width:34, height:34, borderRadius:8, background:vendorColor(form.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(form.vendor)}</div>}
                          <input value={form.vendor} onChange={e=>handleFormChange("vendor",e.target.value)} placeholder="Vendor name — required" style={{ ...inputStyle, border:!form.vendor?"1px solid #EF4444":"1px solid #3B3B5E", background:"#0F0F13", fontWeight:500, fontSize:14 }} />
                        </div>
                        {!form.vendor && <div style={{ fontSize:11, color:"#EF4444", marginTop:6 }}>⚠ Required for tracking & rules</div>}
                        {form.vendor && rules.find(r=>r.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"#10B981", marginTop:6 }}>⚡ Vendor rule active — GL auto-applied</div>
                        )}
                        {form.vendor && allVendorNames.includes(form.vendor) && !rules.find(r=>r.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"#10B981", marginTop:6 }}>✓ Existing vendor — will group with previous invoices</div>
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
                        <label style={labelStyle}>INVOICE NUMBER <span style={{ color:"#6B6B8A", fontWeight:400, fontSize:10 }}>(optional — used for duplicate detection)</span></label>
                        <input value={form.invoice_number||""} onChange={e=>handleFormChange("invoice_number",e.target.value)} placeholder="e.g. INV-2025-001" style={{
                          ...inputStyle,
                          border: form.invoice_number && invoices.find(ex=>ex.invoice_number&&ex.invoice_number.toLowerCase()===form.invoice_number.toLowerCase()&&ex.vendor?.toLowerCase()===form.vendor?.toLowerCase()) ? "1px solid #F59E0B" : inputStyle.border
                        }} />
                        {form.invoice_number && invoices.find(ex=>ex.invoice_number&&ex.invoice_number.toLowerCase()===form.invoice_number.toLowerCase()&&ex.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"#F59E0B", marginTop:5 }}>⚠ This invoice number already exists for {form.vendor || "this vendor"} — you'll be asked to confirm before booking</div>
                        )}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                        <div>
                          <label style={labelStyle}>TYPE</label>
                          <div style={{ display:"flex", gap:8 }}>
                            {["expense","revenue"].map(t=>(
                              <button key={t} onClick={()=>handleFormChange("type",t)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, background:form.type===t?(t==="expense"?"#3B0A0A":"#0A2A1A"):"#0F0F13", border:`1px solid ${form.type===t?(t==="expense"?"#EF4444":"#10B981"):"#2A2A3E"}`, color:form.type===t?(t==="expense"?"#FCA5A5":"#6EE7B7"):"#6B6B8A", cursor:"pointer", textTransform:"capitalize" }}>{t}</button>
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
                <div style={{ background:"#0A0A14", border:"1px solid #3B3B5E", borderRadius:14, padding:24, marginBottom:20 }}>
                  <div style={{ fontSize:11, color:"#C8B8FF", letterSpacing:2, marginBottom:16 }}>✦ AI GL CODING</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"#14141A", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:6 }}>PRIMARY ACCOUNT</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"#C8B8FF" }}>{aiSuggestion.gl_code}</div>
                      <div style={{ fontSize:13, color:"#E8E8F0", marginTop:2 }}>{aiSuggestion.gl_name}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{aiSuggestion.debit_credit?.toUpperCase()}</div>
                    </div>
                    <div style={{ background:"#14141A", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:6 }}>OFFSET ACCOUNT</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"#9CA3AF" }}>{aiSuggestion.secondary_gl_code}</div>
                      <div style={{ fontSize:13, color:"#9CA3AF", marginTop:2 }}>{aiSuggestion.secondary_gl_name}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:14, lineHeight:1.7 }}>{aiSuggestion.reasoning}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ height:5, flex:1, background:"#1E1E2E", borderRadius:3 }}>
                      <div style={{ height:"100%", width:`${aiSuggestion.confidence}%`, background:aiSuggestion.confidence>=85?"#10B981":"#F59E0B", borderRadius:3 }} />
                    </div>
                    <div style={{ fontSize:12, color:aiSuggestion.confidence>=85?"#10B981":"#F59E0B", fontFamily:"'DM Mono', monospace", whiteSpace:"nowrap" }}>{aiSuggestion.confidence}% confident</div>
                  </div>
                </div>
              )}
              {uploadedFile && !isAILoading && (
                <button onClick={handleBookInvoice} disabled={!aiSuggestion||!form.vendor?.trim()} style={{ width:"100%", padding:"15px", borderRadius:12, fontSize:15, fontWeight:600, background:(aiSuggestion&&form.vendor?.trim())?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"none", color:(aiSuggestion&&form.vendor?.trim())?"#6EE7B7":"#6B6B8A", cursor:(aiSuggestion&&form.vendor?.trim())?"pointer":"not-allowed" }}>
                  ✓ Book Invoice to GL
                </button>
              )}
            </div>
  );
}
