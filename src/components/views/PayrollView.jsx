import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor , fmtMoney } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { AI_PROXY_URL } from "../../lib/constants";
import { okAIResponse } from "../../lib/ai";
import { buildPayrollEntry } from "../../lib/payroll";

export default function PayrollView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, guardImport, pendingImportFile, setPendingImportFile, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistMultiLineEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = fmtMoney;
            const handlePayrollFile = async (file) => {
              if (!file) return;
              if (!(await guardImport(file, "payroll"))) return;   // misroute guard (O37)
              setPayrollProcessing(true);
              logAudit("payroll_upload_started", `Uploading payroll file: ${file.name}`);
              try {
                const text = await file.text();
                const res = await fetch(AI_PROXY_URL, {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    profile: "parse-payroll",   // model/max_tokens/system server-owned; payroll text via untrusted slot
                    slots: { PAYROLL: text.slice(0,8000) },
                    messages:[{role:"user", content:"Parse the payroll export text in the instructions."}]
                  })
                });
                const d = await okAIResponse(res);
                const parsed = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
                const importRecord = { id:Date.now()+Math.random(), source:parsed.source||"Unknown", period:`${parsed.period_start} – ${parsed.period_end}`, pay_date:parsed.pay_date, total_gross:parsed.total_gross, total_net:parsed.total_net, total_employer_taxes:parsed.total_employer_taxes, journal_entries:parsed.journal_entries||[], employees:parsed.employees||[], imported_at:new Date().toISOString(), file_name:file.name, posted:false };
                setPayrollImports(prev => [importRecord, ...prev]);
                logAudit("payroll_parsed", `${parsed.source} payroll parsed: ${fmt(parsed.total_gross)} gross, ${(parsed.employees||[]).length} employees`);
                storeDocument(file.name, null, "text/csv", "payroll", importRecord.id, ["payroll"], null, file);
              } catch(e) { console.error(e); }
              setPayrollProcessing(false);
            };
            // Consume a file routed here from another importer's misroute warning (O37).
            React.useEffect(() => {
              if (pendingImportFile?.type === "payroll" && pendingImportFile.file) {
                const f = pendingImportFile.file; setPendingImportFile(null); handlePayrollFile(f);
              }
            }, [pendingImportFile]);
            // The SINGLE source for both the preview and the post: the standard payroll
            // entry built deterministically from the parsed totals (Dr Salaries / Dr
            // Payroll Tax Exp / Cr Cash(net) / Cr Payroll Taxes Payable). Accounts resolve
            // by ROLE (works whether payroll_tax is 6010 or a legacy 5101). The preview
            // renders THIS, so what the user reviews is exactly what posts.
            const payrollEntryFor = (imp) => buildPayrollEntry({
              gross: Number(imp.total_gross) || 0,
              netPay: imp.total_net != null ? Number(imp.total_net) : null,
              employerTaxes: Number(imp.total_employer_taxes) || 0,
              salariesCode: getAccountByRole("salaries_wages")?.code || "6000",
              payrollTaxExpCode: getAccountByRole("payroll_tax")?.code || "6010",
              cashCode: getAccountByRole("cash")?.code || "1000",
              payrollTaxesPayableCode: getAccountByRole("payroll_taxes_payable")?.code || "2101",
              date: imp.pay_date,
              description: `${imp.source} Payroll — ${imp.period}`,
              meta: { kind: "payroll", source: imp.source, period: imp.period },
            });
            const acctName = (code) => (CHART_OF_ACCOUNTS.find(a => String(a.code) === String(code))?.name) || code;

            // Was setInvoices-only → never persisted (vanished on refresh); now durable
            // like every other event, posting the SAME entry shown in the preview.
            const postPayroll = async (imp) => {
              const je = payrollEntryFor(imp);
              if (!je || !je.balanced) { showNotification("Couldn't build the payroll entry — check the totals.", "error"); return; }
              const jeId = await persistMultiLineEntry(je);   // cutoff-guarded; refuses unbalanced
              if (!jeId) return;                              // failure already surfaced (e.g. pre-cutoff)
              setPayrollImports(prev => prev.map(p => p.id===imp.id ? {...p, posted:true} : p));
              logAudit("payroll_posted", `${imp.source} payroll posted: ${fmt(imp.total_gross)} gross → Dr Salaries/Tax · Cr Cash/Payroll Taxes Payable`);
              try { await loadAllData(); } catch {}           // surface the posted entry
              showNotification(`Payroll posted: ${fmt(imp.total_gross)} gross ✓`);
            };
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
                  onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls";i.onchange=e=>handlePayrollFile(e.target.files[0]);i.click();}}>
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
