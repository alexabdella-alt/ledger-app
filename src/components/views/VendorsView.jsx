import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function VendorsView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const selectedContact = vendorsSelectedContact; const setSelectedContact = setVendorsSelectedContact;
            const editingId = vendorsEditingId; const setEditingId = setVendorsEditingId; const editDraft = vendorsEditDraft; const setEditDraft = setVendorsEditDraft;

            // Merge ledger-derived vendors with contact book
            const ledgerVendors = vendorSummary.filter(v => glIsExpense(
              invoices.filter(i=>i.vendor?.toLowerCase()===v.name?.toLowerCase())[0]?.gl_code||"5000"
            ) || invoices.filter(i=>i.vendor?.toLowerCase()===v.name?.toLowerCase())[0]?.type==="expense");

            // Build unified vendor list: contacts take priority, ledger fills in the rest
            const contactVendors = contacts.filter(c => c.type==="vendor");
            const ledgerOnlyVendors = vendorSummary.filter(v =>
              !contactVendors.find(c => c.name?.toLowerCase()===v.name?.toLowerCase())
            );

            const allVendors = [
              ...contactVendors.map(c => ({
                ...c,
                fromContact: true,
                ledger: vendorSummary.find(v => v.name?.toLowerCase()===c.name?.toLowerCase()),
              })),
              ...ledgerOnlyVendors.map(v => ({
                id: v.name, name: v.name, type:"vendor", fromContact: false, ledger: v,
                gl_code: rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase())?.gl_code,
                gl_name: rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase())?.gl_name,
              })),
            ];

            const startEdit = (v) => {
              setEditingId(v.id||v.name);
              setEditDraft({ payment_terms:v.payment_terms||"", email:v.email||"", phone:v.phone||"", notes:v.notes||"", tags:(v.tags||[]).join(", "), min_expected:v.min_expected||"", max_expected:v.max_expected||"" });
            };
            const saveEdit = (v) => {
              if (v.fromContact) {
                setContacts(prev => prev.map(c => c.id===v.id ? {...c, ...editDraft, tags: editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null } : c));
              } else {
                const newC = { id:Date.now()+Math.random(), name:v.name, type:"vendor", ...editDraft, tags:editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null, created_at:new Date().toISOString() };
                setContacts(prev => [newC, ...prev]);
              }
              setEditingId(null);
            };

            return (
              <div>
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>VENDOR MANAGEMENT</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Vendors</h1>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Or just tell the AI chat — "Add Johnson Electric as a vendor, Net 30, around $2k/month"</div>
                  </div>
                  <button onClick={()=>{ setChatOpen(true); }} style={{ padding:"9px 18px", borderRadius:10, fontSize:13, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:"pointer" }}>+ Add via Chat</button>
                </div>

                {allVendors.length===0 ? (
                  <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>◈</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No vendors yet</div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:20 }}>Vendors appear automatically when you upload invoices, or tell the AI chat to add one.</div>
                    <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {allVendors.map(v => {
                      const isEditing = editingId===(v.id||v.name);
                      const openAP = invoices.filter(i => i.vendor?.toLowerCase()===v.name?.toLowerCase() && glIsExpense(i.gl_code) && i.payment_status!=="paid").reduce((s,i)=>s+i.amount,0);
                      const totalSpend = v.ledger?.total || 0;
                      const rule = rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase());
                      return (
                        <div key={v.id||v.name} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                          {/* Header row */}
                          <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                            <div style={{ width:44,height:44,borderRadius:12,background:vendorColor(v.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(v.name)}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ fontSize:15, fontWeight:600 }}>{v.name}</span>
                                {v.fromContact && <span style={{ fontSize:10, background:"#1A1A2E", color:"#C8B8FF", borderRadius:20, padding:"2px 7px" }}>Contact</span>}
                                {rule && <span style={{ fontSize:10, background:"#1A1A2E", color:"#C8B8FF", borderRadius:20, padding:"2px 7px" }}>⚡ {rule.gl_name}</span>}
                                {v.fromContact && <span onClick={e=>{e.stopPropagation();setContacts(prev=>prev.map(c=>c.id===v.id?{...c,is1099:!c.is1099}:c));logAudit("1099_flagged",`${v.name} 1099 flag toggled`);}} style={{ fontSize:10, background:v.is1099?"#F59E0B22":"#1E1E2E", color:v.is1099?"#F59E0B":"#6B6B8A", borderRadius:20, padding:"2px 7px", cursor:"pointer", border:`1px solid ${v.is1099?"#F59E0B44":"#2A2A3E"}` }}>{v.is1099?"1099 ✓":"+ 1099"}</span>}
                                {v.payment_terms && <span style={{ fontSize:10, background:"#0F0F13", color:"#9CA3AF", borderRadius:20, padding:"2px 7px", border:"1px solid #2A2A3E" }}>{v.payment_terms}</span>}
                                {(v.tags||[]).map(t=><span key={t} style={{ fontSize:10, background:"#1E1E2E", color:"#6B6B8A", borderRadius:20, padding:"2px 7px" }}>{t}</span>)}
                              </div>
                              <div style={{ fontSize:12, color:"#6B6B8A", marginTop:3 }}>
                                {v.ledger ? `${v.ledger.count} invoice${v.ledger.count!==1?"s":""} · last ${v.ledger.lastDate}` : "No invoices yet"}
                                {v.email && <span style={{ marginLeft:10 }}>✉ {v.email}</span>}
                                {v.phone && <span style={{ marginLeft:10 }}>📞 {v.phone}</span>}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                              {totalSpend>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>TOTAL SPEND</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(totalSpend)}</div>
                              </div>}
                              {openAP>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>OPEN AP</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#F59E0B" }}>{fmt(openAP)}</div>
                              </div>}
                              <button onClick={()=>isEditing?saveEdit(v):startEdit(v)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, background:isEditing?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"1px solid #2A2A3E", color:isEditing?"#6EE7B7":"#9CA3AF", cursor:"pointer" }}>
                                {isEditing?"Save":"Edit"}
                              </button>
                              {isEditing && <button onClick={()=>setEditingId(null)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>×</button>}
                            </div>
                          </div>

                          {/* Edit form */}
                          {isEditing && (
                            <div style={{ padding:"16px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                              {[
                                { key:"payment_terms", label:"Payment Terms", placeholder:"Net 30" },
                                { key:"email", label:"Email", placeholder:"billing@vendor.com" },
                                { key:"phone", label:"Phone", placeholder:"+1 555 000 0000" },
                                { key:"min_expected", label:"Min Expected ($)", placeholder:"500" },
                                { key:"max_expected", label:"Max Expected ($)", placeholder:"2000" },
                                { key:"tags", label:"Tags (comma-separated)", placeholder:"IT, recurring" },
                              ].map(f=>(
                                <div key={f.key}>
                                  <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>{f.label}</div>
                                  <input value={editDraft[f.key]||""} onChange={e=>setEditDraft(d=>({...d,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                    style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                                </div>
                              ))}
                              <div style={{ gridColumn:"1/-1" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>Notes</div>
                                <input value={editDraft.notes||""} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} placeholder="Any notes about this vendor..."
                                  style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                              </div>
                            </div>
                          )}

                          {/* Notes display */}
                          {!isEditing && v.notes && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#9CA3AF" }}>📝 {v.notes}</div>
                          )}
                          {!isEditing && (v.min_expected||v.max_expected) && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#6B6B8A" }}>
                              Expected range: <span style={{ color:"#C8B8FF" }}>{fmt(v.min_expected||0)} – {fmt(v.max_expected||0)}/invoice</span>
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
