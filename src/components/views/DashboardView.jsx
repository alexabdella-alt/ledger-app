import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";

export default function DashboardView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, glDrilldown, setGlDrilldown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
  const [burnModalOpen, setBurnModalOpen] = React.useState(false);
  const goReports = () => { setReportType && setReportType("pl"); setView("reports"); };
  const cardHover = (on) => (e) => { e.currentTarget.style.borderColor = on ? "#8B7BFF" : "#1C1C20"; e.currentTarget.style.transform = on ? "translateY(-2px)" : "none"; };
  return (
            <div>
              {/* ── UNIVERSAL UPLOAD ZONE ── */}
              <div
                onDragOver={e=>{e.preventDefault();setUniversalDragOver(true);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setUniversalDragOver(false);}}
                onDrop={e=>{e.preventDefault();setUniversalDragOver(false);handleUniversalUpload(e.dataTransfer.files);}}
                onClick={()=>document.getElementById("universal-upload").click()}
                style={{
                  border:`2px dashed ${universalDragOver?"#C7BFFF":"#262629"}`,
                  borderRadius:16, padding:"52px 32px", textAlign:"center", cursor:"pointer",
                  background:universalDragOver?"#18181C":"#141416", transition:"all 0.18s",
                  boxShadow:universalDragOver?"0 0 48px rgba(200,184,255,0.10)":"none",
                  marginBottom:20,
                }}>
                <input id="universal-upload" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleUniversalUpload(e.target.files)} />
                <div style={{ fontSize:28, marginBottom:12, opacity: universalDragOver ? 1 : 0.4, transition:"opacity 0.18s" }}>⬆</div>
                <div style={{ fontSize:15, fontWeight:500, color:universalDragOver?"#C7BFFF":"#9A9AA2", transition:"color 0.18s" }}>
                  {universalDragOver ? "Release to upload" : "Drop anything here, or click to browse"}
                </div>
              </div>

              {/* ── UPLOAD QUEUE ── */}
              {uploadQueue.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"#86868F", letterSpacing:2 }}>PROCESSING QUEUE</div>
                    {uploadQueue.every(q=>q.status==="done"||q.status==="error") && (
                      <button onClick={()=>setUploadQueue([])} style={{ background:"none", border:"none", color:"#86868F", fontSize:12, cursor:"pointer", padding:0 }}>Clear ×</button>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {uploadQueue.map(item => {
                      const typeConfig = {
                        invoice:       { icon:"🧾", label:"Invoice",         color:"#C7BFFF" },
                        bank_statement:{ icon:"🏦", label:"Bank Statement",  color:"#8B7BFF" },
                        contract:      { icon:"📋", label:"Contract",        color:"#F59E0B" },
                        unknown:       { icon:"❓", label:"Unknown",         color:"#EF4444" },
                      };
                      const tc = typeConfig[item.type] || { icon:"📄", label:"Document", color:"#86868F" };
                      const pendingReview = item.status==="done" && clarificationQueue.some(c => c.queueItemId === item.id);
                      return (
                        <div key={item.id} style={{ background:"#141416", border:`1px solid ${item.status==="error"?"#EF444433":pendingReview?"#F59E0B66":item.status==="done"?"#10B98133":"#1C1C20"}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                          {/* File icon */}
                          <div style={{ width:38, height:38, borderRadius:10, background:"#1C1C20", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                            {item.status==="done" ? tc.icon : item.status==="error" ? "⚠" : "📄"}
                          </div>
                          {/* Info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                            <div style={{ fontSize:11, marginTop:3, color:item.status==="error"?"#EF4444":item.status==="done"?tc.color:"#86868F" }}>
                              {item.status==="classifying" && "⟳ Identifying document type..."}
                              {item.status==="processing" && `⟳ Processing as ${tc.label}...`}
                              {item.status==="error" && item.error}
                              {item.status==="done" && item.type==="invoice" && item.result && (
                                item.result.invoiceCount > 1
                                  ? `✓ ${item.result.invoiceCount} invoices found · $${item.result.amount?.toLocaleString("en-US",{minimumFractionDigits:2})} total · ${item.result.confidence}% avg confidence`
                                  : `✓ ${item.result.vendor} · $${item.result.amount?.toLocaleString("en-US",{minimumFractionDigits:2})} → ${item.result.gl_name} (${item.result.confidence}%)`
                              )}
                              {item.status==="done" && item.type==="bank_statement" && item.result && `✓ ${tc.label} · ${item.result.txnCount} transactions · ${item.result.autoBooked} auto-booked${item.result.needsReview>0?` · ${item.result.needsReview} need review`:""}`}
                              {item.status==="done" && item.type==="contract" && item.result && `✓ ${tc.label} · ${item.result.counterparty} · ${item.result.entries} journal entries generated`}
                              {item.status==="done" && item.type==="unknown" && item.result && `⚠ ${item.result.document_type||"Unknown"} · ${item.result.entry_needed?"Entry proposed — needs review":"No entry needed — flagged for review"}`}
                            </div>
                          </div>
                          {/* Status pill */}
                          <div style={{ flexShrink:0 }}>
                            {(item.status==="classifying"||item.status==="processing") && (
                              <div style={{ display:"flex", gap:3 }}>
                                {[0,1,2].map(i=><div key={i} style={{ width:5, height:5, borderRadius:"50%", background:"#86868F", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                              </div>
                            )}
                            {item.status==="done" && pendingReview && (
                              <span onClick={()=>{ document.getElementById("clarification-section")?.scrollIntoView({behavior:"smooth"}); }}
                                style={{ fontSize:11, color:"#F59E0B", background:"#1A1200", border:"1px solid #F59E0B66", borderRadius:20, padding:"3px 10px", cursor:"pointer", fontWeight:600 }}>
                                ⚠ Needs Review
                              </span>
                            )}
                            {item.status==="done" && !pendingReview && <span style={{ fontSize:11, color:"#10B981", background:"#0A2A1A", border:"1px solid #10B98133", borderRadius:20, padding:"3px 10px" }}>Done</span>}
                            {item.status==="error" && <span style={{ fontSize:11, color:"#EF4444", background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:20, padding:"3px 10px" }}>Error</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Invoice clarification prompt */}
                  {clarificationQueue.length > 0 && (
                    <div style={{ marginTop:12, background:"#1A1200", border:"1px solid #F59E0B44", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#F59E0B" }}>⚠ {clarificationQueue.length} invoice{clarificationQueue.length!==1?"s":""} need your input before booking — scroll down to review</div>
                      <button onClick={()=>{ window.scrollTo({top:9999,behavior:"smooth"}); }} style={{ background:"#F59E0B22", border:"1px solid #F59E0B44", color:"#F59E0B", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Below ↓</button>
                    </div>
                  )}
                  {/* Bank review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="bank_statement"&&q.result?.needsReview>0) && (
                    <div style={{ marginTop:12, background:"#1A1200", border:"1px solid #F59E0B44", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#F59E0B" }}>⚠ Some bank transactions need your GL selection</div>
                      <button onClick={()=>setView("bank")} style={{ background:"#F59E0B22", border:"1px solid #F59E0B44", color:"#F59E0B", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Now →</button>
                    </div>
                  )}
                  {/* Contract review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="contract") && (
                    <div style={{ marginTop:8, background:"#0A1A2E", border:"1px solid #8B7BFF44", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#8B7BFF" }}>📋 Contract journal entries ready to post</div>
                      <button onClick={()=>{ setView("contracts"); setContractView("list"); }} style={{ background:"#8B7BFF22", border:"1px solid #8B7BFF44", color:"#8B7BFF", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Contracts →</button>
                    </div>
                  )}
                  {/* Unknown docs review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="unknown") && (
                    <div style={{ marginTop:8, background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#EF4444" }}>❓ Some documents need accountant review</div>
                      <button onClick={()=>setView("review")} style={{ background:"#EF444422", border:"1px solid #EF444433", color:"#EF4444", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Now →</button>
                    </div>
                  )}
                </div>
              )}

              {/* ── CLARIFICATION QUEUE ── */}
              {clarificationQueue.length > 0 && (
                <div id="clarification-section" style={{ marginBottom:24, background:"#1A1200", border:"2px solid #F59E0B", borderRadius:16, padding:20 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:16 }}>
                    <span style={{ fontSize:20 }}>⚠</span>
                    <div>
                      <div style={{ fontSize:15, fontWeight:700, color:"#F59E0B" }}>{clarificationQueue.length} Invoice{clarificationQueue.length>1?"s":""} Need Your Review</div>
                      <div style={{ fontSize:12, color:"#9A9AA2", marginTop:2 }}>These items cannot be booked until you review them. Click a category below to confirm or reject each one.</div>
                    </div>
                  </div>
                  {clarificationQueue.map(item => (
                    <div key={item.id} style={{ background: item.isDuplicate ? "#1A0808" : "#1A1400", border: `1px solid ${item.isDuplicate ? "#EF444444" : "#F59E0B44"}`, borderRadius:14, padding:20, marginBottom:12 }}>
                      {item.isDuplicate ? (
                        /* ── DUPLICATE WARNING CARD ── */
                        <>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                            <div>
                              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                                <span style={{ fontSize:16, lineHeight:1 }}>⚠</span>
                                <div style={{ fontSize:15, fontWeight:700, color:"#EF4444" }}>Possible Duplicate Invoice</div>
                              </div>
                              <div style={{ fontSize:13, color:"#9A9AA2", lineHeight:1.5 }}>{item.question}</div>
                            </div>
                            <div style={{ fontSize:11, color:"#EF4444", background:"#EF444422", borderRadius:20, padding:"3px 10px", flexShrink:0, marginLeft:12, whiteSpace:"nowrap" }}>
                              Duplicate
                            </div>
                          </div>
                          <div style={{ background:"#0C0C0E", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
                            <div style={{ fontSize:11, color:"#86868F", marginBottom:6, letterSpacing:1 }}>NEW — ABOUT TO BOOK:</div>
                            <div style={{ fontSize:13, color:"#F2F2F4" }}>
                              {item.invoice.vendor} · <span style={{ fontFamily:"'DM Mono',monospace" }}>${item.invoice.amount.toFixed(2)}</span> · {item.invoice.date}
                              {item.invoice.invoice_number && <span style={{ color:"#9A9AA2" }}> · #{item.invoice.invoice_number}</span>}
                            </div>
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={() => {
                              logAudit("invoice_rejected", `Rejected (duplicate): ${item.invoice.vendor} · $${(item.invoice.amount||0).toFixed(2)} on ${item.invoice.date} — already booked`, item.invoice, null);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification("Duplicate rejected ✓");
                            }} style={{ fontSize:12, padding:"7px 16px", borderRadius:8, background:"#3B0A0A", border:"1px solid #EF444466", color:"#FCA5A5", cursor:"pointer", fontWeight:600 }}>
                              ✕ Reject — already booked
                            </button>
                            <button onClick={() => {
                              const finalInv = {...item.invoice, confidence:100, status:"booked"};
                              logAudit("invoice_booked", `${finalInv.vendor} · $${(finalInv.amount||0).toFixed(2)} → ${finalInv.gl_name} (confirmed — different charge)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                              setInvoices(prev => [finalInv, ...prev]);
                              bookToDb(finalInv);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification(`Booked to ${item.invoice.gl_name} ✓`);
                            }} style={{ fontSize:12, padding:"7px 16px", borderRadius:8, background:"transparent", border:"1px solid #262629", color:"#9A9AA2", cursor:"pointer" }}>
                              Book anyway (different charge)
                            </button>
                          </div>
                        </>
                      ) : (
                        /* ── NORMAL GL CLARIFICATION CARD ── */
                        <>
                          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                            <div>
                              <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>{item.invoice.vendor} — ${item.invoice.amount.toFixed(2)}</div>
                              <div style={{ fontSize:13, color:"#9A9AA2" }}>{item.question}</div>
                            </div>
                            <div style={{ fontSize:11, color:"#F59E0B", background:"#F59E0B22", borderRadius:20, padding:"3px 10px", flexShrink:0, marginLeft:12 }}>
                              {Math.round(item.invoice.confidence)}% confident
                            </div>
                          </div>
                          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                            {item.options.map(opt => (
                              <button key={opt.code}
                                onClick={() => {
                                  const finalInv = {...item.invoice, gl_code: opt.code, gl_name: opt.name, confidence: 100, status:"booked", ...(opt.typeOverride || {})};
                                  logAudit("invoice_booked", `${finalInv.vendor} · $${(finalInv.amount||0).toFixed(2)} → ${opt.name} (user confirmed)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: opt.code, gl_name: opt.name });
                                  setInvoices(prev => [finalInv, ...prev]);
                                  bookToDb(finalInv);
                                  setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                                  showNotification(`Booked to ${opt.name} ✓`);
                                }}
                                style={{
                                  padding:"8px 16px", borderRadius:20, fontSize:12, cursor:"pointer",
                                  background: opt.code === item.suggestedCode ? "#372E8F" : "#1C1C20",
                                  border: `1px solid ${opt.code === item.suggestedCode ? "#8B7BFF" : "#262629"}`,
                                  color: opt.code === item.suggestedCode ? "#C7BFFF" : "#9A9AA2",
                                  fontWeight: opt.code === item.suggestedCode ? 600 : 400,
                                }}>
                                {opt.code === item.suggestedCode ? "★ " : ""}{opt.name}
                              </button>
                            ))}
                          </div>
                          <div style={{ display:"flex", gap:8 }}>
                            <button onClick={() => {
                              const finalInv = {...item.invoice, confidence:100, status:"booked"};
                              logAudit("invoice_booked", `${finalInv.vendor} · $${(finalInv.amount||0).toFixed(2)} → ${finalInv.gl_name} (user confirmed)`, null, { vendor: finalInv.vendor, amount: finalInv.amount, date: finalInv.date, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
                              setInvoices(prev => [finalInv, ...prev]);
                              bookToDb(finalInv);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification(`Booked to ${item.invoice.gl_name} ✓`);
                            }} style={{ fontSize:12, padding:"6px 14px", borderRadius:8, background:"#065F46", border:"1px solid #10B98144", color:"#6EE7B7", cursor:"pointer" }}>
                              ✓ Use suggested: {item.suggestedName}
                            </button>
                            <button onClick={() => {
                              logAudit("invoice_rejected", `Rejected: ${item.invoice.vendor} · $${(item.invoice.amount||0).toFixed(2)} on ${item.invoice.date} — not relevant or not approved`, item.invoice, null);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification("Invoice rejected ✓");
                            }} style={{ fontSize:12, padding:"6px 14px", borderRadius:8, background:"#2A0A0A", border:"1px solid #EF444433", color:"#FCA5A5", cursor:"pointer" }}>
                              ✕ Reject
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* ── BURN RATE & CASH COMMAND CENTER ── */}
              {(() => {
                const today = new Date();
                const currentMonth = today.toISOString().slice(0,7);
                const lastMonth = new Date(today.getFullYear(), today.getMonth()-1, 1).toISOString().slice(0,7);
                const twoMonthsAgo = new Date(today.getFullYear(), today.getMonth()-2, 1).toISOString().slice(0,7);
                const monthlyBurn = (m) => invoices.filter(i => glIsExpense(i.gl_code) && i.date?.startsWith(m)).reduce((s,i) => s+i.amount, 0);
                const burnThisMonth = monthlyBurn(currentMonth);
                const burnLastMonth = monthlyBurn(lastMonth);
                const burnTwoMonths = monthlyBurn(twoMonthsAgo);
                const avg3mo = [burnThisMonth, burnLastMonth, burnTwoMonths].filter(b=>b>0);
                const avgBurn = avg3mo.length>0 ? avg3mo.reduce((s,b)=>s+b,0)/avg3mo.length : 0;
                const revenueThisMonth = invoices.filter(i => glIsRevenue(i.gl_code) && i.date?.startsWith(currentMonth)).reduce((s,i)=>s+i.amount,0);
                const netBurn = burnThisMonth - revenueThisMonth;
                const openingCash = openingBalances.filter(b=>b.account_code==="1000"||b.account_code==="1010").reduce((s,b)=>s+(parseFloat(b.balance)||0),0);
                const cashInflows = invoices.filter(i=>glIsRevenue(i.gl_code)&&i.payment_status==="collected").reduce((s,i)=>s+i.amount,0);
                const cashOutflows = invoices.filter(i=>glIsExpense(i.gl_code)&&i.payment_status==="paid").reduce((s,i)=>s+i.amount,0);
                const estimatedCash = openingCash + cashInflows - cashOutflows;
                const runway = avgBurn>0 ? Math.floor(estimatedCash/avgBurn) : null;
                const runwayColor = runway===null?"#86868F":runway<=3?"#EF4444":runway<=6?"#F59E0B":"#10B981";
                const burnTrend = burnLastMonth>0 ? ((burnThisMonth-burnLastMonth)/burnLastMonth*100) : 0;
                const burnDrivers = Object.entries(invoices.filter(i=>glIsExpense(i.gl_code)&&i.date?.startsWith(currentMonth)).reduce((acc,i)=>{acc[i.gl_name]=(acc[i.gl_name]||0)+i.amount;return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,3);
                const ytdNet = invoices.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0) - invoices.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                const estimatedTax = Math.max(0, ytdNet*0.25);
                const m = today.getMonth();
                const nextQtr = m<3?"Apr 15":m<5?"Jun 15":m<8?"Sep 15":"Jan 15";
                return (
                  <div style={{marginBottom:24}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
                      <div onClick={()=>setBurnModalOpen(true)} title="View monthly burn breakdown"
                        onMouseEnter={cardHover(true)} onMouseLeave={e=>{e.currentTarget.style.borderColor="#EF444433";e.currentTarget.style.transform="none";}}
                        style={{background:"#1A0A0A",border:"1px solid #EF444433",borderRadius:14,padding:"20px 22px",cursor:"pointer",transition:"transform .16s, border-color .2s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontSize:10,color:"#EF4444",letterSpacing:2}}>MONTHLY BURN</div>
                          <span style={{fontSize:11,color:"#86868F"}}>›</span>
                        </div>
                        <div style={{fontSize:26,fontWeight:700,color:"#EF4444",fontFamily:"'DM Mono',monospace"}}>${burnThisMonth.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{fontSize:11,color:"#86868F",marginTop:6}}>
                          {Math.abs(burnTrend)>5 ? (burnTrend>0?<span style={{color:"#EF4444"}}>↑ {Math.abs(burnTrend).toFixed(0)}% vs last mo</span>:<span style={{color:"#10B981"}}>↓ {Math.abs(burnTrend).toFixed(0)}% vs last mo</span>) : "Stable vs last month"}
                        </div>
                      </div>
                      <div style={{background:"#0A0A0C",border:"1px solid #6D5EF633",borderRadius:14,padding:"20px 22px"}}>
                        <div style={{fontSize:10,color:"#A99CFF",letterSpacing:2,marginBottom:8}}>NET BURN</div>
                        <div style={{fontSize:26,fontWeight:700,color:netBurn>0?"#EF4444":"#10B981",fontFamily:"'DM Mono',monospace"}}>{netBurn>0?"-":"+"} ${Math.abs(netBurn).toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{fontSize:11,color:"#86868F",marginTop:6}}>{revenueThisMonth>0?`$${revenueThisMonth.toLocaleString("en-US",{maximumFractionDigits:0})} revenue offset`:"No revenue this month"}</div>
                      </div>
                      <div onClick={()=>setBurnModalOpen(true)} title="View runway & burn breakdown"
                        onMouseEnter={cardHover(true)} onMouseLeave={e=>{e.currentTarget.style.borderColor=`${runwayColor}33`;e.currentTarget.style.transform="none";}}
                        style={{background:runway!==null&&runway<=3?"#1A0A0A":runway!==null&&runway<=6?"#1A1200":"#0A1A0A",border:`1px solid ${runwayColor}33`,borderRadius:14,padding:"20px 22px",cursor:"pointer",transition:"transform .16s, border-color .2s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                          <div style={{fontSize:10,color:runwayColor,letterSpacing:2}}>RUNWAY</div>
                          <span style={{fontSize:11,color:"#86868F"}}>›</span>
                        </div>
                        <div style={{fontSize:26,fontWeight:700,color:runwayColor,fontFamily:"'DM Mono',monospace"}}>{runway===null?"∞":`${runway}mo`}</div>
                        <div style={{fontSize:11,color:"#86868F",marginTop:6}}>{runway===null?"Set cash balance for runway":runway<=3?"⚠ Critical — act now":runway<=6?"Watch closely":"Healthy"}</div>
                      </div>
                      <div style={{background:"#0A1400",border:"1px solid #10B98133",borderRadius:14,padding:"20px 22px"}}>
                        <div style={{fontSize:10,color:"#10B981",letterSpacing:2,marginBottom:8}}>EST. TAX DUE</div>
                        <div style={{fontSize:26,fontWeight:700,color:"#10B981",fontFamily:"'DM Mono',monospace"}}>${estimatedTax.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{fontSize:11,color:"#86868F",marginTop:6}}>Next: {nextQtr} · ~25% of net income</div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:14,padding:"18px 20px"}}>
                        <div style={{fontSize:10,color:"#86868F",letterSpacing:2,marginBottom:14}}>TOP BURN DRIVERS THIS MONTH</div>
                        {burnDrivers.length===0 ? <div style={{fontSize:13,color:"#86868F"}}>No expenses this month yet</div> :
                          burnDrivers.map(([name,amt])=>(
                            <div key={name} style={{marginBottom:12}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                                <div style={{fontSize:13,color:"#F2F2F4"}}>{name}</div>
                                <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:"#EF4444"}}>${amt.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                              </div>
                              <div style={{height:3,background:"#1C1C20",borderRadius:2}}>
                                <div style={{height:"100%",width:`${Math.min(100,burnThisMonth>0?amt/burnThisMonth*100:0)}%`,background:"linear-gradient(90deg,#EF4444,#F59E0B)",borderRadius:2}} />
                              </div>
                            </div>
                          ))
                        }
                      </div>
                      <div onClick={()=>setView("settings")} title="Manage bank accounts in Settings"
                        onMouseEnter={cardHover(true)} onMouseLeave={cardHover(false)}
                        style={{background:"#141416",border:"1px solid #1C1C20",borderRadius:14,padding:"18px 20px",cursor:"pointer",transition:"transform .16s, border-color .2s"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <div style={{fontSize:10,color:"#86868F",letterSpacing:2}}>CASH POSITION</div>
                          <span style={{fontSize:11,color:"#86868F"}}>Bank accounts ›</span>
                        </div>
                        <div style={{fontSize:32,fontWeight:700,color:estimatedCash>=0?"#F2F2F4":"#EF4444",fontFamily:"'DM Mono',monospace",marginBottom:12}}>${estimatedCash.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{display:"flex",gap:20}}>
                          <div><div style={{fontSize:10,color:"#86868F",marginBottom:2}}>COLLECTED</div><div style={{fontSize:13,color:"#10B981",fontFamily:"'DM Mono',monospace"}}>+${cashInflows.toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
                          <div><div style={{fontSize:10,color:"#86868F",marginBottom:2}}>PAID OUT</div><div style={{fontSize:13,color:"#EF4444",fontFamily:"'DM Mono',monospace"}}>-${cashOutflows.toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
                          <div><div style={{fontSize:10,color:"#86868F",marginBottom:2}}>AVG BURN/MO</div><div style={{fontSize:13,color:"#F59E0B",fontFamily:"'DM Mono',monospace"}}>${avgBurn.toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
                        </div>
                        {openingCash===0&&<button onClick={(e)=>{e.stopPropagation();setView("opening-balances");}} style={{marginTop:12,background:"none",border:"1px solid #262629",borderRadius:8,padding:"6px 12px",color:"#C7BFFF",fontSize:11,cursor:"pointer"}}>+ Add opening cash balance →</button>}
                      </div>
                    </div>

                    {/* ── BURN BREAKDOWN MODAL ── */}
                    {burnModalOpen && (() => {
                      const months = Array.from({length:6}, (_,k) => {
                        const dd = new Date(today.getFullYear(), today.getMonth()-k, 1);
                        const key = dd.toISOString().slice(0,7);
                        const exp = monthlyBurn(key);
                        const rev = invoices.filter(i=>glIsRevenue(i.gl_code)&&i.date?.startsWith(key)).reduce((s,i)=>s+i.amount,0);
                        return { key, label: dd.toLocaleDateString("en-US",{month:"short",year:"2-digit"}), exp, rev, net: rev-exp };
                      });
                      const maxExp = Math.max(1, ...months.map(mm=>mm.exp));
                      return (
                        <div onClick={()=>setBurnModalOpen(false)} style={{position:"fixed",inset:0,zIndex:10001,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
                          <div className="sc-scale" onClick={e=>e.stopPropagation()} style={{width:560,maxWidth:"94vw",maxHeight:"86vh",overflowY:"auto",background:"#141416",border:"1px solid #262629",borderRadius:18,padding:26,boxShadow:"0 24px 80px rgba(0,0,0,0.6)"}}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                              <div>
                                <div style={{fontSize:10,letterSpacing:2,color:"#86868F",marginBottom:6}}>CASH BURN</div>
                                <h2 style={{fontSize:20,fontWeight:600,margin:0}}>Monthly burn &amp; runway</h2>
                              </div>
                              <button onClick={()=>setBurnModalOpen(false)} style={{background:"none",border:"none",color:"#86868F",fontSize:24,cursor:"pointer",lineHeight:1,padding:0}}>×</button>
                            </div>
                            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:22}}>
                              {[["AVG BURN/MO",`$${avgBurn.toLocaleString("en-US",{maximumFractionDigits:0})}`,"#F59E0B"],["RUNWAY",runway===null?"∞":`${runway} mo`,runwayColor],["EST. CASH",`$${estimatedCash.toLocaleString("en-US",{maximumFractionDigits:0})}`,estimatedCash>=0?"#10B981":"#EF4444"]].map(([l,v,c])=>(
                                <div key={l} style={{background:"#0C0C0E",border:"1px solid #1C1C20",borderRadius:12,padding:"14px 16px"}}>
                                  <div style={{fontSize:10,color:"#86868F",letterSpacing:1,marginBottom:6}}>{l}</div>
                                  <div style={{fontSize:18,fontWeight:700,color:c,fontFamily:"'DM Mono',monospace"}}>{v}</div>
                                </div>
                              ))}
                            </div>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                              <div style={{fontSize:10,letterSpacing:2,color:"#86868F"}}>LAST 6 MONTHS</div>
                              <div style={{fontSize:10,color:"#86868F",display:"flex",gap:12}}><span style={{color:"#EF4444"}}>● expense</span><span style={{color:"#10B981"}}>● revenue</span><span>● net</span></div>
                            </div>
                            {months.map(mo=>(
                              <div key={mo.key} style={{marginBottom:14}}>
                                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:5,fontSize:12}}>
                                  <span style={{color:"#D2D2D6",fontWeight:500,width:64}}>{mo.label}</span>
                                  <span style={{display:"flex",gap:16,fontFamily:"'DM Mono',monospace"}}>
                                    <span style={{color:"#EF4444"}}>-${mo.exp.toLocaleString("en-US",{maximumFractionDigits:0})}</span>
                                    <span style={{color:"#10B981"}}>+${mo.rev.toLocaleString("en-US",{maximumFractionDigits:0})}</span>
                                    <span style={{color:mo.net>=0?"#10B981":"#EF4444",width:96,textAlign:"right"}}>{mo.net>=0?"+":"-"}${Math.abs(mo.net).toLocaleString("en-US",{maximumFractionDigits:0})}</span>
                                  </span>
                                </div>
                                <div style={{height:6,background:"#1C1C20",borderRadius:3,overflow:"hidden"}}>
                                  <div style={{height:"100%",width:`${Math.min(100,mo.exp/maxExp*100)}%`,background:"linear-gradient(90deg,#EF4444,#F59E0B)",borderRadius:3}} />
                                </div>
                              </div>
                            ))}
                            <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginTop:18}}>
                              <button onClick={()=>{setBurnModalOpen(false);setView("reports");}} style={{padding:"8px 16px",borderRadius:9,background:"#1C1C20",border:"1px solid #262629",color:"#C7BFFF",fontSize:12,cursor:"pointer"}}>Open full reports →</button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:16, marginBottom:24 }}>
                {[
                  { label:"Total Revenue", value:totalRevenue, color:"#10B981" },
                  { label:"Total Expenses", value:totalExpenses, color:"#EF4444" },
                  { label:"Net Income", value:netIncome, color:netIncome>=0?"#10B981":"#EF4444" },
                ].map(card => (
                  <div key={card.label} onClick={goReports} title="Open the P&L report"
                    onMouseEnter={cardHover(true)} onMouseLeave={cardHover(false)}
                    style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:"22px 26px", cursor:"pointer", transition:"transform .16s, border-color .2s" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                      <div style={{ fontSize:11, color:"#86868F", letterSpacing:1 }}>{card.label.toUpperCase()}</div>
                      <span style={{ fontSize:11, color:"#86868F" }}>P&amp;L ›</span>
                    </div>
                    <div style={{ fontSize:28, fontWeight:600, color:card.color, fontFamily:"'DM Mono', monospace" }}>
                      {netIncome<0&&card.label==="Net Income"?"-":""}${Math.abs(card.value).toLocaleString("en-US",{minimumFractionDigits:2})}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
                <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:24 }}>
                  <div style={{ fontSize:11, color:"#86868F", marginBottom:18, letterSpacing:1 }}>GL ACCOUNT BREAKDOWN</div>
                  {Object.keys(glBreakdown).length===0 ? <div style={{ color:"#86868F", fontSize:13 }}>No transactions yet.</div> :
                    Object.entries(glBreakdown).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,amt])=>(
                      <div key={name} onClick={()=>setGlDrilldown(name)} title="View transactions in this account" style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:11, padding:"4px 8px", margin:"0 -8px 7px", borderRadius:8, cursor:"pointer" }}
                        onMouseEnter={e=>e.currentTarget.style.background="#1C1C20"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                        <div style={{ fontSize:13, color:"#D2D2D6" }}>{name}</div>
                        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                          <div style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#C7BFFF" }}>${amt.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                          <span style={{ fontSize:12, color:"#86868F" }}>›</span>
                        </div>
                      </div>
                    ))
                  }
                </div>
                <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:24 }}>
                  <div style={{ fontSize:11, color:"#86868F", marginBottom:18, letterSpacing:1 }}>TOP VENDORS BY SPEND</div>
                  {vendorSummary.length===0 ? <div style={{ color:"#86868F", fontSize:13 }}>No vendors yet.</div> :
                    vendorSummary.slice(0,5).map(v=>(
                      <div key={v.name} onClick={()=>{ setVendorFilter(v.name); setView("invoices"); }} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, cursor:"pointer" }}>
                        <div style={{ width:30, height:30, borderRadius:8, background:vendorColor(v.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(v.name)}</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{v.name}</div>
                          <div style={{ fontSize:11, color:"#86868F" }}>{v.count} invoice{v.count!==1?"s":""}</div>
                        </div>
                        <div style={{ fontSize:13, fontFamily:"'DM Mono', monospace", flexShrink:0 }}>${v.total.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                      </div>
                    ))
                  }
                  {vendorSummary.length>0 && <button onClick={()=>setView("vendors")} style={{ background:"none", border:"none", color:"#C7BFFF", fontSize:12, cursor:"pointer", padding:0, marginTop:4 }}>View all →</button>}
                </div>
              </div>
              <div style={{ background:"#141416", border:"1px solid #1C1C20", borderRadius:14, padding:24 }}>
                <div style={{ fontSize:11, color:"#86868F", marginBottom:18, letterSpacing:1 }}>RECENT ACTIVITY</div>
                {invoices.length===0 ? (
                  <div style={{ color:"#86868F", fontSize:14, textAlign:"center", padding:"20px 0" }}>No transactions yet — drop files above to get started</div>
                ) : invoices.slice(0,8).map(inv=>(
                  <div key={inv.id} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #1C1C20", cursor:"pointer" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:32, height:32, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                        <div style={{ fontSize:11, color:"#86868F" }}>
                          {inv.gl_name} · {inv.project||"General"} · {inv.date}
                          {inv.source==="universal_upload"&&<span style={{ color:"#C7BFFF", marginLeft:6 }}>⬆</span>}
                          {inv.source==="bank_feed"&&<span style={{ color:"#8B7BFF", marginLeft:6 }}>🏦</span>}
                          {inv.source==="contract"&&<span style={{ color:"#F59E0B", marginLeft:6 }}>📋</span>}
                          {inv.source==="matching_engine"&&<span style={{ color:"#10B981", marginLeft:6 }}>⇋</span>}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:inv.type==="revenue"?"#10B981":"#EF4444" }}>
                      {inv.type==="revenue"?"+":"-"}${inv.amount.toLocaleString("en-US",{minimumFractionDigits:2})}
                    </div>
                  </div>
                ))}
              </div>

              {/* ── GL ACCOUNT DRILL-DOWN PANEL ── */}
              {glDrilldown && (() => {
                const rows = invoices
                  .filter(inv => glPLType(inv.gl_code) && (inv.gl_name||"Uncoded")===glDrilldown)
                  .sort((a,b)=>(b.date||"").localeCompare(a.date||""));
                const total = rows.reduce((s,i)=>s+i.amount,0);
                const isRev = rows.length>0 && glIsRevenue(rows[0].gl_code);
                return (
                  <div onClick={()=>setGlDrilldown(null)} style={{ position:"fixed", inset:0, zIndex:10001, background:"rgba(0,0,0,0.6)", display:"flex", justifyContent:"flex-end" }}>
                    <style>{`@keyframes slideinright{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
                    <div onClick={e=>e.stopPropagation()} style={{ width:540, maxWidth:"92vw", height:"100%", background:"#141416", borderLeft:"1px solid #262629", display:"flex", flexDirection:"column", animation:"slideinright 0.25s cubic-bezier(0.22,1,0.36,1)", boxShadow:"-24px 0 80px rgba(0,0,0,0.5)" }}>
                      <div style={{ padding:"22px 24px", borderBottom:"1px solid #1C1C20", flexShrink:0 }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:12 }}>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:10, letterSpacing:2, color:"#86868F", marginBottom:6 }}>{isRev?"REVENUE ACCOUNT":"EXPENSE ACCOUNT"}</div>
                            <h2 style={{ fontSize:20, fontWeight:600, margin:0 }}>{glDrilldown}</h2>
                            <div style={{ fontSize:13, color:"#86868F", marginTop:6 }}>{rows.length} transaction{rows.length!==1?"s":""}</div>
                          </div>
                          <button onClick={()=>setGlDrilldown(null)} style={{ background:"none", border:"none", color:"#86868F", fontSize:26, cursor:"pointer", lineHeight:1, padding:0, flexShrink:0 }}>×</button>
                        </div>
                        <div style={{ marginTop:16, padding:"12px 16px", background:"#0C0C0E", borderRadius:10, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                          <span style={{ fontSize:12, color:"#86868F", letterSpacing:1 }}>TOTAL</span>
                          <span style={{ fontSize:18, fontWeight:600, fontFamily:"'DM Mono', monospace", color:isRev?"#10B981":"#C7BFFF" }}>${total.toLocaleString("en-US",{minimumFractionDigits:2})}</span>
                        </div>
                      </div>
                      <div style={{ flex:1, overflowY:"auto", padding:"8px 16px 24px" }}>
                        {rows.length===0 ? <div style={{ color:"#86868F", fontSize:13, padding:"24px 8px" }}>No transactions in this account.</div> :
                          rows.map(inv=>(
                            <div key={inv.id} style={{ padding:"14px 8px", borderBottom:"1px solid #1C1C20" }}>
                              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:10, minWidth:0 }}>
                                  <div style={{ width:30, height:30, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                  <div style={{ minWidth:0 }}>
                                    <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{inv.vendor}</div>
                                    <div style={{ fontSize:11, color:"#86868F" }}>{inv.date}</div>
                                  </div>
                                </div>
                                <div style={{ fontSize:13, fontFamily:"'DM Mono', monospace", flexShrink:0, color:isRev?"#10B981":"#F2F2F4" }}>${inv.amount.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                              </div>
                              {inv.description && <div style={{ fontSize:12, color:"#9A9AA2", marginTop:6, marginLeft:40, lineHeight:1.5 }}>{inv.description}</div>}
                              <div style={{ marginLeft:40, marginTop:6 }}>
                                <button onClick={()=>{ setSelectedInvoice(inv); setGlDrilldown(null); setView("detail"); }} style={{ background:"none", border:"none", color:"#C7BFFF", fontSize:12, cursor:"pointer", padding:0 }}>View full entry →</button>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
  );
}
