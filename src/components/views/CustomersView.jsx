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
            const [selCustomer, setSelCustomer] = React.useState(null);
            const yr = new Date().getFullYear();
            const txnsForCustomer = name => invoices
              .filter(i => i.vendor?.toLowerCase()===(name||"").toLowerCase() && (glIsRevenue(i.gl_code)||i.type==="revenue") && i.status!=="voided")
              .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
            const billedYTDfor = txns => txns.filter(i=>String(i.date||"").startsWith(String(yr))).reduce((s,i)=>s+(i.amount||0),0);
            const openARfor = txns => txns.filter(i=>i.payment_status!=="collected"&&i.payment_status!=="paid").reduce((s,i)=>s+(i.amount||0),0);

            // ── CUSTOMER DETAIL DRILL ──
            if (selCustomer) {
              const c = selCustomer;
              const cTxns = txnsForCustomer(c.name);
              const billedYTD = billedYTDfor(cTxns);
              const openAR = openARfor(cTxns);
              const lastDate = cTxns[0]?.date || "—";
              const infoRows = [
                ["Email", c.email], ["Phone", c.phone], ["Website", c.website],
                ["Mailing address", c.mailing_address], ["Payment terms", c.payment_terms],
                ["Tax ID / EIN", c.tax_id || c.ein || c.ein_ssn],
              ].filter(([,val])=>val);
              return (
                <div>
                  <button onClick={()=>setSelCustomer(null)} style={{ background:"transparent", border:"none", color:"#059669", cursor:"pointer", fontSize:13, padding:0, marginBottom:16 }}>← All customers</button>
                  <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
                    <div style={{ width:52,height:52,borderRadius:14,background:vendorColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(c.name)}</div>
                    <h1 style={{ fontSize:26, fontWeight:600, margin:0, letterSpacing:-0.5 }}>{c.name}</h1>
                  </div>

                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
                    {[["Billed YTD", fmt(billedYTD), "#059669"],["Open receivables", fmt(openAR), openAR>0?"#D97706":"#059669"],["Last invoice", lastDate, "#111827"]].map(([k,val,col])=>(
                      <div key={k} style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:12, padding:"14px 16px" }}>
                        <div style={{ fontSize:11, color:"#6B7280", marginBottom:5 }}>{k}</div>
                        <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:col }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, padding:"16px 20px", marginBottom:20 }}>
                    <div style={{ fontSize:11, letterSpacing:1, color:"#059669", fontWeight:600, marginBottom:12 }}>CONTACT INFO</div>
                    {infoRows.length===0 ? <div style={{ fontSize:13, color:"#9CA3AF" }}>No contact details captured yet — they fill in automatically from uploaded invoices.</div> : (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px 24px" }}>
                        {infoRows.map(([k,val])=>(
                          <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:12, fontSize:13, borderBottom:"1px solid #F3F4F6", paddingBottom:6 }}>
                            <span style={{ color:"#6B7280" }}>{k}</span><span style={{ color:"#111827", textAlign:"right", wordBreak:"break-word" }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, overflow:"hidden" }}>
                    <div style={{ padding:"14px 18px", fontSize:13, fontWeight:600, borderBottom:"1px solid #F3F4F6" }}>All transactions ({cTxns.length})</div>
                    {cTxns.length===0 ? <div style={{ padding:32, textAlign:"center", color:"#9CA3AF", fontSize:13 }}>No transactions with this customer yet.</div> : (
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead><tr style={{ background:"#F9FAFB" }}>{["Date","Description","GL Account","Status","Amount"].map((h,i)=><th key={i} style={{ padding:"9px 16px", textAlign:i===4?"right":"left", fontSize:10, color:"#6B7280", letterSpacing:1, fontWeight:600, borderBottom:"1px solid #E5E7EB" }}>{h.toUpperCase()}</th>)}</tr></thead>
                        <tbody>
                          {cTxns.map((i,idx)=>{
                            const collected = i.payment_status==="collected"||i.payment_status==="paid";
                            return (
                              <tr key={i.id||idx} style={{ borderBottom:"1px solid #F3F4F6" }}>
                                <td style={{ padding:"9px 16px", fontSize:12, color:"#6B7280", whiteSpace:"nowrap" }}>{i.date}</td>
                                <td style={{ padding:"9px 16px", fontSize:13 }}>{i.description||"—"}</td>
                                <td style={{ padding:"9px 16px", fontSize:12, color:"#6B7280" }}>{i.gl_code} {i.gl_name}</td>
                                <td style={{ padding:"9px 16px", fontSize:11 }}><span style={{ color:collected?"#059669":"#D97706" }}>{collected?"Collected":"Open"}</span></td>
                                <td style={{ padding:"9px 16px", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", textAlign:"right" }}>{fmt(i.amount)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              );
            }

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
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B7280", marginBottom:8 }}>CUSTOMER MANAGEMENT</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Customers</h1>
                    <div style={{ fontSize:13, color:"#6B7280", marginTop:6 }}>Or just tell the AI chat — "Add Metro Cafe as a customer, they're on Net 15"</div>
                  </div>
                  <button onClick={()=>setChatOpen(true)} style={{ padding:"9px 18px", borderRadius:10, fontSize:13, background:"linear-gradient(135deg,#D1FAE5,#059669)", border:"none", color:"#059669", cursor:"pointer" }}>+ Add via Chat</button>
                </div>

                {allCustomers.length===0 ? (
                  <div style={{ background:"#FFFFFF", border:"1px solid #E5E7EB", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>◉</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No customers yet</div>
                    <div style={{ fontSize:13, color:"#6B7280", marginBottom:20 }}>Customers appear when you upload revenue invoices, or tell the AI chat to add one.</div>
                    <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#D1FAE5,#059669)", border:"none", color:"#059669", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {allCustomers.map(c => {
                      const isEditing = editingId===(c.id||c.name);
                      const custInvoices = txnsForCustomer(c.name);
                      const billedYTD = billedYTDfor(custInvoices);
                      const openAR = openARfor(custInvoices);
                      const lastDate = custInvoices[0]?.date || null;
                      const overdueAR = custInvoices.filter(i=>i.payment_status!=="collected"&&i.payment_status!=="paid"&&i.due_date&&i.due_date<new Date().toISOString().slice(0,10)).reduce((s,i)=>s+i.amount,0);
                      return (
                        <div key={c.id||c.name} style={{ background:"#FFFFFF", border:`1px solid ${overdueAR>0?"#DC262633":"#E5E7EB"}`, borderRadius:14, overflow:"hidden" }}>
                          <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                            <div onClick={()=>setSelCustomer(c)} style={{ width:44,height:44,borderRadius:12,background:vendorColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0, cursor:"pointer" }}>{initials(c.name)}</div>
                            <div onClick={()=>setSelCustomer(c)} style={{ flex:1, minWidth:0, cursor:"pointer" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ fontSize:15, fontWeight:600 }}>{c.name}</span>
                                {c.fromContact && <span style={{ fontSize:10, background:"#ECFDF5", color:"#059669", borderRadius:20, padding:"2px 7px" }}>Contact</span>}
                                {c.payment_terms && <span style={{ fontSize:10, background:"#F3F4F6", color:"#6B7280", borderRadius:20, padding:"2px 7px", border:"1px solid #D1D5DB" }}>{c.payment_terms}</span>}
                                {overdueAR>0 && <span style={{ fontSize:10, background:"#DC262622", color:"#DC2626", borderRadius:20, padding:"2px 7px" }}>Overdue</span>}
                                {(c.tags||[]).map(t=><span key={t} style={{ fontSize:10, background:"#E5E7EB", color:"#6B7280", borderRadius:20, padding:"2px 7px" }}>{t}</span>)}
                              </div>
                              <div style={{ fontSize:12, color:"#6B7280", marginTop:3 }}>
                                {custInvoices.length>0 ? `${custInvoices.length} invoice${custInvoices.length!==1?"s":""}${lastDate?` · last ${lastDate}`:""}` : "No invoices yet"}
                                {c.email && <span style={{ marginLeft:10 }}>✉ {c.email}</span>}
                                {c.phone && <span style={{ marginLeft:10 }}>📞 {c.phone}</span>}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                              {billedYTD>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B7280" }}>BILLED YTD</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#059669" }}>{fmt(billedYTD)}</div>
                              </div>}
                              {openAR>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B7280" }}>OPEN RECEIVABLES</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:overdueAR>0?"#DC2626":"#D97706" }}>{fmt(openAR)}</div>
                              </div>}
                              <button onClick={()=>isEditing?saveEdit(c):startEdit(c)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, background:isEditing?"linear-gradient(135deg,#D1FAE5,#059669)":"#E5E7EB", border:"1px solid #D1D5DB", color:isEditing?"#059669":"#6B7280", cursor:"pointer" }}>
                                {isEditing?"Save":"Edit"}
                              </button>
                              {isEditing && <button onClick={()=>setEditingId(null)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #D1D5DB", color:"#6B7280", cursor:"pointer" }}>×</button>}
                            </div>
                          </div>
                          {isEditing && (
                            <div style={{ padding:"16px 20px", borderTop:"1px solid #E5E7EB", background:"#F3F4F6", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                              {[
                                { key:"payment_terms", label:"Payment Terms", placeholder:"Net 15" },
                                { key:"email", label:"Email", placeholder:"billing@customer.com" },
                                { key:"phone", label:"Phone", placeholder:"+1 555 000 0000" },
                                { key:"min_expected", label:"Min Revenue ($)", placeholder:"1000" },
                                { key:"max_expected", label:"Max Revenue ($)", placeholder:"5000" },
                                { key:"tags", label:"Tags (comma-separated)", placeholder:"enterprise, monthly" },
                              ].map(f=>(
                                <div key={f.key}>
                                  <div style={{ fontSize:11, color:"#6B7280", marginBottom:4 }}>{f.label}</div>
                                  <input value={editDraft[f.key]||""} onChange={e=>setEditDraft(d=>({...d,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                    style={{ width:"100%", boxSizing:"border-box", background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:8, padding:"8px 10px", color:"#111827", fontSize:12, outline:"none" }} />
                                </div>
                              ))}
                              <div style={{ gridColumn:"1/-1" }}>
                                <div style={{ fontSize:11, color:"#6B7280", marginBottom:4 }}>Notes</div>
                                <input value={editDraft.notes||""} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} placeholder="Anything worth noting about this customer..."
                                  style={{ width:"100%", boxSizing:"border-box", background:"#FFFFFF", border:"1px solid #D1D5DB", borderRadius:8, padding:"8px 10px", color:"#111827", fontSize:12, outline:"none" }} />
                              </div>
                            </div>
                          )}
                          {!isEditing && c.notes && <div style={{ padding:"10px 20px", borderTop:"1px solid #E5E7EB", fontSize:12, color:"#6B7280" }}>📝 {c.notes}</div>}
                          {!isEditing && (c.min_expected||c.max_expected) && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #E5E7EB", fontSize:12, color:"#6B7280" }}>
                              Expected revenue: <span style={{ color:"#059669" }}>{fmt(c.min_expected||0)} – {fmt(c.max_expected||0)}/invoice</span>
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
