import { OBE_CODE, OBE_ROLE } from "../../lib/openingBalances";
import { openingGridValues, openingGridToPost } from "../../lib/openingGrid";
import React from "react";
import { showCodesFor, ownerAccountName } from "../../lib/categoryLabel";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor , fmtMoney, fmtSignedMoney, fmtDate } from "../../lib/format";
import { statementOpeningOffer } from "../../lib/openingBalanceProposal";   // C708
import { getAuthHeaders } from "../../lib/supabase";

export default function OpeningBalancesView() {
  const { BOOKABLE_ACCOUNTS, CHART_OF_ACCOUNTS, CONTRACT_TYPES, aiStep, aiSuggestion, allProjects, allVendorNames, apView, applyMatch, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatLoading, chatOpen, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalBalances, openingBalances, cutoffDate, saveCutoffDate, postOpeningBalances, openingPosted, redoOpeningPlan, redoOpeningSetup, isOwner, isAdmin, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, recurring, recurringNewRec, reportDateFrom, reportDateTo, reportRange, reportType, rules, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setAiStep, setAiSuggestion, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setChatHistory, setChatLoading, setChatOpen, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchQueue, setNotification, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view, navSeat, confirmOpeningFromStatement, pendingOpeningProposal } = useERP();
  // ★ C708 — the offer the checklist promised: the first saved statement's starting balance and
  // date, one tap to use (or the in-memory proposal, when a statement was just read)
  const [savedStatements, setSavedStatements] = React.useState([]);
  const [offerBusy, setOfferBusy] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentCompany?.id || openingPosted || !supabase) return;
      try {
        const { data, error } = await supabase.from("bank_statements").select("id, bank_account_id, period_start, stated_opening_balance, stated_ending_balance, status")
          .eq("company_id", currentCompany.id).neq("status", "superseded");
        if (!error && !cancelled) setSavedStatements(data || []);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentCompany?.id, openingPosted]);
  const offer = openingPosted ? null : (pendingOpeningProposal && pendingOpeningProposal.periodStart ? pendingOpeningProposal : statementOpeningOffer({ statements: savedStatements, bankAccounts }));
  const showCodes = showCodesFor(navSeat);   // C578
  // C578 — the three groups in an owner's words; the accounting name stays for the accountant.
  const SECTION_LABEL = {
    Assets:      { title: "WHAT THE BUSINESS HAS",  hint: showCodes ? "assets — bank, cash, money owed to you" : "bank accounts, cash, money customers owe you" },
    Liabilities: { title: "WHAT THE BUSINESS OWES", hint: showCodes ? "liabilities — cards, loans, unpaid bills" : "credit cards, loans, bills you haven't paid" },
    Equity:      { title: "WHAT'S LEFT OVER",       hint: showCodes ? "equity" : "the owner's share — usually you can leave this to balance itself" },
  };
            const fmt = fmtMoney;
            // C472 — a disabled account is not offered a starting balance… ★ C722 — unless it already HAS one: dropped
            // from the grid, a redo re-posted without it and its amount moved silently into the balancing equity line.
            const savedCodes = new Set((openingBalances || []).filter(o => o && o.account_code != null && Math.abs(Number(o.balance) || 0) >= 0.005).map(o => String(o.account_code)));
            const bsAccts = [...(BOOKABLE_ACCOUNTS||[]), ...(CHART_OF_ACCOUNTS||[]).filter(a => a && a.active === false && savedCodes.has(String(a.code)))]
              .filter(a=>["Assets","Liabilities","Equity"].includes(a.category));
            // C590 — saved wins over inferred, typed wins over saved; see `openingGrid.js`.
            const { values: balances, fromBank } = openingGridValues({ accounts: bsAccts, saved: openingBalances, bankAccounts, typed: openingBalBalances });
            // Bank-linked cash is PRE-FILLED from the bank balance (when known) but stays
            // editable — an established business must be able to type its day-one cash, and a
            // new business whose bank balance isn't recorded yet shouldn't be locked to 0.
            const setBalances = setOpeningBalBalances;

            // Opening Balance Equity (3400) is the AUTO-PLUG, never a manual input: the user
            // enters only their known asset/liability (and optional equity) day-one balances,
            // and the app silently posts the balancing figure to OBE so the entry balances
            // without the user touching the equity side (how QuickBooks etc. handle this).
            const OBE = getAccountByRole?.(OBE_ROLE)?.code || OBE_CODE;   // C341 — by role, the literal only as the fallback
            const totalAssets = CHART_OF_ACCOUNTS.filter(a=>a.category==="Assets").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalLiab = CHART_OF_ACCOUNTS.filter(a=>a.category==="Liabilities").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalEquity = CHART_OF_ACCOUNTS.filter(a=>a.category==="Equity"&&a.code!==OBE).reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const obePlug = totalAssets - totalLiab - totalEquity;          // the app posts this to OBE 3400
            const hasEntry = bsAccts.some(a=>a.code!==OBE && parseFloat(balances[a.code]));

            // Post via the canonical handler: one balanced opening JE (plug to OBE 3400),
            // persisted + saved to opening_balances (survives refresh). Bank-linked cash is
            // overridden from bank balances in the handler, so we send only grid values.
            const post = async () => {
              // What is on the grid is what posts — every figure shown, not only the ones typed.
              await postOpeningBalances(openingGridToPost(balances, bsAccts));
            };

            return (
              <div style={{maxWidth:680}}>
                <div id="opening-balances-section" style={{marginBottom:24,scrollMarginTop:16}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"var(--sc-text-2)",marginBottom:8}}>SETUP</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Starting balances</h1>
                  <div style={{fontSize:13,color:"var(--sc-text-2)",marginTop:6}}>What the business had and owed on the day your books start — bank balances, credit cards, loans. The easiest start date is the first day of your first bank statement; everything after it comes from what you upload.</div>
                </div>

                {/* ★ C708 — the statement's own figures, offered: no number to look up, no date to guess */}
                {offer && (
                  <div data-opening-offer style={{background:"var(--sc-gold-soft)",border:"1px solid var(--sc-gold)",borderRadius:12,padding:"14px 18px",marginBottom:16}}>
                    <div style={{fontSize:14,fontWeight:600}}>From your {offer.accountName} statement</div>
                    <div style={{fontSize:13,color:"var(--sc-text)",marginTop:4}}>It starts on {fmtDate(offer.periodStart)} with {fmtSignedMoney(offer.openingBalance)}. Use that as your starting point? Your books will start on {fmtDate(offer.periodStart)}.</div>
                    <button disabled={offerBusy} onClick={async()=>{ setOfferBusy(true); try { await confirmOpeningFromStatement?.(offer); } finally { setOfferBusy(false); } }}
                      style={{marginTop:10,background:"var(--sc-gold)",color:"var(--sc-on-accent)",border:"none",borderRadius:9,padding:"9px 18px",fontSize:13,fontWeight:600,cursor:offerBusy?"wait":"pointer"}}>
                      {offerBusy ? "Saving…" : `Yes, start from ${fmtSignedMoney(offer.openingBalance)}`}
                    </button>
                  </div>
                )}

                {/* Cutoff (Day One) — editable until the opening entry is posted, then locked */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:16}}>
                  <div style={{fontSize:13,color:"var(--sc-text-2)",flexShrink:0}}>Start date:</div>
                  <input type="date" value={cutoffDate||""} disabled={openingPosted} onChange={e=>saveCutoffDate(e.target.value)}
                    style={{background: openingPosted?"var(--sc-surface-2)":"var(--sc-surface)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"7px 12px",color:"var(--sc-text)",fontSize:13,outline:"none",cursor:openingPosted?"not-allowed":"text"}}/>
                  {openingPosted && <span style={{fontSize:12,color:"var(--sc-text-2)"}}>🔒 locked — starting balances saved, so your reports stay consistent</span>}
                  {/* ── §12's DEFERRED ESCAPE HATCH, NOW REACHABLE ────────────────────────
                      The lock is right: the whole starting position is one entry dated at
                      this date, and moving it afterwards would silently re-date every
                      pre-cutoff assumption. But a lock with no way out turns a week-one
                      mistake into a permanent one — and a repair that exists with no button
                      is the O129 shape. It lives HERE, beside the lock it lifts. */}
                  {openingPosted && (isOwner || isAdmin) && (
                    <button onClick={() => {
                      const plan = redoOpeningPlan?.();
                      if (!plan) return;
                      if (!plan.ok) { showNotification(plan.message, "error"); return; }
                      setDeleteConfirm({
                        title: "Start your opening balances again?",
                        message: plan.message,
                        confirmLabel: plan.confirmLabel,
                        onConfirm: async () => { await redoOpeningSetup(); },
                      });
                    }}
                      style={{fontSize:12,background:"none",border:"none",color:"var(--sc-text-2)",textDecoration:"underline",cursor:"pointer",padding:0}}>
                      start again
                    </button>
                  )}
                  <div style={{marginLeft:"auto",fontSize:12,color:"var(--sc-success)",fontWeight:500}}>
                    {hasEntry ? <>✓ Balanced for you{Math.abs(obePlug)>=0.01 ? <span style={{color:"var(--sc-text-2)",fontWeight:400}}> — {fmt(obePlug)} recorded as your starting equity</span> : null}</> : "Enter what you had and owed on your start date"}
                  </div>
                </div>
                {!cutoffDate && <div style={{background:"var(--sc-warning-soft)",border:"1px solid var(--sc-warning-soft)",borderRadius:10,padding:"10px 14px",marginBottom:16,fontSize: 13,color:"var(--sc-warning)"}}>Pick your start date first — the day your books begin. Nothing before it is entered one by one; it's summed up here instead.</div>}

                {/* Balance sheet input by category. OBE (3400) is excluded from inputs — it's the
                    auto-plug, shown as a computed line under Equity so the user SEES where the
                    balancing figure goes without having to enter it. */}
                {["Assets","Liabilities","Equity"].map(cat => {
                  const accts = (BOOKABLE_ACCOUNTS||[]).filter(a=>a.category===cat && a.code!==OBE);
                  const catTotal = accts.reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0) + (cat==="Equity"?obePlug:0);
                  return (
                  <div key={cat} style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border)",borderRadius:12,overflow:"hidden",marginBottom:12}}>
                    <div style={{padding:"12px 20px",background:"var(--sc-surface-2)",borderBottom:"1px solid var(--sc-border)",display:"flex",justifyContent:"space-between"}}>
                      <div style={{fontSize:12,fontWeight:600,color:"var(--sc-gold)",letterSpacing:0.5}}>{SECTION_LABEL[cat].title}<span style={{fontWeight:400,color:"var(--sc-text-2)",letterSpacing:0,marginLeft:8}}>{SECTION_LABEL[cat].hint}</span></div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"var(--sc-text)"}}>{fmt(catTotal)}</div>
                    </div>
                    {accts.map((acct,i)=>(
                      <div key={acct.code} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderTop:i>0?"1px solid var(--sc-border)":"none"}}>
                        <div style={{flex:1}}>
                          {showCodes && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--sc-text-2)",marginRight:10}}>{acct.code}</span>}
                          <span style={{fontSize:13}}>{showCodes ? acct.name : ownerAccountName(acct.name)}</span>
                        </div>
                        {fromBank.has(acct.code) && <span style={{fontSize:10,color:"var(--sc-gold)",marginRight:8}} title="Pre-filled from the linked bank account — editable">from bank</span>}
                        <input type="number" value={balances[acct.code]||""}
                          onChange={e=>setBalances(b=>({...b,[acct.code]:e.target.value}))}
                          placeholder="0.00" step="0.01"
                          style={{width:140,background:"var(--sc-surface-2)",border:"1px solid var(--sc-border-2)",borderRadius:8,padding:"7px 12px",color:"var(--sc-text)",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",textAlign:"right",cursor:"text"}}/>
                      </div>
                    ))}
                    {/* Auto-plug line — Opening Balance Equity (computed, not editable) */}
                    {cat==="Equity" && (
                      <div style={{display:"flex",alignItems:"center",padding:"10px 20px",borderTop:accts.length?"1px solid var(--sc-border)":"none",background:"var(--sc-gold-soft)"}}>
                        <div style={{flex:1}}>
                          {showCodes && <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"var(--sc-text-2)",marginRight:10}}>{OBE}</span>}
                          <span style={{fontSize:13}}>{showCodes ? "Opening Balance Equity" : "Starting equity"}</span>
                          <span style={{fontSize:11,color:"var(--sc-gold)",marginLeft:8}}>balances itself</span>
                        </div>
                        <div style={{width:140,textAlign:"right",fontFamily:"'DM Mono',monospace",fontSize:13,color:"var(--sc-text)",paddingRight:12}} title="The app posts this balancing figure for you — no manual entry needed">{fmt(obePlug)}</div>
                      </div>
                    )}
                  </div>
                  );
                })}

                {/* Summary */}
                <div style={{background:"var(--sc-surface)",border:"1px solid var(--sc-border-2)",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,textAlign:"center"}}>
                  {[["What it has",totalAssets,"var(--sc-success)"],["What it owes",totalLiab,"var(--sc-error)"],["What's left over",totalEquity+obePlug,"var(--sc-gold)"]].map(([l,v,c])=>(
                    <div key={l}>
                      <div style={{fontSize:11,color:"var(--sc-text-2)",marginBottom:4}}>{l}</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'DM Mono',monospace",color:c}}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>

                {(() => { const canPost = !!cutoffDate && hasEntry; return (
                <button onClick={post} disabled={!canPost} style={{padding:"11px 32px",borderRadius:10,fontSize:14,fontWeight:600,background:canPost?"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))":"var(--sc-border)",border:"none",color:canPost?"var(--sc-surface)":"var(--sc-text-2)",cursor:canPost?"pointer":"not-allowed"}}>
                  {openingPosted ? "Update starting balances" : "Save starting balances"}
                </button> ); })()}
              </div>
            );
}
