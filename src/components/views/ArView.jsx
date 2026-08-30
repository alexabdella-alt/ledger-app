import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney, todayLocal } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { AI_PROXY_URL } from "../../lib/constants";
import { okAIResponse } from "../../lib/ai";
import { computeAR, isLiveEntry, glAccountBalance } from "../../lib/reports";
import { isSettlementEntry } from "../../lib/bankMatch";
import { aiTextOf } from "../../lib/aiJson";

export default function ArView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, getAccountByRole, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, markBillPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = fmtMoney;
            // Amount OWED on a receivable: incl-tax A/R (ar_amount) for taxed invoices,
            // else the ex-tax amount. Ties the lists to GL A/R.
            const arAmt = i => (i && i.ar_amount != null) ? i.ar_amount : (i ? i.amount : 0);
            const today = todayLocal();
            // arAgingNarration moved to top-level state
            // arAgingLoading moved to top-level state
            // arView moved to top-level state

            // Receivables = ISSUED A/R invoices (Dr A/R / Cr Revenue), i.e. entries carrying the
            // A/R account on a leg — NOT "all revenue". A direct deposit (Dr Cash / Cr Revenue) is
            // money ALREADY RECEIVED with no A/R leg, and a collection (Dr Cash / Cr A/R) is a
            // settlement — neither is an open receivable. Without this, Franklin's 16 Toast POS
            // deposits showed as "awaiting collection" (O83 Feb), contradicting the GL-derived
            // total (which is $0). Excludes settlements so a collection JE isn't counted either.
            const arRoleCode = getAccountByRole("accounts_receivable")?.code;
            const arEq = (a, b) => a != null && b != null && String(a) === String(b);
            const hasArLeg = i => arRoleCode != null && (arEq(i.gl_code, arRoleCode) || arEq(i.secondary_gl_code, arRoleCode));
            const arAll   = invoices.filter(i => isLiveEntry(i) && hasArLeg(i) && !isSettlementEntry(i));
            const arOpen  = arAll.filter(i => i.payment_status !== "collected" && i.payment_status !== "paid");
            const arOverdue = arOpen.filter(i => i.due_date && i.due_date < today);

            // GL-derived AR Outstanding — the GL balance of Accounts Receivable, same
            // canonical source as the Dashboard, Balance Sheet, and AP. (computeAR /
            // arOpen still drive the per-invoice lists below for display.)
            const totalAR = glAccountBalance(getAccountByRole("accounts_receivable")?.code, invoices);

            // Aging buckets — age from the invoice's DUE date when it has one (O11), so the
            // buckets reflect days PAST DUE (true AR aging), falling back to the invoice date
            // for older rows that never captured terms.
            const aging = { current:{count:0,total:0,items:[]}, d60:{count:0,total:0,items:[]}, d90:{count:0,total:0,items:[]}, d90plus:{count:0,total:0,items:[]} };
            arOpen.forEach(inv => {
              const days = Math.floor((new Date(today)-new Date(inv.due_date||inv.date||today))/86400000);
              const b = days<=30?"current":days<=60?"d60":days<=90?"d90":"d90plus";
              aging[b].count++; aging[b].total+=arAmt(inv); aging[b].items.push(inv);
            });

            // Collections queue — overdue sorted by amount desc
            const collectionsQueue = [...arOverdue].sort((a,b)=>arAmt(b)-arAmt(a));

            // Route through the canonical verified writer (was local-only → never
            // persisted → reverted on every refresh). side:"ar" sets payment_status="collected".
            const markCollected = async (id) => {
              const ok = await markBillPaid(id, { side: "ar" });
              // Reload so the posted GL collection entry (Dr Cash / Cr AR) appears.
              if (ok) { try { await loadAllData(); } catch {} showNotification("Marked as collected ✓"); }
            };

            const handleArAging = async () => {
              setArAgingLoading(true); setArAgingNarration(null);
              try {
                const res = await fetch(AI_PROXY_URL, {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    profile: "narrate-ar-aging",   // model/max_tokens/system server-owned; aging summary via untrusted slot
                    slots: { AGING:
`Current (0-30 days): ${aging.current.count} invoices · ${fmtMoney(aging.current.total)}
31-60 days: ${aging.d60.count} invoices · ${fmtMoney(aging.d60.total)}
61-90 days: ${aging.d90.count} invoices · ${fmtMoney(aging.d90.total)}
90+ days: ${aging.d90plus.count} invoices · ${fmtMoney(aging.d90plus.total)}
Total outstanding: ${fmtMoney(totalAR)}
Overdue customers: ${[...new Set(arOverdue.map(i=>i.vendor))].join(", ")||"none"}
90+ day customers: ${[...new Set(aging.d90plus.items.map(i=>i.vendor))].join(", ")||"none"}` },
                    messages:[{role:"user", content:"What should this business owner know and do about the AR aging in the instructions?"}]
                  })
                });
                const d = await okAIResponse(res);
                setArAgingNarration(aiTextOf(d));
              } catch(e) { setArAgingNarration("Could not generate commentary."); }
              setArAgingLoading(false);
            };

            return (
              <div>
                {/* Header */}
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>AR Management</h1>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Outstanding invoices you've issued to customers.</div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                  {[
                    { label:"Total Outstanding", value:fmt(totalAR),         sub:`${arOpen.length} open invoices`,          color:"var(--sc-success)" },
                    { label:"Overdue",            value:arOverdue.length,     sub:fmt(arOverdue.reduce((s,i)=>s+arAmt(i),0))+" past due", color:"var(--sc-error)" },
                    { label:"Current (0–30d)",    value:fmt(aging.current.total), sub:`${aging.current.count} invoices`,     color:"var(--sc-gold)" },
                    { label:"Collected (Total)",  value:fmt(arAll.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").reduce((s,i)=>s+arAmt(i),0)), sub:`${arAll.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").length} invoices`, color:"var(--sc-text-2)" },
                  ].map(c=>(
                    <div key={c.label} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, padding:"16px 18px" }}>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", letterSpacing:1, marginBottom:8 }}>{c.label.toUpperCase()}</div>
                      <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace", color:c.color }}>{c.value}</div>
                      <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:4 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Tab bar */}
                <div style={{ display:"flex", gap:2, background:"var(--sc-surface-2)", borderRadius:10, padding:3, border:"1px solid var(--sc-border)", marginBottom:20, width:"fit-content" }}>
                  {[["inbox","📥 Inbox"],["collections","📞 Collections"],["aging","📊 Aging"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setArView(id)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:arView===id?600:400,
                      background:arView===id?"var(--sc-border)":"transparent", border:"none", color:arView===id?"var(--sc-success)":"var(--sc-text-2)", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:6 }}>
                      {label}
                      {id==="collections"&&collectionsQueue.length>0&&<span style={{ background:"var(--sc-error)", color:"var(--sc-on-accent)", borderRadius:20, fontSize:10, fontWeight:700, padding:"1px 6px" }}>{collectionsQueue.length}</span>}
                    </button>
                  ))}
                </div>

                {/* ── AR INBOX ── */}
                {arView==="inbox" && (
                  <div>
                    {arAll.length===0 ? (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:48, textAlign:"center" }}>
                        <div style={{ fontSize:32, marginBottom:12 }}>📥</div>
                        <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No revenue invoices yet</div>
                        <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>Upload invoices you've sent to customers — they'll appear here as outstanding receivables.</div>
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                        {[...arAll].sort((a,b) => {
                          if (a.payment_status==="collected"&&b.payment_status!=="collected") return 1;
                          if (b.payment_status==="collected"&&a.payment_status!=="collected") return -1;
                          return (a.due_date||"9999").localeCompare(b.due_date||"9999");
                        }).map(inv => {
                          const isCollected = inv.payment_status==="collected"||inv.payment_status==="paid";
                          const daysUntilDue = inv.due_date ? Math.floor((new Date(inv.due_date)-new Date(today))/86400000) : null;
                          const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
                          return (
                            <div key={inv.id} style={{ background:"var(--sc-surface)", border:`1px solid ${isCollected?"var(--sc-border)":isOverdue?"var(--sc-error-soft)":"var(--sc-border)"}`, borderRadius:14, overflow:"hidden", opacity:isCollected?0.5:1 }}>
                              <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"var(--sc-on-accent)", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    {isCollected && <span style={{ fontSize:11, background:"var(--sc-success-soft)", color:"var(--sc-success)", borderRadius:20, padding:"2px 8px" }}>✓ Collected</span>}
                                    {isOverdue && !isCollected && <span style={{ fontSize:11, background:"var(--sc-error-soft)", color:"var(--sc-error)", borderRadius:20, padding:"2px 8px" }}>Overdue</span>}
                                    {inv.early_pay_discount && <span style={{ fontSize:11, background:"var(--sc-success-soft)", color:"var(--sc-success)", borderRadius:20, padding:"2px 8px" }}>Early discount offered</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{inv.description} · {inv.gl_name} · {fmtDate(inv.date)}
                                    {inv.payment_terms && <span style={{ color:"var(--sc-text-2)", marginLeft:8 }}>{inv.payment_terms}</span>}
                                  </div>
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"var(--sc-success)" }}>{fmt(arAmt(inv))}</div>
                                  {daysUntilDue!==null && !isCollected && (
                                    <div style={{ fontSize:11, marginTop:3, color:daysUntilDue<0?"var(--sc-error)":daysUntilDue<=7?"var(--sc-warning)":"var(--sc-text-2)" }}>
                                      {daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Due today":`Due in ${daysUntilDue}d`}
                                    </div>
                                  )}
                                  {inv.due_date && <div style={{ fontSize:10, color:"var(--sc-text-2)" }}>{fmtDate(inv.due_date)}</div>}
                                </div>
                              </div>
                              {!isCollected && (
                                <div style={{ padding:"10px 20px", borderTop:"1px solid var(--sc-border)", background:"var(--sc-surface-2)", display:"flex", gap:8 }}>
                                  <button onClick={()=>markCollected(inv.id)} style={{ padding:"6px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))", border:"none", color:"var(--sc-success)", cursor:"pointer" }}>✓ Mark Collected</button>
                                  <button style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }} onClick={()=>setArView("collections")}>Follow Up →</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── COLLECTIONS QUEUE ── */}
                {arView==="collections" && (
                  <div>
                    <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:16 }}>Overdue invoices sorted by amount — largest first.</div>
                    {collectionsQueue.length===0 ? (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, padding:32, textAlign:"center", color:"var(--sc-text-2)", fontSize:13 }}>
                        ✓ No overdue invoices — all receivables are current.
                      </div>
                    ) : (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"var(--sc-surface-2)" }}>
                            {["Customer","Invoice Date","Due Date","Days Overdue","Amount","Action"].map(h=>(
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {collectionsQueue.map((inv,i) => {
                              const daysOverdue = Math.floor((new Date(today)-new Date(inv.due_date))/86400000);
                              const urgencyColor = daysOverdue>90?"var(--sc-error-soft)":daysOverdue>60?"var(--sc-error)":daysOverdue>30?"var(--sc-warning)":"var(--sc-gold)";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)" }}>
                                  <td style={{ padding:"13px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:28,height:28,borderRadius:7,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"var(--sc-on-accent)" }}>{initials(inv.vendor)}</div>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                                        <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>{inv.description?.slice(0,35)}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding:"13px 16px", fontSize:12, color:"var(--sc-text-2)" }}>{fmtDate(inv.date)}</td>
                                  <td style={{ padding:"13px 16px", fontSize:12, color:"var(--sc-error)" }}>{fmtDate(inv.due_date)}</td>
                                  <td style={{ padding:"13px 16px" }}>
                                    <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:urgencyColor, fontWeight:600 }}>{daysOverdue}d</span>
                                  </td>
                                  <td style={{ padding:"13px 16px", fontSize:14, fontFamily:"'DM Mono',monospace", color:"var(--sc-success)", fontWeight:600 }}>{fmt(arAmt(inv))}</td>
                                  <td style={{ padding:"13px 16px" }}>
                                    <button onClick={()=>markCollected(inv.id)} style={{ padding:"5px 14px", borderRadius:8, fontSize:11, fontWeight:600, background:"#D1FAE522", border:"1px solid var(--sc-success-soft)", color:"var(--sc-success)", cursor:"pointer" }}>✓ Collected</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop:"2px solid var(--sc-border-2)", background:"var(--sc-surface-2)" }}>
                              <td colSpan={4} style={{ padding:"12px 16px", fontSize:13, fontWeight:600 }}>Total Overdue</td>
                              <td style={{ padding:"12px 16px", fontSize:15, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"var(--sc-error)" }}>{fmt(collectionsQueue.reduce((s,i)=>s+arAmt(i),0))}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── AR AGING ── */}
                {arView==="aging" && (
                  <div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                      {[
                        { label:"Current (0–30d)", bucket:aging.current, color:"var(--sc-success)" },
                        { label:"31–60 Days",      bucket:aging.d60,     color:"var(--sc-warning)" },
                        { label:"61–90 Days",      bucket:aging.d90,     color:"var(--sc-error)" },
                        { label:"90+ Days",        bucket:aging.d90plus, color:"var(--sc-error-soft)" },
                      ].map(({label,bucket,color})=>(
                        <div key={label} style={{ background:"var(--sc-surface)", border:`1px solid ${color}33`, borderRadius:12, padding:"16px 18px" }}>
                          <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:8 }}>{label}</div>
                          <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmt(bucket.total)}</div>
                          <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:4 }}>{bucket.count} invoice{bucket.count!==1?"s":""}</div>
                          <div style={{ marginTop:10, height:3, background:"var(--sc-border)", borderRadius:2 }}>
                            <div style={{ height:"100%", width:totalAR>0?`${Math.min(100,(bucket.total/totalAR)*100)}%`:"0%", background:color, borderRadius:2 }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI Commentary */}
                    <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:arAgingNarration||arAgingLoading?16:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>✦ CFO Commentary</div>
                        <button onClick={handleArAging} disabled={arAgingLoading}
                          style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))", border:"none", color:"var(--sc-success)", cursor:arAgingLoading?"wait":"pointer" }}>
                          {arAgingLoading?"⟳ Analyzing...":"Generate Analysis"}
                        </button>
                      </div>
                      {arAgingLoading && <div style={{ display:"flex", gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"var(--sc-text-2)",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>}
                      {arAgingNarration && <div style={{ fontSize:13, color:"var(--sc-text-2)", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{arAgingNarration}</div>}
                      {!arAgingNarration && !arAgingLoading && <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>Click Generate Analysis for AI commentary on your AR position and collection risk.</div>}
                    </div>

                    {/* Aging detail table */}
                    {arOpen.length>0 && (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip" }}>
                        <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--sc-border)", fontSize:13, fontWeight:600 }}>All Open Receivables</div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"var(--sc-surface-2)" }}>
                            {["Customer","Invoice Date","Due Date","Age","Amount","Status"].map(h=>(
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...arOpen].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map((inv,i) => {
                              const ageDays = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
                              const ageColor = ageDays<=30?"var(--sc-success)":ageDays<=60?"var(--sc-warning)":ageDays<=90?"var(--sc-error)":"var(--sc-error-soft)";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid var(--sc-border)", background:i%2===0?"transparent":"var(--sc-bg)" }}>
                                  <td style={{ padding:"11px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:24,height:24,borderRadius:6,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"var(--sc-on-accent)" }}>{initials(inv.vendor)}</div>
                                      <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:"var(--sc-text-2)" }}>{fmtDate(inv.date)||"—"}</td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:inv.due_date&&inv.due_date<today?"var(--sc-error)":"var(--sc-text-2)" }}>{inv.due_date||"—"}</td>
                                  <td style={{ padding:"11px 16px" }}><span style={{ fontSize:12, color:ageColor, fontFamily:"'DM Mono',monospace" }}>{ageDays}d</span></td>
                                  <td style={{ padding:"11px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"var(--sc-success)", fontWeight:600 }}>{fmt(arAmt(inv))}</td>
                                  <td style={{ padding:"11px 16px" }}>
                                    <span style={{ fontSize:11, background:inv.due_date&&inv.due_date<today?"var(--sc-error-soft)":"var(--sc-success-soft)", color:inv.due_date&&inv.due_date<today?"var(--sc-error)":"var(--sc-success)", borderRadius:20, padding:"2px 9px" }}>
                                      {inv.due_date&&inv.due_date<today?"Overdue":"Current"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
}
