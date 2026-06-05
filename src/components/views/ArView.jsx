import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function ArView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const today = new Date().toISOString().slice(0,10);
            // arAgingNarration moved to top-level state
            // arAgingLoading moved to top-level state
            // arView moved to top-level state

            // All revenue invoices = AR
            const arAll   = invoices.filter(i => glIsRevenue(i.gl_code) || i.type==="revenue");
            const arOpen  = arAll.filter(i => i.payment_status !== "collected" && i.payment_status !== "paid");
            const arOverdue = arOpen.filter(i => i.due_date && i.due_date < today);

            const totalAR = arOpen.reduce((s,i)=>s+i.amount,0);

            // Aging buckets by invoice date
            const aging = { current:{count:0,total:0,items:[]}, d60:{count:0,total:0,items:[]}, d90:{count:0,total:0,items:[]}, d90plus:{count:0,total:0,items:[]} };
            arOpen.forEach(inv => {
              const days = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
              const b = days<=30?"current":days<=60?"d60":days<=90?"d90":"d90plus";
              aging[b].count++; aging[b].total+=inv.amount; aging[b].items.push(inv);
            });

            // Collections queue — overdue sorted by amount desc
            const collectionsQueue = [...arOverdue].sort((a,b)=>b.amount-a.amount);

            const markCollected = (id) => {
              setInvoices(prev => prev.map(i => i.id!==id ? i : {...i, payment_status:"collected", collected_at:new Date().toISOString(), matched:true}));
              showNotification("Marked as collected ✓");
            };

            const handleArAging = async () => {
              setArAgingLoading(true); setArAgingNarration(null);
              try {
                const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    model:"claude-sonnet-4-20250514", max_tokens:700,
                    system:`You are a CFO advisor reviewing an accounts receivable aging report. Be direct, practical, specific. 3-4 short paragraphs. Flag collection risks. Suggest concrete follow-up actions. No jargon.`,
                    messages:[{role:"user", content:
`AR Aging Summary:
Current (0-30 days): ${aging.current.count} invoices · $${aging.current.total.toLocaleString()}
31-60 days: ${aging.d60.count} invoices · $${aging.d60.total.toLocaleString()}
61-90 days: ${aging.d90.count} invoices · $${aging.d90.total.toLocaleString()}
90+ days: ${aging.d90plus.count} invoices · $${aging.d90plus.total.toLocaleString()}
Total outstanding: $${totalAR.toLocaleString()}
Overdue customers: ${[...new Set(arOverdue.map(i=>i.vendor))].join(", ")||"none"}
90+ day customers: ${[...new Set(aging.d90plus.items.map(i=>i.vendor))].join(", ")||"none"}

What should this business owner know and do?`}]
                  })
                });
                const d = await res.json();
                setArAgingNarration(d.content?.find(b=>b.type==="text")?.text||"");
              } catch(e) { setArAgingNarration("Could not generate commentary."); }
              setArAgingLoading(false);
            };

            return (
              <div>
                {/* Header */}
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>AR Management</h1>
                  <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Outstanding invoices you've issued to customers.</div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                  {[
                    { label:"Total Outstanding", value:fmt(totalAR),         sub:`${arOpen.length} open invoices`,          color:"#10B981" },
                    { label:"Overdue",            value:arOverdue.length,     sub:fmt(arOverdue.reduce((s,i)=>s+i.amount,0))+" past due", color:"#EF4444" },
                    { label:"Current (0–30d)",    value:fmt(aging.current.total), sub:`${aging.current.count} invoices`,     color:"#C8B8FF" },
                    { label:"Collected (Total)",  value:fmt(arAll.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").reduce((s,i)=>s+i.amount,0)), sub:`${arAll.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").length} invoices`, color:"#6B6B8A" },
                  ].map(c=>(
                    <div key={c.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"16px 18px" }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:1, marginBottom:8 }}>{c.label.toUpperCase()}</div>
                      <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace", color:c.color }}>{c.value}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Tab bar */}
                <div style={{ display:"flex", gap:2, background:"#0F0F13", borderRadius:10, padding:3, border:"1px solid #1E1E2E", marginBottom:20, width:"fit-content" }}>
                  {[["inbox","📥 Inbox"],["collections","📞 Collections"],["aging","📊 Aging"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setArView(id)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:arView===id?600:400,
                      background:arView===id?"#1E1E2E":"transparent", border:"none", color:arView===id?"#10B981":"#6B6B8A", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:6 }}>
                      {label}
                      {id==="collections"&&collectionsQueue.length>0&&<span style={{ background:"#EF4444", color:"#fff", borderRadius:20, fontSize:10, fontWeight:700, padding:"1px 6px" }}>{collectionsQueue.length}</span>}
                    </button>
                  ))}
                </div>

                {/* ── AR INBOX ── */}
                {arView==="inbox" && (
                  <div>
                    {arAll.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                        <div style={{ fontSize:32, marginBottom:12 }}>📥</div>
                        <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No revenue invoices yet</div>
                        <div style={{ fontSize:13, color:"#6B6B8A" }}>Upload invoices you've sent to customers — they'll appear here as outstanding receivables.</div>
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
                            <div key={inv.id} style={{ background:"#14141A", border:`1px solid ${isCollected?"#1E1E2E":isOverdue?"#EF444433":"#1E1E2E"}`, borderRadius:14, overflow:"hidden", opacity:isCollected?0.5:1 }}>
                              <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    {isCollected && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>✓ Collected</span>}
                                    {isOverdue && !isCollected && <span style={{ fontSize:11, background:"#EF444422", color:"#EF4444", borderRadius:20, padding:"2px 8px" }}>Overdue</span>}
                                    {inv.early_pay_discount && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>Early discount offered</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:"#9CA3AF" }}>{inv.description} · {inv.gl_name} · {inv.date}
                                    {inv.payment_terms && <span style={{ color:"#6B6B8A", marginLeft:8 }}>{inv.payment_terms}</span>}
                                  </div>
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(inv.amount)}</div>
                                  {daysUntilDue!==null && !isCollected && (
                                    <div style={{ fontSize:11, marginTop:3, color:daysUntilDue<0?"#EF4444":daysUntilDue<=7?"#F59E0B":"#6B6B8A" }}>
                                      {daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Due today":`Due in ${daysUntilDue}d`}
                                    </div>
                                  )}
                                  {inv.due_date && <div style={{ fontSize:10, color:"#6B6B8A" }}>{inv.due_date}</div>}
                                </div>
                              </div>
                              {!isCollected && (
                                <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"flex", gap:8 }}>
                                  <button onClick={()=>markCollected(inv.id)} style={{ padding:"6px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>✓ Mark Collected</button>
                                  <button style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }} onClick={()=>setArView("collections")}>Follow Up →</button>
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
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:16 }}>Overdue invoices sorted by amount — largest first.</div>
                    {collectionsQueue.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:32, textAlign:"center", color:"#6B6B8A", fontSize:13 }}>
                        ✓ No overdue invoices — all receivables are current.
                      </div>
                    ) : (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Customer","Invoice Date","Due Date","Days Overdue","Amount","Action"].map(h=>(
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {collectionsQueue.map((inv,i) => {
                              const daysOverdue = Math.floor((new Date(today)-new Date(inv.due_date))/86400000);
                              const urgencyColor = daysOverdue>90?"#7F1D1D":daysOverdue>60?"#EF4444":daysOverdue>30?"#F59E0B":"#C8B8FF";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"13px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:28,height:28,borderRadius:7,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                                        <div style={{ fontSize:11, color:"#6B6B8A" }}>{inv.description?.slice(0,35)}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding:"13px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date}</td>
                                  <td style={{ padding:"13px 16px", fontSize:12, color:"#EF4444" }}>{inv.due_date}</td>
                                  <td style={{ padding:"13px 16px" }}>
                                    <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:urgencyColor, fontWeight:600 }}>{daysOverdue}d</span>
                                  </td>
                                  <td style={{ padding:"13px 16px", fontSize:14, fontFamily:"'DM Mono',monospace", color:"#10B981", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"13px 16px" }}>
                                    <button onClick={()=>markCollected(inv.id)} style={{ padding:"5px 14px", borderRadius:8, fontSize:11, fontWeight:600, background:"#065F4622", border:"1px solid #10B98144", color:"#10B981", cursor:"pointer" }}>✓ Collected</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop:"2px solid #2A2A3E", background:"#0F0F13" }}>
                              <td colSpan={4} style={{ padding:"12px 16px", fontSize:13, fontWeight:600 }}>Total Overdue</td>
                              <td style={{ padding:"12px 16px", fontSize:15, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#EF4444" }}>{fmt(collectionsQueue.reduce((s,i)=>s+i.amount,0))}</td>
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
                        { label:"Current (0–30d)", bucket:aging.current, color:"#10B981" },
                        { label:"31–60 Days",      bucket:aging.d60,     color:"#F59E0B" },
                        { label:"61–90 Days",      bucket:aging.d90,     color:"#EF4444" },
                        { label:"90+ Days",        bucket:aging.d90plus, color:"#7F1D1D" },
                      ].map(({label,bucket,color})=>(
                        <div key={label} style={{ background:"#14141A", border:`1px solid ${color}33`, borderRadius:12, padding:"16px 18px" }}>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:8 }}>{label}</div>
                          <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmt(bucket.total)}</div>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{bucket.count} invoice{bucket.count!==1?"s":""}</div>
                          <div style={{ marginTop:10, height:3, background:"#1E1E2E", borderRadius:2 }}>
                            <div style={{ height:"100%", width:totalAR>0?`${Math.min(100,(bucket.total/totalAR)*100)}%`:"0%", background:color, borderRadius:2 }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI Commentary */}
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:arAgingNarration||arAgingLoading?16:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>✦ CFO Commentary</div>
                        <button onClick={handleArAging} disabled={arAgingLoading}
                          style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:arAgingLoading?"wait":"pointer" }}>
                          {arAgingLoading?"⟳ Analyzing...":"Generate Analysis"}
                        </button>
                      </div>
                      {arAgingLoading && <div style={{ display:"flex", gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#6B6B8A",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>}
                      {arAgingNarration && <div style={{ fontSize:13, color:"#C8C8D8", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{arAgingNarration}</div>}
                      {!arAgingNarration && !arAgingLoading && <div style={{ fontSize:13, color:"#6B6B8A" }}>Click Generate Analysis for AI commentary on your AR position and collection risk.</div>}
                    </div>

                    {/* Aging detail table */}
                    {arOpen.length>0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"14px 20px", borderBottom:"1px solid #1E1E2E", fontSize:13, fontWeight:600 }}>All Open Receivables</div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Customer","Invoice Date","Due Date","Age","Amount","Status"].map(h=>(
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...arOpen].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map((inv,i) => {
                              const ageDays = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
                              const ageColor = ageDays<=30?"#10B981":ageDays<=60?"#F59E0B":ageDays<=90?"#EF4444":"#7F1D1D";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"11px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:24,height:24,borderRadius:6,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date||"—"}</td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:inv.due_date&&inv.due_date<today?"#EF4444":"#9CA3AF" }}>{inv.due_date||"—"}</td>
                                  <td style={{ padding:"11px 16px" }}><span style={{ fontSize:12, color:ageColor, fontFamily:"'DM Mono',monospace" }}>{ageDays}d</span></td>
                                  <td style={{ padding:"11px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#10B981", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"11px 16px" }}>
                                    <span style={{ fontSize:11, background:inv.due_date&&inv.due_date<today?"#EF444422":"#10B98122", color:inv.due_date&&inv.due_date<today?"#EF4444":"#10B981", borderRadius:20, padding:"2px 9px" }}>
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
