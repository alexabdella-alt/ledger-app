import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function PayrollView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const handlePayrollFile = async (file) => {
              if (!file) return;
              setPayrollProcessing(true);
              logAudit("payroll_upload_started", `Uploading payroll file: ${file.name}`);
              try {
                const text = await file.text();
                const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    model:"claude-sonnet-4-20250514", max_tokens:2000,
                    system:`You are a payroll accountant. Parse this payroll export (Gusto, ADP, or generic CSV) and return ONLY valid JSON:
{
  "source": "Gusto|ADP|Other",
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "pay_date": "YYYY-MM-DD",
  "total_gross": 0,
  "total_net": 0,
  "total_employer_taxes": 0,
  "total_deductions": 0,
  "journal_entries": [
    { "account_code": "5100", "account_name": "Salaries & Wages", "debit": 0, "credit": 0, "memo": "..." }
  ],
  "employees": [
    { "name": "...", "gross": 0, "net": 0, "taxes": 0 }
  ]
}
Journal entry rules:
- Debit 5100 Salaries & Wages for gross payroll
- Debit 5101 Payroll Tax Expense for employer taxes  
- Credit 2100 Accrued Liabilities for net pay
- Credit 2101 Payroll Taxes Payable for all taxes
- Entries must balance. Use today's date if pay_date unclear.`,
                    messages:[{role:"user", content:`Parse this payroll file:\n\n${text.slice(0,8000)}`}]
                  })
                });
                const d = await res.json();
                const parsed = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
                const importRecord = { id:Date.now()+Math.random(), source:parsed.source||"Unknown", period:`${parsed.period_start} – ${parsed.period_end}`, pay_date:parsed.pay_date, total_gross:parsed.total_gross, total_net:parsed.total_net, total_employer_taxes:parsed.total_employer_taxes, journal_entries:parsed.journal_entries||[], employees:parsed.employees||[], imported_at:new Date().toISOString(), file_name:file.name, posted:false };
                setPayrollImports(prev => [importRecord, ...prev]);
                logAudit("payroll_parsed", `${parsed.source} payroll parsed: ${fmt(parsed.total_gross)} gross, ${(parsed.employees||[]).length} employees`);
                storeDocument(file.name, null, "text/csv", "payroll", importRecord.id, ["payroll"]);
              } catch(e) { console.error(e); }
              setPayrollProcessing(false);
            };
            const postPayroll = (imp) => {
              const newInvoices = imp.journal_entries.filter(e=>e.debit>0).map(e => ({
                id:Date.now()+Math.random(), vendor:"Payroll", description:`${imp.source} Payroll – ${imp.period}`,
                amount:e.debit, date:imp.pay_date, type:"expense",
                gl_code:e.account_code, gl_name:e.account_name,
                secondary_gl_code:"2100", secondary_gl_name:"Accrued Liabilities",
                debit_credit:"debit", confidence:99, reasoning:`Payroll import: ${imp.source}`,
                status:"booked", booked_at:new Date().toISOString(), source:"payroll", payment_status:"paid"
              }));
              setInvoices(prev => [...newInvoices, ...prev]);
              setPayrollImports(prev => prev.map(p => p.id===imp.id ? {...p, posted:true} : p));
              logAudit("payroll_posted", `${imp.source} payroll posted: ${fmt(imp.total_gross)} gross, ${newInvoices.length} entries`);
              showNotification(`Payroll posted: ${fmt(imp.total_gross)} gross ✓`);
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B7280",marginBottom:8}}>PAYROLL</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Payroll Import</h1>
                  <div style={{fontSize:13,color:"#6B7280",marginTop:6}}>Upload a Gusto or ADP payroll export (CSV). AI reads it, generates the journal entries, and posts to your books.</div>
                </div>
                {/* Upload zone */}
                <div onDragOver={e=>{e.preventDefault();setPayrollDragOver(true);}} onDragLeave={()=>setPayrollDragOver(false)}
                  onDrop={e=>{e.preventDefault();setPayrollDragOver(false);const f=e.dataTransfer.files[0];if(f)handlePayrollFile(f);}}
                  style={{border:`2px dashed ${payrollDragOver?"#4F46E5":"#D1D5DB"}`,borderRadius:14,padding:32,textAlign:"center",marginBottom:24,background:payrollDragOver?"#EEF2FF":"#F3F4F6",transition:"all 0.2s",cursor:"pointer"}}
                  onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls";i.onchange=e=>handlePayrollFile(e.target.files[0]);i.click();}}>
                  {payrollProcessing ? <div style={{color:"#4F46E5",fontSize:14}}>⏳ Parsing payroll data...</div> : (
                    <div>
                      <div style={{fontSize:28,marginBottom:8}}>💼</div>
                      <div style={{fontSize:14,fontWeight:500,marginBottom:4}}>Drop Gusto or ADP export here</div>
                      <div style={{fontSize:12,color:"#6B7280"}}>CSV or Excel · AI auto-detects format and generates journal entries</div>
                      <div style={{marginTop:16,display:"flex",gap:10,justifyContent:"center"}}>
                        {["Gusto CSV","ADP RUN","ADP Workforce Now","Generic Payroll CSV"].map(s=>(
                          <span key={s} style={{fontSize:11,background:"#E5E7EB",color:"#6B7280",borderRadius:20,padding:"3px 10px"}}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Import history */}
                {payrollImports.length===0 ? (
                  <div style={{background:"#FFFFFF",border:"1px solid #E5E7EB",borderRadius:14,padding:40,textAlign:"center"}}>
                    <div style={{fontSize:13,color:"#6B7280"}}>No payroll imports yet. Upload a payroll export above.</div>
                  </div>
                ) : payrollImports.map(imp => (
                  <div key={imp.id} style={{background:"#FFFFFF",border:`1px solid ${imp.posted?"#05966933":"#E5E7EB"}`,borderRadius:14,marginBottom:12,overflow:"hidden"}}>
                    <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{fontSize:15,fontWeight:600}}>{imp.source} Payroll</span>
                          {imp.posted && <span style={{fontSize:11,background:"#05966922",color:"#059669",borderRadius:20,padding:"2px 9px"}}>✓ Posted</span>}
                        </div>
                        <div style={{fontSize:12,color:"#6B7280"}}>{imp.period} · Pay date: {imp.pay_date} · {imp.employees?.length||0} employees</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:11,color:"#6B7280"}}>GROSS PAYROLL</div>
                        <div style={{fontSize:20,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#DC2626"}}>{fmt(imp.total_gross)}</div>
                      </div>
                      {!imp.posted && <button onClick={()=>postPayroll(imp)} style={{padding:"9px 20px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#4F46E5,#4338CA)",border:"none",color:"#fff",cursor:"pointer"}}>Post to Ledger</button>}
                    </div>
                    {/* Journal entries preview */}
                    <div style={{borderTop:"1px solid #E5E7EB",overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#F3F4F6"}}>
                          {["Account","Debit","Credit"].map(h=><th key={h} style={{padding:"8px 16px",textAlign:"left",fontSize:10,color:"#6B7280",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {(imp.journal_entries||[]).map((e,i)=>(
                            <tr key={i} style={{borderTop:"1px solid #E5E7EB"}}>
                              <td style={{padding:"10px 16px"}}>
                                <span style={{fontSize:11,background:"#E5E7EB",color:"#6B7280",borderRadius:4,padding:"2px 7px",marginRight:8}}>{e.account_code}</span>
                                <span style={{fontSize:13,color:e.debit>0?"#111827":"#6B7280",paddingLeft:e.credit>0?16:0}}>{e.account_name}</span>
                              </td>
                              <td style={{padding:"10px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,color:"#111827"}}>{e.debit>0?fmt(e.debit):"—"}</td>
                              <td style={{padding:"10px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,color:"#6B7280"}}>{e.credit>0?fmt(e.credit):"—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
}
