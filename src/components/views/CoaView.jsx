import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function CoaView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const editingCode = coaEditingCode; const setEditingCode = setCoaEditingCode;
            const editDraft = coaEditDraft; const setEditDraft = setCoaEditDraft;
            const addDraft = coaAddDraft; const setAddDraft = setCoaAddDraft;
            const showAdd = coaShowAdd; const setShowAdd = setCoaShowAdd;
            const categories = ["Assets","Liabilities","Equity","Revenue","Expenses"];
            const grouped = categories.map(cat => ({cat, accounts: customCOA.filter(a=>a.category===cat)}));

            const saveEdit = (code) => {
              setCustomCOA(prev => prev.map(a => a.code===code ? {...a,...editDraft} : a));
              logAudit("coa_edited", `Account ${code} updated: ${editDraft.name}`);
              setEditingCode(null);
            };
            const addAccount = () => {
              if (!addDraft.code || !addDraft.name) return;
              if (customCOA.find(a=>a.code===addDraft.code)) { showNotification("Account code already exists.","error"); return; }
              setCustomCOA(prev => [...prev, {...addDraft, active:true}].sort((a,b)=>a.code.localeCompare(b.code)));
              logAudit("coa_added", `Account added: ${addDraft.code} – ${addDraft.name}`);
              setAddDraft({code:"",name:"",category:"Expenses"});
              setShowAdd(false);
              showNotification(`Account ${addDraft.code} added ✓`);
            };
            const toggleActive = (code) => {
              setCustomCOA(prev => prev.map(a => a.code===code ? {...a, active:a.active===false?true:false} : a));
              logAudit("coa_toggled", `Account ${code} toggled`);
            };

            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#6B7280",marginBottom:8}}>CONFIGURATION</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Chart of Accounts</h1>
                    <div style={{fontSize:13,color:"#6B7280",marginTop:6}}>Customize your account structure. Deactivated accounts won't appear in dropdowns but won't delete historical data.</div>
                  </div>
                  <button onClick={()=>setShowAdd(v=>!v)} style={{padding:"9px 20px",borderRadius:10,fontSize:13,fontWeight:500,background:"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#fff",cursor:"pointer"}}>+ Add Account</button>
                </div>

                {showAdd && (
                  <div style={{background:"#FFFFFF",border:"1px solid #4F46E533",borderRadius:12,padding:20,marginBottom:20}}>
                    <div style={{fontSize:12,color:"#4F46E5",fontWeight:600,marginBottom:14,letterSpacing:0.5}}>NEW ACCOUNT</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr auto",gap:12,alignItems:"flex-end"}}>
                      <div>
                        <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>CODE</div>
                        <input value={addDraft.code} onChange={e=>setAddDraft(d=>({...d,code:e.target.value}))} placeholder="e.g. 5950"
                          style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D1D5DB",borderRadius:8,padding:"8px 10px",color:"#111827",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>NAME</div>
                        <input value={addDraft.name} onChange={e=>setAddDraft(d=>({...d,name:e.target.value}))} placeholder="e.g. Research & Development"
                          style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D1D5DB",borderRadius:8,padding:"8px 10px",color:"#111827",fontSize:13,outline:"none"}}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#6B7280",marginBottom:4}}>CATEGORY</div>
                        <select value={addDraft.category} onChange={e=>setAddDraft(d=>({...d,category:e.target.value}))}
                          style={{width:"100%",background:"#F3F4F6",border:"1px solid #D1D5DB",borderRadius:8,padding:"8px 10px",color:"#111827",fontSize:13,outline:"none"}}>
                          {categories.map(c=><option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <button onClick={addAccount} style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#fff",cursor:"pointer"}}>Add</button>
                    </div>
                  </div>
                )}

                {grouped.map(({cat, accounts}) => (
                  <div key={cat} style={{marginBottom:20}}>
                    <div style={{fontSize:11,color:"#6B7280",letterSpacing:2,marginBottom:10,paddingLeft:4}}>{cat.toUpperCase()} — {accounts.length} accounts</div>
                    <div style={{background:"#FFFFFF",border:"1px solid #E5E7EB",borderRadius:12,overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <tbody>
                          {accounts.map((acct,i) => {
                            const isEditing = editingCode===acct.code;
                            const isInactive = acct.active===false;
                            return (
                              <tr key={acct.code} style={{borderTop:i>0?"1px solid #E5E7EB":"none",background:isInactive?"#F8F9FB":i%2===0?"transparent":"#F8F9FB",opacity:isInactive?0.5:1}}>
                                <td style={{padding:"11px 16px",width:80}}>
                                  {isEditing
                                    ? <input value={editDraft.code||acct.code} onChange={e=>setEditDraft(d=>({...d,code:e.target.value}))}
                                        style={{width:64,background:"#F3F4F6",border:"1px solid #4F46E5",borderRadius:6,padding:"4px 8px",color:"#111827",fontSize:12,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                                    : <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"#6B7280"}}>{acct.code}</span>}
                                </td>
                                <td style={{padding:"11px 16px",flex:1}}>
                                  {isEditing
                                    ? <input value={editDraft.name||acct.name} onChange={e=>setEditDraft(d=>({...d,name:e.target.value}))}
                                        style={{width:"100%",background:"#F3F4F6",border:"1px solid #4F46E5",borderRadius:6,padding:"4px 8px",color:"#111827",fontSize:13,outline:"none"}}/>
                                    : <span style={{fontSize:13,fontWeight:500,color:isInactive?"#6B7280":"#111827"}}>{acct.name}</span>}
                                </td>
                                <td style={{padding:"11px 16px",width:120}}>
                                  <span style={{fontSize:11,background:"#E5E7EB",color:"#6B7280",borderRadius:20,padding:"2px 9px"}}>{acct.category}</span>
                                </td>
                                <td style={{padding:"11px 16px",width:160}}>
                                  <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                                    {isEditing ? (
                                      <>
                                        <button onClick={()=>saveEdit(acct.code)} style={{padding:"4px 12px",borderRadius:7,fontSize:11,fontWeight:600,background:"linear-gradient(135deg,#D1FAE5,#059669)",border:"none",color:"#059669",cursor:"pointer"}}>Save</button>
                                        <button onClick={()=>setEditingCode(null)} style={{padding:"4px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #D1D5DB",color:"#6B7280",cursor:"pointer"}}>×</button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={()=>{setEditingCode(acct.code);setEditDraft({code:acct.code,name:acct.name});}} style={{padding:"4px 12px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #D1D5DB",color:"#6B7280",cursor:"pointer"}}>Edit</button>
                                        <button onClick={()=>toggleActive(acct.code)} style={{padding:"4px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #D1D5DB",color:isInactive?"#059669":"#DC2626",cursor:"pointer"}}>{isInactive?"Enable":"Disable"}</button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
}
