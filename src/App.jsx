import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { supabase, getAuthHeaders } from "./lib/supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS, AI_MODEL, AI_PROXY_URL, CAPITALIZE_THRESHOLD, CAPITALIZE_CHECK_THRESHOLD, MEALS_DEDUCTIBLE_RATE, DEFAULT_IBR, AI_CONFIDENCE_AUTO_BOOK, AI_CONFIDENCE_REVIEW, AP_AUTO_APPROVE_THRESHOLD, PLATFORM_ADMIN_EMAILS } from "./lib/constants";
import { useAccounts } from "./hooks/useAccounts";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType, calcASC842 } from "./lib/gl";
import { initials, vendorColor } from "./lib/format";
import { classifyIntent, runAIBrain, okAIResponse } from "./lib/ai";
import { loadClientProfile, learnFromBooking, persistClientProfile, emptyProfile, addCustomRule } from "./lib/clientProfile";
import { isAllowedAIAction, isMutatingAIAction, AI_CAPABILITIES } from "./lib/aiCapabilities";
import { findDuplicate, detectRecurringPatterns, runAnomalyDetection } from "./lib/insights";
import { getTaxDeadlines, taxEstimate } from "./lib/tax";
import { flattenJournalEntries } from "./lib/ledger";
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
import OnboardView from "./components/views/OnboardView";

// journal_entries.source has a CHECK constraint. The client uses richer internal
// source markers (e.g. "bank_feed", "contract", "gaap_classification") for app
// logic, so we normalize to the DB's allowed set only at the persistence boundary.
const VALID_JE_SOURCES = ["manual", "bank_import", "universal_upload", "recurring", "opening_balance", "ar_invoice", "payroll", "api"];
const JE_SOURCE_MAP = {
  // document uploads (+ everything derived from an uploaded doc)
  universal_upload: "universal_upload", needs_review: "universal_upload", watch_trigger: "universal_upload",
  gaap_prepaid: "universal_upload", gaap_prepaid_amort: "universal_upload", gaap_classification: "universal_upload",
  contract: "universal_upload",                 // closest match per spec
  // bank-derived
  bank_statement: "bank_import", bank_feed: "bank_import", matching_engine: "bank_import",
  reconciliation: "bank_import", qbo_import: "bank_import",
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
      setCurrentCompany(prev => prev || (cos.length > 0 ? cos[0] : null));
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
      <div style={{minHeight:"100vh",background:"#F7F8FA",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"}}>
        <div style={{color:"#475467",fontSize:14}}>Loading...</div>
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
    <div style={{ minHeight:"100vh", background:"#F7F8FA", display:"flex", alignItems:"center", justifyContent:"center", padding:24, fontFamily:"'DM Sans', system-ui, sans-serif" }}>
      <div style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:16, boxShadow:"0 8px 28px rgba(17,24,39,0.10)", padding:32, maxWidth:480, width:"100%", textAlign:"center" }}>
        <div style={{ fontSize:34, marginBottom:10 }}>⚠️</div>
        <h1 style={{ fontSize:20, fontWeight:700, margin:"0 0 8px", color:"#101828" }}>Something went wrong</h1>
        <p style={{ fontSize:14, color:"#475467", lineHeight:1.6, margin:"0 0 20px" }}>Our team has been notified. Refreshing usually fixes it.</p>
        <button onClick={()=>window.location.reload()}
          style={{ padding:"11px 22px", borderRadius:10, background:"#4F46E5", border:"none", color:"#fff", fontSize:14, fontWeight:600, cursor:"pointer" }}>Refresh</button>
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
  const enterSupport = (company) => {
    if (!company?.id) return;
    setSupportMode({ company, adminCompany: currentCompany });
    onSwitchCompany(company);
    setView("dashboard");
    showNotification(`Support Mode — viewing ${company.name}`);
  };
  const exitSupport = () => {
    setSupportMode(prev => { if (prev?.adminCompany) onSwitchCompany(prev.adminCompany); return null; });
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
    businessType: "",          // SaaS | Consulting | Restaurant | ... (migration 025)
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

  // ── OPENING BALANCES ─────────────────────────────────────────────────────────
  // { account_code, account_name, balance, as_of_date, posted }
  const [openingBalances, setOpeningBalances] = useState([]);

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
  const CHAT_GREETING = "Hey — I'm Shadow CFO. Just upload your documents on Home and I'll handle the bookkeeping. Ask me anything — your burn rate, P&L, unpaid bills — or tell me what to do and I'll take you there. What do you need?";
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
    setRules([]); setContacts([]); setCustomProjects([]);
    setContracts([]); setRecurring([]); setAuditLog([]); setDocLibrary([]);
    setBankTransactions([]); setUnknownDocs([]); setUploadQueue([]);
    setMatchQueue([]); setMatchHistory([]); setPayrollImports([]);
    setReconSessions([]); setReconciliations([]); setOpeningBalances([]);
    setSentInvoices([]); setClarificationQueue([]);
    setBankAccounts([{ id:"default", name:"Primary Checking", type:"checking", gl_code:rc("cash"), last4:"", institution:"" }]);
    setCompanySettings({ name:"", taxId:"", address:"", city:"", state:"", zip:"", country:"US", fiscalYearEnd:"12-31", defaultCashAccount:"1000", defaultAPAccount:"2000", defaultARAccount:"1100", currency:"USD", logoBase64:null });

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
        setCompanySettings({
          name: co.name||"", taxId: co.tax_id||"", address: co.address||"",
          city: co.city||"", state: co.state||"", zip: co.zip||"",
          country: co.country||"US", fiscalYearEnd: co.fiscal_year_end||"12-31",
          defaultCashAccount: co.default_cash_account||"1000",
          defaultAPAccount: co.default_ap_account||rc("accounts_payable"),
          defaultARAccount: co.default_ar_account||rc("accounts_receivable"),
          currency: co.currency||"USD", logoBase64: null,
          businessType: co.business_type||"",
          onboardingComplete: !!co.onboarding_complete,
        });
      }

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
  // Reclassify the debit line of an existing journal entry in Supabase
  const persistRecode = async (recodedInvoices, newGlCode, newGlName) => {
    if (!currentCompany?.id) return;
    const withDbId = recodedInvoices.filter(i => i.db_entry_id);
    if (withDbId.length === 0) return;
    try {
      // Ensure the new account exists in Supabase
      let { data: acctRow } = await supabase.from("accounts")
        .select("id").eq("company_id", currentCompany.id).eq("code", newGlCode).single();
      if (!acctRow) {
        const acctDef = CHART_OF_ACCOUNTS.find(a => a.code === newGlCode);
        const { data: created } = await supabase.from("accounts").insert({
          company_id: currentCompany.id, code: newGlCode,
          name: newGlName || acctDef?.name || newGlCode,
          account_type: acctDef?.category?.toLowerCase() || "expense",
        }).select("id").single();
        acctRow = created;
      }
      if (!acctRow?.id) return;
      // Update the primary (debit) line of each journal entry
      for (const inv of withDbId) {
        const isDebit = inv.debit_credit !== "credit";
        if (isDebit) {
          await supabase.from("journal_entry_lines")
            .update({ account_id: acctRow.id })
            .eq("journal_entry_id", inv.db_entry_id)
            .gt("debit", 0);
        } else {
          await supabase.from("journal_entry_lines")
            .update({ account_id: acctRow.id })
            .eq("journal_entry_id", inv.db_entry_id)
            .gt("credit", 0);
        }
      }
    } catch(e) { console.error("persistRecode error:", e); }
  };

  // Write a journal entry to Supabase when an invoice is booked
  const persistJournalEntry = async (invoice) => {
    if (!currentCompany?.id || !session?.user?.id) return;
    try {
      const ensureAccount = async (code, name) => {
        if (!code) return null;
        let { data } = await supabase.from("accounts")
          .select("id").eq("company_id", currentCompany.id).eq("code", code).single();
        if (data) return data;
        const acctDef = CHART_OF_ACCOUNTS.find(a => a.code === code);
        const { data: created } = await supabase.from("accounts").insert({
          company_id: currentCompany.id, code,
          name: name || acctDef?.name || code,
          account_type: acctDef?.category?.toLowerCase() || "expense",
        }).select("id").single();
        return created;
      };

      const isDebit = invoice.debit_credit !== "credit";
      const primaryAcct    = await ensureAccount(invoice.gl_code, invoice.gl_name);
      const secondaryAcct  = await ensureAccount(invoice.secondary_gl_code || rc("accounts_payable"), invoice.secondary_gl_name || rn("accounts_payable"));
      if (!primaryAcct) { console.error("persistJournalEntry: no primary account", invoice.gl_code); return null; }

      const amt = Number(invoice.amount) || 0;
      const memo = invoice.description;
      // Balanced lines (no journal_entry_id — the RPC assigns it atomically).
      const lines = [];
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

      const entryDate   = invoice.date || new Date().toISOString().slice(0,10);
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
    if (n.link_view) setView(n.link_view);
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
      if (topAnom) createNotification({ type: "anomaly", title: topAnom.title, description: topAnom.description, link_view: "home" });
    } catch (e) { console.warn("[notifications] generate failed:", e?.message || e); }
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
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCompany?.id]);

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
      }
      return jeId;
    });
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
  const voidInvoiceWithUndo = (invoice, reason, byAI=false) => {
    if (!invoice) return;
    const snap = { ...invoice };
    setInvoices(prev => prev.map(i => String(i.id) === String(snap.id) ? { ...i, status:"voided", voided_at:new Date().toISOString(), voided_reason: reason || "Voided" } : i));
    logAudit("invoice_voided", `Voided ${snap.vendor} · $${snap.amount}`, snap, null, byAI ? "AI Chat" : "owner");
    showNotification(`Voided ${snap.vendor || "entry"} — tap Undo to restore`, "success", () => {
      setInvoices(prev => prev.map(i => String(i.id) === String(snap.id) ? { ...i, status: snap.status || "booked", voided_at: snap.voided_at || null, voided_reason: snap.voided_reason || null } : i));
      logAudit("invoice_unvoided", `Restored (un-voided): ${snap.vendor}`, null, snap);
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

  const buildGaapClarification = (invoice) => {
    if (invoice.type === "revenue") return null;
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

  // Books a prepaid invoice: prepaid asset on purchase + monthly amortization entries.
  const bookPrepaid = (inv, months, opt) => {
    const amt = Number(inv.amount) || 0;
    const expenseCode = inv.gl_code, expenseName = inv.gl_name;
    const prepaidName = rn("prepaid_expenses");
    const prepaidEntry = { ...inv, gl_code:rc("prepaid_expenses"), gl_name:prepaidName,
      secondary_gl_code:rc("accounts_payable"), secondary_gl_name:rn("accounts_payable"), debit_credit:"debit",
      confidence:100, status:"booked", booked_at:new Date().toISOString(), source:"gaap_prepaid",
      reasoning: opt.reasoning || `Recorded as a prepaid asset, amortizing over ${months} months.`, prepaid_months: months };
    setInvoices(prev => [prepaidEntry, ...prev]);
    bookToDb(prepaidEntry);
    if (prepaidEntry._contact) createOrUpdateContact({ ...prepaidEntry._contact, gl_code:rc("prepaid_expenses"), gl_name:prepaidName });

    const per = Math.round((amt / months) * 100) / 100;
    const start = inv.date ? new Date(inv.date+"T12:00:00") : new Date();
    const amortInvoices = [];
    for (let k=0;k<Math.min(months,60);k++){
      const dt = new Date(start.getFullYear(), start.getMonth()+k, start.getDate());
      amortInvoices.push({ id: Date.now()+Math.random()+k, vendor: inv.vendor,
        description:`${inv.description||expenseName} — amortization ${k+1}/${months}`, amount: per,
        date: dt.toISOString().slice(0,10), type:"expense", project: inv.project||"General",
        gl_code: expenseCode, gl_name: expenseName, secondary_gl_code:rc("prepaid_expenses"), secondary_gl_name:prepaidName,
        debit_credit:"debit", confidence:100, reasoning:`Monthly amortization of prepaid ${expenseName} (${k+1} of ${months}).`,
        status:"booked", booked_at:new Date().toISOString(), source:"gaap_prepaid_amort", payment_status:"paid" });
    }
    setInvoices(prev => [...amortInvoices, ...prev]);
    amortInvoices.forEach(e => bookToDb(e));
    logAudit("invoice_booked", `${inv.vendor} · ${fmtMoney(amt)} recorded as prepaid (1300), amortizing over ${months} months`, null, { vendor:inv.vendor, amount:amt, gl_code:rc("prepaid_expenses"), months });
    showNotification(`Recorded as prepaid — spread over ${months} months ✓`);
  };

  // Applies the user's answer to a GAAP clarification card and books the entry.
  const applyGaapAnswer = (item, opt) => {
    const inv = item.invoice;
    setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
    if (opt.prepaidMonths) { bookPrepaid(inv, opt.prepaidMonths, opt); return; }
    const finalInv = { ...inv,
      gl_code: opt.gl_code || inv.gl_code, gl_name: opt.gl_name || inv.gl_name,
      secondary_gl_code:rc("accounts_payable"), secondary_gl_name:rn("accounts_payable"), debit_credit:"debit",
      confidence:100, status:"booked", booked_at:new Date().toISOString(), source:"gaap_classification",
      reasoning: opt.reasoning || inv.reasoning,
      needs_depreciation: opt.depreciate ? true : undefined,
      nondeductible: opt.nondeductible ? true : undefined,
      business_use_pct: opt.vehiclePct || undefined,
      deductible_amount: opt.vehiclePct ? (Number(inv.amount)||0)*opt.vehiclePct/100 : undefined };
    setInvoices(prev => [finalInv, ...prev]);
    bookToDb(finalInv);
    if (finalInv._contact) createOrUpdateContact({ ...finalInv._contact, gl_code: finalInv.gl_code, gl_name: finalInv.gl_name });
    logAudit("invoice_booked", `${finalInv.vendor} · ${fmtMoney(finalInv.amount)} → ${finalInv.gl_name} (GAAP ${item.gaapType})`, null, { vendor:finalInv.vendor, amount:finalInv.amount, gl_code:finalInv.gl_code, gl_name:finalInv.gl_name, reasoning: finalInv.reasoning });
    showNotification(`Booked to ${finalInv.gl_name} ✓`);
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
          confirmBg: "#ECFDF5", confirmBorder: "1px solid #03985544", confirmColor: "#039855",
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
    const t = (d.content?.find(b=>b.type==="text")?.text||"").trim().toLowerCase();
    if (t.includes("bank")) return "bank_statement";
    if (t.includes("contract")) return "contract";
    if (t.includes("unknown")) return "unknown";
    return "invoice";
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

        const docType = isSpreadsheet ? "bank_statement" : await classifyFile(base64, mediaType, item.name);

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
  {"vendor":"Exact vendor name","description":"what was purchased","amount":"123.45","date":"YYYY-MM-DD","type":"expense or revenue","invoice_number":"INV-001 or empty string if none","notes":"line items, tax, and other details","vendor_address":"full mailing address if shown, else empty","vendor_email":"email if shown, else empty","vendor_phone":"phone if shown, else empty","vendor_website":"website/domain if shown, else empty","payment_terms":"e.g. Net 30 if shown, else empty","account_number":"our account number with this vendor if shown, else empty","tax_id":"their EIN / tax ID if shown, else empty","confidence_score":0.95,"questions":[]},
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

To determine type — DEFAULT TO "expense" when unclear. The vast majority of uploaded documents are vendor bills this business must pay.
- type = "expense": a vendor/supplier is billing this business. Signals: "Bill To: [your company]", "Please remit", "Amount Due", vendor is a supplier/service provider, utility, or contractor.
- type = "revenue": ONLY use this when there are clear, unambiguous signals the business itself issued the invoice TO a customer. Signals: this business name appears as the FROM/issuing party, "Invoice To: [customer name]", customer is being charged.
- When in doubt or ambiguous, always use "expense".

Rules:
- Do NOT merge multiple invoices into one — each distinct invoice gets its own object
- amount = total due on that specific invoice only`,
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
              date: extracted.date || new Date().toISOString().slice(0,10),
              type: extracted.type || "expense",
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
            // GAAP review — capital vs expense, prepaid, leasehold, vehicle.
            const gaapItem = buildGaapClarification(invoice);

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
            // Revenue classification always needs human confirmation — the prompt defaults to expense,
            // so a "revenue" result means the AI saw a signal but it may still be wrong.
            } else if (!rule && isRevenue) {
              const revenueAccts = CHART_OF_ACCOUNTS.filter(a => a.category === "Revenue").slice(0, 2);
              const expenseAccts = CHART_OF_ACCOUNTS.filter(a => a.category === "Expenses")
                .filter(a => [rc("cogs"),rc("professional_services"),rc("technology_software")].includes(a.code));
              needsClarification.push({
                id: Date.now() + Math.random(),
                invoice,
                queueItemId: item.id,
                question: `This looks like revenue — confirm: did your business issue this invoice TO a customer? Or is it a bill you received?`,
                options: [
                  ...revenueAccts.map(a => ({ code: a.code, name: a.name })),
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
          const withRules = categorized.map((t,i) => {
            const rule = rules.find(r => r.vendor?.toLowerCase()===t.vendor?.toLowerCase());
            return rule ? {...t, gl_code:rule.gl_code, gl_name:rule.gl_name, confidence:99, needs_review:false, rule_applied:true} : {...t, id:Date.now()+i};
          });
          // ── RECONCILIATION: match the statement against open payables/receivables ──
          // Normalize each parsed line into a matching-engine transaction (signed amount).
          const bankTxns = withRules.map((t,i) => ({
            id: t.id || (Date.now()+i+Math.random()),
            date: t.date, description: t.description, vendor: t.vendor,
            amount: t.type === "revenue" ? Math.abs(t.amount) : -Math.abs(t.amount),
            type: t.type, gl_code: t.gl_code, gl_name: t.gl_name, confidence: t.confidence,
          }));

          const { autoCleared, queue } = await runMatchingEngine(bankTxns, invoices);

          // Auto-apply high-confidence matches: mark the open item paid/collected straight
          // from the bank statement (date + method), and persist it.
          const handledBankIds = new Set();
          const clearedInvIds = new Set();
          autoCleared.forEach(m => {
            handledBankIds.add(m.bank_txn_id);
            const bdate = m.bank_txn?.date;
            const isAR = (m.match_type||"").includes("ar");
            const paidAtISO = bdate ? new Date(bdate+"T12:00:00").toISOString() : new Date().toISOString();
            setInvoices(prev => prev.map(inv => !m.invoice_ids.includes(inv.id) ? inv : {
              ...inv, payment_status: isAR ? "collected" : "paid", matched: true, auto_matched: true,
              paid_at: paidAtISO, payment_method_used: "bank_transfer",
              matched_bank_date: bdate, matched_bank_txn: m.bank_txn?.description,
            }));
            m.invoice_ids.forEach(id => {
              clearedInvIds.add(id);
              const inv = invoices.find(i => i.id === id);
              if (inv) {
                logAudit("invoice_auto_paid", `${inv.vendor} · $${(inv.amount||0).toFixed(2)} auto-matched & marked ${isAR?"collected":"paid"} from bank statement (${bdate||"n/a"})`, { payment_status: inv.payment_status }, { payment_status: isAR?"collected":"paid", auto_matched: true, bank_date: bdate });
                persistApStatus(inv.db_entry_id, { payment_status: isAR ? "collected" : "paid", payment_method: "bank_transfer", paid_at: paidAtISO });
              }
            });
          });

          // Lower-confidence matches → review queue (opened from the inline summary).
          if (queue.length > 0) {
            queue.forEach(m => handledBankIds.add(m.bank_txn_id));
            setMatchQueue(prev => [...queue, ...prev]);
          }

          // Bank lines that matched nothing are genuinely new transactions — book them all
          // (paid via bank transfer, since they already cleared the bank). There is no
          // separate bank feed anymore, so low-confidence GL codes are booked with their
          // best guess rather than parked.
          const unmatchedTxns = withRules.filter(t => !handledBankIds.has(t.id));
          const newInvoices = unmatchedTxns.map((t)=>({
            id:Date.now()+Math.random(), vendor:t.vendor, description:t.description, amount:Math.abs(t.amount),
            date:t.date, type:t.type, project:"General", gl_code:t.gl_code, gl_name:t.gl_name,
            secondary_gl_code:rc("cash"), secondary_gl_name:rn("cash"),
            debit_credit:"debit", confidence:t.confidence, reasoning:"Imported via bank statement (no open item matched)",
            status:"booked", booked_at:new Date().toISOString(), source:"bank_statement",
            payment_status:"paid", payment_method_used:"bank_transfer", matched:true, auto_matched:true,
            matched_bank_date:t.date, paid_at: t.date ? new Date(t.date+"T12:00:00").toISOString() : new Date().toISOString(),
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
            company_id: currentCompany.id, account_name: "Bank statement upload",
            period_start: txnDates[0] || new Date().toISOString().slice(0,10),
            period_end: txnDates[txnDates.length-1] || new Date().toISOString().slice(0,10),
            statement_balance: 0, books_balance: 0, difference: 0,
            status: queue.length > 0 ? "needs_review" : "complete",
            matched_transactions: autoCleared.map(m => ({ bank_txn: m.bank_txn, invoice_ids: m.invoice_ids, confidence: m.confidence })),
            unmatched_bank: newInvoices.map(i => ({ vendor: i.vendor, amount: i.amount, date: i.date, gl_name: i.gl_name })),
            completed_at: new Date().toISOString(), completed_by: session?.user?.email || null,
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
            needsReview: queue.length, stillOpenTotal,
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
  const handleBankFile = async (file) => {
    if (!file) return;
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

  const bookBankTransactions = async () => {
    const toBook = bankTransactions.filter(t => t.checked);
    if (toBook.length === 0) { showNotification("Select at least one transaction to book.", "error"); return; }
    const newInvoices = toBook.map(t => ({
      id: t.id, vendor: t.vendor, description: t.description, amount: Math.abs(t.amount),
      date: t.date, type: t.type, project: "General", gl_code: t.gl_code, gl_name: t.gl_name,
      secondary_gl_code: rc("cash"),
      secondary_gl_name: rn("cash"),
      debit_credit: t.type==="expense"?"debit":"credit", confidence: t.confidence,
      reasoning: `Imported from bank statement${t.rule_applied?" (vendor rule applied)":""}`,
      status:"booked", booked_at: new Date().toISOString(), source:"bank_feed",
      payment_status: "unmatched",
    }));

    // Add to ledger first
    const updatedInvoices = [...newInvoices, ...invoices];
    setInvoices(updatedInvoices);
    setBankTransactions(prev => prev.filter(t => !t.checked));
    if (bankTransactions.filter(t=>!t.checked).length === 0) setBankFileName("");
    checkWatchTriggers(newInvoices, unknownDocs);

    // Run matching engine against all open items
    const openItems = updatedInvoices.filter(i => !i.matched && i.payment_status !== "paid" && i.payment_status !== "collected" && i.source !== "bank_feed");
    if (openItems.length > 0) {
      showNotification(`${newInvoices.length} transactions booked — running matching engine...`);
      const { autoCleared, queue } = await runMatchingEngine(newInvoices, updatedInvoices);

      // Auto-apply high confidence matches
      for (const match of autoCleared) {
        applyMatch(match);
      }

      // Add ambiguous matches to queue
      if (queue.length > 0) {
        setMatchQueue(prev => [...queue, ...prev]);
        showNotification(`${autoCleared.length} auto-cleared · ${queue.length} match${queue.length!==1?"es":""} need review`);
        setView("matching");
      } else if (autoCleared.length > 0) {
        showNotification(`${autoCleared.length} accrual${autoCleared.length!==1?"s":""} auto-cleared ✓`);
      }
    } else {
      showNotification(`${newInvoices.length} transaction${newInvoices.length!==1?"s":""} booked ✓`);
    }
  };

  // ── CONTRACT HANDLER ─────────────────────────────────────────────────────────
  const CONTRACT_TYPES = {
    loan: { label:"Loan / Debt", color:"#D92D20", icon:"🏦" },
    revenue_contract: { label:"Revenue Contract", color:"#039855", icon:"📈" },
    lease: { label:"Lease", color:"#DC6803", icon:"🏢" },
    subscription_paid: { label:"Subscription (Paid)", color:"#6366F1", icon:"💳" },
    subscription_received: { label:"Subscription (Received)", color:"#6366F1", icon:"📦" },
    equipment_financing: { label:"Equipment Financing", color:"#EC4899", icon:"⚙️" },
    service_agreement: { label:"Service Agreement / Retainer", color:"#14B8A6", icon:"🤝" },
  };

  const handleContractFile = async (file) => {
    if (!file) return;
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

  const postContractEntry = (contract, entryIdx) => {
    const entry = contract.journal_entries[entryIdx];
    if (!entry) return;

    // Post EVERY line as a proper ledger record — both debit and credit sides
    // This ensures balance sheet accounts (ROU Asset, Lease Liability) are captured
    const newInvoices = entry.lines.map((l, li) => {
      const isDebit = l.debit > 0;
      const amount = isDebit ? l.debit : l.credit;
      const acct = CHART_OF_ACCOUNTS.find(a => a.code === l.account_code);
      const category = acct?.category || "Expenses";

      // Find the offsetting line for this entry line
      const offsetLine = isDebit
        ? entry.lines.find(x => x.credit > 0)
        : entry.lines.find(x => x.debit > 0);

      return {
        id: Date.now() + Math.random() + li,
        vendor: contract.counterparty,
        description: `${entry.description}${entry.memo ? ` — ${entry.memo}` : ""}`,
        amount,
        date: entry.date,
        type: ["Revenue"].includes(category) ? "revenue" : "expense",
        project: "General",
        gl_code: l.account_code,
        gl_name: l.account_name,
        secondary_gl_code: offsetLine?.account_code || rc("accounts_payable"),
        secondary_gl_name: offsetLine?.account_name || rn("accounts_payable"),
        debit_credit: isDebit ? "debit" : "credit",
        confidence: 99,
        reasoning: `Posted from contract (ASC 842/GAAP): ${contract.description}`,
        status: "booked",
        booked_at: new Date().toISOString(),
        source: "contract",
        contract_id: contract.id,
        balance_sheet_account: ["Assets","Liabilities","Equity"].includes(category),
      };
    });

    setInvoices(prev => [...newInvoices, ...prev]);
    newInvoices.forEach(inv => bookToDb(inv));

    const updatedContract = {...contract, posted_entries: [...(contract.posted_entries||[]), entryIdx]};
    setContracts(prev => prev.map(c => c.id===contract.id ? updatedContract : c));
    setSelectedContract(prev => ({...prev, posted_entries: [...(prev.posted_entries||[]), entryIdx]}));
    persistContract(updatedContract);
    showNotification(`Journal entry posted to ledger ✓`);
  };

  const postAllContractEntries = (contract) => {
    const unpostedIndexes = (contract.journal_entries || [])
      .map((_, i) => i)
      .filter(i => !(contract.posted_entries || []).includes(i));

    if (unpostedIndexes.length === 0) return;

    // Collect all new invoices from all entries at once
    const allNewInvoices = [];
    unpostedIndexes.forEach(idx => {
      const entry = contract.journal_entries[idx];
      if (!entry) return;
      entry.lines.forEach((l, li) => {
        const isDebit = l.debit > 0;
        const amount = isDebit ? l.debit : l.credit;
        const acct = CHART_OF_ACCOUNTS.find(a => a.code === l.account_code);
        const category = acct?.category || "Expenses";
        const offsetLine = isDebit ? entry.lines.find(x => x.credit > 0) : entry.lines.find(x => x.debit > 0);
        allNewInvoices.push({
          id: Date.now() + Math.random() + idx * 100 + li,
          vendor: contract.counterparty,
          description: `${entry.description}${entry.memo ? ` — ${entry.memo}` : ""}`,
          amount,
          date: entry.date,
          type: ["Revenue"].includes(category) ? "revenue" : "expense",
          project: "General",
          gl_code: l.account_code,
          gl_name: l.account_name,
          secondary_gl_code: offsetLine?.account_code || rc("accounts_payable"),
          secondary_gl_name: offsetLine?.account_name || rn("accounts_payable"),
          debit_credit: isDebit ? "debit" : "credit",
          confidence: 99,
          reasoning: `Posted from contract: ${contract.description}`,
          status: "booked",
          booked_at: new Date().toISOString(),
          source: "contract",
          contract_id: contract.id,
          balance_sheet_account: ["Assets","Liabilities","Equity"].includes(category),
        });
      });
    });

    // Single state update for all invoices
    setInvoices(prev => [...allNewInvoices, ...prev]);
    allNewInvoices.forEach(inv => bookToDb(inv));

    // Single contract state update
    const allPosted = [...(contract.posted_entries || []), ...unpostedIndexes];
    const updatedContract = {...contract, posted_entries: allPosted};
    setContracts(prev => prev.map(c => c.id === contract.id ? updatedContract : c));
    setSelectedContract(updatedContract);
    persistContract(updatedContract);
    showNotification(`✓ Posted all ${unpostedIndexes.length} entries to ledger`);
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
  const applyMatch = (matchRecord) => {
    const { clearing_entry, invoice_ids, match_type, amount_matched, amount_remaining, bank_txn } = matchRecord;

    // Post the clearing journal entry to the ledger
    if (clearing_entry) {
      const clearingInvoice = {
        id: Date.now() + Math.random(),
        vendor: bank_txn?.vendor || matchRecord.matched_invoices?.[0]?.vendor || "Clearing Entry",
        description: clearing_entry.description,
        amount: clearing_entry.amount,
        date: bank_txn?.date || new Date().toISOString().slice(0, 10),
        type: match_type === "ar_clear" || match_type === "partial_ar" ? "revenue" : "expense",
        project: "General",
        gl_code: clearing_entry.debit_account_code,
        gl_name: clearing_entry.debit_account_name,
        secondary_gl_code: clearing_entry.credit_account_code,
        secondary_gl_name: clearing_entry.credit_account_name,
        debit_credit: "debit",
        confidence: matchRecord.confidence,
        reasoning: `Clearing entry: ${matchRecord.reasoning}`,
        status: "booked",
        booked_at: new Date().toISOString(),
        source: "matching_engine",
        matched: true,
      };
      setInvoices(prev => [clearingInvoice, ...prev]);
    }

    // Mark matched invoices as paid/collected (or partial)
    setInvoices(prev => prev.map(inv => {
      if (!invoice_ids.includes(inv.id)) return inv;
      const isPaid = !amount_remaining || amount_remaining < 0.01;
      return {
        ...inv,
        matched: isPaid,
        payment_status: isPaid ? (match_type.includes("ar") ? "collected" : "paid") : "partial",
        balance_remaining: amount_remaining || 0,
        matched_at: new Date().toISOString(),
        matched_bank_txn: bank_txn?.description,
      };
    }));

    // Move from queue to history
    const confirmed = { ...matchRecord, status: "confirmed", confirmed_at: new Date().toISOString() };
    setMatchQueue(prev => prev.filter(m => m.id !== matchRecord.id));
    setMatchHistory(prev => [confirmed, ...prev]);
    showNotification(`Match confirmed — clearing entry posted ✓`);
  };

  const dismissMatch = (matchId) => {
    setMatchQueue(prev => prev.filter(m => m.id !== matchId));
    showNotification("Match dismissed", "error");
  };

  // ── AP MANAGEMENT ENGINE ──────────────────────────────────────────────────────
  const AP_PRIORITY = { critical:"#D92D20", high:"#DC6803", normal:"#039855", low:"#475467" };

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

  // Persist AP workflow status onto the source journal_entries row.
  // Resilient: warns (instead of throwing) if the columns aren't migrated yet.
  const persistApStatus = async (dbEntryId, fields) => {
    if (!dbEntryId || !currentCompany?.id) return;
    const { error } = await supabase.from("journal_entries")
      .update(fields).eq("id", dbEntryId).eq("company_id", currentCompany.id);
    if (error) console.warn("[AP] status persist failed (apply migration 003_ap_workflow.sql?):", error.message);
  };

  const approveInvoice = (invId) => {
    const inv = invoices.find(i => i.id === invId);
    const who = session?.user?.email || "owner";
    const at = new Date().toISOString();
    setInvoices(prev => prev.map(i => i.id !== invId ? i : {
      ...i, approval_status: "approved", approval_reason: "Manually approved", approved_at: at, approved_by: who,
    }));
    if (inv) {
      logAudit("invoice_approved", `${who} approved ${inv.vendor} · $${(inv.amount||0).toFixed(2)} (${inv.gl_name})`, { approval_status: inv.approval_status }, { approval_status: "approved", approved_by: who });
      persistApStatus(inv.db_entry_id, { approval_status: "approved", approved_at: at, approved_by: who });
    }
    showNotification("Invoice approved ✓");
  };

  const rejectInvoice = (invId, reason) => {
    const inv = invoices.find(i => i.id === invId);
    const who = session?.user?.email || "owner";
    const at = new Date().toISOString();
    const why = (reason && String(reason).trim()) || "No reason given";
    setInvoices(prev => prev.map(i => i.id !== invId ? i : {
      ...i, approval_status: "rejected", approval_reason: why, rejection_reason: why, rejected_at: at, approved_by: who, payment_status: "rejected",
    }));
    if (inv) {
      logAudit("invoice_rejected", `${who} rejected ${inv.vendor} · $${(inv.amount||0).toFixed(2)} — reason: ${why}`, { approval_status: inv.approval_status }, { approval_status: "rejected", reason: why, by: who });
      persistApStatus(inv.db_entry_id, { approval_status: "rejected", rejected_at: at, rejection_reason: why, approved_by: who, payment_status: "rejected" });
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
      persistApStatus(inv.db_entry_id, { approval_status: "info_requested" });
    }
    showNotification("Marked as info requested");
  };

  const methodPretty = (m) => ({ ach:"ACH / Bank Transfer", check:"Check", wire:"Wire Transfer", card:"Credit Card", zelle:"Zelle", venmo:"Venmo", paypal:"PayPal", other:"Other" }[m] || String(m||"").toUpperCase());

  const markPaid = (invIds, method = "ach", details = {}) => {
    const ids = Array.isArray(invIds) ? invIds : [invIds];
    const who = session?.user?.email || "owner";
    const reference = (details.reference || "").trim();
    const notes = (details.notes || "").trim();
    // Use the chosen payment date (fall back to now)
    const at = details.date ? new Date(details.date + "T12:00:00").toISOString() : new Date().toISOString();
    const paid = invoices.filter(i => ids.includes(i.id));
    setInvoices(prev => prev.map(inv => !ids.includes(inv.id) ? inv : {
      ...inv, payment_status: "paid", payment_method_used: method, paid_at: at, matched: true,
      payment_reference: reference || undefined, payment_notes: notes || undefined,
    }));
    paid.forEach(inv => {
      const refStr = reference ? ` · ref ${reference}` : "";
      const noteStr = notes ? ` · note: ${notes}` : "";
      logAudit("invoice_paid", `${who} paid ${inv.vendor} · $${(inv.amount||0).toFixed(2)} via ${methodPretty(method)}${refStr}${noteStr}`, { payment_status: inv.payment_status }, { payment_status: "paid", method, reference, notes, by: who });
      // Core payment fields (migration 003)
      persistApStatus(inv.db_entry_id, { payment_status: "paid", payment_method: method, paid_at: at });
      // Reference + notes (migration 004) — separate call so missing columns don't block the core update
      if (reference || notes) persistApStatus(inv.db_entry_id, { payment_reference: reference || null, payment_notes: notes || null });
    });
    setSelectedPayments(new Set());
    setCheckRunMode(false);
    showNotification(`Payment recorded — ${methodPretty(method)} ✓`);
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
        chartOfAccounts: CHART_OF_ACCOUNTS, clientProfile: clientProfileRef.current, cashBalance, anomalies,
        businessType: companySettings.businessType,
        // Function-calling: give the AI direct, RLS-scoped database access via tools.
        supabase, companyId: currentCompany?.id, getAccountByRole, recurring,
        onToolCall: (name, params) => { try { logAI("ai_tool_call", `AI called tool: ${name} with params: ${JSON.stringify(params)}`); } catch {} },
      });

      // Execute actions
      let actionSummary = [];
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
          setInvoices(prev => prev.map(inv =>
            action.invoiceIds.includes(inv.id)
              ? { ...inv, gl_code: action.gl_code, gl_name: action.gl_name, recode_note: `Recoded by AI assistant` }
              : inv
          ));
          logAudit("ai_recode", `AI recoded ${toRecode.length} invoice(s) → ${action.gl_name}`, beforeState, { gl_code: action.gl_code, gl_name: action.gl_name });
          persistRecode(toRecode, action.gl_code, action.gl_name); // fire-and-forget
          actionSummary.push(`Recoded ${toRecode.length} invoice(s) → ${action.gl_name}`);
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
            await addCustomAccount({ code: action.code, name: action.name, category: action.category });
            actionSummary.push(`Added account: ${action.code} ${action.name} (${action.category})`);
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
          // Create reversing journal entry (opposite debits/credits)
          const toReverse = invoices.find(i => String(i.id) === String(action.invoice_id));
          if (toReverse) {
            const reversed = {
              ...toReverse,
              id: Date.now() + Math.random(),
              amount: toReverse.amount,
              description: `REVERSAL: ${toReverse.description || toReverse.vendor}`,
              debit_credit: toReverse.debit_credit === "debit" ? "credit" : "debit",
              gl_code: toReverse.secondary_gl_code,
              gl_name: toReverse.secondary_gl_name,
              secondary_gl_code: toReverse.gl_code,
              secondary_gl_name: toReverse.gl_name,
              status: "booked",
              booked_at: new Date().toISOString(),
              source: "reversal",
              date: action.date || new Date().toISOString().slice(0,10),
            };
            setInvoices(prev => [reversed, ...prev]);
            bookToDb(reversed);
            actionSummary.push(`Reversing entry created for ${toReverse.vendor} $${toReverse.amount}`);
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

      const assistantMsg = {
        role: "assistant",
        content: memberBlocked
          ? "You're on a member seat, so I can't make changes like deleting, voiding, or recoding — those are reserved for admins and the owner. I can still answer questions, pull reports, and help you find things. Want me to do that instead?"
          : clarifyNeeded
            ? clarifyText()
            : bulkBlocked
              ? "I can delete items one at a time for safety. Which specific entry would you like me to remove first?"
              : (result.reply || "Done!"),
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
  // Use GL code to classify — never trust the stored "type" field for reporting
  const totalExpenses = invoices.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
  const totalRevenue  = invoices.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0);
  const netIncome = totalRevenue - totalExpenses;
  // GL breakdown — only income statement accounts
  const glBreakdown = invoices.reduce((acc,inv)=>{
    if (!glPLType(inv.gl_code)) return acc; // skip balance sheet accounts
    acc[inv.gl_name||"Uncoded"]=(acc[inv.gl_name||"Uncoded"]||0)+inv.amount;
    return acc;
  },{});

  const inputStyle = { width:"100%", background:"#F3F4F6", border:"1px solid #D0D5DD", borderRadius:8, padding:"10px 12px", color:"#101828", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" };
  const labelStyle = { display:"block", fontSize:11, color:"#475467", marginBottom:6, letterSpacing:1 };


  const erpCtx = { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyGaapAnswer, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, createOrUpdateContact, currentCompany, customCOA, customProjects, getAccountByRole, getAccountByCode, getAccountById, reloadAccounts, rc, rn, addCustomAccount, persistAccountEdit, deleteAccount, accountHasTransactions, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, glDrilldown, setGlDrilldown, booksFilter, setBooksFilter, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, reconciliations, setReconciliations, recurring, recurringNewRec, recurringSuggestions, acceptRecurringSuggestion, dismissRecurringSuggestion, persistBankAccounts, cashFromBanks, anomalies, dismissAnomaly, notifications, notifOpen, setNotifOpen, unreadNotifs, markNotifRead, markAllNotifsRead, clearAllNotifs, openNotification, onboardingUploadDone, businessModalOpen, setBusinessModalOpen, saveBusinessProfile, accountantDismissed, dismissAccountantStep, completeOnboarding, rejectInvoice, requestInfo, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, returnTo, setReturnTo, goBackFromDetail, softDeleteInvoice, softDeleteInvoices, voidInvoiceWithUndo, softDeleteContract, softDeleteContracts, restoreJournalEntries, dismissNotification, enterSupport, exitSupport, supportMode, view, legalTab, setLegalTab, userRole, isOwner, isAdmin, isMember };

  const SETTINGS_VIEWS = ["settings","team","coa","opening-balances","onboard","rules","recurring","tax1099","tax","audit"];
  // Only platform administrators see the Security tab / view.
  const isPlatformAdmin = PLATFORM_ADMIN_EMAILS.includes(session?.user?.email);
  return (
    <ERPContext.Provider value={erpCtx}>
    <div style={{ fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", minHeight:"100vh", background:"#F7F8FA", color:"#101828" }}>
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
        input:focus, select:focus, textarea:focus { border-color:#4F46E5 !important; box-shadow:0 0 0 3px rgba(79,70,229,0.10); outline:none; }
        /* Sticky table headers — column labels stay visible while the main area scrolls.
           background-color:inherit pulls each header row's own color onto the cells (the
           tr carries the bg inline; sticky th need their own paint to avoid bleed-through).
           Table-wrapping cards use overflow:clip (not hidden) so they don't become scroll
           containers that would trap the sticky headers. */
        #main-content thead th { position: sticky; top: 0; z-index: 10; background-color: inherit; }
        /* Nav tab hover — pure CSS so React fully owns the active state. Imperative
           DOM hover styling left residue (a hovered-then-abandoned tab kept its color
           because React saw no style diff to reset), making inactive tabs look active. */
        .sc-navtab:not(.active):hover{ background:#F3F4F6 !important; color:#818CF8 !important; }
        .sc-subtab:not(.active):hover{ color:#4F46E5 !important; }
        /* Sortable table headers — reveal the sort arrow on hover of inactive columns. */
        .sc-th-sort:hover{ color:#667085 !important; }
        .sc-th-sort:hover .sc-th-arrow{ opacity:1 !important; }
        /* Tabular figures for monospace numbers — fintech-grade alignment */
        [style*="DM Mono"]{ font-variant-numeric: tabular-nums; }
        /* Card elevation (used sparingly) */
        .sc-card{ box-shadow: 0 1px 3px rgba(16,24,40,0.1), 0 1px 2px rgba(16,24,40,0.06); }
        .sc-skeleton{ background:linear-gradient(90deg,#F2F4F7 0px,#E9ECF2 200px,#F2F4F7 400px); background-size:800px 100%; animation:shimmer 1.4s linear infinite; border-radius:6px; }
        ::-webkit-scrollbar{width:8px;height:8px} ::-webkit-scrollbar-track{background:transparent} ::-webkit-scrollbar-thumb{background:#D0D5DD;border-radius:8px} ::-webkit-scrollbar-thumb:hover{background:#98A2B3}
      `}</style>

      {notification && (
        <div style={{ position:"fixed", top:20, right:20, zIndex:9999, background:notification.type==="error"?"#FEF2F2":"#ECFDF5", border:`1px solid ${notification.type==="error"?"#D92D20":"#039855"}`, color:notification.type==="error"?"#D92D20":"#039855", padding:"12px 16px 12px 20px", borderRadius:10, fontSize:14, animation:"fadein 0.2s ease", boxShadow:"0 8px 32px rgba(16,24,40,0.18)", display:"flex", alignItems:"center", gap:16, maxWidth:480 }}>
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
          <div style={{ background:"#FFFFFF", border:"1px solid #D92D2033", borderRadius:16, padding:28, maxWidth:400, width:"90%", boxShadow:"0 24px 80px rgba(0,0,0,0.8)" }}>
            <div style={{ fontSize:16, fontWeight:600, marginBottom:10 }}>{deleteConfirm.title || "Confirm Delete"}</div>
            <div style={{ fontSize:13, color:"#475467", marginBottom:20, lineHeight:1.6 }}>{deleteConfirm.label}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={()=>setDeleteConfirm(null)} style={{ padding:"8px 20px", borderRadius:8, background:"transparent", border:"1px solid #D0D5DD", color:"#475467", fontSize:13, cursor:"pointer" }}>Cancel</button>
              <button onClick={()=>{ deleteConfirm.onConfirm(); setDeleteConfirm(null); }} style={{ padding:"8px 20px", borderRadius:8, background: deleteConfirm.confirmBg||"#FEE2E2", border: deleteConfirm.confirmBorder||"1px solid #D92D20", color: deleteConfirm.confirmColor||"#D92D20", fontSize:13, cursor:"pointer", fontWeight:600 }}>{deleteConfirm.confirmLabel || "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent upload status — visible from any tab */}
      {uploadQueue.some(q => q.status==="pending"||q.status==="classifying"||q.status==="processing") && (
        <div style={{ position:"fixed", bottom:100, left:"50%", transform:"translateX(-50%)", zIndex:999, background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:12, padding:"12px 20px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", minWidth:280 }}>
          <div style={{ display:"flex", gap:3 }}>
            {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#4F46E5", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
          </div>
          <div>
            <div style={{ fontSize:13, color:"#101828", fontWeight:500 }}>
              Processing {uploadQueue.filter(q=>q.status==="pending"||q.status==="classifying"||q.status==="processing").length} file{uploadQueue.filter(q=>q.status==="pending"||q.status==="classifying"||q.status==="processing").length>1?"s":""}...
            </div>
            <div style={{ fontSize:11, color:"#475467", marginTop:2 }}>
              {uploadQueue.find(q=>q.status==="processing"||q.status==="classifying")?.name || ""}
            </div>
          </div>
          <button onClick={()=>setView("home")} style={{ marginLeft:"auto", background:"none", border:"1px solid #D0D5DD", borderRadius:6, padding:"4px 10px", color:"#4F46E5", fontSize:11, cursor:"pointer", flexShrink:0 }}>View</button>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* SUPPORT MODE banner — persistent while a platform admin is viewing a client */}
        {supportMode && (
          <div style={{ flexShrink:0, background:"linear-gradient(90deg,#EA580C,#F97316)", color:"#fff", padding:"10px 24px", display:"flex", alignItems:"center", gap:14, flexWrap:"wrap", boxShadow:"0 2px 8px rgba(234,88,12,0.35)", zIndex:50 }}>
            <span style={{ fontSize:16 }}>🛟</span>
            <div style={{ flex:"1 1 320px", minWidth:0, fontSize:13, fontWeight:600 }}>
              SUPPORT MODE — Viewing <strong>{supportMode.company?.name || currentCompany?.name}</strong> as Platform Admin. Every action is real and logged.
            </div>
            <button onClick={exitSupport} style={{ flexShrink:0, background:"#FFFFFF", color:"#C2410C", border:"none", borderRadius:8, padding:"7px 16px", fontSize:13, fontWeight:700, cursor:"pointer" }}>Exit Support Mode →</button>
          </div>
        )}
        {/* Top Bar */}
        <div style={{ background:"#FFFFFF", borderBottom:"1px solid #E4E7EC", flexShrink:0 }}>
          {/* Brand + Company + User row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 32px", height:64 }}>
            <div onClick={()=>setView("home")} title="Go to Home" style={{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" }}>
              <svg width={26} height={26} viewBox="0 0 48 48" fill="none" aria-hidden style={{ flexShrink:0 }}>
                <defs>
                  <linearGradient id="scTopMark" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#818CF8" />
                    <stop offset="100%" stopColor="#4F46E5" />
                  </linearGradient>
                </defs>
                <circle cx="24" cy="24" r="13" fill="url(#scTopMark)" />
                <circle cx="30.5" cy="20.5" r="11" fill="#FFFFFF" />
              </svg>
              <span className="sc-wordmark" style={{ fontSize:16, letterSpacing:3, fontWeight:700, fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }}>SHADOW CFO</span>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:14 }}>
              <CompanySwitcher companies={companies} currentCompany={currentCompany} onSwitch={onSwitchCompany} onNew={onNewCompany} />
              <button onClick={()=>setView("settings")} title="Settings" aria-label="Settings"
                style={{ display:"flex", alignItems:"center", gap:7, padding:"7px 12px", borderRadius:9, background: SETTINGS_VIEWS.includes(view)?"#EEF2FF":"transparent", border:`1px solid ${SETTINGS_VIEWS.includes(view)?"#4F46E5":"#E4E7EC"}`, color: SETTINGS_VIEWS.includes(view)?"#4F46E5":"#475467", cursor:"pointer", transition:"all .15s" }}
                onMouseEnter={e=>{ if(!SETTINGS_VIEWS.includes(view)){ e.currentTarget.style.background="#F3F4F6"; e.currentTarget.style.color="#4F46E5"; }}}
                onMouseLeave={e=>{ if(!SETTINGS_VIEWS.includes(view)){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#475467"; }}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink:0 }}>
                  <circle cx="12" cy="12" r="3"></circle>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                </svg>
                <span style={{ fontSize:13, fontWeight:500 }}>Settings</span>
              </button>
              <span style={{ fontSize:11, color:"#98A2B3", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{session?.user?.email}</span>
              <button onClick={onSignOut} style={{ padding:"6px 14px", borderRadius:8, background:"transparent", border:"1px solid #D0D5DD", color:"#475467", fontSize:12, cursor:"pointer" }}>Sign out</button>
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
              <div style={{ display:"flex", width:"100%", borderBottom:"1px solid #E4E7EC", padding:"0 20px", gap:4 }}>
                {tabs.map(tab => {
                  const isActive = tab.group.includes(view);
                  const accent = tab.admin ? "#DC6803" : "#4F46E5";
                  return (
                    <button key={tab.id}
                      className={tab.admin ? undefined : (isActive?"sc-navtab active":"sc-navtab")}
                      onClick={()=>{ if(tab.id==="books") setBooksFilter("all"); setView(tab.id); setVendorFilter("all"); }}
                      onMouseEnter={tab.admin ? (e=>{ if(!isActive) e.currentTarget.style.background="#FEF0C7"; }) : undefined}
                      onMouseLeave={tab.admin ? (e=>{ if(!isActive) e.currentTarget.style.background="#FFFAEB"; }) : undefined}
                      style={{ height:46, padding:"0 16px", display:"flex", alignItems:"center", justifyContent:"center", gap:6,
                        background: tab.admin ? (isActive?"#FEF0C7":"#FFFAEB") : "transparent",
                        border: tab.admin ? "1px solid #FEDF89" : "none", borderBottomWidth: tab.admin?2:2,
                        borderBottom: isActive?`2px solid ${accent}`:(tab.admin?"2px solid #FEDF89":"2px solid transparent"),
                        borderRadius: tab.admin ? "8px 8px 0 0" : 0,
                        color: isActive?(tab.admin?"#B54708":"#101828"):(tab.admin?"#B54708":"#475467"), fontSize:14, fontWeight: isActive?600:(tab.admin?600:500),
                        cursor:"pointer", transition:"all 0.12s" }}>
                      {tab.label}
                      {tab.id==="home" && clarificationQueue.filter(c=>!c.resolved).length>0 && (
                        <span style={{ background:"#DC6803", color:"#fff", fontSize:10, fontWeight:700, borderRadius:20, padding:"1px 6px", lineHeight:1.4 }}>{clarificationQueue.filter(c=>!c.resolved).length}</span>
                      )}
                      {tab.admin && adminFailedCount>0 && (
                        <span title={`${adminFailedCount} failed upload${adminFailedCount!==1?"s":""} in 24h`} style={{ width:8, height:8, borderRadius:"50%", background:"#D92D20", display:"inline-block", flexShrink:0 }} />
                      )}
                    </button>
                  );
                })}
                {/* Notification bell (Item 55) — clean lucide-style icon, matched to
                    the Settings gear (muted #6B7280 → #4F46E5 on hover). */}
                <button onClick={()=>setNotifOpen(o=>!o)} title="Notifications" aria-label="Notifications"
                  style={{ marginLeft:"auto", alignSelf:"center", position:"relative", width:38, height:38, display:"flex", alignItems:"center", justifyContent:"center", background: notifOpen?"#EEF2FF":"transparent", border:"none", borderRadius:10, cursor:"pointer", color: notifOpen?"#4F46E5":"#6B7280", transition:"all .15s" }}
                  onMouseEnter={e=>{ if(!notifOpen){ e.currentTarget.style.background="#F3F4F6"; e.currentTarget.style.color="#4F46E5"; }}}
                  onMouseLeave={e=>{ if(!notifOpen){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#6B7280"; }}}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink:0 }}>
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  {unreadNotifs>0 && (
                    <span style={{ position:"absolute", top:2, right:2, width:16, height:16, borderRadius:"50%", background:"#D92D20", color:"#fff", fontSize:10, fontWeight:600, display:"flex", alignItems:"center", justifyContent:"center", lineHeight:1, border:"2px solid #FFFFFF" }}>{unreadNotifs>9?"9":unreadNotifs}</span>
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
              subs = [["settings","Company"],["coa","Chart of Accounts"],["opening-balances","Bank & Balances"],["rules","Rules"],["recurring","Recurring"],["tax","Taxes"],["tax1099","1099s"],["audit","Audit Trail"],["onboard","Import QBO"]];
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
              <div style={{ display:"flex", background:"#FFFFFF", borderBottom:"1px solid #F3F4F6", padding:"0 16px", gap:4, overflowX:"auto" }}>
                {subs.map(([id,label])=>(
                  <button key={id} onClick={()=>go(id)}
                    className={activeSub(id)?"sc-subtab active":"sc-subtab"}
                    style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:activeSub(id)?"2px solid #4F46E5":"2px solid transparent", color:activeSub(id)?"#4F46E5":"#475467", fontSize:12, cursor:"pointer", whiteSpace:"nowrap", transition:"color 0.12s", display:"inline-flex", alignItems:"center", gap:6 }}>
                    {label}
                    {id==="ap" && apUnpaid>0 && <span style={{ fontSize:10, fontWeight:700, color:"#B54708", background:"#FEF0C7", border:"1px solid #FEDF89", borderRadius:20, padding:"1px 7px", lineHeight:1.4 }}>{apUnpaid}</span>}
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
            <div style={{ background:"#FEF3C7", borderBottom:"1px solid #DC680344", padding:"10px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div style={{ fontSize:13, color:"#DC6803" }}>⚠ {clarificationQueue.filter(c=>!c.resolved).length} invoice{clarificationQueue.filter(c=>!c.resolved).length!==1?"s":""} need{clarificationQueue.filter(c=>!c.resolved).length===1?"s":""} review before booking</div>
              <button onClick={()=>setView("home")} style={{ background:"#DC680322", border:"1px solid #DC680344", color:"#DC6803", borderRadius:8, padding:"5px 12px", fontSize:12, cursor:"pointer" }}>Review →</button>
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
          {view==="onboard" && <OnboardView />}
          </div>
        </div>
      </div>

      {/* ── NOTIFICATION CENTER (Item 55) ──────────────────────────────────── */}
      {notifOpen && (() => {
        const META = {
          tax_deadline:        { icon:"📅", color:"#D92D20" },
          anomaly:             { icon:"⚠",  color:"#DC6803" },
          reconciliation:      { icon:"🏦", color:"#DC6803" },
          needs_review:        { icon:"📄", color:"#CA8504" },
          report_ready:        { icon:"📊", color:"#039855" },
          ai_action:           { icon:"✦",  color:"#4F46E5" },
          recurring_suggestion:{ icon:"↻",  color:"#4F46E5" },
        };
        const ago = (ts) => { if(!ts) return ""; const s=(Date.now()-new Date(ts))/1000; if(s<60) return "just now"; if(s<3600) return `${Math.floor(s/60)}m ago`; if(s<86400) return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`; };
        return (
          <div onClick={()=>setNotifOpen(false)} style={{ position:"fixed", inset:0, zIndex:1001, background:"rgba(17,24,39,0.25)", display:"flex", justifyContent:"flex-end" }}>
            <style>{`@keyframes notifIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
            <div onClick={e=>e.stopPropagation()} style={{ width:400, maxWidth:"94vw", height:"100%", background:"#FFFFFF", borderLeft:"1px solid #E4E7EC", boxShadow:"-20px 0 60px rgba(16,24,40,0.18)", display:"flex", flexDirection:"column", animation:"notifIn .22s cubic-bezier(.22,1,.36,1)" }}>
              <div style={{ padding:"18px 20px", borderBottom:"1px solid #F3F4F6", display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
                <div style={{ fontSize:16, fontWeight:700, color:"#101828" }}>Notifications</div>
                <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                  {unreadNotifs>0 && <button onClick={markAllNotifsRead} style={{ fontSize:12, color:"#4F46E5", background:"none", border:"none", cursor:"pointer", fontWeight:600 }}>Mark all read</button>}
                  <button onClick={()=>setNotifOpen(false)} style={{ background:"none", border:"none", color:"#475467", fontSize:22, lineHeight:1, cursor:"pointer" }}>×</button>
                </div>
              </div>
              <div style={{ flex:1, overflowY:"auto" }}>
                {notifications.length===0 ? (
                  <div style={{ padding:"48px 24px", textAlign:"center", color:"#98A2B3", fontSize:13, lineHeight:1.6 }}>
                    <div style={{ fontSize:32, marginBottom:10 }}>🔔</div>You're all caught up. New alerts about taxes, anomalies, and reviews will show up here.
                  </div>
                ) : notifications.map(n => {
                  const m = META[n.type] || { icon:"•", color:"#475467" };
                  return (
                    <div key={n.id} onClick={()=>openNotification(n)} style={{ display:"flex", gap:12, padding:"14px 18px", borderBottom:"1px solid #F3F4F6", cursor:"pointer", background:n.read?"#FFFFFF":"#F8F9FF", transition:"background .12s" }}
                      onMouseEnter={e=>e.currentTarget.style.background="#F2F4F7"} onMouseLeave={e=>e.currentTarget.style.background=n.read?"#FFFFFF":"#F8F9FF"}>
                      <div style={{ width:34, height:34, borderRadius:9, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:15, background:m.color+"18", color:m.color }}>{m.icon}</div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:13, fontWeight:600, color:"#101828", lineHeight:1.4 }}>{n.title}</div>
                        {n.description && <div style={{ fontSize:12, color:"#475467", marginTop:2, lineHeight:1.45 }}>{n.description}</div>}
                        <div style={{ fontSize:11, color:"#98A2B3", marginTop:4 }}>{ago(n.created_at)}</div>
                      </div>
                      {!n.read && <span style={{ width:8, height:8, borderRadius:"50%", background:"#4F46E5", flexShrink:0, marginTop:6 }} />}
                    </div>
                  );
                })}
              </div>
              {notifications.length>0 && (
                <div style={{ padding:"12px 18px", borderTop:"1px solid #F3F4F6", flexShrink:0 }}>
                  <button onClick={clearAllNotifs} style={{ width:"100%", padding:"9px", borderRadius:9, fontSize:13, fontWeight:600, color:"#475467", background:"#F2F4F7", border:"1px solid #E4E7EC", cursor:"pointer" }}>Clear all</button>
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
        background:"linear-gradient(135deg,#4F46E5,#6366F1)", border:"none", cursor:"pointer",
        boxShadow:"0 8px 32px rgba(109,40,217,0.5)", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:24, zIndex:1000, animation:"popbubble 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        transition:"transform 0.2s"
      }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
        {chatOpen ? "×" : "✦"}
        {hasUnread && !chatOpen && (
          <div style={{ position:"absolute", top:4, right:4, width:12, height:12, background:"#D92D20", borderRadius:"50%", border:"2px solid #F3F4F6" }} />
        )}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div style={{
          position:"fixed", bottom:100, right:28, width:440, height:560,
          background:"#FFFFFF", border:"1px solid #D0D5DD", borderRadius:20,
          boxShadow:"0 24px 80px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column",
          zIndex:999, animation:"slideup 0.25s cubic-bezier(0.34,1.56,0.64,1)", overflow:"hidden"
        }}>
          {/* Header */}
          <div style={{ padding:"18px 20px", borderBottom:"1px solid #E4E7EC", background:"linear-gradient(135deg,#EEF2FF,#FFFFFF)", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#4F46E5,#6366F1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>✦</div>
                <div>
                  <div style={{ fontSize:14, fontWeight:600 }}>Shadow CFO</div>
                  <div style={{ fontSize:11, color:"#039855" }}>● Online · Your AI Controller</div>
                </div>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                <button onClick={()=>setAiInfoOpen(true)} title="What can the assistant do?"
                  style={{ width:26, height:26, borderRadius:8, background:"#FFFFFF", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer", fontSize:13, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center" }}>?</button>
                <button onClick={()=>setChatHistoryView(v=>!v)} title="Action history"
                  style={{ fontSize:11, padding:"5px 11px", borderRadius:8, background:chatHistoryView?"#4F46E5":"#FFFFFF", border:`1px solid ${chatHistoryView?"#4F46E5":"#D0D5DD"}`, color:chatHistoryView?"#fff":"#475467", cursor:"pointer", whiteSpace:"nowrap" }}>
                  {chatHistoryView ? "← Chat" : "History"}
                </button>
              </div>
            </div>
          </div>

          {/* AI Capability Document — what the assistant can and cannot do (sandbox doc) */}
          {aiInfoOpen && (
            <div onClick={()=>setAiInfoOpen(false)} style={{ position:"absolute", inset:0, zIndex:5, background:"rgba(16,24,40,0.45)", display:"flex", alignItems:"center", justifyContent:"center", padding:18 }}>
              <div onClick={e=>e.stopPropagation()} style={{ background:"#FFFFFF", border:"1px solid #E4E7EC", borderRadius:16, width:"100%", maxHeight:"100%", overflowY:"auto", boxShadow:"0 20px 60px rgba(16,24,40,0.25)" }}>
                <div style={{ padding:"16px 18px", borderBottom:"1px solid #F3F4F6", display:"flex", justifyContent:"space-between", alignItems:"center", gap:10 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:"#101828" }}>Your AI CFO</div>
                  <button onClick={()=>setAiInfoOpen(false)} style={{ background:"none", border:"none", fontSize:20, lineHeight:1, color:"#475467", cursor:"pointer" }}>×</button>
                </div>
                <div style={{ padding:"14px 18px" }}>
                  <div style={{ fontSize:13, fontWeight:600, color:"#101828", marginBottom:12 }}>{AI_CAPABILITIES.canTitle}</div>
                  <ul style={{ margin:0, padding:0, listStyle:"none" }}>
                    {AI_CAPABILITIES.can.map((t,i)=>(
                      <li key={i} style={{ display:"flex", gap:8, fontSize:12.5, color:"#344054", lineHeight:1.5, marginBottom:9 }}>
                        <span style={{ color:"#039855", flexShrink:0 }}>✓</span><span>{t}</span>
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
              if (timeline.length===0) return <div style={{ padding:"30px 8px", textAlign:"center", color:"#475467", fontSize:12, lineHeight:1.6 }}>No actions yet. When you ask me to recode transactions, add accounts, or set rules, they'll appear here as a timeline.</div>;
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
                      {showHeader && <div style={{ fontSize:10, letterSpacing:1, color:"#475467", fontWeight:700, margin: i===0?"0 0 12px":"18px 0 12px" }}>{bucket.toUpperCase()}</div>}
                      <div style={{ display:"flex", gap:10, marginBottom:14 }}>
                        <div style={{ flexShrink:0, width:8, display:"flex", flexDirection:"column", alignItems:"center" }}>
                          <div style={{ width:8, height:8, borderRadius:"50%", background:"#4F46E5", marginTop:3 }} />
                          {i<timeline.length-1 && <div style={{ flex:1, width:2, background:"#E4E7EC", marginTop:2 }} />}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, color:"#475467", marginBottom:4 }}>{m.created_at ? new Date(m.created_at).toLocaleString("en-US",{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : ""}</div>
                          {(m.actions||[]).map((a,j)=>(
                            <div key={j} style={{ fontSize:12, color:"#101828", lineHeight:1.5, display:"flex", gap:6, marginBottom:3 }}>
                              <span style={{ color:"#4F46E5", flexShrink:0 }}>⚡</span><span>{a}</span>
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
                  <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#4F46E5,#6366F1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0, marginRight:8, marginTop:2 }}>✦</div>
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
                        background:msg.role==="user"?"linear-gradient(135deg,#4F46E5,#4338CA)":"#F3F4F6",
                        fontSize:13, lineHeight:1.6, color:msg.role==="user"?"#fff":"#101828", whiteSpace:"pre-wrap"
                      }}>{text}</div>
                    );
                  })()}
                  {msg.actions?.length>0 && (
                    <div style={{ marginTop:10, background:"#ECFDF5", border:"1px solid #03985544", borderRadius:12, padding:"12px 14px" }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#039855", letterSpacing:1, marginBottom:8 }}>✓ ACTIONS TAKEN</div>
                      {msg.actions.map((a,i)=>(
                        <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:"#039855", marginBottom: i < msg.actions.length-1 ? 6 : 0, lineHeight:1.4 }}>
                          <span style={{ color:"#039855", flexShrink:0, marginTop:1 }}>⚡</span>
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
                <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#4F46E5,#6366F1)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>✦</div>
                <div style={{ padding:"10px 14px", background:"#E4E7EC", borderRadius:"16px 16px 16px 4px" }}>
                  <div style={{ display:"flex", gap:4 }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#475467", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
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
                <button key={s} onClick={()=>{ setChatInput(s); chatInputRef.current?.focus(); }} style={{ fontSize:11, padding:"5px 10px", borderRadius:20, background:"#E4E7EC", border:"1px solid #D0D5DD", color:"#475467", cursor:"pointer", textAlign:"left" }}>{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding:"12px 16px", borderTop:"1px solid #E4E7EC", display:"flex", gap:8, flexShrink:0 }}>
            <input ref={chatInputRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&handleChatSend()}
              placeholder="Ask anything about your books..."
              style={{ flex:1, background:"#F3F4F6", border:"1px solid #D0D5DD", borderRadius:10, padding:"10px 14px", color:"#101828", fontSize:13, outline:"none", fontFamily:"'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" }} />
            <button onClick={handleChatSend} disabled={chatLoading||!chatInput.trim()} style={{
              width:40, height:40, borderRadius:10, background:(chatLoading||!chatInput.trim())?"#E4E7EC":"linear-gradient(135deg,#4F46E5,#6366F1)",
              border:"none", color:"#101828", cursor:(chatLoading||!chatInput.trim())?"not-allowed":"pointer", fontSize:16, flexShrink:0
            }}>↑</button>
          </div>
        </div>
      )}
    </div>
    </ERPContext.Provider>
  );
}

export default AppWrapper;
