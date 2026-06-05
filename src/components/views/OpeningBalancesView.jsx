import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function OpeningBalancesView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const asOfDate = openingBalAsOfDate; const setAsOfDate = setOpeningBalAsOfDate;
            const balancesInit = (() => {
              const existing = {};
              openingBalances.forEach(b => { existing[b.account_code] = b.balance; });
              return CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category)).reduce((acc,a) => ({...acc,[a.code]: existing[a.code]||""}), {});
            })();
            const balances = Object.keys(openingBalBalances).length > 0 ? openingBalBalances : balancesInit;
            const setBalances = setOpeningBalBalances;
            const totalAssets = CHART_OF_ACCOUNTS.filter(a=>a.category==="Assets").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalLiab = CHART_OF_ACCOUNTS.filter(a=>a.category==="Liabilities").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalEquity = CHART_OF_ACCOUNTS.filter(a=>a.category==="Equity").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const isBalanced = Math.abs(totalAssets - totalLiab - totalEquity) < 0.01;

            const post = () => {
              const entries = CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category))
                .filter(a => parseFloat(balances[a.code])||0 !== 0)
                .map(a => ({
                  id: Date.now()+Math.random(), vendor:"Opening Balance", description:`Opening balance – ${a.name}`,
                  amount: Math.abs(parseFloat(balances[a.code])||0), date: asOfDate, type:"opening",
                  gl_code: a.code, gl_name: a.name, secondary_gl_code:"3100", secondary_gl_name:"Retained Earnings",
                  debit_credit: a.category==="Assets"?"debit":"credit",
                  confidence:100, reasoning:"Opening balance entry", status:"booked",
                  booked_at: new Date().toISOString(), source:"opening_balance", payment_status:"paid"
                }));
              setInvoices(prev => [...entries, ...prev.filter(i=>i.source!=="opening_balance")]);
              const obRecords = CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category))
                .filter(a=>parseFloat(balances[a.code])||0)
                .map(a=>({account_code:a.code,account_name:a.name,balance:parseFloat(balances[a.code]),as_of_date:asOfDate,posted:true}));
              setOpeningBalances(obRecords);
              logAudit("opening_balances_posted",`Opening balances posted as of ${asOfDate}: Assets ${fmt(totalAssets)}, Liabilities ${fmt(totalLiab)}, Equity ${fmt(totalEquity)}`);
              showNotification(`Opening balances posted as of ${asOfDate} ✓`);
            };

            return (
              <div style={{maxWidth:680}}>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#86868F",marginBottom:8}}>SETUP</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Opening Balances</h1>
                  <div style={{fontSize:13,color:"#86868F",marginTop:6}}>Enter your account balances as of the date you're starting your books. This sets the baseline for all reports.</div>
                </div>

                {/* As-of date */}
                <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:16}}>
                  <div style={{fontSize:13,color:"#9A9AA2",flexShrink:0}}>As of date:</div>
                  <input type="date" value={asOfDate} onChange={e=>setAsOfDate(e.target.value)}
                    style={{background:"#0C0C0E",border:"1px solid #262629",borderRadius:8,padding:"7px 12px",color:"#F2F2F4",fontSize:13,outline:"none"}}/>
                  <div style={{marginLeft:"auto",fontSize:12,color:isBalanced?"#10B981":"#EF4444",fontWeight:500}}>
                    {isBalanced ? "✓ Balanced" : `Out of balance by ${fmt(Math.abs(totalAssets-totalLiab-totalEquity))}`}
                  </div>
                </div>

                {/* Balance sheet input by category */}
                {["Assets","Liabilities","Equity"].map(cat => (
                  <div key={cat} style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:12,overflow:"hidden",marginBottom:12}}>
                    <div style={{padding:"12px 20px",background:"#0C0C0E",borderBottom:"1px solid #1C1C20",display:"flex",justifyContent:"space-between"}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#C7BFFF",letterSpacing:0.5}}>{cat.toUpperCase()}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"#F2F2F4"}}>
                        {fmt(CHART_OF_ACCOUNTS.filter(a=>a.category===cat).reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0))}
                      </div>
                    </div>
                    {CHART_OF_ACCOUNTS.filter(a=>a.category===cat).map((acct,i)=>(
                      <div key={acct.code} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderTop:i>0?"1px solid #1C1C20":"none"}}>
                        <div style={{flex:1}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#86868F",marginRight:10}}>{acct.code}</span>
                          <span style={{fontSize:13}}>{acct.name}</span>
                        </div>
                        <input type="number" value={balances[acct.code]||""} onChange={e=>setBalances(b=>({...b,[acct.code]:e.target.value}))}
                          placeholder="0.00" step="0.01"
                          style={{width:140,background:"#0C0C0E",border:"1px solid #262629",borderRadius:8,padding:"7px 12px",color:"#F2F2F4",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",textAlign:"right"}}/>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Summary */}
                <div style={{background:"#141416",border:"1px solid #262629",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,textAlign:"center"}}>
                  {[["Total Assets",totalAssets,"#10B981"],["Total Liabilities",totalLiab,"#EF4444"],["Total Equity",totalEquity,"#C7BFFF"]].map(([l,v,c])=>(
                    <div key={l}>
                      <div style={{fontSize:11,color:"#86868F",marginBottom:4}}>{l}</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'DM Mono',monospace",color:c}}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>

                <button onClick={post} disabled={!isBalanced} style={{padding:"11px 32px",borderRadius:10,fontSize:14,fontWeight:600,background:isBalanced?"linear-gradient(135deg,#6D5EF6,#4A3DB8)":"#1C1C20",border:"none",color:isBalanced?"#F2F2F4":"#86868F",cursor:isBalanced?"pointer":"not-allowed"}}>
                  Post Opening Balances
                </button>
              </div>
            );
}
