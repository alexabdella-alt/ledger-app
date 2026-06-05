import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function Tax1099View() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const year = new Date().getFullYear();
            const eligible = contacts.filter(c=>c.is1099&&c.type==="vendor");
            const vendorTotals = eligible.map(c => {
              const paid = invoices.filter(i=>i.vendor?.toLowerCase()===c.name?.toLowerCase()&&i.type==="expense"&&i.date?.startsWith(year)).reduce((s,i)=>s+i.amount,0);
              return {...c, ytd_paid:paid, needs1099:paid>=600};
            });
            const export1099 = () => {
              const rows = [["Vendor Name","EIN/SSN","Address","YTD Payments","Needs 1099"],...vendorTotals.map(v=>[v.name,v.ein||"",v.address||"",v.ytd_paid.toFixed(2),v.needs1099?"YES":"NO"])];
              const csv = rows.map(r=>r.join(",")).join("\n");
              const blob = new Blob([csv],{type:"text/csv"});
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href=url; a.download=`1099-report-${year}.csv`; a.click();
              logAudit("1099_exported",`1099 report exported for ${year}`);
            };
            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>TAX</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>1099 Tracker — {year}</h1>
                    <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Track contractor payments. Flag vendors in the Vendors page as 1099-eligible. $600 threshold triggers a 1099-NEC.</div>
                  </div>
                  {vendorTotals.length>0 && <button onClick={export1099} style={{padding:"9px 20px",borderRadius:9,fontSize:13,background:"#1E1E2E",border:"1px solid #2A2A3E",color:"#C8B8FF",cursor:"pointer"}}>Export CSV</button>}
                </div>
                {/* Summary cards */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
                  {[
                    {l:"1099-Eligible Vendors",v:eligible.length,c:"#C8B8FF"},
                    {l:"Need 1099-NEC (≥$600)",v:vendorTotals.filter(v=>v.needs1099).length,c:"#F59E0B"},
                    {l:"Total Contractor Spend",v:fmt(vendorTotals.reduce((s,v)=>s+v.ytd_paid,0)),c:"#EF4444"},
                  ].map(s=>(
                    <div key={s.l} style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,padding:"16px 20px"}}>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:6}}>{s.l}</div>
                      <div style={{fontSize:24,fontWeight:700,fontFamily:"'DM Mono',monospace",color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {/* Flag non-eligible vendors prompt */}
                {contacts.filter(c=>c.type==="vendor"&&!c.is1099).length>0 && (
                  <div style={{background:"#14141A",border:"1px solid #F59E0B33",borderRadius:12,padding:"14px 20px",marginBottom:20}}>
                    <div style={{fontSize:13,color:"#F59E0B",marginBottom:8,fontWeight:500}}>⚠ Some vendors may need 1099 flags</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {contacts.filter(c=>c.type==="vendor"&&!c.is1099).filter(c=>{
                        const paid=invoices.filter(i=>i.vendor?.toLowerCase()===c.name?.toLowerCase()&&i.type==="expense"&&i.date?.startsWith(year)).reduce((s,i)=>s+i.amount,0);
                        return paid>=600;
                      }).map(c=>(
                        <div key={c.id} style={{display:"flex",alignItems:"center",gap:6,background:"#1A1000",border:"1px solid #F59E0B22",borderRadius:8,padding:"6px 12px"}}>
                          <span style={{fontSize:12,color:"#F59E0B"}}>{c.name} — {fmt(invoices.filter(i=>i.vendor?.toLowerCase()===c.name?.toLowerCase()&&i.type==="expense"&&i.date?.startsWith(year)).reduce((s,i)=>s+i.amount,0))} paid YTD</span>
                          <button onClick={()=>{setContacts(prev=>prev.map(x=>x.id===c.id?{...x,is1099:true}:x));logAudit("1099_flagged",`${c.name} flagged as 1099-eligible`);}} style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:"#F59E0B",border:"none",color:"#000",cursor:"pointer",fontWeight:600}}>Flag 1099</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 1099 vendor table */}
                {vendorTotals.length===0 ? (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:40,textAlign:"center"}}>
                    <div style={{fontSize:13,color:"#6B6B8A",marginBottom:12}}>No 1099-eligible vendors yet. Go to the Vendors page and toggle the 1099 flag on any contractor.</div>
                    <button onClick={()=>setView("vendors")} style={{padding:"9px 20px",borderRadius:9,fontSize:13,background:"#1E1E2E",border:"1px solid #2A2A3E",color:"#9CA3AF",cursor:"pointer"}}>Go to Vendors →</button>
                  </div>
                ) : (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"#0F0F13"}}>{["Vendor","EIN/SSN","YTD Payments","Status",""].map(h=><th key={h} style={{padding:"11px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {vendorTotals.sort((a,b)=>b.ytd_paid-a.ytd_paid).map((v,i)=>(
                          <tr key={v.id} style={{borderTop:"1px solid #1E1E2E",background:i%2===0?"transparent":"#0A0A10"}}>
                            <td style={{padding:"13px 16px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:32,height:32,borderRadius:8,background:vendorColor(v.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff"}}>{initials(v.name)}</div>
                                <span style={{fontSize:13,fontWeight:500}}>{v.name}</span>
                              </div>
                            </td>
                            <td style={{padding:"13px 16px"}}>
                              <input value={v.ein||""} onChange={e=>setContacts(prev=>prev.map(c=>c.id===v.id?{...c,ein:e.target.value}:c))} placeholder="XX-XXXXXXX"
                                style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:6,padding:"5px 9px",color:"#E8E8F0",fontSize:12,width:110,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                            </td>
                            <td style={{padding:"13px 16px",fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:700,color:v.needs1099?"#F59E0B":"#9CA3AF"}}>{fmt(v.ytd_paid)}</td>
                            <td style={{padding:"13px 16px"}}>
                              {v.needs1099
                                ? <span style={{fontSize:12,background:"#F59E0B22",color:"#F59E0B",borderRadius:20,padding:"3px 10px",fontWeight:600}}>⚠ 1099-NEC Required</span>
                                : <span style={{fontSize:12,background:"#1E1E2E",color:"#6B6B8A",borderRadius:20,padding:"3px 10px"}}>{fmt(600-v.ytd_paid)} below threshold</span>}
                            </td>
                            <td style={{padding:"13px 16px"}}>
                              <button onClick={()=>{setContacts(prev=>prev.map(c=>c.id===v.id?{...c,is1099:false}:c));}} style={{fontSize:11,background:"transparent",border:"1px solid #2A2A3E",borderRadius:6,padding:"4px 10px",color:"#6B6B8A",cursor:"pointer"}}>Remove flag</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
}
