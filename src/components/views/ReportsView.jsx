import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ReportsView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            // Date filter helper
            const filterByRange = (invList) => {
              if (reportRange === "all") return invList;
              const now = new Date();
              return invList.filter(inv => {
                if (!inv.date) return false;
                const d = new Date(inv.date);
                if (reportRange === "custom") return (!reportDateFrom || d >= new Date(reportDateFrom)) && (!reportDateTo || d <= new Date(reportDateTo));
                if (reportRange === "thismonth") return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
                if (reportRange === "lastmonth") { const lm=new Date(now.getFullYear(),now.getMonth()-1,1); return d.getMonth()===lm.getMonth()&&d.getFullYear()===lm.getFullYear(); }
                if (reportRange === "q1") return d.getMonth()<3 && d.getFullYear()===now.getFullYear();
                if (reportRange === "q2") return d.getMonth()>=3&&d.getMonth()<6&&d.getFullYear()===now.getFullYear();
                if (reportRange === "q3") return d.getMonth()>=6&&d.getMonth()<9&&d.getFullYear()===now.getFullYear();
                if (reportRange === "q4") return d.getMonth()>=9&&d.getFullYear()===now.getFullYear();
                if (reportRange === "ytd") return d.getFullYear()===now.getFullYear();
                return true;
              });
            };
            const filtered = filterByRange(invoices);
            // P&L filter: date range + voided + P&L accounts + optional basis mode
            const plFiltered = filtered.filter(i => {
              if (i.status === "voided" || !glPLType(i.gl_code)) return false;
              if (basisMode === "cash") {
                // Cash basis: bank feed entries are actual cash; otherwise require marked paid/collected
                return i.source === "bank_feed" || i.payment_status === "paid" || i.payment_status === "collected";
              }
              return true; // accrual: all posted entries
            });
            const revenue  = plFiltered.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0);
            const expenses = plFiltered.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
            const net = revenue - expenses;

            // Group revenue by GL
            const byRevGL = {};
            plFiltered.filter(i=>glIsRevenue(i.gl_code)).forEach(inv => {
              const k = inv.gl_code;
              if (!byRevGL[k]) byRevGL[k] = { name: inv.gl_name, code: inv.gl_code, total:0, count:0 };
              byRevGL[k].total += inv.amount; byRevGL[k].count++;
            });
            const revRows = Object.values(byRevGL).sort((a,b)=>b.total-a.total);

            // GAAP P&L groupings: COGS (5000 only) vs Operating Expenses (all other 5xxx/6xxx)
            const allExpGL = {};
            plFiltered.filter(i=>glIsExpense(i.gl_code)).forEach(inv => {
              const k = inv.gl_code;
              if (!allExpGL[k]) allExpGL[k] = { name: inv.gl_name, code: inv.gl_code, total:0, count:0 };
              allExpGL[k].total += inv.amount; allExpGL[k].count++;
            });
            const cogsRows = Object.values(allExpGL).filter(r=>r.code==="5000");
            const opexRows = Object.values(allExpGL).filter(r=>r.code!=="5000").sort((a,b)=>a.code.localeCompare(b.code));
            const cogs = cogsRows.reduce((s,r)=>s+r.total, 0);
            const opex = opexRows.reduce((s,r)=>s+r.total, 0);
            const grossProfit = revenue - cogs;
            const operatingIncome = grossProfit - opex;
            // glRows used by "By Category" tab
            const byGL = allExpGL;
            const glRows = Object.values(byGL).sort((a,b) => a.code?.localeCompare(b.code));

            // Group by vendor — only P&L accounts (income statement items)
            const byVendor = {};
            filtered.filter(i=>glPLType(i.gl_code)).forEach(inv => {
              const v = inv.vendor||"Unknown";
              if (!byVendor[v]) byVendor[v] = { name:v, total:0, count:0 };
              byVendor[v].total += inv.amount; byVendor[v].count++;
            });
            const vendorRows = Object.values(byVendor).sort((a,b)=>b.total-a.total);

            // Cash flow by month — ACTUAL cash only (collected receivables + paid expenses)
            const byMonth = {};
            filtered.forEach(inv => {
              if (!inv.date) return;
              const m = inv.date.slice(0,7);
              if (!byMonth[m]) byMonth[m] = { month:m, inflow:0, outflow:0 };
              // Cash in = revenue that has been collected
              if (glIsRevenue(inv.gl_code) && (inv.payment_status==="collected" || inv.payment_status==="paid")) {
                byMonth[m].inflow += inv.amount;
              }
              // Cash out = expenses that have been paid
              if (glIsExpense(inv.gl_code) && inv.payment_status==="paid") {
                byMonth[m].outflow += inv.amount;
              }
            });
            const cashRows = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month));

            // By project — only P&L accounts
            const byProject = {};
            filtered.filter(i=>glPLType(i.gl_code)).forEach(inv => {
              const p = inv.project||"General";
              if (!byProject[p]) byProject[p] = { name:p, expenses:0, revenue:0, count:0 };
              if (glIsExpense(inv.gl_code)) byProject[p].expenses+=inv.amount;
              else byProject[p].revenue+=inv.amount;
              byProject[p].count++;
            });
            const projectRows = Object.values(byProject).sort((a,b)=>b.expenses-a.expenses);

            const fmt = (n) => "$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2});
            const rangeLabels = { all:"All Time", thismonth:"This Month", lastmonth:"Last Month", q1:"Q1", q2:"Q2", q3:"Q3", q4:"Q4", ytd:"Year to Date", custom: reportDateFrom && reportDateTo ? `${reportDateFrom} → ${reportDateTo}` : "Custom Range" };

            return (
              <div>
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#86868F", marginBottom:8 }}>REPORTING</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Reports</h1>
                </div>

                {/* Controls */}
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24, alignItems:"center" }}>
                  {[["pl","P&L"],["balance","Balance Sheet"],["vendor","By Vendor"],["gl","By Category"],["cashflow","Cash Flow"],["project","By Project"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setReportType(id)} style={{ padding:"8px 16px", borderRadius:20, fontSize:13, background:reportType===id?"#C7BFFF":"transparent", border:`1px solid ${reportType===id?"#C7BFFF":"#262629"}`, color:reportType===id?"#0C0C0E":"#86868F", cursor:"pointer", fontWeight:reportType===id?600:400 }}>{label}</button>
                  ))}
                  <div style={{ flex:1 }} />
                  {/* Date range — custom inputs always visible, preset buttons for quick selection */}
                  <input type="date" value={reportDateFrom} onChange={e=>{ setReportDateFrom(e.target.value); setReportRange("custom"); }} style={{ background:"#141416", border:"1px solid #262629", borderRadius:8, padding:"7px 10px", color:"#F2F2F4", fontSize:13, outline:"none" }} />
                  <span style={{ color:"#86868F", fontSize:13 }}>to</span>
                  <input type="date" value={reportDateTo} onChange={e=>{ setReportDateTo(e.target.value); setReportRange("custom"); }} style={{ background:"#141416", border:"1px solid #262629", borderRadius:8, padding:"7px 10px", color:"#F2F2F4", fontSize:13, outline:"none" }} />
                  <select value={reportRange} onChange={e=>{ setReportRange(e.target.value); const now=new Date(); if(e.target.value==="thismonth"){setReportDateFrom(now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-01");setReportDateTo(now.toISOString().slice(0,10));} else if(e.target.value==="ytd"){setReportDateFrom(now.getFullYear()+"-01-01");setReportDateTo(now.toISOString().slice(0,10));} else if(e.target.value==="all"){setReportDateFrom("");setReportDateTo("");} }} style={{ background:"#141416", border:"1px solid #262629", borderRadius:8, padding:"8px 12px", color:"#F2F2F4", fontSize:13, outline:"none", cursor:"pointer" }}>
                    {Object.entries(rangeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                </div>

                {invoices.length===0 && <div style={{ color:"#86868F", fontSize:14 }}>No data yet. Upload invoices or a bank statement to generate reports.</div>}

                {invoices.length>0 && (
                  <div>
                    {/* P&L */}
                    {reportType==="pl" && (
                      <div>
                        <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden", marginBottom:16 }}>
                          <div style={{ padding:"18px 24px", borderBottom:"1px solid #1C1C20", display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:10 }}>
                            <div>
                              <div style={{ fontSize:14, fontWeight:600 }}>Profit & Loss Statement</div>
                              <div style={{ fontSize:11, color:"#86868F", marginTop:3 }}>{basisMode==="cash"?"Cash basis":"Accrual basis"} · {rangeLabels[reportRange]} · {plFiltered.length} transactions</div>
                            </div>
                            <div style={{ display:"flex", background:"#0C0C0E", border:"1px solid #262629", borderRadius:8, overflow:"hidden" }}>
                              {[["accrual","Accrual"],["cash","Cash"]].map(([m,label])=>(
                                <button key={m} onClick={()=>setBasisMode(m)} style={{ padding:"6px 14px", fontSize:12, border:"none", cursor:"pointer", background:basisMode===m?"#262629":"transparent", color:basisMode===m?"#F2F2F4":"#86868F", fontWeight:basisMode===m?600:400 }}>{label}</button>
                              ))}
                            </div>
                          </div>
                          <div style={{ padding:"0 24px" }}>
                            {/* Revenue */}
                            <div style={{ padding:"16px 0", borderBottom:"1px solid #1C1C20" }}>
                              <div style={{ fontSize:11, color:"#86868F", letterSpacing:2, marginBottom:12 }}>REVENUE</div>
                              {revRows.length===0 ? <div style={{ fontSize:13, color:"#86868F" }}>No revenue recorded</div> :
                                revRows.map(row=>(
                                  <div key={row.code} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, alignItems:"center" }}>
                                    <span style={{ fontSize:13, color:"#D2D2D6", paddingLeft:12, display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ fontSize:10, color:"#55555C", fontFamily:"monospace", background:"#1C1C20", padding:"1px 6px", borderRadius:4 }}>{row.code}</span>
                                      {row.name}
                                    </span>
                                    <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#10B981" }}>{fmt(row.total)}</span>
                                  </div>
                                ))
                              }
                              <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid #1C1C20" }}>
                                <span style={{ fontSize:13, fontWeight:600 }}>Total Revenue</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"#10B981" }}>{fmt(revenue)}</span>
                              </div>
                            </div>
                            {/* COGS — only shown when code 5000 has activity */}
                            {cogsRows.length > 0 && (
                              <div style={{ padding:"16px 0", borderBottom:"1px solid #1C1C20" }}>
                                <div style={{ fontSize:11, color:"#86868F", letterSpacing:2, marginBottom:12 }}>COST OF REVENUE</div>
                                {cogsRows.map(row=>(
                                  <div key={row.code} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, alignItems:"center" }}>
                                    <span style={{ fontSize:13, color:"#D2D2D6", paddingLeft:12, display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ fontSize:10, color:"#55555C", fontFamily:"monospace", background:"#1C1C20", padding:"1px 6px", borderRadius:4 }}>{row.code}</span>
                                      {row.name}
                                    </span>
                                    <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.total)})</span>
                                  </div>
                                ))}
                                <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid #1C1C20" }}>
                                  <span style={{ fontSize:13, fontWeight:600 }}>Gross Profit</span>
                                  <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:grossProfit>=0?"#10B981":"#EF4444" }}>{grossProfit<0?"-":""}{fmt(Math.abs(grossProfit))}</span>
                                </div>
                              </div>
                            )}
                            {/* Operating Expenses */}
                            <div style={{ padding:"16px 0", borderBottom:"1px solid #1C1C20" }}>
                              <div style={{ fontSize:11, color:"#86868F", letterSpacing:2, marginBottom:12 }}>OPERATING EXPENSES</div>
                              {opexRows.length===0 ? <div style={{ fontSize:13, color:"#86868F" }}>No expenses recorded</div> :
                                opexRows.map(row=>(
                                  <div key={row.code} style={{ display:"flex", justifyContent:"space-between", marginBottom:8, alignItems:"center" }}>
                                    <span style={{ fontSize:13, color:"#D2D2D6", paddingLeft:12, display:"flex", alignItems:"center", gap:10 }}>
                                      <span style={{ fontSize:10, color:"#55555C", fontFamily:"monospace", background:"#1C1C20", padding:"1px 6px", borderRadius:4 }}>{row.code}</span>
                                      {row.name}
                                    </span>
                                    <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.total)})</span>
                                  </div>
                                ))
                              }
                              <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid #1C1C20" }}>
                                <span style={{ fontSize:13, fontWeight:600 }}>Total Operating Expenses</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"#EF4444" }}>({fmt(opex)})</span>
                              </div>
                            </div>
                            {/* Operating Income subtotal */}
                            <div style={{ padding:"12px 0", borderBottom:"1px solid #1C1C20", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                              <span style={{ fontSize:14, fontWeight:600, color:"#D2D2D6" }}>Operating Income</span>
                              <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:operatingIncome>=0?"#10B981":"#EF4444" }}>{operatingIncome<0?"-":""}{fmt(Math.abs(operatingIncome))}</span>
                            </div>
                            {/* Net Income */}
                            <div style={{ padding:"18px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                              <span style={{ fontSize:16, fontWeight:700 }}>Net {net>=0?"Income":"Loss"}</span>
                              <span style={{ fontSize:20, fontFamily:"'DM Mono', monospace", fontWeight:700, color:net>=0?"#10B981":"#EF4444" }}>{net<0?"-":""}{fmt(Math.abs(net))}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* BALANCE SHEET */}
                    {reportType==="balance" && (() => {
                      const bsFmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2});

                      // "As of" date — accumulate all transactions through reportDateTo
                      const asOf = reportDateTo || new Date().toISOString().slice(0,10);
                      const bsInvoices = invoices.filter(i => i.status !== "voided" && (!i.date || i.date <= asOf));

                      // Build account balance movements.
                      // Each invoice row represents ONE side of a double-entry (the primary/gl_code side).
                      // For simple entries (single-row JEs and client-side), we must ALSO book the
                      // secondary/offset side — otherwise balance sheet accounts (AP, Cash, AR) stay $0.
                      // Multi-line DB expansions use "_" in their id: each line is already a separate row,
                      // so we only process gl_code for those to avoid double-counting.
                      const movements = {};
                      const applyLine = (code, isDebit, amount) => {
                        const acct = CHART_OF_ACCOUNTS.find(a => a.code === code);
                        if (!acct) return;
                        if (!movements[code]) movements[code] = 0;
                        // Normal balance: Assets/Expenses increase on debit; Liab/Equity/Revenue on credit
                        if (["Assets","Expenses"].includes(acct.category)) {
                          movements[code] += isDebit ? amount : -amount;
                        } else {
                          movements[code] += isDebit ? -amount : amount;
                        }
                      };
                      bsInvoices.forEach(inv => {
                        const amount = inv.amount || 0;
                        // Revenue accounts (4xxx) always have a credit normal balance.
                        // Some uploaded invoices were incorrectly stored with debit_credit:"debit"
                        // on the revenue account — override so the math is always correct.
                        const isDebit = glIsRevenue(inv.gl_code)
                          ? false
                          : inv.debit_credit !== "credit";
                        applyLine(inv.gl_code, isDebit, amount);
                        // Book the offsetting account for non-expanded entries
                        if (!String(inv.id).includes("_") && inv.secondary_gl_code) {
                          applyLine(inv.secondary_gl_code, !isDebit, amount);
                        }
                      });

                      // Opening balance invoice entries are already in `movements` (source:"opening_balance").
                      // Do NOT also add openingBalances state — that would double-count the same amounts.
                      const getBal = (code) => movements[code] || 0;

                      // GAAP groupings — current vs non-current
                      const currentAssets    = CHART_OF_ACCOUNTS.filter(a => a.category==="Assets"      && parseInt(a.code) < 1500);
                      const nonCurrentAssets = CHART_OF_ACCOUNTS.filter(a => a.category==="Assets"      && parseInt(a.code) >= 1500);
                      const currentLiab      = CHART_OF_ACCOUNTS.filter(a => a.category==="Liabilities" && parseInt(a.code) < 2450);
                      const nonCurrentLiab   = CHART_OF_ACCOUNTS.filter(a => a.category==="Liabilities" && parseInt(a.code) >= 2450);
                      const bsEquity         = CHART_OF_ACCOUNTS.filter(a => a.category==="Equity");

                      const totalCurrentAssets    = currentAssets.reduce((s,a)=>s+getBal(a.code),0);
                      const totalNonCurrentAssets = nonCurrentAssets.reduce((s,a)=>s+getBal(a.code),0);
                      const totalAssets            = totalCurrentAssets + totalNonCurrentAssets;
                      const totalCurrentLiab       = currentLiab.reduce((s,a)=>s+getBal(a.code),0);
                      const totalNonCurrentLiab    = nonCurrentLiab.reduce((s,a)=>s+getBal(a.code),0);
                      const totalLiabilities       = totalCurrentLiab + totalNonCurrentLiab;
                      const totalEquityAccts       = bsEquity.reduce((s,a)=>s+getBal(a.code),0);

                      // Current year net income flows into retained earnings
                      const bsRevenue  = bsInvoices.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                      const bsExpenses = bsInvoices.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                      const ytdNet     = bsRevenue - bsExpenses;
                      const totalLiabEquity = totalLiabilities + totalEquityAccts + ytdNet;
                      const isBalanced = Math.abs(totalAssets - totalLiabEquity) < 1;

                      const AcctRow = ({a}) => {
                        const bal = getBal(a.code);
                        if (bal === 0) return null;
                        return (
                          <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 16px",borderBottom:"1px solid #161619"}}>
                            <div style={{fontSize:13,color:"#D2D2D6"}}>
                              <span style={{color:"#55555C",marginRight:8,fontFamily:"monospace",fontSize:11}}>{a.code}</span>{a.name}
                            </div>
                            <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:bal<0?"#EF4444":"#F2F2F4"}}>{bsFmt(bal)}</div>
                          </div>
                        );
                      };
                      const SubtotalRow = ({label, total}) => (
                        <div style={{display:"flex",justifyContent:"space-between",padding:"8px 0 8px 16px",marginTop:2}}>
                          <div style={{fontSize:12,fontWeight:600,color:"#9A9AA2",fontStyle:"italic"}}>{label}</div>
                          <div style={{fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"#C7BFFF"}}>{bsFmt(total)}</div>
                        </div>
                      );
                      const SectionTitle = ({label}) => (
                        <div style={{fontSize:11,fontWeight:700,color:"#C7BFFF",letterSpacing:2,marginBottom:8,paddingBottom:6,borderBottom:"1px solid #262629",marginTop:8}}>{label}</div>
                      );
                      const SubLabel = ({label}) => (
                        <div style={{fontSize:10,color:"#86868F",letterSpacing:1,marginTop:12,marginBottom:4,paddingLeft:4}}>{label}</div>
                      );
                      const TotalRow = ({label, total, large}) => (
                        <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",borderTop:"2px solid #262629",marginTop:4,marginBottom:large?0:20}}>
                          <div style={{fontSize:large?15:13,fontWeight:700}}>{label}</div>
                          <div style={{fontSize:large?16:14,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#C7BFFF"}}>{bsFmt(total)}</div>
                        </div>
                      );

                      return (
                        <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:14,overflow:"hidden"}}>
                          <div style={{padding:"18px 24px",borderBottom:"1px solid #1C1C20",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                            <div>
                              <div style={{fontSize:14,fontWeight:600}}>Balance Sheet</div>
                              <div style={{fontSize:11,color:"#86868F",marginTop:3}}>As of {new Date(asOf+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})} · GAAP basis</div>
                            </div>
                            <div style={{display:"flex",alignItems:"center",gap:10}}>
                              {!isBalanced && <div style={{fontSize:11,color:"#F59E0B",background:"#1A1200",border:"1px solid #F59E0B44",borderRadius:8,padding:"4px 10px"}}>⚠ Out of balance by {bsFmt(Math.abs(totalAssets-totalLiabEquity))}</div>}
                              {isBalanced && <div style={{fontSize:11,color:"#10B981",background:"#0A2A1A",border:"1px solid #10B98133",borderRadius:8,padding:"4px 10px"}}>✓ Balanced</div>}
                            </div>
                          </div>
                          <div style={{padding:"24px 28px"}}>

                            {/* ASSETS */}
                            <SectionTitle label="ASSETS" />
                            <SubLabel label="Current Assets" />
                            {currentAssets.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Current Assets" total={totalCurrentAssets} />
                            <SubLabel label="Non-Current Assets" />
                            {nonCurrentAssets.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Non-Current Assets" total={totalNonCurrentAssets} />
                            <TotalRow label="Total Assets" total={totalAssets} />

                            {/* LIABILITIES */}
                            <SectionTitle label="LIABILITIES" />
                            <SubLabel label="Current Liabilities" />
                            {currentLiab.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Current Liabilities" total={totalCurrentLiab} />
                            <SubLabel label="Non-Current Liabilities" />
                            {nonCurrentLiab.map(a=><AcctRow key={a.code} a={a}/>)}
                            <SubtotalRow label="Total Non-Current Liabilities" total={totalNonCurrentLiab} />
                            <TotalRow label="Total Liabilities" total={totalLiabilities} />

                            {/* EQUITY — GAAP interim presentation */}
                            <SectionTitle label="STOCKHOLDERS' EQUITY" />

                            {/* Paid-in capital accounts (Common Stock, APIC) — show all except Retained Earnings (3100) */}
                            {bsEquity.filter(a => a.code !== "3100" && getBal(a.code) !== 0).map(a=>(
                              <div key={a.code} style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 16px",borderBottom:"1px solid #161619"}}>
                                <div style={{fontSize:13,color:"#D2D2D6"}}><span style={{color:"#55555C",marginRight:8,fontFamily:"monospace",fontSize:11}}>{a.code}</span>{a.name}</div>
                                <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:getBal(a.code)<0?"#EF4444":"#F2F2F4"}}>{bsFmt(getBal(a.code))}</div>
                              </div>
                            ))}

                            {/* Retained Earnings detail — GAAP interim balance sheet shows prior + current period separately */}
                            <SubLabel label="Retained Earnings" />
                            {getBal("3100") !== 0 && (
                              <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 28px",borderBottom:"1px solid #161619"}}>
                                <div style={{fontSize:13,color:"#D2D2D6"}}>Retained Earnings, beginning of period</div>
                                <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:getBal("3100")<0?"#EF4444":"#F2F2F4"}}>{bsFmt(getBal("3100"))}</div>
                              </div>
                            )}
                            <div style={{display:"flex",justifyContent:"space-between",padding:"6px 0 6px 28px",borderBottom:"1px solid #161619"}}>
                              <div style={{fontSize:13,color:"#D2D2D6"}}>Net {ytdNet>=0?"Income":"Loss"} (current period)</div>
                              <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:ytdNet>=0?"#10B981":"#EF4444"}}>{ytdNet<0?"-":""}{bsFmt(Math.abs(ytdNet))}</div>
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",padding:"7px 0 7px 28px",borderBottom:"1px solid #262629",marginBottom:2}}>
                              <div style={{fontSize:12,fontWeight:600,color:"#9A9AA2",fontStyle:"italic"}}>Total Retained Earnings</div>
                              <div style={{fontSize:13,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"#C7BFFF"}}>{bsFmt(getBal("3100")+ytdNet)}</div>
                            </div>

                            <TotalRow label="Total Stockholders' Equity" total={totalEquityAccts+ytdNet} />

                            {/* TOTAL L+E */}
                            <div style={{borderTop:"2px solid #C7BFFF55",paddingTop:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                              <div style={{fontSize:15,fontWeight:700}}>Total Liabilities + Equity</div>
                              <div style={{fontSize:17,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#C7BFFF"}}>{bsFmt(totalLiabEquity)}</div>
                            </div>

                            {openingBalances.length===0 && (
                              <div style={{marginTop:16,background:"#1A1200",border:"1px solid #F59E0B44",borderRadius:8,padding:"12px 16px",fontSize:12,color:"#F59E0B"}}>
                                ⚠ No opening balances set. Go to Settings → Opening Balances to enter your starting balances for an accurate balance sheet.
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* BY VENDOR */}
                    {reportType==="vendor" && (
                      <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1C1C20", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Expenses by Vendor</div>
                          <div style={{ fontSize:12, color:"#86868F" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0C0C0E" }}>
                            {["Vendor","Invoices","Total Spend","% of Total"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#86868F", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {vendorRows.map((v,i)=>(
                              <tr key={v.name} style={{ borderTop:"1px solid #1C1C20", background:i%2===0?"transparent":"#0A0A0C" }}>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                    <div style={{ width:28, height:28, borderRadius:7, background:vendorColor(v.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff" }}>{initials(v.name)}</div>
                                    <span style={{ fontSize:13, fontWeight:500 }}>{v.name}</span>
                                  </div>
                                </td>
                                <td style={{ padding:"13px 20px", fontSize:13, color:"#9A9AA2" }}>{v.count}</td>
                                <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#F2F2F4" }}>{fmt(v.total)}</td>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ height:6, width:80, background:"#1C1C20", borderRadius:3 }}>
                                      <div style={{ height:"100%", width:`${Math.min(100,(v.total/(expenses||1))*100)}%`, background:vendorColor(v.name), borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:12, color:"#9A9AA2", fontFamily:"'DM Mono', monospace" }}>{expenses>0?((v.total/expenses)*100).toFixed(1):0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* BY GL CATEGORY */}
                    {reportType==="gl" && (
                      <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1C1C20", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Expenses by GL Category</div>
                          <div style={{ fontSize:12, color:"#86868F" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0C0C0E" }}>
                            {["GL Account","Transactions","Amount","% of Expenses"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#86868F", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {glRows.map((row,i)=>(
                              <tr key={row.code} style={{ borderTop:"1px solid #1C1C20", background:i%2===0?"transparent":"#0A0A0C" }}>
                                <td style={{ padding:"13px 20px" }}>
                                  <span style={{ background:"#1C1C20", padding:"3px 10px", borderRadius:20, fontSize:12, color:"#C7BFFF" }}>{row.code} · {row.name}</span>
                                </td>
                                <td style={{ padding:"13px 20px", fontSize:13, color:"#9A9AA2" }}>{row.count}</td>
                                <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.total)})</td>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ height:6, width:80, background:"#1C1C20", borderRadius:3 }}>
                                      <div style={{ height:"100%", width:`${Math.min(100,(row.total/(expenses||1))*100)}%`, background:"#C7BFFF", borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:12, color:"#9A9AA2", fontFamily:"'DM Mono', monospace" }}>{expenses>0?((row.total/expenses)*100).toFixed(1):0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* CASH FLOW */}
                    {reportType==="cashflow" && (
                      <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1C1C20", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <div>
                            <div style={{ fontSize:14, fontWeight:600 }}>Cash Flow Statement</div>
                            <div style={{ fontSize:11, color:"#86868F", marginTop:3 }}>Cash basis — collected receipts and paid expenses only</div>
                          </div>
                          <div style={{ fontSize:12, color:"#86868F" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        {cashRows.length===0 ? <div style={{ padding:24, color:"#86868F", fontSize:13 }}>No cash transactions recorded yet. Mark invoices as paid/collected to see cash flow.</div> : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr style={{ background:"#0C0C0E" }}>
                              {["Month","Inflow","Outflow","Net","Running"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#86868F", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                            </tr></thead>
                            <tbody>
                              {cashRows.map((row,i)=>{
                                const net = row.inflow - row.outflow;
                                const running = cashRows.slice(0,i+1).reduce((s,r)=>s+(r.inflow-r.outflow),0);
                                return (
                                  <tr key={row.month} style={{ borderTop:"1px solid #1C1C20", background:i%2===0?"transparent":"#0A0A0C" }}>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontWeight:500 }}>{row.month}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#10B981" }}>{fmt(row.inflow)}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.outflow)})</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:net>=0?"#10B981":"#EF4444" }}>{net<0?"-":""}{fmt(net)}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:running>=0?"#F2F2F4":"#EF4444" }}>{running<0?"-":""}{fmt(running)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {/* BY PROJECT */}
                    {reportType==="project" && (
                      <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1C1C20", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Project Cost Breakdown</div>
                          <div style={{ fontSize:12, color:"#86868F" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0C0C0E" }}>
                            {["Project","Transactions","Revenue","Expenses","Net"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#86868F", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {projectRows.map((p,i)=>{
                              const pnet = p.revenue - p.expenses;
                              return (
                                <tr key={p.name} style={{ borderTop:"1px solid #1C1C20", background:i%2===0?"transparent":"#0A0A0C" }}>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontWeight:500, color:"#C7BFFF" }}>{p.name}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, color:"#9A9AA2" }}>{p.count}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#10B981" }}>{fmt(p.revenue)}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(p.expenses)})</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:pnet>=0?"#10B981":"#EF4444" }}>{pnet<0?"-":""}{fmt(pnet)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Ask AI button */}
                    <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end" }}>
                      <button onClick={()=>{ setChatOpen(true); setChatInput(`Give me a detailed analysis of my ${reportType==="pl"?"profit and loss":reportType==="vendor"?"vendor spend":reportType==="gl"?"expense categories":reportType==="cashflow"?"cash flow":"project costs"} for ${rangeLabels[reportRange]}`); }} style={{ background:"linear-gradient(135deg,#6D5EF6,#4A3DB8)", border:"none", color:"#F2F2F4", borderRadius:10, padding:"10px 20px", fontSize:13, cursor:"pointer" }}>
                        ✦ Ask AI to analyze this report
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
}
