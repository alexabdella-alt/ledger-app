import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function OnboardView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const handleQBOFile = async (file) => {
              setQboProcessing(true);
              try {
                const text = await file.text();
                const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    model:"claude-sonnet-4-20250514", max_tokens:4000,
                    system:`You are a QBO migration expert. Parse this QuickBooks Online export (CSV, IIF, or tabular format) and return ONLY valid JSON:
{
  "source_accounts": [
    { "qbo_name": "Checking Account", "qbo_code": "1010", "suggested_our_code": "1000", "suggested_our_name": "Cash & Cash Equivalents", "category": "Assets" }
  ],
  "transactions": [
    { "date": "YYYY-MM-DD", "vendor": "Vendor Name", "description": "Description", "amount": 0, "type": "expense|revenue", "qbo_account": "QBO Account Name", "suggested_gl_code": "5XXX", "suggested_gl_name": "GL Name" }
  ],
  "summary": { "total_transactions": 0, "date_range_start": "YYYY-MM-DD", "date_range_end": "YYYY-MM-DD", "total_vendors": 0 }
}
Our Chart of Accounts:
${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}
Map QBO accounts to our closest matching GL code. Parse up to 200 transactions.`,
                    messages:[{role:"user", content:`Parse this QBO export:\n\n${text.slice(0,12000)}`}]
                  })
                });
                const d = await res.json();
                const parsed = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
                setQboData(parsed);
                const mapping = {};
                (parsed.source_accounts||[]).forEach(a=>{ mapping[a.qbo_name]=a.suggested_our_code; });
                setQboMapping(mapping);
                setQboStep("mapping");
              } catch(e) { console.error(e); showNotification("Could not parse QBO file. Try exporting as CSV from QBO.", "error"); }
              setQboProcessing(false);
            };
            const confirmImport = () => {
              const mapped = (qboData?.transactions||[]).map((t,i) => ({
                id:Date.now()+i, vendor:t.vendor, description:t.description, amount:Math.abs(t.amount),
                date:t.date, type:t.type,
                gl_code: qboMapping[t.qbo_account]||t.suggested_gl_code||getAccountByRole("miscellaneous_expense")?.code,
                gl_name: CHART_OF_ACCOUNTS.find(a=>a.code===(qboMapping[t.qbo_account]||t.suggested_gl_code))?.name||t.suggested_gl_name||getAccountByRole("miscellaneous_expense")?.name,
                project:"General", secondary_gl_code:t.type==="expense"?getAccountByRole("accounts_payable")?.code:getAccountByRole("cash")?.code,
                secondary_gl_name:t.type==="expense"?getAccountByRole("accounts_payable")?.name:getAccountByRole("cash")?.name,
                debit_credit:t.type==="expense"?"debit":"credit", confidence:90,
                reasoning:"Imported from QBO", status:"booked", booked_at:new Date().toISOString(), source:"qbo_import", payment_status:"unpaid"
              }));
              setInvoices(prev=>[...mapped,...prev]);
              logAudit("qbo_imported",`QBO import complete: ${mapped.length} transactions imported from ${qboData?.summary?.date_range_start} to ${qboData?.summary?.date_range_end}`);
              showNotification(`QBO import complete: ${mapped.length} transactions added ✓`);
              setQboStep("done");
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B7280",marginBottom:8}}>MIGRATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Import from QuickBooks Online</h1>
                  <div style={{fontSize:13,color:"#6B7280",marginTop:6}}>Export your data from QBO and upload here. AI maps their accounts to ours and imports everything.</div>
                </div>
                {/* Steps indicator */}
                <div style={{display:"flex",gap:0,marginBottom:28}}>
                  {[["upload","1. Upload"],["mapping","2. Review Mapping"],["done","3. Complete"]].map(([s,l],i,arr)=>(
                    <div key={s} style={{display:"flex",alignItems:"center"}}>
                      <div style={{padding:"6px 18px",borderRadius:20,fontSize:12,fontWeight:500,background:qboStep===s?"linear-gradient(135deg,#4F46E5,#4338CA)":["done","mapping"].includes(qboStep)&&i<["upload","mapping","done"].indexOf(qboStep)?"#05966922":"#E5E7EB",color:qboStep===s?"#fff":"#6B7280",border:"none"}}>{l}</div>
                      {i<arr.length-1 && <div style={{width:24,height:1,background:"#D1D5DB"}}/>}
                    </div>
                  ))}
                </div>
                {qboStep==="upload" && (
                  <div>
                    <div style={{background:"#FFFFFF",border:"1px solid #E5E7EB",borderRadius:14,padding:24,marginBottom:20}}>
                      <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>How to export from QuickBooks Online:</div>
                      {[["1","Go to Reports → Transaction List by Date"],["2","Set date range to All Dates"],["3","Click Export → Export to Excel or CSV"],["4","Upload that file below"]].map(([n,t])=>(
                        <div key={n} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
                          <div style={{width:22,height:22,borderRadius:"50%",background:"#4F46E5",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{n}</div>
                          <div style={{fontSize:13,color:"#374151",paddingTop:2}}>{t}</div>
                        </div>
                      ))}
                    </div>
                    <div onDragOver={e=>{e.preventDefault();setQboDragOver(true);}} onDragLeave={()=>setQboDragOver(false)}
                      onDrop={e=>{e.preventDefault();setQboDragOver(false);const f=e.dataTransfer.files[0];if(f)handleQBOFile(f);}}
                      style={{border:`2px dashed ${qboDragOver?"#4F46E5":"#D1D5DB"}`,borderRadius:14,padding:40,textAlign:"center",background:qboDragOver?"#EEF2FF":"#F3F4F6",transition:"all 0.2s",cursor:"pointer"}}
                      onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls,.iif,.txt";i.onchange=e=>handleQBOFile(e.target.files[0]);i.click();}}>
                      {qboProcessing ? <div style={{color:"#4F46E5",fontSize:14}}>⏳ Reading your QBO data... mapping accounts...</div> : (
                        <div>
                          <div style={{fontSize:36,marginBottom:10}}>⬆</div>
                          <div style={{fontSize:15,fontWeight:500,marginBottom:4}}>Drop your QBO export here</div>
                          <div style={{fontSize:12,color:"#6B7280"}}>CSV, Excel, IIF · AI reads the format automatically</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {qboStep==="mapping" && qboData && (
                  <div>
                    <div style={{background:"#FFFFFF",border:"1px solid #E5E7EB",borderRadius:14,padding:"14px 20px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:13,color:"#6B7280"}}>Found <strong style={{color:"#111827"}}>{qboData.summary?.total_transactions||0} transactions</strong> from {qboData.summary?.date_range_start} to {qboData.summary?.date_range_end} · {qboData.summary?.total_vendors||0} vendors</div>
                      <button onClick={confirmImport} style={{padding:"9px 24px",borderRadius:9,fontWeight:600,fontSize:13,background:"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#fff",cursor:"pointer"}}>Import Everything →</button>
                    </div>
                    <div style={{fontSize:12,color:"#6B7280",marginBottom:12}}>Review how QBO accounts map to our chart of accounts. Edit any mapping before importing.</div>
                    <div style={{background:"#FFFFFF",border:"1px solid #E5E7EB",borderRadius:14,overflow:"hidden",marginBottom:20}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#F3F4F6"}}>{["QBO Account","→","Our Account"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:10,color:"#6B7280",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {(qboData.source_accounts||[]).map((a,i)=>(
                            <tr key={a.qbo_name} style={{borderTop:"1px solid #E5E7EB",background:i%2===0?"transparent":"#F8F9FB"}}>
                              <td style={{padding:"11px 16px",fontSize:13,color:"#374151"}}>{a.qbo_name} <span style={{fontSize:11,color:"#6B7280"}}>({a.qbo_code})</span></td>
                              <td style={{padding:"11px 16px",color:"#6B7280"}}>→</td>
                              <td style={{padding:"11px 16px"}}>
                                <select value={qboMapping[a.qbo_name]||a.suggested_our_code||""} onChange={e=>setQboMapping(m=>({...m,[a.qbo_name]:e.target.value}))}
                                  style={{background:"#F3F4F6",border:"1px solid #D1D5DB",borderRadius:8,padding:"6px 10px",color:"#111827",fontSize:12,outline:"none",width:"100%"}}>
                                  {CHART_OF_ACCOUNTS.map(ac=><option key={ac.code} value={ac.code}>{ac.code} – {ac.name}</option>)}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {qboStep==="done" && (
                  <div style={{background:"#FFFFFF",border:"1px solid #05966933",borderRadius:14,padding:48,textAlign:"center"}}>
                    <div style={{fontSize:48,marginBottom:16}}>✓</div>
                    <div style={{fontSize:22,fontWeight:700,marginBottom:8,color:"#059669"}}>Import Complete</div>
                    <div style={{fontSize:14,color:"#6B7280",marginBottom:24}}>Your QBO data is now in your ledger, categorized and ready. Check the Audit Trail for a full import log.</div>
                    <div style={{display:"flex",gap:12,justifyContent:"center"}}>
                      <button onClick={()=>setView("invoices")} style={{padding:"10px 24px",borderRadius:10,fontSize:14,background:"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#fff",cursor:"pointer"}}>View Ledger →</button>
                      <button onClick={()=>setView("reports")} style={{padding:"10px 24px",borderRadius:10,fontSize:14,background:"#E5E7EB",border:"1px solid #D1D5DB",color:"#6B7280",cursor:"pointer"}}>View Reports →</button>
                    </div>
                  </div>
                )}
              </div>
            );
}
