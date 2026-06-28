import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { supabase, getAuthHeaders } from "./lib/supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS, AI_MODEL, AI_PROXY_URL, CAPITALIZE_THRESHOLD, CAPITALIZE_CHECK_THRESHOLD, MEALS_DEDUCTIBLE_RATE, DEFAULT_IBR, AI_CONFIDENCE_AUTO_BOOK, AI_CONFIDENCE_REVIEW, AP_AUTO_APPROVE_THRESHOLD, PLATFORM_ADMIN_EMAILS } from "./lib/constants";
import { useAccounts } from "./hooks/useAccounts";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType, calcASC842 } from "./lib/gl";
import { initials, vendorColor } from "./lib/format";
import { classifyIntent, runAIBrain, okAIResponse, callAIProxy } from "./lib/ai";
import { buildMonthlyReport, priorPeriod, formatPeriod, computeRevenue, computeExpenses, computeNetIncome, liveEntries, glAccountBalance, glCashOnHand } from "./lib/reports";
import { loadClientProfile, learnFromBooking, persistClientProfile, emptyProfile, addCustomRule } from "./lib/clientProfile";
import { isAllowedAIAction, isMutatingAIAction, AI_CAPABILITIES } from "./lib/aiCapabilities";
import { findDuplicate, detectRecurringPatterns, runAnomalyDetection } from "./lib/insights";
import { getTaxDeadlines, taxEstimate } from "./lib/tax";
import { buildApprovalUpdate, buildAccountInsert, buildCompanyUpdate, mapCompanyRow } from "./lib/writeShapes";
import { buildPaymentEntry } from "./lib/payments";
import { planBankImport, isArMatch, buildBankLineEntry, reconRecordStatus, allClearingsPosted, shouldRunApMatching } from "./lib/bankMatch";
import { glCodeForAccountType } from "./lib/bankAccounts";
import { enterSupportState, exitSupportState } from "./lib/supportMode";
import { pickActiveCompany } from "./lib/companies";
import { companyIdentityNames, classifyDocDirection } from "./lib/docDirection";
import { composeAssistantReply } from "./lib/chatReply";
import { buildReversalLines, buildJournalEntry } from "./lib/journalEntries";
import { buildDepreciationEntry, buildDepreciationSchedule, suggestUsefulLifeMonths, planDepreciationRun, depreciationDue } from "./lib/depreciation";
import { buildDeferredRevenueReceiptEntry, buildArInvoiceEntry } from "./lib/revenueEntries";
import { buildPrepaidCapitalizeEntry, buildPrepaidSchedule } from "./lib/prepaid";
import { detectFileType, TYPE_LABEL, planUniversalSpreadsheetRoute, classifyDocReply } from "./lib/fileDetect";
import { buildOpeningBalanceEntry, isBeforeCutoff, preCutoffActivity, hasPreCutoffActivity, bookingBlockedReason, PRE_CUTOFF_MESSAGE, OBE_CODE, OBE_ROLE } from "./lib/openingBalances";
import { flattenJournalEntries, fetchLedger, resolveEntryDbId } from "./lib/ledger";
import { Sentry, setSentryUser, clearSentryUser } from "./lib/sentry";
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
        <p style={{ fontSize:14, color:"var(--sc-text-2)", lineHeight:1.6, margin:"0 0 20px" }}>Our team has been notified. Refreshing usually fixes it.</p>
        <button onClick={()=>window.location.reload()}
          style={{ padding:"11px 22px", borderRadius:10, background:"var(--sc-gold)", border:"none", color:"var(--sc-on-accent)", fontSize:14, fontWeight:600, cursor:"pointer" }}>Refresh</button>
      </div>
    </div>
  );
}

function ERP({ session, currentCompany, companies, onSwitchCompany, onNewCompany, onSignOut, supabase, persistedView, onViewChange }) {
  // ── Team roles (Item 20). owner < admin < member. Default to "owner" when a role
  // isn't present (single-user / legacy) so existing accounts keep full access.
  const userRole = currentCompany?.role || "owner";
  const isOwner = userRole === "owner";
  const isAdmin = userRole === "owner" || userRole === "admin";
  const isMember = userRole === "member";

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
  const [form, setForm] = useState({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"" });
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

  // Reports state
  const [reportType, setReportType] = useState("pl");
  const [reportRange, setReportRange] = useState(() => ss("cfai_reportRange", "custom"));
  const [reportDateFrom, setReportDateFrom] = useState(() => ss("cfai_reportDateFrom", new Date().getFullYear() + "-01-01"));
  const [reportDateTo, setReportDateTo] = useState(() => ss("cfai_reportDateTo", new Date().toISOString().slice(0,10)));
  // Persist filter/report UI state whenever it changes.
  useEffect(() => { try {
    sessionStorage.setItem("cfai_booksFilter", booksFilter);
    sessionStorage.setItem("cfai_vendorFilter", vendorFilter);
    sessionStorage.setItem("cfai_reportRange", reportRange);
    sessionStorage.setItem("cfai_reportDateFrom", reportDateFrom);
    sessionStorage.setItem("cfai_reportDateTo", reportDateTo);
  } catch {} }, [booksFilter, vendorFilter, reportRange, reportDateFrom, reportDateTo]);
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
    setDocLibrary(prev => [doc, ...prev]);
    if (!currentCompany?.id) {
      console.warn("[documents] storeDocument: no currentCompany.id — NOT persisting", { name, type });
      reportDocError(queueItemId, "no active company — document was not saved.");
      return doc.id;
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
    };
    try {
      const { data, error } = await supabase.from("documents").insert(payload).select("id").single();
      if (error) {
        console.error("[documents] insert FAILED:", error.message, error.details || "", error.hint || "", error);
        // ── 3. Roll back the uploaded file so it isn't orphaned ──
        if (storagePath) { try { await supabase.storage.from("documents").remove([storagePath]); } catch {} }
        reportDocError(queueItemId, error.message || "missing documents table — apply migration 002.");
        return doc.id;
      }
      if (queueItemId) setUploadQueue(prev => prev.map(q => q.id === queueItemId ? { ...q, docError: undefined } : q));
      setDocLibrary(prev => prev.map(d => d.id === doc.id ? { ...d, id: data?.id || d.id, storage_path: storagePath, linked_invoice_id: effLinkedId != null ? String(effLinkedId) : d.linked_invoice_id } : d));
    } catch (e) {
      console.error("[documents] insert threw:", e);
      if (storagePath) { try { await supabase.storage.from("documents").remove([storagePath]); } catch {} }
      reportDocError(queueItemId, e?.message || "network error saving document.");
    }
    return doc.id;
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

  // AP state
  const [apView, setApView] = useState("inbox"); // inbox | queue | approvals | aging
  const [apAgingNarration, setApAgingNarration] = useState(null);
  const [apAgingLoading, setApAgingLoading] = useState(false);
  const [checkRunMode, setCheckRunMode] = useState(false);
  const [selectedPayments, setSelectedPayments] = useState(new Set());
  const [apSettings] = useState({ autoApproveThreshold: AP_AUTO_APPROVE_THRESHOLD });
  const [cashBalance, setCashBalance] = useState("");
  const CHAT_GREETING = "Hey — I'm Shadow. Just upload your documents on Home and I'll handle the bookkeeping. Ask me anything — your burn rate, P&L, unpaid bills — or tell me what to do and I'll take you there. What do you need?";
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: CHAT_GREETING, id: 0 }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatHistoryView, setChatHistoryView] = useState(false); // History timeline toggle
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
  const [openingBalAsOfDate, setOpeningBalAsOfDate] = useState(new Date().toISOString().slice(0,10));
  const [openingBalBalances, setOpeningBalBalances] = useState({});
  const [sendInvoiceDraftState, setSendInvoiceDraftState] = useState(null);
  const [sendInvoiceShowPreview, setSendInvoiceShowPreview] = useState(false);
  const [recurringNewRec, setRecurringNewRec] = useState({name:"",vendor:"",amount:"",gl_code:rc("rent_occupancy"),gl_name:rn("rent_occupancy"),frequency:"monthly",next_date:new Date().toISOString().slice(0,10),project:"General"});
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
    // Loaded data sets (loadAllData refetches these for the new company)
    setInvoices([]); invoicesRef.current = [];
    setVisibilityAlert(false); pendingVerifyRef.current.clear();
    setRules([]); setContacts([]); setCustomProjects([]);
    setContracts([]); setRecurring([]); setAuditLog([]); setDocLibrary([]);
    setBankTransactions([]); setUnknownDocs([]); setUploadQueue([]);
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

    // Filters / per-tab view selections
    setBooksFilter("all"); setVendorFilter("all");
    setApView("inbox"); setArView("inbox");
    setDocsFilterType("all"); setAuditSearch(""); setAuditActionFilter("all");
    setBasisMode("accrual"); setReportType("pl");
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
    setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"" });
    setVendorsEditingId(null); setVendorsEditDraft({});
    setCustomersEditingId(null); setCustomersEditDraft({});
    setSettingsDraft(null); setSettingsSaved(false); setSettingsLogoPreview(null);
    setCoaEditingCode(null); setCoaEditDraft({}); setCoaAddDraft({ code:"", name:"", category:"Expenses" }); setCoaShowAdd(false);
    setOpeningBalAsOfDate(new Date().toISOString().slice(0,10)); setOpeningBalBalances({});
    setSendInvoiceDraftState(null); setSendInvoiceShowPreview(false); setSentInvoiceDraft(null);
    setRecurringNewRec({ name:"", vendor:"", amount:"", gl_code:rc("rent_occupancy"), gl_name:rn("rent_occupancy"), frequency:"monthly", next_date:new Date().toISOString().slice(0,10), project:"General" });
    setCashBalance("");

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
    setAnomalies([]);
    setNotifications([]); setNotifOpen(false);
    setOnboardingUploadDone(false); setBusinessModalOpen(false);
  };

  // ── SUPABASE DATA LOADING ──────────────────────────────────
  useEffect(() => {
    if (!currentCompany?.id) return;
    resetCompanyState();   // clear the previous company's state before loading the new one
    loadAllData();
  }, [currentCompany?.id]);

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
    try {
      // Load journal entries — expand each line individually for correct balance sheet mapping
      const { data: entries } = await supabase
        .from("journal_entries")
        .select("*, journal_entry_lines(*, accounts(code,name))")
        .eq("company_id", cid)
        .eq("status", "posted")
        .is("deleted_at", null)
        .order("entry_date", { ascending: false })
        .limit(500);

      if (entries) {
        // Flatten via the shared single-source-of-truth mapper (src/lib/ledger.js),
        // the same one the AI tool layer uses, so the two can never diverge.
        const mapped = flattenJournalEntries(entries, CHART_OF_ACCOUNTS);
        setInvoices(mapped);
      }

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
        // Dashboard cash balance = sum of bank account balances (so it's no longer $0).
        const cashSum = mappedBanks.reduce((s, b) => s + (Number(b.current_balance) || 0), 0);
        if (cashSum !== 0) setCashBalance(String(cashSum));
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

      // Load persisted notifications (defensive). Anomaly scanning + notification
      // generation are driven by effects below (so they read fresh state, not stale refs).
      await loadNotifications(cid);

    } catch(e) { console.error("loadAllData error:", e); }
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
        return created;
      };

      const isDebit = invoice.debit_credit !== "credit";
      const primaryAcct    = await ensureAccount(invoice.gl_code, invoice.gl_name);
      const secondaryAcct  = await ensureAccount(invoice.secondary_gl_code || rc("accounts_payable"), invoice.secondary_gl_name || rn("accounts_payable"));
      if (!primaryAcct) { console.error("persistJournalEntry: no primary account", invoice.gl_code); return null; }

      const amt = Number(invoice.amount) || 0;
      const memo = invoice.description;
      const entryDate   = invoice.date || new Date().toISOString().slice(0,10);
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
        due_date: invoice.due_date || null,
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
        return created;
      };
      const resolved = [];
      for (const l of entry.lines) {
        const acct = await ensureAccount(l.code, l.name);
        if (!acct) { console.error("persistMultiLineEntry: no account for code", l.code); showNotification(`Couldn't resolve account ${l.code}`, "error"); return null; }
        resolved.push({ account_id: acct.id, debit: l.debit, credit: l.credit, memo: l.memo || entry.description });
      }
      const entryDate = entry.date || new Date().toISOString().slice(0,10);
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
    await reloadAccounts();
    return data?.id || null;
  };

  // Post (or re-post) opening balances. `gridBalancesByCode` = { code: natural balance }
  // for the user-entered accounts; bank-linked cash is overridden from bank balances.
  const postOpeningBalances = async (gridBalancesByCode) => {
    if (!currentCompany?.id || !session?.user?.id) { showNotification("No active company", "error"); return false; }
    const cutoff = cutoffDate;
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

    // Edit = reverse/replace: soft-delete any prior opening JE + clear prior rows.
    try {
      const { data: priorJEs } = await supabase.from("journal_entries").select("id")
        .eq("company_id", currentCompany.id).eq("source", "opening_balance").is("deleted_at", null).eq("status", "posted");
      for (const je of (priorJEs || []))
        await supabase.from("journal_entries").update({ deleted_at: new Date().toISOString(), deleted_by: session.user.id }).eq("id", je.id).eq("company_id", currentCompany.id);
      await supabase.from("opening_balances").delete().eq("company_id", currentCompany.id);
    } catch (e) { console.warn("[opening] prior cleanup:", e?.message || e); }

    // Resolve account ids and post the one balanced entry through the canonical RPC.
    const rpcLines = [];
    for (const l of lines) {
      const aid = await ensureAccountIdForCode(l.code);
      if (!aid) { showNotification(`Couldn't resolve account ${l.code}`, "error"); return false; }
      rpcLines.push({ account_id: aid, debit: l.debit, credit: l.credit, memo: "Opening balance" });
    }
    const { data: rpcData, error } = await supabase.rpc("post_journal_entry", {
      p_company_id: currentCompany.id, p_entry_date: cutoff, p_description: `Opening balances as of ${cutoff}`,
      p_source: "opening_balance", p_created_by: session.user.id, p_lines: rpcLines, p_meta: {},
    });
    if (error) { showNotification("Couldn't post opening balances — " + error.message, "error"); return false; }
    const jeId = rpcData?.id || rpcData?.entry?.id || null;

    // Write opening_balances rows (one per account, natural balance) linked to the JE.
    try {
      const rows = [];
      for (const [code, val] of Object.entries(merged)) {
        const bal = Math.round((Number(val) || 0) * 100) / 100;
        if (bal === 0) continue;
        const aid = await ensureAccountIdForCode(code);
        if (aid) rows.push({ company_id: currentCompany.id, account_id: aid, balance: bal, as_of_date: cutoff, journal_entry_id: jeId, posted: true });
      }
      const obe = lines.find(l => l.code === OBE_CODE);
      if (obe) { const aid = await ensureAccountIdForCode(OBE_CODE); if (aid) rows.push({ company_id: currentCompany.id, account_id: aid, balance: (obe.credit || 0) - (obe.debit || 0), as_of_date: cutoff, journal_entry_id: jeId, posted: true }); }
      if (rows.length) await supabase.from("opening_balances").insert(rows);
    } catch (e) { console.warn("[opening] rows insert:", e?.message || e); }

    logAudit("opening_balances_posted", `Opening balances posted as of ${cutoff} (${lines.length} lines)`, null, { cutoff, je: jeId ? String(jeId) : null });
    try { await loadAllData(); } catch {}
    showNotification(`Opening balances posted as of ${cutoff} ✓`);
    return true;
  };

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
      frequency: "monthly", next_date: new Date().toISOString().slice(0, 10),
      project: "General", active: true, created_at: new Date().toISOString(), last_run: null,
    };
    setRecurring(prev => [newRec, ...prev]);
    logAudit("recurring_created", `Recurring set up from detected pattern: ${s.vendor} ~$${s.avgAmount}/mo → ${s.gl_name || s.gl_code}`, null, { vendor: s.vendor, amount: s.avgAmount, gl_code: s.gl_code, gl_name: s.gl_name, frequency: "monthly" });
    try {
      clientProfileRef.current = addCustomRule(clientProfileRef.current, `Recurring pattern detected: ${s.vendor} ~$${Math.round(s.avgAmount)}/mo → ${s.gl_name || s.gl_code}`);
      persistClientProfile(supabase, currentCompany?.id, clientProfileRef.current);
    } catch {}
    dismissedRecurringRef.current.add(s.vendorKey);
    setRecurringSuggestions(prev => prev.filter(x => x.vendorKey !== s.vendorKey));
    showNotification(`Recurring set up: ${s.vendor} ~$${Math.round(s.avgAmount)}/mo ✓`);
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
    setCashBalance(String(cashFromBanks(list)));
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

  // ── ANOMALY DETECTION (Item 32) ─────────────────────────────────────────────
  // Runs on the loaded invoices after load + after every booking. Dismissed ids
  // persist in localStorage (per company) so they don't keep reappearing.
  const [anomalies, setAnomalies] = useState([]);
  const dismissedAnomKey = () => `cfai_dismissed_anomalies_${currentCompany?.id || "x"}`;
  const getDismissedAnoms = () => { try { return new Set(JSON.parse(localStorage.getItem(dismissedAnomKey()) || "[]")); } catch { return new Set(); } };
  const runAnomalyScan = () => {
    try {
      const dismissed = getDismissedAnoms();
      const found = runAnomalyDetection(invoicesRef.current, recurringRef.current).filter(a => !dismissed.has(a.id));
      setAnomalies(found);
    } catch (e) { console.warn("[anomaly] scan failed:", e?.message || e); }
  };
  const dismissAnomaly = (id) => {
    try {
      const d = getDismissedAnoms(); d.add(id);
      localStorage.setItem(dismissedAnomKey(), JSON.stringify([...d]));
    } catch {}
    setAnomalies(prev => prev.filter(a => a.id !== id));
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
      if (Array.isArray(data)) setNotifications(data);
    } catch { /* table may be absent */ }
  };
  // Insert a notification unless a same-type one already exists in the last 24h.
  const createNotification = async ({ type, title, description = null, link_view = null }) => {
    const cid = currentCompany?.id;
    if (!cid || !type || !title) return;
    try {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const { data: recent } = await supabase.from("notifications")
        .select("id").eq("company_id", cid).eq("type", type).gte("created_at", since).limit(1);
      if (Array.isArray(recent) && recent.length) return; // dedup within 24h
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
        const amt = nextDue.est && est.quarterly > 0 ? ` — est. $${Math.round(est.quarterly).toLocaleString("en-US")}` : "";
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
      // High-severity anomalies.
      const dismissed = getDismissedAnoms();
      const topAnom = runAnomalyDetection(invoicesRef.current, recurringRef.current).find(a => a.severity === "high" && !dismissed.has(a.id));
      if (topAnom) {
        // Route the alert straight to the flagged transaction when the anomaly carries
        // one (e.g. "possible duplicate payment") — encode it in link_view as `txn:<id>`,
        // which openNotification opens in the detail panel. Falls back to home otherwise.
        const anomTxn = (topAnom.invoice_ids || [])[0];
        createNotification({ type: "anomaly", title: topAnom.title, description: topAnom.description, link_view: anomTxn != null ? `txn:${anomTxn}` : "home" });
      }
    } catch (e) { console.warn("[notifications] generate failed:", e?.message || e); }
  };

  // ── AUTOMATIC MONTHLY REPORTS (Item 11) ──────────────────────────────────────
  // AI-written 3-5 sentence executive summary; falls back to the templated one
  // baked into the payload by buildMonthlyReport if the proxy call fails.
  const generateExecSummary = async (period, payload) => {
    try {
      const pl = payload.pl;
      const prompt = `Write a 3-5 sentence executive summary of this small business's ${formatPeriod(period)} financials, addressed to the owner. Plain English, specific numbers, warm but direct CFO tone. No markdown, no bullet points, no headings — just sentences.

Revenue: $${pl.revenue.current} (prior month $${pl.revenue.prior})
Total expenses: $${pl.expenses_total.current} (prior $${pl.expenses_total.prior})
Net income: $${pl.net_income.current} (prior $${pl.net_income.prior})
Cash on hand: $${payload.cash.cash_on_hand}; monthly burn: $${payload.cash.burn_rate}; runway: ${payload.cash.runway_months ?? "n/a"} months
Receivables: $${payload.receivables.total} ($${payload.receivables.overdue} overdue); Payables: $${payload.payables.total} ($${payload.payables.overdue} overdue)
Top vendors: ${payload.top_vendors.map(v => `${v.vendor} $${v.total}`).join(", ") || "none"}
Health score: ${payload.health.score}/100 (${payload.health.tier})
${payload.anomalies.length ? "Flags: " + payload.anomalies.map(a => a.title).join("; ") : "No anomalies flagged."}

Reply with ONLY the summary text.`;
      const data = await callAIProxy({
        model: AI_MODEL, max_tokens: 400,
        system: "You are a CFO writing a brief, plain-English monthly summary for a small-business owner. No markdown.",
        messages: [{ role: "user", content: prompt }],
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
  // initial load and every booking). Declared after the ref-sync effects above so
  // it reads fresh data; runAnomalyScan filters out localStorage-dismissed ids.
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
    try {
      const { data: existing } = await supabase.from("journal_entries").select("id")
        .eq("company_id", currentCompany.id).eq("import_metadata->>reverses", String(origId))
        .is("deleted_at", null).eq("status", "posted").limit(1);
      if (Array.isArray(existing) && existing.length) { showNotification("Already reversed", "error"); return existing[0].id; }
    } catch { /* probe failed — proceed (post is still idempotent enough for the UI) */ }

    const { data: orig, error: loadErr } = await supabase.from("journal_entries")
      .select("entry_date, description, journal_entry_lines(account_id, debit, credit, memo)")
      .eq("id", origId).eq("company_id", currentCompany.id).single();
    if (loadErr || !orig) { showNotification("Couldn't load the entry to reverse", "error"); return null; }
    const lines = buildReversalLines(orig.journal_entry_lines);
    if (!lines.length) { showNotification("Nothing to reverse on that entry", "error"); return null; }

    const { data: rpcData, error: rpcErr } = await supabase.rpc("post_journal_entry", {
      p_company_id: currentCompany.id, p_entry_date: new Date().toISOString().slice(0, 10),
      p_description: `REVERSAL: ${orig.description || invoice.vendor || "entry"}${reason ? ` — ${reason}` : ""}`,
      p_source: "manual", p_created_by: session.user.id, p_lines: lines, p_meta: {},
    });
    if (rpcErr) { console.error("[reverse] post failed:", rpcErr.message); showNotification("Couldn't post the reversal — " + rpcErr.message, "error"); return null; }
    const revId = rpcData?.id || rpcData?.entry?.id || null;
    if (revId) {
      try {
        await supabase.from("journal_entries").update({ import_metadata: { kind: "reversal", reverses: String(origId) } })
          .eq("id", revId).eq("company_id", currentCompany.id);
      } catch (e) { console.warn("[reverse] link write failed:", e?.message || e); }
    }
    logAudit("entry_reversed", `Reversed ${invoice.vendor || orig.description || "entry"} · $${(invoice.amount || 0).toFixed(2)}${reason ? ` — ${reason}` : ""}`,
      null, { reverses: String(origId), reversal_id: revId ? String(revId) : null }, byAI ? "AI Chat" : "owner");
    return revId;
  };

  // "Void" now posts a persisted reversing entry (was local-only, never durable).
  // Undo soft-deletes the reversal so the original stands alone again.
  const voidInvoiceWithUndo = async (invoice, reason, byAI=false) => {
    if (!invoice) return;
    const snap = { ...invoice };
    const revId = await reverseJournalEntry(invoice, reason || "Voided", byAI);
    if (!revId) return;                                // failure already toasted
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
    if (currentCompany?.id) {
      for (const s of snaps) {
        if (!s.db_id) continue;
        const { error } = await supabase.from("contracts")
          .update({ deleted_at: new Date().toISOString(), deleted_by: uid })
          .eq("id", s.db_id).eq("company_id", currentCompany.id);
        if (error) console.error("softDeleteContracts failed:", error.message);
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
  };
  const softDeleteContract = (contract, byAI=false) => softDeleteContracts([contract], byAI);

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
  const fmtMoney = n => "$"+(Math.round((Number(n)||0)*100)/100).toLocaleString("en-US",{minimumFractionDigits:2});
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
          explanation: `Money received before you deliver the goods or service is a liability (Deferred Revenue) under GAAP — not revenue yet. You recognize it as revenue when it's earned.`,
          options: [
            { label: "Already delivered — recognize as revenue now", bookAsIs: true,
              reasoning: `Recognized as revenue now — the performance obligation was already satisfied.` },
            { label: "Paid in advance — defer it", deferredRevenueReceipt: true,
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
        explanation:`Under GAAP (ASC 360), purchases over $2,500 with a useful life greater than one year must be capitalized as fixed assets and depreciated over their useful life rather than expensed immediately. This affects both your balance sheet and your taxes.`,
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
        explanation:`When an invoice pays for several months of service up front, GAAP records it as a prepaid asset and recognizes the expense evenly over the coverage period.`,
        options:[
          { label:"3 months or less — expense it now", gl_code: invoice.gl_code, gl_name: invoice.gl_name,
            reasoning:`Expensed immediately — coverage is 3 months or less, so prepaid treatment isn't needed.` },
          { label:"6 months", prepaidMonths:6, reasoning:`Recorded as Prepaid Expenses (1300) and amortized evenly over 6 months from ${invoice.date} to ${invoice.gl_name}.` },
          { label:"12 months (annual)", prepaidMonths:12, reasoning:`Recorded as Prepaid Expenses (1300) and amortized evenly over 12 months from ${invoice.date} to ${invoice.gl_name}.` },
        ] };
    }

    // C) Leasehold improvements
    if (amt >= 1000 && GAAP_LEASEHOLD_RE.test(text)) {
      return { ...base, gaapType:"leasehold",
        question:`Is this a permanent improvement, and to a space you lease or own?`,
        explanation:`Permanent improvements to a leased space are capitalized as leasehold improvements and amortized over the lease term. Improvements to property you own are capitalized and depreciated. Routine repairs are expensed right away.`,
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
    const startDate = inv.date || new Date().toISOString().slice(0, 10);

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
  // compensates the capitalization JE when ok is false. Posting happens later via
  // runDepreciationThrough. Also the reusable path for back-filling an existing JE
  // (pass sourceJournalEntryId; this posts NO capitalization entry of its own).
  const createFixedAssetWithSchedule = async ({ invoice, sourceJournalEntryId, usefulLifeMonths, salvageValue = 0, inServiceDate }) => {
    if (!currentCompany?.id) return { ok: false, error: "no active company" };
    const cost = Number(invoice.amount) || 0;
    const depExpCode = rc("depreciation_amortization") || "6900";
    const accumCode = rc("accumulated_depreciation") || "1510";
    const inService = inServiceDate || invoice.date || new Date().toISOString().slice(0,10);
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
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase.from("depreciation_schedule")
        .select("asset_id, period_date, status").eq("company_id", currentCompany.id).eq("status", "pending");
      if (error) throw error;
      setDepreciationDueInfo(depreciationDue(data || [], today));
    } catch { setDepreciationDueInfo({ count: 0, throughDate: "", assets: 0 }); }
  };

  const runDepreciationThrough = async (throughDate) => {
    if (!currentCompany?.id) return { posted: 0 };
    const cutoff = throughDate || new Date().toISOString().slice(0,10);
    let rows;
    try {
      const { data, error } = await supabase.from("depreciation_schedule")
        .select("id, asset_id, period_index, period_date, amount, status, fixed_assets!inner(vendor, description, dep_expense_code, accum_dep_code, useful_life_months)")
        .eq("company_id", currentCompany.id).eq("status", "pending");
      if (error) throw error;
      rows = data || [];
    } catch (e) { console.error("runDepreciation load:", e?.message || e); showNotification("Couldn't load the depreciation schedule", "error"); return { posted: 0 }; }

    const { due, assetsToFlip } = planDepreciationRun(rows, cutoff);
    if (due.length === 0) { showNotification("No depreciation due in that period"); return { posted: 0 }; }

    let posted = 0;
    for (const row of due) {
      const a = row.fixed_assets || {};
      const je = buildDepreciationEntry({
        amount: row.amount, depExpCode: a.dep_expense_code || "6900", accumDepCode: a.accum_dep_code || "1510",
        date: row.period_date,
        description: `Depreciation — ${a.vendor || a.description || "asset"} (${row.period_index}/${a.useful_life_months || "?"})`,
        meta: { kind: "depreciation", asset_id: row.asset_id, period: row.period_index },
      });
      if (!je) continue;
      const jeId = await persistMultiLineEntry(je);
      if (!jeId) continue;
      const { error: upErr } = await supabase.from("depreciation_schedule")
        .update({ status: "posted", journal_entry_id: jeId, posted_at: new Date().toISOString() })
        .eq("id", row.id).eq("company_id", currentCompany.id);
      if (upErr) { console.error("depreciation_schedule update:", upErr.message); continue; }
      posted++;
    }
    // Auto-flip assets whose entire remaining pending schedule was just posted.
    for (const assetId of assetsToFlip) {
      try {
        await supabase.from("fixed_assets").update({ status: "fully_depreciated" })
          .eq("id", assetId).eq("company_id", currentCompany.id);
      } catch (e) { console.warn("fully_depreciated flip failed:", e?.message || e); }
    }
    if (posted > 0) {
      try { await loadAllData(); } catch {}
      logAudit("depreciation_run", `Posted ${posted} depreciation ${posted === 1 ? "entry" : "entries"} through ${cutoff}${assetsToFlip.length ? ` · ${assetsToFlip.length} asset(s) fully depreciated` : ""}`);
      showNotification(`Posted ${posted} depreciation ${posted === 1 ? "entry" : "entries"} ✓`);
    }
    return { posted };
  };

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
    const allowed = ["application/pdf","image/jpeg","image/png","image/webp"];
    if (!allowed.includes(file.type)) { showNotification("Please upload a PDF, JPG, PNG, or WEBP.", "error"); return; }
    const base64 = await fileToBase64(file);
    setUploadedFile({ base64, mediaType: file.type, name: file.name });
    setAiSuggestion(null);
    setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"" });
    runFullAI(base64, file.type);
  };

  const runFullAI = async (base64, mediaType) => {
    setIsAILoading(true); setAiStep("extracting"); setAiSuggestion(null);
    try {
      const extractRes = await fetch(AI_PROXY_URL, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          model: AI_MODEL, max_tokens: 1000,
          system: `Extract invoice fields. "vendor" = exact legal name of the company issuing the invoice. Respond ONLY with valid JSON: {"vendor":"...","description":"...","amount":"123.45","date":"YYYY-MM-DD","type":"expense or revenue","invoice_number":"INV-001 or empty string if none","notes":"line items, tax, and other details"}`,
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
          model: AI_MODEL, max_tokens: 1000,
          system: `Expert accountant. Suggest GL coding for this transaction. Respond ONLY with valid JSON: {"gl_code":"XXXX","gl_name":"Name","confidence":95,"reasoning":"brief","debit_credit":"debit or credit","secondary_gl_code":"XXXX","secondary_gl_name":"Name"}

CRITICAL RULES:
- For EXPENSES: gl_code must be 5xxx, 6xxx, 7xxx or 8xxx (income statement expense accounts: 5xxx COGS, 6xxx operating, 7xxx bad debt/misc, 8xxx interest/tax). secondary_gl_code = 2000 (Accounts Payable) or 1000 (Cash).
- For REVENUE: gl_code must be 4xxx (income statement revenue accounts). secondary_gl_code = 1100 (Accounts Receivable) or 1000 (Cash).
- NEVER use 1xxx/2xxx/3xxx (balance sheet accounts) as the PRIMARY gl_code on an expense or revenue transaction. Those are only ever the offset/secondary account.`,
          messages: [{ role:"user", content:`Vendor: ${extracted.vendor}\nDescription: ${extracted.description}\nAmount: $${extracted.amount}\nType: ${extracted.type}\n\nChart of Accounts:\n${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}\n\nSuggest best GL coding.` }]
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
      };
      setInvoices(prev => [invoice, ...prev]);
      runAPScreen([invoice], [invoice, ...invoices]);
      checkWatchTriggers([invoice], unknownDocs);
      logAudit("invoice_booked", `Manual entry: ${invoice.vendor} $${invoice.amount} → ${invoice.gl_name}`, null, invoice);
      bookToDb(invoice);
      setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"" });
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
        model:AI_MODEL, max_tokens:20,
        system:`Classify this document. Reply with ONLY one word:
- invoice    → a bill, invoice, or receipt for goods/services (whether the business is paying OR being paid)
- bank_statement → a bank or credit card statement listing multiple transactions
- payroll    → a payroll register, paystub, or paycheck summary (employees, gross/net pay, withholdings)
- qbo        → a QuickBooks export / general-ledger export (columns like Account, Split, Transaction Type)
- contract   → any legal agreement: loan, lease, debt, subscription, service contract, guarantee, settlement, line of credit, convertible note, licensing agreement
- unknown    → anything else that doesn't clearly fit the above

Reply with only the single word.`,
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

  const handleUniversalUpload = (files) => {
    if (!files?.length) return;
    const allowed = [".pdf",".jpg",".jpeg",".png",".webp",".csv",".xlsx",".xls"];
    const validFiles = Array.from(files).filter(f => allowed.some(ext => f.name.toLowerCase().endsWith(ext)));
    if (!validFiles.length) { showNotification("Please upload PDF, image, CSV, or Excel files.", "error"); return; }

    // Store File objects in ref (survives view changes), add to queue with status "pending"
    const queueItems = validFiles.map(f => {
      const id = Date.now() + Math.random();
      fileStoreRef.current[id] = f;
      const uploadLogId = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : null;
      if (uploadLogId) logUploadStart(uploadLogId, { file_name: f.name, file_type: f.type || f.name.split(".").pop().toLowerCase(), file_size_bytes: f.size });
      return { id, name: f.name, status: "pending", type: null, result: null, error: null, upload_log_id: uploadLogId };
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
            showNotification(`That looked like a ${TYPE_LABEL[route.to]} — routed it to the right importer.`);
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
          showNotification(`That looked like a ${TYPE_LABEL[docType]} — routed it to the right importer.`);
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
          setPendingImportFile({ type: "bank_statement", file });
          setView("bank");
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:"bank_statement", result:{ routed:true, to:"bank" }} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"bank_statement", result:{ routed:true } });
          showNotification("That looked like a bank or card statement — choose the account to import it.");
          return;
        }

        // Update status: processing + type known
        setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, type:docType, status:"processing"} : q));
        logUploadUpdate(item.upload_log_id, { status:"processing", doc_type:docType });

        if (docType === "invoice") {
          // Extract ALL invoices in the document (handles single and multi-invoice PDFs)
          const extractRes = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:AI_MODEL, max_tokens:4000,
              system:`You are an expert at reading invoice documents. This document may contain ONE invoice or MULTIPLE invoices/receipts on separate pages or sections.

Extract EVERY invoice you find. Respond ONLY with a valid JSON array — even if there is only one invoice:
[
  {"vendor":"Exact vendor name","issuer":"the party that ISSUED/SENT this invoice — the 'From'/'Bill From'/letterhead company","recipient":"the party being BILLED — the 'Bill To'/'To'/customer","description":"what was purchased","amount":"123.45 — the TOTAL due (incl. any sales tax)","subtotal":"pre-tax subtotal if a tax line is shown, else empty","tax_amount":"the sales tax / VAT amount if a tax line is shown, else empty","date":"YYYY-MM-DD","type":"expense or revenue","invoice_number":"INV-001 or empty string if none","notes":"line items, tax, and other details","vendor_address":"full mailing address if shown, else empty","vendor_email":"email if shown, else empty","vendor_phone":"phone if shown, else empty","vendor_website":"website/domain if shown, else empty","payment_terms":"e.g. Net 30 if shown, else empty","account_number":"our account number with this vendor if shown, else empty","tax_id":"their EIN / tax ID if shown, else empty","confidence_score":0.95,"questions":[]},
  ...one object per invoice...
]
For "type":"revenue" the "vendor" field is the CUSTOMER's name and the address/email/phone/etc. describe that customer. Leave any field you can't find as an empty string — never guess.

CONFIDENCE & CLARIFYING QUESTIONS:
- "confidence_score": your overall confidence from 0.0 to 1.0 that this invoice is complete and correctly understood.
- "questions": when something is missing or genuinely uncertain, add up to 3 plain-English questions a friendly bookkeeper would text the business owner. Leave it as [] when everything is clear.
  Each question is {"field":"...","question":"short friendly question","options":["label","label",...]}. Use these fields:
  - "business_purpose" — unclear what the purchase was for. options like ["Office/Operations","A specific project","Personal — don't book","Something else"].
  - "amount" — the total is unreadable. Omit "options" (the app shows a number field).
  - "date" — no date is visible. Omit "options" (the app shows a date picker).
  - "vendor" — the vendor name is unclear. Omit "options" (the app shows a text field with your best guess prefilled).
  - "category" — the expense category is unclear. options = 3–5 likely categories for this kind of vendor plus "Something else".
  - "personal" — it might be a personal expense. options ["Yes, book it","No, it's personal — skip"].
  Write every question the way you'd text a client — never use accounting jargon, GL codes, or confidence numbers.

DIRECTION — anchor on WHO THIS BUSINESS IS. This business is: "${companySettings?.name || "(not set)"}"${companySettings?.aliases ? ` (also known as: ${companySettings.aliases})` : ""}.
- If THIS BUSINESS is the issuer (its name is the From/Bill-From/letterhead party) → type = "revenue" (an invoice they SENT a customer).
- If THIS BUSINESS is the recipient (its name is the Bill-To/To party) → type = "expense" (a bill they RECEIVED).
- Always fill "issuer" and "recipient" with the exact names on the document so direction can be verified.
- If the business identity above is "(not set)" or neither party clearly matches it, default to "expense" (most uploads are vendor bills) and let the reviewer confirm.

Rules:
- Do NOT merge multiple invoices into one — each distinct invoice gets its own object
- amount = total due on that specific invoice only (the full amount incl. any sales tax)
- If the invoice shows a sales-tax / VAT line, ALSO return "subtotal" (pre-tax) and "tax_amount". Sales tax collected is a liability owed to the state, never revenue — capturing it lets the books credit Sales Tax Payable instead of lumping it into revenue. Leave both empty if there's no tax line.`,
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
              model:AI_MODEL, max_tokens:3000,
              system:`Expert accountant. Assign GL codes to each invoice. Return a JSON array with one coding object per invoice, in the same order as input.
Each object: {"gl_code":"XXXX","gl_name":"Name","confidence":95,"reasoning":"ONE specific sentence naming the vendor and what was purchased, and why this account fits","secondary_gl_code":"XXXX","secondary_gl_name":"Name"}
ALWAYS include a concrete "reasoning" sentence — never leave it blank or generic.

CRITICAL RULES:
- Expenses (type=expense): gl_code must be 5xxx, 6xxx, 7xxx or 8xxx. secondary_gl_code = 2000 (Accounts Payable).
- Revenue (type=revenue): gl_code must be 4xxx. secondary_gl_code = 1100 (Accounts Receivable).  
- NEVER use balance sheet accounts (1xxx/2xxx/3xxx) as primary gl_code.

Chart of Accounts (income statement only):
${CHART_OF_ACCOUNTS.filter(a=>a.category==="Revenue"||a.category==="Expenses").map(a=>`${a.code} - ${a.name}`).join("\n")}`,
              messages:[{role:"user", content:`Code these ${extractedList.length} invoices:\n${JSON.stringify(extractedList.map((inv,i)=>({index:i, vendor:inv.vendor, description:inv.description, amount:inv.amount, type:inv.type})))}`}]
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
              date: extracted.date || new Date().toISOString().slice(0,10),
              // Classify `type` from the GL code (same basis as flattenJournalEntries +
              // the canonical layer) so the in-session row is never mis-slotted by an odd
              // AI `type` and always shows in the transactions tab the moment it's booked.
              type: glIsRevenue(finalCode) ? "revenue" : glIsExpense(finalCode) ? "expense" : (extracted.type || "expense"),
              notes: extracted.notes || "",
              invoice_number: extracted.invoice_number || "",
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
              const revenueAccts = CHART_OF_ACCOUNTS.filter(a => a.category === "Revenue").slice(0, 2);
              const expenseAccts = CHART_OF_ACCOUNTS.filter(a => a.category === "Expenses")
                .filter(a => [rc("cogs"),rc("professional_services"),rc("technology_software")].includes(a.code));
              needsClarification.push({
                id: Date.now() + Math.random(),
                invoice,
                queueItemId: item.id,
                directionFirst: true,
                question: `Did your business SEND this invoice to a customer (revenue), or is it a bill you RECEIVED (expense)?`,
                options: [
                  ...revenueAccts.map(a => ({ code: a.code, name: a.name,
                    typeOverride: { type: "revenue", secondary_gl_code: rc("accounts_receivable"), secondary_gl_name: rn("accounts_receivable") } })),
                  ...expenseAccts.map(a => ({
                    code: a.code, name: a.name,
                    typeOverride: { type: "expense", secondary_gl_code: rc("accounts_payable"), secondary_gl_name: rn("accounts_payable") }
                  })),
                ],
                suggestedCode: finalCode,
                suggestedName: finalName,
              });
            } else if (gaapItem) {
              // Needs a GAAP clarifying question before it can be booked correctly.
              needsClarification.push({ id: Date.now() + Math.random(), queueItemId: item.id, ...gaapItem });
            } else if (rule || (confidence >= AI_CONFIDENCE_AUTO_BOOK && !(invoice.questions && invoice.questions.length > 0))) {
              highConfidence.push(invoice);
            } else {
              // Low GL confidence OR the AI raised plain-English questions — ask the user.
              // Build targeted clarification question for low GL confidence
              const topAlternatives = CHART_OF_ACCOUNTS
                .filter(a => a.category === "Expenses")
                .sort((a,b) => {
                  if (a.code === finalCode) return -1;
                  if (b.code === finalCode) return 1;
                  return 0;
                })
                .slice(0, 4);

              needsClarification.push({
                id: Date.now() + Math.random(),
                invoice,
                queueItemId: item.id,
                question: confidence < 60
                  ? `I'm not sure how to code this from ${extracted.vendor} for $${parseFloat(extracted.amount).toFixed(2)}. ${coding.reasoning || "Which category fits best?"}:`
                  : `I coded this to "${finalName}" (${confidence}% confident). Does that look right?`,
                options: topAlternatives.map(a => ({ code: a.code, name: a.name })),
                suggestedCode: finalCode,
                suggestedName: finalName,
              });
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
            confidence: highConfidence.length > 0 ? Math.round(highConfidence.reduce((s,i)=>s+(i.confidence||0),0)/highConfidence.length) : null,
            reviewVendor: firstReview?.vendor ?? null,
            reviewAmount: firstReview?.amount ?? null,
          };
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result: invoiceResult} : q));
          logUploadUpdate(item.upload_log_id, { status:"done", doc_type:"invoice", result: invoiceResult });

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
                model:AI_MODEL, max_tokens:4000,
                system:`Parse this bank statement CSV/text and extract ALL transactions. Respond ONLY with JSON array: [{"date":"YYYY-MM-DD","description":"...","amount":123.45,"type":"debit or credit"}]`,
                messages:[{role:"user", content:`Parse:\n\n${text.slice(0,8000)}`}]
              })
            });
            const pd = await okAIResponse(parseRes);
            rawTxns = JSON.parse((pd.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          } else {
            const parseRes = await fetch(AI_PROXY_URL, {
              method:"POST", headers:getAuthHeaders(),
              body: JSON.stringify({
                model:AI_MODEL, max_tokens:4000,
                system:`Extract ALL transactions from this bank statement PDF. Respond ONLY with JSON array: [{"date":"YYYY-MM-DD","description":"...","amount":123.45,"type":"debit or credit"}]`,
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
              model:AI_MODEL, max_tokens:6000,
              system:`Categorize each bank transaction with GL coding. Respond ONLY with JSON array: [{"id":0,"date":"YYYY-MM-DD","vendor":"Clean Name","description":"original","amount":123.45,"type":"expense or revenue","gl_code":"XXXX","gl_name":"Name","confidence":85,"needs_review":false}]

CRITICAL RULES:
- type "expense" → gl_code must be 5xxx, 6xxx, 7xxx or 8xxx (never 1xxx/2xxx/3xxx)
- type "revenue" → gl_code must be 4xxx (never 1xxx/2xxx/3xxx)
- Balance sheet accounts (1xxx assets, 2xxx liabilities, 3xxx equity) are NEVER the primary GL code for a transaction
- Set needs_review:true when confidence<75
Chart of Accounts:\n${CHART_OF_ACCOUNTS.filter(a=>a.category==="Revenue"||a.category==="Expenses").map(a=>`${a.code} - ${a.name}`).join("\n")}`,
              messages:[{role:"user", content:`Categorize ${rawTxns.length} transactions:\n${JSON.stringify(rawTxns.slice(0,80))}`}]
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
            period_start: txnDates[0] || new Date().toISOString().slice(0,10),
            period_end: txnDates[txnDates.length-1] || new Date().toISOString().slice(0,10),
            statement_balance: 0, books_balance: 0, difference: 0,
            status: reconRecordStatus(plan.review.length),   // CHECK allows only open|complete ("needs_review" violated it; review count lives in bankResult.needsReview)
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

        } else if (docType === "contract") {
          // Full contract analysis — two calls to avoid token limits
          // Call 1: Extract terms + Day 1 entry
          const res1 = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:AI_MODEL, max_tokens:3000,
              system:`You are a Big 4 CPA (ASC 842 specialist). Extract contract terms and generate ONLY the Day 1 journal entry.
For OPERATING LEASE: Day 1: Dr ROU Asset 1800 [PV of payments at IBR] / Cr Lease Liability Current 2400 [next 12mo principal] + Cr Lease Liability LT 2450 [remainder]. NO depreciation entries.
Respond ONLY with JSON: {"contract_type":"lease|loan|revenue_contract|subscription_paid|subscription_received|equipment_financing|service_agreement","counterparty":"...","description":"...","total_value":0,"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","payment_amount":0,"payment_frequency":"monthly","interest_rate":0,"lease_type":"operating|finance|not_applicable","rou_asset_value":0,"lease_liability_current":0,"lease_liability_noncurrent":0,"discount_rate_used":0.05,"lease_term_months":0,"monthly_straight_line_expense":0,"accounting_treatment":"...","key_terms":[],"journal_entries":[{"date":"YYYY-MM-DD","description":"Lease commencement","memo":"ASC 842-20-30","lines":[{"account_code":"1800","account_name":"Right-of-Use Asset","debit":0,"credit":0}]}]}`,
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
            const start = new Date(contract.start_date || new Date());
            for (let i = 0; i < calcLeaseTermMonths; i++) {
              const d = new Date(start); d.setMonth(d.getMonth() + i + 1);
              const ds = d.toISOString().slice(0,10);
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

        } else if (docType === "unknown") {
          // Ask Claude to explain AND propose a journal entry (or explicitly say none needed)
          const explainRes = await fetch(AI_PROXY_URL, {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:AI_MODEL, max_tokens:1500,
              system:`You are an expert CPA reviewing an unusual document. Analyze it and respond ONLY with valid JSON (no markdown):
{
  "document_type": "Short name for what this document is (e.g. Personal Guarantee, Settlement Agreement, Line of Credit)",
  "explanation": "2-3 sentences in plain English: what this document is, what it means for the business, and what action is recommended.",
  "entry_needed": true or false,
  "entry_summary": "One sentence describing what the journal entry does (only if entry_needed is true)",
  "journal_entry": {
    "date": "YYYY-MM-DD (use today if unclear)",
    "description": "Brief memo for the entry",
    "lines": [
      { "account_code": "XXXX", "account_name": "Account Name", "debit": 0, "credit": 0 }
    ]
  },
  "no_entry_reason": "Why no entry is needed now (only if entry_needed is false)",
  "watch_for": [
    {
      "trigger_description": "Plain English description of what future event would require an entry — e.g. 'If the personal guarantee is called by First National Bank'",
      "trigger_vendor_keywords": ["first national", "fnb"],
      "trigger_amount_min": 0,
      "trigger_amount_max": 250000,
      "suggested_entry_description": "What entry to make when this triggers — e.g. 'Debit Loan Payable, Credit Cash for the guarantee amount called'",
      "suggested_gl_code": "XXXX",
      "suggested_gl_name": "Account Name"
    }
  ]
}

Chart of Accounts:
${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}

Rules:
- If the document creates a financial obligation or records a financial event → entry_needed: true
- If it's a contingent liability, disclosure item, or purely legal document with no immediate accounting impact → entry_needed: false
- watch_for: always populate this array with 1-3 future conditions that would require accounting action, even if entry_needed is true. Examples:
  * Personal guarantee → watch for lender demanding payment
  * LOC agreement → watch for actual draws from the lender
  * Lawsuit → watch for settlement payments or judgments
  * Deferred payment agreement → watch for each installment due date
  * Insurance claim → watch for claim payment received
- trigger_vendor_keywords: lowercase keywords that might appear in a vendor/payee name on a future transaction
- trigger_amount_min/max: expected dollar range for the triggering transaction (0 if unknown)
- journal_entry lines must balance (total debits = total credits)
- Use real account codes from the chart of accounts above`,
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
        }

    } catch(e) {
      console.error("Upload error:", item.name, e);
      const errMsg = e?.message || String(e) || "Processing failed";
      setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"error", error:`${errMsg} — try again`} : q));
      logUploadUpdate(item.upload_log_id, { status:"error", error:`${errMsg} — try again` });
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
  const routeFileToType = (type, file) => {
    if (type === "bank_statement") { setView("bank"); handleBankFile(file); }
    else if (type === "contract") { setView("contracts"); handleContractFile(file); }
    else if (type === "invoice") { setView("add"); handleUniversalUpload([file]); }
    else if (type === "payroll") { setPendingImportFile({ type: "payroll", file }); setView("payroll"); showNotification("Routed to Payroll Import ✓"); }
    else if (type === "qbo") { setPendingImportFile({ type: "qbo", file }); setView("onboard"); showNotification("Use the QuickBooks import here ✓"); }
  };

  const handleBankFile = async (file, account = null) => {
    if (!file) return;
    if (!(await guardImport(file, "bank_statement"))) return;   // misroute guard
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

    try {
      let fileContent = "";
      if (ext === ".pdf") {
        // PDF: send as base64 image/document to Claude
        const base64 = await fileToBase64(file);
        setBankStep("categorizing"); setBankProgress(40);
        const res = await fetch(AI_PROXY_URL, {
          method:"POST", headers:getAuthHeaders(),
          body: JSON.stringify({
            model:AI_MODEL, max_tokens:4000,
            system:`You are an expert at reading bank statements. Extract ALL transactions from this bank statement. Respond ONLY with valid JSON array, no markdown:
[{"date":"YYYY-MM-DD","description":"raw bank description","amount":123.45,"type":"debit or credit","balance":1000.00}]
Extract every single transaction row. Use negative amounts for debits/expenses if shown that way in the statement.`,
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
            model:AI_MODEL, max_tokens:4000,
            system:`You are an expert at parsing bank statement exports. Parse this CSV/Excel text and extract ALL transactions. Respond ONLY with valid JSON array, no markdown:
[{"date":"YYYY-MM-DD","description":"raw bank description","amount":123.45,"type":"debit or credit","balance":1000.00}]
Handle any column format — the file might have columns in different orders. Parse every transaction row.`,
            messages:[{role:"user",content:`Parse this bank statement file and extract all transactions:\n\n${fileContent.slice(0,8000)}`}]
          })
        });
        const d = await okAIResponse(res);
        fileContent = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
      }

      const rawTxns = Array.isArray(fileContent) ? fileContent : [];
      setBankProgress(60);

      // Now batch-categorize all transactions with GL coding + vendor extraction
      if (rawTxns.length === 0) { showNotification("No transactions found in file.", "error"); setBankProcessing(false); return; }

      setBankStep("categorizing"); setBankProgress(70);
      const categorizeRes = await fetch(AI_PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          model:AI_MODEL, max_tokens:6000,
          system:`You are an expert accountant. For each bank transaction, extract the vendor name and suggest the best GL account coding. Use your knowledge of common merchants (e.g. "AMZN" = Amazon, "SQ *" = Square merchant, "ACH" = bank transfer, etc).

Chart of Accounts:
${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}

Respond ONLY with a valid JSON array, no markdown. For each transaction:
{"id":0,"date":"YYYY-MM-DD","vendor":"Clean Vendor Name","description":"original description","amount":123.45,"type":"expense or revenue","gl_code":"XXXX","gl_name":"Account Name","confidence":85,"needs_review":false}

Set needs_review:true when confidence < 75 or you cannot clearly identify the vendor/purpose.
Keep the same array order and index as input.`,
          messages:[{role:"user",content:`Categorize these ${rawTxns.length} bank transactions:\n${JSON.stringify(rawTxns.slice(0,80))}`}]
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

      setBankTransactions(withRules.map((t,i) => ({ ...t, id: Date.now()+i, checked: !t.needs_review })));
      setBankProgress(100);
      showNotification(`${withRules.length} transactions imported — ${withRules.filter(t=>t.needs_review).length} need review`);
    } catch(e) {
      showNotification("Failed to process bank statement. Please try again.", "error");
      console.error(e);
    }
    setBankProcessing(false); setBankStep(null);
  };

  // Book the reviewed bank/card lines (O69 A/C/D). `account` is the source the statement
  // belongs to — its GL is the OFFSET for direct bookings (card → Cr 2200, bank → Cr 1000),
  // and its TYPE decides whether AP-matching even applies. Every direct-booked line is
  // PERSISTED through bookToDb (post_journal_entry) — never local state only — so nothing
  // can "succeed" in the UI without a real journal entry behind it.
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

    // O69-D / O57: offset by the account this statement belongs to, not hardcoded Cash.
    const offsetCode = (account && account.gl_code) || rc("cash");
    const offsetName = (account && account.gl_code && getAccountByCode(offsetCode)?.name) || rn("cash");
    const runMatching = shouldRunApMatching(account);   // false for credit_card (O69-C)

    // Each checked line → a real, balanced direct-book via the shared builder (direction
    // by type, offset by account): expense → Dr Expense / Cr <offset>; revenue → reverse.
    const buildEntry = (t) => ({
      id: t.id, booked_at: new Date().toISOString(),
      ...buildBankLineEntry(
        { id: t.id, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type, gl_code: t.gl_code, gl_name: t.gl_name, confidence: t.confidence },
        { offsetCode, offsetName, reason: `Imported from ${runMatching ? "bank" : "credit card"} statement${t.rule_applied ? " (vendor rule applied)" : ""}` }
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
      showNotification(
        failed === 0
          ? `${booked} card charge${booked!==1?"s":""} booked (Dr Expense / Cr ${offsetCode}) ✓`
          : `${booked} booked · ${failed} failed — please retry the failed charge${failed!==1?"s":""}`,
        failed === 0 ? "success" : "error"
      );
      return;
    }

    // ── BANK ACCOUNT: a bank debit CAN legitimately clear an open payable, so keep
    // AP-matching. Use the proven planBankImport split so a matched line posts ONLY its
    // clearing (no double-count) and genuinely-new lines are direct-booked + PERSISTED. ──
    const parsedTxns = toBook.map(t => ({ id: t.id, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type, gl_code: t.gl_code, gl_name: t.gl_name, confidence: t.confidence }));
    const openItems = (invoicesRef.current || invoices).filter(i =>
      !i.matched && i.payment_status !== "paid" && i.payment_status !== "collected" && i.source !== "bank_feed" && i.source !== "bank_statement");
    const { autoCleared, queue } = await runMatchingEngine(parsedTxns, openItems);
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
    // Genuinely-new (unmatched) lines → direct-book + PERSIST (O69-A).
    const { booked, failed: bookFailed } = await persistDirect(plan.standalone);
    // Low-confidence / unclearable → manual review (carry the offset for a later dismiss).
    if (plan.review.length > 0) setMatchQueue(prev => [...plan.review.map(m => ({ ...m, importOffsetCode: offsetCode, importOffsetName: offsetName })), ...prev]);

    setBankTransactions(prev => prev.filter(t => !t.checked));
    setBankFileName("");
    if (booked > 0) checkWatchTriggers(plan.standalone.map(buildEntry), unknownDocs);
    try { await loadAllData(); } catch {}
    const failN = clearFailed + bookFailed;
    showNotification(
      `${clearedOk} cleared · ${booked} booked${plan.review.length ? ` · ${plan.review.length} need review` : ""}${failN ? ` · ${failN} failed (retry/review)` : ""}`,
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
    if (!(await guardImport(file, "contract"))) return;   // misroute guard
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (![".pdf",".jpg",".jpeg",".png",".webp"].includes(ext)) {
      showNotification("Please upload a PDF or image of the contract.", "error"); return;
    }
    setContractProcessing(true);
    try {
      const base64 = await fileToBase64(file);
      const mediaType = ext===".pdf" ? "application/pdf" : `image/${ext.slice(1)}`;

      // ── CALL 1: Extract contract terms + Day 1 entry only ────────────────
      const res1 = await fetch(AI_PROXY_URL, {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          model:AI_MODEL, max_tokens:3000,
          system:`You are a Big 4 CPA specializing in ASC 842. Extract contract terms and generate ONLY the Day 1 commencement journal entry.

For OPERATING LEASE (ASC 842):
Day 1: Dr Right-of-Use Asset 1800 [PV of payments] / Cr Lease Liability Current 2400 [next 12mo principal] + Cr Lease Liability LT 2450 [remainder]
ROU Asset = PV of all lease payments discounted at IBR (use 5% if not stated)
Current portion = first 12 months of principal reduction
Non-current = total PV minus current

Respond ONLY with JSON (no markdown):
{
  "contract_type": "lease|loan|revenue_contract|subscription_paid|subscription_received|equipment_financing|service_agreement",
  "counterparty": "string",
  "description": "string",
  "total_value": 0,
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "payment_amount": 0,
  "payment_frequency": "monthly",
  "interest_rate": 0,
  "lease_type": "operating|finance|not_applicable",
  "rou_asset_value": 0,
  "lease_liability_current": 0,
  "lease_liability_noncurrent": 0,
  "discount_rate_used": 0.05,
  "lease_term_months": 0,
  "monthly_straight_line_expense": 0,
  "accounting_treatment": "Cite ASC 842. State IBR used. Explain classification.",
  "key_terms": [],
  "journal_entries": [
    {
      "date": "YYYY-MM-DD",
      "description": "Lease commencement — recognize ROU asset and lease liability",
      "memo": "ASC 842-20-30: Initial measurement at commencement date",
      "lines": [
        {"account_code": "1800", "account_name": "Right-of-Use Asset", "debit": 0, "credit": 0},
        {"account_code": "2400", "account_name": "Lease Liability - Current", "debit": 0, "credit": 0},
        {"account_code": "2450", "account_name": "Lease Liability - Non-Current", "debit": 0, "credit": 0}
      ]
    }
  ]
}

Chart of Accounts:
${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}`,
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
              date: contract.start_date || new Date().toISOString().slice(0,10),
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

        const startDate = new Date(contract.start_date || new Date());

        // Use pre-computed amortization schedule from calcASC842
        if (asc842) asc842.schedule.forEach((row, i) => {
          const entryDate = new Date(startDate);
          entryDate.setMonth(entryDate.getMonth() + i + 1);
          const dateStr = entryDate.toISOString().slice(0, 10);
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
          const d = new Date(start);
          d.setMonth(d.getMonth() + i + 1);
          const dateStr = d.toISOString().slice(0, 10);
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
      showNotification(`Contract analyzed — ${contract.journal_entries?.length||0} journal entries generated ✓`);
    } catch(e) {
      const msg = e?.message || String(e);
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
  // Open items = invoices that are unmatched AP (expenses not yet paid) or AR (revenue not yet collected)
  const getOpenAP = (invList) => invList.filter(inv =>
    inv.type === "expense" &&
    !inv.matched &&
    (inv.source === "contract" || inv.gl_code === rc("accounts_payable") || inv.gl_code === rc("accrued_liabilities")) // Accounts Payable / Accrued
  );

  const getOpenAR = (invList) => invList.filter(inv =>
    inv.type === "revenue" &&
    !inv.matched &&
    inv.gl_code === rc("accounts_receivable") // Accounts Receivable
  );

  const getUnpaidInvoices = (invList) => invList.filter(inv =>
    inv.type === "expense" && !inv.matched && (inv.payment_status !== "paid")
  );

  const getUnpaidReceivables = (invList) => invList.filter(inv =>
    inv.type === "revenue" && !inv.matched && (inv.payment_status !== "collected")
  );

  // Run matching engine against a set of new bank transactions
  const runMatchingEngine = async (newBankTxns, currentInvoices) => {
    // Collect all open items (unmatched invoices/accruals)
    const openPayables = currentInvoices.filter(inv =>
      inv.type === "expense" && !inv.matched && inv.payment_status !== "paid"
    );
    const openReceivables = currentInvoices.filter(inv =>
      inv.type === "revenue" && !inv.matched && inv.payment_status !== "collected"
    );

    if (openPayables.length === 0 && openReceivables.length === 0) return { autoCleared: [], queue: [] };
    if (newBankTxns.length === 0) return { autoCleared: [], queue: [] };

    setMatchProcessing(true);
    try {
      const res = await fetch(AI_PROXY_URL, {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          model: AI_MODEL, max_tokens: 4000,
          system: `You are an expert bookkeeper running a matching engine. Your job is to match bank transactions against open invoices/accruals and determine if they clear each other.

For each bank transaction, check if it matches one or more open payables/receivables based on:
- Vendor/counterparty name similarity (fuzzy — "AMZN" matches "Amazon", "SQ *COFFEE" matches "Coffee Shop")  
- Amount proximity (exact match = high confidence; within 2% = probable; within 10% = possible partial)
- Date reasonableness (payment 0-60 days after invoice = normal; 60-120 days = possible; >120 days = flag)
- One bank payment can match MULTIPLE invoices if amounts add up

Match types:
- "ap_clear": bank debit clears an open payable/accrued expense
- "ar_clear": bank credit clears an open receivable
- "partial_ap": bank payment partially covers a payable (track remaining balance)
- "partial_ar": bank deposit partially covers a receivable

Respond ONLY with valid JSON, no markdown:
{
  "matches": [
    {
      "bank_txn_id": "txn id from input",
      "match_type": "ap_clear|ar_clear|partial_ap|partial_ar|no_match",
      "invoice_ids": ["inv id 1", "inv id 2"],
      "confidence": 92,
      "amount_matched": 1500.00,
      "amount_remaining": 0,
      "reasoning": "Plain English: why this matches",
      "auto_clear": true,
      "clearing_entry": {
        "description": "Journal entry description",
        "debit_account_code": "1000",
        "debit_account_name": "Cash & Cash Equivalents",
        "credit_account_code": "2000",
        "credit_account_name": "Accounts Payable",
        "amount": 1500.00
      }
    }
  ]
}

Set auto_clear: true only when confidence >= 85 AND amount matches within 2%.
Set auto_clear: false when confidence < 85, amount differs >2%, or it's a partial payment.
For no_match, return empty invoice_ids and no clearing_entry.`,
          messages: [{
            role: "user", content:
`Match these bank transactions against open items:

BANK TRANSACTIONS (new):
${JSON.stringify(newBankTxns.map(t => ({ id: t.id, date: t.date, description: t.description, vendor: t.vendor, amount: t.amount, type: t.type })))}

OPEN PAYABLES (unpaid expenses):
${JSON.stringify(openPayables.map(i => ({ id: i.id, vendor: i.vendor, description: i.description, amount: i.amount, date: i.date, gl_code: i.gl_code, gl_name: i.gl_name, balance_remaining: i.balance_remaining || i.amount })))}

OPEN RECEIVABLES (uncollected revenue):
${JSON.stringify(openReceivables.map(i => ({ id: i.id, vendor: i.vendor, description: i.description, amount: i.amount, date: i.date, gl_code: i.gl_code, gl_name: i.gl_name, balance_remaining: i.balance_remaining || i.amount })))}`
          }]
        })
      });

      const data = await okAIResponse(res);
      const result = JSON.parse((data.content?.find(b => b.type === "text")?.text || "{}").replace(/```json|```/g, "").trim());
      const matches = result.matches || [];

      const autoCleared = [];
      const queue = [];

      for (const match of matches) {
        if (match.match_type === "no_match" || !match.invoice_ids?.length) continue;

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
          bank_txn: newBankTxns.find(t => t.id === match.bank_txn_id),
          matched_invoices: [...openPayables, ...openReceivables].filter(i => match.invoice_ids.includes(i.id)),
          status: "pending",
          created_at: new Date().toISOString(),
        };

        if (match.auto_clear) {
          autoCleared.push(matchRecord);
        } else {
          queue.push(matchRecord);
        }
      }

      return { autoCleared, queue };
    } catch(e) {
      console.error("Matching engine error:", e);
      return { autoCleared: [], queue: [] };
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
      ...buildBankLineEntry(m.bank_txn, { offsetCode: offCode, offsetName: offName, reason: "Booked directly — proposed match dismissed" }) };
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
          model:AI_MODEL, max_tokens:3000,
          system:`You are an AP automation system. Screen each invoice and return enriched data.

For each invoice return:
{
  "id": <same id as input>,
  "due_date": "YYYY-MM-DD",          // estimate from invoice date: net30 default, net15 for utilities, immediate for credit card
  "payment_method": "ach|check",     // ach for known digital vendors, check for others
  "duplicate_flag": true|false,      // true if very similar invoice exists (same vendor + similar amount within 5% + within 60 days)
  "duplicate_reason": "...",         // if flagged, explain why
  "anomaly_flag": true|false,        // true if amount is unusual vs vendor history
  "anomaly_reason": "...",           // if flagged, explain
  "approval_status": "approved|pending_approval|flagged",
  "approval_reason": "...",          // why auto-approved, or what needs review
  "payment_priority": 1|2|3,         // 1=urgent (overdue/due<7d), 2=normal (7-30d), 3=low (30d+)
  "early_pay_discount": false,       // true if invoice mentions early payment discount
  "notes_for_reviewer": "..."        // plain English summary of anything the approver should know
}

Auto-approve (approval_status="approved") if: amount < $${500} AND no duplicate flag AND no anomaly flag.
Flag (approval_status="flagged") if: duplicate OR anomaly.
Pending (approval_status="pending_approval") if: amount >= $${500}.

Respond ONLY with a JSON array, one object per invoice.`,
          messages:[{role:"user", content:`Screen these new invoices:
${JSON.stringify(expenses.map(i=>({id:i.id, vendor:i.vendor, amount:i.amount, date:i.date, description:i.description, gl_name:i.gl_name})))}

Existing AP history for duplicate/anomaly check:
${JSON.stringify(existing.filter(i=>glIsExpense(i.gl_code)).slice(0,40).map(i=>({vendor:i.vendor, amount:i.amount, date:i.date})))}`}]
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
    // AR) BEFORE flipping the flag, only on the unpaid→paid transition and only when
    // the bill was booked to a liability/receivable. A bill booked direct-to-cash was
    // already settled at booking, so it stays flag-only (never double-credit Cash).
    // Posting first means a GL failure bails before the flag is written, so the flag
    // and the GL movement are always consistent.
    const isTransition = snap.payment_status !== newStatus;
    if (isTransition) {
      const payEntry = buildPaymentEntry(inv, side, {
        apCode: rc("accounts_payable"), accruedCode: rc("accrued_liabilities"),
        arCode: rc("accounts_receivable"), cashCode: rc("cash"), cashName: rn("cash"),
        date: paidDate || at.slice(0, 10), billDbId: dbId,
      });
      if (payEntry) {
        // Idempotency: don't double-post if a live payment JE already links to this bill.
        let already = false;
        try {
          const { data } = await supabase.from("journal_entries").select("id")
            .eq("company_id", currentCompany.id)
            .eq("import_metadata->>payment_for", String(dbId))
            .is("deleted_at", null).eq("status", "posted").limit(1);
          already = Array.isArray(data) && data.length > 0;
        } catch { /* probe failed — rely on the transition guard above */ }
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
      const newRules = [...rules];

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

      for (const action of (result.actions || [])) {
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
        if (action.type === "recode" && action.invoiceIds?.length) {
          const toRecode = invoices.filter(inv => action.invoiceIds.includes(inv.id));
          const beforeState = toRecode.map(i => ({ id:i.id, gl_code:i.gl_code, gl_name:i.gl_name }));
          // Optimistic update, then VERIFY the DB write committed before reporting success.
          setInvoices(prev => prev.map(inv =>
            action.invoiceIds.includes(inv.id)
              ? { ...inv, gl_code: action.gl_code, gl_name: action.gl_name, recode_note: `Recoded by AI assistant` }
              : inv
          ));
          const ok = await persistRecode(toRecode, action.gl_code, action.gl_name);
          if (ok) {
            logAudit("ai_recode", `AI recoded ${toRecode.length} invoice(s) → ${action.gl_name}`, beforeState, { gl_code: action.gl_code, gl_name: action.gl_name });
            actionSummary.push(`Recoded ${toRecode.length} invoice(s) → ${action.gl_name}`);
          } else {
            // Write didn't commit → revert the optimistic change and record the failure so
            // the reply can't claim "✓ reclassed" (the reported false-success bug).
            setInvoices(prev => prev.map(inv => {
              const b = beforeState.find(x => x.id === inv.id);
              return b ? { ...inv, gl_code: b.gl_code, gl_name: b.gl_name, recode_note: undefined } : inv;
            }));
            actionFailures.push(`recode → ${action.gl_name}`);
          }
        }
        if (action.type === "retag_project" && action.invoiceIds?.length) {
          setInvoices(prev => prev.map(inv =>
            action.invoiceIds.includes(inv.id) ? { ...inv, project: action.project } : inv
          ));
          if (!allProjects.includes(action.project)) setCustomProjects(p => [...p, action.project]);
          actionSummary.push(`Tagged ${action.invoiceIds.length} invoice(s) → Project: ${action.project}`);
        }
        if (action.type === "add_account") {
          if (action.code && action.name && action.category) {
            const ok = await addCustomAccount({ code: action.code, name: action.name, category: action.category });
            if (ok === false) actionFailures.push(`add account ${action.code} ${action.name}`);
            else actionSummary.push(`Added account: ${action.code} ${action.name} (${action.category})`);
          }
        }
        if (action.type === "delete_invoice") {
          if (bulkBlocked) continue; // refused above — handled in the reply
          // Soft delete (reversible) by ID or by vendor+amount match. Logged as "AI Chat".
          if (action.invoice_id) {
            const target = invoices.find(i => String(i.id) === String(action.invoice_id));
            if (target) {
              softDeleteInvoice(target, true);
              actionSummary.push(`Deleted entry: ${target.vendor} $${target.amount}`);
            } else {
              actionSummary.push(`Entry ${action.invoice_id} not found`);
            }
          } else if (action.vendor) {
            const toDelete = invoices.filter(i =>
              i.vendor?.toLowerCase().includes(action.vendor.toLowerCase()) &&
              (!action.amount || Math.abs(i.amount - parseFloat(action.amount)) < 1) &&
              (!action.date || i.date === action.date)
            );
            if (toDelete.length > 0) {
              softDeleteInvoices(toDelete, true);
              actionSummary.push(`Deleted ${toDelete.length} entr${toDelete.length===1?"y":"ies"} for ${action.vendor}`);
            } else {
              actionSummary.push(`No matching entries found for ${action.vendor}`);
            }
          }
        }
        if (action.type === "void_invoice") {
          // Void = mark as voided but keep for audit trail (reversible via Undo).
          if (action.invoice_id) {
            const target = invoices.find(i => String(i.id) === String(action.invoice_id));
            if (target) { voidInvoiceWithUndo(target, action.reason || "Voided via AI", true); actionSummary.push(`Voided entry: ${target.vendor}`); }
            else { actionSummary.push(`Entry ${action.invoice_id} not found`); }
          } else if (action.vendor) {
            const toVoid = invoices.filter(i => i.vendor?.toLowerCase().includes(action.vendor.toLowerCase()) && i.status!=="voided");
            toVoid.forEach(t => voidInvoiceWithUndo(t, action.reason || "Voided via AI", true));
            actionSummary.push(`Voided ${toVoid.length} entr${toVoid.length===1?"y":"ies"} for ${action.vendor}`);
          }
        }
        if (action.type === "reverse_entry") {
          // Post a true reversing entry through the shared, tested path (mirrors every
          // line of the original). Replaces the old inline swap+flip, which double-
          // negated and re-booked an identical entry instead of reversing it.
          const toReverse = invoices.find(i => String(i.id) === String(action.invoice_id));
          if (toReverse) {
            const revId = await reverseJournalEntry(toReverse, action.reason || "Reversed via AI", true);
            if (revId) { await loadAllData().catch(() => {}); actionSummary.push(`Reversing entry created for ${toReverse.vendor} $${toReverse.amount}`); }
            else actionFailures.push(`reverse ${toReverse.vendor}`);   // didn't post → don't claim success
          }
        }
        if (action.type === "delete_contract") {
          if (bulkBlocked) continue; // refused above — handled in the reply
          if (action.contract_id || action.counterparty) {
            const toDelete = contracts.filter(c =>
              action.contract_id ? String(c.id) === String(action.contract_id)
              : c.counterparty?.toLowerCase().includes(action.counterparty?.toLowerCase())
            );
            toDelete.forEach(c => softDeleteContract(c, true));
            actionSummary.push(`Contract removed: ${action.counterparty || action.contract_id}`);
          }
        }
        if (action.type === "add_rule") {
          const idx = newRules.findIndex(r => r.vendor?.toLowerCase() === action.vendor?.toLowerCase());
          const rule = { vendor: action.vendor, gl_code: action.gl_code, gl_name: action.gl_name, project: action.project || null };
          if (idx >= 0) newRules[idx] = rule; else newRules.push(rule);
          actionSummary.push(`Rule saved: ${action.vendor} → ${action.gl_name}${action.project ? ` / ${action.project}` : ""}`);
        }
        if (action.type === "delete_rule") {
          const before = newRules.length;
          const filtered = newRules.filter(r => r.vendor?.toLowerCase() !== action.vendor?.toLowerCase());
          newRules.splice(0, newRules.length, ...filtered);
          actionSummary.push(`Rule removed for ${action.vendor}`);
        }
        if (action.type === "add_recurring") {
          const newRec = {
            id: Date.now()+Math.random(), name: action.name, vendor: action.vendor||action.name,
            amount: parseFloat(action.amount)||0, gl_code: action.gl_code, gl_name: action.gl_name,
            frequency: action.frequency||"monthly", next_date: action.next_date||new Date().toISOString().slice(0,10),
            project: action.project||"General", active: true, created_at: new Date().toISOString(), last_run: null
          };
          setRecurring(prev => [newRec, ...prev]);
          logAudit("recurring_created", `AI created recurring: ${action.name} $${action.amount} ${action.frequency}`);
          actionSummary.push(`Recurring created: ${action.name} · $${action.amount}/${action.frequency}`);
        }
        if (action.type === "pause_recurring") {
          setRecurring(prev => prev.map(r => r.name?.toLowerCase()===action.name?.toLowerCase() ? {...r, active:false} : r));
          actionSummary.push(`Recurring paused: ${action.name}`);
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
          const newContact = {
            id: Date.now() + Math.random(),
            name: action.name,
            type: action.contact_type || "vendor",
            gl_code: action.gl_code || null,
            gl_name: action.gl_name || null,
            payment_terms: action.payment_terms || null,
            email: action.email || null,
            phone: action.phone || null,
            notes: action.notes || null,
            tags: action.tags || [],
            min_expected: action.min_expected || null,
            max_expected: action.max_expected || null,
            created_at: new Date().toISOString(),
          };
          setContacts(prev => {
            const exists = prev.findIndex(c => c.name?.toLowerCase() === action.name?.toLowerCase());
            if (exists >= 0) { const u=[...prev]; u[exists]={...u[exists],...newContact}; return u; }
            return [newContact, ...prev];
          });
          logAudit("contact_added", `${action.contact_type==="customer"?"Customer":"Vendor"} added: ${action.name}`, null, newContact);
          actionSummary.push(`${action.contact_type==="customer"?"Customer":"Vendor"} added: ${action.name}`);
          // Also add GL rule if gl_code provided
          if (action.gl_code) {
            const idx = newRules.findIndex(r => r.vendor?.toLowerCase() === action.name?.toLowerCase());
            const rule = { vendor: action.name, gl_code: action.gl_code, gl_name: action.gl_name, project: null };
            if (idx >= 0) newRules[idx] = rule; else newRules.push(rule);
          }
        }
        if (action.type === "update_contact") {
          setContacts(prev => prev.map(c =>
            c.name?.toLowerCase() === action.name?.toLowerCase()
              ? { ...c, ...action.updates }
              : c
          ));
          actionSummary.push(`Updated contact: ${action.name}`);
        }
        if (action.type === "set_contact_rule") {
          // Update contact GL + add rule
          setContacts(prev => prev.map(c =>
            c.name?.toLowerCase() === action.name?.toLowerCase()
              ? { ...c, gl_code: action.gl_code, gl_name: action.gl_name }
              : c
          ));
          const idx = newRules.findIndex(r => r.vendor?.toLowerCase() === action.name?.toLowerCase());
          const rule = { vendor: action.name, gl_code: action.gl_code, gl_name: action.gl_name, project: action.project || null };
          if (idx >= 0) newRules[idx] = rule; else newRules.push(rule);
          actionSummary.push(`Rule set for ${action.name} → ${action.gl_name}`);
        }
        // Comprehensive AI audit trail: every action the AI takes is logged as "AI Chat".
        // delete_invoice / void_invoice / delete_contract already log (with before/after)
        // via their helpers; navigate isn't a data change, so both are skipped here.
        const _added = actionSummary.slice(_sumBefore);
        if (_added.length && !["navigate","delete_invoice","void_invoice","delete_contract"].includes(action.type)) {
          logAI(`ai_${action.type}`, _added.join("; "));
        }
      }
      setRules(newRules);

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

      const assistantMsg = {
        role: "assistant",
        content: memberBlocked
          ? "You're on a member seat, so I can't make changes like deleting, voiding, or recoding — those are reserved for admins and the owner. I can still answer questions, pull reports, and help you find things. Want me to do that instead?"
          : clarifyNeeded
            ? clarifyText()
            : bulkBlocked
              ? "I can delete items one at a time for safety. Which specific entry would you like me to remove first?"
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

  const allVendorNames = vendorSummary.map(v => v.name);
  const filteredInvoices = useMemo(() => invoices.filter(inv => vendorFilter==="all" || inv.vendor===vendorFilter), [invoices, vendorFilter]);
  // Canonical layer (reports.js) — all-time, live (voided/deleted excluded). The
  // single source for these figures everywhere they appear.
  const totalExpenses = computeExpenses(invoices);
  const totalRevenue  = computeRevenue(invoices);
  const netIncome = computeNetIncome(invoices);
  // Canonical CASH ON HAND, derived from the GL (single source of truth). Sums the
  // GL balance of the cash / cash-equivalent accounts (roles cash + savings + any
  // bank-linked GL account). This is what every cash surface reads — NOT the bank
  // statement balance (that's the reconciliation target, kept on bank_accounts).
  const cashGlCodes = (() => {
    const s = new Set();
    const c = getAccountByRole("cash")?.code; if (c) s.add(c);
    const sv = getAccountByRole("savings")?.code; if (sv) s.add(sv);
    (bankAccounts || []).forEach(b => { if (b.gl_code) s.add(b.gl_code); });
    return [...s];
  })();
  const glCash = glCashOnHand(invoices, cashGlCodes);
  // GL breakdown — only income statement accounts, live entries only.
  const glBreakdown = liveEntries(invoices).reduce((acc,inv)=>{
    if (!glPLType(inv.gl_code)) return acc; // skip balance sheet accounts
    acc[inv.gl_name||"Uncoded"]=(acc[inv.gl_name||"Uncoded"]||0)+inv.amount;
    return acc;
  },{});

  const inputStyle = { width:"100%", background:"var(--sc-surface-2)", border:"1px solid var(--sc-border-2)", borderRadius:8, padding:"10px 12px", color:"var(--sc-text)", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" };
  const labelStyle = { display:"block", fontSize:11, color:"var(--sc-text-2)", marginBottom:6, letterSpacing:1 };


  const erpCtx = { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyGaapAnswer, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, getAccountByRole, getAccountByCode, getAccountById, reloadAccounts, rc, rn, addCustomAccount, persistAccountEdit, deleteAccount, accountHasTransactions, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, glDrilldown, setGlDrilldown, booksFilter, setBooksFilter, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistMultiLineEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, reconciliations, setReconciliations, recurring, recurringNewRec, recurringSuggestions, acceptRecurringSuggestion, dismissRecurringSuggestion, persistBankAccounts, createBankAccountInline, cashFromBanks, glCash, glCashOnHand, cashGlCodes, anomalies, dismissAnomaly, notifications, notifOpen, setNotifOpen, unreadNotifs, markNotifRead, markAllNotifsRead, clearAllNotifs, openNotification, onboardingUploadDone, businessModalOpen, setBusinessModalOpen, saveBusinessProfile, accountantDismissed, dismissAccountantStep, completeOnboarding, rejectInvoice, requestInfo, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, cutoffDate, saveCutoffDate, postOpeningBalances, openingPosted, preCutoffActivity, assertBookable, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, returnTo, setReturnTo, goBackFromDetail, softDeleteInvoice, softDeleteInvoices, voidInvoiceWithUndo, softDeleteContract, softDeleteContracts, restoreJournalEntries, dismissNotification, enterSupport, exitSupport, supportMode, view, legalTab, setLegalTab, userRole, isOwner, isAdmin, isMember, flagBookingVisibilityFailure, markBillPaid, runDepreciationThrough, depreciationDueInfo, attachDepreciationToExistingAsset, guardImport, routeFileToType, pendingImportFile, setPendingImportFile };

  const SETTINGS_VIEWS = ["settings","team","coa","opening-balances","onboard","rules","recurring","tax1099","tax","audit"];
  // Only platform administrators see the Security tab / view.
  const isPlatformAdmin = PLATFORM_ADMIN_EMAILS.includes(session?.user?.email);
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
          <div role="alert" style={{ flexShrink:0, background:"var(--sc-warning-soft)", borderBottom:"1px solid #FEDF89", color:"var(--sc-warning)", padding:"11px 24px", display:"flex", alignItems:"center", gap:12, fontSize:13, fontWeight:600, zIndex:51 }}>
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
                    <stop offset="0%" stopColor="#f6cb5b" />
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
          {/* Nav — 5 tabs */}
          {(() => {
            const BOOKS = ["books","invoices","ledger","ap","ar","money-in","money-out","matching","send-invoice","vendors","customers","payroll","docs","detail","contracts"];
            const REPORTS = ["reports"];
            const tabs = [
              { id:"home", label:"Home", group:["home","dashboard","add","review"] },
              { id:"books", label:"Books", group:BOOKS },
              { id:"reports", label:"Reports", group:REPORTS },
              ...(isPlatformAdmin ? [{ id:"admin", label:"⚙ Admin", group:["admin"], admin:true }] : []),
            ];
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
            const BOOKS = ["books","invoices","ledger","ap","ar","money-in","money-out","matching","send-invoice","vendors","customers","payroll","docs","detail","contracts"];
            const REPORTS = ["reports"];
            const SETTINGS = ["settings","team","coa","opening-balances","onboard","rules","recurring","tax1099","tax","audit"];
            let subs = null;
            if (BOOKS.includes(view)) subs = [["books","Transactions"],["books:contracts","Contracts"],["ap","Payables"],["vendors","Vendors"],["customers","Customers"],["send-invoice","Send Invoice"],["payroll","Payroll"],["docs","Documents"]];
            // Reports has its own in-screen sub-nav — no chrome sub-nav row here.
            else if (SETTINGS.includes(view)) {
              subs = [["settings","Company"],["coa","Chart of Accounts"],["opening-balances","Bank & Balances"],["rules","Rules"],["recurring","Recurring"],["tax","Taxes"],["tax1099","1099s"],["audit","Audit Trail"],["onboard","Import from QuickBooks"]];
              if (isOwner) subs.splice(1, 0, ["team","Team"]);            // owner-only Team tab
              if (isMember) subs = subs.filter(([id]) => ["tax","tax1099","audit"].includes(id)); // members: read-only settings only
            }
            if (!subs) return null;
            // Unpaid bills count for the amber badge on the Payables tab.
            const apUnpaid = invoices.filter(i => (glIsExpense(i.gl_code) || i.type==="expense") && i.status!=="voided" && i.payment_status!=="paid").length;
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
          needs_review:        { icon:"📄", color:"#CA8504" },
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
                      onMouseEnter={e=>e.currentTarget.style.background="#F2F4F7"} onMouseLeave={e=>e.currentTarget.style.background=n.read?"var(--sc-surface)":"var(--sc-gold-soft)"}>
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
                      <li key={i} style={{ display:"flex", gap:8, fontSize:12.5, color:"var(--sc-text-2)", lineHeight:1.5, marginBottom:9 }}>
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
