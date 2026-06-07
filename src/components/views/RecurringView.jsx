import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function RecurringView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const today = new Date().toISOString().slice(0,10);
            const due = recurring.filter(r=>r.active && r.next_date && r.next_date<=today);
            const runRecurring = (r) => {
              const inv = {
                id:Date.now()+Math.random(), vendor:r.vendor, description:r.description||r.name,
                amount:r.amount, date:today, type:"expense", gl_code:r.gl_code, gl_name:r.gl_name,
                project:r.project||"General", secondary_gl_code:getAccountByRole("accounts_payable")?.code, secondary_gl_name:getAccountByRole("accounts_payable")?.name,
                debit_credit:"debit", confidence:99, reasoning:`Recurring: ${r.name}`,
                status:"booked", booked_at:new Date().toISOString(), source:"recurring", payment_status:"unpaid"
              };
              setInvoices(prev => [inv, ...prev]);
              const next = new Date(r.next_date);
              if (r.frequency==="weekly") next.setDate(next.getDate()+7);
              else if (r.frequency==="monthly") next.setMonth(next.getMonth()+1);
              else if (r.frequency==="quarterly") next.setMonth(next.getMonth()+3);
              else if (r.frequency==="annual") next.setFullYear(next.getFullYear()+1);
              setRecurring(prev => prev.map(x => x.id===r.id ? {...x, last_run:today, next_date:next.toISOString().slice(0,10)} : x));
              logAudit("recurring_posted", `Recurring posted: ${r.name} ${fmt(r.amount)}`);
              showNotification(`Posted: ${r.name} ${fmt(r.amount)} ✓`);
            };
            const newRec = recurringNewRec; const setNewRec = setRecurringNewRec;
            const addRecurring = () => {
              if (!newRec.name) { showNotification("Please enter a name.","error"); return; }
              const amt = parseFloat(newRec.amount);
              if (isNaN(amt) || amt <= 0) { showNotification("Please enter a valid amount.","error"); return; }
              const r = {...newRec, id:Date.now()+Math.random(), amount:amt, active:true, created_at:new Date().toISOString(), last_run:null};
              setRecurring(prev => [r, ...prev]);
              logAudit("recurring_created", `Recurring created: ${r.name} ${fmt(r.amount)} ${r.frequency}`);
              setNewRec({name:"",vendor:"",amount:"",gl_code:getAccountByRole("rent_occupancy")?.code||"",gl_name:getAccountByRole("rent_occupancy")?.name||"",frequency:"monthly",next_date:today,project:"General"});
              showNotification(`Recurring "${r.name}" created ✓`);
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#475467",marginBottom:8}}>AUTOMATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Recurring Transactions</h1>
                  <div style={{fontSize:13,color:"#475467",marginTop:6}}>Set up transactions that repeat automatically. You can also tell the AI chat — "set up rent as $4,500/month starting June 1".</div>
                </div>
                {/* Due now alert */}
                {due.length>0 && (
                  <div style={{background:"#FEF3C7",border:"1px solid #DC680344",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:13,color:"#DC6803",fontWeight:500}}>⏰ {due.length} recurring transaction{due.length!==1?"s":""} due today</div>
                    <button onClick={()=>due.forEach(runRecurring)} style={{padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:600,background:"#DC6803",border:"none",color:"#000",cursor:"pointer"}}>Post All Due</button>
                  </div>
                )}
                {/* Add new */}
                <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,padding:20,marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#4F46E5",marginBottom:14,letterSpacing:0.5}}>+ NEW RECURRING TRANSACTION</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12}}>
                    {[{k:"name",l:"Name",p:"e.g. Office Rent"},{k:"vendor",l:"Vendor",p:"Landlord name"},{k:"amount",l:"Amount ($)",p:"4500"}].map(f=>(
                      <div key={f.k}>
                        <div style={{fontSize:11,color:"#475467",marginBottom:4}}>{f.l}</div>
                        <input value={newRec[f.k]} onChange={e=>setNewRec(d=>({...d,[f.k]:e.target.value}))} placeholder={f.p}
                          style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none"}}/>
                      </div>
                    ))}
                    <div>
                      <div style={{fontSize:11,color:"#475467",marginBottom:4}}>GL Account</div>
                      <select value={newRec.gl_code} onChange={e=>{const a=CHART_OF_ACCOUNTS.find(x=>x.code===e.target.value);setNewRec(d=>({...d,gl_code:e.target.value,gl_name:a?.name||""}));}}
                        style={{width:"100%",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none"}}>
                        {CHART_OF_ACCOUNTS.filter(a=>a.category==="Expenses").map(a=><option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#475467",marginBottom:4}}>Frequency</div>
                      <select value={newRec.frequency} onChange={e=>setNewRec(d=>({...d,frequency:e.target.value}))}
                        style={{width:"100%",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none"}}>
                        {["weekly","monthly","quarterly","annual"].map(f=><option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#475467",marginBottom:4}}>First / Next Date</div>
                      <input type="date" value={newRec.next_date} onChange={e=>setNewRec(d=>({...d,next_date:e.target.value}))}
                        style={{width:"100%",boxSizing:"border-box",background:"#F3F4F6",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 10px",color:"#101828",fontSize:12,outline:"none"}}/>
                    </div>
                  </div>
                  <button onClick={addRecurring} disabled={!newRec.name||!newRec.amount} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:(!newRec.name||!newRec.amount)?"#E4E7EC":"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#101828",cursor:(!newRec.name||!newRec.amount)?"not-allowed":"pointer"}}>Save Recurring Transaction</button>
                </div>
                {/* List */}
                {recurring.length===0 ? (
                  <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,padding:40,textAlign:"center",color:"#475467",fontSize:13}}>No recurring transactions yet.</div>
                ) : (
                  <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"#F3F4F6"}}>
                        {["Name","Vendor","Amount","GL","Frequency","Next Date",""].map(h=><th key={h} style={{padding:"11px 16px",textAlign:"left",fontSize:10,color:"#475467",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {recurring.map((r,i)=>{
                          const isDue = r.active && r.next_date && r.next_date<=today;
                          return (
                            <tr key={r.id} style={{borderTop:"1px solid #E4E7EC",background:isDue?"#FEF3C7":i%2===0?"transparent":"#F7F8FA"}}>
                              <td style={{padding:"12px 16px"}}>
                                <div style={{fontSize:13,fontWeight:500}}>{r.name}</div>
                                {!r.active && <span style={{fontSize:10,color:"#475467"}}>Paused</span>}
                                {isDue && <span style={{fontSize:10,color:"#DC6803",marginLeft:6}}>Due today</span>}
                              </td>
                              <td style={{padding:"12px 16px",fontSize:13,color:"#475467"}}>{r.vendor||"—"}</td>
                              <td style={{padding:"12px 16px",fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:600,color:"#D92D20"}}>{"$"+(r.amount||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                              <td style={{padding:"12px 16px"}}><span style={{fontSize:11,background:"#E4E7EC",color:"#4F46E5",borderRadius:20,padding:"2px 9px"}}>{r.gl_code} {r.gl_name}</span></td>
                              <td style={{padding:"12px 16px",fontSize:12,color:"#475467",textTransform:"capitalize"}}>{r.frequency}</td>
                              <td style={{padding:"12px 16px",fontSize:12,color:isDue?"#DC6803":"#475467",fontFamily:"'DM Mono',monospace"}}>{r.next_date||"—"}</td>
                              <td style={{padding:"12px 16px"}}>
                                <div style={{display:"flex",gap:6}}>
                                  {isDue && <button onClick={()=>runRecurring(r)} style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,background:"#DC6803",border:"none",color:"#000",cursor:"pointer"}}>Post</button>}
                                  <button onClick={()=>setRecurring(prev=>prev.map(x=>x.id===r.id?{...x,active:!x.active}:x))} style={{padding:"5px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #D0D5DD",color:"#475467",cursor:"pointer"}}>{r.active?"Pause":"Resume"}</button>
                                  <button onClick={()=>{setRecurring(prev=>prev.filter(x=>x.id!==r.id));logAudit("recurring_deleted",`Deleted: ${r.name}`);}} style={{padding:"5px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #D0D5DD",color:"#D92D20",cursor:"pointer"}}>×</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
}
