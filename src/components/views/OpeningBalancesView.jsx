import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function OpeningBalancesView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, cutoffDate, saveCutoffDate, postOpeningBalances, openingPosted, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const bsAccts = CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category));
            // Bank-linked cash GL codes are OWNED by the bank flow (bank-as-source-of-truth):
            // shown read-only here, valued from the bank balance, so no account is opened twice.
            const bankLinked = new Set((bankAccounts||[]).map(b=>b.gl_code).filter(Boolean));
            const bankBalFor = code => (bankAccounts||[]).filter(b=>b.gl_code===code).reduce((s,b)=>s+(Number(b.current_balance)||0),0);

            const existing = {}; (openingBalances||[]).forEach(b => { existing[b.account_code] = b.balance; });
            const balancesInit = bsAccts.reduce((acc,a) => ({...acc,[a.code]: bankLinked.has(a.code) ? bankBalFor(a.code) : (existing[a.code] ?? "")}), {});
            const balances = Object.keys(openingBalBalances).length > 0 ? { ...openingBalBalances } : balancesInit;
            // Bank-linked cash is PRE-FILLED from the bank balance (when known) but stays
            // editable — an established business must be able to type its day-one cash, and a
            // new business whose bank balance isn't recorded yet shouldn't be locked to 0.
            const setBalances = setOpeningBalBalances;

            const totalAssets = CHART_OF_ACCOUNTS.filter(a=>a.category==="Assets").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalLiab = CHART_OF_ACCOUNTS.filter(a=>a.category==="Liabilities").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalEquity = CHART_OF_ACCOUNTS.filter(a=>a.category==="Equity").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const isBalanced = Math.abs(totalAssets - totalLiab - totalEquity) < 0.01;

            // Post via the canonical handler: one balanced opening JE (plug to OBE 3400),
            // persisted + saved to opening_balances (survives refresh). Bank-linked cash is
            // overridden from bank balances in the handler, so we send only grid values.
            const post = async () => {
              const grid = {};
              // Send ALL entered balances incl. bank-linked cash. postOpeningBalances uses the
              // bank's recorded balance only as a FALLBACK when the grid omits a GL code, so the
              // value shown here (bank pre-fill or a manual entry) is what actually posts.
              bsAccts.forEach(a => { const v = parseFloat(balances[a.code]); if (v) grid[a.code] = v; });
              await postOpeningBalances(grid);
            };

            return (
              <div style={{maxWidth:680}}>
                <div id="opening-balances-section" style={{marginBottom:24,scrollMarginTop:16}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>SETUP</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Opening Balances</h1>
                  <div style={{fontSize:13,color:"var(--sc-text-2)",marginTop:6}}>Enter your account balances as of the date you're starting your books. This sets the baseline for all reports.</div>
                </div>

                {/* Cutoff (Day One) — editable until the opening entry is posted, then locked */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:16}}>
                  <div style={{fontSize:13,color:"var(--sc-text-2)",flexShrink:0}}>Cutoff date (Day One):</div>
                  <input type="date" value={cutoffDate||""} disabled={openingPosted} onChange={e=>saveCutoffDate(e.target.value)}
                    style={{background: openingPosted?"var(--sc-surface-2)":"var(--sc-surface)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"7px 12px",color:"var(--sc-text)",fontSize:13,outline:"none",cursor:openingPosted?"not-allowed":"text"}}/>
                  {openingPosted && <span style={{fontSize:12,color:"var(--sc-text-2)"}}>🔒 locked — opening balances posted</span>}
                  <div style={{marginLeft:"auto",fontSize:12,color:isBalanced?"var(--sc-success)":"var(--sc-error)",fontWeight:500}}>
                    {isBalanced ? "✓ Balanced" : `Out of balance by ${fmt(Math.abs(totalAssets-totalLiab-totalEquity))}`}
                  </div>
                </div>
                {!cutoffDate && <div style={{background:"var(--sc-warning-soft)",border:"1px solid var(--sc-warning-soft)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize:12.5,color:"var(--sc-warning)"}}>Set your cutoff date first — it's the day your books begin. No transactions may be dated before it; everything before it is captured here as opening balances.</div>}

                {/* Balance sheet input by category */}
                {["Assets","Liabilities","Equity"].map(cat => (
                  <div key={cat} style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:12,overflow:"hidden",marginBottom:12}}>
                    <div style={{padding:"12px 20px",background:"var(--sc-surface-2)",borderBottom:"1px solid var(--sc-border)",display:"flex",justifyContent:"space-between"}}>
                      <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",letterSpacing:0.5}}>{cat.toUpperCase()}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"var(--sc-text)"}}>
                        {fmt(CHART_OF_ACCOUNTS.filter(a=>a.category===cat).reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0))}
                      </div>
                    </div>
                    {CHART_OF_ACCOUNTS.filter(a=>a.category===cat).map((acct,i)=>(
                      <div key={acct.code} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderTop:i>0?"1px solid var(--sc-border)":"none"}}>
                        <div style={{flex:1}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--sc-text-2)",marginRight:10}}>{acct.code}</span>
                          <span style={{fontSize:13}}>{acct.name}</span>
                        </div>
                        {bankLinked.has(acct.code) && bankBalFor(acct.code)>0 && <span style={{fontSize:10,color:"var(--sc-gold)",marginRight:8}} title="Pre-filled from the linked bank account — editable">from bank</span>}
                        <input type="number" value={balances[acct.code]||""}
                          onChange={e=>setBalances(b=>({...b,[acct.code]:e.target.value}))}
                          placeholder="0.00" step="0.01"
                          style={{width:140,background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"7px 12px",color:"var(--sc-text)",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",textAlign:"right",cursor:"text"}}/>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Summary */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,textAlign:"center"}}>
                  {[["Total Assets",totalAssets,"var(--sc-success)"],["Total Liabilities",totalLiab,"var(--sc-error)"],["Total Equity",totalEquity,"var(--sc-gold)"]].map(([l,v,c])=>(
                    <div key={l}>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>{l}</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'DM Mono',monospace",color:c}}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>

                {(() => { const canPost = isBalanced && !!cutoffDate; return (
                <button onClick={post} disabled={!canPost} style={{padding:"11px 32px",borderRadius:10,fontSize:14,fontWeight:600,background:canPost?"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))":"var(--sc-border)",border:"none",color:canPost?"var(--sc-surface)":"var(--sc-text-2)",cursor:canPost?"pointer":"not-allowed"}}>
                  {openingPosted ? "Update Opening Balances" : "Post Opening Balances"}
                </button> ); })()}
              </div>
            );
}
