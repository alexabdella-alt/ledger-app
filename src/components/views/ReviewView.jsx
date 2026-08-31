import React from "react";
import { useERP } from "../ERPContext";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType } from "../../lib/gl";
import { agoPhrase, initials, vendorColor, fmtDate , fmtSignedMoney, fmtMoney, todayLocal } from "../../lib/format";
import { getAuthHeaders } from "../../lib/supabase";
import { statementExceptionTarget, OPEN_RECONCILE_LABEL } from "../../lib/statementLifecycle";
import { anomalyEvidence } from "../../lib/anomalies";
import { commentsFor, evidencePrompt, validateComment, dismissalSummary } from "../../lib/anomalyNotes";
import { buildReviewQueue } from "../../lib/reviewQueue";
import { firstUnsignedMonth } from "../../lib/workbench";
import { draftClientQuestion, answerToAccount } from "../../lib/clarify";
import { isPeriodSignedOff } from "../../lib/signoff";

// O50 — CPA Review Dashboard. Consumes O60 (dropped/incomplete docs via reconcileDroppedDocs)
// and O49 (low-confidence-and-material txns via flagsForReview) into one review surface.
const _m = fmtMoney;
const _m0 = fmtMoney;

export default function ReviewView() {
  const { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, glBreakdown, getAccountByRole, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view,
    reconcileDroppedDocs, flagsForReview, reviewApprove, reviewOverride, resolveIntakeItem, setReturnTo, companyDataLoaded, statementExceptionsLoadFailed,
    controlTotals, signOffPeriod, reopenPeriod, signOffReadinessFor, reviewedThrough, signoffs, bankMatch, isOwner, isAdmin, isReviewer, anomalies, dismissAnomaly, anomalyComments, addAnomalyComment, statementExceptions, offerReconciliation } = useERP();

  // ── O60 dropped/incomplete docs (async) + O49 flagged txns (sync) → one queue ──
  const [dropped, setDropped] = React.useState([]);
  const [loadingDropped, setLoadingDropped] = React.useState(true);
  const [droppedCheckFailed, setDroppedCheckFailed] = React.useState(false);   // O98 — 'we couldn't ask' is not 'nothing found'
  const [droppedLoaded, setDroppedLoaded] = React.useState(false);   // has the FIRST reconcile completed? ("loaded" ≠ "empty")
  const [busyId, setBusyId] = React.useState(null);
  const [overrideFor, setOverrideFor] = React.useState(null);   // flagged-txn id being overridden
  const [overrideCode, setOverrideCode] = React.useState("");
  const [askFor, setAskFor] = React.useState(null);             // flagged-txn id with the "ask client" panel open
  const [askDraft, setAskDraft] = React.useState("");          // the drafted plain-language question
  const [askAnswer, setAskAnswer] = React.useState("");        // the client's answer (pre-O82: pasted manually)
  const [copied, setCopied] = React.useState(false);
  // O83 anomaly dismissal (reviewer-only; resolve is AUTO-only, so the sole human verb is
  // dismiss-with-reason). `dismissFor` = the anomaly id whose reason box is open.
  const [dismissFor, setDismissFor] = React.useState(null);
  const [dismissReason, setDismissReason] = React.useState("");
  const [dismissBusy, setDismissBusy] = React.useState(false);
  // Documents attached to the dismissal being composed. OPTIONAL, always — see
  // `anomalyNotes.js` for why a requirement would make this worse rather than stricter.
  const [dismissDocs, setDismissDocs] = React.useState([]);
  const onDismissAnomaly = async (id) => {
    if (!dismissAnomaly || !dismissReason.trim()) return;
    setDismissBusy(true);
    const r = await dismissAnomaly(id, dismissReason.trim(), dismissDocs);
    setDismissBusy(false);
    if (r && r.ok) { setDismissFor(null); setDismissReason(""); setDismissDocs([]); }
    else showNotification(`Couldn't dismiss — ${(r && r.error) || "unknown error"}`, "error");
  };

  // ── THE OWNER'S HALF: context without a clear verb ───────────────────────────
  // Anyone on the company may add a note; only a reviewer may dismiss. A comment never
  // touches `status`, so this adds knowledge without touching who decides.
  const [commentFor, setCommentFor] = React.useState(null);
  const [commentDraft, setCommentDraft] = React.useState("");
  const [commentBusy, setCommentBusy] = React.useState(false);
  const onAddComment = async (id) => {
    const v = validateComment(commentDraft);
    if (!v.ok) { showNotification(v.error, "error"); return; }
    setCommentBusy(true);
    const r = addAnomalyComment ? await addAnomalyComment(id, v.text) : { ok: false, error: "unavailable" };
    setCommentBusy(false);
    if (r && r.ok) { setCommentFor(null); setCommentDraft(""); }
    else showNotification(`Couldn't save that note — ${(r && r.error) || "unknown error"}`, "error");
  };

  // Plain function (not useCallback): reconcileDroppedDocs is a fresh closure each ERP render,
  // so depending on it would re-run the effect every render (excess refetching). Run the load
  // once per company instead; action handlers call refreshDropped() directly to re-sync.
  const refreshDropped = async () => {
    setLoadingDropped(true);
    // O98 — an empty list means one of two very different things, and the screen must not
    // present them identically. `checked` says whether the query actually ran.
    try {
      const r = await (reconcileDroppedDocs ? reconcileDroppedDocs() : Promise.resolve({ ok: true, checked: true, dropped: [] }));
      setDropped(Array.isArray(r?.dropped) ? r.dropped : []);
      setDroppedCheckFailed(!r?.ok);
    }
    catch { setDropped([]); setDroppedCheckFailed(true); }
    finally { setLoadingDropped(false); setDroppedLoaded(true); }
  };
  React.useEffect(() => { setDroppedLoaded(false); refreshDropped(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [currentCompany?.id]);

  const flagged = flagsForReview ? flagsForReview() : [];
  const accuracyFlags = (controlTotals && controlTotals.flags) || [];   // O59 third net
  const { completeness, needsReview, unknown, accuracy, anomaly, statementException, summary } = buildReviewQueue({ droppedDocs: dropped, flaggedTxns: flagged, unknownDocs, accuracyFlags, anomalies, statementExceptions });
  // O83: attestation is a REVIEWER action (accountant/admin), NOT the client-owner.
  const canSignOff = !!isReviewer;
  const [signingOff, setSigningOff] = React.useState(false);
  // The reviewer chooses the period explicitly (defaults to the current month, NOT forced).
  // C196(6) — open on the FIRST UNSIGNED month with activity, not the current calendar month.
  // Three drives running, Review opened on August while the work to review was months earlier.
  // Falls back to today when everything is signed (nothing to do) or there's no activity yet.
  const activityMonths = React.useMemo(() => {
    const set = new Set();
    for (const i of (invoices || [])) {
      if (!i || i.status === "voided" || i.status === "deleted" || i.deleted_at) continue;
      const m = String(i.date || "").slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(m)) set.add(m);
    }
    return [...set];
  }, [invoices]);
  const [signOffMonth, setSignOffMonth] = React.useState(() =>
    firstUnsignedMonth({ months: activityMonths, signoffs, fallback: todayLocal().slice(0, 7) }));
  // Re-seat the default ONCE data has loaded (the first render can precede invoices/signoffs).
  const monthSeeded = React.useRef(false);
  React.useEffect(() => {
    if (monthSeeded.current || !activityMonths.length) return;
    monthSeeded.current = true;
    const m = firstUnsignedMonth({ months: activityMonths, signoffs, fallback: todayLocal().slice(0, 7) });
    if (m) setSignOffMonth(m);
  }, [activityMonths, signoffs]);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  // SINGLE-SOURCE readiness for the chosen period (preconditions + the four nets) — the SAME
  // pure gate signOffPeriod re-checks at write time, fed the dropped set this view already
  // loaded. This is the CPA surface, so accounting terms are fine (unlike the owner TrustPanel).
  const readiness = (signOffReadinessFor ? signOffReadinessFor(signOffMonth, dropped) : { ok: true, blockers: [] });
  const signOffBlockers = readiness.blockers.map(b => b.reason);
  const canAttest = readiness.ok;
  // Does the SELECTED month already have an active (non-revoked) sign-off? `signoffs` is the
  // active set (fetchSignoffs filters revoked_at IS NULL). When true, the card must show the
  // signed state ONLY — never "ready to sign off" + the primary button for a month already
  // attested (the contradictory signed-and-ready-simultaneously bug). Selecting a different
  // unsigned month re-derives to the normal ready/blocked gate.
  const monthSignedOff = isPeriodSignedOff(signoffs, signOffMonth);
  const onSignOff = async () => {
    if (!signOffPeriod || !canAttest) return;
    setSigningOff(true);
    const r = await signOffPeriod(signOffMonth);
    setSigningOff(false);
    if (!r.ok && r.blockers) showNotification(`Can't sign off yet — ${r.blockers.map(b => b.reason).join("; ")}`, "error");
  };
  // Explicit override: sign off DESPITE open blockers, with a required reason that is
  // recorded on the sign-off record (override_ack + reason + the blockers overridden).
  const onSignOffOverride = async () => {
    if (!signOffPeriod) return;
    if (!overrideReason.trim()) { showNotification("Add a reason to sign off over the open items.", "error"); return; }
    setSigningOff(true);
    const r = await signOffPeriod(signOffMonth, { override: { acknowledged: true, reason: overrideReason.trim() } });
    setSigningOff(false);
    if (r.ok) { setOverrideOpen(false); setOverrideReason(""); }
    else showNotification(`Couldn't sign off — ${r.error || (r.blockers || []).map(b => b.reason).join("; ")}`, "error");
  };
  const onReopen = async (period = reviewedThrough) => {
    if (!reopenPeriod || !period) return;
    const r = await reopenPeriod(period);
    if (!r.ok) showNotification(`Couldn't reopen — ${r.error}`, "error");
  };
  // STABLE LOAD GATE: hold a single loading state until BOTH the company data (invoices — the
  // flag source) AND the first dropped-docs reconcile have loaded. "not loaded" is distinct
  // from "empty/all-clear", so we never flash the all-clear or a partial mid-load state.
  const ready = (companyDataLoaded !== false) && droppedLoaded;

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
        {statCard("ACCURACY CHECKS OFF", summary.accuracyCount, summary.accuracyCount > 0 ? "var(--sc-error)" : "var(--sc-success)")}
        {statCard("UNUSUAL ACTIVITY", summary.anomalyCount, summary.anomalyCount > 0 ? "var(--sc-warning)" : "var(--sc-success)")}
        {statCard("STATEMENT EXCEPTIONS", summary.statementExceptionCount, summary.statementExceptionCount > 0 ? "var(--sc-warning)" : "var(--sc-success)")}
        {statCard("$ FLAGGED FOR REVIEW", _m0(summary.totalExposure), summary.totalExposure > 0 ? "var(--sc-gold)" : "var(--sc-success)")}
      </div>

      {/* ── STATEMENT EXCEPTIONS (C186) — what the automatic pipeline could NOT safely handle
             (low-confidence categorization, dated in a signed month, unmatched, couldn't book,
             or a statement whose ending balance didn't net). Plain-language; surfaced for the
             CPA to resolve. Counts toward the queue but does NOT change sign-off gating. ── */}
      {statementException.length > 0 && (
        <div style={{ border: "1px solid var(--sc-warning)", background: "var(--sc-warning-soft)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-warning)", marginBottom: 10 }}>📄 {(() => { const ready = statementException.filter(i => i.state === "ready").length; const stuck = statementException.length - ready;
                return [stuck ? `${stuck} statement ${stuck === 1 ? "item" : "items"} the pipeline couldn't finish` : "", ready ? `${ready} ready to check against the bank` : ""].filter(Boolean).join(" · "); })()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {statementException.map((x) => (
              <div key={x.id} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--sc-text)" }}>
                      {x.title || "Statement line"}{x.amount != null && x.kind === "line" ? ` · ${fmtSignedMoney(x.amount)}` : ""}{x.date ? ` · ${fmtDate(x.date)}` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 3 }}>{x.plain}</div>
                  </div>
                  {/* C198·1 (k) — a LINE exception is Bank Import's job (categorize + book
                      one line). A STATEMENT-level one is about the whole period's balance,
                      and Bank Import renders an EMPTY screen for it once the lines are
                      booked (the live dead end). Send it to Reconcile, carrying the account
                      and month so the session opens ready instead of asking for the file. */}
                  {(() => {
                    const target = statementExceptionTarget(x);
                    if (target.view === "bank") return (
                      <button onClick={() => setView && setView("bank")}
                        style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer", flexShrink: 0 }}>
                        Open in Bank Import →
                      </button>
                    );
                    return (
                      <button onClick={() => {
                        offerReconciliation && offerReconciliation({
                          id: x.statement_id, bank_account_id: x.bank_account_id,
                          period_start: x.period_start, period_end: x.period_end,
                          stated_ending_balance: x.stated_ending_balance,
                        });
                        setView && setView("recon");
                      }}
                        style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: x.state === "ready" ? "var(--sc-gold)" : "var(--sc-surface)", border: x.state === "ready" ? "none" : "1px solid var(--sc-border-2)", color: x.state === "ready" ? "var(--sc-on-accent)" : "var(--sc-text-2)", cursor: "pointer", flexShrink: 0 }}>
                        {OPEN_RECONCILE_LABEL}
                      </button>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── UNUSUAL ACTIVITY (O83) — persisted anomaly records. All severities are VISIBLE
             here (CPA-side, full technical detail is fine); only HIGH-in-period BLOCKS
             sign-off (handled in signOffReadiness). Resolve is AUTO-only (next scan clears a
             fixed condition); the reviewer's one verb is dismiss-with-reason. ── */}
      {anomaly.length > 0 && (
        <div style={{ border: "1px solid var(--sc-warning)", background: "var(--sc-warning-soft)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-warning)", marginBottom: 10 }}>⚠ {anomaly.length} unusual {anomaly.length === 1 ? "pattern" : "patterns"} detected · awaiting review</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {anomaly.map((a) => {
              const sevColor = a.severity === "high" ? "var(--sc-error)" : a.severity === "medium" ? "var(--sc-warning)" : "var(--sc-text-2)";
              return (
                <div key={a.id} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--sc-text)" }}>
                        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.5, color: sevColor, marginRight: 8 }}>{a.severity}</span>
                        {a.title}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 3 }}>{a.detail}</div>
                      {/* ★★ THE ENTRIES THE CARD IS ABOUT, INLINE. Dismissing JUDGES a
                          condition acceptable — a review act — and this screen used to
                          offer that judgement with no sight of the transactions, while the
                          OWNER's panel linked to them. Exactly backwards: the person making
                          the call had the least context. A duplicate judgment should be one
                          glance, not a navigate-away. */}
                      {(() => {
                        const ev = anomalyEvidence(a, invoices);
                        if (!ev.total) return null;
                        return (
                          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                            {ev.entries.map((e) => (
                              <button key={String(e.id)} onClick={() => { setReturnTo({ view: "review", label: "Review" }); setSelectedInvoice(e); setView("detail"); }}
                                style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", width: "100%", padding: "6px 9px", borderRadius: 7, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border)", cursor: "pointer", fontSize: 12, color: "var(--sc-text-2)" }}>
                                <span style={{ fontFamily: "'DM Mono',monospace", flexShrink: 0 }}>{e.date ? fmtDate(e.date) : "—"}</span>
                                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--sc-text)" }}>{e.vendor || e.description || "—"}</span>
                                <span style={{ fontFamily: "'DM Mono',monospace", fontWeight: 600, flexShrink: 0 }}>{fmtMoney(e.amount)}</span>
                                <span style={{ color: "var(--sc-gold)", flexShrink: 0 }}>→</span>
                              </button>
                            ))}
                            {/* A ref that no longer resolves is REPORTED, not dropped — O87(v)
                                was exactly this, and silence made three cards unplaceable. */}
                            {ev.missing > 0 && (
                              <div style={{ fontSize: 11, color: "var(--sc-text-mut)" }}>
                                {ev.missing} of {ev.total} linked {ev.total === 1 ? "entry" : "entries"} can no longer be found — it may have been removed since this was flagged.
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    {/* Reviewer-only, PERMANENTLY: dismissing judges a condition acceptable — a
                        review act. The client sees anomalies reflected in their trust panel but
                        can't clear them (client-side dismissal = self-attestation per anomaly). */}
                    {isReviewer && dismissFor !== a.id && (
                      <button onClick={() => { setDismissFor(a.id); setDismissReason(""); setDismissDocs([]); }}
                        style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer", flexShrink: 0 }}>
                        Dismiss…
                      </button>
                    )}
                  </div>
                  {/* ★★ THE COMMENT THREAD — DELIBERATELY NOT GATED ON `isReviewer`.
                      Dismissing is a judgement and stays reviewer-only forever; a comment
                      is not a clear action and never touches `status`. The owner is usually
                      the only person who knows why a charge is fine, and until now the card
                      offered them nothing to do but read it. They inform the judgement; the
                      reviewer makes it. */}
                  {(() => {
                    const thread = commentsFor(anomalyComments, a.id);
                    return (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--sc-border-2)" }}>
                        {thread.length > 0 && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 8 }}>
                            {thread.map((c) => (
                              <div key={String(c.id)} style={{ fontSize: 12, color: "var(--sc-text-2)", background: "var(--sc-surface-2)", borderRadius: 8, padding: "7px 10px" }}>
                                <div style={{ color: "var(--sc-text)" }}>{c.body}</div>
                                <div style={{ fontSize: 11, color: "var(--sc-text-mut)", marginTop: 3 }}>
                                  {c.author_name || "someone on your team"}{c.created_at ? ` · ${agoPhrase(c.created_at)}` : ""}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        {commentFor === a.id ? (
                          <div>
                            <textarea value={commentDraft} onChange={(e) => setCommentDraft(e.target.value)} rows={2}
                              placeholder="What should the reviewer know about this?"
                              style={{ width: "100%", padding: "9px 11px", borderRadius: 9, fontSize: 13, border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", background: "var(--sc-surface)", resize: "vertical", boxSizing: "border-box" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 6 }}>
                              {/* Says what this does and, as importantly, what it does NOT do. */}
                              <span style={{ fontSize: 11, color: "var(--sc-text-mut)" }}>This adds context. It doesn't clear the flag.</span>
                              <span style={{ display: "flex", gap: 8 }}>
                                <button onClick={() => { setCommentFor(null); setCommentDraft(""); }} style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Cancel</button>
                                <button onClick={() => onAddComment(a.id)} disabled={commentBusy || !commentDraft.trim()}
                                  style={{ padding: "7px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", cursor: (commentBusy || !commentDraft.trim()) ? "not-allowed" : "pointer", background: (commentBusy || !commentDraft.trim()) ? "var(--sc-border)" : "var(--sc-accent)", color: (commentBusy || !commentDraft.trim()) ? "var(--sc-text-mut)" : "var(--sc-on-accent)" }}>
                                  {commentBusy ? "Saving…" : "Add note"}
                                </button>
                              </span>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => { setCommentFor(a.id); setCommentDraft(""); }}
                            style={{ padding: "6px 10px", borderRadius: 8, fontSize: 12, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>
                            {thread.length ? "Add another note" : "Add a note"}
                          </button>
                        )}
                      </div>
                    );
                  })()}
                  {isReviewer && dismissFor === a.id && (
                    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--sc-border-2)" }}>
                      <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginBottom: 6 }}>Dismissing records a reason and stops this flag from reappearing. (If you fix the underlying cause instead, it clears itself on the next check.)</div>
                      <textarea value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} rows={2}
                        placeholder="Why is this acceptable? (required)…"
                        style={{ width: "100%", padding: "9px 11px", borderRadius: 9, fontSize: 13, border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", background: "var(--sc-surface)", resize: "vertical", boxSizing: "border-box" }} />
                      {/* ★★ EVIDENCE — OPTIONAL, AND THE PROMPT READS THE AMOUNTS, NOT THE WORDS.
                          A reason says what someone concluded; a document shows why. Requiring
                          one would produce attachments chosen for being nearest, which is worse
                          than none because it looks like support. Above a threshold we suggest;
                          we never block. The suggestion is computed from the linked entries'
                          amounts, so it cannot fire on a $12 charge whose title says "large". */}
                      {(() => {
                        const ev = anomalyEvidence(a, invoices);
                        const p = evidencePrompt({ amounts: (ev.entries || []).map((e) => e.amount), attachedCount: dismissDocs.length });
                        const lib = (docLibrary || []).slice(0, 60);
                        return (
                          <div style={{ marginTop: 10 }}>
                            {p.suggest && (
                              <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginBottom: 6 }}>{p.sentence}</div>
                            )}
                            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--sc-text-mut)", marginBottom: 5 }}>
                              Attach supporting documents {dismissDocs.length > 0 ? `· ${dismissDocs.length} selected` : "· optional"}
                            </div>
                            {lib.length === 0 ? (
                              <div style={{ fontSize: 12, color: "var(--sc-text-mut)" }}>Nothing in the document library yet to attach.</div>
                            ) : (
                              <div style={{ maxHeight: 132, overflowY: "auto", border: "1px solid var(--sc-border)", borderRadius: 8, padding: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                                {lib.map((d) => {
                                  const on = dismissDocs.includes(String(d.id));
                                  return (
                                    <label key={String(d.id)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--sc-text-2)", cursor: "pointer", padding: "3px 4px" }}>
                                      <input type="checkbox" checked={on}
                                        onChange={() => setDismissDocs((prev) => on ? prev.filter((x) => x !== String(d.id)) : [...prev, String(d.id)])} />
                                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.name || "document"}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                        <button onClick={() => { setDismissFor(null); setDismissReason(""); setDismissDocs([]); }} style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Cancel</button>
                        <button onClick={() => onDismissAnomaly(a.id)} disabled={dismissBusy || !dismissReason.trim()}
                          style={{ padding: "8px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, border: "none", cursor: (dismissBusy || !dismissReason.trim()) ? "not-allowed" : "pointer", background: (dismissBusy || !dismissReason.trim()) ? "var(--sc-border)" : "var(--sc-warning)", color: (dismissBusy || !dismissReason.trim()) ? "var(--sc-text-mut)" : "var(--sc-on-accent)" }}>
                          {dismissBusy ? "Dismissing…" : "Dismiss"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ACCURACY (O59 THIRD NET) — control totals that should tie and don't ── */}
      {accuracy.length > 0 && (
        <div style={{ border: "1px solid var(--sc-error)", background: "var(--sc-error-soft)", borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-error)", marginBottom: 8 }}>⚠ {accuracy.length} figure{accuracy.length === 1 ? "" : "s"} that should match but don't</div>
          {accuracy.map((f, i) => (
            <div key={f.key || i} style={{ fontSize: 13, color: "var(--sc-text)", marginBottom: i < accuracy.length - 1 ? 8 : 0 }}>
              <div style={{ fontWeight: 600 }}>{f.title}</div>
              <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>{f.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* CPA sign-off card moved OUT of this fragment — it now renders ABOVE the all-clear /
          queue branch (see signOffCard) so it's reachable when all clear (the state in which
          it's actually enabled), not hidden by the empty-state. */}

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
                  <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>
                    {d.received_at ? `Arrived ${fmtDate(d.received_at)}` : ""}{d.age_minutes != null ? ` · ${agoPhrase(d.age_minutes)}` : ""} — {d.reason}
                    {/* ★ SAY WHETHER IT WILL CLEAR ON ITS OWN. A document whose FILE we
                        stored is picked back up by the drain (O97); one that arrived before
                        we stored bytes cannot be — and "Re-upload" is the only thing that
                        will ever help it. Without this the two look identical and the
                        reviewer cannot tell which of 21 rows needs them. */}
                    {d.resumable === false && (
                      <span style={{ display:"block", color:"var(--sc-warning)", marginTop:2 }}>
                        We didn't keep a copy of this one, so it needs uploading again — we can't retry it for you.
                      </span>
                    )}
                    {d.resumable === true && (
                      <span style={{ display:"block", color:"var(--sc-text-2)", marginTop:2 }}>
                        We still have this file and will keep retrying it — nothing to do unless it stays here.
                      </span>
                    )}
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
                        {t.date && <span style={{ fontSize: 12, color: "var(--sc-text-2)" }}>{fmtDate(t.date)}</span>}
                      </div>
                      <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>
                        AI chose <strong style={{ color: "var(--sc-text)" }}>{t.gl_code} {t.gl_name}</strong> — {t.reason}
                      </div>
                      {t.reasoning && <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 4, fontStyle: "italic" }}>“{t.reasoning}”</div>}
                      {Array.isArray(t.alternatives) && t.alternatives.length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 4 }}>Also considered: {t.alternatives.map(a => `${a.gl_code || ""} ${a.gl_name || ""}`.trim()).join(", ")}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <button disabled={busyId === t.id} onClick={() => onApprove(t)} style={{ padding: "8px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-success)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Approve</button>
                    {!isOv && <button disabled={busyId === t.id} onClick={() => { setOverrideFor(t.id); setOverrideCode(t.gl_code || ""); }} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-gold)", cursor: "pointer" }}>Override…</button>}
                    {isOv && (
                      <>
                        <select value={overrideCode} onChange={e => setOverrideCode(e.target.value)} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "var(--sc-text)", outline: "none", maxWidth: 280 }}>
                          <option value="">Recode to…</option>
                          {(CHART_OF_ACCOUNTS || []).map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                        </select>
                        <button disabled={busyId === t.id} onClick={() => onOverride(t)} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Save</button>
                        <button onClick={() => { setOverrideFor(null); setOverrideCode(""); }} style={{ padding: "8px 12px", borderRadius: 9, fontSize: 13, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Cancel</button>
                      </>
                    )}
                    {!isOv && <button disabled={busyId === t.id} onClick={() => onAskClient(t)} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", color: "var(--sc-gold)", cursor: "pointer" }}>💬 Ask the client</button>}
                    <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--sc-text-2)" }}>Leave it to decide later — it stays here.</span>
                  </div>

                  {/* Clarification loop (first slice): drafted plain-language question → client answers → resolve */}
                  {isAsk && (
                    <div style={{ marginTop: 12, background: "var(--sc-bg)", border: "1px solid var(--sc-gold-soft)", borderRadius: 11, padding: "14px 16px" }}>
                      <div style={{ fontSize: 10, letterSpacing: 1.2, color: "var(--sc-gold)", fontWeight: 600, marginBottom: 8 }}>ASK THE CLIENT — plain-language question (send via Slack/email/text)</div>
                      <div style={{ fontSize: 13, color: "var(--sc-text)", lineHeight: 1.55, background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 9, padding: "11px 13px" }}>{askDraft}</div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        <button onClick={onCopyQuestion} style={{ padding: "7px 13px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy question"}</button>
                        <span style={{ fontSize: 12, color: "var(--sc-text-2)", alignSelf: "center" }}>When O82 (channel) lands, the bot sends this and ingests the reply automatically.</span>
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

  // ── SIGN-OFF (O50/O83) — a REVIEWER attests an EXPLICIT period. Renders ABOVE the branch so
  // it's present in BOTH the all-clear state (enabled) and the has-work state (disabled + the
  // specific blockers + an explicit override). Gated to accountant/admin (is_company_reviewer);
  // the client-owner and members see a read-only status — they cannot self-attest. ──
  const signOffCard = (
    <div style={{ border: "1px solid var(--sc-border)", background: "var(--sc-surface)", borderRadius: 12, padding: "14px 16px", marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--sc-text)" }}>Reviewer sign-off</div>
          <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>
            {reviewedThrough ? `Reviewed through ${reviewedThrough}. ` : "Not yet signed off. "}
            {canSignOff
              ? (monthSignedOff
                  ? `${signOffMonth} is signed off.`
                  : (canAttest ? `Ready to sign off ${signOffMonth}.` : "Resolve the items below (or sign off with an override)."))
              : "Only your accountant/reviewer attests a period."}
          </div>
        </div>
        {canSignOff && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* Explicit period picker — the reviewer chooses which month to attest (not forced to today). */}
            <input type="month" value={signOffMonth} max={todayLocal().slice(0, 7)}
              onChange={e => { setSignOffMonth(e.target.value || todayLocal().slice(0, 7)); setOverrideOpen(false); }}
              style={{ padding: "8px 10px", borderRadius: 9, fontSize: 13, border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", background: "var(--sc-surface)" }} />
            {monthSignedOff ? (
              // The selected month is already attested — signed state ONLY: a neutral indicator
              // (no primary sign-off / "sign off anyway" button) + Reopen for THIS month.
              <>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "var(--sc-success-soft, var(--sc-border))", color: "var(--sc-success)" }}>
                  ✓ Signed off {signOffMonth}
                </span>
                <button onClick={() => onReopen(signOffMonth)}
                  style={{ padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>
                  Reopen {signOffMonth}
                </button>
              </>
            ) : (
              <>
                {reviewedThrough && (
                  <button onClick={() => onReopen(reviewedThrough)}
                    style={{ padding: "9px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>
                    Reopen {reviewedThrough}
                  </button>
                )}
                {canAttest ? (
                  <button onClick={onSignOff} disabled={signingOff}
                    style={{ padding: "9px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: signingOff ? "not-allowed" : "pointer",
                      background: signingOff ? "var(--sc-border)" : "var(--sc-success)", color: signingOff ? "var(--sc-text-mut)" : "var(--sc-on-accent)" }}>
                    {signingOff ? "Signing off…" : `Mark reviewed through ${signOffMonth}`}
                  </button>
                ) : (
                  <button onClick={() => setOverrideOpen(o => !o)} disabled={signingOff}
                    style={{ padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "1px solid var(--sc-warning)", cursor: "pointer",
                      background: "var(--sc-warning-soft)", color: "var(--sc-warning)" }}>
                    Sign off anyway…
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      {/* WHY it's blocked — CPA-side, the specific unresolved preconditions + nets. */}
      {canSignOff && !canAttest && !monthSignedOff && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--sc-border)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--sc-text-mut)", textTransform: "uppercase", marginBottom: 6 }}>Not ready to sign off {signOffMonth}</div>
          {signOffBlockers.map((b, i) => (
            <div key={i} style={{ fontSize: 12.5, color: "var(--sc-text)", display: "flex", gap: 7, alignItems: "flex-start", marginBottom: 3 }}>
              <span style={{ color: "var(--sc-warning)", fontWeight: 800, flexShrink: 0 }}>•</span><span>{b}</span>
            </div>
          ))}
          {/* Explicit override — sign off despite the open items, with a REQUIRED reason recorded on the record. */}
          {overrideOpen && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed var(--sc-border-2)" }}>
              <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginBottom: 6 }}>You're signing off with {signOffBlockers.length} open item{signOffBlockers.length === 1 ? "" : "s"}. This is recorded on the sign-off with your reason.</div>
              <textarea value={overrideReason} onChange={e => setOverrideReason(e.target.value)} rows={2}
                placeholder="Reason for signing off despite the open items (required)…"
                style={{ width: "100%", padding: "9px 11px", borderRadius: 9, fontSize: 13, border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", background: "var(--sc-surface)", resize: "vertical", boxSizing: "border-box" }} />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={onSignOffOverride} disabled={signingOff || !overrideReason.trim()}
                  style={{ padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: (signingOff || !overrideReason.trim()) ? "not-allowed" : "pointer",
                    background: (signingOff || !overrideReason.trim()) ? "var(--sc-border)" : "var(--sc-warning)", color: (signingOff || !overrideReason.trim()) ? "var(--sc-text-mut)" : "var(--sc-on-accent)" }}>
                  {signingOff ? "Signing off…" : `Sign off ${signOffMonth} with override`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
            <div>
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"var(--sc-text-2)", marginBottom:8 }}>CPA REVIEW</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Review</h1>
                <div style={{ fontSize:13, color:"var(--sc-text-2)", marginTop:6 }}>Everything the trust layer flagged for a human: documents that didn't fully record, and transactions the AI wasn't sure about. Approve, override, or resolve — an empty screen means the books are clean.</div>
              </div>
              {/* Sign-off card is ALWAYS present once loaded — reachable when all-clear (enabled)
                  AND when there's work (disabled + the specific blockers). This is the fix for the
                  card being hidden by the all-clear empty state. */}
              {ready && signOffCard}

              {/* ── O102 — RUN THE CALIBRATION CHECK ─────────────────────────────
                  The ladder computes what it WOULD have booked and books nothing; the report
                  scores that against the signed criteria. Placed here because the person who
                  reads the verdict is the one who signs the months it is scored against.
                  ★ It runs the pass TWICE over identical input — a verdict that varies between
                  runs is an automatic fail, and one pass cannot detect that at all. */}
              {ready && canSignOff && <ShadowCalibrationCard />}
              {!ready ? (
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:48, textAlign:"center", color:"var(--sc-text-2)", fontSize:13 }}>Loading your review queue…</div>
              ) : (droppedCheckFailed || statementExceptionsLoadFailed) ? (
                /* ★★ O98 — "WE COULDN'T ASK" IS NOT "NOTHING FOUND". The completeness check
                   returning an empty list used to be indistinguishable from it FAILING, so a
                   broken query rendered as a green "All clear — nothing needs review" on the
                   screen whose whole job is to be trustworthy. The claim made here is about
                   the QUERY, never about the books. */
                <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-warning-soft)", borderRadius:14, padding:48, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⚠</div>
                  <div style={{ fontSize:16, fontWeight:600, marginBottom:8, color:"var(--sc-warning)" }}>We couldn't finish checking just now</div>
                  <div style={{ fontSize:13, color:"var(--sc-text-2)", maxWidth:420, margin:"0 auto" }}>This isn't a problem with your books — one of our checks didn't finish, so we're not going to tell you everything's clear when we can't confirm it. Try again in a moment.</div>
                  <button onClick={refreshDropped} style={{ marginTop:16, padding:"8px 16px", borderRadius:8, fontSize:13, fontWeight:600, background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text)", cursor:"pointer" }}>Try again</button>
                </div>
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
                    const fmt = fmtSignedMoney;
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
                        date: doc.journal_entry.date || todayLocal(),
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
                                          date: match.date || todayLocal(),
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


// ─────────────────────────────────────────────────────────────────────────────
// O102 — the shadow calibration check. Runs the ladder over a range and scores it.
// It BOOKS NOTHING: a test asserts this component holds no booking primitive.
// ─────────────────────────────────────────────────────────────────────────────
function ShadowCalibrationCard() {
  const { runShadowCalibration, shadowResult, invoices } = useERP();
  const [open, setOpen] = React.useState(false);

  // Default to the whole span the books cover, so the operator does not have to guess a
  // range — and the report itself refuses to read a thin sample as a pass.
  const span = React.useMemo(() => {
    const dates = (invoices || []).map(i => String(i?.date || "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null;
  }, [invoices]);
  const [from, setFrom] = React.useState(span?.from || "");
  const [to, setTo] = React.useState(span?.to || "");
  React.useEffect(() => { if (span && !from) { setFrom(span.from); setTo(span.to); } }, [span]);   // eslint-disable-line react-hooks/exhaustive-deps

  const running = !!shadowResult?.running;
  const box = { background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:14, padding:"16px 20px", marginBottom:20 };
  const input = { background:"var(--sc-bg)", border:"1px solid var(--sc-border)", borderRadius:8, padding:"6px 10px", fontSize:12, color:"var(--sc-text)" };

  if (!open) {
    return (
      <div style={{ ...box, display:"flex", alignItems:"center", justifyContent:"space-between", gap:14 }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>Check how the new categorization would have done</div>
          <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:4, lineHeight:1.45 }}>
            Runs over months you have already signed off and compares its answers with yours. It changes nothing.
          </div>
        </div>
        <button onClick={()=>setOpen(true)} style={{ flexShrink:0, fontSize:12, fontWeight:600, padding:"8px 16px", borderRadius:8, border:"1px solid var(--sc-border)", background:"transparent", color:"var(--sc-text)", cursor:"pointer" }}>Open</button>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>Check how the new categorization would have done</div>
      <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap", marginBottom:12 }}>
        <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={input} />
        <span style={{ fontSize:12, color:"var(--sc-text-2)" }}>to</span>
        <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={input} />
        <button
          onClick={()=>runShadowCalibration && runShadowCalibration({ from, to })}
          disabled={running || !from || !to}
          style={{ fontSize:12, fontWeight:600, padding:"7px 16px", borderRadius:8, border:"1px solid var(--sc-gold)", background:"var(--sc-gold-soft)", color:"var(--sc-text)", cursor: running || !from || !to ? "not-allowed" : "pointer" }}>
          {running ? "Running…" : "Run the check"}
        </button>
      </div>
      {/* §9 — every line below is read off the recorded result. There is no branch that can
          describe a run that did not happen. */}
      {shadowResult?.error && (
        <div style={{ fontSize:12, color:"var(--sc-error)", lineHeight:1.5 }}>
          The check couldn't finish, so there is nothing to read from it — {shadowResult.error}
        </div>
      )}
      {shadowResult?.copy && (
        <div style={{ fontSize:12.5, color:"var(--sc-text)", lineHeight:1.6, whiteSpace:"pre-wrap" }}>{shadowResult.copy}</div>
      )}
    </div>
  );
}
