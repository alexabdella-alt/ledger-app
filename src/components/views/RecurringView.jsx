import React from "react";
import { plainWriteError } from "../../lib/plainWriteError";
import { makeKeyedInFlight } from "../../lib/oneInFlight";
import { useERP } from "../ERPContext";
import LoadFailedNotice from "../LoadFailedNotice";
import LoadingList from "../LoadingList";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate , fmtMoney, todayLocal } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { nextRecurringDate, dueLabel } from "../../lib/recurringSchedule";

export default function RecurringView() {
  const { BOOKABLE_ACCOUNTS, createRecurring, recordRecurringRun, CHART_OF_ACCOUNTS, CONTRACT_TYPES, aiStep, aiSuggestion, allProjects, allVendorNames, apView, applyMatch, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatLoading, chatOpen, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, recurring, recurringNewRec, reportDateFrom, reportDateTo, reportRange, reportType, rules, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setAiStep, setAiSuggestion, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setChatHistory, setChatLoading, setChatOpen, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchQueue, setNotification, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view, setRecurringActive, removeRecurring, loadFailures, companyDataLoaded } = useERP();
  const postsInFlight = React.useRef(makeKeyedInFlight());
            const fmt = fmtMoney;
            const today = todayLocal();
            const due = recurring.filter(r=>r.active && r.next_date && r.next_date<=today);
            // ★ C360 — "POST NOW" POSTS. It used to put the entry in React state, advance
            // `next_date` in React state, write an audit row saying it had posted, and say
            // "Posted ✓" — and never write the journal entry. A reload then offered the same
            // month again. Now: book through the single write path, and only on a durable id
            // record the run on the rule and say so.
            // C402 — "Post now" pressed twice while the first post is writing runs once.
            const runRecurring = (r) => postsInFlight.current.run(r.id, () => runRecurringOnce(r));
            const runRecurringOnce = async (r) => {
              const inv = {
                id:Date.now()+Math.random(), vendor:r.vendor, description:r.description||r.name,
                amount:r.amount, date:today, type:"expense", gl_code:r.gl_code, gl_name:r.gl_name,
                project:r.project||"General", secondary_gl_code:getAccountByRole("accounts_payable")?.code, secondary_gl_name:getAccountByRole("accounts_payable")?.name,
                debit_credit:"debit", confidence:99, reasoning:`Recurring: ${r.name}`,
                status:"booked", booked_at:new Date().toISOString(), source:"recurring", payment_status:"unpaid"
              };
              setInvoices(prev => [inv, ...prev]);
              const jeId = await bookToDb(inv);
              if (!jeId) {
                setInvoices(prev => prev.filter(i => i.id !== inv.id));
                showNotification(`${r.name} was NOT posted — the entry couldn't be written. Nothing changed.`, "error");
                return;
              }
              // C492 — never overflow a month (Jan 31 + 1 → Feb 28, not Mar 3), and a
              // month-end rule stays on month-ends. Unknown frequency: the date is left as is.
              const nextDate = nextRecurringDate(r.next_date, r.frequency) || r.next_date;
              const rec = await recordRecurringRun(r.id, { last_run: today, next_date: nextDate });
              setRecurring(prev => prev.map(x => x.id===r.id ? {...x, last_run:today, next_date:nextDate} : x));
              logAudit("recurring_posted", `Recurring posted: ${r.name} ${fmt(r.amount)}`, null, { journal_entry_id: jeId, next_date: nextDate, run_recorded: !!rec?.ok });
              if (rec?.ok) showNotification(`Posted: ${r.name} ${fmt(r.amount)} ✓`);
              else showNotification(`Posted ${r.name} ${fmt(r.amount)} — but we couldn't record the run on the rule, so it may show as due again after a reload. Don't post it twice.`, "error");
            };
            const newRec = recurringNewRec; const setNewRec = setRecurringNewRec;
            const addRecurring = async () => {
              if (!newRec.name) { showNotification("Please enter a name.","error"); return; }
              const amt = parseFloat(newRec.amount);
              if (isNaN(amt) || amt <= 0) { showNotification("Please enter a valid amount.","error"); return; }
              // Through the same verified insert the chat's add_recurring uses (C112) — the
              // screen's version was a setState, and the rule vanished on reload.
              const res = await createRecurring({ name: newRec.name, vendor: newRec.vendor, amount: amt, gl_code: newRec.gl_code, gl_name: newRec.gl_name, frequency: newRec.frequency, next_date: newRec.next_date || today, project: newRec.project });
              if (!res?.ok) { showNotification(`Couldn't save that recurring transaction — ${plainWriteError(res?.error, "the write didn't land")}. Nothing was created.`, "error"); return; }
              const r = { ...newRec, amount: amt };
              logAudit("recurring_created", `Recurring created: ${r.name} ${fmt(r.amount)} ${r.frequency}`);
              setNewRec({name:"",vendor:"",amount:"",gl_code:getAccountByRole("rent_occupancy")?.code||"",gl_name:getAccountByRole("rent_occupancy")?.name||"",frequency:"monthly",next_date:today,project:"General"});
              showNotification(`Recurring "${r.name}" created ✓`);
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>AUTOMATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Recurring charges</h1>
                  <div style={{fontSize:13,color:"var(--sc-text-2)",marginTop:6}}>Set up transactions that repeat automatically. You can also tell the AI chat — "set up rent as $4,500/month starting June 1".</div>
                </div>
                {/* Due now alert */}
                {due.length>0 && (
                  <div style={{background:"var(--sc-warning-soft)",border:"1px solid var(--sc-warning-soft)",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:13,color:"var(--sc-warning)",fontWeight:500}}>⏰ {due.length} recurring transaction{due.length!==1?"s":""} due today</div>
                    <button onClick={()=>due.forEach(runRecurring)} style={{padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:600,background:"var(--sc-warning)",border:"none",color:"#000",cursor:"pointer"}}>Post All Due</button>
                  </div>
                )}
                {/* Add new */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:20,marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",marginBottom:14,letterSpacing:0.5}}>+ NEW RECURRING TRANSACTION</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12}}>
                    {[{k:"name",l:"Name",p:"e.g. Office Rent"},{k:"vendor",l:"Vendor",p:"Landlord name"},{k:"amount",l:"Amount ($)",p:"4500"}].map(f=>(
                      <div key={f.k}>
                        <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>{f.l}</div>
                        <input value={newRec[f.k]} onChange={e=>setNewRec(d=>({...d,[f.k]:e.target.value}))} placeholder={f.p}
                          style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}/>
                      </div>
                    ))}
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>Category</div>
                      <select value={newRec.gl_code} onChange={e=>{const a=CHART_OF_ACCOUNTS.find(x=>x.code===e.target.value);setNewRec(d=>({...d,gl_code:e.target.value,gl_name:a?.name||""}));}}
                        style={{width:"100%",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}>
                        {(BOOKABLE_ACCOUNTS||[]).filter(a=>a.category==="Expenses").map(a=><option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>Frequency</div>
                      <select value={newRec.frequency} onChange={e=>setNewRec(d=>({...d,frequency:e.target.value}))}
                        style={{width:"100%",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}>
                        {["weekly","monthly","quarterly","annual"].map(f=><option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>First / Next Date</div>
                      <input type="date" value={newRec.next_date} onChange={e=>setNewRec(d=>({...d,next_date:e.target.value}))}
                        style={{width:"100%",boxSizing:"border-box",background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"8px 10px",color:"var(--sc-text)",fontSize:12,outline:"none"}}/>
                    </div>
                  </div>
                  <button onClick={addRecurring} disabled={!newRec.name||!newRec.amount} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:(!newRec.name||!newRec.amount)?"var(--sc-border)":"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))",border:"none",color:"var(--sc-text)",cursor:(!newRec.name||!newRec.amount)?"not-allowed":"pointer"}}>Save Recurring Transaction</button>
                </div>
                {/* List */}
                {loadFailures?.recurring_transactions ? <LoadFailedNotice what="recurring charges" table="recurring_transactions" /> : !companyDataLoaded ? <LoadingList what="your recurring charges" /> : recurring.length===0 ? (
                  <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,padding:40,textAlign:"center",color:"var(--sc-text-2)",fontSize:13}}>No recurring transactions yet.</div>
                ) : (
                  <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:14,overflow:"clip"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"var(--sc-surface-2)"}}>
                        {["Name","Vendor","Amount","Category","Frequency","Next Date",""].map(h=><th key={h} style={{padding:"11px 16px",textAlign:"left",fontSize:10,color:"var(--sc-text-2)",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {recurring.map((r,i)=>{
                          const isDue = r.active && r.next_date && r.next_date<=today;
                          return (
                            <tr key={r.id} style={{borderTop:"1px solid var(--sc-border)",background:isDue?"var(--sc-warning-soft)":i%2===0?"transparent":"var(--sc-bg)"}}>
                              <td style={{padding:"12px 16px"}}>
                                <div style={{fontSize:13,fontWeight:500}}>{r.name}</div>
                                {!r.active && <span style={{fontSize:10,color:"var(--sc-text-2)"}}>Paused</span>}
                                {isDue && <span style={{fontSize:10,color:"var(--sc-warning)",marginLeft:6}}>{dueLabel(r.next_date, today)}</span>}
                              </td>
                              <td style={{padding:"12px 16px",fontSize:13,color:"var(--sc-text-2)"}}>{r.vendor||"—"}</td>
                              <td style={{padding:"12px 16px",fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:600,color:"var(--sc-error)"}}>{fmt(r.amount||0)}</td>
                              <td style={{padding:"12px 16px"}}><span style={{fontSize:11,background:"var(--sc-border)",color:"var(--sc-gold)",borderRadius:20,padding:"2px 9px"}}>{r.gl_code} {r.gl_name}</span></td>
                              <td style={{padding:"12px 16px",fontSize:12,color:"var(--sc-text-2)",textTransform:"capitalize"}}>{r.frequency}</td>
                              <td style={{padding:"12px 16px",fontSize:12,color:isDue?"var(--sc-warning)":"var(--sc-text-2)",}}>{fmtDate(r.next_date)||"—"}</td>
                              <td style={{padding:"12px 16px"}}>
                                <div style={{display:"flex",gap:6}}>
                                  {isDue && <button onClick={()=>runRecurring(r)} style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,background:"var(--sc-warning)",border:"none",color:"#000",cursor:"pointer"}}>Post</button>}
                                  <button onClick={async()=>{ const res = await setRecurringActive(r, !r.active); if (!res?.ok) showNotification(`Couldn't ${r.active?"pause":"resume"} ${r.name} — nothing was changed. ${plainWriteError(res?.error, "")}`.trim(), "error"); }} style={{padding:"5px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid var(--sc-border-2)",color:"var(--sc-text-2)",cursor:"pointer"}}>{r.active?"Pause":"Resume"}</button>
                                  <button onClick={async()=>{ const res = await removeRecurring(r); if (!res?.ok) { showNotification(`Couldn't delete ${r.name} — nothing was changed. ${plainWriteError(res?.error, "")}`.trim(), "error"); return; } showNotification(`${r.name} deleted ✓`); }} style={{padding:"5px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid var(--sc-border-2)",color:"var(--sc-error)",cursor:"pointer"}}>×</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
}
