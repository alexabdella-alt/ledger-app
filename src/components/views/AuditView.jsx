import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function AuditView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const colorMap = {
              invoice_booked:"#039855", invoice_uploaded:"#039855", invoice_rejected:"#DC6803",
              invoice_deleted:"#D92D20", contract_deleted:"#D92D20",
              ai_recode:"#4F46E5", ai_retag:"#4F46E5",
              contact_added:"#6366F1", contact_updated:"#6366F1",
              payroll_posted:"#DC6803", recurring_posted:"#DC6803", recurring_created:"#DC6803",
              recon_complete:"#039855", opening_balances_posted:"#039855",
              "1099_flagged":"#DC6803", "1099_exported":"#475467",
              contract_uploaded:"#6366F1", settings_saved:"#475467",
            };

            // Unique action types for the filter dropdown
            const actionTypes = ["all", ...new Set(auditLog.map(e => e.action))].sort();

            // Apply search + action filter
            const filteredLog = auditLog.filter(e => {
              const matchesAction = auditActionFilter === "all" || e.action === auditActionFilter;
              const q = auditSearch.toLowerCase();
              const matchesSearch = !q || (e.detail||"").toLowerCase().includes(q) || (e.action||"").replace(/_/g," ").includes(q);
              return matchesAction && matchesSearch;
            });

            // CSV download — exports the FULL unfiltered log
            const downloadCSV = () => {
              const headers = ["Timestamp","Action","Detail","User"];
              const rows = auditLog.map(e => [
                (e.ts||"").replace("T"," ").slice(0,19),
                e.action||"",
                `"${(e.detail||"").replace(/"/g,'""')}"`,
                e.user||"owner"
              ]);
              const csv = [headers.join(","), ...rows.map(r=>r.join(","))].join("\n");
              const blob = new Blob([csv], {type:"text/csv"});
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href=url; a.download="audit_trail.csv"; a.click();
              URL.revokeObjectURL(url);
            };

            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end",flexWrap:"wrap",gap:16}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#475467",marginBottom:8}}>COMPLIANCE</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:"0 0 6px",letterSpacing:-0.5}}>Audit Trail</h1>
                    <div style={{fontSize:13,color:"#475467"}}>Permanent, immutable record of every action. Entries are never modified or deleted.</div>
                  </div>
                  <button onClick={downloadCSV} style={{background:"#E4E7EC",border:"1px solid #D0D5DD",color:"#4F46E5",borderRadius:10,padding:"9px 18px",fontSize:13,cursor:"pointer",fontWeight:500,display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    ↓ Download CSV ({auditLog.length} events)
                  </button>
                </div>

                {/* Stats row */}
                <div style={{display:"flex",gap:14,marginBottom:20,flexWrap:"wrap"}}>
                  {[
                    {label:"Total Events",  value: auditLog.length,                                                                            color:"#4F46E5"},
                    {label:"Bookings",      value: auditLog.filter(e=>e.action==="invoice_booked").length,                                     color:"#039855"},
                    {label:"Deletions",     value: auditLog.filter(e=>e.action==="invoice_deleted"||e.action==="contract_deleted").length,      color:"#D92D20"},
                    {label:"Recodes",       value: auditLog.filter(e=>e.action==="ai_recode").length,                                          color:"#6366F1"},
                    {label:"Rejections",    value: auditLog.filter(e=>e.action==="invoice_rejected").length,                                   color:"#DC6803"},
                  ].map(s=>(
                    <div key={s.label} style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:12,padding:"12px 18px",minWidth:120,cursor:"pointer"}}
                      onClick={()=>setAuditActionFilter(s.label==="Total Events"?"all":auditLog.find(e=>colorMap[e.action]===s.color)?.action||"all")}>
                      <div style={{fontSize:10,color:"#475467",marginBottom:4,letterSpacing:1}}>{s.label.toUpperCase()}</div>
                      <div style={{fontSize:22,fontWeight:700,color:s.color,fontFamily:"'DM Mono',monospace"}}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Search + Filter bar */}
                <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
                  <input
                    value={auditSearch} onChange={e=>setAuditSearch(e.target.value)}
                    placeholder="Search by action or detail..."
                    style={{flex:1,minWidth:200,background:"#FFFFFF",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 14px",color:"#101828",fontSize:13,outline:"none"}}
                  />
                  <select value={auditActionFilter} onChange={e=>setAuditActionFilter(e.target.value)}
                    style={{background:"#FFFFFF",border:"1px solid #D0D5DD",borderRadius:8,padding:"8px 14px",color:"#101828",fontSize:13,outline:"none",cursor:"pointer"}}>
                    {actionTypes.map(a=>(
                      <option key={a} value={a}>{a==="all"?"All actions":a.replace(/_/g," ")}</option>
                    ))}
                  </select>
                  {(auditSearch||auditActionFilter!=="all") && (
                    <button onClick={()=>{setAuditSearch("");setAuditActionFilter("all");}} style={{background:"transparent",border:"1px solid #D0D5DD",color:"#475467",borderRadius:8,padding:"8px 14px",fontSize:13,cursor:"pointer"}}>
                      Clear ×
                    </button>
                  )}
                </div>

                {auditLog.length===0 ? (
                  <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14,padding:"60px 40px",textAlign:"center"}}>
                    <div style={{fontSize:36,marginBottom:14}}>🔍</div>
                    <div style={{fontSize:16,fontWeight:600,marginBottom:8}}>No activity recorded yet</div>
                    <div style={{fontSize:13,color:"#475467",maxWidth:380,margin:"0 auto",lineHeight:1.6}}>
                      Every invoice booking, recode, deletion, contact change, and reconciliation will appear here permanently.
                    </div>
                  </div>
                ) : (
                  <div style={{background:"#FFFFFF",border:"1px solid #E4E7EC",borderRadius:14}}>
                    <div style={{padding:"12px 20px",borderBottom:"1px solid #E4E7EC",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:13,fontWeight:600}}>
                        {filteredLog.length < auditLog.length
                          ? `Showing ${filteredLog.length} of ${auditLog.length} events`
                          : `${auditLog.length} event${auditLog.length!==1?"s":""}`}
                      </div>
                      <div style={{fontSize:11,color:"#475467"}}>Newest first · scroll to see all</div>
                    </div>
                    {filteredLog.length===0 ? (
                      <div style={{padding:40,textAlign:"center",color:"#475467",fontSize:13}}>No events match your search.</div>
                    ) : (
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead>
                          <tr style={{background:"#F3F4F6"}}>
                            {["Timestamp","Action","Detail"].map(h=>(
                              <th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:10,color:"#475467",letterSpacing:1.2,fontWeight:500}}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredLog.map((entry,i)=>{
                            const c = colorMap[entry.action] || "#475467";
                            return (
                              <tr key={entry.id} style={{borderTop:"1px solid #F3F4F6",background:i%2===0?"transparent":"#F7F8FA"}}>
                                <td style={{padding:"11px 16px",fontSize:11,color:"#475467",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap",verticalAlign:"top"}}>
                                  {entry.ts ? new Date(entry.ts).toLocaleString("en-US",{month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"}) : ""}
                                </td>
                                <td style={{padding:"11px 16px",verticalAlign:"top",whiteSpace:"nowrap"}}>
                                  <span style={{fontSize:11,background:c+"22",color:c,borderRadius:20,padding:"3px 10px",fontWeight:600}}>
                                    {(entry.action||"").replace(/_/g," ")}
                                  </span>
                                </td>
                                <td style={{padding:"11px 16px",fontSize:13,color:"#374151",lineHeight:1.5}}>{entry.detail}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
}
