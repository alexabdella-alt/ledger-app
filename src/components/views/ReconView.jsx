import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ReconView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const balSheetAccounts = [
              {code:"1000",name:"Cash & Cash Equivalents",type:"asset"},
              {code:"1100",name:"Accounts Receivable",type:"asset"},
              {code:"1200",name:"Inventory",type:"asset"},
              {code:"2000",name:"Accounts Payable",type:"liability"},
              {code:"2200",name:"Short-Term Debt",type:"liability"},
              {code:"2500",name:"Long-Term Debt",type:"liability"},
            ];
            if (activeRecon) {
              const session = reconSessions.find(s=>s.id===activeRecon);
              if (!session) { setActiveRecon(null); return null; }
              const acctInvoices = invoices.filter(i => i.gl_code===session.account_code || i.secondary_gl_code===session.account_code);
              const cleared = new Set(session.cleared_ids||[]);
              const clearedAmt = acctInvoices.filter(i=>cleared.has(i.id)).reduce((s,i)=>s+(i.debit_credit==="debit"?i.amount:-i.amount),0);
              const statBal = parseFloat(reconStatementBalance)||0;
              const bookBal = acctInvoices.reduce((s,i)=>s+(i.debit_credit==="debit"?i.amount:-i.amount),0);
              const diff = statBal - clearedAmt;
              const isBalanced = Math.abs(diff) < 0.01;
              const toggleCleared = (id) => {
                setReconSessions(prev=>prev.map(s=>s.id===session.id?{...s,cleared_ids:cleared.has(id)?[...cleared].filter(x=>x!==id):[...cleared,id]}:s));
              };
              const finishRecon = () => {
                setReconSessions(prev=>prev.map(s=>s.id===session.id?{...s,status:"complete",completed_at:new Date().toISOString(),final_balance:statBal}:s));
                logAudit("recon_complete",`Reconciliation complete: ${session.account_name} – Statement bal ${fmt(statBal)}`);
                setActiveRecon(null);
                showNotification(`${session.account_name} reconciled ✓`);
              };
              return (
                <div>
                  <div style={{marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
                    <button onClick={()=>setActiveRecon(null)} style={{background:"transparent",border:"1px solid #262629",borderRadius:8,padding:"6px 12px",color:"#9A9AA2",cursor:"pointer",fontSize:12}}>← Back</button>
                    <div>
                      <div style={{fontSize:10,letterSpacing:3,color:"#86868F"}}>RECONCILIATION</div>
                      <h1 style={{fontSize:24,fontWeight:600,margin:0}}>{session.account_name}</h1>
                    </div>
                  </div>
                  {/* Balance summary bar */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                    {[
                      {l:"Statement Balance",v:fmt(statBal),c:"#F2F2F4"},
                      {l:"Book Balance",v:fmt(bookBal),c:"#F2F2F4"},
                      {l:"Cleared Balance",v:fmt(clearedAmt),c:"#C7BFFF"},
                      {l:"Difference",v:fmt(diff),c:isBalanced?"#10B981":"#EF4444"},
                    ].map(s=>(
                      <div key={s.l} style={{background:"#141416",border:`1px solid ${s.l==="Difference"?(isBalanced?"#10B98133":"#EF444433"):"#1C1C20"}`,borderRadius:12,padding:"14px 16px"}}>
                        <div style={{fontSize:11,color:"#86868F",marginBottom:6}}>{s.l}</div>
                        <div style={{fontSize:20,fontWeight:700,fontFamily:"'DM Mono',monospace",color:s.c}}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Statement balance input */}
                  <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontSize:13,color:"#9A9AA2",flexShrink:0}}>Enter statement ending balance:</div>
                    <input value={reconStatementBalance} onChange={e=>setReconStatementBalance(e.target.value)} placeholder="0.00" type="number"
                      style={{flex:1,background:"#0C0C0E",border:"1px solid #262629",borderRadius:8,padding:"8px 12px",color:"#F2F2F4",fontSize:14,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                    {isBalanced && <button onClick={finishRecon} style={{padding:"9px 22px",borderRadius:9,fontWeight:600,fontSize:13,background:"linear-gradient(135deg,#065F46,#047857)",border:"none",color:"#6EE7B7",cursor:"pointer"}}>✓ Complete Reconciliation</button>}
                  </div>
                  {/* Transaction list */}
                  <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:14,overflow:"hidden"}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid #1C1C20",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:12,color:"#86868F"}}>{acctInvoices.length} transactions · {cleared.size} cleared</div>
                      <button onClick={()=>setReconSessions(prev=>prev.map(s=>s.id===session.id?{...s,cleared_ids:acctInvoices.map(i=>i.id)}:s))} style={{fontSize:12,background:"transparent",border:"1px solid #262629",borderRadius:7,padding:"4px 12px",color:"#9A9AA2",cursor:"pointer"}}>Clear All</button>
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"#0C0C0E"}}>
                        {["✓","Date","Vendor / Description","Amount","Type"].map(h=><th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:10,color:"#86868F",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {acctInvoices.sort((a,b)=>a.date>b.date?1:-1).map((inv,i)=>{
                          const isCleared = cleared.has(inv.id);
                          const amt = inv.debit_credit==="debit"?inv.amount:-inv.amount;
                          return (
                            <tr key={inv.id} style={{borderTop:"1px solid #1C1C20",background:isCleared?"#0A1A0A":i%2===0?"transparent":"#0A0A0C",cursor:"pointer"}} onClick={()=>toggleCleared(inv.id)}>
                              <td style={{padding:"11px 14px"}}><div style={{width:18,height:18,borderRadius:5,border:`2px solid ${isCleared?"#10B981":"#262629"}`,background:isCleared?"#10B981":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff"}}>{isCleared?"✓":""}</div></td>
                              <td style={{padding:"11px 14px",fontSize:12,color:"#9A9AA2",fontFamily:"'DM Mono',monospace"}}>{inv.date}</td>
                              <td style={{padding:"11px 14px",fontSize:13}}>{inv.vendor} <span style={{fontSize:11,color:"#86868F"}}>· {inv.description}</span></td>
                              <td style={{padding:"11px 14px",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:amt>=0?"#10B981":"#EF4444"}}>{amt>=0?"+":""}{fmt(Math.abs(amt))}</td>
                              <td style={{padding:"11px 14px"}}><span style={{fontSize:11,background:"#1C1C20",color:"#9A9AA2",borderRadius:20,padding:"2px 8px"}}>{inv.gl_name}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }
            // Account selection screen
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#86868F",marginBottom:8}}>RECONCILIATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Reconciliation</h1>
                  <div style={{fontSize:13,color:"#86868F",marginTop:6}}>Match your books to your bank and account statements. Start a reconciliation for any balance sheet account.</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
                  {balSheetAccounts.map(acct => {
                    const lastRecon = reconSessions.filter(s=>s.account_code===acct.code&&s.status==="complete").sort((a,b)=>b.completed_at>a.completed_at?1:-1)[0];
                    const openRecon = reconSessions.find(s=>s.account_code===acct.code&&s.status==="open");
                    const acctTotal = invoices.filter(i=>i.gl_code===acct.code||i.secondary_gl_code===acct.code).reduce((s,i)=>s+(i.debit_credit==="debit"?i.amount:-i.amount),0);
                    return (
                      <div key={acct.code} style={{background:"#141416",border:`1px solid ${openRecon?"#C7BFFF33":"#1C1C20"}`,borderRadius:14,padding:22}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                          <div>
                            <div style={{fontSize:11,color:"#86868F",marginBottom:4}}>{acct.code} · {acct.type.toUpperCase()}</div>
                            <div style={{fontSize:16,fontWeight:600}}>{acct.name}</div>
                          </div>
                          {openRecon && <span style={{fontSize:11,background:"#C7BFFF22",color:"#C7BFFF",borderRadius:20,padding:"2px 9px"}}>In Progress</span>}
                          {lastRecon&&!openRecon && <span style={{fontSize:11,background:"#10B98122",color:"#10B981",borderRadius:20,padding:"2px 9px"}}>Last: {lastRecon.completed_at?.slice(0,10)}</span>}
                        </div>
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:11,color:"#86868F",marginBottom:4}}>BOOK BALANCE</div>
                          <div style={{fontSize:22,fontWeight:700,fontFamily:"'DM Mono',monospace",color:acctTotal>=0?"#10B981":"#EF4444"}}>{acctTotal>=0?"+":""}{fmt(Math.abs(acctTotal))}</div>
                        </div>
                        <button onClick={()=>{
                          if (openRecon) { setActiveRecon(openRecon.id); }
                          else {
                            const s = {id:Date.now()+Math.random(),account_code:acct.code,account_name:acct.name,status:"open",created_at:new Date().toISOString(),cleared_ids:[]};
                            setReconSessions(prev=>[s,...prev]);
                            setActiveRecon(s.id);
                            setReconStatementBalance("");
                            logAudit("recon_started",`Started reconciliation: ${acct.name}`);
                          }
                        }} style={{width:"100%",padding:"9px",borderRadius:9,fontSize:13,fontWeight:500,background:openRecon?"linear-gradient(135deg,#3E33A0,#4A3DB8)":"#1C1C20",border:"none",color:openRecon?"#C7BFFF":"#9A9AA2",cursor:"pointer"}}>
                          {openRecon?"Resume Reconciliation →":"Start Reconciliation →"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {/* History */}
                {reconSessions.filter(s=>s.status==="complete").length>0 && (
                  <div style={{marginTop:28}}>
                    <div style={{fontSize:11,color:"#86868F",letterSpacing:2,marginBottom:12}}>RECONCILIATION HISTORY</div>
                    <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:14,overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#0C0C0E"}}>{["Account","Completed","Statement Balance","Status"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:10,color:"#86868F",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {reconSessions.filter(s=>s.status==="complete").map((s,i)=>(
                            <tr key={s.id} style={{borderTop:"1px solid #1C1C20",background:i%2===0?"transparent":"#0A0A0C"}}>
                              <td style={{padding:"12px 16px",fontSize:13,fontWeight:500}}>{s.account_name}</td>
                              <td style={{padding:"12px 16px",fontSize:12,color:"#9A9AA2",fontFamily:"'DM Mono',monospace"}}>{s.completed_at?.slice(0,10)}</td>
                              <td style={{padding:"12px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#10B981"}}>{fmt(s.final_balance)}</td>
                              <td style={{padding:"12px 16px"}}><span style={{fontSize:11,background:"#10B98122",color:"#10B981",borderRadius:20,padding:"2px 9px"}}>✓ Balanced</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
}
