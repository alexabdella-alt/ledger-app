import React from "react";
import { useERP } from "../ERPContext";
import { payrollRequestBody, isPdfFile } from "../../lib/payroll";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor , fmtMoney } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { AI_PROXY_URL } from "../../lib/constants";
import { okAIResponse } from "../../lib/ai";
import { payrollEntryForImport, payrollAutoPostGate, payrollAutoPostNarration, payrollHistoryFromLedger, registerFromParsedPayroll, payrollImportMetadata } from "../../lib/payroll";
import { validateUpload } from "../../lib/uploadGuard";
import { checkedRowUpdate } from "../../lib/checkedWrite";
import { INTAKE_STATUS } from "../../lib/documentIntake";
import { aiJson } from "../../lib/aiJson";

export default function PayrollView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, glBreakdown, getAccountByRole, guardImport, pendingImportFile, setPendingImportFile, logIntake, markIntake, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, handlePayrollFile, postPayroll, payrollCodes, persistContact, persistContract, persistJournalEntry, persistMultiLineEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = fmtMoney;
            // ★ O116 — THESE MOVED TO `App.jsx` SO THE HOME QUEUE CAN RUN THEM TOO.
            // Not copied: a second implementation is the ·3a failure, two halves of one
            // contract drifting while both look tested. The drop zone below, the Home
            // queue and the Post button now run the same code.
            const acctName = (code) => (CHART_OF_ACCOUNTS.find(a => String(a.code) === String(code))?.name) || code;
            const payrollEntryFor = (imp) => payrollEntryForImport(imp, payrollCodes());
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>PAYROLL</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Payroll Import</h1>
                  <div style={{fontSize:13,color:"var(--sc-text-2)",marginTop:6}}>Upload a Gusto or ADP payroll export (CSV). AI reads it, generates the journal entries, and posts to your books.</div>
                </div>
                {/* Upload zone */}
                <div onDragOver={e=>{e.preventDefault();setPayrollDragOver(true);}} onDragLeave={()=>setPayrollDragOver(false)}
                  onDrop={e=>{e.preventDefault();setPayrollDragOver(false);const f=e.dataTransfer.files[0];if(f)handlePayrollFile(f);}}
                  style={{border:`2px dashed ${payrollDragOver?"var(--sc-gold)":"var(--sc-border-2)"}`,borderRadius:14,padding:32,textAlign:"center",marginBottom:24,background:payrollDragOver?"var(--sc-gold-soft)":"var(--sc-surface-2)",transition:"all 0.2s",cursor:"pointer"}}
                  onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls,.pdf";i.onchange=e=>handlePayrollFile(e.target.files[0]);i.click();}}>
                  {payrollProcessing ? <div style={{color:"var(--sc-gold)",fontSize:14}}>⏳ Parsing payroll data...</div> : (
                    <div>
                      <div style={{fontSize:28,marginBottom:8}}>💼</div>
                      <div style={{fontSize:14,fontWeight:500,marginBottom:4}}>Drop Gusto or ADP export here</div>
                      <div style={{fontSize:12,color:"var(--sc-text-2)"}}>CSV or Excel · AI auto-detects format and generates journal entries</div>
                      <div style={{marginTop:16,display:"flex",gap:10,justifyContent:"center"}}>
                        {["Gusto CSV","ADP RUN","ADP Workforce Now","Generic Payroll CSV"].map(s=>(
                          <span key={s} style={{fontSize:11,background:"var(--sc-border)",color:"var(--sc-text-2)",borderRadius:20,padding:"3px 10px"}}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Import history */}
                {payrollImports.length===0 ? (
                  <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:40,textAlign:"center"}}>
                    <div style={{fontSize:13,color:"var(--sc-text-2)"}}>No payroll imports yet. Upload a payroll export above.</div>
                  </div>
                ) : payrollImports.map(imp => (
                  <div key={imp.id} style={{background:"var(--sc-surface)",border:`1px solid ${imp.posted?"var(--sc-success-soft)":"var(--sc-border)"}`,borderRadius:14,marginBottom:12,overflow:"clip"}}>
                    <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{fontSize:15,fontWeight:600}}>{imp.source} Payroll</span>
                          {imp.posted && <span style={{fontSize:11,background:"var(--sc-success-soft)",color:"var(--sc-success)",borderRadius:20,padding:"2px 9px"}}>✓ Posted</span>}
                        </div>
                        <div style={{fontSize:12,color:"var(--sc-text-2)"}}>{imp.period} · Pay date: {imp.pay_date} · {imp.employees?.length||0} employees</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:11,color:"var(--sc-text-2)"}}>GROSS PAYROLL</div>
                        <div style={{fontSize:20,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"var(--sc-error)"}}>{fmt(imp.total_gross)}</div>
                      </div>
                      {!imp.posted && <button onClick={()=>postPayroll(imp)} style={{padding:"9px 20px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))",border:"none",color:"var(--sc-on-accent)",cursor:"pointer"}}>Post to Ledger</button>}
                    </div>
                    {/* C198·3a — why this one still needs a person. A standard register that
                        proves itself never reaches this card; when it doesn't, say which
                        check it missed rather than making the reviewer re-derive it. */}
                    {!imp.posted && imp._gate && !imp._gate.pass && (
                      <div style={{padding:"10px 20px",borderTop:"1px solid var(--sc-border)",background:"var(--sc-surface-2)"}}>
                        <div style={{fontSize:11,letterSpacing:1,color:"var(--sc-text-2)",fontWeight:600,marginBottom:6}}>NEEDS YOUR CONFIRMATION</div>
                        {imp._gate.reasons.map((r,i)=>(
                          <div key={r.code || i} style={{fontSize:12.5,color:"var(--sc-text)",marginBottom:4,lineHeight:1.45}}>· {r.text}</div>
                        ))}
                      </div>
                    )}
                    {/* Journal entries preview — renders the SAME entry postPayroll posts
                        (built by buildPayrollEntry), so what's reviewed is what's written. */}
                    <div style={{borderTop:"1px solid var(--sc-border)",overflow:"clip"}}>
                      {(() => {
                        const je = payrollEntryFor(imp);
                        const lines = je?.lines || [];
                        if (!lines.length) return <div style={{padding:"12px 16px",fontSize:13,color:"var(--sc-error)"}}>Couldn't build a balanced payroll entry — check the parsed totals.</div>;
                        return (
                          <table style={{width:"100%",borderCollapse:"collapse"}}>
                            <thead><tr style={{background:"var(--sc-surface-2)"}}>
                              {["Account","Debit","Credit"].map(h=><th key={h} style={{padding:"8px 16px",textAlign:"left",fontSize:10,color:"var(--sc-text-2)",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                            </tr></thead>
                            <tbody>
                              {lines.map((l,i)=>(
                                <tr key={i} style={{borderTop:"1px solid var(--sc-border)"}}>
                                  <td style={{padding:"10px 16px"}}>
                                    <span style={{fontSize:11,background:"var(--sc-border)",color:"var(--sc-text-2)",borderRadius:4,padding:"2px 7px",marginRight:8}}>{l.code}</span>
                                    <span style={{fontSize:13,color:l.debit>0?"var(--sc-text)":"var(--sc-text-2)",paddingLeft:l.credit>0?16:0}}>{acctName(l.code)}</span>
                                  </td>
                                  <td style={{padding:"10px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,color:"var(--sc-text)"}}>{l.debit>0?fmt(l.debit):"—"}</td>
                                  <td style={{padding:"10px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,color:"var(--sc-text-2)"}}>{l.credit>0?fmt(l.credit):"—"}</td>
                                </tr>
                              ))}
                              <tr style={{borderTop:"2px solid var(--sc-border)",background:"var(--sc-surface)"}}>
                                <td style={{padding:"8px 16px",fontSize:11,color:"var(--sc-text-2)",fontWeight:600}}>TOTAL</td>
                                <td style={{padding:"8px 16px",fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--sc-text-2)"}}>{fmt(je.totalDebit)}</td>
                                <td style={{padding:"8px 16px",fontFamily:"'DM Mono',monospace",fontSize:12,color:"var(--sc-text-2)"}}>{fmt(je.totalCredit)}</td>
                              </tr>
                            </tbody>
                          </table>
                        );
                      })()}
                    </div>
                  </div>
                ))}
              </div>
            );
}
