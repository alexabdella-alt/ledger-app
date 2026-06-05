import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function CustomersView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const editingId = customersEditingId; const setEditingId = setCustomersEditingId;
            const editDraft = customersEditDraft; const setEditDraft = setCustomersEditDraft;

            const customerContacts = contacts.filter(c => c.type==="customer");
            // Also pull customers from ledger (revenue invoices) not yet in contacts
            const ledgerCustomers = [...new Set(invoices.filter(i=>glIsRevenue(i.gl_code)||i.type==="revenue").map(i=>i.vendor))];
            const ledgerOnlyCustomers = ledgerCustomers.filter(name =>
              !customerContacts.find(c => c.name?.toLowerCase()===name?.toLowerCase())
            );
            const allCustomers = [
              ...customerContacts.map(c => ({ ...c, fromContact:true })),
              ...ledgerOnlyCustomers.map(name => ({ id:name, name, type:"customer", fromContact:false })),
            ];

            const startEdit = (c) => { setEditingId(c.id||c.name); setEditDraft({ payment_terms:c.payment_terms||"", email:c.email||"", phone:c.phone||"", notes:c.notes||"", tags:(c.tags||[]).join(", "), min_expected:c.min_expected||"", max_expected:c.max_expected||"" }); };
            const saveEdit = (c) => {
              const updates = { ...editDraft, tags:editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null };
              if (c.fromContact) {
                setContacts(prev => prev.map(x => x.id===c.id ? {...x,...updates} : x));
              } else {
                setContacts(prev => [{ id:Date.now()+Math.random(), name:c.name, type:"customer", ...updates, created_at:new Date().toISOString() }, ...prev]);
              }
              setEditingId(null);
            };

            return (
              <div>
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>CUSTOMER MANAGEMENT</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Customers</h1>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Or just tell the AI chat — "Add Metro Cafe as a customer, they're on Net 15"</div>
                  </div>
                  <button onClick={()=>setChatOpen(true)} style={{ padding:"9px 18px", borderRadius:10, fontSize:13, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>+ Add via Chat</button>
                </div>

                {allCustomers.length===0 ? (
                  <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>◉</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No customers yet</div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:20 }}>Customers appear when you upload revenue invoices, or tell the AI chat to add one.</div>
                    <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {allCustomers.map(c => {
                      const isEditing = editingId===(c.id||c.name);
                      const custInvoices = invoices.filter(i => i.vendor?.toLowerCase()===c.name?.toLowerCase() && (glIsRevenue(i.gl_code)||i.type==="revenue"));
                      const totalRevenue = custInvoices.reduce((s,i)=>s+i.amount,0);
                      const openAR = custInvoices.filter(i=>i.payment_status!=="collected"&&i.payment_status!=="paid").reduce((s,i)=>s+i.amount,0);
                      const overdueAR = custInvoices.filter(i=>i.payment_status!=="collected"&&i.payment_status!=="paid"&&i.due_date&&i.due_date<new Date().toISOString().slice(0,10)).reduce((s,i)=>s+i.amount,0);
                      return (
                        <div key={c.id||c.name} style={{ background:"#14141A", border:`1px solid ${overdueAR>0?"#EF444433":"#1E1E2E"}`, borderRadius:14, overflow:"hidden" }}>
                          <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                            <div style={{ width:44,height:44,borderRadius:12,background:vendorColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(c.name)}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ fontSize:15, fontWeight:600 }}>{c.name}</span>
                                {c.fromContact && <span style={{ fontSize:10, background:"#0A1A0A", color:"#10B981", borderRadius:20, padding:"2px 7px" }}>Contact</span>}
                                {c.payment_terms && <span style={{ fontSize:10, background:"#0F0F13", color:"#9CA3AF", borderRadius:20, padding:"2px 7px", border:"1px solid #2A2A3E" }}>{c.payment_terms}</span>}
                                {overdueAR>0 && <span style={{ fontSize:10, background:"#EF444422", color:"#EF4444", borderRadius:20, padding:"2px 7px" }}>Overdue</span>}
                                {(c.tags||[]).map(t=><span key={t} style={{ fontSize:10, background:"#1E1E2E", color:"#6B6B8A", borderRadius:20, padding:"2px 7px" }}>{t}</span>)}
                              </div>
                              <div style={{ fontSize:12, color:"#6B6B8A", marginTop:3 }}>
                                {custInvoices.length>0 ? `${custInvoices.length} invoice${custInvoices.length!==1?"s":""}` : "No invoices yet"}
                                {c.email && <span style={{ marginLeft:10 }}>✉ {c.email}</span>}
                                {c.phone && <span style={{ marginLeft:10 }}>📞 {c.phone}</span>}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                              {totalRevenue>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>TOTAL REVENUE</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(totalRevenue)}</div>
                              </div>}
                              {openAR>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>OPEN AR</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:overdueAR>0?"#EF4444":"#F59E0B" }}>{fmt(openAR)}</div>
                              </div>}
                              <button onClick={()=>isEditing?saveEdit(c):startEdit(c)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, background:isEditing?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"1px solid #2A2A3E", color:isEditing?"#6EE7B7":"#9CA3AF", cursor:"pointer" }}>
                                {isEditing?"Save":"Edit"}
                              </button>
                              {isEditing && <button onClick={()=>setEditingId(null)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>×</button>}
                            </div>
                          </div>
                          {isEditing && (
                            <div style={{ padding:"16px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                              {[
                                { key:"payment_terms", label:"Payment Terms", placeholder:"Net 15" },
                                { key:"email", label:"Email", placeholder:"billing@customer.com" },
                                { key:"phone", label:"Phone", placeholder:"+1 555 000 0000" },
                                { key:"min_expected", label:"Min Revenue ($)", placeholder:"1000" },
                                { key:"max_expected", label:"Max Revenue ($)", placeholder:"5000" },
                                { key:"tags", label:"Tags (comma-separated)", placeholder:"enterprise, monthly" },
                              ].map(f=>(
                                <div key={f.key}>
                                  <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>{f.label}</div>
                                  <input value={editDraft[f.key]||""} onChange={e=>setEditDraft(d=>({...d,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                    style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                                </div>
                              ))}
                              <div style={{ gridColumn:"1/-1" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>Notes</div>
                                <input value={editDraft.notes||""} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} placeholder="Anything worth noting about this customer..."
                                  style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                              </div>
                            </div>
                          )}
                          {!isEditing && c.notes && <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#9CA3AF" }}>📝 {c.notes}</div>}
                          {!isEditing && (c.min_expected||c.max_expected) && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#6B6B8A" }}>
                              Expected revenue: <span style={{ color:"#10B981" }}>{fmt(c.min_expected||0)} – {fmt(c.max_expected||0)}/invoice</span>
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
