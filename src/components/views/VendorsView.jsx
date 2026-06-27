import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import TransactionDetailPanel from "../TransactionDetailPanel";

export default function VendorsView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view } = useERP();
            const [vendorSearch, setVendorSearch] = React.useState("");
            const [vSel, setVSel] = React.useState(null); // selected transaction id for the slide-in
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const selectedContact = vendorsSelectedContact; const setSelectedContact = setVendorsSelectedContact;
            const editingId = vendorsEditingId; const setEditingId = setVendorsEditingId; const editDraft = vendorsEditDraft; const setEditDraft = setVendorsEditDraft;
            const yr = new Date().getFullYear();
            const txnsForVendor = name => invoices
              .filter(i => i.vendor?.toLowerCase()===(name||"").toLowerCase() && (glIsExpense(i.gl_code)||i.type==="expense") && i.status!=="voided")
              .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
            const paidYTDfor = txns => txns.filter(i=>i.payment_status==="paid" && String(i.date||"").startsWith(String(yr))).reduce((s,i)=>s+(i.amount||0),0);
            const openAPfor = txns => txns.filter(i=>i.payment_status!=="paid").reduce((s,i)=>s+(i.amount||0),0);
            const status1099 = v => v.is_1099_exempt ? {label:"1099 exempt", color:"var(--sc-text-2)"} : v.is1099 ? {label:"1099 required", color:"var(--sc-warning)"} : {label:"Not flagged", color:"var(--sc-text-mut)"};

            // ── VENDOR DETAIL DRILL ──
            if (selectedContact) {
              const v = selectedContact;
              const vTxns = txnsForVendor(v.name);
              const paidYTD = paidYTDfor(vTxns);
              const openAP = openAPfor(vTxns);
              const lastDate = vTxns[0]?.date || "—";
              const payHistory = vTxns.filter(i=>i.payment_status==="paid");
              const st = status1099(v);
              const infoRows = [
                ["Email", v.email], ["Phone", v.phone], ["Website", v.website],
                ["Mailing address", v.mailing_address], ["Payment terms", v.payment_terms],
                ["Tax ID / EIN", v.tax_id || v.ein || v.ein_ssn], ["Account #", v.vendor_account_number],
              ].filter(([,val])=>val);
              return (
                <div>
                  <button onClick={()=>setSelectedContact(null)} style={{ background:"transparent", border:"none", color:"var(--sc-gold)", cursor:"pointer", fontSize:13, padding:0, marginBottom:16 }}>← All vendors</button>
                  <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:20 }}>
                    <div style={{ width:52,height:52,borderRadius:14,background:vendorColor(v.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,fontWeight:700,color:"var(--sc-on-accent)",flexShrink:0 }}>{initials(v.name)}</div>
                    <div>
                      <h1 style={{ fontSize:26, fontWeight:600, margin:0, letterSpacing:-0.5 }}>{v.name}</h1>
                      <div style={{ display:"flex", gap:8, marginTop:6, alignItems:"center" }}>
                        <span style={{ fontSize:11, fontWeight:600, color:st.color, background:st.color+"18", border:`1px solid ${st.color}44`, borderRadius:20, padding:"3px 10px" }}>{st.label}</span>
                        {v.fromContact && <span onClick={()=>{ setContacts(prev=>prev.map(c=>c.id===v.id?{...c,is1099:!c.is1099}:c)); setSelectedContact(s=>({...s,is1099:!s.is1099})); logAudit("1099_flagged",`${v.name} 1099 flag toggled`); }} style={{ fontSize:11, color:"var(--sc-gold)", cursor:"pointer", border:"1px solid var(--sc-gold-soft)", borderRadius:20, padding:"3px 10px" }}>{v.is1099?"Unflag 1099":"Flag for 1099"}</span>}
                      </div>
                    </div>
                  </div>

                  {/* Stat cards */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12, marginBottom:20 }}>
                    {[["Paid YTD", fmt(paidYTD), "var(--sc-error)"],["Open payables", fmt(openAP), openAP>0?"var(--sc-warning)":"var(--sc-success)"],["Last transaction", lastDate, "var(--sc-text)"]].map(([k,val,col])=>(
                      <div key={k} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:12, padding:"14px 16px" }}>
                        <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:5 }}>{k}</div>
                        <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:col }}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Contact info */}
                  <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:"16px 20px", marginBottom:20 }}>
                    <div style={{ fontSize:11, letterSpacing:1, color:"var(--sc-gold)", fontWeight:600, marginBottom:12 }}>CONTACT INFO</div>
                    {infoRows.length===0 ? <div style={{ fontSize:13, color:"var(--sc-text-mut)" }}>No contact details captured yet — they fill in automatically from uploaded invoices.</div> : (
                      <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:"10px 24px" }}>
                        {infoRows.map(([k,val])=>(
                          <div key={k} style={{ display:"flex", justifyContent:"space-between", gap:12, fontSize:13, borderBottom:"1px solid var(--sc-surface-2)", paddingBottom:6 }}>
                            <span style={{ color:"var(--sc-text-2)" }}>{k}</span><span style={{ color:"var(--sc-text)", textAlign:"right", wordBreak:"break-word" }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Transactions */}
                  <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"clip", marginBottom:20 }}>
                    <div style={{ padding:"14px 18px", fontSize:13, fontWeight:600, borderBottom:"1px solid var(--sc-surface-2)" }}>All transactions ({vTxns.length})</div>
                    {vTxns.length===0 ? <div style={{ padding:32, textAlign:"center", color:"var(--sc-text-mut)", fontSize:13 }}>No transactions with this vendor yet.</div> : (
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead><tr style={{ background:"var(--sc-bg)" }}>{["Date","Description","GL Account","Status","Amount"].map((h,i)=><th key={i} style={{ padding:"9px 16px", textAlign:i===4?"right":"left", fontSize:10, color:"var(--sc-text-2)", letterSpacing:1, fontWeight:600, borderBottom:"1px solid var(--sc-border)" }}>{h.toUpperCase()}</th>)}</tr></thead>
                        <tbody>
                          {vTxns.map((i,idx)=>(
                            <tr key={i.id||idx} onClick={()=>setVSel(i.id)}
                              onMouseEnter={e=>e.currentTarget.style.background="#F9FAFB"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}
                              style={{ borderBottom:"1px solid var(--sc-surface-2)", cursor:"pointer" }}>
                              <td style={{ padding:"9px 16px", fontSize:12, color:"var(--sc-text-2)", whiteSpace:"nowrap" }}>{fmtDate(i.date)}</td>
                              <td style={{ padding:"9px 16px", fontSize:13 }}>{i.description||"—"}</td>
                              <td style={{ padding:"9px 16px", fontSize:12, color:"var(--sc-text-2)" }}>{i.gl_code} {i.gl_name}</td>
                              <td style={{ padding:"9px 16px", fontSize:11 }}><span style={{ color:i.payment_status==="paid"?"var(--sc-success)":"var(--sc-warning)" }}>{i.payment_status==="paid"?"Paid":"Open"}</span></td>
                              <td style={{ padding:"9px 16px", fontSize:13, fontWeight:600, fontFamily:"'DM Mono',monospace", textAlign:"right" }}>{fmt(i.amount)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {/* Payment history */}
                  <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"hidden" }}>
                    <div style={{ padding:"14px 18px", fontSize:13, fontWeight:600, borderBottom:"1px solid var(--sc-surface-2)" }}>Payment history ({payHistory.length})</div>
                    {payHistory.length===0 ? <div style={{ padding:32, textAlign:"center", color:"var(--sc-text-mut)", fontSize:13 }}>No payments recorded yet.</div> : payHistory.map((i,idx)=>(
                      <div key={i.id||idx} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"11px 18px", borderBottom:"1px solid var(--sc-surface-2)", fontSize:13 }}>
                        <div><span style={{ fontWeight:500 }}>{fmt(i.amount)}</span> <span style={{ color:"var(--sc-text-2)" }}>· {i.description||"payment"}</span></div>
                        <div style={{ fontSize:12, color:"var(--sc-text-2)" }}>{i.payment_method_used==="bank_transfer"?"Bank transfer":i.payment_method_used||"paid"}{i.paid_at?` · ${fmtDate(i.paid_at)}`:i.matched_bank_date?` · ${fmtDate(i.matched_bank_date)}`:""}</div>
                      </div>
                    ))}
                  </div>

                  <TransactionDetailPanel invoiceId={vSel} onClose={()=>setVSel(null)} returnContext={{ view:"vendors", label:v.name, contact:v }} />
                </div>
              );
            }

            // Merge ledger-derived vendors with contact book
            const ledgerVendors = vendorSummary.filter(v => glIsExpense(
              invoices.filter(i=>i.vendor?.toLowerCase()===v.name?.toLowerCase())[0]?.gl_code||"5000"
            ) || invoices.filter(i=>i.vendor?.toLowerCase()===v.name?.toLowerCase())[0]?.type==="expense");

            // Build unified vendor list: contacts take priority, ledger fills in the rest
            const contactVendors = contacts.filter(c => c.type==="vendor");
            const ledgerOnlyVendors = vendorSummary.filter(v =>
              !contactVendors.find(c => c.name?.toLowerCase()===v.name?.toLowerCase())
            );

            const allVendors = [
              ...contactVendors.map(c => ({
                ...c,
                fromContact: true,
                ledger: vendorSummary.find(v => v.name?.toLowerCase()===c.name?.toLowerCase()),
              })),
              ...ledgerOnlyVendors.map(v => ({
                id: v.name, name: v.name, type:"vendor", fromContact: false, ledger: v,
                gl_code: rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase())?.gl_code,
                gl_name: rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase())?.gl_name,
              })),
            ];

            // Real-time search across name, email, phone, website, notes, tags (case-insensitive, partial)
            const vq = vendorSearch.trim().toLowerCase();
            const filteredVendors = !vq ? allVendors : allVendors.filter(v => {
              const hay = [v.name, v.email, v.phone, v.website, v.notes, ...(v.tags||[])]
                .filter(Boolean).join(" ").toLowerCase();
              return hay.includes(vq);
            });

            const startEdit = (v) => {
              setEditingId(v.id||v.name);
              setEditDraft({ payment_terms:v.payment_terms||"", email:v.email||"", phone:v.phone||"", website:v.website||"", payment_url:v.payment_url||"", notes:v.notes||"", tags:(v.tags||[]).join(", "), min_expected:v.min_expected||"", max_expected:v.max_expected||"" });
            };
            const saveEdit = (v) => {
              if (editDraft.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(editDraft.email).trim())) { showNotification("Please enter a valid email address.","error"); return; }
              const draft = { ...editDraft, tags: editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null };
              if (v.fromContact) {
                const updated = { ...v, ...draft };
                setContacts(prev => prev.map(c => c.id===v.id ? updated : c));
                persistContact(updated);
              } else {
                const newC = { id:Date.now()+Math.random(), name:v.name, type:"vendor", ...draft, created_at:new Date().toISOString() };
                setContacts(prev => [newC, ...prev]);
                persistContact(newC);
              }
              setEditingId(null);
            };

            return (
              <div>
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>VENDOR MANAGEMENT</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Vendors</h1>
                    <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Or just tell the AI chat — "Add Johnson Electric as a vendor, Net 30, around $2k/month"</div>
                  </div>
                  <button onClick={()=>{ setChatOpen(true); }} style={{ padding:"9px 18px", borderRadius:10, fontSize:13, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>+ Add via Chat</button>
                </div>

                {allVendors.length===0 ? (
                  <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>◈</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No vendors yet</div>
                    <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:20 }}>Vendors appear automatically when you upload invoices, or tell the AI chat to add one.</div>
                    <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                  </div>
                ) : (
                  <>
                    {/* Search bar */}
                    <div style={{ marginBottom:16 }}>
                      <div style={{ position:"relative", maxWidth:480 }}>
                        <span style={{ position:"absolute", left:14, top:"50%", transform:"translateY(-50%)", color:"var(--sc-text-mut)", pointerEvents:"none", display:"flex" }}>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                        </span>
                        <input value={vendorSearch} onChange={e=>setVendorSearch(e.target.value)} placeholder="Search vendors by name, email, phone, tag…"
                          style={{ width:"100%", height:40, boxSizing:"border-box", background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"0 38px 0 40px", fontSize:14, color:"var(--sc-text)", outline:"none" }} />
                        {vendorSearch && (
                          <button onClick={()=>setVendorSearch("")} aria-label="Clear search"
                            style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", width:22, height:22, borderRadius:6, background:"var(--sc-surface-2)", border:"none", color:"var(--sc-text-2)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, lineHeight:1 }}>×</button>
                        )}
                      </div>
                      <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:8 }}>Showing {filteredVendors.length} of {allVendors.length} vendor{allVendors.length!==1?"s":""}</div>
                    </div>

                    {filteredVendors.length===0 ? (
                      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:40, textAlign:"center" }}>
                        <div style={{ fontSize:28, marginBottom:10 }}>🔍</div>
                        <div style={{ fontSize:15, fontWeight:500, marginBottom:6 }}>No vendors match “{vendorSearch}”</div>
                        <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:18 }}>Try a shorter or different term — search covers name, email, phone, website, notes, and tags.</div>
                        <button onClick={()=>setVendorSearch("")} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", borderRadius:8, height:36, padding:"0 16px", fontSize:14, fontWeight:500, cursor:"pointer" }}>Clear search</button>
                      </div>
                    ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {filteredVendors.map(v => {
                      const isEditing = editingId===(v.id||v.name);
                      const vTxns = txnsForVendor(v.name);
                      const openAP = openAPfor(vTxns);
                      const paidYTD = paidYTDfor(vTxns);
                      const lastDate = vTxns[0]?.date || v.ledger?.lastDate || null;
                      const rule = rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase());
                      return (
                        <div key={v.id||v.name} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, overflow:"hidden" }}>
                          {/* Header row */}
                          <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                            <div onClick={()=>setSelectedContact(v)} style={{ width:44,height:44,borderRadius:12,background:vendorColor(v.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"var(--sc-on-accent)",flexShrink:0, cursor:"pointer" }}>{initials(v.name)}</div>
                            <div onClick={()=>setSelectedContact(v)} style={{ flex:1, minWidth:0, cursor:"pointer" }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ fontSize:15, fontWeight:600 }}>{v.name}</span>
                                {v.fromContact && <span style={{ fontSize:10, background:"var(--sc-surface-2)", color:"var(--sc-gold)", borderRadius:20, padding:"2px 7px" }}>Contact</span>}
                                {rule && <span style={{ fontSize:10, background:"var(--sc-surface-2)", color:"var(--sc-gold)", borderRadius:20, padding:"2px 7px" }}>⚡ {rule.gl_name}</span>}
                                {v.fromContact && <span onClick={e=>{e.stopPropagation();setContacts(prev=>prev.map(c=>c.id===v.id?{...c,is1099:!c.is1099}:c));logAudit("1099_flagged",`${v.name} 1099 flag toggled`);}} style={{ fontSize:10, background:v.is1099?"var(--sc-warning-soft)":"var(--sc-border)", color:v.is1099?"var(--sc-warning)":"var(--sc-text-2)", borderRadius:20, padding:"2px 7px", cursor:"pointer", border:`1px solid ${v.is1099?"var(--sc-warning-soft)":"var(--sc-border-2)"}` }}>{v.is1099?"1099 ✓":"+ 1099"}</span>}
                                {v.payment_terms && <span style={{ fontSize:10, background:"var(--sc-surface-2)", color:"var(--sc-text-2)", borderRadius:20, padding:"2px 7px", border:"1px solid var(--sc-border-2)" }}>{v.payment_terms}</span>}
                                {(v.tags||[]).map(t=><span key={t} style={{ fontSize:10, background:"var(--sc-border)", color:"var(--sc-text-2)", borderRadius:20, padding:"2px 7px" }}>{t}</span>)}
                              </div>
                              <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:3 }}>
                                {vTxns.length>0 ? `${vTxns.length} transaction${vTxns.length!==1?"s":""}${lastDate?` · last ${fmtDate(lastDate)}`:""}` : "No transactions yet"}
                                {v.email && <span style={{ marginLeft:10 }}>✉ {v.email}</span>}
                                {v.phone && <span style={{ marginLeft:10 }}>📞 {v.phone}</span>}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                              {paidYTD>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>PAID YTD</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"var(--sc-error)" }}>{fmt(paidYTD)}</div>
                              </div>}
                              {openAP>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"var(--sc-text-2)" }}>OPEN PAYABLES</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"var(--sc-warning)" }}>{fmt(openAP)}</div>
                              </div>}
                              <button onClick={()=>isEditing?saveEdit(v):startEdit(v)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, background:isEditing?"linear-gradient(135deg,var(--sc-success-soft),var(--sc-success))":"var(--sc-border)", border:"1px solid var(--sc-border-2)", color:isEditing?"var(--sc-success)":"var(--sc-text-2)", cursor:"pointer" }}>
                                {isEditing?"Save":"Edit"}
                              </button>
                              {isEditing && <button onClick={()=>setEditingId(null)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>×</button>}
                            </div>
                          </div>

                          {/* Edit form */}
                          {isEditing && (
                            <div style={{ padding:"16px 20px", borderTop:"1px solid var(--sc-border)", background:"var(--sc-surface-2)", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                              {[
                                { key:"payment_terms", label:"Payment Terms", placeholder:"Net 30" },
                                { key:"email", label:"Email", placeholder:"billing@vendor.com" },
                                { key:"phone", label:"Phone", placeholder:"+1 555 000 0000" },
                                { key:"website", label:"Website", placeholder:"vendor.com" },
                                { key:"payment_url", label:"Payment Portal URL", placeholder:"bill.com / invoicing portal link" },
                                { key:"min_expected", label:"Min Expected ($)", placeholder:"500" },
                                { key:"max_expected", label:"Max Expected ($)", placeholder:"2000" },
                                { key:"tags", label:"Tags (comma-separated)", placeholder:"IT, recurring" },
                              ].map(f=>(
                                <div key={f.key}>
                                  <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:4 }}>{f.label}</div>
                                  <input value={editDraft[f.key]||""} onChange={e=>setEditDraft(d=>({...d,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                    style={{ width:"100%", boxSizing:"border-box", background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"8px 10px", color:"var(--sc-text)", fontSize:12, outline:"none" }} />
                                </div>
                              ))}
                              <div style={{ gridColumn:"1/-1" }}>
                                <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:4 }}>Notes</div>
                                <input value={editDraft.notes||""} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} placeholder="Any notes about this vendor..."
                                  style={{ width:"100%", boxSizing:"border-box", background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"8px 10px", color:"var(--sc-text)", fontSize:12, outline:"none" }} />
                              </div>
                            </div>
                          )}

                          {/* Notes display */}
                          {!isEditing && v.notes && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid var(--sc-border)", fontSize:12, color:"var(--sc-text-2)" }}>📝 {v.notes}</div>
                          )}
                          {!isEditing && (v.min_expected||v.max_expected) && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid var(--sc-border)", fontSize:12, color:"var(--sc-text-2)" }}>
                              Expected range: <span style={{ color:"var(--sc-gold)" }}>{fmt(v.min_expected||0)} – {fmt(v.max_expected||0)}/invoice</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                    )}
                  </>
                )}
              </div>
            );
}
