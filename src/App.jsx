import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { supabase, getAuthHeaders } from "./lib/supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS, AI_PROXY_URL, CAPITALIZE_THRESHOLD, CAPITALIZE_CHECK_THRESHOLD, MEALS_DEDUCTIBLE_RATE, DEFAULT_IBR, AI_CONFIDENCE_AUTO_BOOK, AI_CONFIDENCE_REVIEW, AP_AUTO_APPROVE_THRESHOLD, PLATFORM_ADMIN_EMAILS } from "./lib/constants";
import { useAccounts } from "./hooks/useAccounts";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType, calcASC842 } from "./lib/gl";
import { initials, vendorColor, deriveDueDate, todayLocal, ymdLocal, addMonthsClampedYMD, addDaysYMD, fmtSignedMoney, fmtApprox } from "./lib/format";
import { validateUpload } from "./lib/uploadGuard";
import { classifyIntent, runAIBrain, okAIResponse, callAIProxy } from "./lib/ai";
import { buildMonthlyReport, priorPeriod, formatPeriod, computeRevenue, computeExpenses, liveEntries, glAccountBalance, glCashOnHand, openPayables } from "./lib/reports";
import { loadClientProfile, learnFromBooking, learnFromCorrection, persistClientProfile, emptyProfile, addCustomRule, recallVendor } from "./lib/clientProfile";
import { draftClientQuestion, plainCategoryPhrase, describeBooking, containsOwnerJargon } from "./lib/clarify";
import { planStatementPipeline, pipelineStatementStatus } from "./lib/pipeline";
import { checkedRowUpdate, checkedIdsUpdate, getWriteFailures, resetWriteFailures, writeFailureSentence } from "./lib/checkedWrite";
import { priorOutstandingCandidates, stillOutstandingSigned, candidatesToOutstandingBooks } from "./lib/outstandingItems";
import { reconBooksBalance, reconcileDifference, canCompleteReconciliation, statementBalanceVerified, supersedableOpenReconciliations } from "./lib/reconcile";
import { isAllowedAIAction, isMutatingAIAction, isDestructiveAIAction, AI_CAPABILITIES } from "./lib/aiCapabilities";
import { routeAIActions, buildPendingConfirmation } from "./lib/aiActionGate";
import { findDuplicate, detectRecurringPatterns, runAnomalyDetection } from "./lib/insights";
import { reconcileAnomalies, anomalyInsertRow, openHighAnomaliesInPeriod, applyPatternSuppression, anomaliesExpiredBySignoff, anomaliesReopenedByRevoke, ANOMALY_RESOLUTION, ATTESTED_NOTE } from "./lib/anomalies";
import { getTaxDeadlines, taxEstimate } from "./lib/tax";
import { buildApprovalUpdate, buildAccountInsert, buildCompanyUpdate, mapCompanyRow } from "./lib/writeShapes";
import { buildVendorRuleRow, buildRecurringRow, insertVerified, updateVerified, deleteVerified } from "./lib/chatActions";
import { INTAKE_STATUS, buildIntakeRow, insertIntake, setIntakeStatus, fetchDroppedIntake, fetchIntakeRows, hashFile } from "./lib/documentIntake";
import { flaggedForReview, reviewSummary, autoBookDecision } from "./lib/confidenceFlag";
import { computeControlTotals, bankMatchStatus, signOffReadiness, bookedEntriesInPeriod, reconciliationCoversPeriod } from "./lib/controlTotals";
import { persistSignoff, revokeSignoff, fetchSignoffs, latestReviewedThrough, canAttestPeriod, isPeriodSignedOff } from "./lib/signoff";
import { signedPeriodForDate, rebookedIntoOpenMonth, signedPeriodOwnerCopy } from "./lib/signedPeriod";
import { monthLabel as signedMonthLabel } from "./lib/ownerTrust";
import { ownerTrustState } from "./lib/ownerTrust";
import { onboardingSteps } from "./lib/onboarding";
import { visibleNav, isReviewerSeat, navRedirect, BOOKS_GROUP, GATED_VIEW_REDIRECT_COPY, PREVIEW_AS_OWNER_ENTER_LABEL, PREVIEW_AS_OWNER_EXIT_LABEL } from "./lib/nav";
import { deriveStatementOpening, shouldProposeOpening, openingDiscrepancy, markAlreadyBooked, openingProposalCopy, periodMonthLabel, resolveAdoptedBalance, normalizeBankParse, bankTxnKey, bookedLineDirection } from "./lib/openingBalanceProposal";
import { buildStatementRow, buildStatementLineRows, statementPeriod, filterLiveExceptions } from "./lib/bankStatements";
import { statementAdvanceStatus, planStatementReupload, statementReadyToReconcile, statementCardState, statementExceptionTarget, reconciliationCoversStatement, allLinesSettled, READY_TO_RECONCILE_COPY, OPEN_RECONCILE_LABEL, STATEMENT_COMPLETED_AUDIT, autoBindAccount, shouldAutoCompleteReconciliation, intakeAdvanceFromLines, dropZoneOutcomeCopy, buildStashDetail, AUTO_RECONCILED_AUDIT, autoReconciledAuditDetail } from "./lib/statementLifecycle";
import { fileSha256Hex } from "./lib/contentHash";
import { bookingToastCopy, statementExceptionCopy, autoResolvableIntake, statementSummaryCopy, bankImportToastCopy } from "./lib/workbench";
import { buildPaymentEntry } from "./lib/payments";
import { planBankImport, isArMatch, buildBankLineEntry, allClearingsPosted, shouldRunApMatching, autoMatchBankLines, matchableOpenItems, resolveMatchedInvoices, isSettlementEntry } from "./lib/bankMatch";
import { planPayrollBankLines, flagIncompletePayroll } from "./lib/payroll";
import { glCodeForAccountType } from "./lib/bankAccounts";
import { enterSupportState, exitSupportState } from "./lib/supportMode";
import { pickActiveCompany } from "./lib/companies";
import { companyIdentityNames, classifyDocDirection } from "./lib/docDirection";
import { composeAssistantReply } from "./lib/chatReply";
import { buildReversalLines, buildJournalEntry } from "./lib/journalEntries";
import { buildDepreciationEntry, buildDepreciationSchedule, suggestUsefulLifeMonths, planDepreciationRun, depreciationDue, planDepreciationAutoPost } from "./lib/depreciation";
import { buildDeferredRevenueReceiptEntry, buildArInvoiceEntry } from "./lib/revenueEntries";
import { buildPrepaidCapitalizeEntry, buildPrepaidSchedule } from "./lib/prepaid";
import { detectFileType, TYPE_LABEL, planUniversalSpreadsheetRoute, classifyDocReply } from "./lib/fileDetect";
import { buildOpeningBalanceEntry, isBeforeCutoff, preCutoffActivity, hasPreCutoffActivity, bookingBlockedReason, PRE_CUTOFF_MESSAGE, OBE_CODE, OBE_ROLE } from "./lib/openingBalances";
import { fetchLedger, resolveEntryDbId, alreadyReversed } from "./lib/ledger";
import { Sentry, setSentryUser, clearSentryUser, isSentryEnabled } from "./lib/sentry";
import ChatRichOutput from "./components/ChatRichOutput";
import AuthScreen, { UpdatePasswordScreen } from "./components/AuthScreen";
import CompanySetup from "./components/CompanySetup";
import CompanySwitcher from "./components/CompanySwitcher";
import LegalView from "./components/LegalView";
import { ERPContext } from "./components/ERPContext";
import { usePersistedView } from "./hooks/usePersistedView";
import DashboardView from "./components/views/DashboardView";
import BooksView from "./components/views/BooksView";
import AddView from "./components/views/AddView";
import ApView from "./components/views/ApView";
import ArView from "./components/views/ArView";
import ReviewView from "./components/views/ReviewView";
import BankView from "./components/views/BankView";
import InvoicesView from "./components/views/InvoicesView";
import VendorsView from "./components/views/VendorsView";
import CustomersView from "./components/views/CustomersView";
import RulesView from "./components/views/RulesView";
import ReportsView from "./components/views/ReportsView";
import MatchingView from "./components/views/MatchingView";
import ContractsView from "./components/views/ContractsView";
import DetailView from "./components/views/DetailView";
import SettingsView from "./components/views/SettingsView";
import TeamView from "./components/views/TeamView";
import CoaView from "./components/views/CoaView";
import OpeningBalancesView from "./components/views/OpeningBalancesView";
import SendInvoiceView from "./components/views/SendInvoiceView";
import PayrollView from "./components/views/PayrollView";
import RecurringView from "./components/views/RecurringView";
import ReconView from "./components/views/ReconView";
import Tax1099View from "./components/views/Tax1099View";
import TaxView from "./components/views/TaxView";
import DocsView from "./components/views/DocsView";
import AuditView from "./components/views/AuditView";
import AdminView from "./components/views/AdminView";
import QBOImportView from "./components/views/QBOImportView";

// journal_entries.source has a CHECK constraint. The client uses richer internal
// source markers (e.g. "bank_feed", "contract", "gaap_classification") for app
// logic, so we normalize to the DB's allowed set only at the persistence boundary.
const VALID_JE_SOURCES = ["manual", "bank_import", "universal_upload", "recurring", "opening_balance", "ar_invoice", "payroll", "api", "qbo_import"];
const JE_SOURCE_MAP = {
  // document uploads (+ everything derived from an uploaded doc)
  universal_upload: "universal_upload", needs_review: "universal_upload", watch_trigger: "universal_upload",
  gaap_prepaid: "universal_upload", gaap_prepaid_amort: "universal_upload", gaap_classification: "universal_upload",
  contract: "universal_upload",                 // closest match per spec
  // bank-derived
  bank_statement: "bank_import", bank_feed: "bank_import", matching_engine: "bank_import",
  reconciliation: "bank_import", qbo_import: "qbo_import",   // QuickBooks import keeps its own source (migration 028)
  // already-valid / direct mappings
  recurring: "recurring", opening_balance: "opening_balance", payroll: "payroll",
  sent_invoice: "ar_invoice",
  reversal: "manual", manual: "manual",
};
const normalizeSource = (s) => {
  const v = String(s || "manual");
  return JE_SOURCE_MAP[v] || (VALID_JE_SOURCES.includes(v) ? v : "manual");
};

function AppWrapper() {
  const [session, setSession] = React.useState(undefined);
  const [companies, setCompanies] = React.useState([]);
  const [currentCompany, setCurrentCompany] = React.useState(null);
  const [showCompanySetup, setShowCompanySetup] = React.useState(false);
  const [appLoading, setAppLoading] = React.useState(true);
  const [recovery, setRecovery] = React.useState(false); // arrived via password-reset link
  // View lives here so it survives ERP remounts on auth/company changes
  const [persistedView, setPersistedView] = usePersistedView();
  // ── Team invite acceptance (Item 20): ?invite=TOKEN in the URL ──
  // Persisted so it survives an email-confirmation round-trip (where the user
  // returns without the URL param).
  const [inviteToken, setInviteToken] = React.useState(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("invite") || localStorage.getItem("cfai_pending_invite");
      if (t) localStorage.setItem("cfai_pending_invite", t);
      return t;
    } catch { return null; }
  });
  const [inviteInfo, setInviteInfo] = React.useState(null); // { companyName, role, expired, status } | { invalid } | { error }
  const inviteAcceptedRef = React.useRef(false);

  useEffect(() => {
    // Single source of truth: onAuthStateChange handles everything
    // getSession just primes the initial state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // TOKEN_REFRESHED fires when tab regains focus — ignore completely
      if (_event === "TOKEN_REFRESHED") return;

      // Password-reset link: hold the recovery session and show the "set new password"
      // screen instead of dropping the user into the app.
      if (_event === "PASSWORD_RECOVERY") {
        setSession(session);
        setRecovery(true);
        setAppLoading(false);
        return;
      }

      if (session) {
        setSession(session);
        // Only load companies if not already loaded (prevents remount on tab switch)
        setCurrentCompany(prev => {
          if (prev) return prev; // already loaded — don't trigger reload
          loadCompanies(session);
          return prev;
        });
      } else {
        setSession(null);
        setCompanies([]);
        setCurrentCompany(null);
        setAppLoading(false);
      }
    });

    // Prime with existing session on mount
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        setSession(session);
        loadCompanies(session);
      } else {
        setAppLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Tie Sentry errors to the signed-in user + active company (ids/email only);
  // clears automatically on logout (session becomes null).
  useEffect(() => {
    if (session?.user) setSentryUser(session.user, currentCompany);
    else clearSentryUser();
  }, [session?.user?.id, currentCompany?.id]);

  // Persist the ACTIVE company per user so a refresh restores it (was resetting to the
  // first company — a multi-company user could end up working in the wrong company's
  // books without noticing, a real data-integrity hazard). Durable across refresh;
  // restored + validated in loadCompanies. (A profile/DB store would add cross-device.)
  useEffect(() => {
    if (session?.user?.id && currentCompany?.id) {
      try { localStorage.setItem(`cfai_lastCompany_${session.user.id}`, String(currentCompany.id)); } catch {}
    }
  }, [session?.user?.id, currentCompany?.id]);

  // Look up the invite (company name + validity) for the pre-login banner.
  useEffect(() => {
    if (!inviteToken) return;
    supabase.rpc("invite_details", { p_token: inviteToken }).then(({ data }) => {
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) { setInviteInfo({ invalid: true }); try { localStorage.removeItem("cfai_pending_invite"); } catch {} }
      else setInviteInfo({ companyName: row.company_name, role: row.role, status: row.status, expired: row.expired });
    }).catch(() => setInviteInfo({ invalid: true }));
  }, [inviteToken]);

  // Once authenticated, accept the invite, switch into the company, and welcome them.
  useEffect(() => {
    if (!inviteToken || !session?.user || inviteAcceptedRef.current) return;
    inviteAcceptedRef.current = true;
    (async () => {
      try {
        const { data: companyId, error } = await supabase.rpc("accept_invite", { p_token: inviteToken });
        if (error) throw error;
        // Reload memberships and switch to the joined company.
        const { data } = await supabase.from("company_users")
          .select("company_id, role, companies(*)").eq("user_id", session.user.id).not("accepted_at", "is", null);
        const cos = (data || []).map(r => ({ ...r.companies, role: r.role }));
        setCompanies(cos);
        const joined = cos.find(c => c.id === companyId) || cos[0] || null;
        if (joined) { setCurrentCompany(joined); setShowCompanySetup(false); }
        try { localStorage.setItem("cfai_invite_welcome", joined?.name || "your new team"); } catch {}
        setAppLoading(false);
      } catch (e) {
        try { localStorage.setItem("cfai_invite_error", e?.message || "This invite link is invalid or has expired."); } catch {}
        setInviteInfo(prev => ({ ...(prev || {}), error: e?.message || "This invite link is invalid or has expired." }));
      } finally {
        try { localStorage.removeItem("cfai_pending_invite"); } catch {}
        try { const u = new URL(window.location.href); u.searchParams.delete("invite"); window.history.replaceState({}, "", u.toString()); } catch {}
        setInviteToken(null);
      }
    })();
  }, [session?.user?.id, inviteToken]);

  const loadCompanies = async (sess) => {
    setAppLoading(true);
    try {
      const { data } = await supabase
        .from("company_users")
        .select("company_id, role, companies(*)")
        .eq("user_id", sess.user.id)
        .not("accepted_at", "is", null);
      const cos = (data||[]).map(r=>({...r.companies, role:r.role}));
      setCompanies(cos);
      // Restore the last-selected company instead of always defaulting to the first —
      // pickActiveCompany validates it's still in the user's accepted list.
      let lastId = null;
      try { lastId = localStorage.getItem(`cfai_lastCompany_${sess.user.id}`); } catch {}
      const restored = pickActiveCompany(cos, lastId);
      setCurrentCompany(prev => prev || restored);
      if (cos.length === 0) setShowCompanySetup(true);
    } finally {
      setAppLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (session === undefined || appLoading) {
    return (
      <div style={{minHeight:"100vh",background:"var(--sc-bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
        <div style={{color:"var(--sc-text-2)",fontSize:14}}>Loading...</div>
      </div>
    );
  }

  if (recovery && session) {
    return <UpdatePasswordScreen onDone={()=>{ setRecovery(false); loadCompanies(session); }} />;
  }

  if (!session) return <AuthScreen onAuth={s=>setSession(s)} invite={inviteToken ? inviteInfo : null}/>;

  if (showCompanySetup) {
    return <CompanySetup session={session} onComplete={company=>{
      setCompanies(prev=>[...prev,company]);
      setCurrentCompany(company);
      setShowCompanySetup(false);
    }}/>;
  }

  if (!currentCompany) return null;

  return (
    <Sentry.ErrorBoundary fallback={<SentryFallback />}>
      <ERP
        session={session}
        currentCompany={currentCompany}
        companies={companies}
        onSwitchCompany={setCurrentCompany}
        setCurrentCompany={setCurrentCompany}
        setCompanies={setCompanies}
        onNewCompany={()=>setShowCompanySetup(true)}
        onSignOut={handleSignOut}
        supabase={supabase}
        persistedView={persistedView}
        onViewChange={setPersistedView}
      />
    </Sentry.ErrorBoundary>
  );
}

// Clean fallback shown when a render error reaches the Sentry boundary (the error
// is already reported to Sentry by the boundary).
function SentryFallback() {
  return (
    <div style={{ minHeight:"100vh", background:"var(--sc-bg)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'DM Sans', system-ui, sans-serif" }}>
      <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, boxShadow:"0 8px 28px rgba(17,24,39,0.10)", padding:32, maxWidth:480, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:34, marginBottom:10 }}>⚠️</div>
        <h1 style={{ fontSize:20, fontWeight:700, margin:"0 0 8px", color:"var(--sc-text)" }}>Something went wrong</h1>
        <p style={{ fontSize:14, color:"var(--sc-text-2)", lineHeight:1.6, margin:"0 0 20px" }}>{isSentryEnabled() ? "Our team has been notified. Refreshing usually fixes it." : "Refreshing usually fixes it. If it keeps happening, please let us know."}</p>
        <button onClick={()=>window.location.reload()}
          style={{ padding:"11px 22px", borderRadius:10, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:14, fontWeight:600, cursor:"pointer" }}>Refresh</button>
      </div>
    </div>
  );
}

function ERP({ session, currentCompany, companies, onSwitchCompany, setCurrentCompany, setCompanies, onNewCompany, onSignOut, supabase, persistedView, onViewChange }) {
  // ── Team roles (Item 20). owner < admin < member. Default to "owner" when a role
  // isn't present (single-user / legacy) so existing accounts keep full access.
  const userRole = currentCompany?.role || "owner";
  const isOwner = userRole === "owner";
  // `accountant` (the invited reviewer/CPA) is a write-capable role — treat it as admin
  // for UI write access (book/recode/review), same as an admin. (O83: separation of duties
  // is enforced only at ATTESTATION via canAttestPeriod, not by starving the CPA of access.)
  const isAdmin = userRole === "owner" || userRole === "admin" || userRole === "accountant";
  const isMember = userRole === "member";
  // ATTESTER: admin or accountant (reviewer roles) — NOT the plain client-owner. The write
  // path AND the CPA UI share this so the button, the write, and the DB policy can't disagree.
  const isReviewer = canAttestPeriod(userRole);
  // ── C197 IA COLLAPSE (★ NORTH STAR Phase 2) ────────────────────────────────
  // The SEAT decides which walls exist. Reviewer seat = the CPA cockpit (every
  // workbench surface); client seat = Home + Reports. Platform admins keep the
  // cockpit so Support Mode still reaches everything (same bypass shape as
  // `is_company_member`). `previewAsOwner` is the demo toggle: pure state, never
  // persisted, changes ONLY what renders — never the role, never write access.
  const isPlatformAdmin = PLATFORM_ADMIN_EMAILS.includes(session?.user?.email);
  const [previewAsOwner, setPreviewAsOwner] = useState(false);
  const canPreviewAsOwner = isReviewerSeat({ role: userRole, isPlatformAdmin });
  const navSeat = useMemo(
    () => visibleNav({ role: userRole, isPlatformAdmin, previewAsOwner }),
    [userRole, isPlatformAdmin, previewAsOwner]
  );

  const [invoices, setInvoices] = useState([]);
  const invoicesRef = useRef([]); // always-current invoices for async lookups (e.g. doc relinking)
  useEffect(() => { invoicesRef.current = invoices; }, [invoices]);
  const [rules, setRules] = useState([]); // { vendor, gl_code, gl_name, project }
  // Contacts: { id, name, type:"vendor"|"customer", gl_code, gl_name, payment_terms, email, phone, notes, tags:[], min_expected, max_expected, created_at }
  const [contacts, setContacts] = useState([]);
  const [customProjects, setCustomProjects] = useState([]);
  // View is lifted to AppWrapper so it survives remounts — never resets on refresh or tab switch
  const [view, setViewRaw] = useState(persistedView || "dashboard");
  const setView = (v) => { setViewRaw(v); onViewChange?.(v); };

  // Sync if persistedView changes (e.g. company switch)
  useEffect(() => {
    if (persistedView && persistedView !== view) setViewRaw(persistedView);
  }, [persistedView]); // eslint-disable-line
  // ── CLARIFICATION QUEUE ── invoices waiting for user input before booking
  const [clarificationQueue, setClarificationQueue] = useState([]); // [{id, invoice, question, options, queueItemId}]
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  // Navigation context for the transaction detail view — where the user came from,
  // so the back button can return there with the right label. {view, label, contact?, reportType?}
  const [returnTo, setReturnTo] = useState(null);
  const goBackFromDetail = () => {
    const r = returnTo;
    setReturnTo(null);
    if (!r) { setBooksFilter("all"); setView("books"); return; }
    if (r.view === "books") { setBooksFilter("all"); setView("books"); return; }
    if (r.view === "vendors") { if (r.contact) setVendorsSelectedContact(r.contact); setView("vendors"); return; }
    if (r.view === "reports") { if (r.reportType) setReportType(r.reportType); setView("reports"); return; }
    setView(r.view);
  };
  const [glDrilldown, setGlDrilldown] = useState(null); // gl_name being drilled into on the dashboard
  // Filter/report UI state persists across refresh via sessionStorage.
  const ss = (k, fb) => { try { return sessionStorage.getItem(k) ?? fb; } catch { return fb; } };
  const [booksFilter, setBooksFilter] = useState(() => ss("cfai_booksFilter", "all")); // Books tab filter: all|revenue|expenses|unpaid|review
  const [isAILoading, setIsAILoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"", paidWithCash:false });
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [notification, setNotification] = useState(null);
  const notifTimerRef = useRef(null);
  // Platform-admin Support Mode: { company, adminCompany } when viewing a client as admin.
  const [supportMode, setSupportMode] = useState(null);
  const [adminFailedCount, setAdminFailedCount] = useState(0); // failed uploads (24h) for the nav red dot
  const [aiStep, setAiStep] = useState(null);
  const [vendorFilter, setVendorFilter] = useState(() => ss("cfai_vendorFilter", "all"));

  // Universal upload state
  const [uploadQueue, setUploadQueue] = useState([]); // { id, file, name, status, type, result, error }
  const [universalDragOver, setUniversalDragOver] = useState(false);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [unknownDocs, setUnknownDocs] = useState([]); // { id, name, uploaded_at, ai_explanation, raw_text }

  // Bank feed state
  const [bankDragOver, setBankDragOver] = useState(false);
  const [bankProcessing, setBankProcessing] = useState(false);
  const [bankTransactions, setBankTransactions] = useState([]);
  const [bankStep, setBankStep] = useState(null);
  const [bankProgress, setBankProgress] = useState(0);
  const [bankFileName, setBankFileName] = useState("");
  // O83 — the cash opening-balance PROPOSAL derived from an uploaded statement (never
  // silently booked): { openingBalance, periodStart, accountCode, accountName, mismatch,
  // stated, derived }. And a DISCREPANCY flag when an opening already exists and disagrees.
  const [pendingOpeningProposal, setPendingOpeningProposal] = useState(null);
  const [openingDiscrepancyFlag, setOpeningDiscrepancyFlag] = useState(null);

  // Reports state — reportType (P&L / Balance Sheet / Cash Flow / …) persists across refresh
  // so the chosen report sub-tab survives a reload (same pattern as booksFilter/reportRange).
  const [reportType, setReportType] = useState(() => ss("cfai_reportType", "pl"));
  // Report drill-down state LIFTED out of ReportsView so it survives the transaction-detail
  // round-trip: Back from a drilled transaction returns to the line-item LIST (one level up),
  // not the report top. plDrill = the Income-Statement drill (rev-acct → exp-acct → exp-vendor);
  // drill = the other reports (vendor/gl/cashflow/project/bsacct); drillSel = in-drill slide-in.
  // Each is one navigation LEVEL; Back pops exactly one (see reportNavBack / goBackFromDetail).
  const [plDrill, setPlDrill] = useState(null);
  const [drill, setDrill] = useState(null);
  const [drillSel, setDrillSel] = useState(null);
  const [reportRange, setReportRange] = useState(() => ss("cfai_reportRange", "custom"));
  const [reportDateFrom, setReportDateFrom] = useState(() => ss("cfai_reportDateFrom", new Date().getFullYear() + "-01-01"));
  const [reportDateTo, setReportDateTo] = useState(() => ss("cfai_reportDateTo", todayLocal()));
  // Persist filter/report UI state whenever it changes.
  useEffect(() => { try {
    sessionStorage.setItem("cfai_booksFilter", booksFilter);
    sessionStorage.setItem("cfai_vendorFilter", vendorFilter);
    sessionStorage.setItem("cfai_reportRange", reportRange);
    sessionStorage.setItem("cfai_reportDateFrom", reportDateFrom);
    sessionStorage.setItem("cfai_reportDateTo", reportDateTo);
    sessionStorage.setItem("cfai_reportType", reportType);
  } catch {} }, [booksFilter, vendorFilter, reportRange, reportDateFrom, reportDateTo, reportType]);
  const [basisMode, setBasisMode] = useState("accrual"); // "cash" | "accrual" | "comparison"
  const [basisNarration, setBasisNarration] = useState(null);
  const [basisNarrationLoading, setBasisNarrationLoading] = useState(false);

  // Contracts state
  const [contracts, setContracts] = useState([]);
  const [contractProcessing, setContractProcessing] = useState(false);
  const [contractDragOver, setContractDragOver] = useState(false);
  const [selectedContract, setSelectedContract] = useState(null);
  const [contractView, setContractView] = useState("list"); // list | detail

  // Matching engine state
  const [matchQueue, setMatchQueue] = useState([]); // pending matches awaiting confirmation
  const [matchHistory, setMatchHistory] = useState([]); // confirmed/cleared matches
  const [matchProcessing, setMatchProcessing] = useState(false);

  // ── AUDIT TRAIL ───────────────────────────────────────────────────────────────
  const [auditLog, setAuditLog] = useState([]);
  // Non-dismissable banner shown if a booked entry isn't visible in the ledger (set by
  // flagBookingVisibilityFailure). Cleared only by a page refresh or a company switch.
  const [visibilityAlert, setVisibilityAlert] = useState(false);
  const logAudit = (action, detail, before=null, after=null, performedBy=null) => {
    // During Support Mode, attribute every action to the platform admin (unless the
    // caller passed an explicit actor, e.g. "AI Chat").
    const who = performedBy || (supportMode ? `Platform Admin - ${session?.user?.email || "admin"}` : "owner");
    setAuditLog(prev => [{
      id: Date.now()+Math.random(), ts: new Date().toISOString(),
      action, detail, before, after, user: who
    }, ...prev]);
    // Persist every audit entry to Supabase — fire-and-forget
    if (currentCompany?.id) {
      // Slim the before/after payload: strip any large fields (base64, line items) to keep row size small
      const slim = (obj) => {
        if (!obj) return null;
        if (typeof obj !== "object") return obj;
        if (Array.isArray(obj)) return obj.slice(0, 5).map(slim);
        const { base64, raw_text, notes_for_reviewer, ...rest } = obj;
        return rest;
      };
      supabase.from("audit_log").insert({
        company_id: currentCompany.id,
        action,
        detail,
        before_state: before ? slim(before) : null,
        after_state:  after  ? slim(after)  : null,
        performed_by: who,
      }).then(({ error }) => { if (error) console.error("Audit persist failed:", error.message, error.details); })
        .catch(e => console.error("Audit persist error:", e));
    }
  };
  // Convenience: log an action performed by the AI chat.
  const logAI = (action, detail, before=null, after=null) => logAudit(action, detail, before, after, "AI Chat");

  // ── PLATFORM ADMIN: Support Mode ──
  // Enter a client's context as admin (works because is_company_member() grants
  // platform admins access — migration 020 Option A). Remembers the admin's own
  // company so Exit returns cleanly.
  // Clear THIS session's upload/preview state so nothing the admin was looking at can
  // bleed across the support-mode boundary into the client view (O54a). resetCompanyState
  // (fired by the company-switch effect) also clears these, but doing it up front closes
  // the brief window during the transition.
  const clearTransientUploadState = () => {
    setUploadedFile(null); setUploadQueue([]); setUploadProcessing(false);
    setDocsPreview(null); fileStoreRef.current = {};
  };
  const enterSupport = (company) => {
    if (!company?.id) return;
    // Never enter support with one of the admin's OWN uploads still processing — its
    // async result (storeDocument/bookToDb) would land in the CLIENT's context (O54a).
    if (uploadActiveRef.current) { showNotification("Finish the current upload before entering Support Mode.", "error"); return; }
    // Preserve the REAL admin company even when entering support from within support
    // (nested), so Exit always returns to the admin's own account (O54b).
    const next = enterSupportState(supportMode, company, currentCompany);
    clearTransientUploadState();
    setSupportMode(next);
    onSwitchCompany(company);
    setView("dashboard");
    showNotification(`Support Mode — viewing ${company.name}`);
  };
  const exitSupport = () => {
    const { back } = exitSupportState(supportMode);   // read target directly — no side effect in a setState updater (O54b)
    setSupportMode(null);
    clearTransientUploadState();
    if (back?.id) onSwitchCompany(back);
    else showNotification("Returned to admin — couldn't resolve your original company; pick it from the switcher.", "error");
    setView("admin");
  };
  // Red-dot badge: failed uploads across all companies in the last 24h.
  useEffect(() => {
    if (!PLATFORM_ADMIN_EMAILS.includes(session?.user?.email)) return;
    let alive = true;
    const load = () => supabase.rpc("get_admin_failed_uploads", { p_days: 1 })
      .then(({ data }) => { if (alive) setAdminFailedCount(Array.isArray(data) ? data.length : 0); })
      .catch(() => {});
    load();
    const t = setInterval(load, 120000);
    return () => { alive = false; clearInterval(t); };
  }, [session?.user?.email]); // eslint-disable-line

  // ── DOCUMENT STORAGE ─────────────────────────────────────────────────────────
  const [docLibrary, setDocLibrary] = useState([]);
  // Records a document-save failure permanently on its upload-queue item (so the
  // user can read it), and also flashes a notification. Falls back to just the
  // flash when there's no queue item to attach to.
  const reportDocError = (queueItemId, msg) => {
    if (queueItemId) setUploadQueue(prev => prev.map(q => q.id === queueItemId ? { ...q, docError: msg } : q));
    showNotification(`Document not saved to cloud: ${msg}`, "error");
  };

  // base64 → Blob fallback (when callers only have the encoded string).
  const b64ToBlob = (b64, mime) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  };

  // Uploads the real file to Supabase Storage, then writes its metadata row —
  // atomically: if the metadata insert fails, the just-uploaded file is removed
  // so we never orphan a blob. Any failure is pinned to the upload-queue item.
  const storeDocument = async (name, base64, mediaType, type, linkedId=null, tags=[], queueItemId=null, file=null) => {
    const doc = { id: Date.now()+Math.random(), name, base64, mediaType, type, uploaded_at: new Date().toISOString(), linked_invoice_id: linkedId, tags, storage_path: null };
    let savedId = doc.id;   // C185: return the DURABLE documents.id when the insert resolves (both existing callers ignore the return; the bank-statement linkage needs the real id)
    setDocLibrary(prev => [doc, ...prev]);
    if (!currentCompany?.id) {
      console.warn("[documents] storeDocument: no currentCompany.id — NOT persisting", { name, type });
      reportDocError(queueItemId, "no active company — document was not saved.");
      return doc.id;
    }

    // ── C193 — CONTENT-HASH DEDUP: identical bytes link to the EXISTING document instead
    // of stacking another copy (the live library held 3× March + 3× Feb of one statement).
    // Scoped per company. A null hash (no WebCrypto / nothing to hash) simply means "not
    // deduped" — the partial unique index exempts NULL. Nothing is ever deleted.
    let contentHash = null;
    try {
      const hashBlob = file || (base64 ? b64ToBlob(base64, mediaType) : null);
      if (hashBlob) contentHash = await fileSha256Hex(hashBlob);
    } catch (e) { console.warn("[documents] hash skipped:", e?.message || e); }
    if (contentHash) {
      try {
        const { data: dupe } = await supabase.from("documents").select("id")
          .eq("company_id", currentCompany.id).eq("content_hash", contentHash).limit(1).maybeSingle();
        if (dupe?.id) {
          // Already stored — skip the storage upload AND the insert, drop the optimistic card,
          // and hand back the EXISTING id so callers (bank_statements.document_id) link to it.
          setDocLibrary(prev => prev.filter(d => d.id !== doc.id));
          if (queueItemId) setUploadQueue(prev => prev.map(q => q.id === queueItemId ? { ...q, docError: undefined } : q));
          return dupe.id;
        }
      } catch { /* column may not exist pre-059 → fall through and store normally */ }
    }

    // ── 1. Upload the actual file to Storage at {company_id}/{ts}_{safeName} ──
    let storagePath = null, fileSize = null;
    try {
      const blob = file || (base64 ? b64ToBlob(base64, mediaType) : null);
      if (blob) {
        const safeName = (name || "file").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
        const path = `${currentCompany.id}/${Date.now()}_${safeName}`;
        const { data: up, error: upErr } = await supabase.storage.from("documents")
          .upload(path, blob, { contentType: mediaType || undefined, upsert: false });
        if (upErr) {
          console.error("[documents] storage upload FAILED:", upErr.message, upErr);
          reportDocError(queueItemId, `file upload failed — ${upErr.message || "check the 'documents' storage bucket (migration 014)"}`);
          return doc.id;
        }
        storagePath = up?.path || path;
        fileSize = blob.size ?? null;
      }
    } catch (e) {
      console.error("[documents] upload threw:", e);
      reportDocError(queueItemId, e?.message || "file upload error.");
      return doc.id;
    }

    // ── 2. Insert the metadata row (with the storage path) ──
    // Prefer the invoice's durable db_entry_id if booking has already resolved by
    // now (the file upload above usually outlasts the booking RPC); otherwise the
    // in-session id is used and bookToDb's .then re-links it once it resolves.
    let effLinkedId = linkedId;
    if (linkedId != null) {
      const inv = (invoicesRef.current || []).find(i => String(i.id) === String(linkedId) || String(i.db_entry_id) === String(linkedId));
      if (inv?.db_entry_id) effLinkedId = inv.db_entry_id;
    }
    const payload = {
      company_id: currentCompany.id,
      name,
      mime_type: mediaType || null,
      document_type: type || null,
      uploaded_by: session?.user?.id || null,
      storage_path: storagePath,
      file_size_bytes: fileSize,
      linked_invoice_id: effLinkedId != null ? String(effLinkedId) : null,  // ties the doc to its invoice
      ...(contentHash ? { content_hash: contentHash } : {}),                 // C193
    };
    try {
      const { data, error } = await supabase.from("documents").insert(payload).select("id").single();
      if (error) {
        // C193 RACE BACKSTOP: two concurrent uploads of identical bytes collide on the partial
        // unique index (23505). The loser re-selects the winner's row, removes its own upload,
        // and returns the existing id — never a duplicate, never an orphaned blob.
        if (contentHash && /duplicate key|23505|unique constraint/i.test(error.message || "")) {
          if (storagePath) { try { await supabase.storage.from("documents").remove([storagePath]); } catch {} }
          try {
            const { data: won } = await supabase.from("documents").select("id")
              .eq("company_id", currentCompany.id).eq("content_hash", contentHash).limit(1).maybeSingle();
            if (won?.id) {
              setDocLibrary(prev => prev.filter(d => d.id !== doc.id));
              if (queueItemId) setUploadQueue(prev => prev.map(q => q.id === queueItemId ? { ...q, docError: undefined } : q));
              return won.id;
            }
          } catch { /* fall through to the normal error path */ }
        }
        console.error("[documents] insert FAILED:", error.message, error.details || "", error.hint || "", error);
        // ── 3. Roll back the uploaded file so it isn't orphaned ──
        if (storagePath) { try { await supabase.storage.from("documents").remove([storagePath]); } catch {} }
        reportDocError(queueItemId, error.message || "missing documents table — apply migration 002.");
        return doc.id;
      }
      if (queueItemId) setUploadQueue(prev => prev.map(q => q.id === queueItemId ? { ...q, docError: undefined } : q));
      if (data?.id) savedId = data.id;
      setDocLibrary(prev => prev.map(d => d.id === doc.id ? { ...d, id: data?.id || d.id, storage_path: storagePath, linked_invoice_id: effLinkedId != null ? String(effLinkedId) : d.linked_invoice_id } : d));
    } catch (e) {
      console.error("[documents] insert threw:", e);
      if (storagePath) { try { await supabase.storage.from("documents").remove([storagePath]); } catch {} }
      reportDocError(queueItemId, e?.message || "network error saving document.");
    }
    return savedId;
  };

  // ── PAYROLL ───────────────────────────────────────────────────────────────────
  const [payrollImports, setPayrollImports] = useState([]);
  const [payrollProcessing, setPayrollProcessing] = useState(false);
  const [payrollDragOver, setPayrollDragOver] = useState(false);

  // ── RECURRING TRANSACTIONS ────────────────────────────────────────────────────
  const [recurring, setRecurring] = useState([]);

  // ── RECONCILIATION ────────────────────────────────────────────────────────────
  const [reconSessions, setReconSessions] = useState([]);
  const [reconciliations, setReconciliations] = useState([]); // bank-match sessions (table: reconciliations)
  const [activeRecon, setActiveRecon] = useState(null);
  const [reconStatementBalance, setReconStatementBalance] = useState("");
  const [reconAccount, setReconAccount] = useState(null);

  // ── QBO ONBOARDING ────────────────────────────────────────────────────────────
  const [qboStep, setQboStep] = useState("upload");
  const [qboData, setQboData] = useState(null);
  const [qboMapping, setQboMapping] = useState({});
  const [qboPreview, setQboPreview] = useState([]);
  const [qboProcessing, setQboProcessing] = useState(false);
  const [qboDragOver, setQboDragOver] = useState(false);

  // ── SETTINGS ─────────────────────────────────────────────────────────────────
  const [companySettings, setCompanySettings] = useState({
    name: "", taxId: "", address: "", city: "", state: "", zip: "", country: "US",
    fiscalYearEnd: "12-31", // MM-DD
    defaultCashAccount: "1000",
    defaultAPAccount: "2000",
    defaultARAccount: "1100",
    currency: "USD",
    logoBase64: null,
    aliases: "",               // O75: self-identity (DBA/aka) for revenue-vs-expense direction
    businessType: "",          // SaaS | Consulting | Restaurant | ... (migration 025)
    salesTaxRate: 0,           // default blended sales-tax % (migration 042); pre-fills Send Invoice
    onboardingComplete: false, // hides the Home onboarding checklist when true
  });

  // ── CHART OF ACCOUNTS (customizable, loaded from Supabase via useAccounts) ───
  const { accounts: liveAccounts, reload: reloadAccounts, getAccountByRole, getAccountByCode, getAccountById } = useAccounts(currentCompany?.id);
  // Live company chart; falls back to the default chart before the first load.
  const CHART_OF_ACCOUNTS = liveAccounts.length ? liveAccounts : DEFAULT_CHART_OF_ACCOUNTS;
  const customCOA = CHART_OF_ACCOUNTS; // backwards-compat alias for existing readers
  // Resolve a stable system_role to its CURRENT code / name (never hardcode codes).
  const rc = (role) => getAccountByRole(role)?.code || "";
  const rn = (role) => getAccountByRole(role)?.name || "";

  // ── ACCOUNT MUTATIONS (persist to Supabase, then refresh the live chart) ─────
  const addCustomAccount = async ({ code, name, category }) => {
    if (!currentCompany?.id || !code || !name) return false;
    if (CHART_OF_ACCOUNTS.find(a => a.code === code)) { showNotification("Account code already exists.", "error"); return false; }
    const { error } = await supabase.from("accounts").insert({
      company_id: currentCompany.id, code, name, category: category || "Expenses",
      active: true, is_system: false, system_role: null,
    });
    if (error) { console.warn("[accounts] add failed:", error.message); showNotification("Couldn't add account — " + error.message, "error"); return false; }
    logAudit("coa_added", `Account added: ${code} – ${name} (${category})`);
    await reloadAccounts();
    return true;
  };
  const persistAccountEdit = async (account, updates) => {
    if (!account?.db_id || !currentCompany?.id) return false;
    if (updates.code && updates.code !== account.code && CHART_OF_ACCOUNTS.find(a => a.code === updates.code)) {
      showNotification("That account code is already in use.", "error"); return false;
    }
    const payload = {};
    for (const k of ["code", "name", "category", "active"]) if (updates[k] != null) payload[k] = updates[k];
    const { error } = await supabase.from("accounts").update(payload).eq("id", account.db_id).eq("company_id", currentCompany.id);
    if (error) { console.warn("[accounts] edit failed:", error.message); showNotification("Couldn't save — " + error.message, "error"); return false; }
    logAudit("coa_edited", `Account ${account.code} updated: ${updates.name || account.name}${updates.code && updates.code !== account.code ? ` (renumbered → ${updates.code})` : ""}`);
    await reloadAccounts();
    return true;
  };
  const accountHasTransactions = async (account) => {
    if (!account?.db_id) return false;
    const { count } = await supabase.from("journal_entry_lines").select("id", { count: "exact", head: true }).eq("account_id", account.db_id);
    return (count || 0) > 0;
  };
  const deleteAccount = async (account) => {
    if (!account?.db_id || !currentCompany?.id) return false;
    if (account.system_role) { showNotification("System accounts can't be deleted — rename it instead.", "error"); return false; }
    if (await accountHasTransactions(account)) { showNotification("This account has transactions and can't be deleted.", "error"); return false; }
    const { error } = await supabase.from("accounts").delete().eq("id", account.db_id).eq("company_id", currentCompany.id);
    if (error) { console.warn("[accounts] delete failed:", error.message); showNotification("Couldn't delete — " + error.message, "error"); return false; }
    logAudit("coa_deleted", `Account deleted: ${account.code} – ${account.name}`);
    await reloadAccounts();
    return true;
  };

  // ── DELETE CONFIRMATION ───────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, label, onConfirm }
  // ── FILE MISROUTE PROTECTION (O37) ────────────────────────────────────────────
  const [misrouteConfirm, setMisrouteConfirm] = useState(null);   // { detected, expected, resolve }
  const [pendingImportFile, setPendingImportFile] = useState(null); // { type, file } — routed to a view-local importer

  // ── OPENING BALANCES ─────────────────────────────────────────────────────────
  // { account_code, account_name, balance, as_of_date, posted }
  const [openingBalances, setOpeningBalances] = useState([]);
  const [cutoffDate, setCutoffDate] = useState(null);   // company conversion "Day One" (companies.cutoff_date)

  // ── BANK ACCOUNTS ────────────────────────────────────────────────────────────
  // { id, name, type:"checking"|"savings"|"credit_card"|"loan", gl_code, last4, institution }
  const [bankAccounts, setBankAccounts] = useState([
    { id:"default", name:"Primary Checking", type:"checking", gl_code:rc("cash"), last4:"", institution:"" }
  ]);

  // ── SEND INVOICE (outgoing to customers) ─────────────────────────────────────
  // { id, invoice_number, customer, customer_email, line_items:[], issue_date, due_date, notes, status:"draft"|"sent"|"paid", created_at }
  const [sentInvoices, setSentInvoices] = useState([]);
  const [sentInvoiceDraft, setSentInvoiceDraft] = useState(null); // invoice being created

  // AP state — apView persists across refresh (declared here, so its own persist effect)
  const [apView, setApView] = useState(() => ss("cfai_apView", "inbox")); // inbox | queue | approvals | aging
  useEffect(() => { try { sessionStorage.setItem("cfai_apView", apView); } catch {} }, [apView]);
  const [apAgingNarration, setApAgingNarration] = useState(null);
  const [apAgingLoading, setApAgingLoading] = useState(false);
  const [checkRunMode, setCheckRunMode] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [apSettings] = useState({ autoApproveThreshold: AP_AUTO_APPROVE_THRESHOLD });
  const CHAT_GREETING = "Hey — I'm Shadow. Just upload your documents on Home and I'll handle the bookkeeping. Ask me anything — your burn rate, P&L, unpaid bills — or tell me what to do and I'll take you there. What do you need?";
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: CHAT_GREETING, id: 0 }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistoryView, setChatHistoryView] = useState(false); // History timeline toggle
  // Trust-layer third net (O59) + sign-off (O50): all intake rows (for the docs-recorded
  // control total) + persisted period sign-offs ("reviewed through …").
  const [intakeRows, setIntakeRows] = useState([]);
  const [signoffs, setSignoffs] = useState([]);
  // O83 Trap 2 — a booking held because it dates into a signed-off period: { invoice, period }.
  // The decision modal (reopen / rebook / CPA) reads this; null when nothing is held.
  const [pendingSignedPeriodBooking, setPendingSignedPeriodBooking] = useState(null);
  // C186 — the automatic pipeline's exceptions surfaced to the CPA Review queue: excepted
  // statement lines + attention statements, each with a plain-language reason.
  const [statementExceptions, setStatementExceptions] = useState([]);
  const loadStatementExceptions = async (companyId) => {
    const cid = companyId || currentCompany?.id;
    if (!cid) { setStatementExceptions([]); return; }
    const plain = statementExceptionCopy;   // C195(8) — plain-language copy lives in the lib (tested)
    try {
      const { data: lines } = await supabase.from("bank_statement_lines")
        .select("id, statement_id, line_date, description, vendor, amount, exception_reason")
        .eq("company_id", cid).eq("status", "excepted");
      const { data: stmts } = await supabase.from("bank_statements")
        .select("id, source_filename, bank_account_id, period_start, period_end, stated_ending_balance")
        .eq("company_id", cid).eq("status", "attention");
      // C193 — SUPERSEDED parents produce ZOMBIE cards: their lines were resolved on a newer
      // upload but keep their own 'excepted' status (we never rewrite history). Exclude them.
      let supersededIds = [];
      try {
        const { data: dead } = await supabase.from("bank_statements").select("id").eq("company_id", cid).eq("status", "superseded");
        supersededIds = (dead || []).map((s) => String(s.id));
      } catch { /* column/status may not exist pre-059 */ }
      const withExc = new Set((lines || []).map((l) => String(l.statement_id)));
      const lineItems = (lines || []).map((l) => ({
        kind: "line", id: `sxl_${l.id}`, statement_id: l.statement_id, date: l.line_date,
        amount: l.amount, vendor: l.vendor, description: l.description, reason: l.exception_reason,
        title: l.vendor || l.description || "Statement line", plain: plain(l.exception_reason),
      }));
      // An attention statement with NO excepted lines = a balance discrepancy (the ending balance
      // didn't net) — surface it once, plainly, without GL jargon.
      // C198·1 (k) — a statement-level card must know WHERE it points (account + period,
      // so Reconcile opens on the right month) and must not describe a RESOLVED state.
      // statementCardState decides: 'exception' (real open work), 'ready' (every line is
      // in the books — an invitation, not a problem), or 'none' (reconciled/finished →
      // render NOTHING; a card about a finished period is a lie with a button on it).
      let lineStatusByStmt = new Map();
      try {
        const { data: allLines } = await supabase.from("bank_statement_lines")
          .select("statement_id, status").eq("company_id", cid)
          .in("statement_id", (stmts || []).map((x) => x.id));
        for (const l of (allLines || [])) {
          const k = String(l.statement_id);
          if (!lineStatusByStmt.has(k)) lineStatusByStmt.set(k, []);
          lineStatusByStmt.get(k).push(l.status);
        }
      } catch { /* pre-058 */ }
      const stmtItems = (stmts || []).filter((s) => !withExc.has(String(s.id))).map((s) => {
        const state = statementCardState({ statement: { ...s, status: "attention" }, lineStatuses: lineStatusByStmt.get(String(s.id)) || [], reconciliations });
        if (state === "none") return null;
        return {
          kind: "statement", id: `sxs_${s.id}`, statement_id: s.id,
          reason: state === "ready" ? "ready_to_reconcile" : "balance_discrepancy",
          state,
          bank_account_id: s.bank_account_id, period_start: s.period_start, period_end: s.period_end,
          stated_ending_balance: s.stated_ending_balance,
          title: s.source_filename || "Bank statement",
          plain: state === "ready" ? READY_TO_RECONCILE_COPY : statementExceptionCopy("balance_discrepancy"),
        };
      }).filter(Boolean);
      const live = filterLiveExceptions({ lineItems, stmtItems, supersededIds });   // C193 — drop zombie cards
      setStatementExceptions([...live.lineItems, ...live.stmtItems]);
    } catch { /* tables may not exist pre-058 */ setStatementExceptions([]); }
  };
  // Destructive AI actions staged behind the human confirmation gate (CR-9). null =
  // nothing pending; else { actions:[…], items:[{type,description,targets}] }.
  const [pendingAIActions, setPendingAIActions] = useState(null);
  const [aiInfoOpen, setAiInfoOpen] = useState(false); // "What can the assistant do?" capability panel
  const [legalTab, setLegalTab] = useState("terms"); // which legal page to open (terms | privacy)
  const [hasUnread, setHasUnread] = useState(false);
  const chatBottomRef = useRef(null);
  const chatScrollRef = useRef(null);  // the scrollable chat messages container
  const chatInputRef = useRef(null);
  const mainContentRef = useRef(null);
  // Keeps File objects alive across view changes (File objects can't live in React state reliably)
  const fileStoreRef = useRef({}); // { [queueItemId]: File }
  const uploadActiveRef = useRef(false); // prevents concurrent processing
  const bankBookingRef = useRef(false);  // P0: prevents re-entrant bank booking (no N× duplication)

  const allProjects = useMemo(() => [...new Set([...PROJECTS, ...customProjects])], [customProjects]);

  // ── VIEW-LEVEL STATE (must be at top level, not inside view IIFEs) ────────────
  const [arAgingNarration, setArAgingNarration] = useState(null);
  const [arAgingLoading, setArAgingLoading] = useState(false);
  const [arView, setArView] = useState("inbox");
  const [vendorsSelectedContact, setVendorsSelectedContact] = useState(null);
  const [vendorsEditingId, setVendorsEditingId] = useState(null);
  const [vendorsEditDraft, setVendorsEditDraft] = useState({});
  const [customersEditingId, setCustomersEditingId] = useState(null);
  const [customersEditDraft, setCustomersEditDraft] = useState({});
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsLogoPreview, setSettingsLogoPreview] = useState(null);
  const [coaEditingCode, setCoaEditingCode] = useState(null);
  const [coaEditDraft, setCoaEditDraft] = useState({});
  const [coaAddDraft, setCoaAddDraft] = useState({code:"",name:"",category:"Expenses"});
  const [coaShowAdd, setCoaShowAdd] = useState(false);
  const [openingBalAsOfDate, setOpeningBalAsOfDate] = useState(todayLocal());
  const [openingBalBalances, setOpeningBalBalances] = useState({});
  const [sendInvoiceDraftState, setSendInvoiceDraftState] = useState(null);
  const [sendInvoiceShowPreview, setSendInvoiceShowPreview] = useState(false);
  const [recurringNewRec, setRecurringNewRec] = useState({name:"",vendor:"",amount:"",gl_code:rc("rent_occupancy"),gl_name:rn("rent_occupancy"),frequency:"monthly",next_date:todayLocal(),project:"General"});
  const [docsPreview, setDocsPreview] = useState(null);
  const [docsFilterType, setDocsFilterType] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("all");

  // Jump the chat to the bottom (most recent message). On open we snap instantly
  // (after layout settles, so charts/summaries are measured); on a new message we
  // do the same so the latest turn is always visible.
  const scrollChatToBottom = () => {
    const el = chatScrollRef.current;
    if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  };
  useEffect(() => {
    if (chatOpen) { setHasUnread(false); scrollChatToBottom(); }
  }, [chatOpen]);
  useEffect(() => {
    if (chatOpen) scrollChatToBottom();
  }, [chatHistory, chatLoading, chatHistoryView]);

  // useLayoutEffect fires synchronously after DOM mutations but BEFORE the browser paints.
  // This guarantees the scroll position is reset before the user ever sees the new view,
  // preventing the "content appears at old scroll position" bug on tab switches.
  useLayoutEffect(() => {
    if (mainContentRef.current) mainContentRef.current.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    // Initialize settings draft when entering settings view
    if (view === "settings" && !settingsDraft) {
      setSettingsDraft(companySettings);
    }
  }, [view]); // eslint-disable-line

  // ── COMPANY STATE RESET ────────────────────────────────────
  // Wipe every piece of company-scoped state back to its initial value so nothing
  // from the previous company can bleed into the next one (a UI-layer complement to
  // the database's RLS isolation). Called whenever the active company changes, which
  // covers BOTH the company switcher AND Support Mode entry/exit — they all route
  // through onSwitchCompany → currentCompany.id changes → the effect below.
  // Deliberately NOT reset: auth state (session/companies/currentCompany), the
  // persisted `view`, Support Mode, and the platform-admin nav indicator.
  const resetCompanyState = () => {
    setCompanyDataLoaded(false);   // new company: data not loaded yet (gates the Home checklist flash)
    // Loaded data sets (loadAllData refetches these for the new company)
    setInvoices([]); invoicesRef.current = [];
    setVisibilityAlert(false); pendingVerifyRef.current.clear();
    setRules([]); setContacts([]); setCustomProjects([]);
    setContracts([]); setRecurring([]); setAuditLog([]); setDocLibrary([]);
    setBankTransactions([]); setUnknownDocs([]); setUploadQueue([]);
    setPendingOpeningProposal(null); setOpeningDiscrepancyFlag(null);
    setMatchQueue([]); setMatchHistory([]); setPayrollImports([]);
    setReconSessions([]); setReconciliations([]); setOpeningBalances([]);
    setSentInvoices([]); setClarificationQueue([]);
    setBankAccounts([{ id:"default", name:"Primary Checking", type:"checking", gl_code:rc("cash"), last4:"", institution:"" }]);
    setCompanySettings({ name:"", taxId:"", address:"", city:"", state:"", zip:"", country:"US", fiscalYearEnd:"12-31", defaultCashAccount:"1000", defaultAPAccount:"2000", defaultARAccount:"1100", currency:"USD", logoBase64:null, aliases:"", salesTaxRate:0 });

    // Selections, drill-downs, previews
    setSelectedInvoice(null); setReturnTo(null); setGlDrilldown(null);
    setAiSuggestion(null); setAiStep(null);
    setSelectedContract(null); setContractView("list");
    setActiveRecon(null); setReconStatementBalance(""); setReconAccount(null);
    setSelectedPayments(new Set()); setDeleteConfirm(null); setDocsPreview(null);
    setVendorsSelectedContact(null);

    // Filters / per-tab view selections. The PERSISTED ones (booksFilter, apView,
    // reportType — see the cfai_* sessionStorage writes) must RESTORE their saved value,
    // not snap to a hardcoded default: this reset runs on every company-load (incl. on
    // refresh, via the [currentCompany?.id] effect), so hardcoding here clobbered the value
    // the useState initializer just restored (then the persist effect wrote the default back
    // → the C103 persistence silently never worked). Non-persisted selections still default.
    setBooksFilter(ss("cfai_booksFilter", "all")); setVendorFilter("all");
    setApView(ss("cfai_apView", "inbox")); setArView("inbox");
    setDocsFilterType("all"); setAuditSearch(""); setAuditActionFilter("all");
    setBasisMode("accrual"); setReportType(ss("cfai_reportType", "pl"));
    setCheckRunMode(false); setChatHistoryView(false);

    // In-progress wizards / processing flags / drag states
    setIsAILoading(false); setUploadedFile(null); setUploadProcessing(false);
    setDragOver(false); setUniversalDragOver(false);
    setBankProcessing(false); setBankStep(null); setBankProgress(0); setBankFileName(""); setBankDragOver(false);
    setContractProcessing(false); setContractDragOver(false);
    setMatchProcessing(false);
    setPayrollProcessing(false); setPayrollDragOver(false);
    setQboStep("upload"); setQboData(null); setQboMapping({}); setQboPreview([]); setQboProcessing(false); setQboDragOver(false);

    // Cached AI narrations (regenerated per company)
    setBasisNarration(null); setBasisNarrationLoading(false);
    setApAgingNarration(null); setApAgingLoading(false);
    setArAgingNarration(null); setArAgingLoading(false);

    // Drafts
    setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"", paidWithCash:false });
    setVendorsEditingId(null); setVendorsEditDraft({});
    setCustomersEditingId(null); setCustomersEditDraft({});
    setSettingsDraft(null); setSettingsSaved(false); setSettingsLogoPreview(null);
    setCoaEditingCode(null); setCoaEditDraft({}); setCoaAddDraft({ code:"", name:"", category:"Expenses" }); setCoaShowAdd(false);
    setOpeningBalAsOfDate(todayLocal()); setOpeningBalBalances({});
    setSendInvoiceDraftState(null); setSendInvoiceShowPreview(false); setSentInvoiceDraft(null);
    setRecurringNewRec({ name:"", vendor:"", amount:"", gl_code:rc("rent_occupancy"), gl_name:rn("rent_occupancy"), frequency:"monthly", next_date:todayLocal(), project:"General" });

    // Notifications / toasts
    if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
    setNotification(null);

    // Chat — reset to the greeting; AI memory reloads fresh from DB (effect below)
    setChatOpen(false); setChatInput(""); setChatLoading(false); setHasUnread(false);
    setChatHistory([{ role:"assistant", content: CHAT_GREETING, id: 0 }]);

    // Upload / session refs
    fileStoreRef.current = {};
    uploadActiveRef.current = false;
    recentContactsRef.current = new Set();
    // Learned AI profile — drop the previous company's; loadAllData reloads the new one.
    if (profilePersistTimer.current) { clearTimeout(profilePersistTimer.current); profilePersistTimer.current = null; }
    clientProfileRef.current = emptyProfile();
    // Recurring-suggestion detection
    if (recurringScanTimer.current) { clearTimeout(recurringScanTimer.current); recurringScanTimer.current = null; }
    setRecurringSuggestions([]);
    dismissedRecurringRef.current = new Set();
    // Anomalies, notifications, onboarding UI
    applyAnomalyRows([]); anomaliesLoadedRef.current = false; anomalyScanBusyRef.current = false;
    setStatementExceptions([]);   // C186
    setNotifications([]); setNotifOpen(false);
    setOnboardingUploadDone(false); setBusinessModalOpen(false);
  };

  // ── SUPABASE DATA LOADING ──────────────────────────────────
  useEffect(() => {
    if (!currentCompany?.id) return;
    resetCompanyState();   // clear the previous company's state before loading the new one
    loadAllData();
  }, [currentCompany?.id]);

  // (Depreciation auto-post effect lives AFTER autoPostDepreciation + companyDataLoaded are
  // declared — see below — so its deps array can't hit a temporal dead zone at render time.)

  // Surface the team-invite welcome / error toast set by AppWrapper after accept.
  useEffect(() => {
    try {
      const w = localStorage.getItem("cfai_invite_welcome");
      if (w) { localStorage.removeItem("cfai_invite_welcome"); showNotification(`Welcome to ${w}! You've joined the team. ✓`); }
      const e = localStorage.getItem("cfai_invite_error");
      if (e) { localStorage.removeItem("cfai_invite_error"); showNotification(e, "error"); }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadAllData = async () => {
    const cid = currentCompany.id;

    // ── CRITICAL FETCH: the FULL ledger, paged + uncapped (CR-14/CR-15) ──────────
    // The whole posted ledger via the ONE shared loader (fetchLedger) — the same
    // dataset the AI path uses, so dashboard === AI === reports by construction.
    // A failure here must NOT masquerade as an empty company (CR-18): surface it +
    // Sentry and bail WITHOUT marking data loaded, so no view renders false
    // emptiness and no one books against a truncated/absent ledger.
    let mapped;
    try {
      mapped = await fetchLedger(supabase, cid, CHART_OF_ACCOUNTS);
    } catch (e) {
      console.error("[loadAllData] ledger load failed:", e?.message || e);
      try { Sentry.captureException(e, { tags: { kind: "ledger_load_failure" }, extra: { company_id: String(cid) } }); } catch {}
      showNotification("Couldn't load your books — please refresh. Your data is safe on the server.", "error");
      return;   // do NOT setCompanyDataLoaded(true) over a throw — failed ≠ empty
    }
    if (currentCompany.id !== cid) return;   // company switched mid-load (CR-19) — drop the stale result

    try {
      setInvoices(mapped);

      // Load contacts
      const { data: contactsData } = await supabase
        .from("contacts").select("*").eq("company_id", cid).eq("active", true).is("deleted_at", null).order("name");
      if (contactsData) {
        setContacts(contactsData.map(c => ({
          ...c, fromContact: true, type: c.type,
          gl_code: null, gl_name: null,
          min_expected: c.expected_min, max_expected: c.expected_max
        })));
      }

      // Load vendor rules
      const { data: rulesData } = await supabase
        .from("vendor_rules")
        .select("*, contacts(name), accounts(code,name)")
        .eq("company_id", cid).eq("active", true);
      if (rulesData) {
        setRules(rulesData.map(r => ({
          id: r.id, vendor: r.contacts?.name, gl_code: r.accounts?.code,
          gl_name: r.accounts?.name, project: r.project
        })));
      }

      // Load company settings
      const { data: co } = await supabase.from("companies").select("*").eq("id", cid).single();
      if (co) {
        setCompanySettings(mapCompanyRow(co));   // pure read-shape; pairs with buildCompanyUpdate (O13 round-trip)
        setCutoffDate(co.cutoff_date || null);
      }

      // Opening balances (table: opening_balances) — read back so they survive
      // refresh and drive the editor grid + the lock-after-post state. The opening
      // JE itself loads via the ledger (source='opening_balance').
      try {
        const { data: obRows } = await supabase.from("opening_balances")
          .select("*, accounts(code, name)").eq("company_id", cid);
        if (Array.isArray(obRows)) {
          setOpeningBalances(obRows.map(r => ({
            id: r.id, account_code: r.accounts?.code, account_name: r.accounts?.name,
            balance: Number(r.balance) || 0, as_of_date: r.as_of_date,
            journal_entry_id: r.journal_entry_id, posted: !!r.posted,
          })));
        }
      } catch (e) { console.warn("[opening_balances] load skipped:", e?.message || e); }

      // Chart of accounts is loaded/refreshed by the useAccounts hook.

      // Load bank accounts
      const { data: banks } = await supabase
        .from("bank_accounts").select("*, accounts(code)").eq("company_id", cid).eq("active", true);
      if (banks) {
        const mappedBanks = banks.map(b => ({ id: b.id, name: b.name, type: b.type, gl_code: b.accounts?.code, institution: b.institution||"", last4: b.last4||"", current_balance: Number(b.current_balance)||0 }));
        setBankAccounts(mappedBanks);
      }

      // O10 — refresh the "depreciation due" nudge signal on every company load.
      loadDepreciationDue();

      // Load recurring transactions
      const { data: recData } = await supabase
        .from("recurring_transactions")
        .select("*, debit_account:debit_account_id(code,name), credit_account:credit_account_id(code,name), contacts(name)")
        .eq("company_id", cid).order("next_date");
      if (recData) {
        setRecurring(recData.map(r => ({
          id: r.id, name: r.name, vendor: r.contacts?.name||"", amount: r.amount,
          gl_code: r.debit_account?.code, gl_name: r.debit_account?.name,
          frequency: r.frequency, next_date: r.next_date, last_run: r.last_run_date,
          active: r.active, created_at: r.created_at
        })));
      }

      // Load sent invoices (AR)
      const { data: arData } = await supabase
        .from("ar_invoices")
        .select("*, ar_invoice_lines(*), contacts(name)")
        .eq("company_id", cid).order("created_at", { ascending: false });
      if (arData) {
        setSentInvoices(arData.map(ar => ({
          id: ar.id, invoice_number: ar.invoice_number,
          customer: ar.contacts?.name||"", customer_email: "",
          issue_date: ar.issue_date, due_date: ar.due_date, terms: ar.terms,
          notes: ar.notes||"", status: ar.status,
          line_items: (ar.ar_invoice_lines||[]).map(l => ({
            id: l.id, description: l.description, qty: l.quantity,
            rate: l.unit_rate, amount: l.amount
          }))
        })));
      }

      // Load audit log
      const { data: auditData } = await supabase
        .from("audit_log").select("*").eq("company_id", cid)
        .order("created_at", { ascending: false }).limit(1000);
      if (auditData) {
        setAuditLog(auditData.map(a => ({
          id: a.id, ts: a.created_at, action: a.action,
          detail: a.detail, before: a.before_state, after: a.after_state, user: a.performed_by || "owner"
        })));
      }

      // Load documents (metadata only — base64 file content is not stored)
      const { data: docsData, error: docsErr } = await supabase
        .from("documents").select("*").eq("company_id", cid)
        .order("created_at", { ascending: false });
      if (docsErr) console.error("[documents] loadAllData fetch error:", docsErr.message, docsErr.details || "", docsErr.hint || "");

      if (docsData) {
        // Map the documents table's columns back to the app's doc shape.
        setDocLibrary(docsData.map(d => ({
          id: d.id,
          name: d.name,                       // display name (DocsView reads doc.name)
          mediaType: d.mime_type,
          type: d.document_type,
          uploaded_at: d.created_at,
          storage_path: d.storage_path,       // actual file in Storage (migration 014)
          file_size_bytes: d.file_size_bytes,
          tags: d.tags || [],                 // present after migration 013
          ai_explanation: d.ai_explanation,
          entry_summary: d.entry_summary,
          linked_invoice_id: d.linked_invoice_id,
        })));
      }

      // Load contracts
      // Load bank reconciliation sessions (table from migration 005)
      const { data: reconData, error: reconErr } = await supabase
        .from("reconciliations").select("*").eq("company_id", cid)
        .order("created_at", { ascending: false });
      if (reconErr) console.warn("[reconciliations] load failed (apply migration 005?):", reconErr.message);
      if (reconData) setReconciliations(reconData);

      await loadContractsFromDB();

      // Load this company's learned AI profile (defensive — table may be absent).
      clientProfileRef.current = await loadClientProfile(supabase, cid);

      // Onboarding: has at least one upload ever completed? (upload_log, migration 019)
      try {
        const { data: ul } = await supabase.from("upload_log")
          .select("id").eq("company_id", cid).eq("status", "done").limit(1);
        setOnboardingUploadDone(Array.isArray(ul) && ul.length > 0);
      } catch { /* table may be absent */ }

      // Load persisted notifications + anomaly records (defensive). Anomaly SCANNING
      // (reconcile/insert/auto-resolve) and notification generation are driven by effects
      // below (so they read fresh state, not stale refs). Loading the rows FIRST lets the
      // reconcile see existing open/dismissed rows (dedup + dismissal suppression) rather
      // than re-inserting everything on the first scan.
      await loadNotifications(cid);
      await loadAnomalies(cid);
      await loadStatementExceptions(cid);   // C186 — pipeline exceptions for the CPA Review queue

    } catch(e) { console.error("loadAllData (secondary) error:", e); }
    // The critical ledger loaded (we returned early otherwise), so views may now trust
    // the data. A secondary fetch failing (contacts/docs/etc.) degrades gracefully.
    finally { setCompanyDataLoaded(true); }
  };

  // ── SUPABASE PERSISTENCE ──────────────────────────────────────
  // Reclassify the debit line of an existing journal entry in Supabase. Returns TRUE
  // only when every targeted entry's line actually committed — callers must NOT report
  // success on a falsy return (the chatbot/panel false-success bug: it claimed "✓
  // reclassed" while this silently no-op'd on a not-yet-persisted entry or swallowed a
  // failed update).
  const persistRecode = async (recodedInvoices, newGlCode, newGlName) => {
    if (!currentCompany?.id) return false;
    const targets = recodedInvoices || [];
    if (targets.length === 0) return false;
    // SIGNED-PERIOD guard (O83 Trap 2): a recode changes a signed month's account mix — block
    // it (reopen first). Any mutation of an attested period must be deliberate, never silent.
    const recBlocked = targets.find(inv => signedPeriodForDate(inv?.date, signoffs, { source: inv?.source }));
    if (recBlocked) {
      const p = signedPeriodForDate(recBlocked.date, signoffs, { source: recBlocked.source });
      showNotification(`${signedMonthLabel(p) || "That month"} is signed off — reopen it first to recategorize entries in it.`, "error");
      logAudit("signed_period_mutation_blocked", `Blocked recode of an entry dated ${recBlocked.date} in signed period ${p}`, null, { period: p, date: recBlocked.date, action: "recode" });
      return false;
    }
    // Every target must have a DB id; otherwise we can't persist the change (the
    // "worked on retry" race — the entry hadn't finished saving on the first attempt).
    const withDbId = targets.filter(i => i.db_entry_id);
    if (withDbId.length !== targets.length) {
      console.warn("[persistRecode] not all entries persisted yet — recode not committed");
      return false;
    }
    try {
      // Ensure the new account exists in Supabase
      let { data: acctRow, error: acctErr } = await supabase.from("accounts")
        .select("id").eq("company_id", currentCompany.id).eq("code", newGlCode).single();
      if (acctErr && acctErr.code !== "PGRST116") { console.error("[persistRecode] account lookup:", acctErr.message); return false; }
      if (!acctRow) {
        const acctDef = CHART_OF_ACCOUNTS.find(a => a.code === newGlCode);
        const { data: created, error: insErr } = await supabase.from("accounts").insert(
          buildAccountInsert({ companyId: currentCompany.id, code: newGlCode, name: newGlName || acctDef?.name || newGlCode, category: acctDef?.category })
        ).select("id").single();
        if (insErr || !created) { console.error("[persistRecode] account insert:", insErr?.message); return false; }
        // O108 finding 4, FOURTH SITE — this is how 6520 and 6530 came to exist. A CPA recoded
        // a bank line to a code that was in no chart, and the recode created it. Origin was a
        // HUMAN CORRECTION, not machine invention; the account is still role-less and invisible.
        logAudit("account_materialized", `Created account ${newGlCode} "${newGlName || newGlCode}" while recategorizing — it was not in this company's chart`, null, { code: newGlCode, name: newGlName || newGlCode, site: "persistRecode" });
        acctRow = created;
      }
      if (!acctRow?.id) return false;
      // Update the primary (debit/credit) line of each journal entry — check EVERY write.
      for (const inv of withDbId) {
        const isDebit = inv.debit_credit !== "credit";
        const q = supabase.from("journal_entry_lines").update({ account_id: acctRow.id }).eq("journal_entry_id", inv.db_entry_id);
        const { error } = await (isDebit ? q.gt("debit", 0) : q.gt("credit", 0));
        if (error) { console.error("[persistRecode] line update:", error.message); return false; }
      }
      // O67 — TEACH THE LEARNING LAYER. A human correction (this recode, and the CPA override
      // that routes through here) is the highest-quality signal: overwrite the vendor→GL
      // mapping to the corrected account, marked source:'human_correction' so it outranks any
      // AI booking and is trusted immediately by recallVendor. Best-effort; never fails the recode.
      try {
        let taught = false;
        for (const inv of withDbId) {
          if (!inv.vendor) continue;
          clientProfileRef.current = learnFromCorrection(clientProfileRef.current, { vendor: inv.vendor, gl_code: newGlCode, gl_name: newGlName, date: inv.date });
          taught = true;
        }
        if (taught) persistClientProfile(supabase, currentCompany.id, clientProfileRef.current);
      } catch (e) { console.warn("[persistRecode] learning update failed (non-fatal):", e?.message || e); }
      return true;
    } catch(e) { console.error("persistRecode error:", e); return false; }
  };

  // Write a journal entry to Supabase when an invoice is booked
  const persistJournalEntry = async (invoice) => {
    if (!currentCompany?.id || !session?.user?.id) return;
    // Cutoff enforcement (hybrid): a transaction dated before the cutoff is part of
    // the opening position — reject it and redirect to opening balances. The opening
    // entry itself is exempt. No cutoff set (legacy) → no enforcement (handled by the
    // caller's warn path). Imports that hit this get null → skipped with a notice.
    if (cutoffDate && invoice?.source !== "opening_balance" && isBeforeCutoff(invoice?.date, cutoffDate)) {
      showNotification(PRE_CUTOFF_MESSAGE, "error");
      logAudit("pre_cutoff_booking_blocked", `Blocked booking dated ${invoice?.date} before cutoff ${cutoffDate}`, null, { date: invoice?.date, cutoff: cutoffDate, vendor: invoice?.vendor });
      return null;
    }
    // SIGNED-PERIOD guard (O83 Trap 2): NEVER silently post into a month a reviewer signed off —
    // the attestation would then vouch for numbers that changed. Hold the entry and route to the
    // decision surface. The reopen-and-book path re-invokes with _signedPeriodAck (after revoking
    // the sign-off), so the second pass posts. This is the single chokepoint (§8), so it covers
    // doc upload, bank import, manual, recurring and contract bookings at once.
    const heldPeriod = invoice?._signedPeriodAck ? null : signedPeriodForDate(invoice?.date, signoffs, { source: invoice?.source });
    if (heldPeriod) {
      setPendingSignedPeriodBooking({ invoice, period: heldPeriod });
      logAudit("signed_period_booking_held", `Held a booking dated ${invoice?.date} into signed period ${heldPeriod} — awaiting decision`, null, { date: invoice?.date, period: heldPeriod, vendor: invoice?.vendor });
      return null;
    }
    try {
      const ensureAccount = async (code, name) => {
        if (!code) return null;
        let { data } = await supabase.from("accounts")
          .select("id").eq("company_id", currentCompany.id).eq("code", code).single();
        if (data) return data;
        const acctDef = CHART_OF_ACCOUNTS.find(a => a.code === code);
        const { data: created } = await supabase.from("accounts").insert(
          buildAccountInsert({ companyId: currentCompany.id, code, name: name || acctDef?.name || code, category: acctDef?.category })
        ).select("id").single();
        // O108 finding 4 — SAY SO. This inserts a permanent account on the client's chart with
        // system_role NULL, invisible to every role lookup thereafter. It ran three times on
        // Franklin Ave across attested months and left no trace anywhere. Behaviour unchanged;
        // it is simply no longer silent. (`system_role IS NULL` + a late created_at is the
        // fingerprint — see the standing query in tests/accountMaterialization.test.js.)
        if (created) logAudit("account_materialized", `Created account ${code} "${name || acctDef?.name || code}" on the fly — it was not in this company's chart`, null, { code, name: name || acctDef?.name || code, in_default_chart: !!acctDef, site: "ensureAccount" });
        return created;
      };

      const isDebit = invoice.debit_credit !== "credit";
      const primaryAcct    = await ensureAccount(invoice.gl_code, invoice.gl_name);
      const secondaryAcct  = await ensureAccount(invoice.secondary_gl_code || rc("accounts_payable"), invoice.secondary_gl_name || rn("accounts_payable"));
      if (!primaryAcct) { console.error("persistJournalEntry: no primary account", invoice.gl_code); return null; }

      const amt = Number(invoice.amount) || 0;
      const memo = invoice.description;
      const entryDate   = invoice.date || todayLocal();
      // Balanced lines (no journal_entry_id — the RPC assigns it atomically).
      let lines = [];

      // SALES-TAX SPLIT (uploaded AR invoices): tax collected is a LIABILITY, not
      // revenue. A revenue invoice carrying `tax_amount` books the 3-line split — Dr A/R
      // (total) / Cr Revenue (subtotal) / Cr Sales Tax Payable (2350) — via the SAME
      // tested builder the Send-Invoice flow uses. (Was: full total lumped into revenue,
      // overstating income + omitting the tax liability — the Riverside shakedown bug.)
      const taxAmt = Number(invoice.tax_amount) || 0;
      if (!isDebit && taxAmt > 0 && glIsRevenue(invoice.gl_code) && secondaryAcct) {
        const arCode = invoice.secondary_gl_code || rc("accounts_receivable");
        const stCode = getAccountByRole("sales_tax_payable")?.code || "2350";
        const subtotal = Math.round((amt - taxAmt) * 100) / 100;
        const built = buildArInvoiceEntry({ subtotal, taxAmount: taxAmt, arCode, revenueCode: invoice.gl_code, salesTaxCode: stCode, date: entryDate, customer: invoice.vendor, invoiceNumber: invoice.invoice_number, memo });
        if (built && built.balanced) {
          const resolved = [];
          for (const l of built.lines) {
            const a = await ensureAccount(l.code, l.code === stCode ? "Sales Tax Payable" : (l.code === arCode ? "Accounts Receivable" : invoice.gl_name));
            if (!a) { resolved.length = 0; break; }
            resolved.push({ account_id: a.id, debit: l.debit, credit: l.credit, memo });
          }
          if (resolved.length === built.lines.length) lines = resolved;
        }
      }

      if (lines.length === 0) {
        if (secondaryAcct) {
          if (isDebit) {
            lines.push({ account_id: primaryAcct.id,   debit: amt, credit: 0,   memo });
            lines.push({ account_id: secondaryAcct.id, debit: 0,   credit: amt, memo });
          } else {
            lines.push({ account_id: primaryAcct.id,   debit: 0,   credit: amt, memo });
            lines.push({ account_id: secondaryAcct.id, debit: amt, credit: 0,   memo });
          }
        } else {
          lines.push({ account_id: primaryAcct.id, debit: isDebit ? amt : 0, credit: isDebit ? 0 : amt, memo });
        }
      }

      const description  = `${invoice.vendor || ""} – ${invoice.description || invoice.vendor || ""}`;
      const source       = normalizeSource(invoice.source);  // satisfy journal_entries_source_check
      const meta = {
        ai_reasoning: invoice.reasoning || null,
        ai_confidence: invoice.confidence ?? null,
        approval_status: invoice.approval_status || null,
        payment_status: invoice.payment_status || null,
        payment_method: invoice.payment_method_used || invoice.payment_method || null,
        // O11: due date = explicit if set, else derived from the invoice's payment terms
        // (Net 30 → date+30, Due on receipt → date). Centralized here so every booking path
        // (upload, AR issue, bills) stores a real due date used by AR/AP aging. Column exists
        // (migration 003) — no migration needed.
        due_date: invoice.due_date || deriveDueDate(entryDate, invoice.payment_terms || invoice.terms) || null,
        // Captured sales tax on this invoice — persisted INDEPENDENT of how it was
        // booked, so the accuracy control (O59 third net) can cross-foot "tax the
        // invoice charged" against the Sales-Tax-Payable GL and catch tax mis-booked
        // to revenue (the Riverside class). 0/absent when there's no tax line.
        ...((Number(invoice.tax_amount) || 0) > 0 ? { tax_amount: Number(invoice.tax_amount) } : {}),
      };

      // ── Atomic, balance-validated post (migration 010) ──
      const { data: rpcData, error: rpcErr } = await supabase.rpc("post_journal_entry", {
        p_company_id: currentCompany.id, p_entry_date: entryDate, p_description: description,
        p_source: source, p_created_by: session.user.id, p_lines: lines, p_meta: meta,
      });
      if (!rpcErr) return rpcData?.id || rpcData?.entry?.id || null;

      // A real posting failure (e.g. unbalanced) must surface and stop — only
      // fall back to the legacy inserts if the RPC simply isn't deployed yet.
      const rpcMissing = /post_journal_entry|could not find the function|does not exist|schema cache|PGRST202|PGRST302/i.test(rpcErr.message || "");
      if (!rpcMissing) {
        console.error("post_journal_entry failed:", rpcErr.message);
        showNotification("Couldn't save the entry: " + (rpcErr.message || "unknown error"), "error");
        return null;
      }
      console.warn("post_journal_entry RPC not found — using legacy insert. Apply migration 010_post_journal_entry.sql.");
      const baseEntry = { company_id: currentCompany.id, entry_date: entryDate, description, source, status: "posted", posted_at: new Date().toISOString(), created_by: session.user.id };
      let { data: je, error: jeErr } = await supabase.from("journal_entries").insert({ ...baseEntry, ...meta }).select().single();
      if (jeErr && /ai_reasoning|ai_confidence|column/i.test(jeErr.message || "")) {
        ({ data: je, error: jeErr } = await supabase.from("journal_entries").insert(baseEntry).select().single());
      }
      if (jeErr) { console.error("JE insert error:", jeErr); return null; }
      const legacyLines = lines.map(l => ({ ...l, journal_entry_id: je.id, company_id: currentCompany.id }));
      const { error: lineErr } = await supabase.from("journal_entry_lines").insert(legacyLines);
      if (lineErr) console.error("JE lines insert error (entry may be unbalanced):", lineErr.message);
      return je.id;
    } catch(e) { console.error("persistJournalEntry error:", e); return null; }
  };

  // Post ONE balanced journal entry with N lines (the canonical multi-line write
  // path). Takes a buildJournalEntry() result; resolves each line's code → account
  // id and writes a SINGLE journal_entries row via post_journal_entry. This replaces
  // the per-line expansion (which posted each line as its own 2-line JE and so
  // double-counted multi-line entries — revenue/expense landing on both a primary
  // and an offset leg). Refuses unbalanced entries before hitting the DB.
  const persistMultiLineEntry = async (entry) => {
    if (!currentCompany?.id || !session?.user?.id) return null;
    if (!entry || !entry.balanced) { console.error("persistMultiLineEntry: refusing unbalanced/empty entry", entry); showNotification("Entry doesn't balance — not posted.", "error"); return null; }
    if (cutoffDate && entry.source !== "opening_balance" && isBeforeCutoff(entry.date, cutoffDate)) {
      showNotification(PRE_CUTOFF_MESSAGE, "error");
      logAudit("pre_cutoff_booking_blocked", `Blocked multi-line entry dated ${entry.date} before cutoff ${cutoffDate}`, null, { date: entry.date, cutoff: cutoffDate });
      return null;
    }
    // SIGNED-PERIOD guard (O83 Trap 2) — same as persistJournalEntry; a multi-line entry
    // (deferred-revenue recognition, lease, payroll, sales-tax) dated into a signed month is held.
    const heldPeriodML = entry?._signedPeriodAck ? null : signedPeriodForDate(entry.date, signoffs, { source: entry.source });
    if (heldPeriodML) {
      setPendingSignedPeriodBooking({ invoice: entry, period: heldPeriodML, multiLine: true });
      logAudit("signed_period_booking_held", `Held a multi-line entry dated ${entry.date} into signed period ${heldPeriodML} — awaiting decision`, null, { date: entry.date, period: heldPeriodML });
      return null;
    }
    try {
      const ensureAccount = async (code, name) => {
        if (!code) return null;
        let { data } = await supabase.from("accounts")
          .select("id").eq("company_id", currentCompany.id).eq("code", code).single();
        if (data) return data;
        const acctDef = CHART_OF_ACCOUNTS.find(a => a.code === code);
        const { data: created } = await supabase.from("accounts").insert(
          buildAccountInsert({ companyId: currentCompany.id, code, name: name || acctDef?.name || code, category: acctDef?.category })
        ).select("id").single();
        // O108 finding 4 — SAY SO. This inserts a permanent account on the client's chart with
        // system_role NULL, invisible to every role lookup thereafter. It ran three times on
        // Franklin Ave across attested months and left no trace anywhere. Behaviour unchanged;
        // it is simply no longer silent. (`system_role IS NULL` + a late created_at is the
        // fingerprint — see the standing query in tests/accountMaterialization.test.js.)
        if (created) logAudit("account_materialized", `Created account ${code} "${name || acctDef?.name || code}" on the fly — it was not in this company's chart`, null, { code, name: name || acctDef?.name || code, in_default_chart: !!acctDef, site: "ensureAccount" });
        return created;
      };
      const resolved = [];
      for (const l of entry.lines) {
        const acct = await ensureAccount(l.code, l.name);
        if (!acct) { console.error("persistMultiLineEntry: no account for code", l.code); showNotification(`Couldn't resolve account ${l.code}`, "error"); return null; }
        resolved.push({ account_id: acct.id, debit: l.debit, credit: l.credit, memo: l.memo || entry.description });
      }
      const entryDate = entry.date || todayLocal();
      const description = entry.description || "";
      const source = normalizeSource(entry.source);
      const { data, error } = await supabase.rpc("post_journal_entry", {
        p_company_id: currentCompany.id, p_entry_date: entryDate, p_description: description,
        p_source: source, p_created_by: session.user.id, p_lines: resolved, p_meta: entry.meta || {},
      });
      if (error) { console.error("post_journal_entry (multi-line) failed:", error.message); showNotification("Couldn't save the entry: " + (error.message || "unknown error"), "error"); return null; }
      return data?.id || data?.entry?.id || null;
    } catch(e) { console.error("persistMultiLineEntry error:", e); return null; }
  };

  // ── OPENING BALANCES (clean-cutoff conversion, #6/#7) ───────────────────────
  // The opening position is ONE balanced JE as of the cutoff (Dr assets / Cr
  // liabilities / plug to Opening Balance Equity), persisted to journal_entries
  // (source='opening_balance') AND the opening_balances table (so it survives
  // refresh). Bank balances flow through the SAME entry (bank-as-source-of-truth).
  const openingPosted = openingBalances.some(b => b.posted);

  const saveCutoffDate = async (date) => {
    if (!currentCompany?.id) return false;
    if (openingPosted) { showNotification("Cutoff is locked — opening balances are already posted", "error"); return false; }
    setCutoffDate(date || null);
    try { await supabase.from("companies").update({ cutoff_date: date || null }).eq("id", currentCompany.id); }
    catch (e) { console.warn("[cutoff] save:", e?.message || e); }
    logAudit("cutoff_date_set", `Cutoff (Day One) set to ${date || "—"}`, null, { cutoff: date || null });
    return true;
  };

  // Resolve a GL code to its account_id, creating the account (e.g. OBE 3400) if absent.
  const ensureAccountIdForCode = async (code) => {
    const existing = getAccountByCode(code)?.db_id;
    if (existing) return existing;
    const def = CHART_OF_ACCOUNTS.find(a => a.code === code);
    const { data, error } = await supabase.from("accounts").insert(buildAccountInsert({
      companyId: currentCompany.id, code,
      name: def?.name || (code === OBE_CODE ? "Opening Balance Equity" : code),
      category: def?.category || (code === OBE_CODE ? "Equity" : "Assets"),
    })).select("id").single();
    if (error) { console.warn("[opening] ensureAccount failed:", code, error.message); return null; }
    // O108 finding 4 — the path that materialised 3400 Opening Balance Equity on 2026-07-22.
    logAudit("account_materialized", `Created account ${code} on the fly during opening balances — it was not in this company's chart`, null, { code, site: "ensureAccountIdForCode" });
    await reloadAccounts();
    return data?.id || null;
  };

  // Post (or re-post) opening balances. `gridBalancesByCode` = { code: natural balance }
  // for the user-entered accounts; bank-linked cash is overridden from bank balances.
  const postOpeningBalances = async (gridBalancesByCode, { asOf = null } = {}) => {
    if (!currentCompany?.id || !session?.user?.id) { showNotification("No active company", "error"); return false; }
    // `asOf` (the statement-derived flow) overrides the company cutoff so the write isn't
    // blocked by not-yet-persisted cutoff state; the manual grid passes none and uses cutoffDate.
    const cutoff = asOf || cutoffDate;
    if (!cutoff) { showNotification("Set your cutoff (Day One) date first", "error"); return false; }
    // Footgun guard: live, non-opening transactions dated before the cutoff would
    // double-count retained earnings. Hard-block.
    const pre = preCutoffActivity(invoices, cutoff);
    if (pre.length) {
      showNotification(`Can't post opening balances — ${pre.length} transaction(s) are dated before your cutoff (${cutoff}). Move the cutoff or remove those entries first.`, "error");
      logAudit("opening_balance_blocked_precutoff", `Blocked: ${pre.length} pre-cutoff transactions exist`, null, { cutoff, count: pre.length });
      return false;
    }
    // Bank-as-source-of-truth, but as a FALLBACK only: a bank-linked cash GL code is
    // valued from the bank's recorded balance ONLY when the grid didn't provide one. If
    // the user entered (or the bank pre-fill carried) an opening cash amount, THAT wins —
    // so opening cash can actually be set, including for a brand-new business whose bank
    // `current_balance` hasn't been recorded yet. Avoids both the "locked to 0" dead-end
    // and double-opening the same GL account.
    const merged = { ...(gridBalancesByCode || {}) };
    const bankSum = {};
    for (const b of (bankAccounts || [])) {
      if (b.gl_code) bankSum[b.gl_code] = (bankSum[b.gl_code] || 0) + (Number(b.current_balance) || 0);
    }
    for (const [code, val] of Object.entries(bankSum)) {
      if (merged[code] == null || merged[code] === "" || Number(merged[code]) === 0) merged[code] = val;
    }
    const { lines } = buildOpeningBalanceEntry(merged, { cutoffDate: cutoff, obeCode: OBE_CODE, accounts: CHART_OF_ACCOUNTS });
    if (!lines.length) { showNotification("Enter at least one opening balance first", "error"); return false; }

    // Edit = reverse/replace, done FAIL-SAFE (CR-16): POST THE NEW ENTRY FIRST, verify it,
    // and only THEN supersede the prior one. The old delete-first order meant a repost
    // failure left the company with NO opening position (the entire day-one foundation) —
    // a torn ledger from a transient error. Now a failure at any step leaves a VALID opening
    // position (worst case: briefly doubled, which the next successful edit reconciles;
    // never none). Mirrors markBillPaid's post-then-reconcile discipline.
    const cid = currentCompany.id;

    // 1) Resolve account ids and POST the new balanced entry.
    const rpcLines = [];
    for (const l of lines) {
      const aid = await ensureAccountIdForCode(l.code);
      if (!aid) { showNotification(`Couldn't resolve account ${l.code}`, "error"); return false; }  // prior untouched → still valid
      rpcLines.push({ account_id: aid, debit: l.debit, credit: l.credit, memo: "Opening balance" });
    }
    const { data: rpcData, error } = await supabase.rpc("post_journal_entry", {
      p_company_id: cid, p_entry_date: cutoff, p_description: `Opening balances as of ${cutoff}`,
      p_source: "opening_balance", p_created_by: session.user.id, p_lines: rpcLines, p_meta: {},
    });
    if (error) { showNotification("Couldn't post opening balances — " + error.message, "error"); return false; }
    const jeId = rpcData?.id || rpcData?.entry?.id || null;

    // 2) VERIFY the new entry actually committed before we touch the old one.
    if (!jeId) {
      try { Sentry.captureMessage("opening_post_no_id", { level: "error", tags: { kind: "opening_post_no_id" }, extra: { company_id: String(cid), cutoff } }); } catch {}
      showNotification("Couldn't confirm the opening entry saved — your previous opening balances are unchanged. Please try again.", "error");
      return false;   // prior opening entry NOT superseded → the company still has its old position
    }

    // 3) Write opening_balances rows for the NEW entry (natural balance, linked to the JE).
    try {
      const rows = [];
      for (const [code, val] of Object.entries(merged)) {
        const bal = Math.round((Number(val) || 0) * 100) / 100;
        if (bal === 0) continue;
        const aid = await ensureAccountIdForCode(code);
        if (aid) rows.push({ company_id: cid, account_id: aid, balance: bal, as_of_date: cutoff, journal_entry_id: jeId, posted: true });
      }
      const obe = lines.find(l => l.code === OBE_CODE);
      if (obe) { const aid = await ensureAccountIdForCode(OBE_CODE); if (aid) rows.push({ company_id: cid, account_id: aid, balance: (obe.credit || 0) - (obe.debit || 0), as_of_date: cutoff, journal_entry_id: jeId, posted: true }); }
      if (rows.length) await supabase.from("opening_balances").insert(rows);
    } catch (e) { console.warn("[opening] rows insert:", e?.message || e); }

    // 4) NOW supersede the OLD opening entry(ies) — everything except the one just posted.
    // A failure here leaves the new position live (never none); log loudly for cleanup.
    try {
      const { data: priorJEs } = await supabase.from("journal_entries").select("id")
        .eq("company_id", cid).eq("source", "opening_balance").is("deleted_at", null).eq("status", "posted").neq("id", jeId);
      for (const je of (priorJEs || []))
        await supabase.from("journal_entries").update({ deleted_at: new Date().toISOString(), deleted_by: session.user.id }).eq("id", je.id).eq("company_id", cid);
      await supabase.from("opening_balances").delete().eq("company_id", cid).neq("journal_entry_id", jeId);
      await supabase.from("opening_balances").delete().eq("company_id", cid).is("journal_entry_id", null);  // legacy rows w/o a JE link
    } catch (e) {
      console.warn("[opening] supersede prior failed:", e?.message || e);
      try { Sentry.captureException(e, { tags: { kind: "opening_supersede_failure" }, extra: { company_id: String(cid), new_je: String(jeId) } }); } catch {}
      logAudit("opening_supersede_failure", `New opening entry ${jeId} posted, but couldn't remove the prior one — opening position may be doubled until re-saved`, null, { cutoff, je: String(jeId) });
    }

    logAudit("opening_balances_posted", `Opening balances posted as of ${cutoff} (${lines.length} lines)`, null, { cutoff, je: jeId ? String(jeId) : null });
    try { await loadAllData(); } catch {}
    showNotification(`Opening balances posted as of ${cutoff} ✓`);
    return true;
  };

  // O83 — CONFIRM the statement-derived opening balance (client confirmed the proposal).
  // Books it through the SAME canonical, verified-write path (postOpeningBalances →
  // post_journal_entry, source 'opening_balance', + opening_balances rows). `override` lets
  // the confirm UI adjust the amount. HARD double-booking guard: refuse if an opening already
  // exists for the account (or any opening is posted). Sets the cutoff to the period start.
  const confirmOpeningFromStatement = async (override = {}) => {
    const p = { ...(pendingOpeningProposal || {}), ...override };
    if (p.openingBalance == null || !p.accountCode || !p.periodStart) { showNotification("Nothing to confirm.", "error"); return false; }
    const obRow = (openingBalances || []).find(b => String(b.account_code) === String(p.accountCode) && b.posted);
    if (obRow || openingPosted) { showNotification("An opening balance is already recorded — not adding a second.", "error"); setPendingOpeningProposal(null); return false; }
    // Set the company cutoff (Day One) to the statement period start if not already set.
    if (!cutoffDate) { const okc = await saveCutoffDate(p.periodStart); if (!okc) return false; }
    const ok = await postOpeningBalances({ [p.accountCode]: Number(p.openingBalance) }, { asOf: p.periodStart });
    if (ok) {
      logAudit("opening_balance_from_statement", `Confirmed opening balance ${fmtSignedMoney(p.openingBalance)} for ${p.accountName || p.accountCode} as of ${p.periodStart} (from bank statement)`, null, { accountCode: p.accountCode, periodStart: p.periodStart, amount: Number(p.openingBalance) });
      // O83 — mark the account ADOPTED: write the statement's ENDING balance to the matched
      // account's current_balance (the period's reconciliation target, CLAUDE.md §12). This
      // clears the pristine-seed classification (isPlaceholderBank) so the "Add your bank
      // account" checklist step ticks. Guards: only the MATCHED account; NEVER overwrite a
      // non-zero balance the user already typed (a mismatch there is a discrepancy to review).
      const acct = (bankAccounts || []).find(b => (p.accountId && String(b.id) === String(p.accountId)) || String(b.gl_code) === String(p.accountCode));
      if (acct) {
        const decision = resolveAdoptedBalance({ existingBalance: acct.current_balance, endingBalance: p.endingBalance });
        if (decision.action === "set") {
          try {
            await supabase.from("bank_accounts").update({ current_balance: decision.value }).eq("id", acct.id).eq("company_id", currentCompany.id);
            setBankAccounts(prev => prev.map(b => b.id === acct.id ? { ...b, current_balance: decision.value } : b));
            logAudit("bank_balance_from_statement", `Set ${acct.name || p.accountName} balance to ${fmtSignedMoney(decision.value)} (statement ending balance) on opening confirm`, null, { accountId: acct.id, balance: decision.value });
          } catch (e) { console.warn("[bank_accounts] current_balance update failed:", e?.message || e); }
        } else if (decision.action === "mismatch") {
          // User already typed a DIFFERENT non-zero balance → LEAVE it; surface the difference
          // (a reconciliation question), never a silent auto-adjust.
          logAudit("bank_balance_statement_mismatch", `Kept existing ${acct.name || p.accountName} balance ${fmtSignedMoney(decision.value)}; statement ending is ${fmtSignedMoney(decision.ending)} (off by ${fmtSignedMoney(decision.diff)}) — not overwritten`, null, { accountId: acct.id, existing: decision.value, ending: decision.ending });
          showNotification(`Kept your ${acct.name || "account"} balance (${fmtSignedMoney(decision.value)}); the statement ends at ${fmtSignedMoney(decision.ending)} — worth a look.`, "info");
        }
      }
      setPendingOpeningProposal(null);
    }
    return ok;
  };
  const dismissOpeningProposal = () => setPendingOpeningProposal(null);
  const dismissOpeningDiscrepancy = () => setOpeningDiscrepancyFlag(null);

  // ── CLIENT AI PROFILE (adaptive learning) ──────────────────────────────────
  // A per-company business profile the AI grows over time (table: client_ai_profile).
  // Held in a ref (read into the system prompt on each chat) and persisted with a
  // short debounce so a burst of bookings is one write. All calls are defensive.
  const clientProfileRef = useRef(emptyProfile());
  const profilePersistTimer = useRef(null);
  // Fold a confirmed booking (auto-booked at high confidence OR user-confirmed via
  // the clarification flow / manual entry) into the learned profile. Reversals and
  // entries without a vendor+GL are ignored.
  const recordBookingLearning = (invoice) => {
    try {
      if (!invoice || !invoice.vendor || !invoice.gl_code || invoice.source === "reversal") return;
      clientProfileRef.current = learnFromBooking(clientProfileRef.current, invoice);
      if (profilePersistTimer.current) clearTimeout(profilePersistTimer.current);
      const cid = currentCompany?.id;
      profilePersistTimer.current = setTimeout(() => {
        persistClientProfile(supabase, cid, clientProfileRef.current);
      }, 1500);
    } catch { /* learning is best-effort — never block a booking */ }
  };

  // ── RECURRING EXPENSE DETECTION ─────────────────────────────────────────────
  // After bookings settle, look for vendors that look like undeclared monthly
  // recurring charges and surface them as Home-page suggestions. Lightweight:
  // runs on the already-loaded invoices, debounced 3s after the last booking.
  const [recurringSuggestions, setRecurringSuggestions] = useState([]);
  const recurringRef = useRef([]);
  useEffect(() => { recurringRef.current = recurring; }, [recurring]);
  const dismissedRecurringRef = useRef(new Set());  // vendorKeys the user said no to
  const recurringScanTimer = useRef(null);
  const runRecurringScan = () => {
    try {
      const found = detectRecurringPatterns(invoicesRef.current, recurringRef.current)
        .filter(s => !dismissedRecurringRef.current.has(s.vendorKey));
      setRecurringSuggestions(found);
    } catch { /* best-effort */ }
  };
  const scheduleRecurringScan = () => {
    if (recurringScanTimer.current) clearTimeout(recurringScanTimer.current);
    recurringScanTimer.current = setTimeout(() => { runRecurringScan(); runAnomalyScan(); }, 3000);
  };
  // "Yes, set it up" → create the recurring entry + feed the pattern back into the profile.
  const acceptRecurringSuggestion = (s) => {
    if (!s) return;
    const newRec = {
      id: Date.now() + Math.random(), name: s.vendor, vendor: s.vendor,
      amount: s.avgAmount, gl_code: s.gl_code, gl_name: s.gl_name,
      frequency: "monthly", next_date: todayLocal(),
      project: "General", active: true, created_at: new Date().toISOString(), last_run: null,
    };
    setRecurring(prev => [newRec, ...prev]);
    logAudit("recurring_created", `Recurring set up from detected pattern: ${s.vendor} ~$${s.avgAmount}/mo → ${s.gl_name || s.gl_code}`, null, { vendor: s.vendor, amount: s.avgAmount, gl_code: s.gl_code, gl_name: s.gl_name, frequency: "monthly" });
    try {
      clientProfileRef.current = addCustomRule(clientProfileRef.current, `Recurring pattern detected: ${s.vendor} ~${fmtApprox(s.avgAmount)}/mo → ${s.gl_name || s.gl_code}`);
      persistClientProfile(supabase, currentCompany?.id, clientProfileRef.current);
    } catch {}
    dismissedRecurringRef.current.add(s.vendorKey);
    setRecurringSuggestions(prev => prev.filter(x => x.vendorKey !== s.vendorKey));
    showNotification(`Recurring set up: ${s.vendor} ~${fmtApprox(s.avgAmount)}/mo ✓`);
  };
  // "No thanks" → never suggest this vendor again. "Remind me later" → just hide for now.
  const dismissRecurringSuggestion = (s, remindLater = false) => {
    if (!s) return;
    if (!remindLater) dismissedRecurringRef.current.add(s.vendorKey);
    setRecurringSuggestions(prev => prev.filter(x => x.vendorKey !== s.vendorKey));
  };

  // ── BANK ACCOUNTS (persist incl. current_balance, migration 026) ────────────
  const cashFromBanks = (accts) => (accts || []).reduce((s, a) => s + (Number(a.current_balance) || 0), 0);
  // Upsert every bank account row (name/type/GL/institution/balance) and refresh the
  // dashboard cash balance from the sum. New rows (local numeric id) are inserted;
  // existing rows (uuid id) are updated. Best-effort and defensive.
  const persistBankAccounts = async (accts) => {
    const list = accts || bankAccounts;
    if (!currentCompany?.id) return;
    for (const a of list) {
      if (!String(a.name || "").trim()) continue; // skip empty placeholder rows
      const glId = getAccountByCode(a.gl_code)?.db_id || getAccountByRole("cash")?.db_id || null;
      const row = {
        company_id: currentCompany.id, name: a.name, type: a.type || "checking",
        gl_account_id: glId, institution: a.institution || null, last4: a.last4 || null,
        current_balance: Number(a.current_balance) || 0, active: true,
      };
      const isUuid = typeof a.id === "string" && a.id.includes("-");
      try {
        if (isUuid) {
          await supabase.from("bank_accounts").update(row).eq("id", a.id).eq("company_id", currentCompany.id);
        } else {
          const { data, error } = await supabase.from("bank_accounts").insert(row).select("id").single();
          if (!error && data?.id) setBankAccounts(prev => prev.map(x => x.id === a.id ? { ...x, id: data.id } : x));
        }
      } catch (e) { console.warn("[bank_accounts] persist failed:", e?.message || e); }
    }
  };

  // Create ONE bank-account source inline (O63) — used by the import account-picker so
  // a user with a card statement but no card source set up doesn't dead-end at Settings.
  // The offset GL follows the type (credit_card → 2200, bank → 1000, loan → 2500) via the
  // shared role-resolved nudge. Inserts immediately, returns the new account (with its
  // real DB id) so the caller can auto-select it and import right away.
  const createBankAccountInline = async ({ name, type = "checking", institution = "", last4 = "" }) => {
    if (!currentCompany?.id) { showNotification("No active company.", "error"); return null; }
    const cleanName = String(name || "").trim();
    if (!cleanName) { showNotification("Give the account a name first.", "error"); return null; }
    const glCode = glCodeForAccountType(type, role => getAccountByRole(role)?.code);
    const glId = getAccountByCode(glCode)?.db_id || getAccountByRole("cash")?.db_id || null;
    const row = {
      company_id: currentCompany.id, name: cleanName, type,
      gl_account_id: glId, institution: institution || null, last4: last4 || null,
      current_balance: 0, active: true,
    };
    try {
      const { data, error } = await supabase.from("bank_accounts").insert(row).select("id").single();
      if (error || !data?.id) { showNotification("Couldn't create the account — please try again.", "error"); return null; }
      const acct = { id: data.id, name: cleanName, type, gl_code: glCode, institution: institution || "", last4: last4 || "", current_balance: 0 };
      setBankAccounts(prev => [...prev, acct]);
      logAudit("bank_account_created", `Inline-created ${type.replace("_"," ")} account "${cleanName}" (offset GL ${glCode}) during bank import`);
      return acct;
    } catch (e) {
      console.warn("[bank_accounts] inline create failed:", e?.message || e);
      showNotification("Couldn't create the account — please try again.", "error");
      return null;
    }
  };

  // ── ANOMALY DETECTION → PERSISTED RECORDS (Item 32 / O83) ────────────────────
  // Detection (runAnomalyDetection) is a pure function of the ledger; results are now
  // RECONCILED against the `anomalies` table (migration 056) by stable fingerprint, so
  // anomalies persist, dedup, AUTO-RESOLVE when their condition disappears (clearing is
  // an event, not amnesia — the O83 fix), and feed the trust layer (owner panel + sign-off
  // gate + Review). localStorage dismissals are retired (device-local; unmigratable).
  //   anomalyRows — open + dismissed + ATTESTED rows: the reconcile source + the
  //     re-insert-suppression set. Attested rows (C198·3b f1) carry status 'resolved'
  //     but MUST be loaded — they are what stops the next scan re-opening every note a
  //     sign-off just retired, and what a revoke matches on to give them back.
  //     `anomalies` (derived) — the OPEN rows in view shape.
  const [anomalyRows, setAnomalyRows] = useState([]);
  const anomalyRowsRef = useRef([]);
  const anomaliesLoadedRef = useRef(false);
  const anomalyScanBusyRef = useRef(false);
  const applyAnomalyRows = (rows) => { const r = Array.isArray(rows) ? rows : []; anomalyRowsRef.current = r; setAnomalyRows(r); };
  const anomalies = useMemo(
    () => (anomalyRows || []).filter(r => r.status === "open")
      .map(r => ({ ...r, description: r.detail, invoice_ids: Array.isArray(r.entity_refs) ? r.entity_refs : [] })),
    [anomalyRows]
  );
  const openHighAnomalyCount = useMemo(() => anomalies.filter(a => a.severity === "high").length, [anomalies]);

  const loadAnomalies = async (companyId) => {
    const cid = companyId || currentCompany?.id;
    if (!cid) return;
    try {
      const { data } = await supabase.from("anomalies").select("*")
        .eq("company_id", cid)
        .or(`status.eq.open,status.eq.dismissed,resolution.eq.${ANOMALY_RESOLUTION.ATTESTED}`)
        .order("created_at", { ascending: false });
      if (Array.isArray(data)) { applyAnomalyRows(data); anomaliesLoadedRef.current = true; }
    } catch { /* table may not exist yet (pre-056) — degrade gracefully */ }
  };

  // Reconcile the freshly-detected set against the table: INSERT new open rows, AUTO-RESOLVE
  // open rows whose condition vanished. One read (in-memory rows) + batched writes; writes
  // ONLY fire on a real delta, so steady-state scans (every ledger change) are free.
  const runAnomalyScan = async () => {
    const cid = currentCompany?.id;
    if (!cid || !anomaliesLoadedRef.current || anomalyScanBusyRef.current) return;
    anomalyScanBusyRef.current = true;
    try {
      // C195(3) — PATTERN SUPPRESSION: a duplicate the reviewer already dismissed for the same
      // vendor+amount within 60 days is downgraded to 'low' (LOW never blocks sign-off — the gate
      // counts HIGH-in-period only), so a legitimately recurring charge stops re-alarming monthly.
      const detected = applyPatternSuppression(
        runAnomalyDetection(invoicesRef.current, recurringRef.current),
        anomalyRowsRef.current
      );
      const { toInsert, toResolve } = reconcileAnomalies({ detected, rows: anomalyRowsRef.current });
      if (!toInsert.length && !toResolve.length) return;   // no delta → no writes
      let inserted = [];
      if (toInsert.length) {
        const { data, error } = await supabase.from("anomalies").insert(toInsert.map(d => anomalyInsertRow(cid, d))).select();
        if (error) { if (!/duplicate|unique|23505/i.test(error.message || "")) console.warn("[anomaly] insert:", error.message); }
        else if (Array.isArray(data)) inserted = data;
      }
      if (toResolve.length) {
        const ids = toResolve.map(r => r.id).filter(Boolean);
        if (ids.length) await supabase.from("anomalies").update({ status: "resolved", resolution: "auto", resolved_at: new Date().toISOString() }).in("id", ids).eq("company_id", cid);
        logAudit("anomaly_auto_resolved", `${ids.length} anomaly ${ids.length === 1 ? "condition" : "conditions"} cleared`, null, { fingerprints: toResolve.map(r => r.fingerprint) });
      }
      await loadAnomalies(cid);
      // Bell agrees with the table: alert on the newest new HIGH; clear stale anomaly
      // notifications once no open HIGH remains.
      const newHigh = inserted.find(r => r.severity === "high");
      if (newHigh) {
        const txn = (newHigh.entity_refs || [])[0];
        createNotification({ type: "anomaly", title: newHigh.title, description: newHigh.detail, link_view: txn != null ? `txn:${txn}` : "home" });
      }
      if (!anomalyRowsRef.current.some(a => a.status === "open" && a.severity === "high")) {
        try { await supabase.from("notifications").update({ dismissed: true }).eq("company_id", cid).eq("type", "anomaly").eq("dismissed", false); } catch { /* best-effort */ }
      }
    } catch (e) { console.warn("[anomaly] scan failed:", e?.message || e); }
    finally { anomalyScanBusyRef.current = false; }
  };

  // Human dismissal — the ONLY human verb (resolve is auto-only). Requires a reason,
  // persisted + durable across sessions/devices; the fingerprint is then suppressed from
  // re-insertion. PERMANENTLY reviewer-gated in the UI (not interim): dismissing is a
  // judgment that a flagged condition is ACCEPTABLE — a review act — so a client dismissing
  // their own anomalies would be self-attestation one anomaly at a time (the O83 separation-
  // of-duties line). The owner sees anomalies honestly in their trust panel but can't clear
  // them. Verified write (reload after).
  const dismissAnomaly = async (id, reason) => {
    const cid = currentCompany?.id;
    const trimmed = String(reason || "").trim();
    if (!trimmed) return { ok: false, error: "a reason is required to dismiss an anomaly" };
    if (!cid || !id) return { ok: false, error: "missing company/anomaly" };
    try {
      const { error } = await supabase.from("anomalies")
        .update({ status: "dismissed", dismissed_reason: trimmed, resolution: "dismissed", resolved_at: new Date().toISOString(), resolved_by: session?.user?.id || null })
        .eq("id", id).eq("company_id", cid);
      if (error) return { ok: false, error: error.message };
      logAudit("anomaly_dismissed", `Anomaly dismissed: ${trimmed}`, null, { anomaly_id: id, reason: trimmed });
      await loadAnomalies(cid);
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  };

  // ── C198·3b (f1) — ANOMALIES EXPIRE WITH THE MONTH, AND COME BACK IF IT REOPENS ──
  // 'attested' is its own resolution (migration 060), not a dismissal: nobody judged
  // THIS note, they attested the month over it — folding it into 'dismissed' would feed
  // priorDismissalFor and quietly downgrade later duplicates for the same vendor+amount.
  // And not 'auto' either: the condition is still in the ledger, so 'auto' would be
  // undone by the next scan (reconcileAnomalies only suppresses re-insert for a
  // dismissal or an attestation).
  const expireAnomaliesForSignedPeriod = async (period) => {
    const cid = currentCompany?.id;
    if (!cid || !period) return;
    try {
      const expiring = anomaliesExpiredBySignoff(anomalyRowsRef.current, period, invoicesRef.current);
      const ids = expiring.map(a => a.id).filter(Boolean);
      if (!ids.length) return;
      const { error } = await supabase.from("anomalies")
        .update({ status: "resolved", resolution: ANOMALY_RESOLUTION.ATTESTED, attested_period: period, resolved_at: new Date().toISOString(), resolved_by: null, dismissed_reason: null })
        .in("id", ids).eq("company_id", cid);
      if (error) { console.error("[anomaly] sign-off expiry failed:", error.message); return; }
      logAudit("anomaly_expired_on_signoff", `${ids.length} open ${ids.length === 1 ? "note" : "notes"} retired — ${ATTESTED_NOTE} (${period})`, null, { period, anomaly_ids: ids, fingerprints: expiring.map(a => a.fingerprint) });
      await loadAnomalies(cid);
    } catch (e) { console.error("[anomaly] sign-off expiry error:", e?.message || e); }
  };

  const reopenAnomaliesForRevokedPeriod = async (period) => {
    const cid = currentCompany?.id;
    if (!cid || !period) return;
    try {
      const reopening = anomaliesReopenedByRevoke(anomalyRowsRef.current, period);
      const ids = reopening.map(a => a.id).filter(Boolean);
      if (!ids.length) return;
      const { error } = await supabase.from("anomalies")
        .update({ status: "open", resolution: null, attested_period: null, resolved_at: null, resolved_by: null })
        .in("id", ids).eq("company_id", cid);
      if (error) { console.error("[anomaly] revoke reopen failed:", error.message); return; }
      logAudit("anomaly_reopened_on_revoke", `${ids.length} ${ids.length === 1 ? "note" : "notes"} reopened — ${period}'s sign-off was revoked`, null, { period, anomaly_ids: ids });
      await loadAnomalies(cid);
    } catch (e) { console.error("[anomaly] revoke reopen error:", e?.message || e); }
  };

  // ── NOTIFICATIONS (Item 55) ─────────────────────────────────────────────────
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const unreadNotifs = notifications.filter(n => !n.read).length;
  const loadNotifications = async (companyId) => {
    const cid = companyId || currentCompany?.id;
    if (!cid) return;
    try {
      const { data } = await supabase.from("notifications")
        .select("*").eq("company_id", cid).eq("dismissed", false)
        .order("created_at", { ascending: false }).limit(50);
      if (!Array.isArray(data)) return;
      // Heal any pre-existing duplicates: keep the newest per type, dismiss the rest in
      // the DB so the 4×-same-alert backlog clears on first load.
      const seen = new Set(), keep = [], dupIds = [];
      for (const n of data) { if (seen.has(n.type)) dupIds.push(n.id); else { seen.add(n.type); keep.push(n); } }
      setNotifications(keep);
      if (dupIds.length) { try { await supabase.from("notifications").update({ dismissed: true }).in("id", dupIds); } catch { /* best-effort */ } }
    } catch { /* table may be absent */ }
  };
  // One ACTIVE notification per type. If a non-dismissed one already exists, refresh its
  // content in place instead of stacking a duplicate — several alert titles embed a
  // changing value (e.g. reconciliation "…in 36 days" → "37 days"), so a per-day/per-title
  // insert produced 3–4 near-identical copies. Dismissing/clearing lets a fresh one appear.
  const createNotification = async ({ type, title, description = null, link_view = null }) => {
    const cid = currentCompany?.id;
    if (!cid || !type || !title) return;
    try {
      const { data: existing } = await supabase.from("notifications")
        .select("id").eq("company_id", cid).eq("type", type).eq("dismissed", false)
        .order("created_at", { ascending: false }).limit(1);
      if (Array.isArray(existing) && existing.length) {
        const id = existing[0].id;
        await supabase.from("notifications").update({ title, description, link_view }).eq("id", id);
        setNotifications(prev => prev.map(n => n.id === id ? { ...n, title, description, link_view } : n));
        return;
      }
      const { data, error } = await supabase.from("notifications")
        .insert({ company_id: cid, type, title, description, link_view }).select("*").single();
      if (!error && data) setNotifications(prev => [data, ...prev]);
    } catch { /* best-effort */ }
  };
  const markNotifRead = async (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
    try { await supabase.from("notifications").update({ read: true }).eq("id", id); } catch {}
  };
  const markAllNotifsRead = async () => {
    const cid = currentCompany?.id;
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    try { await supabase.from("notifications").update({ read: true }).eq("company_id", cid).eq("read", false); } catch {}
  };
  const clearAllNotifs = async () => {
    const cid = currentCompany?.id;
    setNotifications([]);
    try { await supabase.from("notifications").update({ dismissed: true }).eq("company_id", cid).eq("dismissed", false); } catch {}
  };
  const openNotification = (n) => {
    markNotifRead(n.id);
    if (n.type === "monthly_report") setReportType("monthly"); // land on the archive tab
    // `txn:<id>` link targets open the flagged entry in the detail panel (e.g. a
    // duplicate-payment alert) instead of a bare view string.
    const txnLink = typeof n.link_view === "string" && n.link_view.startsWith("txn:") ? n.link_view.slice(4) : null;
    if (txnLink) {
      const inv = (invoices || []).find(i => String(i.id) === String(txnLink) || String(i.db_entry_id) === String(txnLink));
      if (inv) { setReturnTo({ view: "home" }); setSelectedInvoice(inv); setView("detail"); }
      else setView("home");
    } else if (n.link_view) setView(n.link_view);
    setNotifOpen(false);
  };
  // Check all triggers and create notifications (deduped) — run after data loads.
  const generateNotifications = () => {
    try {
      // Tax deadline within 30 days, with the estimated amount.
      const nextDue = getTaxDeadlines(new Date()).find(d => d.days >= 0 && d.days <= 30);
      if (nextDue) {
        const est = taxEstimate(invoicesRef.current, new Date().getFullYear());
        const amt = nextDue.est && est.quarterly > 0 ? ` — est. ${fmtApprox(est.quarterly)}` : "";
        createNotification({ type: "tax_deadline", title: `${nextDue.label} due in ${nextDue.days} day${nextDue.days === 1 ? "" : "s"}${amt}`, description: nextDue.plain, link_view: "tax" });
      }
      // Reconciliation overdue (> 35 days since the last, or never).
      const lastRecon = (reconciliationsRef.current || []).map(r => r.created_at || r.statement_date).filter(Boolean).sort().pop();
      const reconAge = lastRecon ? (Date.now() - new Date(lastRecon)) / 86400000 : Infinity;
      if (reconAge > 35) {
        createNotification({ type: "reconciliation", title: lastRecon ? `Books not matched to your bank in ${Math.round(reconAge)} days` : "Your books haven't been matched to your bank yet", description: "Run a quick bank match to make sure everything is accounted for.", link_view: "recon" });
      }
      // Items waiting for review.
      const pendingClar = (clarificationQueueRef.current || []).filter(c => !c.resolved).length;
      if (pendingClar > 0) {
        createNotification({ type: "needs_review", title: `${pendingClar} item${pendingClar === 1 ? "" : "s"} need your input`, description: "Some uploaded documents are waiting for a quick answer before they're booked.", link_view: "home" });
      }
      // High-severity anomalies — from the PERSISTED open rows (single source, so the bell
      // agrees with the table + the trust panel). Asserts a notification for an existing open
      // HIGH loaded from a prior session (runAnomalyScan only fires on NEW inserts).
      const topAnom = (anomalyRowsRef.current || []).find(a => a.status === "open" && a.severity === "high");
      if (topAnom) {
        // Route the alert straight to the flagged transaction when the anomaly carries
        // one (e.g. "possible duplicate payment") — encode it in link_view as `txn:<id>`,
        // which openNotification opens in the detail panel. Falls back to home otherwise.
        const anomTxn = (topAnom.entity_refs || [])[0];
        createNotification({ type: "anomaly", title: topAnom.title, description: topAnom.detail, link_view: anomTxn != null ? `txn:${anomTxn}` : "home" });
      }
    } catch (e) { console.warn("[notifications] generate failed:", e?.message || e); }
  };

  // ── AUTOMATIC MONTHLY REPORTS (Item 11) ──────────────────────────────────────
  // AI-written 3-5 sentence executive summary; falls back to the templated one
  // baked into the payload by buildMonthlyReport if the proxy call fails.
  const generateExecSummary = async (period, payload) => {
    try {
      const pl = payload.pl;
      // The INSTRUCTIONS live server-side (profile "exec-summary"); the client sends only the
      // figures as DATA slots (PERIOD, FIGURES). The server wraps FIGURES in untrusted-data
      // delimiters, so even a hostile vendor name in the figures can't act as an instruction.
      const figures = [
        `Revenue: ${fmtMoney(pl.revenue.current)} (prior month ${fmtMoney(pl.revenue.prior)})`,
        `Total expenses: ${fmtMoney(pl.expenses_total.current)} (prior ${fmtMoney(pl.expenses_total.prior)})`,
        `Net income: ${fmtSignedMoney(pl.net_income.current)} (prior ${fmtSignedMoney(pl.net_income.prior)})`,
        `Cash on hand: ${fmtMoney(payload.cash.cash_on_hand)}; monthly burn: ${fmtMoney(payload.cash.burn_rate)}; runway: ${payload.cash.runway_months ?? "n/a"} months`,
        `Receivables: ${fmtMoney(payload.receivables.total)} (${fmtMoney(payload.receivables.overdue)} overdue); Payables: ${fmtMoney(payload.payables.total)} (${fmtMoney(payload.payables.overdue)} overdue)`,
        `Top vendors: ${payload.top_vendors.map(v => `${v.vendor} ${fmtMoney(v.total)}`).join(", ") || "none"}`,
        `Business health: ${payload.health.headline || payload.health.tone || "n/a"}`,
        payload.anomalies.length ? "Flags: " + payload.anomalies.map(a => a.title).join("; ") : "No anomalies flagged.",
      ].join("\n");
      const data = await callAIProxy({
        profile: "exec-summary",
        slots: { PERIOD: formatPeriod(period), FIGURES: figures },
        messages: [{ role: "user", content: "Write the executive summary from the figures in the instructions." }],
      });
      const text = data?.content?.find(b => b.type === "text")?.text?.trim();
      return text || null;
    } catch (e) { console.warn("[monthly_report] AI summary failed, using template:", e?.message || e); return null; }
  };

  // After data loads: generate the just-ended month's report if one doesn't exist
  // yet and there's been activity. The unique (company_id, period) DB constraint
  // makes double-generation impossible — a conflict is swallowed silently.
  const maybeGenerateMonthlyReport = async () => {
    const cid = currentCompany?.id;
    if (!cid) return;
    try {
      const now = new Date();
      const thisPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      const target = priorPeriod(thisPeriod);                       // the most recently completed month
      const { data: existing } = await supabase.from("monthly_reports").select("id").eq("company_id", cid).eq("period", target).limit(1);
      if (Array.isArray(existing) && existing.length) return;       // already generated

      const live = (invoicesRef.current || []).filter(i => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at);
      const cutoff = `${target}-31`;
      if (!live.some(i => String(i.date || "") <= cutoff)) return;   // no posted activity in/before the month → skip (new company)

      const payload = buildMonthlyReport(target, {
        invoices: live, cashBalance: glCashOnHand(invoices, cashGlCodes, { asOf: `${target}-31` }),
        reconciliations: reconciliationsRef.current,
        anomalies, onboardingComplete: companySettings.onboardingComplete,
        fiscalYearEnd: companySettings.fiscalYearEnd || "12-31",
      });
      const aiSummary = await generateExecSummary(target, payload);
      if (aiSummary) payload.summary = aiSummary;

      const { error } = await supabase.from("monthly_reports").insert({ company_id: cid, period: target, data: payload });
      if (error) {
        if (!/duplicate|unique|conflict|23505/i.test(error.message || "")) console.warn("[monthly_report] insert:", error.message);
        return;                                                      // conflict = generated elsewhere; nothing to do
      }
      logAudit("monthly_report_generated", `Monthly financial summary generated for ${formatPeriod(target)}`, null, { period: target, net_income: payload.pl.net_income.current });
      createNotification({
        type: "monthly_report",
        title: `Your ${formatPeriod(target)} financial summary is ready`,
        description: "Your monthly P&L, cash position, KPIs, and an executive summary — ready to review.",
        link_view: "reports",
      });
    } catch (e) { console.warn("[monthly_report] generate failed:", e?.message || e); }
  };

  // ── ONBOARDING (Item 54) ────────────────────────────────────────────────────
  const [onboardingUploadDone, setOnboardingUploadDone] = useState(false);
  // False until the FIRST loadAllData for the current company has finished. Lets views
  // distinguish "data not loaded yet" from "genuinely empty/incomplete" — e.g. the Home
  // onboarding checklist must not flash its "0 of 4 done" welcome card on refresh before
  // companySettings/bankAccounts/invoices have arrived. Reset to false on company switch.
  const [companyDataLoaded, setCompanyDataLoaded] = useState(false);
  const [businessModalOpen, setBusinessModalOpen] = useState(false);
  const [accountantDismissed, setAccountantDismissed] = useState(() => { try { return localStorage.getItem("cfai_onboard_accountant_dismissed") === "1"; } catch { return false; } });
  // Persist the business-type + fiscal-year answers to the company record.
  const saveBusinessProfile = async ({ businessType, fiscalYearEnd }) => {
    const cid = currentCompany?.id;
    setCompanySettings(prev => ({ ...prev, businessType, fiscalYearEnd }));
    setBusinessModalOpen(false);
    if (!cid) return;
    try { await supabase.from("companies").update({ business_type: businessType, fiscal_year_end: fiscalYearEnd }).eq("id", cid); } catch (e) { console.warn("[onboarding] save profile:", e?.message || e); }
  };
  const dismissAccountantStep = () => { try { localStorage.setItem("cfai_onboard_accountant_dismissed", "1"); } catch {} setAccountantDismissed(true); };
  // Mark onboarding finished once the required steps are done (persist the flag).
  const completeOnboarding = async () => {
    const cid = currentCompany?.id;
    setCompanySettings(prev => ({ ...prev, onboardingComplete: true }));
    if (!cid) return;
    try { await supabase.from("companies").update({ onboarding_complete: true }).eq("id", cid); } catch (e) { console.warn("[onboarding] complete:", e?.message || e); }
  };

  // Refs kept current for the scans (avoid stale closures). Declared AFTER the
  // invoicesRef sync (top of the component) so the effects below see fresh data.
  const reconciliationsRef = useRef([]);
  const clarificationQueueRef = useRef([]);
  useEffect(() => { reconciliationsRef.current = reconciliations; }, [reconciliations]);
  useEffect(() => { clarificationQueueRef.current = clarificationQueue; }, [clarificationQueue]);

  // Re-run anomaly detection whenever the ledger or recurring rules change (covers
  // initial load and every booking). Declared after the ref-sync effects above so it
  // reads fresh data; runAnomalyScan reconciles against the persisted table and only
  // writes on a real delta (no-op once loaded + steady-state).
  useEffect(() => {
    if (currentCompany?.id) runAnomalyScan();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices, recurring, currentCompany?.id]);

  // Generate notifications once per company (after a delay so synced refs/state are
  // current). createNotification de-dups within 24h, so re-runs are harmless.
  const notifGenRef = useRef(null);
  useEffect(() => {
    const cid = currentCompany?.id;
    if (!cid || notifGenRef.current === cid) return;
    notifGenRef.current = cid;
    const t = setTimeout(() => generateNotifications(), 800);
    // Generate the just-ended month's report a beat later, once invoices/cash refs are synced.
    const t2 = setTimeout(() => maybeGenerateMonthlyReport(), 1600);
    return () => { clearTimeout(t); clearTimeout(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

  // ── POST-BOOKING VISIBILITY INVARIANT ───────────────────────────────────────
  // A booked entry that doesn't show up in the ledger must NEVER fail silently.
  // After every bookToDb (and the QBO import batch), we re-fetch the flattened
  // ledger and confirm the new entry id(s) are actually present/visible. Any miss
  // → Sentry error (ids/source/status only, no financials) + audit_log row +
  // a non-dismissable amber banner.
  const pendingVerifyRef = useRef(new Map());   // db_entry_id(str) → { source, status }
  const verifyTimerRef = useRef(null);
  const flagBookingVisibilityFailure = (info = {}) => {
    // Sentry — ids/source/status/counts ONLY (beforeSend scrubbing forbids financials).
    try {
      Sentry.captureMessage("booking_visibility_failure", {
        level: "error",
        tags: { kind: "booking_visibility_failure", booking_source: info.source || "unknown" },
        extra: {
          entry_id: info.entry_id || null,
          booking_source: info.source || null,
          entry_status: info.status || null,
          import_batch: info.batch_id || null,
          expected_count: info.expected ?? null,
          actual_count: info.actual ?? null,
        },
      });
    } catch { /* Sentry is a no-op without a DSN */ }
    const detail = info.batch_id
      ? `QuickBooks import batch ${info.batch_id}: only ${info.actual} of ${info.expected} inserted entries are visible (source qbo_import).`
      : `Entry ${info.entry_id} was saved but is not visible in the ledger (source ${info.source || "?"}, status ${info.status || "?"}).`;
    logAudit("booking_visibility_failure", detail, null, {
      entry_id: info.entry_id || null, source: info.source || null, status: info.status || null,
      batch_id: info.batch_id || null, expected: info.expected ?? null, actual: info.actual ?? null,
    });
    setVisibilityAlert(true);
  };

  // Debounced batch verifier — one re-fetch covers a burst of bookings.
  const runVisibilityCheck = async () => {
    const cid = currentCompany?.id;
    const expected = new Map(pendingVerifyRef.current);
    pendingVerifyRef.current.clear();
    if (!cid || expected.size === 0) return;
    let rows;
    try { rows = await fetchLedger(supabase, cid, CHART_OF_ACCOUNTS); }
    catch (e) { console.warn("[visibility] verify fetch failed — not alarming:", e?.message || e); return; } // can't verify ≠ failure
    const visible = new Set((rows || []).map(r => String(r.db_entry_id)));
    for (const [id, meta] of expected) {
      if (!visible.has(String(id))) flagBookingVisibilityFailure({ entry_id: id, ...meta });
    }
  };
  const queueVisibilityCheck = (jeId, invoice) => {
    if (!jeId) return;
    pendingVerifyRef.current.set(String(jeId), { source: invoice?.source || null, status: invoice?.status || null });
    if (verifyTimerRef.current) clearTimeout(verifyTimerRef.current);
    verifyTimerRef.current = setTimeout(() => runVisibilityCheck(), 1500); // let the burst + state settle
  };

  // Persist a journal entry and write the returned Supabase ID back into invoices state
  // so that deleteJournalEntry can find and mark it deleted later.
  const bookToDb = (invoice) => {
    return persistJournalEntry(invoice).then(jeId => {
      if (jeId) {
        setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, db_entry_id: jeId } : i));
        // Re-link any source document that was attached using the in-session id,
        // so it survives a refresh (matched by the durable db_entry_id).
        relinkDocsForInvoice(invoice.id, jeId);
        // Teach the client profile from every confirmed booking.
        recordBookingLearning(invoice);
        // Look for new recurring-charge patterns (debounced).
        scheduleRecurringScan();
        // Post-booking visibility invariant — verify it actually shows in the ledger.
        queueVisibilityCheck(jeId, invoice);
      } else {
        // Defense in depth: persistJournalEntry rejected/failed (e.g. a pre-cutoff
        // booking blocked by the DB-layer guard, or an RPC error). Roll back the
        // optimistic add so the UI never shows a transaction that isn't in the ledger.
        setInvoices(prev => prev.filter(i => i.id !== invoice.id));
      }
      return jeId;
    });
  };

  // Pre-flight booking gate (cutoff enforcement, up front): call BEFORE the
  // optimistic setInvoices and any "Booked ✓" toast. Returns false (and toasts the
  // redirect message) for a pre-cutoff date; true when bookable. The DB-layer guard
  // in persistJournalEntry remains as a backstop for any path that skips this.
  const assertBookable = (date) => {
    const reason = bookingBlockedReason(date, cutoffDate);
    if (reason) {
      showNotification(reason, "error");
      logAudit("pre_cutoff_booking_blocked", `Blocked booking dated ${date} before cutoff ${cutoffDate}`, null, { date, cutoff: cutoffDate });
      return false;
    }
    return true;
  };

  // Move any document linked to a transient invoice id over to its durable
  // db_entry_id, in both local state and Supabase.
  const relinkDocsForInvoice = async (fromId, toId) => {
    if (fromId == null || toId == null) return;
    const from = String(fromId), to = String(toId);
    if (from === to) return;
    let hadLocal = false;
    setDocLibrary(prev => prev.map(d => {
      if (String(d.linked_invoice_id) === from) { hadLocal = true; return { ...d, linked_invoice_id: to }; }
      return d;
    }));
    if (!currentCompany?.id) return;
    try {
      await supabase.from("documents").update({ linked_invoice_id: to })
        .eq("company_id", currentCompany.id).eq("linked_invoice_id", from);
    } catch (e) { if (hadLocal) console.warn("[documents] relink failed:", e?.message || e); }
  };

  // Remove a journal entry from Supabase so it never reloads.
  // Soft-deletes a journal entry (sets deleted_at/deleted_by) so it vanishes from
  // every view but stays fully recoverable. Returns the DB entry ids touched so the
  // Undo toast can restore them. The audit_log keeps the immutable record.
  const softDeleteJournalEntry = async (invoice) => {
    if (!currentCompany?.id) return [];
    // SIGNED-PERIOD guard (O83 Trap 2): deleting/voiding an entry inside a signed month removes
    // value the attestation vouches for — block it (reopen first). Opening entries exempt.
    const delPeriod = signedPeriodForDate(invoice?.date, signoffs, { source: invoice?.source });
    if (delPeriod) {
      showNotification(`${signedMonthLabel(delPeriod) || "That month"} is signed off — reopen it first to remove entries from it.`, "error");
      logAudit("signed_period_mutation_blocked", `Blocked delete/void of an entry dated ${invoice?.date} in signed period ${delPeriod}`, null, { period: delPeriod, date: invoice?.date, action: "delete" });
      return [];
    }
    const uid = session?.user?.id || null;
    const ids = [];
    const mark = async (jeId) => {
      const { error } = await supabase.from("journal_entries")
        .update({ deleted_at: new Date().toISOString(), deleted_by: uid })
        .eq("id", jeId)
        .eq("company_id", currentCompany.id);
      if (error) console.error("softDeleteJournalEntry failed:", jeId, error.message);
      else ids.push(jeId);
    };
    try {
      if (invoice?.db_entry_id) {
        await mark(invoice.db_entry_id);
      } else if (invoice?.vendor && invoice?.date) {
        // Fallback for entries booked this session before db_entry_id was written back.
        const prefix = (invoice.vendor || "").split(" ")[0];
        const { data: matches } = await supabase.from("journal_entries")
          .select("id")
          .eq("company_id", currentCompany.id)
          .eq("entry_date", invoice.date)
          .eq("status", "posted")
          .is("deleted_at", null)
          .ilike("description", `${prefix}%`);
        if (matches?.length) { for (const m of matches) await mark(m.id); }
      }
    } catch(e) { console.error("softDeleteJournalEntry error:", e); }
    // Step 1 integrity: reverse any GL payment entry linked to a deleted/voided bill,
    // so a paid bill's Dr AP/Cr Cash movement never outlives the bill. Linked payment
    // JEs are added to `ids` (via mark) so Undo restores them together with the bill.
    try {
      for (const billId of [...ids]) {
        const { data: pays } = await supabase.from("journal_entries").select("id")
          .eq("company_id", currentCompany.id)
          .eq("import_metadata->>payment_for", String(billId))
          .is("deleted_at", null).eq("status", "posted");
        for (const p of (pays || [])) await mark(p.id);
      }
    } catch (e) { console.warn("reverse linked payments on delete failed:", e?.message || e); }
    // O76 display-sync (CLASS fix): drop every just-deleted entry from the live ledger
    // immediately, anchored HERE at the single DB-delete function — so EVERY delete path
    // (the Undo-batch wrapper, the AI chat delete_invoice, any future caller) re-syncs the
    // read-model without re-implementing removal. Soft-deleted rows otherwise lingered in the
    // list until a manual refresh (loadAllData filters deleted_at, but nothing invalidated
    // the in-memory `invoices`). Idempotent with softDeleteInvoices' own optimistic filter.
    if (ids.length) {
      const idset = new Set(ids.map(String));
      setInvoices(prev => prev.filter(i => !idset.has(String(i.db_entry_id)) && !idset.has(String(i.id))));
    }
    return ids;
  };
  // Restore soft-deleted journal entries (clears deleted_at) — used by Undo and admins.
  const restoreJournalEntries = async (ids) => {
    if (!currentCompany?.id || !ids?.length) return;
    const { error } = await supabase.from("journal_entries")
      .update({ deleted_at: null, deleted_by: null })
      .in("id", ids)
      .eq("company_id", currentCompany.id);
    if (error) console.error("restoreJournalEntries failed:", error.message);
  };
  // Back-compat name used across call sites.
  const deleteJournalEntry = softDeleteJournalEntry;

  // Centralized invoice delete with a single 30-second Undo toast that restores the
  // whole batch. byAI tags the audit rows as performed by the AI chat.
  const softDeleteInvoices = async (list, byAI=false) => {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;
    const snaps = items.map(i => ({ ...i }));
    snaps.forEach(s => logAudit("invoice_deleted", `Deleted: ${s.vendor} $${s.amount} on ${s.date} (${s.gl_name||""})`, s, null, byAI ? "AI Chat" : "owner"));
    const idset = new Set(snaps.map(s => String(s.id)));
    setInvoices(prev => prev.filter(i => !idset.has(String(i.id))));
    let allIds = [];
    for (const inv of items) { const ids = await softDeleteJournalEntry(inv); allIds = allIds.concat(ids); }
    const label = items.length === 1 ? (snaps[0].vendor || "entry") : `${items.length} entries`;
    showNotification(`Deleted ${label} — tap Undo to restore`, "success", async () => {
      if (allIds.length) await restoreJournalEntries(allIds);
      setInvoices(prev => { const have = new Set(prev.map(i => String(i.id))); return [...snaps.filter(s => !have.has(String(s.id))), ...prev]; });
      logAudit("invoice_restored", `Restored ${items.length} entr${items.length===1?"y":"ies"}`, null, null);
      showNotification("Restored ✓");
    });
    return allIds;   // committed journal_entry ids — callers (AI chat) gate "✓ done" on a non-empty result (O78)
  };
  const softDeleteInvoice = (invoice, byAI=false) => softDeleteInvoices([invoice], byAI);

  // Centralized void with Undo. Void is client-session state (matching existing behavior).
  // GAAP reversal (#14): post a balanced OFFSETTING entry that mirrors every line of
  // the original, through the canonical post_journal_entry RPC. The original entry is
  // KEPT (audit trail) and stays live; the reversal cancels its GL effect (net zero) —
  // we do NOT also set status="voided" (that would double-remove). Linked to the
  // original via import_metadata.reverses and idempotent (one live reversal per entry).
  const reverseJournalEntry = async (invoice, reason, byAI = false) => {
    if (!invoice || !currentCompany?.id || !session?.user?.id) return null;
    const origId = resolveEntryDbId(invoice) || invoice.db_entry_id || null;
    if (!origId) { showNotification("Can't reverse — entry isn't saved yet", "error"); return null; }
    // Idempotency (CR-17). GL-TRUTH first: a live reversing entry already in the loaded
    // ledger makes a repeat provably inert (no double-negation), and it can't depend on a
    // post-write that might have failed. The DB probe is a belt-and-suspenders backstop for
    // entries outside the loaded window.
    if (alreadyReversed(invoicesRef.current, origId)) {
      showNotification("Already reversed", "error");
      const ex = (invoicesRef.current || []).find(r => r.import_metadata && String(r.import_metadata.reverses) === String(origId));
      return ex ? resolveEntryDbId(ex) : true;
    }
    try {
      const { data: existing } = await supabase.from("journal_entries").select("id")
        .eq("company_id", currentCompany.id).eq("import_metadata->>reverses", String(origId))
        .is("deleted_at", null).eq("status", "posted").limit(1);
      if (Array.isArray(existing) && existing.length) { showNotification("Already reversed", "error"); return existing[0].id; }
    } catch { /* probe failed — GL-truth guard above already covers the common repeat */ }

    const { data: orig, error: loadErr } = await supabase.from("journal_entries")
      .select("entry_date, description, journal_entry_lines(account_id, debit, credit, memo)")
      .eq("id", origId).eq("company_id", currentCompany.id).single();
    if (loadErr || !orig) { showNotification("Couldn't load the entry to reverse", "error"); return null; }
    const lines = buildReversalLines(orig.journal_entry_lines);
    if (!lines.length) { showNotification("Nothing to reverse on that entry", "error"); return null; }

    // Post the reversal WITH its link metadata in the SAME atomic RPC (p_meta persists to
    // import_metadata — the depreciation guard relies on the same contract). No separate,
    // swallowable update: the idempotency marker is written iff the entry is posted.
    const { data: rpcData, error: rpcErr } = await supabase.rpc("post_journal_entry", {
      p_company_id: currentCompany.id, p_entry_date: todayLocal(),
      p_description: `REVERSAL: ${orig.description || invoice.vendor || "entry"}${reason ? ` — ${reason}` : ""}`,
      p_source: "manual", p_created_by: session.user.id, p_lines: lines,
      p_meta: { kind: "reversal", reverses: String(origId) },
    });
    if (rpcErr) { console.error("[reverse] post failed:", rpcErr.message); showNotification("Couldn't post the reversal — " + rpcErr.message, "error"); return null; }
    const revId = rpcData?.id || rpcData?.entry?.id || null;
    logAudit("entry_reversed", `Reversed ${invoice.vendor || orig.description || "entry"} · $${(invoice.amount || 0).toFixed(2)}${reason ? ` — ${reason}` : ""}`,
      null, { reverses: String(origId), reversal_id: revId ? String(revId) : null }, byAI ? "AI Chat" : "owner");
    return revId;
  };

  // "Void" now posts a persisted reversing entry (was local-only, never durable).
  // Undo soft-deletes the reversal so the original stands alone again.
  const voidInvoiceWithUndo = async (invoice, reason, byAI=false) => {
    if (!invoice) return null;
    const snap = { ...invoice };
    const revId = await reverseJournalEntry(invoice, reason || "Voided", byAI);
    if (!revId) return null;                           // failure already toasted; caller must not claim success
    try { await loadAllData(); } catch {}              // original + reversal both visible, net zero
    showNotification(`Reversed ${snap.vendor || "entry"} — tap Undo to restore`, "success", async () => {
      try {
        await supabase.from("journal_entries")
          .update({ deleted_at: new Date().toISOString(), deleted_by: session?.user?.id || null })
          .eq("id", revId).eq("company_id", currentCompany.id);
        await loadAllData();
      } catch (e) { console.warn("[reverse] undo failed:", e?.message || e); }
      logAudit("entry_reversal_undone", `Undid reversal of ${snap.vendor || "entry"}`, null, { reversal_id: String(revId) });
      showNotification("Restored ✓");
    });
    return revId;   // the committed reversal id — caller gates "✓ voided" on this (O78)
  };

  // Soft-delete one or more contracts with a single Undo toast that restores the batch.
  const softDeleteContracts = async (list, byAI=false) => {
    const items = (list || []).filter(Boolean);
    if (!items.length) return;
    const uid = session?.user?.id || null;
    const snaps = items.map(c => ({ ...c }));
    snaps.forEach(s => logAudit("contract_deleted", `Deleted contract: ${s.counterparty || s.contract_type || "contract"}`, s, null, byAI ? "AI Chat" : "owner"));
    const idset = new Set(snaps.map(s => String(s.id)));
    setContracts(prev => prev.filter(c => !idset.has(String(c.id))));
    let committed = 0, anyError = false;
    if (currentCompany?.id) {
      for (const s of snaps) {
        if (!s.db_id) { committed++; continue; }   // session-only contract (never persisted) — already gone for good
        const { error } = await supabase.from("contracts")
          .update({ deleted_at: new Date().toISOString(), deleted_by: uid })
          .eq("id", s.db_id).eq("company_id", currentCompany.id);
        if (error) { console.error("softDeleteContracts failed:", error.message); anyError = true; }
        else committed++;
      }
    }
    const label = items.length === 1 ? (snaps[0].counterparty || "contract") : `${items.length} contracts`;
    showNotification(`Deleted ${label} — tap Undo to restore`, "success", async () => {
      setContracts(prev => { const have = new Set(prev.map(c => String(c.id))); return [...snaps.filter(s => !have.has(String(s.id))), ...prev]; });
      if (currentCompany?.id) {
        for (const s of snaps) { if (s.db_id) await supabase.from("contracts").update({ deleted_at: null, deleted_by: null }).eq("id", s.db_id).eq("company_id", currentCompany.id); }
      }
      logAudit("contract_restored", `Restored ${items.length} contract${items.length===1?"":"s"}`, null, null);
      showNotification("Restored ✓");
    });
    return { ok: !anyError && committed > 0, committed };   // caller gates "✓ removed" on this (O78)
  };
  const softDeleteContract = (contract, byAI=false) => softDeleteContracts([contract], byAI);

  // ── Chat-action persistence (O78 / O51) ────────────────────────────────────
  // Every AI chat mutation must DURABLY write + be VERIFIED, then re-sync the local
  // read-model from DB truth. These resolve the normalized FKs the tables require, then
  // route through the verified write helpers (src/lib/chatActions.js). On failure they
  // return { ok:false } so the chat reply surfaces it honestly (never a false "✓ done").
  const _norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  // vendor name → contacts.id (vendor_rules.contact_id is NOT NULL). create=true makes one
  // when absent (adding a rule for a not-yet-known vendor); delete paths pass create=false.
  const resolveContactId = async (name, type = "vendor", create = true) => {
    if (!currentCompany?.id || !name) return null;
    try {
      const { data } = await supabase.from("contacts").select("id, name").eq("company_id", currentCompany.id).is("deleted_at", null);
      const hit = (data || []).find(c => _norm(c.name) === _norm(name));
      if (hit) return hit.id;
      if (!create) return null;
      const { data: made, error } = await supabase.from("contacts")
        .insert({ company_id: currentCompany.id, name, type: type || "vendor" }).select("id").single();
      if (error || !made) { console.warn("[resolveContactId] create failed:", error?.message); return null; }
      return made.id;
    } catch (e) { console.warn("[resolveContactId]", e?.message); return null; }
  };
  // gl_code → accounts.id, creating the account if missing (mirrors persistRecode).
  const resolveAccountId = async (glCode, glName) => {
    if (!currentCompany?.id || !glCode) return null;
    const live = getAccountByCode(glCode)?.db_id;
    if (live) return live;
    try {
      const { data: row } = await supabase.from("accounts").select("id").eq("company_id", currentCompany.id).eq("code", glCode).maybeSingle();
      if (row?.id) return row.id;
      const def = CHART_OF_ACCOUNTS.find(a => a.code === glCode);
      const { data: made, error } = await supabase.from("accounts")
        .insert(buildAccountInsert({ companyId: currentCompany.id, code: glCode, name: glName || def?.name || glCode, category: def?.category })).select("id").single();
      if (error || !made) { console.warn("[resolveAccountId] create failed:", error?.message); return null; }
      // O108 finding 4, FIFTH SITE — found by the CI guard, not by reading. This one is
      // reached from the AI action path (add_rule / set_contact_rule), so a model-proposed
      // GL code can mint a permanent account on a client's chart. Loudest of the five, for
      // that reason; behaviour unchanged.
      logAudit("account_materialized", `Created account ${glCode} "${glName || def?.name || glCode}" while resolving a rule target — it was not in this company's chart`, null, { code: glCode, name: glName || def?.name || glCode, in_default_chart: !!def, site: "resolveAccountId" });
      return made.id;
    } catch (e) { console.warn("[resolveAccountId]", e?.message); return null; }
  };

  // add_rule / set_contact_rule (rule part): one active vendor→account rule per contact.
  const persistChatRule = async ({ vendor, gl_code, gl_name, project }) => {
    if (!currentCompany?.id) return { ok: false, error: "no company" };
    const contactId = await resolveContactId(vendor, "vendor", true);
    const accountId = await resolveAccountId(gl_code, gl_name);
    if (!contactId || !accountId) return { ok: false, error: "couldn't resolve vendor or account" };
    // replace any existing active rule for this contact, then insert+verify the new one.
    await deleteVerified(supabase, "vendor_rules", { company_id: currentCompany.id, contact_id: contactId });
    const res = await insertVerified(supabase, "vendor_rules", buildVendorRuleRow({ companyId: currentCompany.id, contactId, accountId, project }));
    if (res.ok) setRules(prev => [...prev.filter(r => _norm(r.vendor) !== _norm(vendor)), { id: res.row.id, vendor, gl_code, gl_name, project: project || null }]);
    return res;
  };
  // delete_rule: scoped delete (O51) of this vendor's rule — verified gone, resynced.
  const deleteChatRule = async (vendor) => {
    if (!currentCompany?.id) return { ok: false, error: "no company" };
    const contactId = await resolveContactId(vendor, "vendor", false);
    if (!contactId) { setRules(prev => prev.filter(r => _norm(r.vendor) !== _norm(vendor))); return { ok: true, deleted: false }; } // no contact → no rule
    const res = await deleteVerified(supabase, "vendor_rules", { company_id: currentCompany.id, contact_id: contactId });
    if (res.ok) setRules(prev => prev.filter(r => _norm(r.vendor) !== _norm(vendor)));
    return res;
  };
  // add_recurring: expense recurring net-to-cash (debit expense / credit cash).
  const persistChatRecurring = async ({ name, vendor, amount, gl_code, gl_name, frequency, next_date, project }) => {
    if (!currentCompany?.id) return { ok: false, error: "no company" };
    const debitAccountId = await resolveAccountId(gl_code, gl_name);
    const creditAccountId = getAccountByRole("cash")?.db_id || await resolveAccountId(rc("cash"), rn("cash"));
    if (!debitAccountId || !creditAccountId) return { ok: false, error: "couldn't resolve accounts" };
    const contactId = vendor ? await resolveContactId(vendor, "vendor", true) : null;
    const res = await insertVerified(supabase, "recurring_transactions", buildRecurringRow({
      companyId: currentCompany.id, name, contactId, amount, debitAccountId, creditAccountId,
      frequency, nextDate: next_date || todayLocal(), project,
    }));
    if (res.ok) setRecurring(prev => [{ id: res.row.id, name, vendor: vendor || "", amount: parseFloat(amount) || 0, gl_code, gl_name, frequency: res.row.frequency, next_date: res.row.next_date, last_run: null, active: true, created_at: res.row.created_at }, ...prev]);
    return res;
  };
  // pause_recurring: flip active=false on the persisted row, verified.
  const pauseChatRecurring = async (name) => {
    const target = (recurring || []).find(r => _norm(r.name) === _norm(name));
    if (!target) return { ok: false, error: "no matching recurring" };
    if (target.id == null || typeof target.id === "number") return { ok: false, error: "recurring isn't saved yet" };
    const res = await updateVerified(supabase, "recurring_transactions", target.id, { active: false });
    if (res.ok) setRecurring(prev => prev.map(r => r.id === target.id ? { ...r, active: false } : r));
    return res;
  };
  // retag_project: project lives on journal_entry_lines.project (per line), so update every
  // line of the target entries, then VERIFY the read-back. (flatten now reads project back so
  // a refresh shows the tag — src/lib/ledger.js.)
  const persistChatRetagProject = async (invoiceIds, project) => {
    if (!currentCompany?.id) return { ok: false, error: "no company" };
    const dbIds = [...new Set(invoices.filter(i => invoiceIds.includes(i.id)).map(i => i.db_entry_id).filter(Boolean))];
    if (!dbIds.length) return { ok: false, error: "entries aren't saved yet" };
    const { error } = await supabase.from("journal_entry_lines").update({ project }).in("journal_entry_id", dbIds).eq("company_id", currentCompany.id);
    if (error) return { ok: false, error: error.message };
    const { data: chk } = await supabase.from("journal_entry_lines").select("journal_entry_id, project").in("journal_entry_id", dbIds).eq("company_id", currentCompany.id);
    if (!Array.isArray(chk) || !chk.length || !chk.every(r => r.project === project)) return { ok: false, error: "project did not persist on the entry lines" };
    setInvoices(prev => prev.map(inv => invoiceIds.includes(inv.id) ? { ...inv, project } : inv));
    if (!allProjects.includes(project)) setCustomProjects(p => [...p, project]);
    return { ok: true };
  };
  // add_contact / update_contact / set_contact_rule (contact part): write + verify a contact.
  const persistChatContact = async ({ name, contact_type, email, phone, payment_terms, notes, tags, min_expected, max_expected, gl_code, gl_name }, updates) => {
    if (!currentCompany?.id || !name) return { ok: false, error: "missing company/name" };
    try {
      const { data: list } = await supabase.from("contacts").select("*").eq("company_id", currentCompany.id);
      const existing = (list || []).find(c => _norm(c.name) === _norm(name));
      const ALLOWED = ["email", "phone", "payment_terms", "notes", "tags", "type", "expected_min", "expected_max"];
      const payload = updates
        ? Object.fromEntries(Object.entries(updates).filter(([k]) => ALLOWED.includes(k)))
        : { company_id: currentCompany.id, name, type: contact_type || "vendor", email: email || null, phone: phone || null, payment_terms: payment_terms || null, notes: notes || null, tags: tags || [], expected_min: min_expected || null, expected_max: max_expected || null };
      if (updates && !Object.keys(payload).length) return { ok: false, error: "no recognized fields to update" };
      let row, error;
      if (existing) ({ data: row, error } = await supabase.from("contacts").update(payload).eq("id", existing.id).select().single());
      else ({ data: row, error } = await supabase.from("contacts").insert(payload).select().single());
      if (error || !row?.id) return { ok: false, error: error?.message || "no row returned" };
      const { data: confirmed } = await supabase.from("contacts").select("*").eq("id", row.id).maybeSingle();
      if (!confirmed) return { ok: false, error: "contact missing after write" };
      setContacts(prev => {
        const i = prev.findIndex(c => _norm(c.name) === _norm(name));
        const merged = { ...(i >= 0 ? prev[i] : {}), ...confirmed, id: confirmed.id, db_id: confirmed.id, fromContact: true, min_expected: confirmed.expected_min, max_expected: confirmed.expected_max };
        if (i >= 0) { const u = [...prev]; u[i] = merged; return u; }
        return [merged, ...prev];
      });
      // optional GL rule (add_contact / set_contact_rule with a gl_code)
      if (gl_code) { await persistChatRule({ vendor: name, gl_code, gl_name, project: null }); }
      return { ok: true, row: confirmed };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  };

  const persistContact = async (contact) => {
    if (!currentCompany?.id) return;
    try {
      const base = {
        company_id: currentCompany.id, name: contact.name,
        type: contact.type||"vendor", email: contact.email||null,
        phone: contact.phone||null, payment_terms: contact.payment_terms||null,
        is_1099: contact.is1099||false, ein: contact.ein||null,
        expected_min: contact.min_expected||null, expected_max: contact.max_expected||null,
        notes: contact.notes||null, tags: contact.tags||[]
      };
      // Extra fields need migrations 004 + 007 — include them but fall back
      // (drop them) if the columns don't exist yet, so contact saving never breaks.
      const extra = {
        website: contact.website||null, payment_url: contact.payment_url||null,
        business_type: contact.business_type||null, ein_ssn: contact.ein_ssn||null,
        mailing_address: contact.mailing_address||null,
        is_1099_exempt: contact.is_1099_exempt ?? false, sent_1099_2025: contact.sent_1099_2025 ?? false,
        vendor_account_number: contact.vendor_account_number||null, tax_id: contact.tax_id||null,
      };
      const normKey = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const run = async (payload) => {
        if (contact.db_id) return await supabase.from("contacts").update(payload).eq("id", contact.db_id).select().single();
        // New contact: upsert on the (company_id, name_key) unique index (migration 012)
        // so two concurrent uploads of the same vendor can't both insert.
        // ignoreDuplicates → ON CONFLICT DO NOTHING (never overwrites an existing row).
        let res = await supabase.from("contacts")
          .upsert(payload, { onConflict: "company_id,name_key", ignoreDuplicates: true })
          .select().maybeSingle();
        if (res.error && /name_key|on conflict|unique or exclusion/i.test(res.error.message || "")) {
          // Migration 012 not applied — fall back to a plain insert.
          return await supabase.from("contacts").insert(payload).select().single();
        }
        if (res.error || res.data) return res;
        // Conflict (row already existed) returned no row — fetch it to recover its id.
        return await supabase.from("contacts").select("*")
          .eq("company_id", currentCompany.id).eq("name_key", normKey(payload.name)).maybeSingle();
      };
      let { data, error } = await run({ ...base, ...extra });
      if (error && /website|payment_url|business_type|ein_ssn|mailing_address|is_1099_exempt|sent_1099|vendor_account_number|tax_id|column/i.test(error.message||"")) {
        console.warn("contacts missing extra columns; saving core fields only. Apply migrations 004 + 007.");
        ({ data, error } = await run(base));
      }
      if (error) {
        // Surface the real reason (RLS, NOT NULL, etc.) instead of failing silently.
        console.error(`[contacts] persist FAILED for "${contact.name}" (company_id=${currentCompany.id}):`, error.message || error, error.details || "", error.hint || "");
      }
      if (!contact.db_id && data) setContacts(prev => prev.map(c => c.id===contact.id ? {...c, db_id: data.id} : c));
    } catch(e) { console.error("persistContact error:", e); }
  };

  // Auto-create or enrich a vendor/customer contact from an uploaded invoice's extracted details.
  const recentContactsRef = useRef(new Set());
  const createOrUpdateContact = (data) => {
    
    if (!data || !(data.name||"").trim()) { console.warn("[contacts] skipped — no vendor name in extracted data"); return; }
    const name = data.name.trim();
    const norm = s => (s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
    const n = norm(name); if (!n) return;
    const fields = {
      email: data.email||"", phone: data.phone||"", website: data.website||"",
      payment_terms: data.payment_terms||"", mailing_address: data.address||"",
      vendor_account_number: data.account_number||"", tax_id: data.tax_id||"",
      gl_code: data.gl_code||"", gl_name: data.gl_name||"",
    };
    const existing = (contacts||[]).find(c => { const cn=norm(c.name); return cn && (cn===n || cn.includes(n) || n.includes(cn)); });
    if (existing) {
      // Update empty fields only — never overwrite existing data.
      const merged = { ...existing }; let changed = false;
      Object.entries(fields).forEach(([k,v]) => { if (v && !merged[k]) { merged[k] = v; changed = true; } });
      
      if (!changed) return;
      setContacts(prev => prev.map(c => c.id===existing.id ? merged : c));
      persistContact(merged);
      logAudit("contact_updated", `Contact ${name} updated from invoice`, null, { name });
    } else {
      if (recentContactsRef.current.has(n)) {  return; }
      recentContactsRef.current.add(n);
      
      const created = { id: Date.now()+Math.random(), name, type: data.type||"vendor", ...fields, fromContact: true, created_at: new Date().toISOString() };
      setContacts(prev => [created, ...prev]);
      persistContact(created);
      logAudit("contact_created", `Contact ${name} auto-created from invoice upload`, null, { name });
      showNotification(`Added ${name} to your contacts`);
    }
  };

  // ── SMART GAAP CLASSIFICATION ──────────────────────────────────────────────
  // Detects expenses that need a clarifying question before they can be booked
  // correctly under GAAP, and books the answer (incl. prepaid amortization).
  const fmtMoney = fmtSignedMoney;
  // Resolve a GL name from the company's actual chart of accounts (falls back to a label).
  const glName = (code, fallback="") => (CHART_OF_ACCOUNTS.find(a=>a.code===code)?.name) || fallback;
  // Tight, specific asset keywords — the capital check requires BOTH amount >= $2,000 AND
  // one of these. A dollar amount alone never triggers it (e.g. a $3,000 Stripe payout).
  const GAAP_ASSET_RE = /\b(laptop|computer|macbook|imac|ipad|iphone|tablet|monitor|printer|server|camera|equipment|machinery|furniture|desk|chair|vehicle|truck|forklift|appliance)\b|\bcar\b|software license|perpetual license/i;
  const GAAP_PREPAID_RE = /\b(annual|yearly|12[\s-]?months?|retainer)\b|insurance|maintenance contract|service agreement/i;
  const GAAP_LEASEHOLD_RE = /renovation|build[\s-]?out|leasehold|improvement|installation|flooring|remodel|contractor|construction|electrical work|plumbing/i;
  const GAAP_VEHICLE_RE = /\b(gas|fuel|mileage|auto|gasoline)\b/i;
  const GAAP_MEALS_RE = /\b(restaurant|meal|meals|dining|cafe|café|coffee|catering|lunch|dinner|bar|grill)\b|grubhub|doordash|uber eats|seamless/i;
  // Revenue received before the service is delivered → deferred revenue (#11). Conservative
  // signals only, so normal sales don't get asked.
  const GAAP_DEFERRED_REV_RE = /\b(deposit|retainer|advance|prepaid|prepayment|up[\s-]?front|paid in advance)\b/i;

  const buildGaapClarification = (invoice) => {
    // Revenue-side GAAP review (#11): a receipt that's an advance/deposit is deferred
    // revenue (a liability), not earned revenue. Ask only on clear advance signals.
    if (invoice.type === "revenue") {
      const rtext = `${invoice.description||""} ${invoice.vendor||""} ${invoice.notes||""}`.toLowerCase();
      if (GAAP_DEFERRED_REV_RE.test(rtext)) {
        return { gaap: true, invoice, gaapType: "deferred_revenue",
          question: `Is this payment for work you've already delivered, or paid in advance?`,
          explanation: `When a customer pays before you've done the work, that money isn't income yet — it becomes income as you deliver. If this was paid ahead, we'll count it as you earn it.`,
          options: [
            { label: "I've already done the work — count it as income now", bookAsIs: true,
              reasoning: `Recognized as revenue now — the performance obligation was already satisfied.` },
            { label: "They paid ahead of the work — count it as I deliver", deferredRevenueReceipt: true,
              reasoning: `Recorded as Deferred Revenue (2300): cash received before the service is delivered; recognize as revenue when earned.` },
          ] };
      }
      return null;
    }
    const amt = Number(invoice.amount) || 0;
    const text = `${invoice.description||""} ${invoice.vendor||""} ${invoice.notes||""}`.toLowerCase();
    const base = { gaap: true, invoice, suggestedCode: invoice.gl_code, suggestedName: invoice.gl_name };

    // A) Capital vs expense (ASC 360 materiality threshold)
    if (amt >= CAPITALIZE_CHECK_THRESHOLD && GAAP_ASSET_RE.test(text)) {
      const capitalize = amt >= CAPITALIZE_THRESHOLD;
      return { ...base, gaapType:"capital",
        question:`This looks like a larger purchase — how will you use it?`,
        explanation:`Bigger equipment you'll use for years gets spread across those years instead of counting all at once — that keeps your monthly profit accurate and matters for your taxes. So we just need to know how you'll use it and for how long.`,
        options:[
          { label: capitalize ? "Business use, and I'll use it more than a year" : "Business use, more than a year",
            gl_code: capitalize?rc("fixed_assets"):rc("office_supplies"), gl_name: capitalize?rn("fixed_assets"):rn("office_supplies"), depreciate: capitalize,
            usefulLifeMonths: capitalize ? suggestUsefulLifeMonths(text) : undefined,
            reasoning: capitalize
              ? `Capitalized as fixed asset per ASC 360 — user confirmed business use >1 year, amount ${fmtMoney(amt)} exceeds $2,500 threshold. Flagged for depreciation.`
              : `Expensed to de minimis equipment — business use but amount ${fmtMoney(amt)} is under the $2,500 capitalization threshold (de minimis safe harbor).` },
          { label:"It's a subscription, or I'll use it under a year", gl_code:rc("technology_software"), gl_name:rn("technology_software"),
            reasoning:`Expensed to Technology — subscription or useful life under one year, so ASC 360 capitalization does not apply.` },
          { label:"Mostly personal use", gl_code:rc("office_supplies"), gl_name:rn("office_supplies"), nondeductible:true,
            reasoning:`Booked but flagged as primarily personal use — not deductible as a business expense.` },
        ] };
    }

    // B) Prepaid expenses (matching principle, ASC 340)
    if (GAAP_PREPAID_RE.test(text)) {
      return { ...base, gaapType:"prepaid",
        question:`How many months does this cover? If it's more than a few, we'll spread it out so your monthly profit stays accurate.`,
        explanation:`When you pay for several months up front, we spread the cost evenly across those months so a single month doesn't look artificially expensive.`,
        options:[
          { label:"3 months or less — just count it now", gl_code: invoice.gl_code, gl_name: invoice.gl_name,
            reasoning:`Expensed immediately — coverage is 3 months or less, so prepaid treatment isn't needed.` },
          { label:"6 months", prepaidMonths:6, reasoning:`Recorded as Prepaid Expenses (1300) and amortized evenly over 6 months from ${invoice.date} to ${invoice.gl_name}.` },
          { label:"12 months (annual)", prepaidMonths:12, reasoning:`Recorded as Prepaid Expenses (1300) and amortized evenly over 12 months from ${invoice.date} to ${invoice.gl_name}.` },
        ] };
    }

    // C) Leasehold improvements
    if (amt >= 1000 && GAAP_LEASEHOLD_RE.test(text)) {
      return { ...base, gaapType:"leasehold",
        question:`Is this a permanent improvement, and to a space you lease or own?`,
        explanation:`Permanent upgrades to your space get spread over the years you'll benefit from them; routine repairs just count right away. Is this a lasting improvement, and is the space rented or owned?`,
        options:[
          { label:"Permanent improvement to a space I LEASE", gl_code:rc("intangible_assets"), gl_name:rn("intangible_assets"), depreciate:false,
            reasoning:`Capitalized as a leasehold improvement (1600) per GAAP — permanent improvement to leased space, amortize over the remaining lease term.` },
          { label:"Permanent improvement to a space I OWN", gl_code:rc("fixed_assets"), gl_name:rn("fixed_assets"), depreciate:true,
            reasoning:`Capitalized to Fixed Assets (1500) — permanent improvement to owned property, depreciate over its useful life.` },
          { label:"It's a repair / maintenance", gl_code:rc("repairs_maintenance"), gl_name:rn("repairs_maintenance"),
            reasoning:`Expensed as repairs & maintenance (6250) — routine upkeep, not a capital improvement.` },
        ] };
    }

    // D) Vehicle operating costs (business-use percentage)
    if (GAAP_VEHICLE_RE.test(text)) {
      const mk = pct => ({ label: pct===100?"100% business use":`Mixed — about ${pct}% business`, vehiclePct:pct, gl_code: invoice.gl_code, gl_name: invoice.gl_name,
        reasoning: pct===100 ? `Fully deductible — user confirmed 100% business use.`
          : `Business use ${pct}% — deductible portion ${fmtMoney(amt*pct/100)} of ${fmtMoney(amt)}; remainder is personal and not deductible.` });
      return { ...base, gaapType:"vehicle",
        question:`Is this vehicle used only for business, or mixed personal/business?`,
        explanation:`Only the business-use portion of vehicle costs is deductible. Roughly how much of this vehicle's use is for business?`,
        options:[ mk(100), mk(75), mk(50) ] };
    }

    return null;
  };

  // Books a prepaid invoice through the deterministic builders + canonical multi-line
  // path: capitalize (Dr Prepaid 1300 / Cr A/P) then post the full straight-line
  // amortization schedule (Dr expense / Cr Prepaid, monthly, last month absorbs
  // rounding so Σ === the capitalized amount). Was inline + via bookToDb with a
  // round(amt/months) per-month that left a few cents stranded in 1300.
  const bookPrepaid = async (inv, months, opt = {}) => {
    const amt = Number(inv.amount) || 0;
    const prepaidCode = rc("prepaid_expenses"), prepaidName = rn("prepaid_expenses");
    const startDate = inv.date || todayLocal();

    const capEntry = buildPrepaidCapitalizeEntry({
      amount: amt, prepaidCode, offsetCode: rc("accounts_payable"),
      date: startDate, vendor: inv.vendor,
      description: `Prepaid – ${inv.vendor || inv.gl_name || "expense"}`,
      meta: { kind: "prepaid_capitalize", prepaid_months: months },
    });
    if (!capEntry || !capEntry.balanced) { showNotification("Couldn't record the prepaid asset.", "error"); return; }
    const capId = await persistMultiLineEntry(capEntry);   // cutoff-guarded
    if (!capId) return;                                    // failure already surfaced
    try { relinkDocsForInvoice(inv.id, capId); } catch {}  // keep the source doc linked
    if (inv._contact) createOrUpdateContact({ ...inv._contact, gl_code: prepaidCode, gl_name: prepaidName });

    const sched = buildPrepaidSchedule({
      total: amt, months, startDate, expenseCode: inv.gl_code, prepaidCode,
      label: inv.description || inv.gl_name || "Prepaid",
    });
    for (const je of sched.entries) { await persistMultiLineEntry(je); }

    logAudit("invoice_booked", `${inv.vendor} · ${fmtMoney(amt)} recorded as prepaid (1300), amortizing over ${months} months`, null, { vendor: inv.vendor, amount: amt, gl_code: prepaidCode, months });
    try { await loadAllData(); } catch {}
    showNotification(`Recorded as prepaid — spread over ${months} months ✓`);
  };

  // Applies the user's answer to a GAAP clarification card and books the entry.
  // #11 deferred-revenue receipt: cash received in advance → Dr Cash / Cr Deferred
  // Revenue (a liability), via the canonical multi-line path. Recognition to revenue
  // happens later when the obligation is satisfied.
  const bookDeferredRevenueReceipt = async (inv, opt = {}) => {
    const amount = Number(inv.amount) || 0;
    const je = buildDeferredRevenueReceiptEntry({
      amount, cashCode: rc("cash"), deferredRevCode: rc("deferred_revenue"),
      date: inv.date, vendor: inv.vendor,
      description: `Advance payment – ${inv.vendor || "customer"}`,
    });
    if (!je || !je.balanced) { showNotification("Couldn't book the advance payment.", "error"); return; }
    const jeId = await persistMultiLineEntry(je);   // also enforces the cutoff guard
    if (!jeId) return;                               // failure already surfaced
    if (inv._contact) createOrUpdateContact({ ...inv._contact, type: "customer" });
    logAudit("deferred_revenue_received", `Advance payment from ${inv.vendor || "customer"} ${fmtMoney(amount)} → Deferred Revenue (2300)`, null, { vendor: inv.vendor, amount });
    try { await loadAllData(); } catch {}
    showNotification("Booked as deferred revenue (advance payment) ✓");
  };

  const applyGaapAnswer = async (item, opt) => {
    const inv = item.invoice;
    setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
    if (opt.prepaidMonths) { await bookPrepaid(inv, opt.prepaidMonths, opt); return; }
    if (opt.deferredRevenueReceipt) { await bookDeferredRevenueReceipt(inv, opt); return; }
    if (opt.bookAsIs) {
      // Revenue earned now — book the receipt in its normal shape (Dr Cash/AR / Cr Revenue),
      // preserving the invoice's own coding rather than the expense-shaped path below.
      const ri = { ...inv, confidence: 100, status: "booked", booked_at: new Date().toISOString(),
        source: "gaap_classification", reasoning: opt.reasoning || inv.reasoning };
      setInvoices(prev => [ri, ...prev]);
      bookToDb(ri);
      if (ri._contact) createOrUpdateContact({ ...ri._contact, type: "customer", gl_code: ri.gl_code, gl_name: ri.gl_name });
      logAudit("invoice_booked", `${ri.vendor} · ${fmtMoney(ri.amount)} → ${ri.gl_name} (revenue recognized now)`, null, { vendor: ri.vendor, amount: ri.amount, gl_code: ri.gl_code });
      showNotification(`Booked to ${ri.gl_name} ✓`);
      return;
    }
    // Capitalize → book Dr Fixed Asset / Cr AP, then create the real fixed_assets
    // record + straight-line depreciation schedule (replaces the dead
    // `needs_depreciation` flag, which never produced any depreciation entry).
    const finalInv = { ...inv,
      gl_code: opt.gl_code || inv.gl_code, gl_name: opt.gl_name || inv.gl_name,
      secondary_gl_code:rc("accounts_payable"), secondary_gl_name:rn("accounts_payable"), debit_credit:"debit",
      confidence:100, status:"booked", booked_at:new Date().toISOString(), source:"gaap_classification",
      reasoning: opt.reasoning || inv.reasoning,
      nondeductible: opt.nondeductible ? true : undefined,
      business_use_pct: opt.vehiclePct || undefined,
      deductible_amount: opt.vehiclePct ? (Number(inv.amount)||0)*opt.vehiclePct/100 : undefined };
    setInvoices(prev => [finalInv, ...prev]);
    const jeId = await bookToDb(finalInv);
    if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
    logAudit("invoice_booked", `${finalInv.vendor} · ${fmtMoney(finalInv.amount)} → ${finalInv.gl_name} (GAAP ${item.gaapType})`, null, { vendor:finalInv.vendor, amount:finalInv.amount, gl_code:finalInv.gl_code, gl_name:finalInv.gl_name, reasoning: finalInv.reasoning });
    if (opt.depreciate) {
      // A capitalized asset with no depreciation schedule must be impossible. If the
      // booking didn't post, or the asset/schedule write fails, COMPENSATE (reverse the
      // capitalization JE) so we never leave a Dr Fixed Asset / Cr AP with no schedule —
      // same discipline as the payment-posting compensation. Never report success.
      if (!jeId) {
        showNotification("Couldn't book the capitalization — nothing was posted. Please try again.", "error");
        return;
      }
      const res = await createFixedAssetWithSchedule({
        invoice: finalInv, sourceJournalEntryId: jeId,
        usefulLifeMonths: opt.usefulLifeMonths || suggestUsefulLifeMonths(`${finalInv.description||""} ${finalInv.vendor||""}`),
        salvageValue: Number(opt.salvageValue) || 0,
        inServiceDate: opt.inServiceDate || finalInv.date,
      });
      if (!res.ok) { await compensateCapitalization(jeId, finalInv, res.error); return; }
      showNotification(`Capitalized & depreciation scheduled ✓`);
    } else {
      showNotification(`Booked to ${finalInv.gl_name} ✓`);
    }
  };

  // Reverse a just-posted capitalization JE when the asset/schedule couldn't be
  // created, so the books never hold a capitalized asset with no depreciation set up.
  // Best-effort with loud telemetry if the reversal itself fails (mirrors markBillPaid).
  const compensateCapitalization = async (jeId, finalInv, reason) => {
    try {
      await supabase.from("journal_entries")
        .update({ deleted_at: new Date().toISOString(), deleted_by: session?.user?.id || null })
        .eq("id", jeId).eq("company_id", currentCompany.id);
    } catch (e) { console.error("[compensateCapitalization] reverse failed:", e?.message || e); }
    setInvoices(prev => prev.filter(i => i.id !== finalInv.id && String(i.db_entry_id) !== String(jeId)));
    logAudit("fixed_asset_setup_failed",
      `Capitalization rolled back — couldn't create the asset/schedule for ${finalInv.vendor || ""} ${fmtMoney(finalInv.amount)}: ${reason || "unknown"}`,
      null, { je_id: String(jeId), reason: reason || null });
    try { Sentry.captureMessage("fixed_asset_setup_failure", { level: "error",
      tags: { kind: "fixed_asset_setup_failure" }, extra: { je_id: String(jeId), reason: reason || null } }); } catch {}
    showNotification(`Couldn't set up depreciation — the capitalization was rolled back so your books stay consistent.${reason ? ` (${reason})` : ""} Please try again.`, "error");
  };

  // Create the fixed_assets master + generate its straight-line depreciation_schedule
  // (pending rows). ATOMIC: builds the schedule first (so we never create an asset we
  // can't schedule), and if the schedule insert fails it deletes the asset row it just
  // created. Returns { ok, assetId?, error? } — NEVER throws a false success; the caller
  // compensates the capitalization JE when ok is false. Posting happens later via the
  // silent auto-post effect (autoPostDepreciation). Also the reusable path for back-filling an existing JE
  // (pass sourceJournalEntryId; this posts NO capitalization entry of its own).
  const createFixedAssetWithSchedule = async ({ invoice, sourceJournalEntryId, usefulLifeMonths, salvageValue = 0, inServiceDate }) => {
    if (!currentCompany?.id) return { ok: false, error: "no active company" };
    const cost = Number(invoice.amount) || 0;
    const depExpCode = rc("depreciation_amortization") || "6900";
    const accumCode = rc("accumulated_depreciation") || "1510";
    const inService = inServiceDate || invoice.date || todayLocal();
    const lifeMonths = Math.max(1, Math.round(Number(usefulLifeMonths) || 60));
    const salvage = Math.max(0, Number(salvageValue) || 0);

    // Build the schedule FIRST (pure). A non-empty schedule is a precondition for the
    // asset — an asset we can't schedule must never be created.
    const sched = buildDepreciationSchedule({
      cost, salvage, lifeMonths, inServiceDate: inService,
      depExpCode, accumDepCode: accumCode,
      assetLabel: invoice.vendor || invoice.description || "asset", assetId: "pending",
    });
    if (!sched.entries.length) return { ok: false, error: "empty depreciation schedule (check cost / useful life)" };

    let assetId = null;
    try {
      const { data: asset, error } = await supabase.from("fixed_assets").insert({
        company_id: currentCompany.id,
        description: invoice.description || invoice.vendor || "Fixed asset",
        vendor: invoice.vendor || null, cost, salvage_value: salvage,
        useful_life_months: lifeMonths, in_service_date: inService, method: "straight_line",
        asset_account_code: invoice.gl_code || rc("fixed_assets"),
        dep_expense_code: depExpCode, accum_dep_code: accumCode,
        source_journal_entry_id: sourceJournalEntryId || null, status: "active",
        created_by: session?.user?.id || null,
      }).select("id").single();
      if (error || !asset) { console.error("fixed_assets insert:", error?.message); return { ok: false, error: error?.message || "fixed_assets insert failed (is migration 041 applied?)" }; }
      assetId = asset.id;

      const rows = sched.entries.map((je, i) => ({
        company_id: currentCompany.id, asset_id: assetId,
        period_index: i + 1, period_date: je.date, amount: je.lines[0].debit, status: "pending",
      }));
      const { error: schedErr } = await supabase.from("depreciation_schedule").insert(rows);
      if (schedErr) {
        // Compensate inside the function: remove the asset row so we never leave an
        // asset with no schedule.
        console.error("depreciation_schedule insert:", schedErr.message);
        try { await supabase.from("fixed_assets").delete().eq("id", assetId).eq("company_id", currentCompany.id); } catch (e) { console.error("[createFixedAssetWithSchedule] asset cleanup failed:", e?.message || e); }
        return { ok: false, error: schedErr.message || "depreciation_schedule insert failed" };
      }
      logAudit("fixed_asset_created",
        `Capitalized ${invoice.vendor || ""} ${fmtMoney(cost)} — ${lifeMonths}mo straight-line${salvage ? `, salvage ${fmtMoney(salvage)}` : ""}`,
        null, { asset_id: assetId, cost, life_months: lifeMonths, salvage, in_service: inService });
      return { ok: true, assetId };
    } catch (e) {
      console.error("createFixedAssetWithSchedule error:", e);
      if (assetId) { try { await supabase.from("fixed_assets").delete().eq("id", assetId).eq("company_id", currentCompany.id); } catch {} }
      return { ok: false, error: e?.message || String(e) };
    }
  };

  // "Run depreciation through DATE": post every PENDING schedule row due on/before the
  // date as Dr Depreciation Expense / Cr Accumulated Depreciation (canonical multi-line
  // path), stamp it posted, and auto-flip an asset to fully_depreciated once its last
  // pending row posts. Idempotent (only pending rows). Returns { posted }.
  // O10 — lightweight "depreciation is due" signal for the dashboard nudge. Counts
  // pending schedule rows dated on/before today (never auto-posts). Refreshed on load
  // and after a run. Degrades to zero if the table doesn't exist yet (pre-migration 041).
  const [depreciationDueInfo, setDepreciationDueInfo] = useState({ count: 0, throughDate: "", assets: 0 });
  const loadDepreciationDue = async () => {
    if (!currentCompany?.id) { setDepreciationDueInfo({ count: 0, throughDate: "", assets: 0 }); return; }
    try {
      const today = todayLocal();
      const { data, error } = await supabase.from("depreciation_schedule")
        .select("asset_id, period_date, status").eq("company_id", currentCompany.id).eq("status", "pending");
      if (error) throw error;
      setDepreciationDueInfo(depreciationDue(data || [], today));
    } catch { setDepreciationDueInfo({ count: 0, throughDate: "", assets: 0 }); }
  };

  // AUTO-POST due depreciation — depreciation is deterministic, so there's no decision to nudge
  // a human about: due periods post themselves silently on company open. Idempotency is
  // GL-DERIVED (a live depreciation JE for asset+period), not the schedule flag, so it can never
  // double-post. Incomplete/ambiguous rows are NOT guessed — they're flagged to review. Runs
  // once per company session (autoDepRunRef guard) so re-renders don't re-trigger.
  const autoDepRunRef = useRef(null);
  const autoPostDepreciation = async () => {
    if (!currentCompany?.id) return { posted: 0, flagged: 0 };
    let rows;
    try {
      const { data, error } = await supabase.from("depreciation_schedule")
        .select("id, asset_id, period_index, period_date, amount, status, fixed_assets!inner(vendor, description, dep_expense_code, accum_dep_code, useful_life_months)")
        .eq("company_id", currentCompany.id).eq("status", "pending");   // status is a fast prefilter; the GL is the real guard
      if (error) throw error;
      rows = data || [];
    } catch (e) { console.warn("[depreciation] auto-post load skipped:", e?.message || e); return { posted: 0, flagged: 0 }; }
    if (!rows.length) return { posted: 0, flagged: 0 };

    const ledger = invoicesRef.current || invoices;
    const today = todayLocal();
    const { post, incomplete, assetsToFlip } = planDepreciationAutoPost(rows, ledger, today);

    let posted = 0;
    for (const row of post) {
      const a = row.fixed_assets || {};
      const je = buildDepreciationEntry({
        amount: row.amount, depExpCode: a.dep_expense_code || rc("depreciation_amortization") || "6900", accumDepCode: a.accum_dep_code || "1510",
        date: row.period_date, description: `Depreciation — ${a.vendor || a.description || "asset"} (${row.period_index}/${a.useful_life_months || "?"})`,
        meta: { kind: "depreciation", asset_id: row.asset_id, period: row.period_index },
      });
      if (!je) { incomplete.push(row); continue; }   // couldn't build → treat as incomplete, don't guess
      const jeId = await persistMultiLineEntry(je);
      if (!jeId) continue;
      // C198·3c (i, blast radius) — the SAME follow-up stamp the payroll path needs, for the
      // same reason. `depreciationAlreadyPosted` derives idempotency from a LIVE JE carrying
      // import_metadata {kind:'depreciation', asset_id, period} — and post_journal_entry drops
      // every p_meta key it has no column for, so that guard has ALWAYS returned false and the
      // `status='pending'` prefilter above has been the only thing preventing a double-post.
      // The comment there ("the GL is the real guard") described an intention, not the code.
      // Restoring it matters because the flag write on the next line is precisely the failure
      // it was meant to survive: the GL entry commits, the flag write doesn't, the row stays
      // pending, and the next session posts the same asset-period again.
      const depStamp = await checkedRowUpdate({ supabase, table: "journal_entries", id: jeId, companyId: currentCompany.id,
        patch: { import_metadata: { kind: "depreciation", asset_id: row.asset_id, period: row.period_index } },
        label: "depreciation:stamp-import-metadata" });
      if (!depStamp.ok) logAudit("depreciation_stamp_failed", `Depreciation posted, but its duplicate guard wasn't recorded (${depStamp.reason}) — the schedule flag is now the only thing stopping a repeat`, null, { journal_entry_id: String(jeId), asset_id: String(row.asset_id), period: row.period_index, reason: depStamp.reason });
      // C198·3c (D3) — CHECKED, per §9. This was a row-targeted `.update()` with no
      // `.select()` inside a `catch` — the exact anti-pattern the standing rule names,
      // and the one that matters most here: PostgREST reports NO ERROR for an update
      // that matched nothing, so a zero-row flag write never even reached that catch.
      // The row then stays 'pending' while its GL entry is committed, and the next
      // session re-posts the same asset-period. The stamp above is the backstop for
      // that; this makes the failure visible instead of leaving the backstop to
      // absorb something nobody knew had happened.
      const flagRes = await checkedRowUpdate({ supabase, table: "depreciation_schedule", id: row.id, companyId: currentCompany.id,
        patch: { status: "posted", journal_entry_id: jeId, posted_at: new Date().toISOString() }, label: "depreciation:schedule-flag" });
      if (!flagRes.ok) logAudit("depreciation_flag_write_failed", `Depreciation posted correctly, but its schedule row still reads "pending" (${flagRes.reason}) — the GL entry is the record; the duplicate guard will stop a repeat`, null, { schedule_row_id: String(row.id), journal_entry_id: String(jeId), asset_id: String(row.asset_id), period: row.period_index, reason: flagRes.reason });
      posted++;
    }
    for (const assetId of assetsToFlip) {
      try { await supabase.from("fixed_assets").update({ status: "fully_depreciated" }).eq("id", assetId).eq("company_id", currentCompany.id); }
      catch (e) { console.warn("fully_depreciated flip failed:", e?.message || e); }
    }
    if (incomplete.length) {
      // Don't auto-post something wrong — surface it to the CPA review side (O49/O50).
      logAudit("depreciation_incomplete", `${incomplete.length} due depreciation row(s) are incomplete/ambiguous — NOT auto-posted; needs review`);
      try { createNotification?.({ type: "needs_review", title: `${incomplete.length} depreciation ${incomplete.length === 1 ? "entry" : "entries"} need a look`, description: "A scheduled depreciation is due but its schedule is incomplete — review the asset before it posts.", link_view: "review" }); } catch {}
    }
    if (posted > 0) {
      logAudit("depreciation_autoposted", `Auto-posted ${posted} due depreciation ${posted === 1 ? "entry" : "entries"}${assetsToFlip.length ? ` · ${assetsToFlip.length} asset(s) fully depreciated` : ""}`);
      try { await loadAllData(); } catch {}
    }
    return { posted, flagged: incomplete.length };
  };

  // AUTO-POST due depreciation once the ledger has loaded (so the GL-truth idempotency guard can
  // see existing entries). Declared HERE — after companyDataLoaded / autoDepRunRef /
  // autoPostDepreciation — so the deps array can't hit a temporal dead zone at render time (the
  // P0 crash when this effect sat above those declarations). Once per company (the ref guard).
  useEffect(() => {
    if (!companyDataLoaded || !currentCompany?.id) return;
    if (autoDepRunRef.current === currentCompany.id) return;
    autoDepRunRef.current = currentCompany.id;
    autoPostDepreciation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyDataLoaded, currentCompany?.id]);

  // Attach depreciation to an ALREADY-capitalized asset whose Dr Fixed Asset / Cr AP
  // entry already exists — for back-filling assets capitalized before a schedule was
  // created (e.g. the 041-not-yet-applied case), and the path every real-client
  // migration will use. Posts NO new capitalization JE (reuses the existing one via
  // source_journal_entry_id); derives cost from the JE's debit to the asset account;
  // routes through the SAME tested createFixedAssetWithSchedule. Idempotent (skips if a
  // fixed_assets row already links the JE). Returns { ok, assetId?, skipped?, error? }.
  const attachDepreciationToExistingAsset = async ({ journalEntryId, usefulLifeMonths = 60, salvageValue = 0, inServiceDate = null, assetCode = null }) => {
    if (!currentCompany?.id) return { ok: false, error: "no active company" };
    if (!(isOwner || isAdmin)) return { ok: false, error: "only an owner/admin can attach depreciation" };
    const jeId = String(journalEntryId || "").trim();
    if (!jeId) return { ok: false, error: "missing journal entry id" };
    try {
      // Idempotent: skip if an asset already links to this JE.
      const { data: existing } = await supabase.from("fixed_assets")
        .select("id").eq("company_id", currentCompany.id).eq("source_journal_entry_id", jeId).limit(1);
      if (Array.isArray(existing) && existing.length) {
        showNotification("An asset is already linked to that entry — nothing to do.", "error");
        return { ok: false, skipped: true, error: "already linked" };
      }
      // Load the JE + lines (RLS-scoped) to derive the cost (its debit to the asset GL).
      const { data: je, error: jeErr } = await supabase.from("journal_entries")
        .select("id, entry_date, description, deleted_at, journal_entry_lines(debit, credit, accounts(code, name))")
        .eq("id", jeId).eq("company_id", currentCompany.id).single();
      if (jeErr || !je) { showNotification("Journal entry not found.", "error"); return { ok: false, error: "journal entry not found" }; }
      if (je.deleted_at) { showNotification("That entry is voided/deleted.", "error"); return { ok: false, error: "entry voided/deleted" }; }

      const code = assetCode || rc("fixed_assets") || "1500";
      const assetLine = (je.journal_entry_lines || []).find(l => l.accounts?.code === code && Number(l.debit) > 0);
      if (!assetLine) { showNotification(`That entry has no debit to asset account ${code}.`, "error"); return { ok: false, error: `no debit to ${code}` }; }
      const cost = Number(assetLine.debit) || 0;
      const vendor = (je.description || "").split(" – ")[0] || je.description || "Asset";
      const inService = inServiceDate || je.entry_date;

      const res = await createFixedAssetWithSchedule({
        invoice: { amount: cost, gl_code: code, gl_name: assetLine.accounts?.name || "Fixed Assets", vendor, description: je.description || vendor, date: inService },
        sourceJournalEntryId: jeId, usefulLifeMonths, salvageValue, inServiceDate: inService,
      });
      if (res.ok) {
        try { await loadAllData(); } catch {}
        logAudit("fixed_asset_backfilled", `Attached depreciation to existing entry ${jeId} — ${vendor} ${fmtMoney(cost)}, ${usefulLifeMonths}mo straight-line`, null, { je_id: jeId, asset_id: res.assetId, cost, life_months: usefulLifeMonths });
        showNotification("Depreciation attached & scheduled ✓");
      } else {
        showNotification(`Couldn't attach depreciation: ${res.error || "unknown error"}`, "error");
      }
      return res;
    } catch (e) { console.error("attachDepreciationToExistingAsset:", e); showNotification("Couldn't attach depreciation — see console.", "error"); return { ok: false, error: e?.message || String(e) }; }
  };

  const persistContract = async (contract) => {
    if (!currentCompany?.id || !session?.user?.id) return;
    try {
      const payload = {
        company_id: currentCompany.id,
        file_name: (contract.file_name || "Contract").slice(0, 500),
        contract_type: contract.contract_type || "unknown",
        counterparty: contract.counterparty || "",
        description: contract.description || "",
        total_value: contract.total_value || 0,
        start_date: contract.start_date || null,
        end_date: contract.end_date || null,
        payment_amount: contract.payment_amount || 0,
        payment_frequency: contract.payment_frequency || "monthly",
        interest_rate: contract.interest_rate || 0,
        lease_type: contract.lease_type || null,
        rou_asset_value: contract.rou_asset_value || 0,
        lease_liability_current: contract.lease_liability_current || 0,
        lease_liability_noncurrent: contract.lease_liability_noncurrent || 0,
        discount_rate_used: contract.discount_rate_used || 0,
        lease_term_months: contract.lease_term_months || 0,
        monthly_straight_line_expense: contract.monthly_straight_line_expense || 0,
        accounting_treatment: contract.accounting_treatment || "",
        key_terms: contract.key_terms || [],
        journal_entries: contract.journal_entries || [],
        posted_entries: contract.posted_entries || [],
      };
      if (contract.db_id) {
        const { error } = await supabase.from("contracts")
          .update(payload).eq("id", contract.db_id);
        if (error) console.error("persistContract UPDATE error:", JSON.stringify(error));
      } else {
        const { data, error } = await supabase.from("contracts")
          .insert(payload).select("id").single();
        if (error) console.error("persistContract INSERT error:", JSON.stringify(error));
        else if (data?.id) {
          
          setContracts(prev => prev.map(c => c.id === contract.id ? {...c, db_id: data.id} : c));
        }
      }
    } catch(e) { console.error("persistContract exception:", e); }
  };

  const loadContractsFromDB = async () => {
    if (!currentCompany?.id) return;
    try {
      const { data, error } = await supabase.from("contracts")
        .select("*")
        .eq("company_id", currentCompany.id)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) { console.error("loadContractsFromDB error:", JSON.stringify(error)); return; }
      if (data && data.length > 0) {
        const loaded = data.map(row => {
          let c = {
            ...row,
            db_id: row.id,
            id: row.id,
            posted_entries: row.posted_entries || [],
            journal_entries: row.journal_entries || [],
            key_terms: row.key_terms || [],
          };
          // Always recalculate ASC 842 values — never trust stored AI numbers
          if (c.contract_type === "lease" && c.payment_amount > 0) {
            const term = c.lease_term_months ||
              (c.start_date && c.end_date
                ? Math.round((new Date(c.end_date) - new Date(c.start_date)) / (1000*60*60*24*30.44))
                : 0);
            if (term > 0) {
              const ibr = c.discount_rate_used || DEFAULT_IBR;
              const asc842 = calcASC842(c.payment_amount, term, ibr);
              
              c.rou_asset_value = asc842.rouAsset;
              c.lease_liability_current = asc842.currentPortion;
              c.lease_liability_noncurrent = asc842.nonCurrentPortion;
              c.lease_term_months = term;
              // Also patch Day 1 entry if it has wrong values
              if (c.journal_entries?.[0]) {
                c.journal_entries[0].lines = [
                  { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: asc842.rouAsset, credit: 0 },
                  { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: asc842.currentPortion },
                  { account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: 0, credit: asc842.nonCurrentPortion },
                ];
              }
            }
          }
          return c;
        });
        setContracts(loaded);
        
      } else {
        setContracts([]);
      }
    } catch(e) { console.error("loadContractsFromDB error:", e); }
  };

  const dismissNotification = () => {
    if (notifTimerRef.current) { clearTimeout(notifTimerRef.current); notifTimerRef.current = null; }
    setNotification(null);
  };
  // When `undo` is provided the toast shows an Undo button and stays for 30 seconds.
  const showNotification = (msg, type="success", undo=null) => {
    if (notifTimerRef.current) clearTimeout(notifTimerRef.current);
    setNotification({ msg, type, undo });
    // Errors are easy to miss in 3.5s and are usually action-worthy — keep them up longer.
    const ms = undo ? 30000 : (type==="error" ? 9000 : 3500);
    notifTimerRef.current = setTimeout(() => setNotification(null), ms);
  };

  // ── C197 ROUTE GUARD ───────────────────────────────────────────────────────
  // A seat can arrive on a surface that isn't its own without ever clicking a
  // tab: a restored `persistedView` from before the collapse, a notification
  // deep-link, a company switch into a company where the role is different, or
  // flipping the preview toggle while standing in the cockpit. In every case the
  // answer is the same — go Home, in plain language. Never an error screen, and
  // never a blank one. (Placed after `showNotification` so the toast is defined.)
  useEffect(() => {
    const to = navRedirect(view, { role: userRole, isPlatformAdmin, previewAsOwner });
    if (!to || to === view) return;
    setViewRaw(to);
    onViewChange?.(to);
    showNotification(GATED_VIEW_REDIRECT_COPY);
  }, [view, userRole, isPlatformAdmin, previewAsOwner]); // eslint-disable-line

  const applyRule = (inv, ruleList) => {
    const rule = ruleList.find(r => r.vendor?.toLowerCase() === inv.vendor?.toLowerCase());
    if (!rule) return inv;
    return { ...inv, gl_code: rule.gl_code, gl_name: rule.gl_name, ...(rule.project ? { project: rule.project } : {}) };
  };

  const fileToBase64 = (file) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  const handleFileSelect = async (file) => {
    if (!file) return;
    const v = validateUpload(file, "document");   // size + type guard (CR-34) before any processing
    if (!v.ok) { showNotification(v.error, "error"); return; }
    const base64 = await fileToBase64(file);
    setUploadedFile({ base64, mediaType: file.type, name: file.name });
    setAiSuggestion(null);
    setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"", paidWithCash:false });
    runFullAI(base64, file.type);
  };

  const runFullAI = async (base64, mediaType) => {
    setIsAILoading(true); setAiStep("extracting"); setAiSuggestion(null);
    try {
      const extractRes = await fetch(AI_PROXY_URL, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          profile: "extract-invoice",   // model/max_tokens/system server-owned (ai-proxy/aiProfiles.js)
          messages: [{ role:"user", content:[
            { type: mediaType==="application/pdf"?"document":"image", source:{ type:"base64", media_type:mediaType, data:base64 }},
            { type:"text", text:"Extract all invoice fields. Capture exact vendor name." }
          ]}]
        })
      });
      const extractData = await okAIResponse(extractRes);
      const extracted = JSON.parse((extractData.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());

      // Check if a rule exists for this vendor
      const rule = rules.find(r => r.vendor?.toLowerCase() === extracted.vendor?.toLowerCase());
      if (rule) {
        extracted.project = rule.project || "General";
        setAiSuggestion({ gl_code: rule.gl_code, gl_name: rule.gl_name, secondary_gl_code: rc("accounts_payable"), secondary_gl_name: rn("accounts_payable"), confidence: 99, reasoning: `Applied your vendor rule: ${extracted.vendor} → ${rule.gl_name}${rule.project ? ` (Project: ${rule.project})` : ""}` });
        setForm(extracted);
        setIsAILoading(false); setAiStep(null);
        showNotification(`Vendor rule applied: ${rule.gl_name} ✓`);
        return;
      }

      setForm(extracted);
      setAiStep("coding");
      const codeRes = await fetch(AI_PROXY_URL, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          profile: "code-transaction",   // model/max_tokens/system server-owned; data via untrusted slots
          slots: {
            TXN: `Vendor: ${extracted.vendor}\nDescription: ${extracted.description}\nAmount: $${extracted.amount}\nType: ${extracted.type}`,
            CHART: CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n"),
          },
          messages: [{ role:"user", content:"Suggest the best GL coding for the transaction in the instructions." }]
        })
      });
      const codeData = await okAIResponse(codeRes);
      const coding = JSON.parse((codeData.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
      setAiSuggestion(coding);
      showNotification("Invoice read and coded ✓");
    } catch(e) { showNotification("AI processing failed.", "error"); }
    setIsAILoading(false); setAiStep(null);
  };

  const handleFormChange = (field, value) => setForm(f => ({...f, [field]:value}));

  const handleBookInvoice = (force = false) => {
    if (!form.vendor?.trim()) { showNotification("Vendor name is required.", "error"); return; }
    if (!form.description || !form.amount || !form.date) { showNotification("Please fill all fields.", "error"); return; }
    if (!aiSuggestion) { showNotification("Waiting for AI coding.", "error"); return; }

    const doBook = () => {
      if (!assertBookable(form.date)) return;   // pre-cutoff → reject up front, no optimistic add, no success toast
      const invoice = {
        id: Date.now(), ...form, vendor: form.vendor.trim(),
        amount: parseFloat(form.amount), project: form.project || "General",
        invoice_number: form.invoice_number?.trim() || "",
        gl_code: aiSuggestion.gl_code, gl_name: aiSuggestion.gl_name,
        secondary_gl_code: aiSuggestion.secondary_gl_code, secondary_gl_name: aiSuggestion.secondary_gl_name,
        debit_credit: aiSuggestion.debit_credit, confidence: aiSuggestion.confidence,
        reasoning: aiSuggestion.reasoning, status: "booked", booked_at: new Date().toISOString(),
        // C195(4) — "already paid" manual entry: the money is GONE, so the offset is cash and the
        // entry is stamped paid. Without the stamp it would leak into the open-bills sub-ledger and
        // break ap_tie (the §9 cash-settled-write anti-pattern, C189).
        ...(form.paidWithCash ? {
          secondary_gl_code: rc("cash"), secondary_gl_name: rn("cash"),
          payment_status: "paid", payment_method_used: "cash",
          paid_at: (form.date ? new Date(form.date + "T12:00:00").toISOString() : new Date().toISOString()),
        } : {}),
      };
      // Signed-period guard UP FRONT (no false "Booked ✓" toast): a manual entry dated into a
      // reviewed month opens the decision modal instead of posting. The persistJournalEntry
      // chokepoint is the backstop for every other path.
      const spManual = signedPeriodForDate(invoice.date, signoffs, { source: invoice.source });
      if (spManual) {
        setPendingSignedPeriodBooking({ invoice, period: spManual });
        logAudit("signed_period_booking_held", `Held a manual entry dated ${invoice.date} into signed period ${spManual} — awaiting decision`, null, { date: invoice.date, period: spManual, vendor: invoice.vendor });
        return;
      }
      setInvoices(prev => [invoice, ...prev]);
      runAPScreen([invoice], [invoice, ...invoices]);
      checkWatchTriggers([invoice], unknownDocs);
      logAudit("invoice_booked", `Manual entry: ${invoice.vendor} $${invoice.amount} → ${invoice.gl_name}${form.paidWithCash ? " (already paid — cash out)" : ""}`, null, invoice);
      bookToDb(invoice);
      setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"", paidWithCash:false });
      setAiSuggestion(null); setUploadedFile(null);
      setView("home");
      showNotification(`Booked to ${aiSuggestion.gl_name} ✓`);
    };

    // Duplicate invoice number check for manual entry
    const invNum = form.invoice_number?.trim();
    if (!force && invNum) {
      const dup = invoices.find(ex =>
        ex.invoice_number &&
        ex.invoice_number.toLowerCase() === invNum.toLowerCase() &&
        ex.vendor?.toLowerCase() === form.vendor.trim().toLowerCase()
      );
      if (dup) {
        setDeleteConfirm({
          title: "Duplicate Invoice Detected",
          label: `Invoice #${invNum} from ${form.vendor.trim()} was already booked on ${dup.date} for $${dup.amount.toFixed(2)} (${dup.gl_name}). Are you sure this is a different charge?`,
          confirmLabel: "Book Anyway",
          confirmBg: "var(--sc-success-soft)", confirmBorder: "1px solid var(--sc-success-soft)", confirmColor: "var(--sc-success)",
          onConfirm: doBook,
        });
        return;
      }
    }
    doBook();
  };

  // ── UNIVERSAL UPLOAD ENGINE ───────────────────────────────────────────────────
  // Step 1: Classify what each file is
  const classifyFile = async (base64, mediaType, fileName) => {
    const ext = fileName.split(".").pop().toLowerCase();
    if (["csv","xlsx","xls"].includes(ext)) return "bank_statement";
    const res = await fetch(AI_PROXY_URL, {
      // x-rate-kind:upload — counts this file once against the 20-uploads/hour limit
      method:"POST", headers:{ ...getAuthHeaders(), "x-rate-kind":"upload" },
      body: JSON.stringify({
        profile: "classify-document",   // model/max_tokens/system server-owned
        messages:[{role:"user", content:[
          {type: mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64}},
          {type:"text", text:"Classify this document."}
        ]}]
      })
    });
    const d = await okAIResponse(res);
    const t = (d.content?.find(b=>b.type==="text")?.text||"");
    // O44: route an unsure/unrecognized classification to "unknown" (held for review),
    // not a forced "invoice" guess. Recognizes invoice/receipt/bill positively.
    return classifyDocReply(t);
  };

  // ── UPLOAD LOG ───────────────────────────────────────────────────────────────
  // One persistent row per uploaded file (migration 019), updated as it processes.
  // Fire-and-forget so it never blocks the upload pipeline (works even pre-migration).
  const logUploadStart = (logId, meta) => {
    if (!currentCompany?.id || !logId) return;
    supabase.from("upload_log").insert({
      id: logId,
      company_id: currentCompany.id,
      uploaded_by: session?.user?.id || null,
      file_name: meta.file_name,
      file_type: meta.file_type || null,
      file_size_bytes: meta.file_size_bytes ?? null,
      status: "processing",
    }).then(({ error }) => { if (error) console.error("upload_log insert failed:", error.message); })
      .catch(e => console.error("upload_log insert error:", e));
  };
  const logUploadUpdate = (logId, patch) => {
    if (!currentCompany?.id || !logId) return;
    const done = patch.status === "done" || patch.status === "error";
    supabase.from("upload_log")
      .update({ ...patch, ...(done ? { completed_at: new Date().toISOString() } : {}) })
      .eq("id", logId).eq("company_id", currentCompany.id)
      .then(({ error }) => { if (error) console.error("upload_log update failed:", error.message); })
      .catch(e => console.error("upload_log update error:", e));
  };

  // ── O60 Document Completeness: the INDEPENDENT intake ledger ────────────────
  // Log a document's ARRIVAL to document_intake FIRST — before any AI/parsing/booking —
  // with a known client-generated id so the pipeline can annotate its status later. Write
  // is dead-simple (a hash + insert); on failure we SURFACE it (never block the upload
  // silently — a failed intake log is itself a completeness signal).
  const logIntake = async (intakeId, file, source = "upload") => {
    if (!currentCompany?.id || !intakeId || !file) return;
    try {
      const contentHash = await hashFile(file);
      const row = { id: intakeId, ...buildIntakeRow({ companyId: currentCompany.id, filename: file?.name || null, contentHash, source, uploadedBy: session?.user?.id || null }) };
      const res = await insertIntake(supabase, row);
      if (!res.ok) {
        console.error("[document_intake] arrival log FAILED:", res.error);
        showNotification("Heads up — we couldn't record this upload in the intake ledger. It may still process, but flag it if your books look short.", "error");
      }
    } catch (e) { console.error("[document_intake] logIntake error:", e); }
  };
  // Annotate the intake row as the doc moves through (best-effort: a missed update just
  // leaves it non-terminal, so reconciliation still surfaces it — fail-safe by design).
  const markIntake = (intakeId, status, opts = {}) => {
    if (!currentCompany?.id || !intakeId) return;
    setIntakeStatus(supabase, intakeId, status, opts).then(res => {
      if (!res.ok) console.warn("[document_intake] status update failed:", status, res?.error);
    }).catch(e => console.warn("[document_intake] markIntake error:", e));
  };
  // The completeness check — surface every document that fell through (received/processing
  // stuck, or failed). Independent of the recording pipeline (reads the intake population).
  const reconcileDroppedDocs = async (opts = {}) => {
    if (!currentCompany?.id) return [];
    const res = await fetchDroppedIntake(supabase, currentCompany.id, opts);
    if (!res.ok) console.warn("[document_intake] reconcile failed:", res.error);
    let dropped = res.dropped || [];
    // C195(7) — AUTO-RESOLVE ORPHANS: a re-upload of a file we ALREADY recorded nagged as
    // "received but never recorded" for an hour. document_intake carries content_hash (047) and
    // documents carry it too (C193), so a hash match means the document IS accounted for — retire
    // the intake row instead of surfacing it. Best-effort; never blocks the read.
    if (dropped.length) {
      try {
        const hashes = [...new Set(dropped.map(d => d && d.content_hash).filter(Boolean))];
        if (hashes.length) {
          const { data: docs } = await supabase.from("documents").select("id, content_hash")
            .eq("company_id", currentCompany.id).in("content_hash", hashes);
          const resolvable = autoResolvableIntake({ droppedRows: dropped, recordedHashes: docs || [] });
          if (resolvable.length) {
            const done = new Set();
            for (const r of resolvable) {
              await markIntake(r.intakeId, INTAKE_STATUS.HELD, { detail: "duplicate upload — this file is already recorded in your documents" });
              done.add(String(r.intakeId));
            }
            logAudit("intake_duplicate_auto_resolved", `${done.size} duplicate upload${done.size === 1 ? "" : "s"} matched an already-recorded document and ${done.size === 1 ? "was" : "were"} cleared`, null, { intake_ids: [...done] });
            dropped = dropped.filter(d => !done.has(String(d.id)));
          }
        }
      } catch (e) { console.warn("[document_intake] duplicate auto-resolve skipped:", e?.message || e); }
    }
    return dropped;
  };

  // ── O49 AI confidence: the queryable "needs review" set (for O50's CPA surface) ──
  // Derived from the confidence already stored on each entry (no flag column / migration).
  // flagsForReview() → flagged entries (chosen account + confidence + reasoning + alternatives +
  // reason, most-material-first); reviewFlagSummary() → count / high / $ exposed for a badge.
  const flagsForReview = (opts = {}) => flaggedForReview(invoices, opts);
  const reviewFlagSummary = (opts = {}) => reviewSummary(invoices, opts);

  // ── O59 THIRD NET — accuracy control totals (independent cross-foots from GL truth) ──
  // Any control total that doesn't tie is a high-severity ACCURACY flag surfaced to the
  // review queue. Catches a confidently-WRONG booking (Riverside tax-in-revenue class)
  // that O60 (missing docs) and O49 (unsure) can't. Memoized off the live ledger.
  const controlCodes = useMemo(() => ({
    ar: getAccountByRole("accounts_receivable")?.code,
    ap: getAccountByRole("accounts_payable")?.code,
    salesTax: getAccountByRole("sales_tax_payable")?.code,
  }), [getAccountByRole, CHART_OF_ACCOUNTS]);
  const controlTotals = useMemo(
    () => computeControlTotals({ invoices, reconciliations, intakeRows, codes: controlCodes }),
    [invoices, reconciliations, intakeRows, controlCodes]
  );
  // The latest period a CPA has attested (drives the owner-facing "reviewed through").
  const reviewedThrough = useMemo(() => latestReviewedThrough(signoffs), [signoffs]);

  // ── Bank-match freshness (O90 fourth signal) — ONE source shared by the owner panel AND the
  // dashboard bank-match reminder, so the two surfaces can never contradict ("books matched to
  // the bank?"). Absent/stale reconciliation counts as NOT matched (the false-green fix).
  const bankMatch = useMemo(() => bankMatchStatus({ reconciliations, invoices }), [reconciliations, invoices]);

  // ── O90 OWNER TRUST PROJECTION (CR-27) — the owner-facing view of the SAME trust data ──
  // A plain-language projection of completeness (O60) + confidence (O49) + accuracy (O59)
  // + bank-match + sign-off (O50), run through the SAME evaluateSignOff gate so the owner panel
  // can never disagree with the CPA's ReviewView. Pure + memoized off the live trust sources.
  const ownerTrust = useMemo(() => {
    // "Is there anything to evaluate yet?" — the SAME signals the home setup checklist
    // uses, so the panel and the "0 of 4 done" card can never contradict. hasBooks =
    // at least one live journal entry (first entry booked); setupComplete = onboarding's
    // required steps all done. Empty on both → the panel shows a neutral "let's get set
    // up" state instead of a false green (zero failures out of zero checks).
    const hasBooks = liveEntries(invoices).length > 0;
    const ob = onboardingSteps({ companySettings, bankAccounts, openingBalances, invoices, onboardingUploadDone });
    const setupComplete = ob.obAllDone || !!companySettings.onboardingComplete;
    return ownerTrustState({
      controlTotals,
      openConfidenceFlags: flaggedForReview(invoices),
      intakeRows,
      unknownDocs,
      reviewedThrough,
      bankMatch,
      hasBooks,
      setupComplete,
      openHighAnomalies: openHighAnomalyCount,   // O83 — open HIGH anomaly ⇒ "Nothing wrong" can't be green
    });
  }, [controlTotals, invoices, intakeRows, unknownDocs, reviewedThrough, bankMatch, companySettings, bankAccounts, openingBalances, onboardingUploadDone, openHighAnomalyCount]);

  // ── O83 SIGN-OFF READINESS (single source) — "can THIS period be attested?" ──
  // Preconditions (non-vacuous: a period with nothing to check is NOT ready) + the four
  // nets, for an EXPLICIT period. Both the CPA UI (ReviewView) and the write path below
  // call this so the button, the blocker list, and the write can't disagree. `droppedDocs`
  // lets the UI pass the set it already loaded; the write path passes the freshest set.
  // (setupComplete reuses onboardingSteps — the SAME signal the home checklist / TrustPanel
  // neutral guard use — so the surfaces stay consistent rather than re-deriving "readiness".)
  const signOffReadinessFor = (period, droppedDocs = []) => {
    const setupComplete = onboardingSteps({ companySettings, bankAccounts, openingBalances, invoices, onboardingUploadDone }).obAllDone || !!companySettings.onboardingComplete;
    const openingEntered = openingPosted || (invoices || []).some(i => i.source === "opening_balance");
    return signOffReadiness({
      controlTotals,
      openConfidenceFlags: flagsForReview(),
      droppedDocs,
      unknownDocs: unknownDocs || [],
      bankMatch,
      setupComplete,
      openingEntered,
      entriesInPeriodCount: bookedEntriesInPeriod(invoices, period),
      hasReconForPeriod: reconciliationCoversPeriod(reconciliations, period),
      // O83 — open HIGH anomalies whose entries fall in THIS period block attestation
      // (overridable). Resolve entity_refs → dates against the live ledger here (App has
      // invoices); the pure gate just receives the count. Medium/low never block.
      openHighAnomaliesInPeriod: openHighAnomaliesInPeriod(anomalyRowsRef.current, period, invoices),
    });
  };

  // ── O50/O83 SIGN-OFF — a REVIEWER attests an EXPLICIT period. Blocks unless the gate is
  // clear OR the reviewer explicitly OVERRIDES (acknowledgment + reason RECORDED on the row,
  // with the exact blockers). Re-verified live at write time with the freshest dropped-docs.
  // Returns { ok, row } or { ok:false, blockers?/error? }. Verified write (row read back).
  const signOffPeriod = async (period, { note = null, override = null } = {}) => {
    if (!currentCompany?.id || !session?.user?.id || !period) return { ok: false, error: "missing company/user/period" };
    if (!isReviewer) return { ok: false, error: "only a reviewer (accountant/admin) can sign off — the account owner can't attest their own books" };
    const dropped = await reconcileDroppedDocs();
    const gate = signOffReadinessFor(period, dropped);   // authoritative re-check
    // Blocked and NOT explicitly overridden → refuse, hand back the plain-language blockers.
    if (!gate.ok && !(override && override.acknowledged)) return { ok: false, blockers: gate.blockers };
    // Overriding requires a reason; record the acknowledgment + the exact blockers overridden.
    const overrideRec = (!gate.ok && override && override.acknowledged)
      ? { acknowledged: true, reason: override.reason || null, blockers: gate.blockers }
      : null;
    const res = await persistSignoff(supabase, { companyId: currentCompany.id, period, signedBy: session.user.id, note, override: overrideRec });
    if (res.ok) {
      setSignoffs(prev => [res.row, ...prev.filter(s => s.period !== period)]);
      logAudit("period_signed_off", overrideRec ? `Reviewed through ${period} (override: ${overrideRec.reason || "no reason given"})` : `Reviewed through ${period}`, null, { period, override: !!overrideRec, blockers: overrideRec?.blockers || null });
      await expireAnomaliesForSignedPeriod(period);
      showNotification(overrideRec ? `Signed off ${period} with an override ✓` : `Signed off — reviewed through ${period} ✓`);
    } else {
      showNotification(`Couldn't record the sign-off — ${res.error}`, "error");
    }
    return res.ok ? { ok: true, row: res.row } : { ok: false, error: res.error };
  };

  // Reopen (un-sign) a period — a REVIEWER action. SOFT revoke (migration 051): the row +
  // history survive; the active-signoffs read excludes it so the "Reviewed through" line
  // reverts immediately. Verified via revokeSignoff.
  const reopenPeriod = async (period) => {
    if (!currentCompany?.id || !period) return { ok: false, error: "missing company/period" };
    if (!isReviewer) return { ok: false, error: "only a reviewer (accountant/admin) can reopen a period" };
    const res = await revokeSignoff(supabase, { companyId: currentCompany.id, period, revokedBy: session?.user?.id || null });
    if (res.ok) {
      setSignoffs(prev => prev.filter(s => s.period !== period));
      logAudit("period_reopened", `Reopened ${period} (sign-off revoked)`, { period }, null);
      await reopenAnomaliesForRevokedPeriod(period);
      showNotification(`Reopened ${period} — sign-off revoked`);
    } else {
      showNotification(`Couldn't reopen the period — ${res.error}`, "error");
    }
    return res;
  };

  // ── O83 Trap 2 — decision handlers for a booking held because it dates into a signed period ──
  // Re-post the held entry (booking OR multi-line) with the ack flag so the guard lets it through.
  const repostHeldEntry = async (entry, multiLine) => {
    const acked = { ...entry, _signedPeriodAck: true };
    if (multiLine) return await persistMultiLineEntry(acked);
    setInvoices(prev => prev.some(i => i.id === acked.id) ? prev : [acked, ...prev]);
    const jeId = await persistJournalEntry(acked);
    if (jeId) setInvoices(prev => prev.map(i => i.id === acked.id ? { ...i, db_entry_id: jeId } : i));
    else setInvoices(prev => prev.filter(i => i.id !== acked.id));
    return jeId;
  };
  // (a) REVIEWER ONLY: reopen the signed month (revokes the sign-off, audited), then post into it.
  // The owner can't reopen — that would undo their accountant's attestation (separation of duties).
  const reopenSignedPeriodAndBook = async () => {
    const held = pendingSignedPeriodBooking; if (!held) return;
    if (!isReviewer) { showNotification("Only your accountant can reopen a reviewed month.", "error"); return; }
    const r = await reopenPeriod(held.period);
    if (!r.ok) return;   // reopenPeriod already surfaced the error
    logAudit("signed_period_reopened_for_booking", `Reopened ${held.period} to record ${held.invoice?.vendor || "an entry"} dated ${held.invoice?.date}`, null, { period: held.period, date: held.invoice?.date, vendor: held.invoice?.vendor });
    setPendingSignedPeriodBooking(null);
    const jeId = await repostHeldEntry(held.invoice, held.multiLine);
    if (jeId) { await loadAllData(); showNotification(`Recorded in ${signedMonthLabel(held.period)} — that month is reopened for re-review`); }
  };
  // (b) Rebook into the current OPEN month (date-adjust; the original date is kept in metadata).
  const rebookHeldIntoOpenMonth = async () => {
    const held = pendingSignedPeriodBooking; if (!held) return;
    const moved = rebookedIntoOpenMonth(held.invoice, todayLocal(), held.period);
    logAudit("signed_period_rebooked_open", `Rebooked ${held.invoice?.vendor || "an entry"} out of signed ${held.period} into the open month (original date ${held.invoice?.date} kept)`, null, { period: held.period, original_date: held.invoice?.date, new_date: moved.date });
    setPendingSignedPeriodBooking(null);
    const jeId = await repostHeldEntry(moved, held.multiLine);
    if (jeId) showNotification(`Recorded in the current month — the original date (${held.invoice?.date}) is kept on file.`);
  };
  // (c) Send to the CPA review queue to decide — leave it UNBOOKED (never silently posted); notify.
  const sendHeldToCPA = async () => {
    const held = pendingSignedPeriodBooking; if (!held) return;
    logAudit("signed_period_sent_to_cpa", `Sent ${held.invoice?.vendor || "an entry"} dated ${held.invoice?.date} (signed ${held.period}) to accountant review`, null, { period: held.period, date: held.invoice?.date });
    try { createNotification?.({ type: "needs_review", title: `A ${signedMonthLabel(held.period) || "reviewed-month"} item needs your accountant`, description: `${held.invoice?.vendor || "An entry"} dated ${held.invoice?.date} falls in a reviewed month — your accountant should decide how to record it.`, link_view: "review" }); } catch {}
    setPendingSignedPeriodBooking(null);
    showNotification("Sent to your accountant to decide.");
  };
  const dismissSignedPeriodBooking = () => setPendingSignedPeriodBooking(null);

  // Load intake rows + sign-offs when the company changes (best-effort, pre-migration safe).
  useEffect(() => {
    if (!currentCompany?.id) { setIntakeRows([]); setSignoffs([]); return; }
    let cancelled = false;
    (async () => {
      const [ir, so] = await Promise.all([
        fetchIntakeRows(supabase, currentCompany.id),
        fetchSignoffs(supabase, currentCompany.id),
      ]);
      if (cancelled) return;
      if (ir.ok) setIntakeRows(ir.rows);
      if (so.ok) setSignoffs(so.signoffs);
    })();
    return () => { cancelled = true; };
  }, [currentCompany?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ── O50 CPA-review actions (persist + verify, honest-on-failure — O78 discipline) ──
  // APPROVE: the CPA accepts the AI's coding → mark the entry fully confident (ai_confidence
  // = 100) so it leaves the needs-review queue. Verified by re-reading the written value.
  const reviewApprove = async (txn) => {
    const dbId = txn?.db_entry_id;
    if (!currentCompany?.id || !dbId) return { ok: false, error: "entry isn't saved yet" };
    try {
      const { data, error } = await supabase.from("journal_entries")
        .update({ ai_confidence: 100 }).eq("id", dbId).eq("company_id", currentCompany.id)
        .select("id, ai_confidence").single();
      if (error || !data || Number(data.ai_confidence) !== 100) return { ok: false, error: error?.message || "approve not verified" };
      setInvoices(prev => prev.map(i => String(i.db_entry_id) === String(dbId) ? { ...i, confidence: 100 } : i));
      logAudit("review_approved", `Approved AI coding: ${txn.vendor || "entry"} → ${txn.gl_name || txn.gl_code} ($${Math.abs(txn.amount || 0).toFixed(2)})`, null, { db_entry_id: String(dbId), gl_code: txn.gl_code });
      return { ok: true };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  };
  // OVERRIDE: the CPA picks a different account → RE-BOOK the GL line (persistRecode, verified)
  // AND mark confident so it leaves the queue. (A CPA correction is also the strongest possible
  // teaching signal — future learning-layer hook, O67.)
  const reviewOverride = async (txn, glCode, glName) => {
    if (!currentCompany?.id || !txn?.db_entry_id) return { ok: false, error: "entry isn't saved yet" };
    if (!glCode) return { ok: false, error: "no account chosen" };
    const ok = await persistRecode([txn], glCode, glName);   // re-books the line; returns true only on a committed write
    if (!ok) return { ok: false, error: "recode did not commit" };
    try { await supabase.from("journal_entries").update({ ai_confidence: 100 }).eq("id", txn.db_entry_id).eq("company_id", currentCompany.id); } catch (e) { console.warn("[review] confidence bump failed:", e?.message || e); }
    setInvoices(prev => prev.map(i => String(i.db_entry_id) === String(txn.db_entry_id) ? { ...i, gl_code: glCode, gl_name: glName, confidence: 100 } : i));
    logAudit("review_override", `Recoded ${txn.vendor || "entry"}: ${txn.gl_name || "?"} → ${glName} ($${Math.abs(txn.amount || 0).toFixed(2)})`, { gl_code: txn.gl_code }, { gl_code: glCode });
    return { ok: true };
  };
  // RESOLVE a dropped/incomplete document → move its intake row to a terminal state (verified)
  // so it leaves the completeness queue. resolution ∈ rejected | held_for_review.
  const resolveIntakeItem = async (intakeId, resolution = INTAKE_STATUS.REJECTED, detail = "Resolved in CPA review") => {
    if (!currentCompany?.id || !intakeId) return { ok: false, error: "no intake id" };
    const res = await setIntakeStatus(supabase, intakeId, resolution, { detail });
    if (res.ok) logAudit("intake_resolved", `Resolved intake doc → ${resolution}: ${detail}`, null, { intake_id: String(intakeId), resolution });
    return res;
  };

  const handleUniversalUpload = (files) => {
    if (!files?.length) return;
    // Size + type guard per file (CR-34); reject oversized/wrong-type before queueing.
    const checked = Array.from(files).map(f => ({ f, v: validateUpload(f, "universal") }));
    const validFiles = checked.filter(c => c.v.ok).map(c => c.f);
    const rejected = checked.filter(c => !c.v.ok);
    if (rejected.length) showNotification(rejected[0].v.error, "error");
    if (!validFiles.length) return;

    // Store File objects in ref (survives view changes), add to queue with status "pending"
    const queueItems = validFiles.map(f => {
      const id = Date.now() + Math.random();
      fileStoreRef.current[id] = f;
      const uploadLogId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
      if (uploadLogId) logUploadStart(uploadLogId, { file_name: f.name, file_type: f.type || f.name.split(".").pop().toLowerCase(), file_size_bytes: f.size });
      // O60: log ARRIVAL to the independent intake ledger FIRST (before any processing).
      const intakeId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
      if (intakeId) logIntake(intakeId, f, "upload");
      return { id, name: f.name, status: "pending", type: null, result: null, error: null, upload_log_id: uploadLogId, intake_id: intakeId };
    });
    setUploadQueue(prev => [...queueItems, ...prev]);
    // useEffect below picks up "pending" items and processes them in background
  };

  // ── BACKGROUND UPLOAD PROCESSOR ──────────────────────────────────────────────
  // Watches uploadQueue for pending items. Runs one at a time. View-change safe.
  useEffect(() => {
    const processPending = async () => {
      if (uploadActiveRef.current) return;
      // Use functional read trick: schedule via setState to get fresh queue
      setUploadQueue(currentQueue => {
        const pending = currentQueue.find(q => q.status === "pending");
        if (!pending) { setUploadProcessing(false); return currentQueue; }
        // Mark as classifying synchronously so next effect call skips it
        uploadActiveRef.current = true;
        setUploadProcessing(true);
        // Kick off async processing outside of setState
        const item = pending;
        const file = fileStoreRef.current[item.id];
        processUploadItem(item, file);
        return currentQueue.map(q => q.id===item.id ? {...q, status:"classifying"} : q);
      });
    };
    processPending();
  }, [uploadQueue]); // eslint-disable-line

  const processUploadItem = async (item, file) => {
    try {
        const ext = item.name.split(".").pop().toLowerCase();
        const isSpreadsheet = ["csv","xlsx","xls"].includes(ext);

        let base64 = null, mediaType = null;
        if (!isSpreadsheet) {
          base64 = await fileToBase64(file);
          mediaType = ext==="pdf" ? "application/pdf" : `image/${ext==="jpg"?"jpeg":ext}`;
        }

        // Universal "drop anything" routing. A spreadsheet was previously ASSUMED to
        // be a bank statement — which silently booked a payroll CSV as bank entries.
        // Now we sniff it (deterministic) and route payroll/QBO to the right importer;
        // bank or unrecognized spreadsheets fall through to the bank flow as before.
        let docType;
        if (isSpreadsheet) {
          const det = await detectFileType(file);
          const route = planUniversalSpreadsheetRoute(det);
          if (route.to === "payroll" || route.to === "qbo") {
            routeFileToType(route.to, file);
            setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:route.to, result:{ routed:true, to:route.to }} : q));
            logUploadUpdate(item.upload_log_id, { status:"done", doc_type:route.to, result:{ routed:true } });
            markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: `routed to ${route.to} importer` });   // terminal: in a visible queue, not lost
            if (navSeat.isReviewerSeat) showNotification(`That looked like a ${TYPE_LABEL[route.to]} — routed it to the right importer.`);   // C197: the client seat gets routeFileToType's plain-language confirmation instead
            return;
          }
          docType = "bank_statement";   // bank or unrecognized spreadsheet → bank flow
        } else {
          docType = await classifyFile(base64, mediaType, item.name);
        }

        // O55: a PDF/image the AI classifier recognized as a payroll register or a
        // QuickBooks export gets routed to its dedicated importer (was: no branch → it
        // fell through and did nothing). Same routing the spreadsheet path uses.
        if (docType === "payroll" || docType === "qbo") {
          routeFileToType(docType, file);
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:docType, result:{ routed:true, to:docType }} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:docType, result:{ routed:true } });
          markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: `routed to ${docType} importer` });   // terminal: in a visible queue
          if (navSeat.isReviewerSeat) showNotification(`That looked like a ${TYPE_LABEL[docType]} — routed it to the right importer.`);   // C197: ditto — no "importer" language for a client
          return;
        }

        // A bank/card statement's offset account (Cash 1000 for a bank vs Credit Card
        // 2200 for a card) can't be known from the file's content — only the account it
        // BELONGS to tells you (O57/C63). So never book a statement inline in the
        // universal "drop anything" path: that path has no account binding, so it would
        // either crash on the undefined offset (the "offsetCode is not defined" bug this
        // fixes) or silently default the offset to Cash and re-break O57 for cards.
        // Instead ROUTE to the Bank Import screen with the file pre-loaded, where the
        // account-picker (C63) appears and the user selects the account → correct offset.
        // Covers both spreadsheet and PDF statements (classifyFile → bank_statement).
        if (docType === "bank_statement") {
          // DON'T hijack navigation. A bank statement is the highest-stakes import
          // (bulk + probabilistic matching + the future CPA-review, O50), so it gets a
          // dedicated, deliberately-reachable destination (Books → Bank Import) rather
          // than an inline panel. We stash the file (BankView consumes it on arrival via
          // pendingImportFile) and SURFACE the result where the user already is — a
          // queue link + a notification — instead of yanking them to another screen.
          // ── C198·2 (a1) — THE DROP IS THE PIPELINE ────────────────────────────
          // The ambiguity that forced C186's deferral (which account is this statement's
          // offset?) only exists when there is a choice. With EXACTLY ONE bank account
          // there is none: bind it and run the whole thing — parse, persist, book, match,
          // except, and (a2) reconcile — right here. This is the missing half of
          // "handled, not operated": the clean path has existed since C186; until now
          // nothing client-facing could reach it.
          const soleAccount = autoBindAccount(bankAccounts);
          if (soleAccount) {
            // C198·2b — the tile said "Done" beside the stash sentence while the pipeline
            // was still booking, because this branch stamped 'done' BEFORE awaiting and
            // nothing wrote the result back. Order it honestly: PROCESSING first…
            setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"processing", type:"bank_statement", result:{ routed:true, to:"pipeline", running:true }} : q));
            logUploadUpdate(item.upload_log_id, { status:"processing", doc_type:"bank_statement", result:{ auto_bound: String(soleAccount.id) } });
            // Same intake row, carried through — one arrival, one row. handleBankFile
            // advances it to RECORDED (a4) once every line lands in the books.
            try {
              const outcome = await handleBankFile(file, soleAccount, { intakeId: item.intake_id });
              // …and only NOW is it done — stamped with what actually happened, so the queue
              // line renders the pipeline's own truth instead of the stash copy it replaced.
              setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:"bank_statement", result:{ routed:true, to:"pipeline", ...(outcome || { ran:false }) }} : q));
              logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"bank_statement", result: outcome || { ran:false } });
            } catch (e) {
              // Never "done" on a throw. The line says something needs a look, and the
              // intake row stays non-terminal so the completeness net still sees it.
              console.error("[pipeline] auto-run failed:", e);
              setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"error", type:"bank_statement", result:{ routed:true, to:"pipeline", failed:true }} : q));
              logUploadUpdate(item.upload_log_id, { status:"error", doc_type:"bank_statement", result:{ failed:true, error: String(e?.message || e) } });
            }
            return;
          }
          // 0 or 2+ accounts: a human still has to say which account this belongs to.
          // Stash it — but DURABLY (a3): pendingImportFile is React state, so the live
          // O86 loss was a statement evaporating on the next navigation. The stored
          // document + the intake row are the pointer that survives.
          setPendingImportFile({ type: "bank_statement", file });
          let stashDocId = null;
          try {
            const base64 = await fileToBase64(file);
            const mediaType = file?.type || (/\.pdf$/i.test(file?.name || "") ? "application/pdf" : "text/csv");
            const stored = await storeDocument(file.name, base64, mediaType, "bank_statement", null, ["bank_statement"], null, file);
            stashDocId = (typeof stored === "string" && /^[0-9a-f-]{16,}$/i.test(stored)) ? stored : null;
          } catch (e) { console.warn("[stash] document store skipped:", e?.message || e); }
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:"bank_statement", result:{ routed:true, to:"bank" }} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"bank_statement", result:{ routed:true } });
          markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: buildStashDetail({ fileName: file?.name }), documentId: stashDocId });   // (a3) the durable pointer
          // C197 — same fact, told to the seat that's listening. The client is not
          // pointed at a tab they don't have, and their notification doesn't deep-link
          // into one (the route guard would only bounce them back).
          if (navSeat.isReviewerSeat) {
            showNotification("Bank statement uploaded — review & book it in Bank Import (Books → Bank Import).");
            try { createNotification?.({ type:"bank_import", title:"Bank statement ready to import", description:"Open Bank Import to pick the account, review the matches, and book it.", link_view:"bank" }); } catch {}
          } else {
            showNotification("Got it — we've saved your statement for your accountant to add to your books.");
            try { createNotification?.({ type:"bank_import", title:"Your statement is in", description:"Your accountant will add these transactions to your books.", link_view:"home" }); } catch {}
          }
          return;
        }

        // Update status: processing + type known
        setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, type:docType, status:"processing"} : q));
        logUploadUpdate(item.upload_log_id, { status:"processing", doc_type:docType });
        markIntake(item.intake_id, INTAKE_STATUS.PROCESSING, { detail: `processing as ${docType}` });

        if (docType === "invoice") {
          // Extract ALL invoices in the document (handles single and multi-invoice PDFs)
          const extractRes = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              profile: "extract-invoices-batch",   // model/max_tokens/system server-owned; business identity via untrusted slots
              slots: {
                BUSINESS_NAME: companySettings?.name || "",
                BUSINESS_ALIASES: companySettings?.aliases || "",
              },
              messages:[{role:"user", content:[
                {type:mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64}},
                {type:"text", text:"Extract every invoice or receipt in this document. Return one JSON object per invoice."}
              ]}]
            })
          });
          const extractData = await okAIResponse(extractRes);
          const rawText = (extractData.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim();
          // Handle both array and single-object responses gracefully
          let extractedList = [];
          try {
            const parsed = JSON.parse(rawText);
            extractedList = Array.isArray(parsed) ? parsed : [parsed];
          } catch(e) {
            // Try to recover if Claude returned a single object without brackets
            try { extractedList = [JSON.parse(rawText)]; } catch(e2) { extractedList = []; }
          }

          
          if (extractedList.length === 0) {
            setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"error", error:"Could not extract invoice data — try a clearer scan"} : q));
            logUploadUpdate(item.upload_log_id, { status:"error", error:"Could not extract invoice data — try a clearer scan" });
            markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: "couldn't extract invoice data — held for review" });   // terminal: visible, not lost
            return;
          }

          // O75 — DETERMINISTIC DIRECTION from the company's own identity (don't trust the
          // AI's guess alone): if the company ISSUED the doc → revenue/AR; if it's the
          // RECIPIENT → expense/AP; if identity is set but neither/both match → ambiguous
          // (ask, never guess). If no identity is configured, leave the AI's type as-is
          // (`unknown` → current behavior). `_direction` drives routing below.
          const identityNames = companyIdentityNames(companySettings);
          const identitySet = identityNames.length > 0;
          extractedList = extractedList.map(ex => {
            const dir = classifyDocDirection({ issuer: ex.issuer || ex.from || "", recipient: ex.recipient || ex.bill_to || ex.to || "", identityNames });
            if (dir.direction === "revenue") return { ...ex, type: "revenue", _direction: "revenue" };
            if (dir.direction === "expense") return { ...ex, type: "expense", _direction: "expense" };
            return { ...ex, _direction: identitySet ? "ambiguous" : "unknown" };
          });

          // Batch GL code all invoices in one call
          const codeRes = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              profile: "code-invoices-batch",   // model/max_tokens/system server-owned; chart + invoices via untrusted slots
              slots: {
                CHART: CHART_OF_ACCOUNTS.filter(a=>a.category==="Revenue"||a.category==="Expenses").map(a=>`${a.code} - ${a.name}`).join("\n"),
                INVOICES: JSON.stringify(extractedList.map((inv,i)=>({index:i, vendor:inv.vendor, description:inv.description, amount:inv.amount, type:inv.type}))),
              },
              messages:[{role:"user", content:`Code the ${extractedList.length} invoices provided in the instructions.`}]
            })
          });
          const codeData = await okAIResponse(codeRes);
          let codings = [];
          try {
            const codeRaw = (codeData.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim();
            const parsed = JSON.parse(codeRaw);
            codings = Array.isArray(parsed) ? parsed : [parsed];
          } catch(e) { codings = []; }

          // Split invoices by confidence — high confidence books immediately, low confidence asks user
          const highConfidence = [];
          const needsClarification = [];
          let mealsBooked = 0;

          extractedList.forEach((extracted, idx) => {
            const coding = codings[idx] || {};
            const rule = rules.find(r => r.vendor?.toLowerCase()===extracted.vendor?.toLowerCase());
            const isRevenue = extracted.type === "revenue";
            const confidence = rule ? 99 : (coding.confidence || 75);
            const finalCode = rule ? rule.gl_code : (coding.gl_code || (isRevenue ? rc("product_revenue") : rc("miscellaneous_expense")));
            const finalName = rule ? rule.gl_name : (coding.gl_name || (isRevenue ? rn("product_revenue") : rn("miscellaneous_expense")));

            const invoice = {
              id: Date.now() + Math.random() + idx,
              vendor: extracted.vendor?.trim() || "Unknown",
              description: extracted.description || "",
              amount: parseFloat(extracted.amount) || 0,
              // Sales tax pulled from the invoice → split to Sales Tax Payable (2350) at
              // booking for revenue invoices (persistJournalEntry), never lumped into revenue.
              tax_amount: parseFloat(extracted.tax_amount) || 0,
              date: extracted.date || todayLocal(),
              // Classify `type` from the GL code (same basis as flattenJournalEntries +
              // the canonical layer) so the in-session row is never mis-slotted by an odd
              // AI `type` and always shows in the transactions tab the moment it's booked.
              type: glIsRevenue(finalCode) ? "revenue" : glIsExpense(finalCode) ? "expense" : (extracted.type || "expense"),
              notes: extracted.notes || "",
              invoice_number: extracted.invoice_number || "",
              // O11: carry the extracted payment terms + derive a due date (Net 30 → date+30,
              // Due on receipt → date). Shown on the row immediately and persisted by
              // persistJournalEntry; AR/AP aging then ages from the real due date.
              payment_terms: extracted.payment_terms || "",
              due_date: deriveDueDate(extracted.date || todayLocal(), extracted.payment_terms) || null,
              project: rule?.project || "General",
              gl_code: finalCode,
              gl_name: finalName,
              secondary_gl_code: rule ? rc("accounts_payable") : (coding.secondary_gl_code || (isRevenue ? rc("accounts_receivable") : rc("accounts_payable"))),
              secondary_gl_name: rule ? rn("accounts_payable") : (coding.secondary_gl_name || (isRevenue ? rn("accounts_receivable") : rn("accounts_payable"))),
              debit_credit: isRevenue ? "credit" : "debit",
              confidence,
              // Use the AI's reasoning; if it omitted one, build a descriptive fallback
              // from the extracted data (never a bare "Auto-coded").
              reasoning: rule
                ? `Applied your vendor rule for ${extracted.vendor?.trim() || "this vendor"} → ${finalName} (${finalCode}).`
                : (coding.reasoning?.trim()
                    || `Coded to ${finalName} (${finalCode}) — ${(extracted.description || extracted.vendor || "this purchase").toString().slice(0, 80)} from ${extracted.vendor?.trim() || "the vendor"}.`),
              status: "booked",
              booked_at: new Date().toISOString(),
              source: "universal_upload",
              // Plain-English clarifying questions the AI raised for the conversational flow
              questions: Array.isArray(extracted.questions) ? extracted.questions : [],
              confidence_score: extracted.confidence_score ?? null,
              // Auto-create/update contact from the extracted details after booking
              _contact: {
                name: extracted.vendor?.trim() || "",
                type: isRevenue ? "customer" : "vendor",
                address: extracted.vendor_address || "", email: extracted.vendor_email || "",
                phone: extracted.vendor_phone || "", website: extracted.vendor_website || "",
                payment_terms: extracted.payment_terms || "", account_number: extracted.account_number || "",
                tax_id: extracted.tax_id || "", gl_code: finalCode, gl_name: finalName,
              },
            };

            // Meals: auto-apply the 50% deductibility rule (no question needed) and notify.
            if (invoice.type !== "revenue" && GAAP_MEALS_RE.test(`${invoice.description||""} ${invoice.vendor||""} ${invoice.notes||""}`.toLowerCase())) {
              invoice.gl_code = rc("travel_entertainment");
              invoice.gl_name = rn("travel_entertainment");
              invoice.meals_pct = 50;
              invoice.deductible_amount = (Number(invoice.amount)||0) * MEALS_DEDUCTIBLE_RATE;
              invoice.reasoning = `Meals booked to Travel & Entertainment (6400) — 50% deductible under current tax law, deductible portion ${fmtMoney(invoice.deductible_amount)}. ${invoice.reasoning||""}`.trim();
              mealsBooked += 1;
            }
            // GAAP review — capital vs expense, prepaid, leasehold, vehicle. ONLY for
            // expenses: a prepaid/capitalize question presupposes the doc is an expense, so
            // never ask it on revenue (the Meridian wrong-premise bug — a misclassified
            // invoice was shown only prepaid-amortization options). O75.
            const gaapItem = invoice.type === "revenue" ? null : buildGaapClarification(invoice);

            // Duplicate check — runs before any other routing. First an exact
            // invoice-number match, then a smart fuzzy match (same vendor + amount
            // within 1% + within 7 days, or exact amount + same vendor any date).
            const dupByNumber = invoice.invoice_number
              ? invoices.find(ex =>
                  ex.invoice_number &&
                  ex.invoice_number.toLowerCase() === invoice.invoice_number.toLowerCase() &&
                  ex.vendor?.toLowerCase() === invoice.vendor?.toLowerCase()
                )
              : null;
            const dupExisting = dupByNumber || findDuplicate(invoice, invoices);

            if (dupExisting) {
              needsClarification.push({
                id: Date.now() + Math.random(),
                invoice,
                queueItemId: item.id,
                isDuplicate: true,
                existingInvoice: dupExisting,
                question: `Invoice #${invoice.invoice_number} from ${invoice.vendor} was already booked on ${dupExisting.date} for $${dupExisting.amount.toFixed(2)} (coded to ${dupExisting.gl_name}). Is this the same charge?`,
                options: [],
                suggestedCode: invoice.gl_code,
                suggestedName: invoice.gl_name,
              });
            // O75 — DIRECTION confirmed by the company's own identity → book straight as
            // revenue/AR (no "is this revenue?" nag; this is the "your own invoices just
            // work" case). The doc is coded to a 4xxx revenue account already.
            } else if (extracted._direction === "revenue") {
              highConfidence.push(invoice);
            // AMBIGUOUS (identity set but neither/both parties matched) OR the AI guessed
            // revenue without identity confirmation → ask direction FIRST, offering both a
            // revenue and an expense category (a type/direction correction, not a sub-detail).
            } else if (extracted._direction === "ambiguous" || (!rule && isRevenue)) {
              // Direction is genuinely unclear — ask the ONE plain-language question a person
              // would ask. Options are plain choices (Cardinal Principle — NO account names /
              // GL codes): "we sent it" books as revenue; "we received it" re-routes to the
              // plain "what was this for?" expense question.
              const primaryRev = CHART_OF_ACCOUNTS.find(a => a.category === "Revenue") || {};
              needsClarification.push({
                id: Date.now() + Math.random(),
                invoice,
                queueItemId: item.id,
                directionFirst: true,
                question: `Quick check — did your business send this out to get paid, or is it a bill you received?`,
                options: [
                  { label: "We sent it — a customer paid us or owes us",
                    code: isRevenue ? finalCode : primaryRev.code, name: isRevenue ? finalName : primaryRev.name,
                    typeOverride: { type: "revenue", secondary_gl_code: rc("accounts_receivable"), secondary_gl_name: rn("accounts_receivable") } },
                  { label: "We received it — it's a bill we need to record", reroute: "expense" },
                ],
                suggestedCode: finalCode,
                suggestedName: finalName,
              });
            } else if (gaapItem) {
              // Needs a GAAP clarifying question before it can be booked correctly.
              needsClarification.push({ id: Date.now() + Math.random(), queueItemId: item.id, ...gaapItem });
            } else {
              // ── CONFIDENCE-GATED booking (autoBookDecision) ─────────────────────────────
              // A real bookkeeper who KNOWS what something is just books it — no question. So
              // we auto-book unless (a) confidence is below the "ask, don't guess" floor
              // (AI_CONFIDENCE_ASK_FLOOR — a near-coin-flip is asked even if immaterial), (b) the
              // O49 signal says a human would pause (unsure AND material), or (c) there's no
              // amount to book. So an 80%-confident small item just books; a 65% one asks.
              //
              // Learned-vendor decay (O64): if this business has booked this vendor the same
              // way before, trust it like a soft rule and book straight through — this is what
              // makes the questions taper off over time.
              const learned = recallVendor(clientProfileRef.current, invoice.vendor);
              if (learned) {
                // A HUMAN correction OVERRIDES the AI's guess even when they disagree (that's the
                // whole point — it stops the corrected mistake from re-applying). An AI-learned
                // mapping only fills a blank or confirms a matching guess (never overrides).
                const isHuman = learned.source === "human_correction";
                if (isHuman || !invoice.gl_code || String(invoice.gl_code) === String(learned.gl_code)) {
                  invoice.gl_code = isHuman ? learned.gl_code : (invoice.gl_code || learned.gl_code);
                  invoice.gl_name = isHuman ? learned.gl_name : (invoice.gl_name || learned.gl_name);
                  invoice.confidence = Math.max(Number(invoice.confidence) || 0, AI_CONFIDENCE_AUTO_BOOK);
                  invoice.reasoning = isHuman
                    ? `Coded ${invoice.vendor} to ${learned.gl_name} — you corrected this vendor before, so we apply your categorization.`
                    : `${invoice.reasoning || ""} Recognized ${invoice.vendor} from past bookings — booked the way you've categorized it before.`.trim();
                }
              }
              // Book unless we're below the "ask, don't guess" floor (AI_CONFIDENCE_ASK_FLOOR)
              // OR O49 says a human would pause on a material amount. A vendor rule (and the
              // learned-vendor boost above, which lifts confidence to the auto-book level) books
              // straight through — that's how the questions decay as this business is learned.
              const decision = autoBookDecision(invoice);
              if (rule || decision.autoBook) {
                highConfidence.push(invoice);
              } else {
                // Genuinely unsure (or missing the amount) → ask ONE plain-language question and
                // let the free-text answer map to an account (answerToAccount). No GL buttons.
                needsClarification.push({
                  id: Date.now() + Math.random(),
                  invoice,
                  queueItemId: item.id,
                  question: draftClientQuestion(invoice).question,
                  suggestedCode: finalCode,
                  suggestedName: finalName,
                });
              }
            }
          });

          // Book high-confidence invoices immediately — log each one individually.
          // Keep each invoice's booking promise so we can link the source document to
          // the durable db_entry_id once both the entry AND the document exist.
          let bookPromises = [];
          if (highConfidence.length > 0) {
            setInvoices(prev => [...highConfidence, ...prev]);
            bookPromises = highConfidence.map(inv => {
              logAudit("invoice_booked", `${inv.vendor} · $${(inv.amount||0).toFixed(2)} → ${inv.gl_name} (${inv.confidence}% confidence · ${inv.date})`, null, { vendor: inv.vendor, amount: inv.amount, date: inv.date, gl_code: inv.gl_code, gl_name: inv.gl_name });
              createOrUpdateContact(inv._contact);
              return bookToDb(inv);
            });
            runAPScreen(highConfidence, [...highConfidence, ...invoices]);
            checkWatchTriggers(highConfidence, unknownDocs);
          }

          // Queue low-confidence invoices for clarification (conversational flow).
          // Attach a document thumbnail (images) + name so the card can show it.
          if (needsClarification.length > 0) {
            const clarThumb = (mediaType || "").startsWith("image/") ? `data:${mediaType};base64,${base64}` : null;
            needsClarification.forEach(c => { if (!c.thumb) c.thumb = clarThumb; if (!c.docName) c.docName = item.name; if (!c.mediaType) c.mediaType = mediaType; });
            setClarificationQueue(prev => [...prev, ...needsClarification]);
          }
          if (mealsBooked > 0) showNotification(`Meals are 50% deductible — we booked ${mealsBooked===1?"it":"them"} at 50% per IRS rules.`);

          const newInvoices = [...highConfidence];
          const totalAmt = newInvoices.reduce((s,i)=>s+i.amount, 0);
          // Link the source document to the first booked invoice; if NOTHING was
          // booked (everything needs clarification), link it to the first clarification
          // invoice's in-session id instead. When that entry is later booked from the
          // clarification flow, bookToDb() re-links the doc to its durable db_entry_id.
          const primaryId = newInvoices[0]?.id ?? needsClarification[0]?.invoice?.id ?? null;
          // Store the document linked to the primary booked invoice, then — once the
          // entry's durable db_entry_id has resolved — re-link the document to it so the
          // Source Document section finds it after a refresh (it matches on db_entry_id).
          await storeDocument(item.name, base64, mediaType, "invoice", primaryId, ["uploaded"], item.id, file);
          if (primaryId != null && bookPromises.length) {
            try {
              const jeIds = await Promise.all(bookPromises);
              if (jeIds[0]) await relinkDocsForInvoice(primaryId, jeIds[0]);
            } catch (e) { console.warn("source-doc relink after booking failed:", e?.message || e); }
          }
          logAudit("invoice_uploaded", `Uploaded ${item.name}: ${extractedList.length} invoice(s) extracted`);
          const firstBooked = highConfidence[0] || null;
          const firstReview = needsClarification[0]?.invoice || null;
          const invoiceResult = {
            invoiceCount: highConfidence.length,
            needsClarification: needsClarification.length,
            amount: totalAmt,
            vendor: firstBooked?.vendor ?? null,
            gl_name: firstBooked?.gl_name ?? null,
            // (2) Plain-language trail for the owner — "as a client meal", never an account name.
            bookedAs: firstBooked ? plainCategoryPhrase(firstBooked) : null,
            confidence: highConfidence.length > 0 ? Math.round(highConfidence.reduce((s,i)=>s+(i.confidence||0),0)/highConfidence.length) : null,
            reviewVendor: firstReview?.vendor ?? null,
            reviewAmount: firstReview?.amount ?? null,
          };
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result: invoiceResult} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"invoice", result: invoiceResult });
          // O60 terminal: booked → recorded (+ JE links); nothing booked but in the
          // clarification queue → held_for_review (visible, not lost).
          if (highConfidence.length > 0) markIntake(item.intake_id, INTAKE_STATUS.RECORDED, { journalEntryIds: highConfidence.map(i => i.db_entry_id).filter(Boolean), detail: `${highConfidence.length} invoice(s) booked` });
          else markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: needsClarification.length ? "awaiting clarification in review queue" : "no transaction extracted — needs review" });

        } else if (docType === "bank_statement") {
          // BACKSTOP ONLY — bank/card statements are now ROUTED to the Bank Import
          // screen (with the account-picker) above and return before reaching here, so
          // this branch is unreachable in the normal flow. If a future path ever lands
          // here, bind a DEFINED offset (Cash default) so there is never a ReferenceError
          // (the original "offsetCode is not defined" crash); buildBankLineEntry also
          // defaults to Cash 1000. A real account binding only happens via handleBankFile.
          const account = null;
          const offsetCode = rc("cash");
          const offsetName = rn("cash");
          // Parse bank statement
          let rawTxns = [];
          if (isSpreadsheet) {
            const text = await new Promise(res => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsText(file); });
            const parseRes = await fetch(AI_PROXY_URL, {
              // x-rate-kind:upload — spreadsheets skip classifyFile, so count the file here
              method:"POST", headers:{ ...getAuthHeaders(), "x-rate-kind":"upload" },
              body: JSON.stringify({
                profile: "parse-bank-csv",   // model/max_tokens/system server-owned; statement text via untrusted slot
                slots: { STATEMENT: text.slice(0,8000) },
                messages:[{role:"user", content:"Parse the bank statement text in the instructions."}]
              })
            });
            const pd = await okAIResponse(parseRes);
            rawTxns = JSON.parse((pd.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          } else {
            const parseRes = await fetch(AI_PROXY_URL, {
              method:"POST", headers:getAuthHeaders(),
              body: JSON.stringify({
                profile: "parse-bank-pdf",   // model/max_tokens/system server-owned
                messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:"Extract all transactions."}]}]
              })
            });
            const pd = await okAIResponse(parseRes);
            rawTxns = JSON.parse((pd.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          }

          // Categorize transactions
          const catRes = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              profile: "categorize-bank",   // model/max_tokens/system server-owned; chart + transactions via untrusted slots
              slots: {
                CHART: CHART_OF_ACCOUNTS.filter(a=>a.category==="Revenue"||a.category==="Expenses").map(a=>`${a.code} - ${a.name}`).join("\n"),
                TRANSACTIONS: JSON.stringify(rawTxns.slice(0,80)),
              },
              messages:[{role:"user", content:`Categorize the ${rawTxns.length} transactions provided in the instructions.`}]
            })
          });
          const catData = await okAIResponse(catRes);
          const categorized = JSON.parse((catData.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          // ONE stable, truthy id per parsed line, used for BOTH matching and booking
          // (bankTxns below reuses it verbatim). NEVER the categorizer's id:0 — that's
          // falsy, so a `t.id || …` fallback would silently regenerate a divergent id
          // and the "skip matched rows" filter would miss the matched line and
          // double-book it. Index-based + run-stamped so it can't collide.
          const runStamp = Date.now();
          const withRules = categorized.map((t,i) => {
            const rule = rules.find(r => r.vendor?.toLowerCase()===t.vendor?.toLowerCase());
            const id = `bank_${runStamp}_${i}`;
            return rule
              ? {...t, id, gl_code:rule.gl_code, gl_name:rule.gl_name, confidence:99, needs_review:false, rule_applied:true}
              : {...t, id};
          });
          // ── RECONCILIATION: match the statement against open payables/receivables ──
          // Normalize each parsed line into a matching-engine transaction (signed
          // amount). Reuse the SAME stable id — never regenerate.
          const bankTxns = withRules.map((t) => ({
            id: t.id,
            date: t.date, description: t.description, vendor: t.vendor,
            amount: t.type === "revenue" ? Math.abs(t.amount) : -Math.abs(t.amount),
            type: t.type, gl_code: t.gl_code, gl_name: t.gl_name, confidence: t.confidence,
          }));

          const { autoCleared, queue } = await runMatchingEngine(bankTxns, invoices);

          // Decide — purely & testably — which matched lines clear an open item vs
          // which are genuinely new bookings, off ONE stable id per line. A matched
          // line's only GL movement is its clearing entry; it is NEVER also booked
          // standalone (the bug this replaces). See src/lib/bankMatch.js.
          const plan = planBankImport({
            parsedTxns: withRules,
            autoCleared, queue,
            openItems: invoicesRef.current || invoices,
            codes: {
              apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities"),
              arCode: rc("accounts_receivable"), cashCode: rc("cash"), cashName: rn("cash"),
            },
          });

          // Post each clearing through the canonical poster (AP: Dr A/P / Cr Cash ·
          // AR: Dr Cash / Cr A/R) AND persist the paid/collected flag. This IS the
          // matched line's booking — there is no separate standalone entry for it.
          const clearedInvIds = new Set();
          for (const c of plan.clears) {
            const ok = await markBillPaid(c.invoiceId, { side: c.side, method: "bank_transfer", paidDate: c.date || null });
            if (ok) clearedInvIds.add(c.invoiceId);
          }

          // Lower-confidence matches AND any that couldn't post a clearing entry →
          // manual review queue (never silently flag-flipped, never double-booked).
          // Carry the import account onto each queued match so a later dismiss books
          // the line against the right offset (Cr 2200 for a card), not Cash (C60 interaction).
          if (plan.review.length > 0) setMatchQueue(prev => [...plan.review.map(m => ({ ...m, importOffsetCode: offsetCode, importOffsetName: offsetName })), ...prev]);
          if (plan.skipped.length > 0) {
            logAudit("bank_match_unclearable", `${plan.skipped.length} auto-match(es) couldn't post a clearing entry (offset not A/P or A/R) — moved to review`);
            showNotification(`${plan.skipped.length} auto-match(es) couldn't post a clearing entry — moved to review`, "error");
          }

          // Bank lines that matched nothing are genuinely new transactions — book them all
          // (paid via bank transfer, since they already cleared the bank). There is no
          // separate bank feed anymore, so low-confidence GL codes are booked with their
          // best guess rather than parked.
          const unmatchedTxns = plan.standalone;
          const newInvoices = unmatchedTxns.map((t)=>({
            id:Date.now()+Math.random(), booked_at:new Date().toISOString(),
            ...buildBankLineEntry(t, { offsetCode, offsetName }),   // direction by type + offset by account (card → Cr 2200)
          }));
          if (newInvoices.length > 0) {
            setInvoices(prev => [...newInvoices, ...prev]);
            newInvoices.forEach(inv => bookToDb(inv));
          }

          // Reconciliation summary numbers.
          const matchedCount = autoCleared.length + queue.length;
          const txnTotal = withRules.length;
          const stillOpenTotal = invoices
            .filter(inv => (inv.type==="expense"||inv.type==="revenue") && !inv.matched && inv.payment_status!=="paid" && inv.payment_status!=="collected" && !clearedInvIds.has(inv.id))
            .reduce((s,inv)=>s+Math.abs(inv.amount||0), 0);

          // Persist a reconciliation record (table stays — now reached via the upload flow).
          // History is audit-critical, so retry once before giving up and surface a
          // visible error to the user rather than swallowing the failure.
          const txnDates = withRules.map(t=>t.date).filter(Boolean).sort();
          const reconRecord = {
            company_id: currentCompany.id, account_name: (account && account.name) || "Bank statement upload",
            period_start: txnDates[0] || todayLocal(),
            period_end: txnDates[txnDates.length-1] || todayLocal(),
            statement_balance: 0, books_balance: 0, difference: 0,
            // O83: this is an IMPORT-TIME auto-match snapshot, NOT a human reconciliation — it
            // never verified a real bank ending balance (statement_balance: 0). Mark it
            // 'import_snapshot' (migration 054) so it does NOT count as a completed reconciliation:
            // reconciliationCoversPeriod, bankMatchStatus, and the cash-recon control all gate on
            // status='complete', so merely uploading a statement can no longer satisfy them.
            status: "import_snapshot",   // was reconRecordStatus(...) — review count lives in bankResult.needsReview
            matched_transactions: autoCleared.map(m => ({ bank_txn: m.bank_txn, invoice_ids: m.invoice_ids, confidence: m.confidence })),
            unmatched_bank: newInvoices.map(i => ({ vendor: i.vendor, amount: i.amount, date: i.date, gl_name: i.gl_name })),
            completed_at: new Date().toISOString(), completed_by: session?.user?.id || null,  // uuid column, not email
          };
          const saveReconRecord = async () => {
            try {
              const { error } = await supabase.from("reconciliations").insert(reconRecord);
              return error ? (error.message || "insert error") : null;
            } catch(e) { return e?.message || String(e); }
          };
          let recSaveErr = await saveReconRecord();
          if (recSaveErr) {
            console.warn("[reconciliations] save failed, retrying once:", recSaveErr);
            await new Promise(r => setTimeout(r, 800));
            recSaveErr = await saveReconRecord();
          }
          if (recSaveErr) {
            console.error("[reconciliations] save failed after retry:", recSaveErr);
            logAudit("reconciliation_save_failed", `Reconciliation record could not be saved after matching ${matchedCount} of ${txnTotal} transactions: ${recSaveErr}`);
            showNotification("Your transactions were matched successfully but we couldn't save the reconciliation record — please contact support.", "error");
          } else {
            logAudit("bank_reconciled", `Bank statement: matched ${matchedCount} of ${txnTotal} transactions · ${newInvoices.length} new booked · $${stillOpenTotal.toFixed(2)} open items remain`);
          }

          const bankResult = {
            reconciliation: true, txnCount: txnTotal, matchedCount, newBooked: newInvoices.length,
            needsReview: plan.review.length, stillOpenTotal,
          };
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result: bankResult} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"bank_statement", result: bankResult });
          markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: "bank statement in review/booking flow" });   // terminal: visible queue

        } else if (docType === "contract") {
          // Full contract analysis — two calls to avoid token limits
          // Call 1: Extract terms + Day 1 entry
          const res1 = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              profile: "extract-contract",   // model/max_tokens/system server-owned; chart via untrusted slot
              slots: { CHART: CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n") },
              messages:[{role:"user",content:[
                {type:mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64}},
                {type:"text",text:"Extract contract terms and generate Day 1 entry only."}
              ]}]
            })
          });
          const d1 = await okAIResponse(res1);
          const contract = JSON.parse((d1.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());

          // Generate all monthly entries in JS (no second API call needed)
          const monthlyEntries = [];
          let calcLeaseTermMonths = contract.lease_term_months || 0;
          if (!calcLeaseTermMonths && contract.start_date && contract.end_date) {
            calcLeaseTermMonths = Math.round((new Date(contract.end_date) - new Date(contract.start_date)) / (1000 * 60 * 60 * 24 * 30.44));
          }
          if (contract.contract_type === "lease" && calcLeaseTermMonths > 0) {
            const ibr = contract.discount_rate_used || DEFAULT_IBR;
            const ibrM = ibr / 12;
            const pmt = parseFloat(contract.payment_amount) || 0;
            const sl = contract.monthly_straight_line_expense || pmt;
            let liab = (parseFloat(contract.lease_liability_current)||0) + (parseFloat(contract.lease_liability_noncurrent)||0);
            if (liab === 0 && pmt > 0) liab = ibrM > 0 ? pmt * (1 - Math.pow(1+ibrM,-calcLeaseTermMonths)) / ibrM : pmt * calcLeaseTermMonths;
            const leaseStartYMD = contract.start_date || todayLocal();
            for (let i = 0; i < calcLeaseTermMonths; i++) {
              // Local-safe schedule date (CR-4/CR-5): month-add on the YMD string, never a
              // UTC toISOString() of a Date (which day-shifts the period for non-UTC users).
              const ds = addMonthsClampedYMD(leaseStartYMD, i + 1);
              const interest = liab * ibrM;
              const principal = Math.min(pmt - interest, liab);
              liab = Math.max(0, liab - principal);
              monthlyEntries.push({ date:ds, description:`Operating lease payment — Month ${i+1}`, memo:`ASC 842-20: Straight-line $${sl.toFixed(2)}/mo`,
                lines:[{account_code:rc("operating_lease_expense"),account_name:rn("operating_lease_expense"),debit:parseFloat(sl.toFixed(2)),credit:0},{account_code:rc("cash"),account_name:rn("cash"),debit:0,credit:parseFloat(pmt.toFixed(2))}]});
              if (principal > 0.01) monthlyEntries.push({ date:ds, description:`Lease liability reduction — Month ${i+1}`, memo:`ASC 842-20: Principal $${principal.toFixed(2)}`,
                lines:[{account_code:rc("lease_liability_current"),account_name:rn("lease_liability_current"),debit:parseFloat(principal.toFixed(2)),credit:0},{account_code:rc("rou_asset"),account_name:"Right-of-Use Asset",debit:0,credit:parseFloat(principal.toFixed(2))}]});
            }
            contract.lease_term_months = calcLeaseTermMonths;
          }

          contract.journal_entries = [...(contract.journal_entries||[]), ...monthlyEntries];
          const saved = { ...contract, id:Date.now()+Math.random(), file_name:item.name, uploaded_at:new Date().toISOString(), posted_entries:[] };
          setContracts(prev => [saved, ...prev]);
          persistContract(saved);
          storeDocument(item.name, base64, mediaType, "contract", saved.id, ["contract"], item.id, file);
          logAudit("contract_uploaded", `Contract uploaded: ${item.name}`);
          const contractResult = {
            counterparty:contract.counterparty, type:contract.contract_type, entries:contract.journal_entries?.length||0
          };
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result: contractResult} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"contract", result: contractResult });
          markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: "contract imported — review/post in Contracts" });   // terminal: visible queue

        } else if (docType === "unknown") {
          // Ask Claude to explain AND propose a journal entry (or explicitly say none needed)
          const explainRes = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              profile: "explain-unknown-doc",   // model/max_tokens/system server-owned; chart via untrusted slot
              slots: { CHART: CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n") },
              messages:[{role:"user", content:[
                {type:mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64}},
                {type:"text", text:"Analyze this document and propose accounting treatment."}
              ]}]
            })
          });
          const explainData = await okAIResponse(explainRes);
          let unknownRecord;
          try {
            const parsed = JSON.parse((explainData.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
            unknownRecord = {
              id: Date.now()+Math.random(),
              name: item.name,
              uploaded_at: new Date().toISOString(),
              document_type: parsed.document_type || "Unknown Document",
              ai_explanation: parsed.explanation || "Could not analyze this document.",
              entry_needed: parsed.entry_needed || false,
              entry_summary: parsed.entry_summary || null,
              journal_entry: parsed.journal_entry || null,
              no_entry_reason: parsed.no_entry_reason || null,
              watch_for: parsed.watch_for || [],
              watch_matches: [], // populated when triggers fire
              posted: false,
            };
          } catch(e) {
            unknownRecord = {
              id: Date.now()+Math.random(),
              name: item.name,
              uploaded_at: new Date().toISOString(),
              document_type: "Unknown Document",
              ai_explanation: "Could not analyze this document. Please review manually.",
              entry_needed: false,
              watch_for: [],
              watch_matches: [],
              posted: false,
            };
          }
          setUnknownDocs(prev => [unknownRecord, ...prev]);
          const unknownResult = { document_type: unknownRecord.document_type, entry_needed: unknownRecord.entry_needed, watching: unknownRecord.watch_for?.length > 0 };
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:"unknown", result: unknownResult} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"unknown", result: unknownResult });
          markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: "unrecognized document — held for review (catch-all)" });   // terminal: never void
        }

    } catch(e) {
      console.error("Upload error:", item.name, e);
      const errMsg = e?.message || String(e) || "Processing failed";
      setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"error", error:`${errMsg} — try again`} : q));
      logUploadUpdate(item.upload_log_id, { status:"error", error:`${errMsg} — try again` });
      markIntake(item.intake_id, INTAKE_STATUS.FAILED, { detail: errMsg });   // O60: NON-terminal → reconciliation surfaces it
    } finally {
      // Clean up file ref and release lock so next pending item can run
      delete fileStoreRef.current[item.id];
      uploadActiveRef.current = false;
      // Nudge the effect to check for more pending items
      setUploadQueue(prev => [...prev]);
    }
  };

  // ── BANK FEED ────────────────────────────────────────────────────────────────
  // ── FILE MISROUTE GUARD (O37) ──────────────────────────────────────────────
  // Before an importer processes a file, sniff what it actually IS. On a CONFIDENT
  // mismatch (high confidence, a different known type), warn and offer to route it
  // to the correct importer — never silently mis-process. Match / unknown / low
  // confidence → proceed (the drop target is itself a strong prior; don't nag).
  // Returns true to proceed, false to stop (cancelled or routed elsewhere).
  const guardImport = async (file, expectedType) => {
    let det;
    try { det = await detectFileType(file); } catch { return true; }   // detection failure never blocks
    const mismatch = det && det.confidence === "high" && det.type !== "unknown" && det.type !== expectedType;
    if (!mismatch) return true;
    const choice = await new Promise(resolve => setMisrouteConfirm({ detected: det.type, expected: expectedType, resolve }));
    if (choice === "route") { routeFileToType(det.type, file); return false; }
    return choice === "proceed";
  };

  // Send a file to the importer that matches its detected type. App-scope handlers
  // process directly; view-local importers (payroll, qbo) get the file stashed in
  // pendingImportFile and the view auto-consumes it on navigation.
  //
  // C197 — the importers for statements, payroll and QuickBooks are CPA surfaces. A
  // CLIENT seat must never be walked into one: the file is still accepted and still
  // stashed (nothing is lost, the CPA picks it up on their next visit), but we say so
  // in plain language and stay put instead of navigating into a wall.
  const routeFileToType = (type, file) => {
    if (!navSeat.isReviewerSeat && (type === "bank_statement" || type === "payroll" || type === "qbo")) {
      setPendingImportFile({ type, file });
      showNotification("Got it — we've saved that for your accountant to add to your books.");
      return;
    }
    if (type === "bank_statement") { setView("bank"); handleBankFile(file); }
    else if (type === "contract") { setView("contracts"); handleContractFile(file); }
    else if (type === "invoice") { setView("add"); handleUniversalUpload([file]); }
    else if (type === "payroll") { setPendingImportFile({ type: "payroll", file }); setView("payroll"); showNotification("Routed to Payroll Import ✓"); }
    else if (type === "qbo") { setPendingImportFile({ type: "qbo", file }); setView("onboard"); showNotification("Use the QuickBooks import here ✓"); }
  };

  // C185 — persist the parsed statement + its lines as durable records (pipeline foundation).
  // Additive + best-effort: any failure is swallowed so the existing review flow is unaffected.
  // Stores the statement FILE in the doc library (document_type 'bank_statement') and links it.
  // Returns { statementId, lineIds } (lineIds aligned to `lines` order) so the caller can stamp
  // the in-memory rows and the booking flow can advance their status.
  const persistBankStatement = async ({ account, file, rawTxns, lines, statedOpening, statedPeriodStart, statedPeriodEnd }) => {
    if (!currentCompany?.id) return { statementId: null, lineIds: [] };
    try {
      // Doc-library linkage for the bank path (§11 "Document library misses bank statements" (a)).
      let documentId = null;
      try {
        const base64 = await fileToBase64(file);
        const mediaType = file?.type || (/\.pdf$/i.test(file?.name || "") ? "application/pdf" : "text/csv");
        const stored = await storeDocument(file.name, base64, mediaType, "bank_statement", null, ["bank_statement"], null, file);
        documentId = (typeof stored === "string" && /^[0-9a-f-]{16,}$/i.test(stored)) ? stored : null;   // only a real uuid; the in-session fallback id isn't a documents FK
      } catch (e) { console.warn("[bank_statements] doc store skipped:", e?.message || e); }

      // C193 — content hash of the SAME bytes the doc library deduped on. Statements are NOT
      // uniquely constrained: a re-upload still gets its own fresh run record (the pipeline needs
      // one). Instead we collect the PRIOR same-content rows for THIS account so they can be
      // retired after the run (see supersedePriorStatements) — which is what stops their resolved
      // lines showing as zombie exception cards.
      let contentHash = null;
      try { contentHash = await fileSha256Hex(file); } catch (e) { console.warn("[bank_statements] hash skipped:", e?.message || e); }
      let priorSameHashIds = [];
      let priorSameHashRows = [];
      if (contentHash) {
        try {
          // Scoped to this ACCOUNT (§11 item 7): the same file uploaded to a different account
          // is a real problem the client must still see — never silently merged.
          // C198·1 (j) — carry the STATUS (and period/balance) too: a re-upload onto a
          // NON-complete statement must RE-EVALUATE, not silently retire-and-forget.
          let q = supabase.from("bank_statements").select("id, status, bank_account_id, period_start, period_end, stated_ending_balance, source_filename").eq("company_id", currentCompany.id).eq("content_hash", contentHash).neq("status", "superseded");
          q = (account && account.id) ? q.eq("bank_account_id", account.id) : q.is("bank_account_id", null);
          const { data: priors } = await q;
          priorSameHashIds = (priors || []).map((r) => String(r.id));
          priorSameHashRows = priors || [];
        } catch { /* column may not exist pre-059 */ }
      }

      const der = deriveStatementOpening({ transactions: rawTxns, statedOpening, statedPeriodStart });
      // C198·3c (ii) — the STATED period wins on each side it exists; the transaction span is
      // the fallback, not the default. (der.periodStart already prefers the stated start; it has
      // no opinion about the end, which is precisely the side July got wrong.)
      const { periodStart, periodEnd, periodEndSource } = statementPeriod(rawTxns, { statedStart: statedPeriodStart, statedEnd: statedPeriodEnd });
      if (periodEndSource === "span") console.info("[bank_statements] period_end inferred from the last transaction — the statement didn't state one");
      const stmtRow = buildStatementRow({
        companyId: currentCompany.id,
        bankAccountId: (account && account.id) || null,
        documentId,
        // C198·3c (ii) — statementPeriod's start, not der.periodStart. Both prefer the
        // stated start, but deriveStatementOpening takes it VERBATIM (`statedPeriodStart ||
        // first.date`), so a half-read header went straight into a `date` column and the
        // rejected insert took statement + line persistence down with it, behind a warn.
        periodStart,
        periodEnd,
        statedOpening: der.ok ? der.openingBalance : (statedOpening != null ? statedOpening : null),
        statedEnding: der.ok ? der.endingBalance : null,
        sourceFilename: file?.name || null,
        status: "parsed",
        contentHash,
      });
      const { data: stmt, error: sErr } = await supabase.from("bank_statements").insert(stmtRow).select("id").single();
      if (sErr || !stmt) { console.warn("[bank_statements] insert failed (apply migration 058?):", sErr?.message); return { statementId: null, lineIds: [], priorSameHashIds: [] }; }

      const lineRows = buildStatementLineRows(lines, { companyId: currentCompany.id, statementId: stmt.id });
      const { data: insertedLines, error: lErr } = await supabase.from("bank_statement_lines").insert(lineRows).select("id");
      if (lErr) console.warn("[bank_statement_lines] insert failed:", lErr.message);
      return { statementId: stmt.id, lineIds: (insertedLines || []).map(r => r.id), priorSameHashIds, priorSameHashRows };
    } catch (e) { console.warn("[bank_statements] persist skipped:", e?.message || e); return { statementId: null, lineIds: [], priorSameHashIds: [], priorSameHashRows: [] }; }
  };

  // C193 — retire the PRIOR same-content statement rows after the new run completes: status
  // 'superseded' + superseded_by → the new row. Their LINES keep their own history/status (we
  // never rewrite what happened); the read layer (loadStatementExceptions) simply stops
  // surfacing exceptions whose parent is superseded. Checked writes (C192) — never silent.
  const supersedePriorStatements = async (priorIds, newStatementId) => {
    if (!currentCompany?.id || !newStatementId || !(priorIds || []).length) return;
    for (const pid of priorIds) {
      if (String(pid) === String(newStatementId)) continue;
      await checkedRowUpdate({ supabase, table: "bank_statements", id: pid, companyId: currentCompany.id,
        patch: { status: "superseded", superseded_by: newStatementId }, label: "statement:supersede" });
    }
    logAudit("statement_superseded", `${priorIds.length} earlier upload${priorIds.length === 1 ? "" : "s"} of this statement retired (same content)`, null, { superseded: priorIds, superseded_by: newStatementId });
  };

  // ── C198·1 (i)+(j) — THE STATEMENT LIFECYCLE, off the reconcile path ────────
  // Until now a statement could only reach 'complete' via the reconcile-completion
  // sweep. The FIRST-PASS path (pipeline runs → a human books the leftovers in Bank
  // Import) never re-derived it, so a fully-finished statement kept its 'attention'
  // status and its Review card forever (O86 (i)). This re-derives it from the two
  // things that actually decide it: are all the LINES in the ledger, and is the
  // BALANCE settled (a completed reconciliation covers the period, or the stated
  // ending balance ties to the books). Returns { advanced, ready, statement }.
  // NO new status: 'complete' is exactly what ReconView's sweep writes.
  const reevaluateStatement = async (stmtId, { account = null } = {}) => {
    const cid = currentCompany?.id;
    if (!stmtId || !cid) return { advanced: false, ready: false, statement: null };
    try {
      const { data: st } = await supabase.from("bank_statements")
        .select("id, status, bank_account_id, period_start, period_end, stated_ending_balance, source_filename")
        .eq("id", stmtId).eq("company_id", cid).maybeSingle();
      if (!st) return { advanced: false, ready: false, statement: null };
      const { data: ls } = await supabase.from("bank_statement_lines")
        .select("status").eq("company_id", cid).eq("statement_id", stmtId);
      const lineStatuses = (ls || []).map((l) => l.status);

      // Is the BALANCE settled? Either the period is already reconciled, or the
      // statement's own ending balance nets against the books. Never assume it —
      // advancing on lines alone would manufacture a false green (§11 O90 class).
      const covered = (reconciliations || []).some(r => r && String(r.status) === "complete"
        && (!st.bank_account_id || !r.account_id || String(r.account_id) === String(st.bank_account_id))
        && String(r.period_start || "") && String(st.period_start || "") >= String(r.period_start || "")
        && String(st.period_end || "") <= String(r.period_end || ""));
      let balanceSettled = covered;
      if (!balanceSettled && st.stated_ending_balance != null) {
        const acct = account || (bankAccounts || []).find(b => String(b.id) === String(st.bank_account_id));
        const cashCode = (acct && acct.gl_code) || rc("cash");
        const booksBalance = reconBooksBalance(invoicesRef.current, [cashCode], { asOf: st.period_end });
        const diff = reconcileDifference({ statementBalance: st.stated_ending_balance, booksBalance, outstandingSigned: 0, unmatchedBankSigned: 0 });
        balanceSettled = Math.abs(Number(diff) || 0) < 0.005;
      }

      const next = statementAdvanceStatus({ status: st.status, lineStatuses, balanceSettled });
      let advanced = false;
      if (next) {
        const r = await checkedRowUpdate({ supabase, table: "bank_statements", id: stmtId, companyId: cid,
          patch: { status: next }, label: "statement:advance-first-pass" });
        advanced = !!(r && r.ok);
        if (advanced) {
          logAudit(STATEMENT_COMPLETED_AUDIT, `Everything on ${st.source_filename || "the statement"} is recorded — closed it out`, null, { statement_id: String(stmtId), from: st.status, to: next });
          try { await loadStatementExceptions(cid); } catch {}
        }
      }
      const ready = statementReadyToReconcile({ statement: { ...st, status: advanced ? next : st.status }, lineStatuses, reconciliations });
      return { advanced, ready, balanceSettled, statement: st, lineStatuses };
    } catch (e) { console.warn("[statement] re-evaluate skipped:", e?.message || e); return { advanced: false, ready: false, statement: null }; }
  };

  // (j) — the offer. When every line of a statement is in the ledger and nobody has
  // reconciled the period, the system HANDS the CPA a ready session (account, month,
  // lines and the statement's own ending balance) instead of demanding the file again.
  // Consumed by ReconView on arrival; cleared once taken.
  const [reconcileOffer, setReconcileOffer] = useState(null);
  const offerReconciliation = (statement, { account = null } = {}) => {
    if (!statement) return;
    const acct = account || (bankAccounts || []).find(b => String(b.id) === String(statement.bank_account_id));
    setReconcileOffer({
      statementId: String(statement.id),
      accountId: statement.bank_account_id ? String(statement.bank_account_id) : (acct && String(acct.id)) || null,
      accountName: (acct && acct.name) || "your account",
      periodStart: statement.period_start || null,
      periodEnd: statement.period_end || null,
      statedEnding: statement.stated_ending_balance != null ? statement.stated_ending_balance : null,
    });
  };

  // ── C198·2 (a2) — THE MACHINE COMPLETES THE RECONCILIATION ──────────────────
  // Reconciliation is ARITHMETIC (machine-verifiable); sign-off is JUDGMENT (human,
  // always). Lower tiers have little or no CPA-review cadence, so the pipeline has
  // to finish without a click. C194's rule is untouched and absolute: a row may only
  // be created COMPLETE when the balance verifiably ties — this converts a PROVEN tie
  // into a record, it never manufactures one. If the balance does not tie, NO row is
  // written and the human session is offered instead (that's what it's for).
  const completeReconciliationIfSettled = async (rv, { account = null } = {}) => {
    if (!rv || !rv.statement) return false;
    const st = rv.statement;
    if (!shouldAutoCompleteReconciliation({ statement: st, lineStatuses: rv.lineStatuses || [], reconciliations, balanceSettled: rv.balanceSettled })) return false;
    const acct = account || (bankAccounts || []).find(b => String(b.id) === String(st.bank_account_id));
    const cashCode = (acct && acct.gl_code) || rc("cash");
    const booksBalance = reconBooksBalance(invoicesRef.current, [cashCode], { asOf: st.period_end });
    const difference = reconcileDifference({ statementBalance: st.stated_ending_balance, booksBalance, outstandingSigned: 0, unmatchedBankSigned: 0 });
    // Belt and braces: re-assert the SAME gate ReconView's Complete button honours,
    // against the same helper, immediately before the insert.
    if (!canCompleteReconciliation({ statementBalance: String(st.stated_ending_balance == null ? "" : st.stated_ending_balance), difference })) return false;
    await completePipelineReconciliation({
      account: acct || { id: st.bank_account_id, name: "account" },
      periodStart: st.period_start, periodEnd: st.period_end,
      statementBalance: st.stated_ending_balance, booksBalance, difference, outstandingBooks: [],
    });
    // The auto-vs-manual marker lives in the AUDIT LOG (no new column, no migration):
    // completePipelineReconciliation already stamps `auto: true`, and this second row
    // carries the plain-language sentence an owner can read.
    logAudit(AUTO_RECONCILED_AUDIT, autoReconciledAuditDetail({ monthLabel: periodMonthLabel ? periodMonthLabel(st.period_start) : st.period_start, accountName: acct && acct.name }), null, { statement_id: String(st.id), period: `${st.period_start}→${st.period_end}`, auto: true });
    try { await loadAllData(); } catch {}
    return true;
  };

  // The single "what happens after a statement's lines are all settled" decision,
  // shared by every path (pipeline run, first-pass manual booking, re-upload):
  // tie → the machine reconciles; no tie → the CPA session is offered. Also advances
  // the INTAKE row to RECORDED (a4) — the un-narrowed half of O86 (i), where finished
  // work stayed 'held' forever and the completeness net kept calling it parked.
  const settleStatementAftermath = async (statementId, { account = null, intakeId = null } = {}) => {
    const rv = await reevaluateStatement(statementId, { account });
    if (!rv || !rv.statement) return { reconciled: false, offered: false };
    let reconciled = false;
    if (rv.ready) {
      reconciled = await completeReconciliationIfSettled(rv, { account });
      if (!reconciled) offerReconciliation(rv.statement, { account });
    }
    // C198·2b — WHY it wasn't reconciled on this run matters to the owner: "already
    // checked" is a good outcome, "not checked" is a pending one. Read the coverage fact
    // directly rather than inferring it from `ready` (which is false for BOTH reasons).
    const alreadyReconciled = !reconciled && reconciliationCoversStatement(reconciliations, rv.statement);
    if (intakeId && intakeAdvanceFromLines(rv.lineStatuses || [])) {
      try {
        const { data: jeLines } = await supabase.from("bank_statement_lines")
          .select("journal_entry_id").eq("company_id", currentCompany.id).eq("statement_id", statementId);
        const jeIds = [...new Set((jeLines || []).map(l => l.journal_entry_id).filter(Boolean).map(String))];
        markIntake(intakeId, INTAKE_STATUS.RECORDED, { detail: `statement recorded — ${(rv.lineStatuses || []).length} transaction(s) in the books`, journalEntryIds: jeIds });
      } catch (e) { console.warn("[intake] statement advance skipped:", e?.message || e); }
    }
    return { reconciled, alreadyReconciled, offered: rv.ready && !reconciled, rv };
  };

  const handleBankFile = async (file, account = null, { intakeId: callerIntakeId = null } = {}) => {
    if (!file) return;
    const v = validateUpload(file, "bank");   // size + type guard (CR-34)
    if (!v.ok) { showNotification(v.error, "error"); return; }
    if (!(await guardImport(file, "bank_statement"))) return;   // misroute guard
    // O60 Phase 2: log the ARRIVAL to the intake ledger so a bank statement (a
    // non-universal-upload path) is "accounted for" too. Marked terminal (HELD) once
    // it produces reviewable transactions; if processing throws it stays non-terminal
    // → surfaced by the completeness net (fail-safe).
    // C198·2 (a1) — when the universal drop hands the file over it ALREADY logged an
    // intake row; reuse it so one arrival is one row (a second would look like a second
    // document to the completeness net) and so (a4) advances the row the drop created.
    const bankIntakeId = callerIntakeId || ((typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()));
    if (!callerIntakeId) logIntake(bankIntakeId, file, "bank");
    // The statement belongs to a specific account — its GL is the offset for direct
    // bookings (Cr 1000 for a bank account, Cr 2200 for a credit card), not hardcoded
    // Cash. Falls back to Cash if no account was selected (legacy/no accounts).
    const offsetCode = (account && account.gl_code) || rc("cash");
    const offsetName = (account && account.gl_code && getAccountByCode(offsetCode)?.name) || rn("cash");
    const allowedTypes = ["text/csv","application/vnd.ms-excel","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/pdf","text/plain"];
    const allowedExts = [".csv",".xlsx",".xls",".pdf",".txt"];
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (!allowedExts.includes(ext)) { showNotification("Please upload a CSV, Excel, or PDF bank statement.", "error"); return; }
    setBankFileName(file.name);
    setBankProcessing(true);
    setBankStep("parsing");
    setBankTransactions([]);
    setBankProgress(10);
    let pipelineRan = false, pipelineRemaining = 0;   // C190 — did the auto-pipeline run, and how many lines still need a human?
    let pipelineAutoReconciled = false, pipelineAlreadyReconciled = false, pipelineBooked = 0, pipelineTotal = 0;   // C198·2 — what the owner is told at the end

    try {
      let fileContent = "";
      if (ext === ".pdf") {
        // PDF: send as base64 image/document to Claude
        const base64 = await fileToBase64(file);
        setBankStep("categorizing"); setBankProgress(40);
        const res = await fetch(AI_PROXY_URL, {
          method:"POST", headers:getAuthHeaders(),
          body: JSON.stringify({
            profile: "parse-bank-pdf",   // model/max_tokens/system server-owned
            messages:[{role:"user",content:[
              {type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},
              {type:"text",text:"Extract all transactions from this bank statement as JSON."}
            ]}]
          })
        });
        const d = await okAIResponse(res);
        const raw = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
        fileContent = raw;
      } else {
        // CSV/Excel: read as text
        fileContent = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result);
          reader.readAsText(file);
        });
        setBankStep("categorizing"); setBankProgress(30);
        // Send raw text to Claude to parse + extract transactions
        const res = await fetch(AI_PROXY_URL, {
          method:"POST", headers:getAuthHeaders(),
          body: JSON.stringify({
            profile: "parse-bank-csv",   // model/max_tokens/system server-owned; statement text via untrusted slot
            slots: { STATEMENT: fileContent.slice(0,8000) },
            messages:[{role:"user",content:"Parse the bank statement text in the instructions and extract all transactions."}]
          })
        });
        const d = await okAIResponse(res);
        fileContent = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
      }

      // The parse profile returns the object shape { opening_balance, period_start,
      // transactions } OR (legacy) a bare transactions array — the SHARED normalizer handles
      // both (same one the Reconcile flow uses). Stated opening + period start feed the O83
      // opening-balance proposal below; the stated period (C198·3c (ii)) feeds the persisted
      // statement's period, in preference to the transaction span.
      const { transactions: rawTxns, statedOpening, statedPeriodStart, statedPeriodEnd } = normalizeBankParse(fileContent);
      setBankProgress(60);

      // Now batch-categorize all transactions with GL coding + vendor extraction
      if (rawTxns.length === 0) { markIntake(bankIntakeId, INTAKE_STATUS.HELD, { detail: "no transactions found — held for review" }); showNotification("No transactions found in file.", "error"); setBankProcessing(false); return; }

      setBankStep("categorizing"); setBankProgress(70);
      const categorizeRes = await fetch(AI_PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          profile: "categorize-bank",   // model/max_tokens/system server-owned; chart + transactions via untrusted slots
          slots: {
            CHART: CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n"),
            TRANSACTIONS: JSON.stringify(rawTxns.slice(0,80)),
          },
          messages:[{role:"user",content:`Categorize the ${rawTxns.length} bank transactions provided in the instructions.`}]
        })
      });

      const catData = await okAIResponse(categorizeRes);
      const categorized = JSON.parse((catData.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());

      // Apply vendor rules to any matches
      const withRules = categorized.map(t => {
        const rule = rules.find(r => r.vendor?.toLowerCase() === t.vendor?.toLowerCase());
        if (rule) return { ...t, gl_code: rule.gl_code, gl_name: rule.gl_name, confidence: 99, needs_review: false, rule_applied: true };
        return t;
      });

      // Stable, AI-round-trip-safe line ids. A 13-digit numeric id (Date.now()+i) comes
      // back from the matching LLM as a string (or reformatted), so the strict-=== bank_txn
      // lookup failed and the matched line was NOT excluded from standalone → double-booked
      // (once as the clearing entry, once as a mis-coded bank_import entry). A short, string,
      // underscore-tagged id echoes back verbatim (never falsy id:0) and is the matching key.
      const idStamp = Date.now();
      // O83 idempotent re-upload: mark lines already booked to THIS account (content dedup)
      // so re-uploading a statement never double-books; already-booked lines default UNCHECKED.
      const dedupOffset = (account && account.gl_code) || rc("cash");
      const deduped = markAlreadyBooked(withRules, invoicesRef.current, { offsetCode: dedupOffset });
      const withIds = deduped.map((t,i) => ({ ...t, id: `bank_${idStamp}_${i}`, checked: !t.needs_review && !t.already_booked }));
      // C195(5) — NO TRANSITIONAL FLASH. When the automatic pipeline is going to run, never render
      // the full parsed list first: it would appear and then vanish as the verdict replaces it
      // (raised 4× across O84). Stay in the processing state and resolve DIRECTLY into the final
      // reduced set. With no bound account (manual flow) the list is the outcome, so show it.
      const willRunPipeline = !!(account && account.id);
      if (!willRunPipeline) setBankTransactions(withIds);
      else setBankStep("handling");
      // O83 — derive the STATED (or running-balance-implied) opening balance and, when this
      // account has none yet, PROPOSE it (never silently book). If an opening already exists
      // and disagrees, raise a DISCREPANCY for the trust layer (never auto-adjust).
      try {
        const cashCode = (account && account.gl_code) || rc("cash");
        const acctName = (account && account.name) || "checking";
        const der = deriveStatementOpening({ transactions: rawTxns, statedOpening, statedPeriodStart });
        if (der.ok) {
          const obRow = (openingBalances || []).find(b => String(b.account_code) === String(cashCode) && b.posted);
          const recorded = obRow ? Number(obRow.balance) : null;
          const hasOpeningForAccount = recorded != null || openingPosted;
          const live = (invoicesRef.current || []).filter(i => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at && i.source !== "opening_balance");
          const earliestBookedDate = live.reduce((min, i) => (min == null || String(i.date) < min ? String(i.date) : min), null);
          if (!hasOpeningForAccount && shouldProposeOpening({ hasOpeningForAccount, earliestBookedDate, periodStart: der.periodStart })) {
            setPendingOpeningProposal({ openingBalance: der.openingBalance, endingBalance: der.endingBalance, periodStart: der.periodStart, accountCode: cashCode, accountId: (account && account.id) || null, accountName: acctName, mismatch: der.mismatch, stated: der.stated, derived: der.derived });
            setOpeningDiscrepancyFlag(null);
          } else if (hasOpeningForAccount) {
            // Compare the statement's stated opening against GL CASH AT PERIOD START (the balance
            // the books CARRY INTO the period = cash as of the day before the first statement date),
            // NOT the recorded opening-balance ROW. The row is only the FIRST month's starting
            // position; from month 2 on, books cash at period start = opening + all prior activity,
            // so comparing to the row false-fires by exactly the prior period's net income (the O83
            // Feb finding: a $3,174.33 phantom = January's net income). Same canonical glAccountBalance
            // source the reconcile fix uses. dayBefore(periodStart) excludes the period's own activity.
            const glCashAtPeriodStart = glAccountBalance(cashCode, invoicesRef.current, { asOf: addDaysYMD(der.periodStart, -1) });
            const disc = openingDiscrepancy({ statedOpening: der.openingBalance, recordedOpening: glCashAtPeriodStart });
            if (disc.mismatch) {
              setOpeningDiscrepancyFlag({ ...disc, periodStart: der.periodStart, accountCode: cashCode, accountName: acctName });
              logAudit("opening_balance_discrepancy", `Statement opening ${fmtSignedMoney(disc.statedOpening)} disagrees with recorded ${fmtSignedMoney(disc.recordedOpening)} for ${acctName} (off by ${fmtSignedMoney(disc.diff)})`, null, { accountCode: cashCode, diff: disc.diff });
              try { createNotification?.({ type: "reconciliation", title: "Opening balance doesn't match your statement", description: `Your books show a different starting balance than this statement for ${acctName}. Open Review to resolve.`, link_view: "review" }); } catch {}
            }
          }
        }
      } catch (e) { console.warn("[opening proposal] skipped:", e?.message || e); }
      // C185 — PERSIST the statement + lines (additive; review flow above is unchanged). Stamp the
      // durable statement/line ids onto the in-memory rows so booking can advance their status.
      try {
        const { statementId, lineIds, priorSameHashIds, priorSameHashRows } = await persistBankStatement({ account, file, rawTxns, lines: withIds, statedOpening, statedPeriodStart, statedPeriodEnd });
        if (statementId) {
          const stampedLines = withIds.map((t, i) => ({ ...t, _stmtId: statementId, _stmtLineId: lineIds[i] || t._stmtLineId }));
          if (!willRunPipeline) setBankTransactions(stampedLines);   // C195(5) — the pipeline path sets the FINAL set only
          // C186 — AUTOMATIC PIPELINE: when the statement is bound to an account, run the clean-path
          // pipeline (book confident lines → match/clear → reconcile; exceptions to the CPA Review
          // queue). The Bank Import review screen is then reduced to only the lines needing a human.
          // With NO bound account the manual flow is unchanged (drop-zone stash → next commit).
          if (account && account.id && lineIds.length) {
            try {
              const remaining = await runStatementPipeline(statementId, account, stampedLines);
              const rem = Array.isArray(remaining) ? remaining : [];
              setBankTransactions(rem);
              pipelineRan = true; pipelineRemaining = rem.length;   // C190 — keep the review screen up if lines remain
              pipelineTotal = stampedLines.length; pipelineBooked = stampedLines.length - rem.length;   // C198·2 — the owner sentence
            } catch (e) { console.warn("[pipeline] run skipped:", e?.message || e); }
          }
          // C193 — AFTER the run, retire prior same-content uploads for this account so their
          // already-resolved lines stop surfacing as zombie exception cards. Runs whether or not
          // the pipeline executed (an unbound-account upload still supersedes its own earlier copy).
          try {
            // C198·1 (j) — a re-upload onto a NON-COMPLETE prior may not silently no-op.
            // For each prior, planStatementReupload decides: 'complete' → supersede
            // exactly as C193 always did (unchanged); anything else → RE-EVALUATE it
            // against the CURRENT ledger first, so work finished since the last upload
            // is recognized instead of the stale 'attention' surviving to lie to Review.
            for (const prior of (priorSameHashRows || [])) {
              try {
                const { data: pls } = await supabase.from("bank_statement_lines")
                  .select("status").eq("company_id", currentCompany.id).eq("statement_id", prior.id);
                const plan = planStatementReupload({ existing: prior, lineStatuses: (pls || []).map(l => l.status) });
                if (plan.reevaluate) await reevaluateStatement(prior.id, { account });
              } catch (e) { console.warn("[bank_statements] prior re-evaluate skipped:", e?.message || e); }
            }
            await supersedePriorStatements(priorSameHashIds, statementId);
            if ((priorSameHashIds || []).length) await loadStatementExceptions(currentCompany.id);
          } catch (e) { console.warn("[bank_statements] supersede skipped:", e?.message || e); }
          // C198·1 (j) — and the row that now OWNS the story gets the same treatment:
          // re-derive its status from the ledger, and when every line is already in the
          // books, OFFER the reconciliation instead of demanding the file a third time.
          try {
            const after = await settleStatementAftermath(statementId, { account, intakeId: bankIntakeId });
            if (after.reconciled) pipelineAutoReconciled = true;
            if (after.alreadyReconciled) pipelineAlreadyReconciled = true;
          } catch (e) { console.warn("[bank_statements] re-evaluate skipped:", e?.message || e); }
        }
      } catch (e) { console.warn("[bank_statements] persist call skipped:", e?.message || e); }
      setBankProgress(100);
      // C198·2 (a4) — only mark HELD when something still needs a human; a fully-settled
      // statement was advanced to RECORDED by settleStatementAftermath above.
      if (!(pipelineRan && pipelineRemaining === 0)) markIntake(bankIntakeId, INTAKE_STATUS.HELD, { detail: `bank statement parsed — ${withIds.length} line(s) in Bank Import review` });
      // C198·2 (a1) — the OWNER hears what happened to their money, not how many rows a
      // review table holds. The reviewer keeps the workbench count they actually use.
      if (pipelineRan && !navSeat.isReviewerSeat) {
        showNotification(dropZoneOutcomeCopy({ total: pipelineTotal, booked: pipelineBooked, exceptions: pipelineRemaining, reconciled: pipelineAutoReconciled, alreadyReconciled: pipelineAlreadyReconciled }));
      } else {
        // C198·3b — count what actually happened: a re-upload whose every line was
        // already booked imported nothing, and must not claim otherwise.
        showNotification(bankImportToastCopy({
          total: withRules.length,
          alreadyBooked: withRules.filter(t => t.already_booked).length,
          needReview: withRules.filter(t => t.needs_review && !t.already_booked).length,
        }));
      }
      // The review screen derives each line's booking fate SYNCHRONOUSLY (BankView's deterministic
      // bankPreview useMemo) — no async preview call needed; the booking re-derives the same matches.
    } catch(e) {
      markIntake(bankIntakeId, INTAKE_STATUS.FAILED, { detail: `bank parse error: ${e?.message || e}` });   // non-terminal → surfaced
      showNotification("Failed to process bank statement. Please try again.", "error");
      console.error(e);
    }
    setBankProcessing(false);
    // C190 — do NOT unconditionally tear the review screen down. When the pipeline handed back
    // remaining lines (dead-zone/low-confidence exceptions needing a human), KEEP the review step
    // so the reduced table renders them (same table, suggested GL + Clears-A/P badge). Only reset
    // to the upload state when nothing remains (all handled) or the manual flow (no pipeline).
    setBankStep(pipelineRan && pipelineRemaining > 0 ? "review" : null);
    // C198·2b — hand the OUTCOME back to the caller. The universal drop stamped its queue
    // tile 'done' before this function had done anything (live: "Done" beside the old stash
    // sentence while the pipeline was still booking), because there was nothing to wait for
    // and nothing to write back. Now there is. undefined = the pipeline didn't run (manual
    // flow and every early return are unchanged).
    if (!pipelineRan) return undefined;
    return { ran: true, total: pipelineTotal, booked: pipelineBooked, exceptions: pipelineRemaining, reconciled: pipelineAutoReconciled, alreadyReconciled: pipelineAlreadyReconciled };
  };

  // Book the reviewed bank/card lines (O69 A/C/D). `account` is the source the statement
  // belongs to — its GL is the OFFSET for direct bookings (card → Cr 2200, bank → Cr 1000),
  // and its TYPE decides whether AP-matching even applies. Every direct-booked line is
  // PERSISTED through bookToDb (post_journal_entry) — never local state only — so nothing
  // can "succeed" in the UI without a real journal entry behind it.
  // C185 — after booking, link the statement's lines to the ledger entries they became, and stamp
  // journal_entries.bank_account_id. GL-TRUTH: match each still-pending line to a live cash-offset
  // entry by the SAME fingerprint markAlreadyBooked keys on (date | abs(amount) | direction), so a
  // clearing (settlement → 'matched') and a direct booking ('booked') are handled uniformly and this
  // runs AFTER the existing booking flow WITHOUT touching it (fully additive; best-effort).
  const linkStatementLinesAfterBooking = async (stmtId, account) => {
    if (!stmtId || !currentCompany?.id) return;
    try {
      const offsetCode = (account && account.gl_code) || rc("cash");
      const { data: pend } = await supabase.from("bank_statement_lines")
        .select("id, fingerprint, status").eq("company_id", currentCompany.id).eq("statement_id", stmtId).in("status", ["pending", "excepted"]);   // C195(1) — EXCEPTED lines resolved by manual booking were never picked up
      if (!pend || !pend.length) return;
      // Multiset of live ledger entries touching THIS account's cash/offset, keyed by fingerprint,
      // carrying the DB entry id + whether it's a settlement (→ 'matched') vs a direct book (→ 'booked').
      const seen = new Map();
      for (const inv of (invoicesRef.current || [])) {
        if (!inv || inv.status === "voided" || inv.status === "deleted" || inv.deleted_at) continue;
        if (String(inv.secondary_gl_code) !== String(offsetCode) && String(inv.gl_code) !== String(offsetCode)) continue;
        const k = bankTxnKey({ date: inv.date, amount: inv.amount, direction: bookedLineDirection(inv, offsetCode) });
        const jeId = inv.db_entry_id || String(inv.id).split("_")[0];   // the journal_entries.id (FK target)
        if (!seen.has(k)) seen.set(k, []);
        seen.get(k).push({ jeId, matched: isSettlementEntry(inv) });
      }
      const jeToStamp = new Set();
      for (const line of pend) {
        const bucket = seen.get(line.fingerprint);
        if (!bucket || !bucket.length) continue;   // no ledger entry yet → stays 'pending'
        const hit = bucket.shift();
        jeToStamp.add(String(hit.jeId));
        // C192 — checked writes (this sweep is exactly where a silent zero-row update would leave
        // a booked line looking 'pending' forever).
        await checkedRowUpdate({ supabase, table: "bank_statement_lines", id: line.id, companyId: currentCompany.id,
          patch: { status: hit.matched ? "matched" : "booked", journal_entry_id: String(hit.jeId), exception_reason: null },
          label: "sweep:link-line" });
      }
      if (account?.id && jeToStamp.size) {
        await checkedIdsUpdate({ supabase, table: "journal_entries", ids: [...jeToStamp], companyId: currentCompany.id,
          patch: { bank_account_id: account.id }, label: "sweep:stamp-bank-account" });
      }
    } catch (e) { console.warn("[bank_statements] link-after-booking skipped:", e?.message || e); }
  };

  // ── C186 — the automatic clean-path pipeline (§11 ★ North Star Phase 1-B) ──────────────────
  // Completes + inserts a reconciliation for the auto-run, reusing ReconView's write shape +
  // the supersede cleanup (C184). Statement-derived ending IS a verified balance (§11).
  const completePipelineReconciliation = async ({ account, periodStart, periodEnd, statementBalance, booksBalance, difference, outstandingBooks = [] }) => {
    const at = new Date().toISOString(); const uid = session?.user?.id || null;
    const payload = {
      company_id: currentCompany.id,
      account_id: (account && account.id) || null, account_name: (account && account.name) || "account",
      period_start: periodStart, period_end: periodEnd,
      statement_balance: statementBalance, books_balance: booksBalance, difference,
      statement_balance_verified: true, status: "complete",
      // C187 — carry the STILL-outstanding chain forward so an item outstanding across multiple
      // periods stays tracked until it clears.
      matched_transactions: [], unmatched_bank: [], unmatched_books: [], outstanding_books: outstandingBooks || [], added_during_reconciliation: [],
      completed_at: at, completed_by: uid,
    };
    let rid = null;
    try { const { data } = await supabase.from("reconciliations").insert(payload).select("id").single(); rid = data?.id; } catch (e) { console.warn("[pipeline] recon insert failed:", e?.message || e); return; }
    // Same supersede cleanup ReconView.completeMatch runs — no stranded open row for the period.
    try {
      const { data: openRows } = await supabase.from("reconciliations").select("id, status, account_id, account_name, period_start, period_end").eq("company_id", currentCompany.id).eq("status", "open");
      const stale = supersedableOpenReconciliations(openRows || [], { accountId: (account && account.id) || null, accountName: (account && account.name) || null, periodStart, periodEnd, keepId: rid });
      if (stale.length) await supabase.from("reconciliations").delete().in("id", stale.map(r => r.id)).eq("company_id", currentCompany.id);
    } catch { /* best-effort */ }
    logAudit("reconciliation_completed", `Auto-reconciled ${(account && account.name) || "account"} ${periodStart}→${periodEnd} via the statement pipeline — balance ${statementBalance}`, null, { account: (account && account.name), period: `${periodStart}→${periodEnd}`, balance: statementBalance, auto: true });
  };

  // ONE plain-language outcome line (Cardinal Principle — scrubbed by containsOwnerJargon). The
  // Feb-re-upload case (all already-booked, month attested) reads as calm confirmation, not activity.
  const pipelineOutcomeCopy = ({ plan, bookedCount, clearedCount = 0, exceptionCount, balanceDiscrepancy, reconciled }) => {
    const monthName = signedMonthLabel(plan.period) || "This";
    // C196(3) — WHOLE-STATEMENT first. The toast used to describe only what changed; the client
    // needs the denominator to see what the machine actually did ("21 · 16 handled · 5 need you").
    const totalLines = (plan.counts && plan.counts.total) || 0;
    const handledLines = Math.max(0, totalLines - (Number(exceptionCount) || 0));
    const wholeStatement = totalLines ? statementSummaryCopy({ total: totalLines, handled: handledLines, needInput: exceptionCount }) : "";
    // C187 — count cleared earlier checks distinctly and plainly (no GL jargon).
    const clearPhrase = clearedCount > 0 ? `, ${clearedCount} earlier ${clearedCount === 1 ? "check" : "checks"} cleared` : "";
    let msg;
    if (plan.reconciliation.conclusion === "already_matched") msg = "Everything on this statement was already in your books ✓";
    else if (exceptionCount === 0 && !balanceDiscrepancy) msg = `${monthName} statement handled — ${bookedCount} recorded${clearPhrase}${reconciled ? ", matched to your bank ✓" : " ✓"}`;
    else if (balanceDiscrepancy) msg = `${monthName} statement handled — ${bookedCount} recorded${clearPhrase}; the ending balance needs your accountant's look`;
    else msg = `${monthName} statement handled — ${bookedCount} recorded${clearPhrase}, ${exceptionCount} need${exceptionCount === 1 ? "s" : ""} your accountant's look`;
    // Cardinal-Principle safety net: if any GL/debit-credit jargon leaks, fall back to a plain line.
    if (containsOwnerJargon(msg)) msg = `${monthName} statement handled — we recorded what we could and flagged the rest for your accountant.`;
    // Lead with the whole-statement count (C196(3)) unless nothing happened at all.
    const composed = (wholeStatement && plan.reconciliation.conclusion !== "already_matched") ? `${wholeStatement} — ${msg}` : msg;
    // C198·3b — scan what the owner ACTUALLY reads. The check above ran on `msg` alone,
    // so anything the prepended whole-statement clause contributed went unscanned — a
    // guard applied to a fragment of the final string is a guard with a hole in it.
    return containsOwnerJargon(composed)
      ? `${monthName} statement handled — we recorded what we could and flagged the rest for your accountant.`
      : composed;
  };

  // The EXECUTOR. Runs after persistBankStatement when an account is bound (Bank Import path).
  // Reuses every existing path — buildBankLineEntry→bookToDb (book), matchableOpenItems→
  // runMatchingEngine→planBankImport→markBillPaid (match/clear), planPayrollBankLines (payroll),
  // reconBooksBalance/reconcileDifference/canCompleteReconciliation (reconcile). Returns the lines
  // still needing a human (exceptions), for the Bank Import review screen.
  const runStatementPipeline = async (statementId, account, parsedLines = []) => {
    if (!statementId || !currentCompany?.id || !account?.id) return parsedLines;
    const cashCode = (account.gl_code) || rc("cash");
    const offsetCode = cashCode, offsetName = getAccountByCode(offsetCode)?.name || rn("cash");
    // C193 — the C192 follow-up: the statement's own status write is checked too.
    const setStmt = async (patch) => await checkedRowUpdate({ supabase, table: "bank_statements", id: statementId, companyId: currentCompany.id, patch, label: "pipeline:statement-status" });
    // C192 — CHECKED write: a zero-row update (the C191 id-seam class) is now a LOUD, counted
    // failure instead of a silent no-op. Non-fatal by design — the run continues past a bad line.
    const setLine = async (lineId, patch, label = "pipeline:set-line") => {
      if (!lineId) return { ok: false, reason: "db_error" };
      return await checkedRowUpdate({ supabase, table: "bank_statement_lines", id: lineId, companyId: currentCompany.id, patch, label });
    };
    const lineDbId = (l) => String(l._stmtLineId || l.id);
    const excOf = (l, reason) => ({ lineId: lineDbId(l), reason, date: l.date || l.line_date, amount: Number(l.amount) || 0, vendor: l.vendor || null, gl_code: l.gl_code || l.ai_gl_code || null });

    resetWriteFailures();   // C192 — count checked-write failures for THIS run
    let stmt = null;
    try { const { data } = await supabase.from("bank_statements").select("*").eq("id", statementId).single(); stmt = data; } catch {}
    // C187 — prior periods' uncleared items that may CLEAR on this statement (never re-book them).
    const outstandingCandidates = priorOutstandingCandidates({ reconciliations, accountId: account.id, accountName: account.name, periodStart: stmt && stmt.period_start });
    const plan = planStatementPipeline({
      lines: parsedLines, invoices: invoicesRef.current, signoffs, reconciliations, outstandingCandidates,
      thresholds: { autoBookFloor: AI_CONFIDENCE_AUTO_BOOK }, statement: stmt || {}, cashCode,
    });
    await setStmt({ status: "processing" });

    const exceptions = [];
    // C191 — resolve a plan exception's lineId back to its LINE (keyed by BOTH identities: the DB
    // uuid and the parse-time local id) so persistence always targets the DB id. The planner now
    // emits the DB uuid, but this makes a future id regression harmless instead of silent: setLine
    // matches bank_statement_lines by uuid, so a local id would update ZERO rows and the exception
    // would vanish (the live bug). Covers ALL parsed lines — exception lines are not in toBook.
    const lineByAnyId = new Map();
    for (const l of parsedLines) {
      if (l._stmtLineId != null) lineByAnyId.set(String(l._stmtLineId), l);
      if (l.id != null) lineByAnyId.set(String(l.id), l);
    }
    const resolveLineDbId = (lineId) => { const l = lineByAnyId.get(String(lineId)); return l ? lineDbId(l) : lineId; };
    // Line-level exceptions from the plan (signed_period / low_confidence) — persist immediately.
    for (const e of plan.exceptions) { exceptions.push(e); await setLine(resolveLineDbId(e.lineId), { status: "excepted", exception_reason: e.reason }, "pipeline:except-line"); }

    // C187 — OUTSTANDING CLEARS: a line that matches a prior recon's outstanding item is that
    // entry CLEARING, not new activity. Stamp the EXISTING entry cleared + the statement line
    // 'matched'; BOOK NOTHING (no duplicate). The still-outstanding chain carries forward below.
    let clearedOutstandingCount = 0;
    for (const { line, candidate } of plan.clearsOutstanding) {
      await setLine(lineDbId(line), { status: "matched", journal_entry_id: candidate.jeId || null }, "pipeline:clear-outstanding-line");
      if (candidate.jeId) {
        // C192 — checked: stamping the EXISTING entry cleared is the whole point of the outstanding
        // clear; a zero-row update here would silently leave it uncleared.
        await checkedRowUpdate({ supabase, table: "journal_entries", id: candidate.jeId, companyId: currentCompany.id,
          patch: { cleared: true, cleared_at: (line.date || line.line_date) || null, bank_account_id: account.id },
          label: "pipeline:clear-outstanding" });
      }
      clearedOutstandingCount++;
    }

    // Book + match plan.toBook through the EXISTING paths (mirrors bookBankTransactions).
    const byLineId = new Map(plan.toBook.map((l) => [lineDbId(l), l]));
    const parsedTxns = plan.toBook.map((l) => ({ id: lineDbId(l), date: l.date || l.line_date, description: l.description, vendor: l.vendor, amount: l.amount, type: l.type || (l.direction === "in" ? "revenue" : "expense"), gl_code: l.gl_code || l.ai_gl_code, gl_name: l.gl_name || getAccountByCode(l.gl_code || l.ai_gl_code)?.name, confidence: l.confidence != null ? l.confidence : l.ai_confidence, reasoning: l.reasoning, rule_applied: l.rule_applied }));
    let bookedCount = 0;

    const directBook = async (line, txn) => {
      const entry = { id: txn.id, booked_at: new Date().toISOString(), ...buildBankLineEntry(txn, { offsetCode, offsetName }) };
      setInvoices((prev) => [entry, ...prev]);
      const jeId = await bookToDb(entry);
      if (jeId) {
        bookedCount++;
        await setLine(lineDbId(line), { status: "booked", journal_entry_id: String(jeId) }, "pipeline:book-line");
        // C192 — checked: the bank_account_id linkage silently failing is what leaves booked
        // entries unattributable to their account (the §11 missing-linkage class).
        await checkedRowUpdate({ supabase, table: "journal_entries", id: jeId, companyId: currentCompany.id,
          patch: { bank_account_id: account.id }, label: "pipeline:stamp-bank-account" });
      } else {
        exceptions.push(excOf(line, "book_failed"));
        await setLine(lineDbId(line), { status: "excepted", exception_reason: "book_failed" }, "pipeline:book-failed");
      }
    };

    if (!shouldRunApMatching(account)) {
      // Credit card — direct-book every auto-safe line (no AP matching).
      for (const txn of parsedTxns) { const line = byLineId.get(txn.id); if (line) await directBook(line, txn); }
    } else {
      const openItems = matchableOpenItems(invoicesRef.current || invoices, { arCode: rc("accounts_receivable"), apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities") });
      const { autoCleared, queue } = await runMatchingEngine(parsedTxns, openItems);
      const plan2 = planBankImport({ parsedTxns, autoCleared, queue, openItems, codes: { apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities"), arCode: rc("accounts_receivable"), cashCode: offsetCode, cashName: offsetName } });
      for (const c of plan2.clears) {
        const ok = await markBillPaid(c.invoiceId, { side: c.side, method: "bank_transfer", paidDate: c.date || null });
        if (ok && c.bankId != null) await setLine(c.bankId, { status: "matched" });   // clearing → statement line 'matched'
      }
      for (const m of plan2.review) {
        const bid = m.bank_txn?.id ?? m.bank_txn_id;
        const line = byLineId.get(String(bid));
        if (line) { exceptions.push(excOf(line, "unmatched")); await setLine(lineDbId(line), { status: "excepted", exception_reason: "unmatched" }); }
      }
      const pr = planPayrollBankLines(plan2.standalone, invoicesRef.current || invoices);
      for (const txn of pr.rest) { const line = byLineId.get(String(txn.id)); if (line) await directBook(line, txn); }
      for (const t of pr.matched) { const line = byLineId.get(String(t.line?.id ?? t.line)); if (line) await setLine(lineDbId(line), { status: "matched" }); }   // register already booked the cash — no double-count
      for (const t of pr.incomplete) { const line = byLineId.get(String(t.id)); if (line) { exceptions.push(excOf(line, "unmatched")); await setLine(lineDbId(line), { status: "excepted", exception_reason: "unmatched" }); } }
    }

    try { await loadAllData(); } catch {}

    // ── Reconciliation (only when the plan says to attempt; NEVER a second recon for an attested month). ──
    let balanceDiscrepancy = null, reconciled = false;
    if (plan.reconciliation.attempt && stmt) {
      const booksBalance = reconBooksBalance(invoicesRef.current, [cashCode], { asOf: stmt.period_end });
      const stmtEnding = stmt.stated_ending_balance;
      // C187 — the STILL-outstanding chain (prior items not yet cleared) nets the difference the
      // same way ReconView does, instead of a hardcoded 0.
      const outstandingSigned = stillOutstandingSigned(plan.stillOutstanding);
      const difference = reconcileDifference({ statementBalance: stmtEnding, booksBalance, outstandingSigned, unmatchedBankSigned: 0 });
      if (exceptions.length === 0 && canCompleteReconciliation({ statementBalance: String(stmtEnding == null ? "" : stmtEnding), difference })) {
        await completePipelineReconciliation({ account, periodStart: stmt.period_start, periodEnd: stmt.period_end, statementBalance: stmtEnding, booksBalance, difference, outstandingBooks: candidatesToOutstandingBooks(plan.stillOutstanding) });
        reconciled = true;
      } else if (Math.abs(Number(difference) || 0) >= 0.005) {
        balanceDiscrepancy = { diff: difference };   // statement-level exception; do NOT complete
        await setStmt({ status: "attention" });
      }
    }

    const finalStatus = pipelineStatementStatus({ exceptionCount: exceptions.length, balanceDiscrepancy });
    await setStmt({ status: finalStatus });
    try { await loadStatementExceptions(currentCompany.id); } catch {}
    // C192 — if any checked write failed during this run, SAY SO (plain language) and record the
    // failure detail in the audit log. Silent partial persistence is what this whole commit ends.
    const wf = getWriteFailures();
    if (wf.count > 0) {
      logAudit("pipeline_write_failures", `${wf.count} checked write${wf.count === 1 ? "" : "s"} failed during the statement pipeline`, null, { statement_id: statementId, count: wf.count, records: wf.records });
    }
    showNotification(
      pipelineOutcomeCopy({ plan, bookedCount, clearedCount: clearedOutstandingCount, exceptionCount: exceptions.length, balanceDiscrepancy, reconciled }) + writeFailureSentence(wf.count),
      (finalStatus === "complete" && wf.count === 0) ? "success" : "info"
    );

    // Only still-pending/excepted lines remain for the Bank Import review screen (item 4).
    // C191 — resolve through the SAME id map: this set is compared against lineDbId(l) below, so a
    // non-DB exception id would filter every excepted line out of `remaining` and the review screen
    // would stay empty (the second half of the live bug — invisible in the DB AND in the UI).
    const exceptionIds = new Set(exceptions.map((e) => String(resolveLineDbId(e.lineId))));
    return parsedLines.filter((l) => exceptionIds.has(lineDbId(l))).map((l) => ({ ...l, needs_review: true, checked: false }));
  };

  const bookBankTransactions = async (account = null) => {
    // P0 (bank-import N× duplication): hard re-entrancy guard. Without it, a second
    // invocation while the awaits are in flight (double-click, an effect re-firing, a
    // re-render re-triggering the Book button) re-books the SAME selected set — each line
    // posting once per invocation. The guard holds for the entire async run and the review
    // rows are only cleared on success, so each selected line books exactly once.
    if (bankBookingRef.current) { showNotification("Still booking the previous batch — one moment…", "info"); return; }
    bankBookingRef.current = true;
    setBankProcessing(true);
    try {
    const toBook = bankTransactions.filter(t => t.checked);
    if (toBook.length === 0) { showNotification("Select at least one transaction to book.", "error"); return; }
    // C185 — the persisted statement these lines belong to (captured BEFORE the review rows are
    // cleared on success), so the post-booking sweep can advance its lines' status.
    const stmtId = (bankTransactions.find(t => t._stmtId) || {})._stmtId || null;

    // O69-D / O57: offset by the account this statement belongs to, not hardcoded Cash.
    const offsetCode = (account && account.gl_code) || rc("cash");
    const offsetName = (account && account.gl_code && getAccountByCode(offsetCode)?.name) || rn("cash");
    const runMatching = shouldRunApMatching(account);   // false for credit_card (O69-C)

    // Each checked line → a real, balanced direct-book via the shared builder (direction
    // by type, offset by account): expense → Dr Expense / Cr <offset>; revenue → reverse.
    const buildEntry = (t) => ({
      id: t.id, booked_at: new Date().toISOString(),
      ...buildBankLineEntry(
        // carry `reasoning` (the categorizer's GL-choice rationale) so the booked entry's
        // detail shows real classification reasoning, not the "imported from..." provenance.
        { id: t.id, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type, gl_code: t.gl_code, gl_name: t.gl_name, confidence: t.confidence, reasoning: t.reasoning, rule_applied: t.rule_applied },
        { offsetCode, offsetName }
      ),
    });
    const persistDirect = async (lines) => {
      let booked = 0, failed = 0;
      for (const t of lines) {
        const entry = buildEntry(t);
        setInvoices(prev => [entry, ...prev]);            // optimistic add
        const jeId = await bookToDb(entry);                // persists, or rolls the add back on fail
        if (jeId) booked++; else failed++;
      }
      return { booked, failed };
    };

    // ── CREDIT CARD (O69-C): a card charge CREATES a liability (Dr Expense / Cr 2200) —
    // it does NOT clear an open payable. Skip AP-matching entirely; direct-book + persist
    // every selected charge. (The rare "paid a vendor bill by card" case is an explicit
    // opt-in deferred under O69 — it would post Dr A/P / Cr 2200, not Cr Cash.) ──────────
    if (!runMatching) {
      const { booked, failed } = await persistDirect(toBook);
      setBankTransactions(prev => prev.filter(t => !t.checked));
      setBankFileName("");
      if (booked > 0) checkWatchTriggers(toBook.map(buildEntry), unknownDocs);
      try { await loadAllData(); } catch {}
      await linkStatementLinesAfterBooking(stmtId, account);   // C185 — advance statement-line status + stamp bank_account_id
      try { await loadStatementExceptions(currentCompany.id); } catch {}   // C195(1) — resolved lines must leave the Review queue immediately
      // C198·1 (i) + C198·2 (a2/a4) — advance the statement, then either reconcile it
      // automatically (verified tie) or offer the session; advance the intake row too.
      try { await settleStatementAftermath(stmtId, { account }); } catch {}
      showNotification(
        bookingToastCopy({ booked, failed }),                              // C195(6) — count what actually happened
        failed === 0 ? "success" : "error"
      );
      return;
    }

    // ── BANK ACCOUNT: a bank debit CAN legitimately clear an open payable, so keep
    // AP-matching. Use the proven planBankImport split so a matched line posts ONLY its
    // clearing (no double-count) and genuinely-new lines are direct-booked + PERSISTED. ──
    const parsedTxns = toBook.map(t => ({ id: t.id, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type, gl_code: t.gl_code, gl_name: t.gl_name, confidence: t.confidence, reasoning: t.reasoning, rule_applied: t.rule_applied }));
    // Candidate open items from GL TRUTH (a live clearing JE links a settled bill), NOT a stale
    // payment_status flag. Built here, BEFORE persistDirect books anything → pristine pre-import set.
    // The review screen previews the SAME deterministic matches (BankView's bankPreview), so what
    // shows is what books for every confident A/R/A/P clearing.
    const openItems = matchableOpenItems(invoicesRef.current || invoices, {
      arCode: rc("accounts_receivable"), apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities"),
    });
    const { autoCleared, queue, deterministicCount = 0, llmCount = 0 } = await runMatchingEngine(parsedTxns, openItems);
    const plan = planBankImport({
      parsedTxns, autoCleared, queue, openItems,
      codes: { apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities"), arCode: rc("accounts_receivable"), cashCode: offsetCode, cashName: offsetName },
    });

    // Post clearings — record success only when the JE actually committed (O69-B).
    let clearedOk = 0, clearFailed = 0;
    for (const c of plan.clears) {
      const ok = await markBillPaid(c.invoiceId, { side: c.side, method: "bank_transfer", paidDate: c.date || null });
      if (ok) clearedOk++; else clearFailed++;
    }
    // O72: before direct-booking the "new" lines, pull out payroll NET-pay lines. Ones that
    // MATCH a booked payroll register run are SUPPRESSED (the register already recorded that
    // cash disbursement — booking again would double-count salaries). Ones with NO register are
    // booked at net but FLAGGED incomplete (low confidence + note → O49 review), never silently
    // treated as full salary.
    const pr = planPayrollBankLines(plan.standalone, invoicesRef.current || invoices);
    // Genuinely-new (unmatched) NON-payroll lines → direct-book + PERSIST (O69-A).
    const { booked, failed: bookFailed } = await persistDirect(pr.rest);
    // Payroll-with-no-register → book net + flag incomplete.
    let payrollIncompleteBooked = 0, payrollIncompleteFailed = 0;
    for (const t of pr.incomplete) {
      const entry = buildEntry(flagIncompletePayroll(t));
      setInvoices(prev => [entry, ...prev]);
      const jeId = await bookToDb(entry);
      if (jeId) payrollIncompleteBooked++; else payrollIncompleteFailed++;
    }
    const payrollMatched = pr.matched.length;   // suppressed — reconciled to a register, no double-count
    if (payrollMatched > 0) logAudit("payroll_bank_matched", `${payrollMatched} payroll net-pay bank line(s) matched an uploaded register — not re-booked (no double-count)`);
    // Low-confidence / unclearable → manual review (carry the offset for a later dismiss).
    if (plan.review.length > 0) setMatchQueue(prev => [...plan.review.map(m => ({ ...m, importOffsetCode: offsetCode, importOffsetName: offsetName })), ...prev]);

    setBankTransactions(prev => prev.filter(t => !t.checked));
    setBankFileName("");
    if (booked > 0) checkWatchTriggers(pr.rest.map(buildEntry), unknownDocs);
    try { await loadAllData(); } catch {}
    await linkStatementLinesAfterBooking(stmtId, account);   // C185 — advance statement-line status (booked/matched) + stamp bank_account_id
    try { await loadStatementExceptions(currentCompany.id); } catch {}   // C195(1) — resolved lines must leave the Review queue immediately
    // C198·1 (i) + C198·2 (a2/a4) — same on the A/P-matching branch.
    try { await settleStatementAftermath(stmtId, { account }); } catch {}
    const failN = clearFailed + bookFailed + payrollIncompleteFailed;
    const totalBooked = booked + payrollIncompleteBooked;
    // Surface the matcher breakdown so the deterministic vs LLM contribution is visible WITHOUT
    // the console (deterministic should carry the exact-match cases every time — if this shows
    // "deterministic: 0" on an exact-name+amount import, the pre-matcher isn't seeing the data).
    // C195(6) — TRUTHFUL toast: lead with what was actually recorded in THIS action; the matcher
    // breakdown appears only when matching happened (the live "0 / 0 after booking 5" bug).
    showNotification(
      bookingToastCopy({ cleared: clearedOk, booked: totalBooked, payrollMatched, payrollFlagged: payrollIncompleteBooked,
        needReview: plan.review.length, failed: failN, deterministic: deterministicCount, llm: llmCount }),
      failN ? "error" : "success"
    );
    if (plan.review.length > 0) setView("matching");
    } finally {
      bankBookingRef.current = false;
      setBankProcessing(false);
    }
  };

  // ── CONTRACT HANDLER ─────────────────────────────────────────────────────────
  const CONTRACT_TYPES = {
    loan: { label:"Loan / Debt", color:"var(--sc-error)", icon:"🏦" },
    revenue_contract: { label:"Revenue Contract", color:"var(--sc-success)", icon:"📈" },
    lease: { label:"Lease", color:"var(--sc-warning)", icon:"🏢" },
    subscription_paid: { label:"Subscription (Paid)", color:"var(--sc-gold)", icon:"💳" },
    subscription_received: { label:"Subscription (Received)", color:"var(--sc-gold)", icon:"📦" },
    equipment_financing: { label:"Equipment Financing", color:"#EC4899", icon:"⚙️" },
    service_agreement: { label:"Service Agreement / Retainer", color:"#14B8A6", icon:"🤝" },
  };

  const handleContractFile = async (file) => {
    if (!file) return;
    const v = validateUpload(file, "document");   // size + type guard (CR-34)
    if (!v.ok) { showNotification(v.error, "error"); return; }
    if (!(await guardImport(file, "contract"))) return;   // misroute guard
    const ext = "." + file.name.split(".").pop().toLowerCase();   // used below for mediaType
    // O60 Phase 2: log the contract's ARRIVAL to the intake ledger.
    const contractIntakeId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
    logIntake(contractIntakeId, file, "contract");
    setContractProcessing(true);
    try {
      const base64 = await fileToBase64(file);
      const mediaType = ext===".pdf" ? "application/pdf" : `image/${ext.slice(1)}`;

      // ── CALL 1: Extract contract terms + Day 1 entry only ────────────────
      const res1 = await fetch(AI_PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          profile: "extract-contract",   // model/max_tokens/system server-owned; chart via untrusted slot
          slots: { CHART: CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n") },
          messages:[{role:"user", content:[
            {type: ext===".pdf"?"document":"image", source:{type:"base64", media_type:mediaType, data:base64}},
            {type:"text", text:"Extract all contract terms and generate the Day 1 journal entry only."}
          ]}]
        })
      });

      const data1 = await okAIResponse(res1);
      if (!data1.content) throw new Error(`API error: ${JSON.stringify(data1)}`);
      const raw1 = (data1.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim();
      const contract = JSON.parse(raw1);

      // Calculate lease term from dates if AI didn't return it
      let leaseTermMonths = contract.lease_term_months || 0;
      if (!leaseTermMonths && contract.start_date && contract.end_date) {
        const start = new Date(contract.start_date);
        const end = new Date(contract.end_date);
        leaseTermMonths = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44));
      }
      

      // ── GENERATE MONTHLY ENTRIES IN JS (no second API call needed) ────────
      const monthlyEntries = [];

      if (contract.contract_type === "lease") {
        const ibr = contract.discount_rate_used || DEFAULT_IBR;
        const monthlyPayment = parseFloat(contract.payment_amount) || 0;
        // Ensure we have term months — calculate from dates if missing
        if (!leaseTermMonths && contract.start_date && contract.end_date) {
          leaseTermMonths = Math.round((new Date(contract.end_date) - new Date(contract.start_date)) / (1000*60*60*24*30.44));
          contract.lease_term_months = leaseTermMonths;
        }
        

        // ALWAYS compute with JS — never use AI arithmetic
        const asc842 = (leaseTermMonths > 0 && monthlyPayment > 0)
          ? calcASC842(monthlyPayment, leaseTermMonths, ibr)
          : null;

        if (asc842) {
          
          // Override everything the AI calculated
          contract.rou_asset_value = asc842.rouAsset;
          contract.lease_liability_current = asc842.currentPortion;
          contract.lease_liability_noncurrent = asc842.nonCurrentPortion;
          contract.monthly_straight_line_expense = asc842.straightLineMonthly;
        } else {
          console.warn(`calcASC842 skipped: term=${leaseTermMonths}, payment=${monthlyPayment}`);
        }

        // ALWAYS patch Day 1 entry with correct computed values
        if (asc842) {
          if (contract.journal_entries?.[0]) {
            contract.journal_entries[0].lines = [
              { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: asc842.rouAsset, credit: 0 },
              { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: asc842.currentPortion },
              { account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: 0, credit: asc842.nonCurrentPortion },
            ];
            contract.journal_entries[0].memo = `ASC 842-20-30: PV of ${leaseTermMonths} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR (monthly compounding). Current = principal reduction months 1-12 ($${asc842.currentPortion.toLocaleString()}), NOT gross cash.`;
          } else {
            contract.journal_entries = [{
              date: contract.start_date || todayLocal(),
              description: "Lease commencement — ASC 842 initial recognition",
              memo: `ASC 842-20-30: PV of ${leaseTermMonths} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR`,
              lines: [
                { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: asc842.rouAsset, credit: 0 },
                { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: 0, credit: asc842.currentPortion },
                { account_code:rc("lease_liability_noncurrent"), account_name:rn("lease_liability_noncurrent"), debit: 0, credit: asc842.nonCurrentPortion },
              ]
            }];
          }
        }

        // Use pre-computed amortization schedule from calcASC842
        if (asc842) asc842.schedule.forEach((row, i) => {
          // Local-safe schedule date (CR-4/CR-5) — month-add on the YMD string, not UTC toISOString.
          const dateStr = addMonthsClampedYMD(contract.start_date || todayLocal(), i + 1);
          const principal = Math.round(row.principal * 100) / 100;
          const interest = Math.round(row.interest * 100) / 100;

          if (contract.lease_type === "operating" || !contract.lease_type) {
            // Entry A: P&L — Operating Lease Expense (straight-line = cash payment for level payments)
            monthlyEntries.push({
              date: dateStr,
              description: `Operating lease payment — Month ${i + 1}`,
              memo: `ASC 842-20: SL expense $${monthlyPayment.toFixed(2)}. Interest component $${interest.toFixed(2)}, principal $${principal.toFixed(2)}. Liability balance after: $${Math.round(row.balance * 100) / 100}`,
              lines: [
                { account_code:rc("operating_lease_expense"), account_name:rn("operating_lease_expense"), debit: parseFloat(monthlyPayment.toFixed(2)), credit: 0 },
                { account_code:rc("cash"), account_name:rn("cash"), debit: 0, credit: parseFloat(monthlyPayment.toFixed(2)) },
              ]
            });
            // Entry B: Balance sheet — non-cash liability reduction and ROU amortization
            if (principal > 0.01) {
              monthlyEntries.push({
                date: dateStr,
                description: `Lease liability & ROU amortization — Month ${i + 1}`,
                memo: `ASC 842-20: Non-cash. Principal reduction of liability = $${principal.toFixed(2)}. ROU asset decreases by same amount.`,
                lines: [
                  { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: principal, credit: 0 },
                  { account_code:rc("rou_asset"), account_name:rn("rou_asset"), debit: 0, credit: principal },
                ]
              });
            }
          } else {
            // Finance lease
            const rouAmort = Math.round(asc842.rouAsset / leaseTermMonths * 100) / 100;
            monthlyEntries.push({
              date: dateStr,
              description: `Finance lease payment — Month ${i + 1}`,
              memo: `ASC 842-20: Interest $${interest.toFixed(2)} (liability × monthly rate), principal $${principal.toFixed(2)}`,
              lines: [
                { account_code:rc("interest_expense"), account_name:rn("interest_expense"), debit: interest, credit: 0 },
                { account_code:rc("lease_liability_current"), account_name:rn("lease_liability_current"), debit: principal, credit: 0 },
                { account_code:rc("cash"), account_name:rn("cash"), debit: 0, credit: parseFloat(monthlyPayment.toFixed(2)) },
              ]
            });
            monthlyEntries.push({
              date: dateStr,
              description: `ROU asset amortization — Month ${i + 1}`,
              memo: `ASC 842-20: Finance lease — straight-line amortization of ROU asset`,
              lines: [
                { account_code:rc("rou_amortization"), account_name:rn("rou_amortization"), debit: rouAmort, credit: 0 },
                { account_code:rc("accumulated_amortization_rou"), account_name:rn("accumulated_amortization_rou"), debit: 0, credit: rouAmort },
              ]
            });
          }
        });
      } else if (contract.contract_type !== "lease" && contract.start_date && contract.end_date && contract.payment_amount) {
        // For non-lease: generate simple monthly entries in JS too
        const start = new Date(contract.start_date);
        const end = new Date(contract.end_date);
        const months = Math.round((end - start) / (1000 * 60 * 60 * 24 * 30.44));
        for (let i = 0; i < Math.min(months, 60); i++) {
          // Local-safe schedule date (CR-4/CR-5) — month-add on the YMD string, not UTC toISOString.
          const dateStr = addMonthsClampedYMD(contract.start_date || todayLocal(), i + 1);
          if (contract.contract_type === "subscription_paid") {
            monthlyEntries.push({ date: dateStr, description: `Subscription expense — Month ${i+1}`, memo: "Monthly amortization of prepaid",
              lines: [{ account_code:rc("technology_software"), account_name:rn("technology_software"), debit:parseFloat(contract.payment_amount), credit:0 }, { account_code:rc("prepaid_expenses"), account_name:rn("prepaid_expenses"), debit:0, credit:parseFloat(contract.payment_amount) }]});
          } else if (contract.contract_type === "revenue_contract") {
            monthlyEntries.push({ date: dateStr, description: `Revenue recognition — Month ${i+1}`, memo: "ASC 606: Performance obligation satisfied",
              lines: [{ account_code:rc("deferred_revenue"), account_name:rn("deferred_revenue"), debit:parseFloat(contract.payment_amount), credit:0 }, { account_code:rc("service_revenue"), account_name:rn("service_revenue"), debit:0, credit:parseFloat(contract.payment_amount) }]});
          }
        }
      }

      // Combine Day 1 + monthly entries
      const allEntries = [...(contract.journal_entries||[]), ...monthlyEntries];
      contract.journal_entries = allEntries;

      const saved = {
        ...contract,
        id: Date.now(),
        file_name: file.name,
        uploaded_at: new Date().toISOString(),
        posted_entries: [],
      };
      setContracts(prev => [saved, ...prev]);
      setSelectedContract(saved);
      setContractView("detail");
      persistContract(saved);
      markIntake(contractIntakeId, INTAKE_STATUS.HELD, { detail: "contract imported — review/post in Contracts" });   // terminal: accounted for
      showNotification(`Contract analyzed — ${contract.journal_entries?.length||0} journal entries generated ✓`);
    } catch(e) {
      const msg = e?.message || String(e);
      markIntake(contractIntakeId, INTAKE_STATUS.FAILED, { detail: `contract analysis error: ${msg}` });   // non-terminal → surfaced
      showNotification(`Contract analysis failed: ${msg}`, "error");
      console.error("Contract error:", e);
    }
    setContractProcessing(false);
  };

  // Build the canonical ONE-entry-N-lines payload for a contract journal entry.
  // Every line (ROU asset, lease liabilities, deferred revenue, prepaid, revenue,
  // expense) goes into a SINGLE balanced entry — NOT one 2-line JE per line, which
  // double-counted (revenue/expense landing on both a primary and an offset leg).
  const buildContractEntry = (contract, entry) => buildJournalEntry({
    lines: (entry.lines || []).map(l => ({
      code: l.account_code, name: l.account_name,
      debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
    })),
    date: entry.date,
    description: `${contract.counterparty || ""} – ${entry.description}${entry.memo ? ` (${entry.memo})` : ""}`,
    source: "contract",
    meta: { ai_reasoning: `Posted from contract (GAAP/ASC 842): ${contract.description || ""}`, contract_id: contract.id },
  });

  const postContractEntry = async (contract, entryIdx) => {
    const entry = contract.journal_entries?.[entryIdx];
    if (!entry) return;
    const je = buildContractEntry(contract, entry);
    if (!je.balanced) { showNotification("Contract entry doesn't balance — not posted.", "error"); return; }
    const jeId = await persistMultiLineEntry(je);
    if (!jeId) return;   // failure already surfaced by persistMultiLineEntry

    const updatedContract = {...contract, posted_entries: [...(contract.posted_entries||[]), entryIdx]};
    setContracts(prev => prev.map(c => c.id===contract.id ? updatedContract : c));
    setSelectedContract(prev => prev ? ({...prev, posted_entries: [...(prev.posted_entries||[]), entryIdx]}) : prev);
    persistContract(updatedContract);
    // Reflect the single posted multi-line entry (no per-line expansion / double count).
    try { await loadAllData(); } catch {}
    showNotification(`Journal entry posted to ledger ✓`);
  };

  const postAllContractEntries = async (contract) => {
    const unpostedIndexes = (contract.journal_entries || [])
      .map((_, i) => i)
      .filter(i => !(contract.posted_entries || []).includes(i));
    if (unpostedIndexes.length === 0) return;

    const posted = [];
    for (const idx of unpostedIndexes) {
      const entry = contract.journal_entries[idx];
      if (!entry) continue;
      const je = buildContractEntry(contract, entry);
      if (!je.balanced) { showNotification(`Entry ${idx + 1} doesn't balance — skipped.`, "error"); continue; }
      const jeId = await persistMultiLineEntry(je);
      if (jeId) posted.push(idx);
    }
    if (posted.length === 0) return;

    const allPosted = [...(contract.posted_entries || []), ...posted];
    const updatedContract = {...contract, posted_entries: allPosted};
    setContracts(prev => prev.map(c => c.id === contract.id ? updatedContract : c));
    setSelectedContract(prev => prev ? updatedContract : prev);
    persistContract(updatedContract);
    try { await loadAllData(); } catch {}
    showNotification(`✓ Posted ${posted.length} entr${posted.length === 1 ? "y" : "ies"} to ledger`);
  };

  // ── MATCHING ENGINE ───────────────────────────────────────────────────────────

  // Run matching engine against a set of new bank transactions
  const runMatchingEngine = async (newBankTxns, currentInvoices) => {
    if (!newBankTxns?.length || !currentInvoices?.length) return { autoCleared: [], queue: [], deterministicCount: 0, llmCount: 0 };

    // ── 1) DETERMINISTIC PASS — runs FIRST, before any early return, independent of the LLM.
    // Pure, no AI: exact amount + normalized name, side keyed on the A/R/A/P OFFSET code (not a
    // `type` string). Its matches are AUTHORITATIVE and survive to booking regardless of what
    // the LLM does. (The wiring bug this fixes: the old `if (openPayables==0 && openReceivables
    // ==0) return []` guard sat BEFORE this and was computed from a `type` string — when `type`
    // drifted, both were empty and the ENTIRE engine returned [] before the deterministic matcher
    // ran, so the flaky LLM was the only matcher → nondeterministic 0/1-of-3 on identical input.)
    const arCodeForMatch = rc("accounts_receivable");
    const apCodeForMatch = rc("accounts_payable");
    const accruedForMatch = rc("accrued_liabilities");
    // Candidate universe = ONLY genuinely open items (no settlement linked). Filtering HERE (not
    // just at the call site) makes BOTH callers safe: one passes matchableOpenItems already
    // (idempotent), the other passes the raw ledger. Without it, settled clearing entries (Dr A/P
    // / Cr Cash) carry an A/P leg and get proposed as matches — the O83 Feb cross-month wrong
    // matches (Feb debits ↔ January's already-settled payments).
    const openUniverse = matchableOpenItems(currentInvoices, { arCode: arCodeForMatch, apCode: apCodeForMatch, accruedCode: accruedForMatch });
    const matchTrace = [];
    const deterministic = autoMatchBankLines(newBankTxns, openUniverse, { arCode: arCodeForMatch, apCode: apCodeForMatch, trace: matchTrace });
    try {
      console.info(`[bank-match] DETERMINISTIC matched: ${deterministic.length}/${newBankTxns.length}`, deterministic.map(m => ({ bank: m.bank_txn_id, inv: m.invoice_ids, side: m.match_type })));
      console.info("[bank-match] candidates:", currentInvoices.filter(i => (arCodeForMatch && (String(i.secondary_gl_code)===String(arCodeForMatch)||String(i.gl_code)===String(arCodeForMatch))) || (apCodeForMatch && (String(i.secondary_gl_code)===String(apCodeForMatch)||String(i.gl_code)===String(apCodeForMatch)))).map(i => ({ id: i.id, vendor: i.vendor, amount: i.amount, type: i.type, gl: i.gl_code, off: i.secondary_gl_code })));
      console.info("[bank-match] bank lines:", newBankTxns.map(t => ({ id: t.id, vendor: t.vendor, amount: t.amount, type: t.type })));
      for (const r of matchTrace) console.info(`  · ${r.matched ? "✓ MATCHED" : "✗ no match"} — ${r.vendor} $${r.amount}${r.matched ? ` → ${r.invoiceId} (${r.side})` : ` — ${r.reason}`}`);
    } catch {}

    const handledBankIds = new Set(deterministic.map(m => String(m.bank_txn_id)));
    const handledInvIds  = new Set(deterministic.flatMap(m => (m.invoice_ids || []).map(String)));
    const remainingTxns  = newBankTxns.filter(t => !handledBankIds.has(String(t.id)));
    // Side split for the LLM of ONLY what deterministic didn't take — from the OPEN universe
    // (settled clearing entries are already excluded), split by the A/P vs A/R OFFSET leg (not a
    // `type` string): payables carry the A/P (or accrued) leg, receivables the A/R leg.
    const hasLeg = (i, code) => code != null && (String(i.gl_code) === String(code) || String(i.secondary_gl_code) === String(code));
    const remainPayables    = openUniverse.filter(inv => (hasLeg(inv, apCodeForMatch) || hasLeg(inv, accruedForMatch)) && !handledInvIds.has(String(inv.id)));
    const remainReceivables = openUniverse.filter(inv => hasLeg(inv, arCodeForMatch) && !handledInvIds.has(String(inv.id)));

    // 2) Nothing left for the LLM → return the DETERMINISTIC set (never []).
    if (remainingTxns.length === 0 || (remainPayables.length === 0 && remainReceivables.length === 0)) {
      return { autoCleared: deterministic, queue: [], deterministicCount: deterministic.length, llmCount: 0 };
    }

    setMatchProcessing(true);
    try {
      const res = await fetch(AI_PROXY_URL, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          profile: "match-transactions",   // model/max_tokens/system server-owned; match data via untrusted slot
          slots: { MATCH_DATA:
`BANK TRANSACTIONS (new):
${JSON.stringify(remainingTxns.map(t => ({ id: t.id, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type })))}

OPEN PAYABLES (unpaid expenses):
${JSON.stringify(remainPayables.map(i => ({ id: i.id, vendor: i.vendor, description: i.description, amount: i.amount, date: i.date, gl_code: i.gl_code, gl_name: i.gl_name, balance_remaining: i.balance_remaining || i.amount })))}

OPEN RECEIVABLES (uncollected revenue):
${JSON.stringify(remainReceivables.map(i => ({ id: i.id, vendor: i.vendor, description: i.description, amount: i.amount, date: i.date, gl_code: i.gl_code, gl_name: i.gl_name, balance_remaining: i.balance_remaining || i.amount })))}` },
          messages: [{ role: "user", content: "Match the bank transactions against the open payables and receivables provided in the instructions." }]
        })
      });

      const data = await okAIResponse(res);
      const result = JSON.parse((data.content?.find(b => b.type === "text")?.text || "{}").replace(/```json|```/g, "").trim());
      const matches = result.matches || [];

      const autoCleared = [...deterministic];   // deterministic matches always stand
      const queue = [];

      for (const match of matches) {
        if (match.match_type === "no_match" || !match.invoice_ids?.length) continue;
        // Never let the LLM re-match a line or open item the deterministic pass already took.
        if (handledBankIds.has(String(match.bank_txn_id))) continue;
        match.invoice_ids = match.invoice_ids.filter(id => !handledInvIds.has(String(id)));
        if (!match.invoice_ids.length) continue;

        // Resolve the counterpart open items to DISPLAY (string-normalized against the OPEN
        // universe). If none resolve, the proposal has no renderable counterpart — REFUSE it
        // rather than ask the user to confirm a match against an invisible/settled entity (O83
        // Feb: a 99% exact-amount proposal rendered an empty "MATCHING AGAINST" panel).
        const matched_invoices = resolveMatchedInvoices(match.invoice_ids, openUniverse);
        if (!matched_invoices.length) {
          try { console.warn("[bank-match] dropped proposal — counterpart not in the open universe (unrenderable):", match.bank_txn_id, match.invoice_ids); } catch {}
          continue;
        }

        const matchRecord = {
          id: Date.now() + Math.random(),
          bank_txn_id: match.bank_txn_id,
          invoice_ids: match.invoice_ids,
          match_type: match.match_type,
          confidence: match.confidence,
          amount_matched: match.amount_matched,
          amount_remaining: match.amount_remaining,
          reasoning: match.reasoning,
          clearing_entry: match.clearing_entry,
          auto_clear: match.auto_clear,
          bank_txn: newBankTxns.find(t => String(t.id) === String(match.bank_txn_id)),  // string-tolerant: the LLM may echo the id with a different type
          matched_invoices,
          status: "pending",
          created_at: new Date().toISOString(),
        };

        if (match.auto_clear) {
          autoCleared.push(matchRecord);
        } else {
          queue.push(matchRecord);
        }
      }

      try { console.info(`[bank-match] LLM added: ${autoCleared.length - deterministic.length} · total autoCleared: ${autoCleared.length}`); } catch {}
      return { autoCleared, queue, deterministicCount: deterministic.length, llmCount: autoCleared.length - deterministic.length };
    } catch(e) {
      // LLM failed/timed out — NEVER zero out the deterministic matches; they stand alone.
      console.error("Matching engine error (deterministic matches retained):", e);
      return { autoCleared: deterministic, queue: [], deterministicCount: deterministic.length, llmCount: 0 };
    } finally {
      setMatchProcessing(false);
    }
  };

  // Apply a confirmed match — posts clearing journal entry and marks invoices as matched
  const applyMatch = async (matchRecord) => {
    const { invoice_ids, match_type, amount_remaining, bank_txn } = matchRecord;
    // Precise side check — "ap_clear".includes("ar") is true (the "ar" in "cle-ar"),
    // which would mis-post an AP clear as an AR collection. See isArMatch.
    const isAR = isArMatch(match_type);
    const isPaid = !amount_remaining || amount_remaining < 0.01;

    if (isPaid) {
      // Full match → canonical collection/payment posting (AR: Dr Cash / Cr A/R ·
      // AP: Dr A/P / Cr Cash) AND persist the flag. Replaces the old local-only
      // clearing entry (setInvoices, never bookToDb) + local flag flip.
      // O69-B (trust-critical): a match is "cleared" ONLY if EVERY markBillPaid actually
      // committed a JE. markBillPaid returns false (no JE) for a local-only / unpersisted
      // id — we must NOT record success on a write that didn't happen. On failure, leave
      // the match IN the queue (in-review), surface the error, and bail before history.
      const results = [];
      for (const id of (invoice_ids || [])) {
        results.push(await markBillPaid(id, { side: isAR ? "ar" : "ap", method: "bank_transfer", paidDate: bank_txn?.date || null }));
      }
      try { await loadAllData(); } catch {}
      if (!allClearingsPosted(results)) {
        logAudit("match_apply_failed", `Match for ${bank_txn?.vendor || bank_txn?.description || "transaction"} couldn't post a clearing entry — left in review (nothing cleared)`);
        showNotification("Couldn't post the clearing entry — nothing was cleared; left in review.", "error");
        return;   // do NOT remove from queue, do NOT record to history, do NOT claim success
      }
    } else {
      // Partial match — flag only for now (partial GL clearing is a separate feature).
      setInvoices(prev => prev.map(inv => !invoice_ids.includes(inv.id) ? inv : {
        ...inv, payment_status: "partial", balance_remaining: amount_remaining || 0,
        matched_at: new Date().toISOString(), matched_bank_txn: bank_txn?.description,
      }));
    }

    // Move from queue to history
    const confirmed = { ...matchRecord, status: "confirmed", confirmed_at: new Date().toISOString() };
    setMatchQueue(prev => prev.filter(m => m.id !== matchRecord.id));
    setMatchHistory(prev => [confirmed, ...prev]);
    showNotification(isPaid ? `Match confirmed — payment posted ✓` : `Partial match recorded`);
  };

  // "Dismiss" a proposed match means "not THAT match" — NOT "discard the line". The
  // bank line is a real transaction, so book it directly (in the correct direction
  // per buildBankLineEntry) using its AI categorization. Income/expense must never
  // silently vanish on dismiss. Was: just drop from the queue (stranded, unbooked).
  const dismissMatch = async (matchId) => {
    const m = (matchQueue || []).find(x => x.id === matchId);
    setMatchQueue(prev => prev.filter(x => x.id !== matchId));
    if (!m || !m.bank_txn) { showNotification("Match dismissed", "error"); return; }
    // Book against the import account's offset (Cr 2200 for a card), carried on the
    // queued match — not hardcoded Cash (O57 × C60).
    const offCode = m.importOffsetCode || rc("cash");
    const offName = m.importOffsetName || rn("cash");
    const entry = { id: Date.now() + Math.random(), booked_at: new Date().toISOString(),
      ...buildBankLineEntry(m.bank_txn, { offsetCode: offCode, offsetName: offName }) };  // reasoning = GL classification (classifyBankReason), not the dismiss provenance
    setInvoices(prev => [entry, ...prev]);
    const jeId = await bookToDb(entry);
    if (!jeId) { showNotification("Couldn't book the dismissed transaction — please try again", "error"); return; }
    logAudit("bank_line_booked_on_dismiss", `Booked ${entry.vendor || "transaction"} ${fmtMoney(entry.amount)} directly after dismissing a proposed match`, null, { je_id: String(jeId), amount: entry.amount, type: entry.type });
    showNotification(`Booked ${entry.vendor || "transaction"} as a new transaction ✓`, "success", async () => {
      try {
        await supabase.from("journal_entries").update({ deleted_at: new Date().toISOString(), deleted_by: session?.user?.id || null })
          .eq("id", jeId).eq("company_id", currentCompany.id);
        await loadAllData();
      } catch (e) { console.warn("[dismiss] undo failed:", e?.message || e); }
      showNotification("Removed ✓");
    });
  };

  // ── AP MANAGEMENT ENGINE ──────────────────────────────────────────────────────
  const AP_PRIORITY = { critical:"var(--sc-error)", high:"var(--sc-warning)", normal:"var(--sc-success)", low:"var(--sc-text-2)" };

  const runAPEngine = null; // consolidated into runAPScreen below

  // ── WATCH TRIGGER ENGINE ──────────────────────────────────────────────────────
  // Runs after every new invoice/transaction is booked.
  // Checks new transactions against all active watch_for conditions on unknownDocs.
  const checkWatchTriggers = (newInvoices, currentUnknownDocs) => {
    const activeWatches = currentUnknownDocs.filter(d => !d.posted && d.watch_for?.length > 0);
    if (!activeWatches.length || !newInvoices.length) return;

    const matches = [];

    for (const doc of activeWatches) {
      for (const watch of (doc.watch_for || [])) {
        const keywords = (watch.trigger_vendor_keywords || []).map(k => k.toLowerCase());
        const amtMin = watch.trigger_amount_min || 0;
        const amtMax = watch.trigger_amount_max || Infinity;

        for (const inv of newInvoices) {
          const vendorLower = (inv.vendor || "").toLowerCase();
          const descLower = (inv.description || "").toLowerCase();
          const amt = inv.amount || 0;

          const vendorMatch = keywords.length === 0 || keywords.some(k => vendorLower.includes(k) || descLower.includes(k));
          const amountMatch = amtMax === Infinity ? true : (amt >= amtMin * 0.8 && amt <= amtMax * 1.2);

          if (vendorMatch && amountMatch) {
            matches.push({ docId: doc.id, docType: doc.document_type, inv, watch });
          }
        }
      }
    }

    if (matches.length === 0) return;

    // Record matches on the unknownDocs and notify
    setUnknownDocs(prev => prev.map(doc => {
      const docMatches = matches.filter(m => m.docId === doc.id);
      if (!docMatches.length) return doc;
      const newWatchMatches = [
        ...(doc.watch_matches || []),
        ...docMatches.map(m => ({
          matched_at: new Date().toISOString(),
          invoice_id: m.inv.id,
          vendor: m.inv.vendor,
          amount: m.inv.amount,
          date: m.inv.date,
          trigger_description: m.watch.trigger_description,
          suggested_entry_description: m.watch.suggested_entry_description,
          suggested_gl_code: m.watch.suggested_gl_code,
          suggested_gl_name: m.watch.suggested_gl_name,
        }))
      ];
      return { ...doc, watch_matches: newWatchMatches };
    }));

    // One notification per unique doc matched
    const uniqueDocs = [...new Set(matches.map(m => m.docType))];
    uniqueDocs.forEach(docType => {
      showNotification(`🔔 Watch triggered: ${docType} — a related transaction was just booked. Review in Needs Review.`);
    });
    setView && setHasUnread && setHasUnread(true);
  };

  // ── AP ENGINE ─────────────────────────────────────────────────────────────────
  // Runs automatically after every new expense invoice is booked.
  // Adds: due_date, approval_status, ap_flags, payment_method, payment_priority
  const runAPScreen = async (newInvoices, allInvoices) => {
    const expenses = newInvoices.filter(i => glIsExpense(i.gl_code));
    if (!expenses.length) return;

    // Duplicate detection — check against existing invoices
    const existing = allInvoices.filter(i => i.id && !newInvoices.find(n => n.id === i.id));

    try {
      const res = await fetch(AI_PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          profile: "screen-ap",   // model/max_tokens/system server-owned; invoices + history via untrusted slots
          slots: {
            INVOICES: JSON.stringify(expenses.map(i=>({id:i.id, vendor:i.vendor, amount:i.amount, date:i.date, description:i.description, gl_name:i.gl_name}))),
            HISTORY: JSON.stringify(existing.filter(i=>glIsExpense(i.gl_code)).slice(0,40).map(i=>({vendor:i.vendor, amount:i.amount, date:i.date}))),
          },
          messages:[{role:"user", content:"Screen the new invoices in the instructions against the AP history."}]
        })
      });

      const data = await okAIResponse(res);
      const screened = JSON.parse((data.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());

      // Merge AP data back into invoices
      setInvoices(prev => prev.map(inv => {
        const screen = screened.find(s => s.id === inv.id);
        if (!screen) return inv;
        return {
          ...inv,
          due_date: screen.due_date,
          payment_method: screen.payment_method,
          duplicate_flag: screen.duplicate_flag,
          duplicate_reason: screen.duplicate_reason,
          anomaly_flag: screen.anomaly_flag,
          anomaly_reason: screen.anomaly_reason,
          approval_status: screen.approval_status,
          approval_reason: screen.approval_reason,
          payment_priority: screen.payment_priority,
          early_pay_discount: screen.early_pay_discount,
          notes_for_reviewer: screen.notes_for_reviewer,
          ap_screened: true,
          payment_status: inv.payment_status || "unpaid",
        };
      }));

      const flagged = screened.filter(s => s.duplicate_flag || s.anomaly_flag).length;
      const pending = screened.filter(s => s.approval_status === "pending_approval").length;
      const approved = screened.filter(s => s.approval_status === "approved").length;

      if (flagged > 0) showNotification(`AP screen: ${approved} approved · ${pending} need approval · ${flagged} flagged ⚠`);
      else if (pending > 0) showNotification(`AP screen: ${approved} auto-approved · ${pending} need approval`);
      else showNotification(`AP screen: ${approved} invoices auto-approved ✓`);

    } catch(e) {
      console.error("AP screen error:", e);
    }
  };

  // Persist AP workflow status onto the source journal_entries row. Returns
  // { ok, matched, error } so callers can VERIFY the write landed: `.select("id")`
  // makes PostgREST return the actually-updated rows, so a 0-row update (RLS
  // UPDATE policy not matching, or wrong id) is detectable — it otherwise returns
  // 204 with no error and looks like success. Resilient: warns, never throws.
  const persistApStatus = async (dbEntryId, fields) => {
    if (!dbEntryId || !currentCompany?.id) return { ok: false, matched: 0, error: "missing db id or company" };
    const { data, error } = await supabase.from("journal_entries")
      .update(fields).eq("id", dbEntryId).eq("company_id", currentCompany.id)
      .select("id");
    if (error) { console.warn("[AP] status persist failed (apply migration 003_ap_workflow.sql?):", error.message); return { ok: false, matched: 0, error: error.message }; }
    const matched = Array.isArray(data) ? data.length : 0;
    return { ok: matched > 0, matched, error: null };
  };

  const approveInvoice = (invId) => {
    const inv = invoices.find(i => i.id === invId);
    const who = session?.user?.email || "owner";       // human-readable, for the audit log only
    const uid = session?.user?.id || null;             // uuid → journal_entries.approved_by (a uuid column)
    const at = new Date().toISOString();
    setInvoices(prev => prev.map(i => i.id !== invId ? i : {
      ...i, approval_status: "approved", approval_reason: "Manually approved", approved_at: at, approved_by: uid,
    }));
    if (inv) {
      logAudit("invoice_approved", `${who} approved ${inv.vendor} · $${(inv.amount||0).toFixed(2)} (${inv.gl_name})`, { approval_status: inv.approval_status }, { approval_status: "approved", approved_by: who });
      persistApStatus(inv.db_entry_id, buildApprovalUpdate({ decision: "approved", at, actorUserId: uid }));
    }
    showNotification("Invoice approved ✓");
  };

  const rejectInvoice = (invId, reason) => {
    const inv = invoices.find(i => i.id === invId);
    const who = session?.user?.email || "owner";       // human-readable, for the audit log only
    const uid = session?.user?.id || null;             // uuid → journal_entries.approved_by (no rejected_by column)
    const at = new Date().toISOString();
    const why = (reason && String(reason).trim()) || "No reason given";
    setInvoices(prev => prev.map(i => i.id !== invId ? i : {
      ...i, approval_status: "rejected", approval_reason: why, rejection_reason: why, rejected_at: at, approved_by: uid, payment_status: "rejected",
    }));
    if (inv) {
      logAudit("invoice_rejected", `${who} rejected ${inv.vendor} · $${(inv.amount||0).toFixed(2)} — reason: ${why}`, { approval_status: inv.approval_status }, { approval_status: "rejected", reason: why, by: who });
      persistApStatus(inv.db_entry_id, buildApprovalUpdate({ decision: "rejected", at, actorUserId: uid, reason: why }));
    }
    showNotification("Invoice rejected", "error");
  };

  const requestInfo = (invId, note) => {
    const inv = invoices.find(i => i.id === invId);
    const who = session?.user?.email || "owner";
    const msg = (note && String(note).trim()) || "More information requested";
    setInvoices(prev => prev.map(i => i.id !== invId ? i : {
      ...i, approval_status: "info_requested", approval_reason: msg,
    }));
    if (inv) {
      logAudit("invoice_info_requested", `${who} requested info on ${inv.vendor} · $${(inv.amount||0).toFixed(2)} — ${msg}`, null, { vendor: inv.vendor, amount: inv.amount });
      persistApStatus(inv.db_entry_id, buildApprovalUpdate({ decision: "info_requested" }));
    }
    showNotification("Marked as info requested");
  };

  const methodPretty = (m) => ({ ach:"ACH / Bank Transfer", check:"Check", wire:"Wire Transfer", card:"Credit Card", zelle:"Zelle", venmo:"Venmo", paypal:"PayPal", other:"Other" }[m] || String(m||"").toUpperCase());

  // ── CANONICAL PAYMENT STATE WRITER ──────────────────────────────────────────
  // The ONE function that marks a bill paid (AP) or an invoice collected (AR).
  // Every button and AI action funnels through it. It: (1) optimistically updates
  // in-session state, (2) writes the canonical fields to journal_entries, (3) RE-
  // READS the row to confirm the write persisted, and (4) on failure reverts the
  // optimistic change, toasts an error, and logs to Sentry + audit_log — so the UI
  // can never show a paid state the database doesn't have. side: "ap" | "ar".
  const markBillPaid = async (entryId, { paidDate = null, method = "ach", reference = "", notes = "", side = "ap" } = {}) => {
    const inv = (invoicesRef.current || []).find(i => String(i.id) === String(entryId) || String(i.db_entry_id) === String(entryId));
    if (!inv) { console.warn("[markBillPaid] no invoice for entryId", String(entryId)); return false; }
    // SIGNED-PERIOD guard (O83 Trap 2): a payment/collection dated into a signed month posts a
    // clearing JE that changes that month — block a BACKDATED mark-paid (reopen first). A normal
    // payment in the open month (incl. bank-import auto-clears dated at the statement line) proceeds.
    const effPayDate = paidDate || todayLocal();
    const payPeriod = signedPeriodForDate(effPayDate, signoffs);
    if (payPeriod) {
      showNotification(`${signedMonthLabel(payPeriod) || "That month"} is signed off — reopen it first to record a payment dated in it.`, "error");
      logAudit("signed_period_mutation_blocked", `Blocked mark-paid dated ${effPayDate} in signed period ${payPeriod}`, null, { period: payPeriod, date: effPayDate, action: "mark_paid" });
      return false;
    }
    // Always target the PARENT journal_entries.id (multi-line rows carry a synthetic
    // `${parentId}_${line}` id; one bill = one entry = one payment_status).
    const dbId = resolveEntryDbId(inv);
    const who = session?.user?.email || "owner";
    const at = paidDate ? new Date(paidDate + "T12:00:00").toISOString() : new Date().toISOString();
    const newStatus = side === "ar" ? "collected" : "paid";
    const ref = (reference || "").trim(), note = (notes || "").trim();
    // Snapshot to revert to if the write doesn't persist.
    const snap = { payment_status: inv.payment_status, paid_at: inv.paid_at, collected_at: inv.collected_at,
      payment_method_used: inv.payment_method_used, matched: inv.matched,
      payment_reference: inv.payment_reference, payment_notes: inv.payment_notes };
    const apply = (patch) => setInvoices(prev => prev.map(i => String(i.id) !== String(inv.id) ? i : { ...i, ...patch }));

    apply({ payment_status: newStatus, payment_method_used: method, paid_at: at, matched: true,
      ...(side === "ar" ? { collected_at: at } : {}),
      payment_reference: ref || undefined, payment_notes: note || undefined });

    let postedPaymentId = null;                       // GL payment JE posted this call (for compensation)
    const fail = async (reasonForLog) => {
      apply(snap);                                    // revert the optimistic change
      // Compensation: if the GL payment entry was already posted, reverse it so we
      // never leave a GL movement without the paid flag (atomic-by-compensation).
      if (postedPaymentId) {
        try {
          await supabase.from("journal_entries")
            .update({ deleted_at: new Date().toISOString(), deleted_by: session?.user?.id || null })
            .eq("id", postedPaymentId).eq("company_id", currentCompany.id);
        } catch (e) { console.warn("[markBillPaid] compensation reverse failed:", e?.message || e); }
        postedPaymentId = null;
      }
      showNotification("Couldn't save the payment — please try again", "error");
      try { Sentry.captureMessage("payment_persist_failure", { level: "error",
        tags: { kind: "payment_persist_failure", side },
        extra: { entry_id: dbId ? String(dbId) : null, new_status: newStatus, reason: reasonForLog } }); } catch {}
      logAudit("payment_persist_failure", `Couldn't persist ${newStatus} for ${inv.vendor || "entry"} (entry ${dbId || "—"}): ${reasonForLog}`, null,
        { entry_id: dbId ? String(dbId) : null, side, new_status: newStatus });
      return false;
    };

    if (!dbId) return await fail("entry not yet persisted (no db id)");

    // ── GL PAYMENT MOVEMENT (Step 1 integrity) ──────────────────────────────────
    // Post the balanced payment entry (AP: Dr AP/Accrued · Cr Cash · AR: Dr Cash · Cr
    // AR) BEFORE flipping the flag, when the bill was booked to a liability/receivable.
    // A bill booked direct-to-cash was already settled at booking → buildPaymentEntry
    // returns null and it stays flag-only (never double-credit Cash).
    //
    // The post decision is driven by GL TRUTH — whether a LIVE clearing JE already links
    // to this bill — NOT by the payment_status flag. (The vanishing-clearing bug: gating
    // on `payment_status !== newStatus` skipped the post whenever the flag was already
    // "collected"/"paid". After the matchable-open-items fix a matched bank line legitimately
    // carries a STALE collected/paid flag from a reversed prior round, so that gate silently
    // dropped the clearing — the line cleared nothing and its cash movement disappeared,
    // while markBillPaid still returned success. The `already` probe below is the correct,
    // GL-based idempotency guard; the flag is not a posting precondition.)
    {
      const payEntry = buildPaymentEntry(inv, side, {
        apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities"),
        arCode: rc("accounts_receivable"), cashCode: rc("cash"), cashName: rn("cash"),
        date: paidDate || at.slice(0, 10), billDbId: dbId,
      });
      if (payEntry) {
        // Idempotency: don't double-post if a LIVE payment JE already links to this bill.
        let already = false;
        try {
          const { data } = await supabase.from("journal_entries").select("id")
            .eq("company_id", currentCompany.id)
            .eq("import_metadata->>payment_for", String(dbId))
            .is("deleted_at", null).eq("status", "posted").limit(1);
          already = Array.isArray(data) && data.length > 0;
        } catch { /* probe failed — fall through and post; a true dup is rare and reversible */ }
        if (!already) {
          postedPaymentId = await persistJournalEntry(payEntry);
          if (!postedPaymentId) return await fail("payment GL entry post failed");
          // Link the payment JE to its bill (import_metadata.payment_for) for reversal.
          try {
            await supabase.from("journal_entries")
              .update({ import_metadata: { kind: payEntry._paymentKind, payment_for: String(dbId) } })
              .eq("id", postedPaymentId).eq("company_id", currentCompany.id);
          } catch (e) { console.warn("[markBillPaid] payment link write failed:", e?.message || e); }
        }
      }
    }

    // Write canonical fields. Reference/notes go separately so a missing migration-004
    // column can't block the core payment_status write. The core write reports how
    // many rows it matched — a 0-row update (RLS UPDATE policy not matching, or a bad
    // id) is the authoritative failure signal, not just the re-read.
    const res = await persistApStatus(dbId, { payment_status: newStatus, payment_method: method, paid_at: at });
    if (ref || note) await persistApStatus(dbId, { payment_reference: ref || null, payment_notes: note || null });

    if (!res.ok) {
      // Loud, specific diagnostic so the actual cause (0 rows = RLS/id · error = column)
      // is visible at the failing click.
      console.error("[markBillPaid] UPDATE did not land", {
        entryId: String(entryId), invoiceId: String(inv.id), db_entry_id: inv.db_entry_id ?? null,
        resolvedDbId: String(dbId), matchedRows: res.matched, supabaseError: res.error, companyId: currentCompany?.id,
      });
      return await fail(res.error ? `update error: ${res.error}` : `update matched ${res.matched} rows (RLS update policy or id mismatch)`);
    }

    // Defense-in-depth: re-read and confirm the persisted value too.
    let confirmed = false;
    try {
      const { data, error } = await supabase.from("journal_entries")
        .select("payment_status").eq("id", dbId).eq("company_id", currentCompany.id).single();
      confirmed = !error && data && data.payment_status === newStatus;
    } catch { confirmed = false; }
    if (!confirmed) return await fail("re-read did not confirm the new status");

    const refStr = ref ? ` · ref ${ref}` : "", noteStr = note ? ` · note: ${note}` : "";
    const glStr = postedPaymentId ? ` · GL ${side === "ar" ? "Dr Cash/Cr AR" : "Dr AP/Cr Cash"} posted` : "";
    logAudit(side === "ar" ? "invoice_collected" : "invoice_paid",
      `${who} ${side === "ar" ? "collected from" : "paid"} ${inv.vendor} · $${(inv.amount || 0).toFixed(2)} via ${methodPretty(method)}${refStr}${noteStr}${glStr}`,
      { payment_status: snap.payment_status }, { payment_status: newStatus, method, reference: ref, notes: note, by: who, payment_entry_id: postedPaymentId ? String(postedPaymentId) : null });
    return true;
  };

  // Public AP helper — keeps the existing (bulk) signature, but every id now flows
  // through the verified canonical writer above.
  const markPaid = async (invIds, method = "ach", details = {}) => {
    const ids = Array.isArray(invIds) ? invIds : [invIds];
    let okCount = 0;
    for (const id of ids) {
      const ok = await markBillPaid(id, { paidDate: details.date, method, reference: details.reference, notes: details.notes, side: "ap" });
      if (ok) okCount++;
    }
    setSelectedPayments(new Set());
    setCheckRunMode(false);
    // Reload so the posted GL payment entries (Dr AP / Cr Cash) appear and the AP
    // balance reflects them. One refresh covers the whole batch.
    if (okCount > 0) { try { await loadAllData(); } catch {} showNotification(`Payment recorded — ${methodPretty(method)} ✓`); } // failures already toasted by markBillPaid
  };

  // ── CHAT HANDLER ────────────────────────────────────────────────────────────
  // ── PERSISTENT CHAT HISTORY + ACTION MEMORY (migration 015) ────────────────
  const persistChatMessage = async (role, content, actionsTaken = [], rich = []) => {
    if (!currentCompany?.id) return;
    try {
      // Backward-compatible storage in the actions_taken jsonb column: keep storing
      // a plain string array when there's no rich output (old format), but switch to
      // an object { actions, rich } when there are charts/summaries/CSVs to persist so
      // they re-render exactly as generated when the history reloads.
      const actionsPayload = (Array.isArray(rich) && rich.length)
        ? { actions: actionsTaken || [], rich }
        : (actionsTaken || []);
      const { error } = await supabase.from("chat_messages").insert({
        company_id: currentCompany.id, role, content, actions_taken: actionsPayload,
      });
      if (error) console.warn("[chat] persist failed:", error.message);
    } catch (e) { console.warn("[chat] persist threw:", e?.message || e); }
  };

  const loadChatHistory = async (companyId) => {
    const cid = companyId || currentCompany?.id;
    if (!cid) return;
    try {
      const { data, error } = await supabase.from("chat_messages")
        .select("*").eq("company_id", cid)
        .order("created_at", { ascending: false }).limit(50);
      if (error) { console.warn("[chat] load:", error.message); return; }
      const msgs = (data || []).slice().reverse().map(m => {
        // actions_taken is either the legacy string array, or { actions, rich }.
        const at = m.actions_taken;
        const actions = Array.isArray(at) ? at : (Array.isArray(at?.actions) ? at.actions : []);
        const rich = (at && !Array.isArray(at) && Array.isArray(at.rich)) ? at.rich : [];
        return { role: m.role, content: m.content, actions, rich, created_at: m.created_at, id: m.id };
      });
      setChatHistory([{ role: "assistant", content: CHAT_GREETING, id: 0 }, ...msgs]);
    } catch (e) { console.warn("[chat] load threw:", e?.message || e); }
  };

  // Reload the persisted conversation whenever the company changes.
  useEffect(() => { if (currentCompany?.id) loadChatHistory(currentCompany.id); /* eslint-disable-next-line */ }, [currentCompany?.id]);

  // ── DESTRUCTIVE-ACTION EXECUTOR (CR-9 / O81 part 2) ──────────────────────────
  // Runs ONE destructive AI action (void / delete / recode / retag / reverse /
  // delete-rule) through the verified-write path. Called ONLY after the human clicks
  // Confirm on the staged proposal (confirmAIActions) — NEVER inline from the chat
  // tool loop, which stages destructive actions instead of executing them. Returns
  // { summary[], failures[] } so the reply reports what actually committed (never a
  // false "✓ done"). This is the code-enforced human gate; the model can't bypass it.
  const executeDestructiveAction = async (action) => {
    const summary = [], failures = [];
    if (action.type === "recode" && action.invoiceIds?.length) {
      const toRecode = invoices.filter(inv => action.invoiceIds.includes(inv.id));
      const beforeState = toRecode.map(i => ({ id:i.id, gl_code:i.gl_code, gl_name:i.gl_name }));
      setInvoices(prev => prev.map(inv =>
        action.invoiceIds.includes(inv.id)
          ? { ...inv, gl_code: action.gl_code, gl_name: action.gl_name, recode_note: `Recoded by AI assistant` }
          : inv));
      const ok = await persistRecode(toRecode, action.gl_code, action.gl_name);
      if (ok) {
        logAudit("ai_recode", `AI recoded ${toRecode.length} invoice(s) → ${action.gl_name}`, beforeState, { gl_code: action.gl_code, gl_name: action.gl_name });
        summary.push(`Updated the category for ${toRecode.length} transaction(s) → ${action.gl_name}`);
      } else {
        setInvoices(prev => prev.map(inv => {
          const b = beforeState.find(x => x.id === inv.id);
          return b ? { ...inv, gl_code: b.gl_code, gl_name: b.gl_name, recode_note: undefined } : inv;
        }));
        failures.push(`recode → ${action.gl_name}`);
      }
    }
    if (action.type === "retag_project" && action.invoiceIds?.length) {
      const res = await persistChatRetagProject(action.invoiceIds, action.project);
      if (res.ok) summary.push(`Tagged ${action.invoiceIds.length} invoice(s) → Project: ${action.project}`);
      else failures.push(`tag → Project: ${action.project}`);
    }
    if (action.type === "delete_invoice") {
      if (action.invoice_id) {
        const target = invoices.find(i => String(i.id) === String(action.invoice_id));
        if (target) {
          const ids = await softDeleteInvoice(target, true);
          if (ids && ids.length) summary.push(`Deleted the transaction: ${target.vendor} ${fmtMoney(target.amount)}`);
          else failures.push(`delete ${target.vendor}`);
        } else summary.push(`Couldn't find that transaction`);
      } else if (action.vendor) {
        const toDelete = invoices.filter(i =>
          i.vendor?.toLowerCase().includes(action.vendor.toLowerCase()) &&
          (!action.amount || Math.abs(i.amount - parseFloat(action.amount)) < 1) &&
          (!action.date || i.date === action.date));
        if (toDelete.length > 0) {
          const ids = await softDeleteInvoices(toDelete, true);
          if (ids && ids.length) summary.push(`Deleted ${toDelete.length} transaction${toDelete.length===1?"":"s"} for ${action.vendor}`);
          else failures.push(`delete ${action.vendor}`);
        } else summary.push(`Couldn't find any transactions for ${action.vendor}`);
      }
    }
    if (action.type === "void_invoice") {
      if (action.invoice_id) {
        const target = invoices.find(i => String(i.id) === String(action.invoice_id));
        if (target) {
          const revId = await voidInvoiceWithUndo(target, action.reason || "Voided via AI", true);
          if (revId) summary.push(`Undid the entry for ${target.vendor}`);
          else failures.push(`void ${target.vendor}`);
        } else summary.push(`Couldn't find that transaction`);
      } else if (action.vendor) {
        const toVoid = invoices.filter(i => i.vendor?.toLowerCase().includes(action.vendor.toLowerCase()) && i.status!=="voided");
        let voided = 0;
        for (const t of toVoid) { const revId = await voidInvoiceWithUndo(t, action.reason || "Voided via AI", true); if (revId) voided++; }
        if (voided) summary.push(`Undid ${voided} transaction${voided===1?"":"s"} for ${action.vendor}`);
        if (voided < toVoid.length) failures.push(`void ${toVoid.length - voided} entr${(toVoid.length-voided)===1?"y":"ies"} for ${action.vendor}`);
      }
    }
    if (action.type === "reverse_entry") {
      const toReverse = invoices.find(i => String(i.id) === String(action.invoice_id));
      if (toReverse) {
        const revId = await reverseJournalEntry(toReverse, action.reason || "Reversed via AI", true);
        if (revId) { await loadAllData().catch(() => {}); summary.push(`Undid the entry for ${toReverse.vendor} (${fmtMoney(toReverse.amount)})`); }
        else failures.push(`reverse ${toReverse.vendor}`);
      }
    }
    if (action.type === "delete_contract") {
      if (action.contract_id || action.counterparty) {
        const toDelete = contracts.filter(c =>
          action.contract_id ? String(c.id) === String(action.contract_id)
          : c.counterparty?.toLowerCase().includes(action.counterparty?.toLowerCase()));
        if (toDelete.length) {
          const res = await softDeleteContracts(toDelete, true);
          if (res?.ok) summary.push(`Contract removed: ${action.counterparty || action.contract_id}`);
          else failures.push(`remove contract ${action.counterparty || action.contract_id}`);
        } else summary.push(`No matching contract found for ${action.counterparty || action.contract_id}`);
      }
    }
    if (action.type === "delete_rule") {
      const res = await deleteChatRule(action.vendor);
      if (res.ok) summary.push(`Rule removed for ${action.vendor}`);
      else failures.push(`remove rule for ${action.vendor}`);
    }
    // AI audit trail — delete/void/contract log via their own helpers; log the rest here.
    if (summary.length && !["delete_invoice","void_invoice","delete_contract"].includes(action.type)) {
      logAI(`ai_${action.type}`, summary.join("; "));
    }
    return { summary, failures };
  };

  // Human clicked CONFIRM on the staged destructive proposal → run them through the
  // verified path, then append an honest result message. This is the ONLY path that
  // executes a destructive AI action.
  const confirmAIActions = async () => {
    const pending = pendingAIActions;
    if (!pending) return;
    setPendingAIActions(null);
    const summary = [], failures = [];
    for (const action of pending.actions) {
      const r = await executeDestructiveAction(action);
      summary.push(...r.summary); failures.push(...r.failures);
    }
    if (failures.length) { try { await loadAllData(); } catch {} }
    const content = composeAssistantReply({
      reply: failures.length ? "Here's what happened:" : "Done.",
      actionFailures: failures, actionSummary: summary,
    });
    const doneMsg = { role: "assistant", content, actions: summary, rich: [], id: Date.now() + 3, created_at: new Date().toISOString() };
    setChatHistory(h => [...h, doneMsg]);
    persistChatMessage("assistant", doneMsg.content, doneMsg.actions, doneMsg.rich);
    logAI("ai_actions_confirmed", `User confirmed ${pending.actions.length} destructive action(s): ${pending.items.map(it => it.type).join(", ")}`);
    if (!chatOpen) setHasUnread(true);
  };

  // Human clicked CANCEL → discard the staged actions with NO write.
  const cancelAIActions = () => {
    const pending = pendingAIActions;
    if (!pending) return;
    setPendingAIActions(null);
    logAI("ai_actions_cancelled", `User cancelled ${pending.actions.length} destructive action(s): ${pending.items.map(it => it.type).join(", ")}`);
    const msg = { role: "assistant", content: "Okay — I've left everything as it was. Nothing was changed.", actions: [], rich: [], id: Date.now() + 3, created_at: new Date().toISOString() };
    setChatHistory(h => [...h, msg]);
    persistChatMessage("assistant", msg.content, msg.actions, msg.rich);
  };

  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const userMsg = { role: "user", content: msg, id: Date.now(), created_at: new Date().toISOString() };
    setChatHistory(h => [...h, userMsg]);
    setChatLoading(true);
    persistChatMessage("user", msg);  // persist the user turn immediately

    try {
      const historyForAI = chatHistory.filter(m => m.id !== 0).map(m => ({ role: m.role, content: m.content }));
      // Memory: last 20 persisted turns (with their actions + timestamps) for the system prompt.
      const memory = chatHistory.filter(m => m.id !== 0).slice(-20)
        .map(m => ({ role: m.role, content: m.content, actions: m.actions || [], created_at: m.created_at }));
      const result = await runAIBrain({
        userMessage: msg, invoices, rules, projects: customProjects, chatHistory: historyForAI, memory, contacts,
        chartOfAccounts: CHART_OF_ACCOUNTS, clientProfile: clientProfileRef.current, cashBalance: glCash, anomalies,
        businessType: companySettings.businessType,
        // Function-calling: give the AI direct, RLS-scoped database access via tools.
        supabase, companyId: currentCompany?.id, getAccountByRole, recurring,
        onToolCall: (name, params) => { try { logAI("ai_tool_call", `AI called tool: ${name} with params: ${JSON.stringify(params)}`); } catch {} },
      });

      // Execute actions
      let actionSummary = [];
      let actionFailures = [];   // mutating actions whose WRITE did not commit — the reply
                                 // must surface these, never a false "✓ done" (chatbot
                                 // false-success bug). Each handler verifies its own write.
      let richOutputs = [];   // inline chat outputs: charts, CSV buttons, summary cards

      // ── Bulk-delete protection ──
      // Count how many items the requested deletes would remove. If more than 3,
      // refuse all deletions and ask the user to remove them one at a time.
      let pendingDeletes = 0;
      for (const a of (result.actions || [])) {
        if (a.type === "delete_invoice") {
          if (a.invoice_id) pendingDeletes += 1;
          else if (a.vendor) pendingDeletes += invoices.filter(i =>
            i.vendor?.toLowerCase().includes(a.vendor.toLowerCase()) &&
            (!a.amount || Math.abs(i.amount - parseFloat(a.amount)) < 1) &&
            (!a.date || i.date === a.date)).length;
        } else if (a.type === "delete_contract") {
          if (a.contract_id) pendingDeletes += 1;
          else if (a.counterparty) pendingDeletes += contracts.filter(c =>
            c.counterparty?.toLowerCase().includes(a.counterparty.toLowerCase())).length;
        }
      }
      const bulkBlocked = pendingDeletes > 3;
      if (bulkBlocked) logAI("bulk_delete_blocked", `Refused a request to delete ${pendingDeletes} items at once`);

      // When the AI renders a chart, the user should stay exactly where they are —
      // the chart's own "View full report →" button is the only way they navigate.
      // So suppress any auto-navigation in the same response.
      const renderedChart = (result.actions || []).some(a => a && a.type === "render_chart");

      // ── Precise-targeting guard (Item 98) ──
      // A recode / delete / void action that resolves to MORE THAN ONE entry without
      // the user explicitly confirming "all/both/etc." is ambiguous — refuse it and
      // ask which one. Never act on an ambiguous reference.
      const userConfirmedMultiple = /\b(all|both|every|each|them all|all of them|everything|yes[, ]+all)\b/i.test(msg || "");
      const shortDate = (d) => { const x = new Date(String(d) + "T12:00:00"); return isNaN(x) ? String(d) : x.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
      const matchInvoicesFor = (a) => {
        if (a.invoice_id) return invoices.filter(i => String(i.id) === String(a.invoice_id));
        if (a.invoiceIds?.length) return invoices.filter(i => a.invoiceIds.includes(i.id));
        if (a.vendor) return invoices.filter(i =>
          i.vendor?.toLowerCase().includes(a.vendor.toLowerCase()) &&
          (a.amount == null || Math.abs((i.amount || 0) - parseFloat(a.amount)) < 1) &&
          (!a.date || i.date === a.date) &&
          i.status !== "voided");
        return [];
      };
      let ambiguous = null;
      if (!userConfirmedMultiple) {
        for (const a of (result.actions || [])) {
          if (!["recode", "delete_invoice", "void_invoice"].includes(a.type)) continue;
          const matches = matchInvoicesFor(a);
          if (matches.length > 1) { ambiguous = { type: a.type, vendor: a.vendor, matches }; break; }
        }
      }
      const clarifyNeeded = !!ambiguous;
      if (clarifyNeeded) {
        logAI("ai_action_clarification_needed", `Refused ambiguous ${ambiguous.type} — ${ambiguous.matches.length} entries matched "${ambiguous.vendor || "the description"}"; asked the user to confirm which one`);
      }

      // ── Role guard (Item 20) ──
      // Members can ask questions and pull reports, but the AI must refuse any
      // data-changing action (delete/void/recode/settings) for them.
      const memberBlocked = isMember && (result.actions || []).some(a => a && a.type !== "none" && isMutatingAIAction(a.type));
      if (memberBlocked) {
        logAI("role_blocked_action", `Refused a data-changing AI action for member-role user (${result.actions.filter(a=>isMutatingAIAction(a.type)).map(a=>a.type).join(", ")})`);
      }

      // ── CONFIRMATION GATE (CR-9 / O81 part 2) ──
      // Split the model's actions: SAFE (read-only / additive-reversible) execute in
      // the loop below; DESTRUCTIVE (void / delete / recode / retag / reverse /
      // delete-rule) are STAGED behind a human Confirm and NEVER executed inline — so
      // a poisoned tool_result or a steered model can't mutate the books without a
      // human clicking Confirm. When the batch is blocked (member / ambiguous / bulk)
      // nothing stages; the reply handles the refusal. Backstop for the part-1.5
      // tool_result residual (server owns instructions; tool outputs still flow in).
      const gateBlocked = memberBlocked || clarifyNeeded || bulkBlocked;
      const { execute: safeActions, stage: destructiveActions } = routeAIActions(result.actions || [], { blocked: gateBlocked });

      for (const action of safeActions) {
        // Member tried to change data — don't touch anything; the reply explains.
        if (memberBlocked && isMutatingAIAction(action.type)) continue;
        // Ambiguous modify request — don't touch anything; the reply asks which one.
        if (clarifyNeeded) continue;
        const _sumBefore = actionSummary.length;
        // ── AI SANDBOX (hard whitelist) ──
        // The AI may ONLY execute action types the app implements a handler for.
        // Anything else (a hallucinated or unsafe action) is refused and logged —
        // it never touches data. This is the UI-layer complement to RLS isolation.
        if (action.type && action.type !== "none" && !isAllowedAIAction(action.type)) {
          logAI("ai_action_refused", `Refused out-of-sandbox action: "${action.type}"`);
          continue;
        }
        if (action.type === "navigate" && action.view && renderedChart) {
          // A chart is being rendered — don't auto-navigate; let the user click through.
          continue;
        }
        if (action.type === "navigate" && action.view) {
          // Map any view name (old or new) to the 5-tab structure: home, books, reports, contracts, settings
          const viewAliases = {
            // home
            dashboard:"home", overview:"home", home:"home",
            // books (consolidated ledger / money in / money out)
            books:"books", ledger:"books", invoices:"books", invoice:"books", transactions:"books",
            "money-in":"books", receivables:"books", ar:"books", "money-out":"books", payables:"books", ap:"books",
            bills:"books", unpaid:"books",
            // sub-tools that live under Books — keep their dedicated views reachable
            bank:"bank", "bank-feed":"bank", recon:"recon", reconciliation:"recon",
            reconcile:"recon", "match-bank":"recon", "match bank":"recon", "bank-match":"recon", "match-statement":"recon", "match statement":"recon",
            "send-invoice":"send-invoice", customers:"customers", payroll:"payroll", docs:"docs", documents:"docs",
            // reports
            reports:"reports", report:"reports", pl:"reports", "p&l":"reports", "profit-loss":"reports",
            "balance-sheet":"reports", "cash-flow":"reports",
            audittrail:"audit", "audit-trail":"audit", "audit trail":"audit", audit:"audit",
            "1099":"tax1099", "1099s":"tax1099", tax1099:"tax1099",
            tax:"tax", taxes:"tax", "tax-center":"tax", "estimated-tax":"tax", "estimated taxes":"tax", "tax-compliance":"tax", deadlines:"tax",
            // contracts now live inside Books (contracts filter)
            contracts:"books", leases:"books", lease:"books", contract:"books",
            settings:"settings", company:"settings", coa:"coa", "chart-of-accounts":"coa",
            rules:"rules", vendors:"vendors", contacts:"vendors", recurring:"recurring",
            "opening-balances":"opening-balances", "bank-accounts":"opening-balances",
          };
          const target = viewAliases[String(action.view).toLowerCase().trim()] || action.view;
          // Apply a Books filter when the AI specifies one (e.g. "show unpaid bills")
          if (target === "books") {
            const f = String(action.filter || "").toLowerCase().trim();
            const fMap = { unpaid:"unpaid", bills:"unpaid", payables:"unpaid", expenses:"expenses", expense:"expenses", revenue:"revenue", income:"revenue", review:"review", "needs-review":"review", contracts:"contracts", contract:"contracts", leases:"contracts", all:"all" };
            // infer from the requested view if no explicit filter
            const inferred = /contract|lease/.test(String(action.view).toLowerCase()) ? "contracts"
                           : /money-out|payable|unpaid|bill/.test(String(action.view).toLowerCase()) ? "unpaid"
                           : /money-in|receivable|revenue|income/.test(String(action.view).toLowerCase()) ? "revenue" : null;
            setBooksFilter(fMap[f] || inferred || "all");
          }
          setView(target);
          if (target === "contracts") setContractView("list");
          actionSummary.push(`Opened ${target}`);
        }
        // recode / retag_project are DESTRUCTIVE — never executed inline here; they are
        // staged behind the confirm gate and run by executeDestructiveAction on Confirm.
        if (action.type === "add_account") {
          if (action.code && action.name && action.category) {
            const ok = await addCustomAccount({ code: action.code, name: action.name, category: action.category });
            if (ok === false) actionFailures.push(`add account ${action.code} ${action.name}`);
            else actionSummary.push(`Added a new category: ${action.name}`);
          }
        }
        // delete_invoice / void_invoice / reverse_entry / delete_contract are
        // DESTRUCTIVE — staged behind the confirm gate; executeDestructiveAction runs
        // them on Confirm (bulk-cap of 3 + ambiguity guard applied before staging).
        if (action.type === "add_rule") {
          // Persist to vendor_rules (contact→account) + verify; was setState-only (lost on refresh).
          const res = await persistChatRule({ vendor: action.vendor, gl_code: action.gl_code, gl_name: action.gl_name, project: action.project });
          if (res.ok) actionSummary.push(`Rule saved: ${action.vendor} → ${action.gl_name}${action.project ? ` / ${action.project}` : ""}`);
          else actionFailures.push(`rule ${action.vendor} → ${action.gl_name}`);
        }
        // delete_rule is DESTRUCTIVE — staged behind the confirm gate (executeDestructiveAction).
        if (action.type === "add_recurring") {
          // Persist to recurring_transactions + verify; was setState-only (lost on refresh).
          const res = await persistChatRecurring({ name: action.name, vendor: action.vendor, amount: action.amount, gl_code: action.gl_code, gl_name: action.gl_name, frequency: action.frequency, next_date: action.next_date, project: action.project });
          if (res.ok) {
            logAudit("recurring_created", `AI created recurring: ${action.name} $${action.amount} ${action.frequency}`);
            actionSummary.push(`Recurring created: ${action.name} · $${action.amount}/${action.frequency}`);
          } else actionFailures.push(`recurring ${action.name}`);
        }
        if (action.type === "pause_recurring") {
          const res = await pauseChatRecurring(action.name);  // flip active=false + verify
          if (res.ok) actionSummary.push(`Recurring paused: ${action.name}`);
          else actionFailures.push(`pause recurring ${action.name}`);
        }
        // ── Inline display outputs (render in the chat; never mutate data) ──
        if (action.type === "render_chart") {
          const ct = ["bar","pie","line"].includes(action.chart_type) ? action.chart_type : "bar";
          const data = (Array.isArray(action.data) ? action.data : [])
            .filter(d => d && d.label != null && d.value != null)
            .map(d => ({ label: String(d.label), value: Number(d.value) || 0 }));
          if (data.length) {
            richOutputs.push({ kind:"chart", chart_type: ct, title: action.title || "", data, report_view: action.report_view || null });
            logAI("ai_render_chart", `Rendered ${ct} chart in chat: ${action.title || ct}`);
          }
        }
        if (action.type === "export_csv") {
          const headers = Array.isArray(action.headers) ? action.headers : [];
          const rows = Array.isArray(action.rows) ? action.rows : [];
          if (rows.length) {
            richOutputs.push({ kind:"csv", filename: action.filename || "export.csv", headers, rows });
            logAI("ai_export_csv", `Prepared CSV in chat: ${action.filename || "export.csv"} (${rows.length} rows)`);
          }
        }
        if (action.type === "render_summary") {
          const metrics = (Array.isArray(action.metrics) ? action.metrics : []).slice(0, 8);
          if (metrics.length) {
            richOutputs.push({ kind:"summary", title: action.title || "", metrics, notes: action.notes || "" });
            logAI("ai_render_summary", `Rendered summary in chat: ${action.title || "summary"}`);
          }
        }
        if (action.type === "add_contact") {
          // Persist to contacts + verify (and a GL rule if gl_code given); was setState-only.
          const res = await persistChatContact({
            name: action.name, contact_type: action.contact_type, email: action.email, phone: action.phone,
            payment_terms: action.payment_terms, notes: action.notes, tags: action.tags,
            min_expected: action.min_expected, max_expected: action.max_expected,
            gl_code: action.gl_code, gl_name: action.gl_name,
          });
          if (res.ok) {
            logAudit("contact_added", `${action.contact_type==="customer"?"Customer":"Vendor"} added: ${action.name}`, null, { name: action.name });
            actionSummary.push(`${action.contact_type==="customer"?"Customer":"Vendor"} added: ${action.name}`);
          } else actionFailures.push(`add contact ${action.name}`);
        }
        if (action.type === "update_contact") {
          const res = await persistChatContact({ name: action.name }, action.updates || {});
          if (res.ok) actionSummary.push(`Updated contact: ${action.name}`);
          else actionFailures.push(`update contact ${action.name}`);
        }
        if (action.type === "set_contact_rule") {
          // persist the contact (creates if needed) AND the GL rule; the contact write
          // chains the vendor rule internally when gl_code is present.
          const res = await persistChatContact({ name: action.name, gl_code: action.gl_code, gl_name: action.gl_name });
          if (res.ok) actionSummary.push(`Rule set for ${action.name} → ${action.gl_name}`);
          else actionFailures.push(`set rule for ${action.name}`);
        }
        // Comprehensive AI audit trail: every action the AI takes is logged as "AI Chat".
        // delete_invoice / void_invoice / delete_contract already log (with before/after)
        // via their helpers; navigate isn't a data change, so both are skipped here.
        const _added = actionSummary.slice(_sumBefore);
        if (_added.length && !["navigate","delete_invoice","void_invoice","delete_contract"].includes(action.type)) {
          logAI(`ai_${action.type}`, _added.join("; "));
        }
      }
      // (rule mutations now persist + re-sync setRules inside their handlers — no trailing clobber)

      // Build the clarification reply when a modify target was ambiguous (Item 98).
      const clarifyText = () => {
        const verb = ambiguous.type === "recode" ? "recode" : ambiguous.type === "void_invoice" ? "void" : "delete";
        const shown = ambiguous.matches.slice(0, 6);
        const list = shown.map(i => `${shortDate(i.date)} ${fmtMoney(i.amount)}${i.gl_name ? ` (${i.gl_name})` : ""}`).join(", ");
        const more = ambiguous.matches.length > shown.length ? `, and ${ambiguous.matches.length - shown.length} more` : "";
        return `I found ${ambiguous.matches.length} matching ${ambiguous.vendor ? ambiguous.vendor + " " : ""}charges — which one did you want me to ${verb}? ${list}${more}. Tell me which one (or say "all") and I'll take care of it.`;
      };

      // A mutating write failed to commit → resync the UI to DB truth (undo any optimistic
      // state) before we render the (honest) reply.
      if (actionFailures.length) { try { await loadAllData(); } catch {} }

      // ── STAGE destructive actions behind the confirmation card (CR-9) ──
      // Nothing has mutated for these — they run only when the user clicks Confirm
      // (confirmAIActions). Not staged when the batch was blocked (member/ambiguous/bulk).
      const staged = (!gateBlocked && destructiveActions.length)
        ? buildPendingConfirmation(destructiveActions, { invoices, contracts })
        : null;
      if (staged) { setPendingAIActions({ ...staged, id: Date.now() + 2 }); logAI("ai_actions_staged", `Staged ${staged.actions.length} destructive action(s) for confirmation: ${staged.items.map(it => it.type).join(", ")}`); }

      const assistantMsg = {
        role: "assistant",
        content: memberBlocked
          ? "You're on a member seat, so I can't make changes like deleting, voiding, or recoding — those are reserved for admins and the owner. I can still answer questions, pull reports, and help you find things. Want me to do that instead?"
          : clarifyNeeded
            ? clarifyText()
            : bulkBlocked
              ? "I can delete items one at a time for safety. Which specific entry would you like me to remove first?"
              : staged
                // Destructive change proposed but NOT executed — ask for confirmation.
                ? `${[(result.reply || "").trim(), ...actionSummary].filter(Boolean).join("\n\n")}\n\nBefore I make ${staged.items.length === 1 ? "that change" : "those changes"}, I need you to confirm below.`.trim()
                // NEVER claim success on a write that didn't commit — surface failures.
                : composeAssistantReply({ reply: result.reply, actionFailures, actionSummary }),
        actions: (memberBlocked || clarifyNeeded || bulkBlocked) ? [] : actionSummary,
        rich: (memberBlocked || clarifyNeeded || bulkBlocked) ? [] : richOutputs,
        id: Date.now() + 1,
        created_at: new Date().toISOString(),
      };
      setChatHistory(h => [...h, assistantMsg]);
      persistChatMessage("assistant", assistantMsg.content, assistantMsg.actions, assistantMsg.rich);  // remember it (incl. charts)
      if (!chatOpen) setHasUnread(true);
    } catch(e) {
      console.error("Chat error:", e);
      const detail = e?.message || String(e);
      const hint = /Failed to fetch|NetworkError/i.test(detail)
        ? " (Couldn't reach the ai-proxy edge function — check your network or that the function is deployed.)"
        : /401|403|token|auth/i.test(detail)
          ? " (Authentication issue — try signing out and back in.)"
          : /model|not_found|deprecat/i.test(detail)
            ? " (The model may be unavailable — verify the ai-proxy model configuration.)"
            : "";
      setChatHistory(h => [...h, { role:"assistant", content:`⚠ I couldn't complete that request.\n\n${detail}${hint}`, id: Date.now()+1 }]);
      showNotification("AI chat failed — see the chat panel for details.", "error");
    }
    setChatLoading(false);
  };

  // Derived data
  const vendorSummary = useMemo(() => {
    const map = {};
    invoices.forEach(inv => {
      const v = inv.vendor || "Unknown";
      if (!map[v]) map[v] = { name:v, total:0, count:0, lastDate:"", glAccounts:new Set(), projects:new Set() };
      map[v].total += inv.amount; map[v].count += 1;
      if (!map[v].lastDate || inv.date > map[v].lastDate) map[v].lastDate = inv.date;
      map[v].glAccounts.add(inv.gl_name); map[v].projects.add(inv.project||"General");
    });
    return Object.values(map).sort((a,b) => b.total-a.total);
  }, [invoices]);

  const allVendorNames = useMemo(() => vendorSummary.map(v => v.name), [vendorSummary]);
  const filteredInvoices = useMemo(() => invoices.filter(inv => vendorFilter==="all" || inv.vendor===vendorFilter), [invoices, vendorFilter]);
  // Canonical layer (reports.js) — all-time, live (voided/deleted excluded). The single
  // source for these figures everywhere they appear. MEMOIZED on `invoices` (CR-21): each
  // walks the FULL (uncapped since C135) ledger, and App re-renders on every keystroke
  // (chatInput/search/form are App state) — so unmemoized, typing re-walked the whole ledger
  // ~6× per keystroke at volume. With these memos, a re-render that doesn't change `invoices`
  // re-walks nothing.
  const totalExpenses = useMemo(() => computeExpenses(invoices), [invoices]);
  const totalRevenue  = useMemo(() => computeRevenue(invoices), [invoices]);
  // Net income from the rev/exp memos — never re-walk the ledger (computeNetIncome would
  // recompute BOTH again). r2 to match computeNetIncome exactly (locked in reports.test.js).
  const netIncome = useMemo(() => Math.round((totalRevenue - totalExpenses) * 100) / 100, [totalRevenue, totalExpenses]);
  // Canonical CASH ON HAND, derived from the GL (single source of truth). Sums the
  // GL balance of the cash / cash-equivalent accounts (roles cash + savings + any
  // bank-linked GL account). This is what every cash surface reads — NOT the bank
  // statement balance (that's the reconciliation target, kept on bank_accounts).
  // Memoized so its array ref is stable → glCash's memo below actually holds.
  const cashGlCodes = useMemo(() => {
    const s = new Set();
    const c = getAccountByRole("cash")?.code; if (c) s.add(c);
    const sv = getAccountByRole("savings")?.code; if (sv) s.add(sv);
    (bankAccounts || []).forEach(b => { if (b.gl_code) s.add(b.gl_code); });
    return [...s];
    // getAccountByRole resolves from CHART_OF_ACCOUNTS (a dep) — safe to omit the fn ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bankAccounts, CHART_OF_ACCOUNTS]);
  const glCash = useMemo(() => glCashOnHand(invoices, cashGlCodes), [invoices, cashGlCodes]);
  // GL breakdown — only income statement accounts, live entries only.
  const glBreakdown = useMemo(() => liveEntries(invoices).reduce((acc,inv)=>{
    if (!glPLType(inv.gl_code)) return acc; // skip balance sheet accounts
    acc[inv.gl_name||"Uncoded"]=(acc[inv.gl_name||"Uncoded"]||0)+inv.amount;
    return acc;
  },{}), [invoices]);

  const inputStyle = { width:"100%", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"10px 12px", color:"var(--sc-text)", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" };
  const labelStyle = { display:"block", fontSize:11, color:"var(--sc-text-2)", marginBottom:6, letterSpacing:1 };


  const erpCtx = { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyGaapAnswer, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, setCompanies, setCurrentCompany, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, getAccountByRole, getAccountByCode, getAccountById, reloadAccounts, rc, rn, addCustomAccount, persistAccountEdit, deleteAccount, accountHasTransactions, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, glBreakdown, glDrilldown, setGlDrilldown, booksFilter, setBooksFilter, handleBankFile, handleBookInvoice, handleChatSend, pendingAIActions, confirmAIActions, cancelAIActions, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistMultiLineEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, reconciliations, setReconciliations, recurring, recurringNewRec, recurringSuggestions, acceptRecurringSuggestion, dismissRecurringSuggestion, persistBankAccounts, createBankAccountInline, cashFromBanks, glCash, glCashOnHand, cashGlCodes, pendingOpeningProposal, confirmOpeningFromStatement, dismissOpeningProposal, openingProposalCopy, openingDiscrepancyFlag, dismissOpeningDiscrepancy, anomalies, dismissAnomaly, notifications, notifOpen, setNotifOpen, unreadNotifs, markNotifRead, markAllNotifsRead, clearAllNotifs, openNotification, onboardingUploadDone, companyDataLoaded, businessModalOpen, setBusinessModalOpen, saveBusinessProfile, accountantDismissed, dismissAccountantStep, completeOnboarding, rejectInvoice, requestInfo, reportDateFrom, reportDateTo, reportRange, reportType, plDrill, setPlDrill, drill, setDrill, drillSel, setDrillSel, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, cutoffDate, saveCutoffDate, postOpeningBalances, openingPosted, preCutoffActivity, assertBookable, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, returnTo, setReturnTo, goBackFromDetail, softDeleteInvoice, softDeleteInvoices, voidInvoiceWithUndo, softDeleteContract, softDeleteContracts, restoreJournalEntries, dismissNotification, enterSupport, exitSupport, supportMode, view, legalTab, setLegalTab, userRole, isOwner, isAdmin, isMember, isReviewer, navSeat, previewAsOwner, flagBookingVisibilityFailure, markBillPaid, depreciationDueInfo, attachDepreciationToExistingAsset, guardImport, routeFileToType, pendingImportFile, setPendingImportFile, reconcileDroppedDocs, flagsForReview, reviewFlagSummary, reviewApprove, reviewOverride, resolveIntakeItem, controlTotals, reviewedThrough, ownerTrust, bankMatch, signOffPeriod, reopenPeriod, signOffReadinessFor, signoffs, pendingSignedPeriodBooking, reopenSignedPeriodAndBook, rebookHeldIntoOpenMonth, sendHeldToCPA, dismissSignedPeriodBooking, statementExceptions, loadStatementExceptions, reconcileOffer, setReconcileOffer, offerReconciliation, reevaluateStatement, logIntake, markIntake };

  const SETTINGS_VIEWS = ["settings","team","coa","opening-balances","onboard","rules","recurring","tax1099","tax","audit"];
  // (`isPlatformAdmin` is derived once at the top of ERP, alongside the seat — C197.)
  return (
    <ERPContext.Provider value={erpCtx}>
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", minHeight:"100vh", background:"var(--sc-bg)", color:"var(--sc-text)" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideup{from{opacity:0;transform:translateY(20px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes popbubble{from{transform:scale(0.7)}to{transform:scale(1)}}
        @keyframes shimmer{0%{background-position:-400px 0}100%{background-position:400px 0}}
        *{box-sizing:border-box}
        body, input, button, select, textarea { font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
        /* Consistent form focus + interactive defaults across the app */
        button:not(:disabled){ cursor:pointer; }
        input:focus, select:focus, textarea:focus { border-color:var(--sc-gold) !important; box-shadow:0 0 0 3px rgba(79,70,229,0.10); outline:none; }
        /* Sticky table headers — column labels stay visible while the main area scrolls.
           background-color:inherit pulls each header row's own color onto the cells (the
           tr carries the bg inline; sticky th need their own paint to avoid bleed-through).
           Table-wrapping cards use overflow:clip (not hidden) so they don't become scroll
           containers that would trap the sticky headers. */
        #main-content thead th { position: sticky; top: 0; z-index: 10; background-color: inherit; }
        /* Nav tab hover — pure CSS so React fully owns the active state. Imperative
           DOM hover styling left residue (a hovered-then-abandoned tab kept its color
           because React saw no style diff to reset), making inactive tabs look active. */
        .sc-navtab:not(.active):hover{ background:var(--sc-surface-2) !important; color:var(--sc-gold) !important; }
        .sc-subtab:not(.active):hover{ color:var(--sc-gold) !important; }
        /* Sortable table headers — reveal the sort arrow on hover of inactive columns. */
        .sc-th-sort:hover{ color:var(--sc-text-mut) !important; }
        .sc-th-sort:hover .sc-th-arrow{ opacity:1 !important; }
        /* Tabular figures for monospace numbers — fintech-grade alignment */
        [style*="DM Mono"]{ font-variant-numeric: tabular-nums; }
        /* Card elevation (used sparingly) */
        .sc-card{ box-shadow: 0 1px 3px rgba(16,24,40,0.1), 0 1px 2px rgba(16,24,40,0.06); }
        .sc-skeleton{ background:linear-gradient(90deg,var(--sc-surface-2) 0px,#E9ECF2 200px,var(--sc-surface-2) 400px); background-size:800px 100%; animation:shimmer 1.4s linear infinite; border-radius:6px; }
        ::-webkit-scrollbar{width:8px;height:8px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:var(--sc-border-2);border-radius:8px} ::-webkit-scrollbar-thumb:hover{background:var(--sc-text-mut)}
      `}</style>

      {notification && (
        <div style={{ position:"fixed", top:20, right:20, zIndex:9999, background:notification.type==="error"?"var(--sc-error-soft)":"var(--sc-success-soft)", border:`1px solid ${notification.type==="error"?"var(--sc-error)":"var(--sc-success)"}`, color:notification.type==="error"?"var(--sc-error)":"var(--sc-success)", padding:"12px 16px 12px 20px", borderRadius:10, fontSize:14, animation:"fadein 0.2s ease", boxShadow:"0 8px 32px rgba(16,24,40,0.18)", display:"flex", alignItems:"center", gap:16, maxWidth:480 }}>
          <span>{notification.msg}</span>
          {notification.undo && (
            <button onClick={()=>{ const fn=notification.undo; dismissNotification(); fn(); }}
              style={{ flexShrink:0, background:"transparent", border:"1px solid currentColor", color:"inherit", borderRadius:7, padding:"5px 14px", fontSize:13, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" }}>Undo</button>
          )}
          <button onClick={dismissNotification} aria-label="Dismiss" style={{ flexShrink:0, background:"transparent", border:"none", color:"inherit", opacity:0.6, fontSize:18, lineHeight:1, cursor:"pointer", padding:0 }}>×</button>
        </div>
      )}

      {/* O83 Trap 2 — a signed period is guarded. A booking that dates into a reviewed month is
          HELD here (never silently posted); the owner/reviewer picks how to record it. */}
      {pendingSignedPeriodBooking && (() => {
        const held = pendingSignedPeriodBooking;
        const copy = signedPeriodOwnerCopy(held.period);
        const inv = held.invoice || {};
        const optBtn = (onClick, title, sub, accent) => (
          <button onClick={onClick} style={{ display:"block", width:"100%", textAlign:"left", padding:"13px 15px", marginTop:10, borderRadius:11, border:`1px solid ${accent||"var(--sc-border-2)"}`, background:"var(--sc-surface)", cursor:"pointer" }}>
            <div style={{ fontSize:13.5, fontWeight:600, color:"var(--sc-text)" }}>{title}</div>
            <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2 }}>{sub}</div>
          </button>
        );
        return (
          <div style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(16,24,40,0.55)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
            <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, padding:"22px 24px", maxWidth:520, width:"100%", boxShadow:"0 24px 64px rgba(16,24,40,0.3)" }}>
              <div style={{ fontSize:11, letterSpacing:1, textTransform:"uppercase", color:"var(--sc-warning)", fontWeight:700, marginBottom:6 }}>Already reviewed</div>
              <div style={{ fontSize:18, fontWeight:600, color:"var(--sc-text)", letterSpacing:-0.3 }}>{copy.title}</div>
              <div style={{ fontSize:13.5, color:"var(--sc-text-2)", marginTop:8, lineHeight:1.5 }}>{copy.body}</div>
              <div style={{ marginTop:12, padding:"10px 12px", borderRadius:10, background:"var(--sc-surface-2)", fontSize:12.5, color:"var(--sc-text)" }}>
                <strong>{inv.vendor || "Entry"}</strong>{inv.amount != null ? ` · ${fmtSignedMoney(inv.amount)}` : ""}{inv.date ? ` · dated ${inv.date}` : ""}
              </div>
              {/* (a) reopen — REVIEWER ONLY (the client can't undo their accountant's sign-off). */}
              {isReviewer && optBtn(reopenSignedPeriodAndBook, copy.reopen, "Reopens the month and records it there, for re-review.", "var(--sc-warning)")}
              {/* (b) rebook to the open month — keeps the original date on file. */}
              {optBtn(rebookHeldIntoOpenMonth, copy.rebook, "Best for a late bill you just want on the books.")}
              {/* (c) hand to the accountant — leaves it unbooked until they decide. */}
              {optBtn(sendHeldToCPA, copy.cpa, "We'll flag it for your accountant; nothing is recorded yet.")}
              <div style={{ display:"flex", justifyContent:"flex-end", marginTop:14 }}>
                <button onClick={dismissSignedPeriodBooking} style={{ background:"transparent", border:"none", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer", padding:"6px 4px" }}>Not now</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-error-soft)", borderRadius:16, padding:28, maxWidth:400, width:"90%", boxShadow:"0 24px 80px rgba(0,0,0,0.8)" }}>
            <div style={{ fontSize:16, fontWeight:600, marginBottom:10 }}>{deleteConfirm.title || "Confirm Delete"}</div>
            <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:20, lineHeight:1.6 }}>{deleteConfirm.label}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={()=>setDeleteConfirm(null)} style={{ padding:"8px 20px", borderRadius:8, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Cancel</button>
              <button onClick={()=>{ deleteConfirm.onConfirm(); setDeleteConfirm(null); }} style={{ padding:"8px 20px", borderRadius:8, background: deleteConfirm.confirmBg||"var(--sc-error-soft)", border: deleteConfirm.confirmBorder||"1px solid var(--sc-error)", color: deleteConfirm.confirmColor||"var(--sc-error)", fontSize:13, cursor:"pointer", fontWeight:600 }}>{deleteConfirm.confirmLabel || "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {/* File misroute warning (O37) — detected type disagrees with the importer. */}
      {misrouteConfirm && (() => {
        const close = (choice) => { const r = misrouteConfirm.resolve; setMisrouteConfirm(null); r(choice); };
        const detLabel = TYPE_LABEL[misrouteConfirm.detected] || "different file";
        const expLabel = TYPE_LABEL[misrouteConfirm.expected] || "this importer";
        const dest = { bank_statement:"Bank Import", payroll:"Payroll Import", invoice:"Upload", qbo:"QuickBooks Import", contract:"Contracts" }[misrouteConfirm.detected] || "the right importer";
        return (
          <div style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center" }}>
            <div style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-warning-soft)", borderRadius:16, padding:28, maxWidth:440, width:"90%", boxShadow:"0 24px 80px rgba(0,0,0,0.8)" }}>
              <div style={{ fontSize:16, fontWeight:600, marginBottom:10 }}>This looks like a {detLabel}</div>
              <div style={{ fontSize:13, color:"var(--sc-text-2)", marginBottom:20, lineHeight:1.6 }}>You dropped it on the {expLabel} importer. Send it to <b>{dest}</b> instead, or process it here anyway?</div>
              <div style={{ display:"flex", gap:10, justifyContent:"flex-end", flexWrap:"wrap" }}>
                <button onClick={()=>close("cancel")} style={{ padding:"8px 16px", borderRadius:8, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Cancel</button>
                <button onClick={()=>close("proceed")} style={{ padding:"8px 16px", borderRadius:8, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:13, cursor:"pointer" }}>Process here anyway</button>
                <button onClick={()=>close("route")} style={{ padding:"8px 16px", borderRadius:8, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:13, fontWeight:600, cursor:"pointer" }}>Send to {dest}</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Persistent upload status — visible from any tab */}
      {uploadQueue.some(q => q.status==="pending"||q.status==="classifying"||q.status==="processing") && (
        <div style={{ position:"fixed", bottom:100, left:"50%", transform:"translateX(-50%)", zIndex:999, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:12, padding:"12px 20px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", minWidth:280 }}>
          <div style={{ display:"flex", gap:3 }}>
            {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"var(--sc-gold)", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
          </div>
          <div>
            <div style={{ fontSize:13, color:"var(--sc-text)", fontWeight:500 }}>
              Processing {uploadQueue.filter(q=>q.status==="pending"||q.status==="classifying"||q.status==="processing").length} file{uploadQueue.filter(q=>q.status==="pending"||q.status==="classifying"||q.status==="processing").length>1?"s":""}...
            </div>
            <div style={{ fontSize:11, color:"var(--sc-text-2)", marginTop:2 }}>
              {uploadQueue.find(q=>q.status==="processing"||q.status==="classifying")?.name || ""}
            </div>
          </div>
          <button onClick={()=>{ setView("home"); setTimeout(()=>document.getElementById("universal-upload-zone")?.scrollIntoView({behavior:"smooth",block:"center"}), 250); }} style={{ marginLeft:"auto", background:"none", border:"1px solid var(--sc-border-2)", borderRadius:6, padding:"4px 10px", color:"var(--sc-gold)", fontSize:11, cursor:"pointer", flexShrink:0 }}>View</button>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* BOOKING VISIBILITY FAILURE — non-dismissable; a saved entry isn't displaying. */}
        {visibilityAlert && (
          <div role="alert" style={{ flexShrink:0, background:"var(--sc-warning-soft)", borderBottom:"1px solid var(--sc-warning-soft)", color:"var(--sc-warning)", padding:"11px 24px", display:"flex", alignItems:"center", gap:12, fontSize:13, fontWeight:600, zIndex:51 }}>
            <span style={{ fontSize:16 }}>⚠</span>
            <span>A transaction was saved but isn't displaying correctly. Refresh the page — if it's still missing, contact support.</span>
          </div>
        )}
        {/* SUPPORT MODE banner — persistent while a platform admin is viewing a client */}
        {supportMode && (
          <div style={{ flexShrink:0, background:"linear-gradient(90deg,var(--sc-warning),#F97316)", color:"var(--sc-on-accent)", padding:"10px 24px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", boxShadow:"0 2px 8px rgba(234,88,12,0.35)", zIndex:50 }}>
            <span style={{ fontSize:16 }}>🛟</span>
            <div style={{ flex:"1 1 320px", minWidth:0, fontSize:13, fontWeight:600 }}>
              SUPPORT MODE — Viewing <strong>{supportMode.company?.name || currentCompany?.name}</strong> as Platform Admin. Every action is real and logged.
            </div>
            <button onClick={exitSupport} style={{ flexShrink:0, background:"var(--sc-surface)", color:"var(--sc-warning)", border:"none", borderRadius:8, padding:"7px 16px", fontSize:13, fontWeight:700, cursor:"pointer" }}>Exit Support Mode →</button>
          </div>
        )}
        {/* Top Bar */}
        <div style={{ background:"var(--sc-surface)", borderBottom:"1px solid var(--sc-border)", flexShrink:0 }}>
          {/* Brand + Company + User row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 32px", height:64 }}>
            <div onClick={()=>setView("home")} title="Go to Home" style={{ display:"flex", alignItems:"center", gap:12, cursor:"pointer" }}>
              {/* Eclipse logomark — a gold disc partly eclipsed by a midnight disc → a "shadow" crescent */}
              <svg width={26} height={26} viewBox="0 0 48 48" fill="none" aria-hidden style={{ flexShrink:0 }}>
                <defs>
                  <linearGradient id="scTopMark" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="var(--sc-gold-bright)" />
                    <stop offset="100%" stopColor="#bf9226" />
                  </linearGradient>
                </defs>
                <circle cx="24" cy="24" r="14" fill="url(#scTopMark)" />
                <circle cx="30.5" cy="20" r="11.5" fill="var(--sc-surface)" />
              </svg>
              <span className="sc-wordmark sc-display" style={{ fontSize:21, letterSpacing:1, fontWeight:600 }}>Shadow</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <CompanySwitcher companies={companies} currentCompany={currentCompany} onSwitch={onSwitchCompany} onNew={onNewCompany} />
              {/* C197 — PREVIEW AS OWNER. Renders the exact client experience without
                  touching the role: one click in, one click back, nothing persisted.
                  Only a reviewer seat can see it, and while it's on the label says
                  plainly that this is a preview so nobody mistakes it for a lockout. */}
              {canPreviewAsOwner && (
                <button onClick={()=>setPreviewAsOwner(v=>!v)}
                  title={previewAsOwner ? "Return to your full view" : "See exactly what the business owner sees"}
                  style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 12px", borderRadius:9,
                    background: previewAsOwner ? "var(--sc-warning-soft)" : "transparent",
                    border:`1px solid ${previewAsOwner ? "var(--sc-warning)" : "var(--sc-border)"}`,
                    color: previewAsOwner ? "var(--sc-warning)" : "var(--sc-text-mut)", cursor:"pointer", fontSize:13, fontWeight:500, whiteSpace:"nowrap", transition:"all .15s" }}>
                  {previewAsOwner ? PREVIEW_AS_OWNER_EXIT_LABEL : PREVIEW_AS_OWNER_ENTER_LABEL}
                </button>
              )}
              <button onClick={()=>setView("settings")} title="Settings" aria-label="Settings"
                style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 12px", borderRadius:9, background: SETTINGS_VIEWS.includes(view)?"var(--sc-gold-soft)":"transparent", border:`1px solid ${SETTINGS_VIEWS.includes(view)?"var(--sc-gold-line)":"var(--sc-border)"}`, color: SETTINGS_VIEWS.includes(view)?"var(--sc-gold)":"var(--sc-text-mut)", cursor:"pointer", transition:"all .15s" }}
                onMouseEnter={e=>{ if(!SETTINGS_VIEWS.includes(view)){ e.currentTarget.style.background="var(--sc-surface-2)"; e.currentTarget.style.color="var(--sc-text)"; }}}
                onMouseLeave={e=>{ if(!SETTINGS_VIEWS.includes(view)){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--sc-text-mut)"; }}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink:0 }}>
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span style={{ fontSize:13, fontWeight:500 }}>Settings</span>
              </button>
              <span style={{ fontSize:11, color:"var(--sc-text-ph)", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{session?.user?.email}</span>
              <button onClick={onSignOut} style={{ padding:"6px 14px", borderRadius:8, background:"transparent", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", fontSize:12, cursor:"pointer" }}>Sign out</button>
            </div>
          </div>
          {/* Nav — C197: the tabs ARE the seat. Reviewer = the full cockpit;
              client (and any reviewer previewing as owner) = Home + Reports. */}
          {(() => {
            const tabs = navSeat.tabs;
            return (
              <div style={{ display:"flex", width:"100%", borderBottom:"1px solid var(--sc-border)", padding:"0 20px", gap:4 }}>
                {tabs.map(tab => {
                  const isActive = tab.group.includes(view);
                  const accent = tab.admin ? "var(--sc-warning)" : "var(--sc-gold)";
                  return (
                    <button key={tab.id}
                      className={tab.admin ? undefined : (isActive?"sc-navtab active":"sc-navtab")}
                      onClick={()=>{ if(tab.id==="books") setBooksFilter("all"); setView(tab.id); setVendorFilter("all"); }}
                      onMouseEnter={tab.admin ? (e=>{ if(!isActive) e.currentTarget.style.background="var(--sc-warning-soft)"; }) : undefined}
                      onMouseLeave={tab.admin ? (e=>{ if(!isActive) e.currentTarget.style.background="transparent"; }) : undefined}
                      style={{ height:46, padding:"0 18px", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                        background: tab.admin ? (isActive?"var(--sc-warning-soft)":"transparent") : "transparent",
                        border: tab.admin ? "1px solid var(--sc-warning-soft)" : "none", borderBottomWidth: 2,
                        borderBottom: isActive?`2px solid ${accent}`:"2px solid transparent",
                        borderRadius: tab.admin ? "8px 8px 0 0" : 0,
                        color: isActive?(tab.admin?"var(--sc-warning)":"var(--sc-text)"):"var(--sc-text-mut)", fontSize:14, fontWeight: isActive?600:500,
                        fontFamily:"var(--sc-font-ui)", cursor:"pointer", transition:"all 0.12s" }}>
                      {tab.label}
                      {tab.id==="home" && clarificationQueue.filter(c=>!c.resolved).length>0 && (
                        <span style={{ background:"var(--sc-warning)", color:"var(--sc-on-accent)", fontSize:10, fontWeight:700, borderRadius:20, padding:"1px 6px", lineHeight:1.4 }}>{clarificationQueue.filter(c=>!c.resolved).length}</span>
                      )}
                      {tab.admin && adminFailedCount>0 && (
                        <span title={`${adminFailedCount} failed upload${adminFailedCount!==1?"s":""} in 24h`} style={{ width:8, height:8, borderRadius:"50%", background:"var(--sc-error)", display:"inline-block", flexShrink:0 }} />
                      )}
                    </button>
                  );
                })}
                {/* Notification bell (Item 55) — clean lucide-style icon, matched to
                    the Settings gear (muted var(--sc-text-mut) → var(--sc-gold) on hover). */}
                <button onClick={()=>setNotifOpen(o=>!o)} title="Notifications" aria-label="Notifications"
                  style={{ marginLeft:"auto", alignSelf:"center", position:"relative", width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center", background: notifOpen?"var(--sc-gold-soft)":"transparent", border:"none", borderRadius:10, cursor:"pointer", color: notifOpen?"var(--sc-gold)":"var(--sc-text-mut)", transition:"all .15s" }}
                  onMouseEnter={e=>{ if(!notifOpen){ e.currentTarget.style.background="var(--sc-surface-2)"; e.currentTarget.style.color="var(--sc-text)"; }}}
                  onMouseLeave={e=>{ if(!notifOpen){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="var(--sc-text-mut)"; }}}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink:0 }}>
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {unreadNotifs>0 && (
                    <span style={{ position:"absolute", top:2, right:2, width:16, height:16, borderRadius:"50%", background:"var(--sc-error)", color:"var(--sc-on-accent)", fontSize:10, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1, border:"2px solid var(--sc-surface)" }}>{unreadNotifs>9?"9":unreadNotifs}</span>
                  )}
                </button>
              </div>
            );
          })()}

          {/* Sub-nav for Books / Reports / Settings */}
          {(() => {
            const SETTINGS = ["settings","team","coa","opening-balances","onboard","rules","recurring","tax1099","tax","audit"];
            let subs = null;
            // C197: the workbench sub-tabs come from the SEAT. A client seat gets an
            // empty list, so the row doesn't render at all — the surfaces don't merely
            // refuse to open, they have no client-facing existence.
            if (BOOKS_GROUP.includes(view)) subs = navSeat.booksSubtabs.length ? navSeat.booksSubtabs : null;
            // Reports has its own in-screen sub-nav — no chrome sub-nav row here.
            else if (SETTINGS.includes(view)) {
              subs = [["settings","Company"],["coa","Chart of Accounts"],["opening-balances","Bank & Balances"],["rules","Rules"],["recurring","Recurring"],["tax","Taxes"],["tax1099","1099s"],["audit","Audit Trail"],["onboard","Import from QuickBooks"]];
              if (isOwner) subs.splice(1, 0, ["team","Team"]);            // owner-only Team tab
              if (isMember) subs = subs.filter(([id]) => ["tax","tax1099","audit"].includes(id)); // members: read-only settings only
            }
            if (!subs) return null;
            // Payables badge = the SAME source the Payables tab lists (openPayables → live
            // bills booked to A/P that are still unpaid). The old inline filter counted EVERY
            // non-paid expense incl. direct cash expenses that were never payables → phantom
            // count (e.g. "4" when the tab shows none). Now badge === tab, and 0 when clear.
            const apUnpaid = openPayables(invoices).length;
            const activeSub = (id) => {
              if (id.startsWith("reports:")) return view==="reports" && (reportType||"pl")===id.split(":")[1];
              if (id==="books:contracts") return view==="books" && booksFilter==="contracts";
              if (id==="books") return (view==="books"||view==="detail") && booksFilter!=="contracts";
              return view===id;
            };
            const go = (id) => {
              if (id.startsWith("reports:")) { setReportType(id.split(":")[1]); setView("reports"); }
              else if (id==="books:contracts") { setBooksFilter("contracts"); setView("books"); }
              else if (id==="books") { if (booksFilter==="contracts") setBooksFilter("all"); setView("books"); }
              else setView(id);
            };
            return (
              <div style={{ display:"flex", background:"var(--sc-surface)", borderBottom:"1px solid var(--sc-border)", padding:"0 16px", gap:4, overflowX:"auto" }}>
                {subs.map(([id,label])=>(
                  <button key={id} onClick={()=>go(id)}
                    className={activeSub(id)?"sc-subtab active":"sc-subtab"}
                    style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:activeSub(id)?"2px solid var(--sc-gold)":"2px solid transparent", color:activeSub(id)?"var(--sc-gold)":"var(--sc-text-mut)", fontSize:12, cursor:"pointer", whiteSpace:"nowrap", transition:"color 0.12s", display:"inline-flex", alignItems:"center", gap:6 }}>
                    {label}
                    {id==="ap" && apUnpaid>0 && <span style={{ fontSize:10, fontWeight:700, color:"var(--sc-warning)", background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", borderRadius:20, padding:"1px 7px", lineHeight:1.4 }}>{apUnpaid}</span>}
                  </button>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Main Content */}
        <div ref={mainContentRef} id="main-content" style={{ flex:1, overflowY:"auto" }}>
          {/* Review banner — visible from any non-dashboard view when items need input */}
          {clarificationQueue.filter(c=>!c.resolved).length > 0 && view !== "home" && view !== "dashboard" && (
            <div style={{ background:"var(--sc-warning-soft)", borderBottom:"1px solid var(--sc-warning-soft)", padding:"10px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div style={{ fontSize:13, color:"var(--sc-warning)" }}>⚠ {clarificationQueue.filter(c=>!c.resolved).length} invoice{clarificationQueue.filter(c=>!c.resolved).length!==1?"s":""} need{clarificationQueue.filter(c=>!c.resolved).length===1?"s":""} review before booking</div>
              <button onClick={()=>setView("home")} style={{ background:"var(--sc-warning-soft)", border:"1px solid var(--sc-warning-soft)", color:"var(--sc-warning)", borderRadius:8, padding:"5px 12px", fontSize:12, cursor:"pointer" }}>Review →</button>
            </div>
          )}
          <div key={view} className="sc-rise" style={{ maxWidth:1296, margin:"0 auto", padding:"32px 48px" }}>

          {/* Top-level tab redirects (legacy → new consolidated views) */}
          {view==="ledger" && (() => { setView("books"); return null; })()}
          {view==="money-in" && (() => { setView("books"); return null; })()}
          {view==="money-out" && (() => { setView("books"); return null; })()}

          {/* HOME (Dashboard) — renders for both "home" and legacy "dashboard" */}
          {(view==="home" || view==="dashboard") && <DashboardView />}

          {/* BOOKS — consolidated transactions */}
          {view==="books" && <BooksView />}

          {/* ADD INVOICE */}
          {view==="add" && <AddView />}

          {/* ALL INVOICES */}
          {/* ACCOUNTS PAYABLE */}
          {view==="ap" && <ApView />}

          {/* ACCOUNTS RECEIVABLE */}
          {view==="ar" && <ArView />}

          {/* NEEDS REVIEW */}
          {view==="review" && <ReviewView />}

          {/* BANK FEED */}
          {view==="bank" && <BankView />}

          {view==="invoices" && <InvoicesView />}

          {/* VENDORS */}
          {view==="vendors" && <VendorsView />}

          {/* CUSTOMERS */}
          {view==="customers" && <CustomersView />}

          {/* RULES */}
          {view==="rules" && <RulesView />}

          {/* REPORTS */}
          {view==="reports" && <ReportsView />}

          {/* MATCHING ENGINE */}
          {view==="matching" && <MatchingView />}

          {/* CONTRACTS */}
          {view==="contracts" && <ContractsView />}

          {/* DETAIL */}
          {view==="detail" && selectedInvoice && <DetailView />}
          {/* ── SETTINGS ─────────────────────────────────────────────────────── */}
          {view==="settings" && <SettingsView />}

          {/* ── LEGAL (Terms & Privacy) ───────────────────────────────────────── */}
          {view==="legal" && <LegalView initialTab={legalTab} onBack={()=>setView("settings")} />}

          {/* ── TEAM (owner-only) ─────────────────────────────────────────────── */}
          {view==="team" && (isOwner ? <TeamView /> : <SettingsView />)}

          {/* ── CHART OF ACCOUNTS ─────────────────────────────────────────────── */}
          {view==="coa" && <CoaView />}

          {/* ── OPENING BALANCES ──────────────────────────────────────────────── */}
          {view==="opening-balances" && <OpeningBalancesView />}

          {/* ── SEND INVOICE ──────────────────────────────────────────────────── */}
          {view==="send-invoice" && <SendInvoiceView />}


      {/* ── PAYROLL IMPORT ─────────────────────────────────────────────── */}
          {view==="payroll" && <PayrollView />}

          {/* ── RECURRING TRANSACTIONS ─────────────────────────────────────── */}
          {view==="recurring" && <RecurringView />}

          {/* ── RECONCILIATION ────────────────────────────────────────────────── */}
          {view==="recon" && <ReconView />}

          {/* ── 1099 TRACKER ─────────────────────────────────────────────────── */}
          {view==="tax1099" && <Tax1099View />}
          {view==="tax" && <TaxView />}

          {/* ── DOCUMENT LIBRARY ─────────────────────────────────────────────── */}
          {view==="docs" && <DocsView />}

          {/* ── AUDIT TRAIL ──────────────────────────────────────────────────── */}
          {view==="audit" && <AuditView />}

          {/* ── PLATFORM ADMIN PANEL (platform admins only) ──────────────────── */}
          {view==="admin" && isPlatformAdmin && <AdminView />}

          {/* ── QBO ONBOARDING ────────────────────────────────────────────────── */}
          {view==="onboard" && <QBOImportView />}
          </div>
        </div>
      </div>

      {/* ── NOTIFICATION CENTER (Item 55) ──────────────────────────────────── */}
      {notifOpen && (() => {
        const META = {
          tax_deadline:        { icon:"📅", color:"var(--sc-error)" },
          anomaly:             { icon:"⚠",  color:"var(--sc-warning)" },
          reconciliation:      { icon:"🏦", color:"var(--sc-warning)" },
          needs_review:        { icon:"📄", color:"var(--sc-gold-deep)" },
          report_ready:        { icon:"📊", color:"var(--sc-success)" },
          monthly_report:      { icon:"🗓️", color:"var(--sc-gold)" },
          ai_action:           { icon:"✦",  color:"var(--sc-gold)" },
          recurring_suggestion:{ icon:"↻",  color:"var(--sc-gold)" },
        };
        const ago = (ts) => { if(!ts) return ""; const s=(Date.now()-new Date(ts))/1000; if(s<60) return "just now"; if(s<3600) return `${Math.floor(s/60)}m ago`; if(s<86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`; };
        return (
          <div onClick={()=>setNotifOpen(false)} style={{ position:"fixed", inset:0, zIndex:1001, background:"rgba(17,24,39,0.25)", display:"flex", justifyContent:"flex-end" }}>
            <style>{`@keyframes notifIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div onClick={e=>e.stopPropagation()} style={{ width:400, maxWidth:"94vw", height:"100%", background:"var(--sc-surface)", borderLeft:"1px solid var(--sc-border)", boxShadow:"-20px 0 60px rgba(16,24,40,0.18)", display:"flex", flexDirection:"column", animation:"notifIn .22s cubic-bezier(.22,1,.36,1)" }}>
              <div style={{ padding:"18px 20px", borderBottom:"1px solid var(--sc-surface-2)", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                <div style={{ fontSize:16, fontWeight:700, color:"var(--sc-text)" }}>Notifications</div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  {unreadNotifs>0 && <button onClick={markAllNotifsRead} style={{ fontSize:12, color:"var(--sc-gold)", background:"none", border:"none", cursor:"pointer", fontWeight:600 }}>Mark all read</button>}
                  <button onClick={()=>setNotifOpen(false)} style={{ background:"none", border:"none", color:"var(--sc-text-2)", fontSize:22, lineHeight:1, cursor:"pointer" }}>×</button>
                </div>
              </div>
              <div style={{ flex:1, overflowY:"auto" }}>
                {notifications.length===0 ? (
                  <div style={{ padding:"48px 24px", textAlign:"center", color:"var(--sc-text-mut)", fontSize:13, lineHeight:1.6 }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>🔔</div>You're all caught up. New alerts about taxes, anomalies, and reviews will show up here.
                  </div>
                ) : notifications.map(n => {
                  const m = META[n.type] || { icon:"•", color:"var(--sc-text-2)" };
                  return (
                    <div key={n.id} onClick={()=>openNotification(n)} style={{ display:"flex", gap:12, padding:"14px 18px", borderBottom:"1px solid var(--sc-surface-2)", cursor:"pointer", background:n.read?"var(--sc-surface)":"var(--sc-gold-soft)", transition:"background .12s" }}
                      onMouseEnter={e=>e.currentTarget.style.background="var(--sc-surface-2)"} onMouseLeave={e=>e.currentTarget.style.background=n.read?"var(--sc-surface)":"var(--sc-gold-soft)"}>
                      <div style={{ width:34, height:34, borderRadius:9, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, background:m.color+"18", color:m.color }}>{m.icon}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:"var(--sc-text)", lineHeight:1.4 }}>{n.title}</div>
                        {n.description && <div style={{ fontSize:12, color:"var(--sc-text-2)", marginTop:2, lineHeight:1.45 }}>{n.description}</div>}
                        <div style={{ fontSize:11, color:"var(--sc-text-mut)", marginTop:4 }}>{ago(n.created_at)}</div>
                      </div>
                      {!n.read && <span style={{ width:8, height:8, borderRadius:"50%", background:"var(--sc-gold)", flexShrink:0, marginTop:6 }} />}
                    </div>
                  );
                })}
              </div>
              {notifications.length>0 && (
                <div style={{ padding:"12px 18px", borderTop:"1px solid var(--sc-surface-2)", flexShrink:0 }}>
                  <button onClick={clearAllNotifs} style={{ width:"100%", padding:"9px", borderRadius:9, fontSize:13, fontWeight:600, color:"var(--sc-text-2)", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border)", cursor:"pointer" }}>Clear all</button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── FLOATING AI CHAT ───────────────────────────────────────────────── */}
      {/* Bubble button */}
      <button onClick={()=>{ setChatOpen(o=>!o); setHasUnread(false); }} style={{
        position:"fixed", bottom:28, right:28, width:58, height:58, borderRadius:"50%",
        background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", border:"none", cursor:"pointer",
        boxShadow:"0 8px 32px rgba(109,40,217,0.5)", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:24, zIndex:1000, animation:"popbubble 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        transition:"transform 0.2s"
      }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
        {chatOpen ? "×" : "✦"}
        {hasUnread && !chatOpen && (
          <div style={{ position:"absolute", top:4, right:4, width:12, height:12, background:"var(--sc-error)", borderRadius:"50%", border:"2px solid var(--sc-surface-2)" }} />
        )}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div style={{
          position:"fixed", bottom:100, right:28, width:440, height:560,
          background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", borderRadius:20,
          boxShadow:"0 24px 80px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column",
          zIndex:999, animation:"slideup 0.25s cubic-bezier(0.34,1.56,0.64,1)", overflow:"hidden"
        }}>
          {/* Header */}
          <div style={{ padding:"18px 20px", borderBottom:"1px solid var(--sc-border)", background:"linear-gradient(135deg,var(--sc-gold-soft),var(--sc-surface))", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>✦</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:600 }}>Shadow</div>
                  <div style={{ fontSize:11, color:"var(--sc-success)" }}>● Online · Your AI Controller</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                <button onClick={()=>setAiInfoOpen(true)} title="What can the assistant do?"
                  style={{ width:26, height:26, borderRadius:8, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>?</button>
                <button onClick={()=>setChatHistoryView(v=>!v)} title="Action history"
                  style={{ fontSize:11, padding:"5px 11px", borderRadius:8, background:chatHistoryView?"var(--sc-gold)":"var(--sc-surface)", border:`1px solid ${chatHistoryView?"var(--sc-gold)":"var(--sc-border-2)"}`, color:chatHistoryView?"var(--sc-surface)":"var(--sc-text-2)", cursor:"pointer", whiteSpace:"nowrap" }}>
                  {chatHistoryView ? "← Chat" : "History"}
                </button>
              </div>
            </div>
          </div>

          {/* AI Capability Document — what the assistant can and cannot do (sandbox doc) */}
          {aiInfoOpen && (
            <div onClick={()=>setAiInfoOpen(false)} style={{ position:"absolute", inset:0, zIndex:5, background:"rgba(16,24,40,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:18 }}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"var(--sc-surface)", border:"1px solid var(--sc-border)", borderRadius:16, width:"100%", maxHeight:"100%", overflowY:"auto", boxShadow:"0 20px 60px rgba(16,24,40,0.25)" }}>
                <div style={{ padding:"16px 18px", borderBottom:"1px solid var(--sc-surface-2)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"var(--sc-text)" }}>Your AI CFO</div>
                  <button onClick={()=>setAiInfoOpen(false)} style={{ background:"none", border:"none", fontSize:20, lineHeight:1, color:"var(--sc-text-2)", cursor:"pointer" }}>×</button>
                </div>
                <div style={{ padding:"14px 18px" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:"var(--sc-text)", marginBottom:12 }}>{AI_CAPABILITIES.canTitle}</div>
                  <ul style={{ margin:0, padding:0, listStyle:"none" }}>
                    {AI_CAPABILITIES.can.map((t,i)=>(
                      <li key={i} style={{ display:"flex", gap:8, fontSize: 13, color:"var(--sc-text-2)", lineHeight:1.5, marginBottom:9 }}>
                        <span style={{ color:"var(--sc-success)", flexShrink:0 }}>✓</span><span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          <div ref={chatScrollRef} style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px" }}>
            {chatHistoryView ? (() => {
              const timeline = chatHistory.filter(m => m.role==="assistant" && (m.actions||[]).length>0).slice().reverse();
              if (timeline.length===0) return <div style={{ padding:"30px 8px", textAlign:"center", color:"var(--sc-text-2)", fontSize:12, lineHeight:1.6 }}>No actions yet. When you ask me to recode transactions, add accounts, or set rules, they'll appear here as a timeline.</div>;
              const bucketOf = (d) => {
                if (!d) return "Earlier";
                const now = new Date(); const dt = new Date(d);
                const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const days = Math.floor((start - new Date(dt.getFullYear(), dt.getMonth(), dt.getDate())) / 86400000);
                if (days <= 0) return "Today";
                if (days === 1) return "Yesterday";
                if (days <= 7) return "Last Week";
                return "Earlier";
              };
              let lastBucket = null;
              return (
                <div>
                  {timeline.map((m,i)=>{
                    const bucket = bucketOf(m.created_at);
                    const showHeader = bucket !== lastBucket; lastBucket = bucket;
                    return (
                    <React.Fragment key={m.id||i}>
                      {showHeader && <div style={{ fontSize:10, letterSpacing:1, color:"var(--sc-text-2)", fontWeight:700, margin: i===0?"0 0 12px":"18px 0 12px" }}>{bucket.toUpperCase()}</div>}
                      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                        <div style={{ flexShrink:0, width:8, display:"flex", flexDirection:"column", alignItems:"center" }}>
                          <div style={{ width:8, height:8, borderRadius:"50%", background:"var(--sc-gold)", marginTop:3 }} />
                          {i<timeline.length-1 && <div style={{ flex:1, width:2, background:"var(--sc-border)", marginTop:2 }} />}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, color:"var(--sc-text-2)", marginBottom:4 }}>{m.created_at ? new Date(m.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : ""}</div>
                          {(m.actions||[]).map((a,j)=>(
                            <div key={j} style={{ fontSize:12, color:"var(--sc-text)", lineHeight:1.5, display:"flex", gap:6, marginBottom:3 }}>
                              <span style={{ color:"var(--sc-gold)", flexShrink:0 }}>⚡</span><span>{a}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </React.Fragment>
                    );
                  })}
                </div>
              );
            })() : (<>
            {chatHistory.map((msg, idx)=>(
              <div key={msg.id||idx} style={{ marginBottom:14, display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start" }}>
                {msg.role==="assistant" && (
                  <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0, marginRight:8, marginTop:2 }}>✦</div>
                )}
                <div style={{ maxWidth:"80%" }}>
                  {(() => {
                    // Normalize the reply: trim, and collapse runs of blank lines so
                    // pre-wrap can't render a big empty gap. Skip the bubble entirely
                    // when there's no text (e.g. a chart-only reply) so no empty bubble
                    // sits above the chart.
                    const text = String(msg.content || "").replace(/\n{3,}/g, "\n\n").trim();
                    if (!text) return null;
                    return (
                      <div style={{
                        padding:"10px 14px", borderRadius:msg.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",
                        background:msg.role==="user"?"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))":"var(--sc-surface-2)",
                        fontSize:13, lineHeight:1.6, color:msg.role==="user"?"var(--sc-surface)":"var(--sc-text)", whiteSpace:"pre-wrap"
                      }}>{text}</div>
                    );
                  })()}
                  {msg.actions?.length>0 && (
                    <div style={{ marginTop:10, background:"var(--sc-success-soft)", border:"1px solid var(--sc-success-soft)", borderRadius:12, padding:"12px 14px" }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"var(--sc-success)", letterSpacing:1, marginBottom:8 }}>✓ ACTIONS TAKEN</div>
                      {msg.actions.map((a,i)=>(
                        <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:"var(--sc-success)", marginBottom: i < msg.actions.length-1 ? 6 : 0, lineHeight:1.4 }}>
                          <span style={{ color:"var(--sc-success)", flexShrink:0, marginTop:1 }}>⚡</span>
                          <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.role==="assistant" && msg.rich?.length>0 && (
                    <ChatRichOutput rich={msg.rich} onNavigate={(rv)=>{
                      setChatOpen(false);
                      if (rv==="vendor") { setView("books"); setBooksFilter && setBooksFilter("expenses"); }
                      else { setView("reports"); }
                    }} />
                  )}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>✦</div>
                <div style={{ padding:"10px 14px", background:"var(--sc-border)", borderRadius:"16px 16px 16px 4px" }}>
                  <div style={{ display:"flex", gap:4 }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"var(--sc-text-2)", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                  </div>
                </div>
              </div>
            )}
            {/* ── DESTRUCTIVE-ACTION CONFIRMATION GATE (CR-9) ── the mutation runs only
                 when the user clicks Confirm; Cancel discards it with no write. ── */}
            {pendingAIActions && (
              <div style={{ margin:"0 0 14px", border:"1px solid var(--sc-warning)", background:"var(--sc-warning-soft)", borderRadius:12, padding:"12px 14px" }}>
                <div style={{ fontSize:12, fontWeight:700, color:"var(--sc-warning)", marginBottom:8, display:"flex", alignItems:"center", gap:6 }}>
                  <span>⚠</span> Confirm before I make {pendingAIActions.items.length===1?"this change":"these changes"}
                </div>
                {pendingAIActions.items.map((it, i) => (
                  <div key={i} style={{ fontSize:13, color:"var(--sc-text)", marginBottom:8 }}>
                    <div style={{ fontWeight:600 }}>{it.description}</div>
                    {it.targets?.length > 0 && (
                      <ul style={{ margin:"3px 0 0", paddingLeft:18 }}>
                        {it.targets.slice(0,10).map((t,j)=>(<li key={j} style={{ fontSize:12, color:"var(--sc-text-2)", lineHeight:1.5 }}>{t.label}</li>))}
                        {it.targets.length>10 && <li style={{ fontSize:12, color:"var(--sc-text-2)" }}>…and {it.targets.length-10} more</li>}
                      </ul>
                    )}
                  </div>
                ))}
                <div style={{ display:"flex", gap:8, marginTop:4 }}>
                  <button onClick={confirmAIActions} style={{ padding:"7px 16px", borderRadius:8, fontSize:13, fontWeight:600, background:"var(--sc-error)", border:"none", color:"var(--sc-on-accent)", cursor:"pointer" }}>Confirm</button>
                  <button onClick={cancelAIActions} style={{ padding:"7px 16px", borderRadius:8, fontSize:13, fontWeight:600, background:"var(--sc-surface)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer" }}>Cancel</button>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
            </>)}
          </div>

          {/* Suggestions */}
          {!chatHistoryView && chatHistory.length < 3 && (
            <div style={{ padding:"0 16px 8px", display:"flex", flexWrap:"wrap", gap:6 }}>
              {["What's my burn rate?","Show me unpaid bills","What's my P&L this month?","Did anything need my attention?"].map(s=>(
                <button key={s} onClick={()=>{ setChatInput(s); chatInputRef.current?.focus(); }} style={{ fontSize:11, padding:"5px 10px", borderRadius:20, background:"var(--sc-border)", border:"1px solid var(--sc-border-2)", color:"var(--sc-text-2)", cursor:"pointer", textAlign:"left" }}>{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding:"12px 16px", borderTop:"1px solid var(--sc-border)", display:"flex", gap:8, flexShrink:0 }}>
            <input ref={chatInputRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&handleChatSend()}
              placeholder="Ask anything about your books..."
              style={{ flex:1, background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:10, padding:"10px 14px", color:"var(--sc-text)", fontSize:13, outline:"none", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }} />
            <button onClick={handleChatSend} disabled={chatLoading||!chatInput.trim()} style={{
              width:40, height:40, borderRadius:10, background:(chatLoading||!chatInput.trim())?"var(--sc-border)":"linear-gradient(135deg,var(--sc-gold),var(--sc-gold))",
              border:"none", color:"var(--sc-text)", cursor:(chatLoading||!chatInput.trim())?"not-allowed":"pointer", fontSize:16, flexShrink:0
            }}>↑</button>
          </div>
        </div>
      )}
    </div>
    </ERPContext.Provider>
  );
}

export default AppWrapper;
