import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { initials, vendorColor, fmtDate } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { buildReviewQueue } from "../../lib/reviewQueue";
import { draftClientQuestion, answerToAccount } from "../../lib/clarify";

// O50 — CPA Review Dashboard. Consumes O60 (dropped/incomplete docs via reconcileDroppedDocs)
// and O49 (low-confidence-and-material txns via flagsForReview) into one review surface.
const _m = (n) => "$" + Math.abs(Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
const _m0 = (n) => "$" + Math.round(Math.abs(Number(n) || 0)).toLocaleString("en-US");

export default function ReviewView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view,
    reconcileDroppedDocs, flagsForReview, reviewApprove, reviewOverride, resolveIntakeItem, setReturnTo } = useERP();

  // ── O60 dropped/incomplete docs (async) + O49 flagged txns (sync) → one queue ──
  const [dropped, setDropped] = React.useState([]);
  const [loadingDropped, setLoadingDropped] = React.useState(true);
  const [busyId, setBusyId] = React.useState(null);
  const [overrideFor, setOverrideFor] = React.useState(null);   // flagged-txn id being overridden
  const [overrideCode, setOverrideCode] = React.useState("");
  const [askFor, setAskFor] = React.useState(null);             // flagged-txn id with the "ask client" panel open
  const [askDraft, setAskDraft] = React.useState("");          // the drafted plain-language question
  const [askAnswer, setAskAnswer] = React.useState("");        // the client's answer (pre-O82: pasted manually)
  const [copied, setCopied] = React.useState(false);

  const refreshDropped = React.useCallback(async () => {
    setLoadingDropped(true);
    try { const d = await (reconcileDroppedDocs ? reconcileDroppedDocs() : Promise.resolve([])); setDropped(Array.isArray(d) ? d : []); }
    catch { setDropped([]); }
    finally { setLoadingDropped(false); }
  }, [reconcileDroppedDocs]);
  React.useEffect(() => { refreshDropped(); }, [refreshDropped]);

  const flagged = flagsForReview ? flagsForReview() : [];
  const { completeness, needsReview, unknown, summary } = buildReviewQueue({ droppedDocs: dropped, flaggedTxns: flagged, unknownDocs });

  // ── actions (persist + verify; honest-on-failure; re-sync the view) ──
  const onApprove = async (txn) => {
    setBusyId(txn.id);
    const r = await reviewApprove(txn);
    setBusyId(null);
    showNotification(r.ok ? "Approved — the AI's coding stands ✓" : `Couldn't approve — ${r.error}`, r.ok ? "success" : "error");
  };
  const onOverride = async (txn) => {
    if (!overrideCode) { showNotification("Pick an account to recode to first.", "error"); return; }
    const acct = (CHART_OF_ACCOUNTS || []).find(a => String(a.code) === String(overrideCode));
    setBusyId(txn.id);
    const r = await reviewOverride(txn, overrideCode, acct?.name);
    setBusyId(null);
    if (r.ok) { showNotification(`Recoded → ${acct?.name || overrideCode} ✓`, "success"); setOverrideFor(null); setOverrideCode(""); }
    else showNotification(`Couldn't recode — ${r.error}`, "error");
  };
  const onResolveDoc = async (item, resolution) => {
    setBusyId(item.id);
    const r = await resolveIntakeItem(item.id, resolution, resolution === "rejected" ? "Dismissed in CPA review" : "Acknowledged — handle in its queue");
    setBusyId(null);
    if (r.ok) { showNotification(resolution === "rejected" ? "Dismissed ✓" : "Acknowledged ✓", "success"); refreshDropped(); }
    else showNotification(`Couldn't resolve — ${r.error}`, "error");
  };
  const openTxn = (txn) => { setReturnTo && setReturnTo({ view: "review", label: "Review" }); setSelectedInvoice && setSelectedInvoice(invoices.find(i => i.id === txn.id) || txn); setView && setView("detail"); };

  // ── Clarification loop (first slice): draft a plain-language question for the client; their
  // answer maps to an account and resolves the flag through the verified review action. ──
  const onAskClient = (txn) => {
    const d = draftClientQuestion(txn);
    setAskFor(txn.id); setAskDraft(d.question); setAskAnswer(""); setCopied(false);
    setOverrideFor(null);
  };
  const onCopyQuestion = () => {
    try { navigator?.clipboard?.writeText(askDraft); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard may be unavailable */ }
  };
  const onApplyAnswer = async (txn) => {
    const mapped = answerToAccount(askAnswer, { getAccountByRole, rules, vendor: txn.vendor });
    if (!mapped || !mapped.gl_code) {
      showNotification("I couldn't map that answer to a category yet — rephrase it (e.g. \"business insurance\") or use Override.", "error");
      return;   // still ambiguous → never falsely resolve
    }
    setBusyId(txn.id);
    const r = await reviewOverride(txn, mapped.gl_code, mapped.gl_name);   // same verified persistence path
    setBusyId(null);
    if (r.ok) { showNotification(`Resolved from the client's answer → ${mapped.gl_name} ✓`, "success"); setAskFor(null); setAskAnswer(""); }
    else showNotification(`Couldn't resolve — ${r.error}`, "error");
  };

  const statCard = (label, value, tone) => (
    <div style={{ flex: "1 1 160px", background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "16px 18px" }}>
      <div style={{ fontSize: 10, letterSpacing: 1.5, color: "var(--sc-text-2)", fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, fontFamily: "'DM Mono',monospace", marginTop: 6, color: tone || "var(--sc-text)" }}>{value}</div>
    </div>
  );

  // ── SUMMARY + COMPLETENESS + NEEDS-REVIEW (the new O50 sections) ──
  const summaryAndSections = (
    <>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 8 }}>
        {statCard("INCOMPLETE DOCS", summary.incompleteCount + summary.unknownCount, (summary.incompleteCount + summary.unknownCount) > 0 ? "var(--sc-warning)" : "var(--sc-success)")}
        {statCard("FLAGGED TXNS", summary.flaggedCount, summary.flaggedCount > 0 ? "var(--sc-warning)" : "var(--sc-success)")}
        {statCard("$ FLAGGED FOR REVIEW", _m0(summary.totalExposure), summary.totalExposure > 0 ? "var(--sc-gold)" : "var(--sc-success)")}
      </div>

      {/* COMPLETENESS — O60 dropped/stuck/errored intake docs */}
      {completeness.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-text)", margin: "8px 0 10px" }}>📥 Incomplete documents <span style={{ color: "var(--sc-text-2)", fontWeight: 500 }}>· arrived but didn't fully record ({completeness.length})</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {completeness.map(d => (
              <div key={d.id} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--sc-warning-soft)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>⚠</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sc-text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.filename || "document"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--sc-text-2)", marginTop: 2 }}>
                    {d.received_at ? `Arrived ${fmtDate(d.received_at)}` : ""}{d.age_minutes != null ? ` · ${d.age_minutes}m ago` : ""} · status <strong style={{ color: "var(--sc-text)" }}>{d.status}</strong> — {d.reason}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  <button disabled={busyId === d.id} onClick={() => setView && setView("home")} style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Re-upload</button>
                  <button disabled={busyId === d.id} onClick={() => onResolveDoc(d, "held_for_review")} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Acknowledge</button>
                  <button disabled={busyId === d.id} onClick={() => onResolveDoc(d, "rejected")} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-error)", cursor: "pointer" }}>Dismiss</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* NEEDS REVIEW — O49 low-confidence-and-material txns */}
      {needsReview.length > 0 && (
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-text)", margin: "14px 0 10px" }}>🔎 Needs your review <span style={{ color: "var(--sc-text-2)", fontWeight: 500 }}>· the AI wasn't sure ({needsReview.length})</span></div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {needsReview.map(t => {
              const tone = t.severity === "high" ? "var(--sc-error)" : "var(--sc-warning)";
              const isOv = overrideFor === t.id;
              const isAsk = askFor === t.id;
              return (
                <div key={t.id} style={{ background: "var(--sc-surface)", border: `1px solid ${t.severity === "high" ? "var(--sc-error-soft)" : "var(--sc-border)"}`, borderRadius: 14, padding: "16px 18px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flexWrap: "wrap" }}>
                    <div style={{ width: 36, height: 36, borderRadius: 9, background: vendorColor(t.vendor), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700, color: "var(--sc-on-accent)", flexShrink: 0 }}>{initials(t.vendor)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span onClick={() => openTxn(t)} style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)", cursor: "pointer" }}>{t.vendor || "Transaction"}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>{_m(t.amount)}</span>
                        <span style={{ fontSize: 11, color: tone, background: t.severity === "high" ? "var(--sc-error-soft)" : "var(--sc-warning-soft)", borderRadius: 20, padding: "2px 9px", fontWeight: 600 }}>{t.confidence}% sure</span>
                        {t.date && <span style={{ fontSize: 11.5, color: "var(--sc-text-2)" }}>{fmtDate(t.date)}</span>}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 6 }}>
                        AI chose <strong style={{ color: "var(--sc-text)" }}>{t.gl_code} {t.gl_name}</strong> — {t.reason}
                      </div>
                      {t.reasoning && <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 4, fontStyle: "italic" }}>“{t.reasoning}”</div>}
                      {Array.isArray(t.alternatives) && t.alternatives.length > 0 && (
                        <div style={{ fontSize: 11.5, color: "var(--sc-text-2)", marginTop: 4 }}>Also considered: {t.alternatives.map(a => `${a.gl_code || ""} ${a.gl_name || ""}`.trim()).join(", ")}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <button disabled={busyId === t.id} onClick={() => onApprove(t)} style={{ padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-success)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Approve</button>
                    {!isOv && <button disabled={busyId === t.id} onClick={() => { setOverrideFor(t.id); setOverrideCode(t.gl_code || ""); }} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-gold)", cursor: "pointer" }}>Override…</button>}
                    {isOv && (
                      <>
                        <select value={overrideCode} onChange={e => setOverrideCode(e.target.value)} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: "var(--sc-text)", outline: "none", maxWidth: 280 }}>
                          <option value="">Recode to…</option>
                          {(CHART_OF_ACCOUNTS || []).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                        </select>
                        <button disabled={busyId === t.id} onClick={() => onOverride(t)} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Save</button>
                        <button onClick={() => { setOverrideFor(null); setOverrideCode(""); }} style={{ padding: "8px 12px", borderRadius: 9, fontSize: 13, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Cancel</button>
                      </>
                    )}
                    {!isOv && <button disabled={busyId === t.id} onClick={() => onAskClient(t)} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", color: "var(--sc-gold)", cursor: "pointer" }}>💬 Ask the client</button>}
                    <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--sc-text-2)" }}>Leave it to decide later — it stays here.</span>
                  </div>

                  {/* Clarification loop (first slice): drafted plain-language question → client answers → resolve */}
                  {isAsk && (
                    <div style={{ marginTop: 12, background: "var(--sc-bg)", border: "1px solid var(--sc-gold-soft)", borderRadius: 11, padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, letterSpacing: 1.2, color: "var(--sc-gold)", fontWeight: 600, marginBottom: 8 }}>ASK THE CLIENT — plain-language question (send via Slack/email/text)</div>
                      <div style={{ fontSize: 13.5, color: "var(--sc-text)", lineHeight: 1.55, background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 9, padding: "11px 13px" }}>{askDraft}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button onClick={onCopyQuestion} style={{ padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy question"}</button>
                        <span style={{ fontSize: 11.5, color: "var(--sc-text-2)", alignSelf: "center" }}>When O82 (channel) lands, the bot sends this and ingests the reply automatically.</span>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--sc-text-2)", margin: "12px 0 6px", letterSpacing: 0.4 }}>CLIENT'S ANSWER</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <input value={askAnswer} onChange={(e) => setAskAnswer(e.target.value)} placeholder='e.g. "it’s our business insurance"'
                          style={{ flex: "1 1 260px", background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "9px 12px", fontSize: 13, color: "var(--sc-text)", outline: "none" }} />
                        <button disabled={busyId === t.id || !askAnswer.trim()} onClick={() => onApplyAnswer(t)} style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: askAnswer.trim() ? "pointer" : "not-allowed", opacity: askAnswer.trim() ? 1 : 0.6 }}>Apply answer</button>
                        <button onClick={() => { setAskFor(null); setAskAnswer(""); }} style={{ padding: "9px 12px", borderRadius: 8, fontSize: 13, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Close</button>
                      </div>
                      <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginTop: 8 }}>The answer maps to the right account and books it correctly — the client never sees a GL code. A vague answer won't resolve it.</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );

  return (
            <div>
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>CPA REVIEW</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Review</h1>
                <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Everything the trust layer flagged for a human: documents that didn't fully record, and transactions the AI wasn't sure about. Approve, override, or resolve — an empty screen means the books are clean.</div>
              </div>
              {loadingDropped && summary.totalItems === 0 ? (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:48, textAlign:"center", color:"var(--sc-text-2)", fontSize:13 }}>Checking the books…</div>
              ) : summary.allClear ? (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-success-soft)", borderRadius:14, padding:48, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>✓</div>
                  <div style={{ fontSize:16, fontWeight:600, marginBottom:8, color:"var(--sc-success)" }}>All clear — nothing needs review</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>Every document was recorded and no transaction was flagged as uncertain. The books are trustworthy as of now.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:20 }}>
                  {summaryAndSections}
                  {unknown.length > 0 && (
                  <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                  <div style={{ fontSize:13, fontWeight:700, color:"var(--sc-text)", margin:"6px 0 0" }}>📄 Unclassified documents <span style={{ color:"var(--sc-text-2)", fontWeight:500 }}>· awaiting a decision ({unknown.length})</span></div>
                  {unknownDocs.filter(d=>!d.posted).map(doc => {
                    const fmt = n => "$"+(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
                    const totalDebits = (doc.journal_entry?.lines||[]).reduce((s,l)=>s+(l.debit||0),0);

                    const postEntry = () => {
                      if (!doc.journal_entry) return;
                      // Build a ledger entry from the first debit line
                      const debitLine = doc.journal_entry.lines.find(l=>l.debit>0);
                      const creditLine = doc.journal_entry.lines.find(l=>l.credit>0);
                      if (!debitLine) return;
                      const newInvoice = {
                        id: Date.now()+Math.random(),
                        vendor: doc.document_type,
                        description: doc.journal_entry.description,
                        amount: debitLine.debit,
                        date: doc.journal_entry.date || new Date().toISOString().slice(0,10),
                        type: "expense",
                        gl_code: debitLine.account_code,
                        gl_name: debitLine.account_name,
                        secondary_gl_code: creditLine?.account_code || getAccountByRole("accounts_payable")?.code,
                        secondary_gl_name: creditLine?.account_name || getAccountByRole("accounts_payable")?.name,
                        debit_credit: "debit",
                        confidence: 95,
                        reasoning: `Posted from Needs Review: ${doc.document_type}`,
                        status: "booked",
                        booked_at: new Date().toISOString(),
                        source: "needs_review",
                        payment_status: "unpaid",
                      };
                      setInvoices(prev => [newInvoice, ...prev]);
                      setUnknownDocs(prev => prev.map(d => d.id===doc.id ? {...d, posted:true} : d));
                      showNotification(`Entry posted: ${doc.document_type} · ${fmt(debitLine.debit)} ✓`);
                    };

                    const dismiss = () => setUnknownDocs(prev => prev.filter(d => d.id!==doc.id));

                    return (
                      <div key={doc.id} style={{ background:"var(--sc-surface)", border:`1px solid ${doc.posted?"var(--sc-success-soft)":doc.entry_needed?"var(--sc-gold-soft)":"var(--sc-border)"}`, borderRadius:14, overflow:"clip" }}>

                        {/* Header */}
                        <div style={{ padding:"18px 20px", display:"flex", alignItems:"flex-start", gap:14 }}>
                          <div style={{ width:44, height:44, borderRadius:11, background:doc.posted?"#D1FAE522":doc.entry_needed?"var(--sc-surface-2)":"var(--sc-surface)", border:`1px solid ${doc.posted?"var(--sc-success-soft)":doc.entry_needed?"var(--sc-gold-soft)":"var(--sc-border-2)"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                            {doc.posted ? "✓" : doc.entry_needed ? "📋" : "📄"}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:15, fontWeight:600 }}>{doc.document_type}</span>
                              {doc.posted && <span style={{ fontSize:11, background:"var(--sc-success-soft)", color:"var(--sc-success)", borderRadius:20, padding:"2px 9px" }}>✓ Posted</span>}
                              {!doc.posted && doc.entry_needed && <span style={{ fontSize:11, background:"var(--sc-gold-soft)", color:"var(--sc-gold)", borderRadius:20, padding:"2px 9px" }}>Entry proposed</span>}
                              {!doc.posted && !doc.entry_needed && <span style={{ fontSize:11, background:"var(--sc-border)", color:"var(--sc-text-2)", borderRadius:20, padding:"2px 9px" }}>No entry needed</span>}
                            </div>
                            <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:12 }}>{doc.name} · Uploaded {doc.uploaded_at ? fmtDate(doc.uploaded_at) : ""}</div>

                            {/* AI explanation */}
                            <div style={{ background:"var(--sc-bg)", border:"1px solid var(--sc-gold-soft)", borderRadius:10, padding:"12px 16px", marginBottom: doc.entry_needed && !doc.posted ? 14 : 0 }}>
                              <div style={{ fontSize:10, color:"var(--sc-gold)", marginBottom:6, letterSpacing:1.5 }}>✦ AI ANALYSIS</div>
                              <div style={{ fontSize:13, color:"var(--sc-text-2)", lineHeight:1.75 }}>{doc.ai_explanation}</div>
                              {doc.no_entry_reason && <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:8, borderTop:"1px solid var(--sc-border)", paddingTop:8 }}>No entry needed: {doc.no_entry_reason}</div>}
                            </div>

                            {/* Proposed journal entry */}
                            {doc.entry_needed && doc.journal_entry && !doc.posted && (
                              <div style={{ background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:10, overflow:"clip" }}>
                                <div style={{ padding:"10px 14px", borderBottom:"1px solid var(--sc-border-2)", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                  <div>
                                    <div style={{ fontSize:11, color:"var(--sc-gold)", letterSpacing:1 }}>PROPOSED JOURNAL ENTRY</div>
                                    <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2 }}>{doc.journal_entry.description} · {fmtDate(doc.journal_entry.date)}</div>
                                  </div>
                                  <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"var(--sc-text)" }}>{fmt(totalDebits)}</div>
                                </div>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <thead><tr style={{ background:"var(--sc-bg)" }}>
                                    {["Account","Debit","Credit"].map(h=><th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:10, color:"var(--sc-text-2)", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                                  </tr></thead>
                                  <tbody>
                                    {doc.journal_entry.lines.map((line,i)=>(
                                      <tr key={i} style={{ borderTop:"1px solid var(--sc-border)" }}>
                                        <td style={{ padding:"10px 14px" }}>
                                          <span style={{ fontSize:11, background:"var(--sc-border)", color:"var(--sc-text-2)", borderRadius:4, padding:"2px 7px", marginRight:8 }}>{line.account_code}</span>
                                          <span style={{ fontSize:13, color:line.debit>0?"var(--sc-text)":"var(--sc-text-2)", paddingLeft:line.credit>0?16:0 }}>{line.account_name}</span>
                                        </td>
                                        <td style={{ padding:"10px 14px", fontFamily:"'DM Mono',monospace", fontSize:13, color:"var(--sc-text)" }}>{line.debit>0?fmt(line.debit):"—"}</td>
                                        <td style={{ padding:"10px 14px", fontFamily:"'DM Mono',monospace", fontSize:13, color:"var(--sc-text-2)" }}>{line.credit>0?fmt(line.credit):"—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Already posted confirmation */}
                            {doc.posted && (
                              <div style={{ marginTop:12, fontSize:13, color:"var(--sc-success)" }}>✓ Entry posted to ledger · {doc.journal_entry?.date}</div>
                            )}

                            {/* Watch match alerts — triggered conditions */}
                            {(doc.watch_matches||[]).length > 0 && (
                              <div style={{ marginTop:14 }}>
                                {doc.watch_matches.map((match, mi) => (
                                  <div key={mi} style={{ background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:10, padding:"12px 16px", marginBottom:8 }}>
                                    <div style={{ fontSize:11, color:"var(--sc-warning)", letterSpacing:1.2, marginBottom:6 }}>🔔 WATCH TRIGGERED</div>
                                    <div style={{ fontSize:13, color:"var(--sc-text)", marginBottom:6, fontWeight:500 }}>{match.trigger_description}</div>
                                    <div style={{ fontSize:12, color:"var(--sc-text-2)", marginBottom:10 }}>
                                      Matched: <strong style={{ color:"var(--sc-text)" }}>{match.vendor}</strong> · {fmt(match.amount)} · {fmtDate(match.date)}
                                    </div>
                                    {match.suggested_entry_description && (
                                      <div style={{ fontSize:12, color:"var(--sc-warning)", marginBottom:10 }}>
                                        Suggested action: {match.suggested_entry_description}
                                      </div>
                                    )}
                                    <button
                                      onClick={() => {
                                        // Post the suggested entry for this match
                                        const newInvoice = {
                                          id: Date.now()+Math.random(),
                                          vendor: doc.document_type,
                                          description: match.suggested_entry_description || match.trigger_description,
                                          amount: match.amount,
                                          date: match.date || new Date().toISOString().slice(0,10),
                                          type: "expense",
                                          gl_code: match.suggested_gl_code || getAccountByRole("miscellaneous_expense")?.code,
                                          gl_name: match.suggested_gl_name || getAccountByRole("miscellaneous_expense")?.name,
                                          secondary_gl_code: getAccountByRole("cash")?.code,
                                          secondary_gl_name: getAccountByRole("cash")?.name,
                                          debit_credit: "debit",
                                          confidence: 90,
                                          reasoning: `Watch trigger posted: ${doc.document_type}`,
                                          status: "booked",
                                          booked_at: new Date().toISOString(),
                                          source: "watch_trigger",
                                          payment_status: "unpaid",
                                        };
                                        setInvoices(prev => [newInvoice, ...prev]);
                                        setUnknownDocs(prev => prev.map(d => d.id===doc.id
                                          ? { ...d, watch_matches: d.watch_matches.map((m,i) => i===mi ? {...m, posted:true} : m) }
                                          : d
                                        ));
                                        showNotification(`Entry posted: ${doc.document_type} watch trigger ✓`);
                                      }}
                                      disabled={match.posted}
                                      style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:match.posted?"var(--sc-border)":"linear-gradient(135deg,var(--sc-warning),var(--sc-warning))", border:"none", color:match.posted?"var(--sc-text-2)":"var(--sc-warning)", cursor:match.posted?"default":"pointer" }}>
                                      {match.posted ? "✓ Entry Posted" : "Post Entry for This Event"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Watching for — active conditions */}
                            {!doc.posted && (doc.watch_for||[]).length > 0 && (
                              <div style={{ marginTop:14, background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:10, padding:"12px 16px" }}>
                                <div style={{ fontSize:10, color:"var(--sc-success)", letterSpacing:1.5, marginBottom:8 }}>👁 WATCHING FOR</div>
                                {doc.watch_for.map((w, wi) => (
                                  <div key={wi} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom: wi < doc.watch_for.length-1 ? 10 : 0 }}>
                                    <div style={{ width:5, height:5, borderRadius:"50%", background:"var(--sc-success)", marginTop:6, flexShrink:0 }} />
                                    <div>
                                      <div style={{ fontSize:13, color:"var(--sc-text-2)" }}>{w.trigger_description}</div>
                                      {w.suggested_entry_description && (
                                        <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:2 }}>If triggered → {w.suggested_entry_description}</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:10, borderTop:"1px solid var(--sc-border)", paddingTop:8 }}>
                                  The system will automatically detect related transactions and alert you here.
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Dismiss button */}
                          {doc.posted && (
                            <button onClick={dismiss} style={{ background:"transparent", border:"none", color:"var(--sc-text-2)", cursor:"pointer", fontSize:16, padding:"2px 6px", flexShrink:0 }}>×</button>
                          )}
                        </div>

                        {/* Action bar */}
                        {!doc.posted && (
                          <div style={{ padding:"12px 20px", borderTop:"1px solid var(--sc-border)", background:"var(--sc-surface-2)", display:"flex", gap:8, alignItems:"center" }}>
                            {doc.entry_needed && doc.journal_entry && (
                              <button onClick={postEntry} style={{ padding:"9px 22px", borderRadius:9, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>
                                Post Entry to Ledger
                              </button>
                            )}
                            <button onClick={dismiss} style={{ padding:"9px 16px", borderRadius:9, fontSize:13, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>
                              {doc.entry_needed ? "Dismiss Without Posting" : "Dismiss"}
                            </button>
                            <div style={{ marginLeft:"auto", fontSize:12, color:"var(--sc-text-2)" }}>
                              {doc.entry_needed ? "Review the entry above, then post when ready." : "No accounting action required."}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  )}
                </div>
              )}
            </div>
  );
}
