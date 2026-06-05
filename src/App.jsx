import React, { useState, useMemo, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { supabase, getAuthHeaders } from "./lib/supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS } from "./lib/constants";
import { glIsRevenue, glIsExpense, glIsBalSheet, glPLType, calcASC842 } from "./lib/gl";
import { initials, vendorColor } from "./lib/format";
import { classifyIntent, runAIBrain } from "./lib/ai";
import AuthScreen from "./components/AuthScreen";
import CompanySetup from "./components/CompanySetup";
import CompanySwitcher from "./components/CompanySwitcher";
import { ERPContext } from "./components/ERPContext";
import { usePersistedView } from "./hooks/usePersistedView";
import DashboardView from "./components/views/DashboardView";
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
import CoaView from "./components/views/CoaView";
import OpeningBalancesView from "./components/views/OpeningBalancesView";
import SendInvoiceView from "./components/views/SendInvoiceView";
import PayrollView from "./components/views/PayrollView";
import RecurringView from "./components/views/RecurringView";
import ReconView from "./components/views/ReconView";
import Tax1099View from "./components/views/Tax1099View";
import DocsView from "./components/views/DocsView";
import AuditView from "./components/views/AuditView";
import OnboardView from "./components/views/OnboardView";

function AppWrapper() {
  const [session, setSession] = React.useState(undefined);
  const [companies, setCompanies] = React.useState([]);
  const [currentCompany, setCurrentCompany] = React.useState(null);
  const [showCompanySetup, setShowCompanySetup] = React.useState(false);
  const [appLoading, setAppLoading] = React.useState(true);
  // View lives here so it survives ERP remounts on auth/company changes
  const [persistedView, setPersistedView] = usePersistedView();

  useEffect(() => {
    // Single source of truth: onAuthStateChange handles everything
    // getSession just primes the initial state
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      // TOKEN_REFRESHED fires when tab regains focus — ignore completely
      if (_event === "TOKEN_REFRESHED") return;
      
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
      <div style={{minHeight:"100vh",background:"#08080A",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
        <div style={{color:"#86868F",fontSize:14}}>Loading...</div>
      </div>
    );
  }

  if (!session) return <AuthScreen onAuth={s=>setSession(s)}/>;

  if (showCompanySetup) {
    return <CompanySetup session={session} onComplete={company=>{
      setCompanies(prev=>[...prev,company]);
      setCurrentCompany(company);
      setShowCompanySetup(false);
    }}/>;
  }

  if (!currentCompany) return null;

  return (
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
  );
}

function ERP({ session, currentCompany, companies, onSwitchCompany, onNewCompany, onSignOut, supabase, persistedView, onViewChange }) {
  const [invoices, setInvoices] = useState([]);
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
  const [glDrilldown, setGlDrilldown] = useState(null); // gl_name being drilled into on the dashboard
  const [isAILoading, setIsAILoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General", invoice_number:"" });
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [notification, setNotification] = useState(null);
  const [aiStep, setAiStep] = useState(null);
  const [vendorFilter, setVendorFilter] = useState("all");

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
  const [reportRange, setReportRange] = useState("custom");
  const [reportDateFrom, setReportDateFrom] = useState(() => new Date().getFullYear() + "-01-01");
  const [reportDateTo, setReportDateTo] = useState(() => new Date().toISOString().slice(0,10));
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
  const logAudit = (action, detail, before=null, after=null) => {
    setAuditLog(prev => [{
      id: Date.now()+Math.random(), ts: new Date().toISOString(),
      action, detail, before, after, user:"owner"
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
      }).then(({ error }) => { if (error) console.error("Audit persist failed:", error.message, error.details); })
        .catch(e => console.error("Audit persist error:", e));
    }
  };

  // ── DOCUMENT STORAGE ─────────────────────────────────────────────────────────
  const [docLibrary, setDocLibrary] = useState([]);
  const storeDocument = (name, base64, mediaType, type, linkedId=null, tags=[]) => {
    const doc = { id: Date.now()+Math.random(), name, base64, mediaType, type, uploaded_at: new Date().toISOString(), linked_invoice_id: linkedId, tags };
    setDocLibrary(prev => [doc, ...prev]);
    // Persist metadata only — base64 is intentionally NOT stored (too large).
    if (!currentCompany?.id) {
      console.warn("[documents] storeDocument: no currentCompany.id — NOT persisting", { name, type });
      return doc.id;
    }
    const payload = {
      company_id: currentCompany.id,
      file_name: name,
      media_type: mediaType || null,
      document_type: type || null,
      tags: tags || [],
      linked_invoice_id: linkedId != null ? String(linkedId) : null,
      uploaded_at: doc.uploaded_at,
    };
    console.log("[documents] storeDocument → inserting:", payload);
    supabase.from("documents").insert(payload).select("id").single().then(({ data, error }) => {
      if (error) { console.error("[documents] insert FAILED:", error.message, error.details || "", error.hint || "", error); return; }
      console.log("[documents] insert OK, db id:", data?.id);
      // Swap the temp client id for the DB id so it matches on next reload.
      if (data?.id) setDocLibrary(prev => prev.map(d => d.id === doc.id ? { ...d, id: data.id } : d));
    });
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
  });

  // ── CHART OF ACCOUNTS (customizable) ─────────────────────────────────────────
  const [customCOA, setCustomCOA] = useState(DEFAULT_CHART_OF_ACCOUNTS);
  // Shadow the static const so all existing code works unchanged
  const CHART_OF_ACCOUNTS = customCOA;

  // ── DELETE CONFIRMATION ───────────────────────────────────────────────────────
  const [deleteConfirm, setDeleteConfirm] = useState(null); // { id, label, onConfirm }

  // ── OPENING BALANCES ─────────────────────────────────────────────────────────
  // { account_code, account_name, balance, as_of_date, posted }
  const [openingBalances, setOpeningBalances] = useState([]);

  // ── BANK ACCOUNTS ────────────────────────────────────────────────────────────
  // { id, name, type:"checking"|"savings"|"credit_card"|"loan", gl_code, last4, institution }
  const [bankAccounts, setBankAccounts] = useState([
    { id:"default", name:"Primary Checking", type:"checking", gl_code:"1000", last4:"", institution:"" }
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
  const [apSettings] = useState({ autoApproveThreshold: 500 });
  const [cashBalance, setCashBalance] = useState("");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState([
    { role: "assistant", content: "Hey — I'm Shadow CFO, your AI controller. Ask me anything about your finances: burn rate, P&L, cash runway, expense breakdowns, or just tell me to recode entries and set up rules. I know your full ledger. What do you want to know?", id: 0 }
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const [hasUnread, setHasUnread] = useState(false);
  const chatBottomRef = useRef(null);
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
  const [recurringNewRec, setRecurringNewRec] = useState({name:"",vendor:"",amount:"",gl_code:"5200",gl_name:"Rent & Occupancy",frequency:"monthly",next_date:new Date().toISOString().slice(0,10),project:"General"});
  const [docsPreview, setDocsPreview] = useState(null);
  const [docsFilterType, setDocsFilterType] = useState("all");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditActionFilter, setAuditActionFilter] = useState("all");

  useEffect(() => {
    if (chatOpen) { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); setHasUnread(false); }
  }, [chatHistory, chatOpen]);

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

  // ── SUPABASE DATA LOADING ──────────────────────────────────
  useEffect(() => {
    if (!currentCompany?.id) return;
    loadAllData();
  }, [currentCompany?.id]);

  const loadAllData = async () => {
    const cid = currentCompany.id;
    try {
      // Load journal entries — expand each line individually for correct balance sheet mapping
      const { data: entries } = await supabase
        .from("journal_entries")
        .select("*, journal_entry_lines(*, accounts(code,name))")
        .eq("company_id", cid)
        .eq("status", "posted")
        .order("entry_date", { ascending: false })
        .limit(500);

      if (entries) {
        const mapped = [];
        entries.forEach(e => {
          const lines = e.journal_entry_lines || [];
          const vendor = e.description?.split(" – ")[0] || e.description;
          // Find the primary P&L line for display (first debit or revenue line)
          const primaryDebit = lines.find(l => l.debit > 0);
          const primaryCredit = lines.find(l => l.credit > 0);

          if (lines.length <= 2) {
            // Simple two-line entry — map as single invoice row (backward compat)
            const debitLine = primaryDebit;
            const creditLine = primaryCredit;
            mapped.push({
              id: e.id, vendor, description: e.description,
              amount: debitLine?.debit || creditLine?.credit || 0,
              date: e.entry_date,
              type: debitLine?.accounts?.code?.startsWith("4") ? "revenue" : "expense",
              gl_code: debitLine?.accounts?.code || creditLine?.accounts?.code,
              gl_name: debitLine?.accounts?.name || creditLine?.accounts?.name,
              secondary_gl_code: creditLine?.accounts?.code,
              secondary_gl_name: creditLine?.accounts?.name,
              debit_credit: debitLine ? "debit" : "credit",
              status: "booked", booked_at: e.created_at, source: e.source,
              payment_status: e.payment_status || "unpaid",
              approval_status: e.approval_status || undefined,
              approved_at: e.approved_at || undefined,
              approved_by: e.approved_by || undefined,
              rejected_at: e.rejected_at || undefined,
              rejection_reason: e.rejection_reason || undefined,
              payment_method_used: e.payment_method || undefined,
              paid_at: e.paid_at || undefined,
              due_date: e.due_date || undefined,
              confidence: e.ai_confidence ?? 99,
              reasoning: e.ai_reasoning || "Loaded from database",
              db_entry_id: e.id
            });
          } else {
            // Multi-line entry (e.g. lease commencement, payroll) — expand each line
            lines.forEach((l, li) => {
              const isDebit = l.debit > 0;
              const amount = isDebit ? l.debit : l.credit;
              if (amount === 0) return;
              const code = l.accounts?.code;
              const acctDef = CHART_OF_ACCOUNTS.find(a => a.code === code);
              mapped.push({
                id: `${e.id}_${li}`, vendor, description: e.description,
                amount,
                date: e.entry_date,
                type: acctDef?.category === "Revenue" ? "revenue" : "expense",
                gl_code: code,
                gl_name: l.accounts?.name,
                secondary_gl_code: isDebit ? primaryCredit?.accounts?.code : primaryDebit?.accounts?.code,
                secondary_gl_name: isDebit ? primaryCredit?.accounts?.name : primaryDebit?.accounts?.name,
                debit_credit: isDebit ? "debit" : "credit",
                status: "booked", booked_at: e.created_at, source: e.source,
                payment_status: "unpaid",
                confidence: e.ai_confidence ?? 99,
                reasoning: e.ai_reasoning || "Loaded from database",
                db_entry_id: e.id,
                balance_sheet_account: ["Assets","Liabilities","Equity"].includes(acctDef?.category),
              });
            });
          }
        });
        setInvoices(mapped);
      }

      // Load contacts
      const { data: contactsData } = await supabase
        .from("contacts").select("*").eq("company_id", cid).eq("active", true).order("name");
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
          defaultAPAccount: co.default_ap_account||"2000",
          defaultARAccount: co.default_ar_account||"1100",
          currency: co.currency||"USD", logoBase64: null
        });
      }

      // Load chart of accounts
      const { data: accts } = await supabase
        .from("accounts").select("*").eq("company_id", cid).order("code");
      if (accts) {
        setCustomCOA(accts.map(a => ({ code: a.code, name: a.name, category: a.category, active: a.active, is_system: a.is_system, db_id: a.id })));
      }

      // Load bank accounts
      const { data: banks } = await supabase
        .from("bank_accounts").select("*, accounts(code)").eq("company_id", cid).eq("active", true);
      if (banks) {
        setBankAccounts(banks.map(b => ({ id: b.id, name: b.name, type: b.type, gl_code: b.accounts?.code, institution: b.institution||"", last4: b.last4||"" })));
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
          detail: a.detail, before: a.before_state, after: a.after_state, user: "owner"
        })));
      }

      // Load documents (metadata only — base64 file content is not stored)
      const { data: docsData, error: docsErr } = await supabase
        .from("documents").select("*").eq("company_id", cid)
        .order("uploaded_at", { ascending: false });
      if (docsErr) console.error("[documents] loadAllData fetch error:", docsErr.message, docsErr.details || "", docsErr.hint || "");
      console.log(`[documents] loadAllData fetched ${docsData?.length ?? 0} document(s) for company ${cid}`, docsData);
      if (docsData) {
        setDocLibrary(docsData.map(d => ({
          id: d.id,
          name: d.file_name,
          mediaType: d.media_type,
          type: d.document_type,
          tags: d.tags || [],
          linked_invoice_id: d.linked_invoice_id,
          uploaded_at: d.uploaded_at,
          ai_explanation: d.ai_explanation,
          entry_needed: d.entry_needed,
          entry_summary: d.entry_summary,
          posted: d.posted,
        })));
      }

      // Load contracts
      await loadContractsFromDB();

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
      const secondaryAcct  = await ensureAccount(invoice.secondary_gl_code || "2000", invoice.secondary_gl_name || "Accounts Payable");
      if (!primaryAcct) { console.error("persistJournalEntry: no primary account", invoice.gl_code); return null; }

      const baseEntry = {
        company_id: currentCompany.id,
        entry_date: invoice.date || new Date().toISOString().slice(0,10),
        description: `${invoice.vendor || ""} – ${invoice.description || invoice.vendor || ""}`,
        source: invoice.source || "manual",
        status: "posted",
        posted_at: new Date().toISOString(),
        created_by: session.user.id
      };
      // Persist the AI's coding rationale + confidence so they survive a reload.
      // Requires the ai_reasoning / ai_confidence columns (see migration in repo).
      const aiFields = {
        ai_reasoning: invoice.reasoning || null,
        ai_confidence: invoice.confidence ?? null,
        approval_status: invoice.approval_status || null,
        payment_status: invoice.payment_status || null,
        payment_method: invoice.payment_method_used || invoice.payment_method || null,
        due_date: invoice.due_date || null,
      };
      let { data: je, error: jeErr } = await supabase.from("journal_entries")
        .insert({ ...baseEntry, ...aiFields }).select().single();
      if (jeErr && /ai_reasoning|ai_confidence|column/i.test(jeErr.message || "")) {
        // Columns not migrated yet — fall back so booking still works.
        console.warn("journal_entries is missing ai_reasoning/ai_confidence; booking without them. Run the migration to persist AI reasoning.");
        ({ data: je, error: jeErr } = await supabase.from("journal_entries")
          .insert(baseEntry).select().single());
      }
      if (jeErr) { console.error("JE insert error:", jeErr); return; }

      const lines = [];
      if (secondaryAcct) {
        // Respect the debit_credit flag
        if (isDebit) {
          lines.push({ journal_entry_id: je.id, company_id: currentCompany.id, account_id: primaryAcct.id,   debit: invoice.amount, credit: 0,              memo: invoice.description });
          lines.push({ journal_entry_id: je.id, company_id: currentCompany.id, account_id: secondaryAcct.id, debit: 0,              credit: invoice.amount, memo: invoice.description });
        } else {
          lines.push({ journal_entry_id: je.id, company_id: currentCompany.id, account_id: primaryAcct.id,   debit: 0,              credit: invoice.amount, memo: invoice.description });
          lines.push({ journal_entry_id: je.id, company_id: currentCompany.id, account_id: secondaryAcct.id, debit: invoice.amount, credit: 0,              memo: invoice.description });
        }
      } else {
        lines.push({ journal_entry_id: je.id, company_id: currentCompany.id, account_id: primaryAcct.id, debit: isDebit ? invoice.amount : 0, credit: isDebit ? 0 : invoice.amount, memo: invoice.description });
      }
      await supabase.from("journal_entry_lines").insert(lines);
      return je.id; // callers use this to store db_entry_id on the invoice
    } catch(e) { console.error("persistJournalEntry error:", e); return null; }
  };

  // Persist a journal entry and write the returned Supabase ID back into invoices state
  // so that deleteJournalEntry can find and mark it deleted later.
  const bookToDb = (invoice) => {
    persistJournalEntry(invoice).then(jeId => {
      if (jeId) {
        setInvoices(prev => prev.map(i => i.id === invoice.id ? { ...i, db_entry_id: jeId } : i));
      }
    });
  };

  // Remove a journal entry from Supabase so it never reloads.
  // Hard-deletes the rows (lines first, then header) to avoid any status-enum constraints.
  // The immutable record lives in the audit_log table, not here.
  const deleteJournalEntry = async (invoice) => {
    if (!currentCompany?.id) return;

    const hardDelete = async (jeId) => {
      // Delete lines first to avoid FK constraint violations on servers without CASCADE
      await supabase.from("journal_entry_lines")
        .delete()
        .eq("journal_entry_id", jeId);
      const { error } = await supabase.from("journal_entries")
        .delete()
        .eq("id", jeId)
        .eq("company_id", currentCompany.id);
      if (error) console.error("deleteJournalEntry hard-delete failed:", jeId, error.message);
    };

    try {
      if (invoice?.db_entry_id) {
        await hardDelete(invoice.db_entry_id);
      } else if (invoice?.vendor && invoice?.date) {
        // Fallback for entries booked in current session before db_entry_id was written back.
        // Look up by company + date + vendor prefix.
        const prefix = (invoice.vendor || "").split(" ")[0];
        const { data: matches } = await supabase.from("journal_entries")
          .select("id")
          .eq("company_id", currentCompany.id)
          .eq("entry_date", invoice.date)
          .eq("status", "posted")
          .ilike("description", `${prefix}%`);
        if (matches?.length) {
          for (const m of matches) await hardDelete(m.id);
        }
      }
    } catch(e) { console.error("deleteJournalEntry error:", e); }
  };

  const persistContact = async (contact) => {
    if (!currentCompany?.id) return;
    try {
      const payload = {
        company_id: currentCompany.id, name: contact.name,
        type: contact.type||"vendor", email: contact.email||null,
        phone: contact.phone||null, payment_terms: contact.payment_terms||null,
        is_1099: contact.is1099||false, ein: contact.ein||null,
        expected_min: contact.min_expected||null, expected_max: contact.max_expected||null,
        notes: contact.notes||null, tags: contact.tags||[]
      };
      if (contact.db_id) {
        await supabase.from("contacts").update(payload).eq("id", contact.db_id);
      } else {
        const { data } = await supabase.from("contacts").insert(payload).select().single();
        if (data) setContacts(prev => prev.map(c => c.id===contact.id ? {...c, db_id: data.id} : c));
      }
    } catch(e) { console.error("persistContact error:", e); }
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
          console.log("Contract saved, db_id=", data.id);
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
              const ibr = c.discount_rate_used || 0.05;
              const asc842 = calcASC842(c.payment_amount, term, ibr);
              console.log(`Recalculated ${c.counterparty}: ROU=$${asc842.rouAsset}, Current=$${asc842.currentPortion}, LT=$${asc842.nonCurrentPortion}`);
              c.rou_asset_value = asc842.rouAsset;
              c.lease_liability_current = asc842.currentPortion;
              c.lease_liability_noncurrent = asc842.nonCurrentPortion;
              c.lease_term_months = term;
              // Also patch Day 1 entry if it has wrong values
              if (c.journal_entries?.[0]) {
                c.journal_entries[0].lines = [
                  { account_code:"1800", account_name:"Right-of-Use Asset (ASC 842)", debit: asc842.rouAsset, credit: 0 },
                  { account_code:"2400", account_name:"Lease Liability - Current (ASC 842)", debit: 0, credit: asc842.currentPortion },
                  { account_code:"2450", account_name:"Lease Liability - Non-Current (ASC 842)", debit: 0, credit: asc842.nonCurrentPortion },
                ];
              }
            }
          }
          return c;
        });
        setContracts(loaded);
        console.log(`Loaded ${loaded.length} contracts from DB`);
      } else {
        setContracts([]);
      }
    } catch(e) { console.error("loadContractsFromDB error:", e); }
  };

  const showNotification = (msg, type="success") => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 3500);
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
      const extractRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `Extract invoice fields. "vendor" = exact legal name of the company issuing the invoice. Respond ONLY with valid JSON: {"vendor":"...","description":"...","amount":"123.45","date":"YYYY-MM-DD","type":"expense or revenue","invoice_number":"INV-001 or empty string if none","notes":"line items, tax, and other details"}`,
          messages: [{ role:"user", content:[
            { type: mediaType==="application/pdf"?"document":"image", source:{ type:"base64", media_type:mediaType, data:base64 }},
            { type:"text", text:"Extract all invoice fields. Capture exact vendor name." }
          ]}]
        })
      });
      const extractData = await extractRes.json();
      const extracted = JSON.parse((extractData.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());

      // Check if a rule exists for this vendor
      const rule = rules.find(r => r.vendor?.toLowerCase() === extracted.vendor?.toLowerCase());
      if (rule) {
        extracted.project = rule.project || "General";
        setAiSuggestion({ gl_code: rule.gl_code, gl_name: rule.gl_name, secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable", confidence: 99, reasoning: `Applied your vendor rule: ${extracted.vendor} → ${rule.gl_name}${rule.project ? ` (Project: ${rule.project})` : ""}` });
        setForm(extracted);
        setIsAILoading(false); setAiStep(null);
        showNotification(`Vendor rule applied: ${rule.gl_name} ✓`);
        return;
      }

      setForm(extracted);
      setAiStep("coding");
      const codeRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `Expert accountant. Suggest GL coding for this transaction. Respond ONLY with valid JSON: {"gl_code":"XXXX","gl_name":"Name","confidence":95,"reasoning":"brief","debit_credit":"debit or credit","secondary_gl_code":"XXXX","secondary_gl_name":"Name"}

CRITICAL RULES:
- For EXPENSES: gl_code must be 5xxx or 6xxx (income statement expense accounts). secondary_gl_code = 2000 (Accounts Payable) or 1000 (Cash).
- For REVENUE: gl_code must be 4xxx (income statement revenue accounts). secondary_gl_code = 1100 (Accounts Receivable) or 1000 (Cash).
- NEVER use 1xxx/2xxx/3xxx (balance sheet accounts) as the PRIMARY gl_code on an expense or revenue transaction. Those are only ever the offset/secondary account.`,
          messages: [{ role:"user", content:`Vendor: ${extracted.vendor}\nDescription: ${extracted.description}\nAmount: $${extracted.amount}\nType: ${extracted.type}\n\nChart of Accounts:\n${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}\n\nSuggest best GL coding.` }]
        })
      });
      const codeData = await codeRes.json();
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
      setView("dashboard");
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
          confirmBg: "#1A3A1A", confirmBorder: "1px solid #10B98144", confirmColor: "#6EE7B7",
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
    const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
      method:"POST", headers:getAuthHeaders(),
      body: JSON.stringify({
        model:"claude-sonnet-4-20250514", max_tokens:20,
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
    const d = await res.json();
    const t = (d.content?.find(b=>b.type==="text")?.text||"").trim().toLowerCase();
    if (t.includes("bank")) return "bank_statement";
    if (t.includes("contract")) return "contract";
    if (t.includes("unknown")) return "unknown";
    return "invoice";
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
      return { id, name: f.name, status: "pending", type: null, result: null, error: null };
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

        if (docType === "invoice") {
          // Extract ALL invoices in the document (handles single and multi-invoice PDFs)
          const extractRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:4000,
              system:`You are an expert at reading invoice documents. This document may contain ONE invoice or MULTIPLE invoices/receipts on separate pages or sections.

Extract EVERY invoice you find. Respond ONLY with a valid JSON array — even if there is only one invoice:
[
  {"vendor":"Exact vendor name","description":"what was purchased","amount":"123.45","date":"YYYY-MM-DD","type":"expense or revenue","invoice_number":"INV-001 or empty string if none","notes":"line items, tax, and other details"},
  ...one object per invoice...
]

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
          const extractData = await extractRes.json();
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
            return;
          }

          // Batch GL code all invoices in one call
          const codeRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:3000,
              system:`Expert accountant. Assign GL codes to each invoice. Return a JSON array with one coding object per invoice, in the same order as input.
Each object: {"gl_code":"XXXX","gl_name":"Name","confidence":95,"reasoning":"brief","secondary_gl_code":"XXXX","secondary_gl_name":"Name"}

CRITICAL RULES:
- Expenses (type=expense): gl_code must be 5xxx or 6xxx. secondary_gl_code = 2000 (Accounts Payable).
- Revenue (type=revenue): gl_code must be 4xxx. secondary_gl_code = 1100 (Accounts Receivable).  
- NEVER use balance sheet accounts (1xxx/2xxx/3xxx) as primary gl_code.

Chart of Accounts (income statement only):
${CHART_OF_ACCOUNTS.filter(a=>a.category==="Revenue"||a.category==="Expenses").map(a=>`${a.code} - ${a.name}`).join("\n")}`,
              messages:[{role:"user", content:`Code these ${extractedList.length} invoices:\n${JSON.stringify(extractedList.map((inv,i)=>({index:i, vendor:inv.vendor, description:inv.description, amount:inv.amount, type:inv.type})))}`}]
            })
          });
          const codeData = await codeRes.json();
          let codings = [];
          try {
            const codeRaw = (codeData.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim();
            const parsed = JSON.parse(codeRaw);
            codings = Array.isArray(parsed) ? parsed : [parsed];
          } catch(e) { codings = []; }

          // Split invoices by confidence — high confidence books immediately, low confidence asks user
          const highConfidence = [];
          const needsClarification = [];

          extractedList.forEach((extracted, idx) => {
            const coding = codings[idx] || {};
            const rule = rules.find(r => r.vendor?.toLowerCase()===extracted.vendor?.toLowerCase());
            const isRevenue = extracted.type === "revenue";
            const confidence = rule ? 99 : (coding.confidence || 75);
            const finalCode = rule ? rule.gl_code : (coding.gl_code || (isRevenue ? "4000" : "5900"));
            const finalName = rule ? rule.gl_name : (coding.gl_name || (isRevenue ? "Sales Revenue" : "Miscellaneous Expense"));

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
              secondary_gl_code: rule ? "2000" : (coding.secondary_gl_code || (isRevenue ? "1100" : "2000")),
              secondary_gl_name: rule ? "Accounts Payable" : (coding.secondary_gl_name || (isRevenue ? "Accounts Receivable" : "Accounts Payable")),
              debit_credit: isRevenue ? "credit" : "debit",
              confidence,
              reasoning: rule ? `Vendor rule: ${finalName}` : (coding.reasoning || "Auto-coded"),
              status: "booked",
              booked_at: new Date().toISOString(),
              source: "universal_upload",
            };

            // Duplicate invoice number check — runs before any other routing
            const dupExisting = invoice.invoice_number
              ? invoices.find(ex =>
                  ex.invoice_number &&
                  ex.invoice_number.toLowerCase() === invoice.invoice_number.toLowerCase() &&
                  ex.vendor?.toLowerCase() === invoice.vendor?.toLowerCase()
                )
              : null;

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
                .filter(a => ["5000","5800","5900"].includes(a.code));
              needsClarification.push({
                id: Date.now() + Math.random(),
                invoice,
                queueItemId: item.id,
                question: `This looks like revenue — confirm: did your business issue this invoice TO a customer? Or is it a bill you received?`,
                options: [
                  ...revenueAccts.map(a => ({ code: a.code, name: a.name })),
                  ...expenseAccts.map(a => ({
                    code: a.code, name: a.name,
                    typeOverride: { type: "expense", secondary_gl_code: "2000", secondary_gl_name: "Accounts Payable" }
                  })),
                ],
                suggestedCode: finalCode,
                suggestedName: finalName,
              });
            } else if (confidence >= 85 || rule) {
              highConfidence.push(invoice);
            } else {
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

          // Book high-confidence invoices immediately — log each one individually
          if (highConfidence.length > 0) {
            setInvoices(prev => [...highConfidence, ...prev]);
            highConfidence.forEach(inv => {
              logAudit("invoice_booked", `${inv.vendor} · $${(inv.amount||0).toFixed(2)} → ${inv.gl_name} (${inv.confidence}% confidence · ${inv.date})`, null, { vendor: inv.vendor, amount: inv.amount, date: inv.date, gl_code: inv.gl_code, gl_name: inv.gl_name });
              bookToDb(inv);
            });
            runAPScreen(highConfidence, [...highConfidence, ...invoices]);
            checkWatchTriggers(highConfidence, unknownDocs);
          }

          // Queue low-confidence invoices for clarification
          if (needsClarification.length > 0) {
            setClarificationQueue(prev => [...prev, ...needsClarification]);
          }

          const newInvoices = [...highConfidence];
          const totalAmt = newInvoices.reduce((s,i)=>s+i.amount, 0);
          storeDocument(item.name, base64, mediaType, "invoice", newInvoices[0]?.id||null, ["uploaded"]);
          logAudit("invoice_uploaded", `Uploaded ${item.name}: ${extractedList.length} invoice(s) extracted`);
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result:{
            invoiceCount: highConfidence.length,
            needsClarification: needsClarification.length,
            vendor: highConfidence.length===1 ? highConfidence[0].vendor : needsClarification.length>0 ? `${highConfidence.length} booked, ${needsClarification.length} need input` : `${highConfidence.length} invoices`,
            amount: totalAmt,
            gl_name: needsClarification.length>0 ? `${needsClarification.length} need your review below` : highConfidence.length===1 ? highConfidence[0].gl_name : "all coded",
            confidence: highConfidence.length > 0 ? Math.round(highConfidence.reduce((s,i)=>s+i.confidence,0)/highConfidence.length) : null,
          }} : q));

        } else if (docType === "bank_statement") {
          // Parse bank statement
          let rawTxns = [];
          if (isSpreadsheet) {
            const text = await new Promise(res => { const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsText(file); });
            const parseRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
              method:"POST", headers:getAuthHeaders(),
              body: JSON.stringify({
                model:"claude-sonnet-4-20250514", max_tokens:4000,
                system:`Parse this bank statement CSV/text and extract ALL transactions. Respond ONLY with JSON array: [{"date":"YYYY-MM-DD","description":"...","amount":123.45,"type":"debit or credit"}]`,
                messages:[{role:"user", content:`Parse:\n\n${text.slice(0,8000)}`}]
              })
            });
            const pd = await parseRes.json();
            rawTxns = JSON.parse((pd.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          } else {
            const parseRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
              method:"POST", headers:getAuthHeaders(),
              body: JSON.stringify({
                model:"claude-sonnet-4-20250514", max_tokens:4000,
                system:`Extract ALL transactions from this bank statement PDF. Respond ONLY with JSON array: [{"date":"YYYY-MM-DD","description":"...","amount":123.45,"type":"debit or credit"}]`,
                messages:[{role:"user",content:[{type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},{type:"text",text:"Extract all transactions."}]}]
              })
            });
            const pd = await parseRes.json();
            rawTxns = JSON.parse((pd.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          }

          // Categorize transactions
          const catRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:6000,
              system:`Categorize each bank transaction with GL coding. Respond ONLY with JSON array: [{"id":0,"date":"YYYY-MM-DD","vendor":"Clean Name","description":"original","amount":123.45,"type":"expense or revenue","gl_code":"XXXX","gl_name":"Name","confidence":85,"needs_review":false}]

CRITICAL RULES:
- type "expense" → gl_code must be 5xxx or 6xxx (never 1xxx/2xxx/3xxx)
- type "revenue" → gl_code must be 4xxx (never 1xxx/2xxx/3xxx)
- Balance sheet accounts (1xxx assets, 2xxx liabilities, 3xxx equity) are NEVER the primary GL code for a transaction
- Set needs_review:true when confidence<75
Chart of Accounts:\n${CHART_OF_ACCOUNTS.filter(a=>a.category==="Revenue"||a.category==="Expenses").map(a=>`${a.code} - ${a.name}`).join("\n")}`,
              messages:[{role:"user", content:`Categorize ${rawTxns.length} transactions:\n${JSON.stringify(rawTxns.slice(0,80))}`}]
            })
          });
          const catData = await catRes.json();
          const categorized = JSON.parse((catData.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
          const withRules = categorized.map((t,i) => {
            const rule = rules.find(r => r.vendor?.toLowerCase()===t.vendor?.toLowerCase());
            return rule ? {...t, gl_code:rule.gl_code, gl_name:rule.gl_name, confidence:99, needs_review:false, rule_applied:true} : {...t, id:Date.now()+i};
          });
          // Auto-book confident ones, queue uncertain
          const confident = withRules.filter(t=>!t.needs_review);
          const uncertain = withRules.filter(t=>t.needs_review);
          const newInvoices = confident.map((t,i)=>({
            id:Date.now()+Math.random(), vendor:t.vendor, description:t.description, amount:Math.abs(t.amount),
            date:t.date, type:t.type, project:"General", gl_code:t.gl_code, gl_name:t.gl_name,
            secondary_gl_code:"1000", secondary_gl_name:"Cash & Cash Equivalents",
            debit_credit:"debit", confidence:t.confidence, reasoning:"Imported via universal upload",
            status:"booked", booked_at:new Date().toISOString(), source:"universal_upload", payment_status:"unmatched",
          }));
          setInvoices(prev => [...newInvoices, ...prev]);
          newInvoices.forEach(inv => bookToDb(inv));
          if (uncertain.length > 0) {
            setBankTransactions(prev => [...uncertain.map((t,i)=>({...t, id:Date.now()+Math.random(), checked:false})), ...prev]);
          }
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result:{
            txnCount: withRules.length, autoBooked: confident.length, needsReview: uncertain.length
          }} : q));

        } else if (docType === "contract") {
          // Full contract analysis — two calls to avoid token limits
          // Call 1: Extract terms + Day 1 entry
          const res1 = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:3000,
              system:`You are a Big 4 CPA (ASC 842 specialist). Extract contract terms and generate ONLY the Day 1 journal entry.
For OPERATING LEASE: Day 1: Dr ROU Asset 1800 [PV of payments at IBR] / Cr Lease Liability Current 2400 [next 12mo principal] + Cr Lease Liability LT 2450 [remainder]. NO depreciation entries.
Respond ONLY with JSON: {"contract_type":"lease|loan|revenue_contract|subscription_paid|subscription_received|equipment_financing|service_agreement","counterparty":"...","description":"...","total_value":0,"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","payment_amount":0,"payment_frequency":"monthly","interest_rate":0,"lease_type":"operating|finance|not_applicable","rou_asset_value":0,"lease_liability_current":0,"lease_liability_noncurrent":0,"discount_rate_used":0.05,"lease_term_months":0,"monthly_straight_line_expense":0,"accounting_treatment":"...","key_terms":[],"journal_entries":[{"date":"YYYY-MM-DD","description":"Lease commencement","memo":"ASC 842-20-30","lines":[{"account_code":"1800","account_name":"Right-of-Use Asset","debit":0,"credit":0}]}]}`,
              messages:[{role:"user",content:[
                {type:mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64}},
                {type:"text",text:"Extract contract terms and generate Day 1 entry only."}
              ]}]
            })
          });
          const d1 = await res1.json();
          const contract = JSON.parse((d1.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());

          // Generate all monthly entries in JS (no second API call needed)
          const monthlyEntries = [];
          let calcLeaseTermMonths = contract.lease_term_months || 0;
          if (!calcLeaseTermMonths && contract.start_date && contract.end_date) {
            calcLeaseTermMonths = Math.round((new Date(contract.end_date) - new Date(contract.start_date)) / (1000 * 60 * 60 * 24 * 30.44));
          }
          if (contract.contract_type === "lease" && calcLeaseTermMonths > 0) {
            const ibr = contract.discount_rate_used || 0.05;
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
                lines:[{account_code:"6150",account_name:"Operating Lease Expense",debit:parseFloat(sl.toFixed(2)),credit:0},{account_code:"1000",account_name:"Cash",debit:0,credit:parseFloat(pmt.toFixed(2))}]});
              if (principal > 0.01) monthlyEntries.push({ date:ds, description:`Lease liability reduction — Month ${i+1}`, memo:`ASC 842-20: Principal $${principal.toFixed(2)}`,
                lines:[{account_code:"2400",account_name:"Lease Liability - Current (ASC 842)",debit:parseFloat(principal.toFixed(2)),credit:0},{account_code:"1800",account_name:"Right-of-Use Asset",debit:0,credit:parseFloat(principal.toFixed(2))}]});
            }
            contract.lease_term_months = calcLeaseTermMonths;
          }

          contract.journal_entries = [...(contract.journal_entries||[]), ...monthlyEntries];
          const saved = { ...contract, id:Date.now()+Math.random(), file_name:item.name, uploaded_at:new Date().toISOString(), posted_entries:[] };
          setContracts(prev => [saved, ...prev]);
          persistContract(saved);
          storeDocument(item.name, base64, mediaType, "contract", saved.id, ["contract"]);
          logAudit("contract_uploaded", `Contract uploaded: ${item.name}`);
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result:{
            counterparty:contract.counterparty, type:contract.contract_type, entries:contract.journal_entries?.length||0
          }} : q));

        } else if (docType === "unknown") {
          // Ask Claude to explain AND propose a journal entry (or explicitly say none needed)
          const explainRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:1500,
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
          const explainData = await explainRes.json();
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
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", type:"unknown", result:{ document_type: unknownRecord.document_type, entry_needed: unknownRecord.entry_needed, watching: unknownRecord.watch_for?.length > 0 }} : q));
        }

    } catch(e) {
      console.error("Upload error:", item.name, e);
      const errMsg = e?.message || String(e) || "Processing failed";
      setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"error", error:`${errMsg} — try again`} : q));
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
        const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
          method:"POST", headers:getAuthHeaders(),
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:4000,
            system:`You are an expert at reading bank statements. Extract ALL transactions from this bank statement. Respond ONLY with valid JSON array, no markdown:
[{"date":"YYYY-MM-DD","description":"raw bank description","amount":123.45,"type":"debit or credit","balance":1000.00}]
Extract every single transaction row. Use negative amounts for debits/expenses if shown that way in the statement.`,
            messages:[{role:"user",content:[
              {type:"document",source:{type:"base64",media_type:"application/pdf",data:base64}},
              {type:"text",text:"Extract all transactions from this bank statement as JSON."}
            ]}]
          })
        });
        const d = await res.json();
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
        const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
          method:"POST", headers:getAuthHeaders(),
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:4000,
            system:`You are an expert at parsing bank statement exports. Parse this CSV/Excel text and extract ALL transactions. Respond ONLY with valid JSON array, no markdown:
[{"date":"YYYY-MM-DD","description":"raw bank description","amount":123.45,"type":"debit or credit","balance":1000.00}]
Handle any column format — the file might have columns in different orders. Parse every transaction row.`,
            messages:[{role:"user",content:`Parse this bank statement file and extract all transactions:\n\n${fileContent.slice(0,8000)}`}]
          })
        });
        const d = await res.json();
        fileContent = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"[]").replace(/```json|```/g,"").trim());
      }

      const rawTxns = Array.isArray(fileContent) ? fileContent : [];
      setBankProgress(60);

      // Now batch-categorize all transactions with GL coding + vendor extraction
      if (rawTxns.length === 0) { showNotification("No transactions found in file.", "error"); setBankProcessing(false); return; }

      setBankStep("categorizing"); setBankProgress(70);
      const categorizeRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:6000,
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

      const catData = await categorizeRes.json();
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
      secondary_gl_code: "1000",
      secondary_gl_name: "Cash & Cash Equivalents",
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
    loan: { label:"Loan / Debt", color:"#EF4444", icon:"🏦" },
    revenue_contract: { label:"Revenue Contract", color:"#10B981", icon:"📈" },
    lease: { label:"Lease", color:"#F59E0B", icon:"🏢" },
    subscription_paid: { label:"Subscription (Paid)", color:"#8B7BFF", icon:"💳" },
    subscription_received: { label:"Subscription (Received)", color:"#8B7BFF", icon:"📦" },
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
      const res1 = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:3000,
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

      const data1 = await res1.json();
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
      console.log(`Contract: type=${contract.contract_type}, lease_type=${contract.lease_type}, term=${leaseTermMonths}mo, payment=$${contract.payment_amount}`);

      // ── GENERATE MONTHLY ENTRIES IN JS (no second API call needed) ────────
      const monthlyEntries = [];

      if (contract.contract_type === "lease") {
        const ibr = contract.discount_rate_used || 0.05;
        const monthlyPayment = parseFloat(contract.payment_amount) || 0;
        // Ensure we have term months — calculate from dates if missing
        if (!leaseTermMonths && contract.start_date && contract.end_date) {
          leaseTermMonths = Math.round((new Date(contract.end_date) - new Date(contract.start_date)) / (1000*60*60*24*30.44));
          contract.lease_term_months = leaseTermMonths;
        }
        console.log(`Lease: payment=$${monthlyPayment}, term=${leaseTermMonths}mo, ibr=${(ibr*100).toFixed(2)}%`);

        // ALWAYS compute with JS — never use AI arithmetic
        const asc842 = (leaseTermMonths > 0 && monthlyPayment > 0)
          ? calcASC842(monthlyPayment, leaseTermMonths, ibr)
          : null;

        if (asc842) {
          console.log(`ASC842 result: Liability=$${asc842.leaseLiability}, Current=$${asc842.currentPortion}, LT=$${asc842.nonCurrentPortion}, ROU=$${asc842.rouAsset}`);
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
              { account_code:"1800", account_name:"Right-of-Use Asset (ASC 842)", debit: asc842.rouAsset, credit: 0 },
              { account_code:"2400", account_name:"Lease Liability - Current (ASC 842)", debit: 0, credit: asc842.currentPortion },
              { account_code:"2450", account_name:"Lease Liability - Non-Current (ASC 842)", debit: 0, credit: asc842.nonCurrentPortion },
            ];
            contract.journal_entries[0].memo = `ASC 842-20-30: PV of ${leaseTermMonths} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR (monthly compounding). Current = principal reduction months 1-12 ($${asc842.currentPortion.toLocaleString()}), NOT gross cash.`;
          } else {
            contract.journal_entries = [{
              date: contract.start_date || new Date().toISOString().slice(0,10),
              description: "Lease commencement — ASC 842 initial recognition",
              memo: `ASC 842-20-30: PV of ${leaseTermMonths} × $${monthlyPayment} @ ${(ibr*100).toFixed(2)}% IBR`,
              lines: [
                { account_code:"1800", account_name:"Right-of-Use Asset (ASC 842)", debit: asc842.rouAsset, credit: 0 },
                { account_code:"2400", account_name:"Lease Liability - Current (ASC 842)", debit: 0, credit: asc842.currentPortion },
                { account_code:"2450", account_name:"Lease Liability - Non-Current (ASC 842)", debit: 0, credit: asc842.nonCurrentPortion },
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
                { account_code:"6150", account_name:"Operating Lease Expense", debit: parseFloat(monthlyPayment.toFixed(2)), credit: 0 },
                { account_code:"1000", account_name:"Cash", debit: 0, credit: parseFloat(monthlyPayment.toFixed(2)) },
              ]
            });
            // Entry B: Balance sheet — non-cash liability reduction and ROU amortization
            if (principal > 0.01) {
              monthlyEntries.push({
                date: dateStr,
                description: `Lease liability & ROU amortization — Month ${i + 1}`,
                memo: `ASC 842-20: Non-cash. Principal reduction of liability = $${principal.toFixed(2)}. ROU asset decreases by same amount.`,
                lines: [
                  { account_code:"2400", account_name:"Lease Liability - Current (ASC 842)", debit: principal, credit: 0 },
                  { account_code:"1800", account_name:"Right-of-Use Asset (ASC 842)", debit: 0, credit: principal },
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
                { account_code:"6100", account_name:"Interest Expense", debit: interest, credit: 0 },
                { account_code:"2400", account_name:"Lease Liability - Current (ASC 842)", debit: principal, credit: 0 },
                { account_code:"1000", account_name:"Cash", debit: 0, credit: parseFloat(monthlyPayment.toFixed(2)) },
              ]
            });
            monthlyEntries.push({
              date: dateStr,
              description: `ROU asset amortization — Month ${i + 1}`,
              memo: `ASC 842-20: Finance lease — straight-line amortization of ROU asset`,
              lines: [
                { account_code:"6050", account_name:"ROU Asset Amortization", debit: rouAmort, credit: 0 },
                { account_code:"1810", account_name:"Accumulated Amortization - ROU", debit: 0, credit: rouAmort },
              ]
            });
          }
        });
        if (asc842) console.log(`Generated ${monthlyEntries.length} entries. Liability=$${asc842.leaseLiability}, Current=$${asc842.currentPortion}, LT=$${asc842.nonCurrentPortion}`);

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
              lines: [{ account_code:"5900", account_name:"Technology & Software", debit:parseFloat(contract.payment_amount), credit:0 }, { account_code:"1300", account_name:"Prepaid Expenses", debit:0, credit:parseFloat(contract.payment_amount) }]});
          } else if (contract.contract_type === "revenue_contract") {
            monthlyEntries.push({ date: dateStr, description: `Revenue recognition — Month ${i+1}`, memo: "ASC 606: Performance obligation satisfied",
              lines: [{ account_code:"2300", account_name:"Deferred Revenue", debit:parseFloat(contract.payment_amount), credit:0 }, { account_code:"4100", account_name:"Service Revenue", debit:0, credit:parseFloat(contract.payment_amount) }]});
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
        secondary_gl_code: offsetLine?.account_code || "2000",
        secondary_gl_name: offsetLine?.account_name || "Accounts Payable",
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
          secondary_gl_code: offsetLine?.account_code || "2000",
          secondary_gl_name: offsetLine?.account_name || "Accounts Payable",
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
    (inv.source === "contract" || inv.gl_code === "2000" || inv.gl_code === "2100") // Accounts Payable / Accrued
  );

  const getOpenAR = (invList) => invList.filter(inv =>
    inv.type === "revenue" &&
    !inv.matched &&
    inv.gl_code === "1100" // Accounts Receivable
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
      const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 4000,
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

      const data = await res.json();
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
  const AP_PRIORITY = { critical:"#EF4444", high:"#F59E0B", normal:"#10B981", low:"#86868F" };

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
      const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:3000,
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

      const data = await res.json();
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

  const markPaid = (invIds, method = "ach") => {
    const ids = Array.isArray(invIds) ? invIds : [invIds];
    const who = session?.user?.email || "owner";
    const at = new Date().toISOString();
    const paid = invoices.filter(i => ids.includes(i.id));
    setInvoices(prev => prev.map(inv => !ids.includes(inv.id) ? inv : {
      ...inv, payment_status: "paid", payment_method_used: method, paid_at: at, matched: true,
    }));
    paid.forEach(inv => {
      logAudit("invoice_paid", `${who} paid ${inv.vendor} · $${(inv.amount||0).toFixed(2)} via ${String(method).toUpperCase()}`, { payment_status: inv.payment_status }, { payment_status: "paid", method, by: who });
      persistApStatus(inv.db_entry_id, { payment_status: "paid", payment_method: method, paid_at: at });
    });
    setSelectedPayments(new Set());
    setCheckRunMode(false);
    showNotification(`${ids.length} payment${ids.length!==1?"s":""} recorded as ${String(method).toUpperCase()} ✓`);
  };

  // ── CHAT HANDLER ────────────────────────────────────────────────────────────
  const handleChatSend = async () => {
    const msg = chatInput.trim();
    if (!msg || chatLoading) return;
    setChatInput("");
    const userMsg = { role: "user", content: msg, id: Date.now() };
    setChatHistory(h => [...h, userMsg]);
    setChatLoading(true);

    try {
      const historyForAI = chatHistory.filter(m => m.id !== 0).map(m => ({ role: m.role, content: m.content }));
      const result = await runAIBrain({ userMessage: msg, invoices, rules, projects: customProjects, chatHistory: historyForAI, contacts, chartOfAccounts: CHART_OF_ACCOUNTS });

      // Execute actions
      let actionSummary = [];
      const newRules = [...rules];

      for (const action of (result.actions || [])) {
        if (action.type === "navigate" && action.view) {
          // Map the AI's view name to an internal view id (with common aliases)
          const viewAliases = {
            audittrail:"audit", "audit-trail":"audit", "audit trail":"audit",
            pl:"reports", "p&l":"reports", "profit-loss":"reports", report:"reports",
            documents:"docs", document:"docs", "document-library":"docs",
            ledger:"invoices", transactions:"invoices", invoice:"invoices",
            "money-in":"ar", receivables:"ar", "money-out":"ap", payables:"ap",
            "1099":"tax1099", taxes:"tax1099", bank:"bank", "bank-feed":"bank",
            home:"dashboard",
          };
          const target = viewAliases[String(action.view).toLowerCase().trim()] || action.view;
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
            setCustomCOA(prev => {
              if (prev.find(a => a.code === action.code)) return prev;
              return [...prev, { code: action.code, name: action.name, category: action.category }].sort((a,b) => a.code.localeCompare(b.code));
            });
            actionSummary.push(`Added account: ${action.code} ${action.name} (${action.category})`);
          }
        }
        if (action.type === "delete_invoice") {
          // Delete by ID or by vendor+amount match — always log before removing
          if (action.invoice_id) {
            const target = invoices.find(i => String(i.id) === String(action.invoice_id));
            if (target) {
              logAudit("invoice_deleted", `Deleted: ${target.vendor} $${target.amount} on ${target.date} (${target.gl_name})`, target, null);
              deleteJournalEntry(target);
              setInvoices(prev => prev.filter(i => String(i.id) !== String(action.invoice_id)));
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
              toDelete.forEach(d => { logAudit("invoice_deleted", `Deleted: ${d.vendor} $${d.amount} on ${d.date} (${d.gl_name})`, d, null); deleteJournalEntry(d); });
              setInvoices(prev => prev.filter(i => !toDelete.find(d => d.id === i.id)));
              actionSummary.push(`Deleted ${toDelete.length} entr${toDelete.length===1?"y":"ies"} for ${action.vendor}`);
            } else {
              actionSummary.push(`No matching entries found for ${action.vendor}`);
            }
          }
        }
        if (action.type === "void_invoice") {
          // Void = mark as voided but keep for audit trail
          if (action.invoice_id) {
            setInvoices(prev => prev.map(i => String(i.id) === String(action.invoice_id) ? {...i, status:"voided", voided_at:new Date().toISOString(), voided_reason: action.reason||"Voided via AI"} : i));
            actionSummary.push(`Voided entry: ${action.invoice_id}`);
          } else if (action.vendor) {
            setInvoices(prev => prev.map(i =>
              i.vendor?.toLowerCase().includes(action.vendor.toLowerCase())
              ? {...i, status:"voided", voided_at:new Date().toISOString(), voided_reason: action.reason||"Voided via AI"}
              : i
            ));
            actionSummary.push(`Voided entries for ${action.vendor}`);
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
          if (action.contract_id || action.counterparty) {
            const toDelete = contracts.filter(c =>
              action.contract_id ? String(c.id) === String(action.contract_id)
              : c.counterparty?.toLowerCase().includes(action.counterparty?.toLowerCase())
            );
            setContracts(prev => prev.filter(c => !toDelete.find(d => d.id === c.id)));
            toDelete.forEach(async c => {
              if (c.db_id) await supabase.from("contracts").delete().eq("id", c.db_id);
            });
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
      }
      setRules(newRules);

      const assistantMsg = {
        role: "assistant",
        content: result.reply || "Done!",
        actions: actionSummary,
        id: Date.now() + 1
      };
      setChatHistory(h => [...h, assistantMsg]);
      if (!chatOpen) setHasUnread(true);
    } catch(e) {
      console.error("Chat error:", e);
      setChatHistory(h => [...h, { role:"assistant", content:"Sorry, I ran into an error. Please try again.", id: Date.now()+1 }]);
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

  const inputStyle = { width:"100%", background:"#0C0C0E", border:"1px solid #262629", borderRadius:8, padding:"10px 12px", color:"#F2F2F4", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"'DM Sans', sans-serif" };
  const labelStyle = { display:"block", fontSize:11, color:"#86868F", marginBottom:6, letterSpacing:1 };


  const erpCtx = { AP_PRIORITY, CHART_OF_ACCOUNTS, CONTRACT_TYPES, activeRecon, aiStep, aiSuggestion, allProjects, allVendorNames, apAgingLoading, apAgingNarration, apSettings, apView, applyMatch, applyRule, approveInvoice, arAgingLoading, arAgingNarration, arView, auditActionFilter, auditLog, auditSearch, bankAccounts, bankDragOver, bankFileName, bankProcessing, bankProgress, bankStep, bankTransactions, basisMode, basisNarration, basisNarrationLoading, bookBankTransactions, bookToDb, cashBalance, chatBottomRef, chatHistory, chatInput, chatInputRef, chatLoading, chatOpen, checkRunMode, checkWatchTriggers, clarificationQueue, classifyFile, coaAddDraft, coaEditDraft, coaEditingCode, coaShowAdd, companies, companySettings, contacts, contractDragOver, contractProcessing, contractView, contracts, currentCompany, customCOA, customProjects, customersEditDraft, customersEditingId, deleteConfirm, deleteJournalEntry, dismissMatch, docLibrary, docsFilterType, docsPreview, dragOver, fileStoreRef, fileToBase64, filteredInvoices, form, getOpenAP, getOpenAR, getUnpaidInvoices, getUnpaidReceivables, glBreakdown, glDrilldown, setGlDrilldown, handleBankFile, handleBookInvoice, handleChatSend, handleContractFile, handleFileSelect, handleFormChange, handleUniversalUpload, hasUnread, inputStyle, invoices, isAILoading, labelStyle, loadAllData, loadContractsFromDB, logAudit, mainContentRef, markPaid, matchHistory, matchProcessing, matchQueue, netIncome, notification, onNewCompany, onSignOut, onSwitchCompany, onViewChange, openingBalAsOfDate, openingBalBalances, openingBalances, payrollDragOver, payrollImports, payrollProcessing, persistContact, persistContract, persistJournalEntry, persistRecode, persistedView, postAllContractEntries, postContractEntry, processUploadItem, qboData, qboDragOver, qboMapping, qboPreview, qboProcessing, qboStep, reconAccount, reconSessions, reconStatementBalance, recurring, recurringNewRec, rejectInvoice, requestInfo, reportDateFrom, reportDateTo, reportRange, reportType, rules, runAPEngine, runAPScreen, runFullAI, runMatchingEngine, selectedContract, selectedInvoice, selectedPayments, sendInvoiceDraftState, sendInvoiceShowPreview, sentInvoiceDraft, sentInvoices, session, setActiveRecon, setAiStep, setAiSuggestion, setApAgingLoading, setApAgingNarration, setApView, setArAgingLoading, setArAgingNarration, setArView, setAuditActionFilter, setAuditLog, setAuditSearch, setBankAccounts, setBankDragOver, setBankFileName, setBankProcessing, setBankProgress, setBankStep, setBankTransactions, setBasisMode, setBasisNarration, setBasisNarrationLoading, setCashBalance, setChatHistory, setChatInput, setChatLoading, setChatOpen, setCheckRunMode, setClarificationQueue, setCoaAddDraft, setCoaEditDraft, setCoaEditingCode, setCoaShowAdd, setCompanySettings, setContacts, setContractDragOver, setContractProcessing, setContractView, setContracts, setCustomCOA, setCustomProjects, setCustomersEditDraft, setCustomersEditingId, setDeleteConfirm, setDocLibrary, setDocsFilterType, setDocsPreview, setDragOver, setForm, setHasUnread, setInvoices, setIsAILoading, setMatchHistory, setMatchProcessing, setMatchQueue, setNotification, setOpeningBalAsOfDate, setOpeningBalBalances, setOpeningBalances, setPayrollDragOver, setPayrollImports, setPayrollProcessing, setQboData, setQboDragOver, setQboMapping, setQboPreview, setQboProcessing, setQboStep, setReconAccount, setReconSessions, setReconStatementBalance, setRecurring, setRecurringNewRec, setReportDateFrom, setReportDateTo, setReportRange, setReportType, setRules, setSelectedContract, setSelectedInvoice, setSelectedPayments, setSendInvoiceDraftState, setSendInvoiceShowPreview, setSentInvoiceDraft, setSentInvoices, setSettingsDraft, setSettingsLogoPreview, setSettingsSaved, setUniversalDragOver, setUnknownDocs, setUploadProcessing, setUploadQueue, setUploadedFile, setVendorFilter, setVendorsEditDraft, setVendorsEditingId, setVendorsSelectedContact, setView, setViewRaw, settingsDraft, settingsLogoPreview, settingsSaved, showNotification, storeDocument, supabase, totalExpenses, totalRevenue, universalDragOver, unknownDocs, uploadActiveRef, uploadProcessing, uploadQueue, uploadedFile, vendorFilter, vendorSummary, vendorsEditDraft, vendorsEditingId, vendorsSelectedContact, view };

  return (
    <ERPContext.Provider value={erpCtx}>
    <div style={{ fontFamily:"'DM Sans', sans-serif", minHeight:"100vh", background:"#0C0C0E", color:"#F2F2F4" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Montserrat:wght@700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideup{from{opacity:0;transform:translateY(20px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes popbubble{from{transform:scale(0.7)}to{transform:scale(1)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0C0C0E} ::-webkit-scrollbar-thumb{background:#262629;border-radius:2px}
      `}</style>

      {notification && (
        <div style={{ position:"fixed", top:20, right:20, zIndex:9999, background:notification.type==="error"?"#2A0A0A":"#0A2A1A", border:`1px solid ${notification.type==="error"?"#EF4444":"#10B981"}`, color:notification.type==="error"?"#FCA5A5":"#6EE7B7", padding:"12px 20px", borderRadius:10, fontSize:14, animation:"fadein 0.2s ease", boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}>
          {notification.msg}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteConfirm && (
        <div style={{ position:"fixed", inset:0, zIndex:10000, background:"rgba(0,0,0,0.7)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#141416", border:"1px solid #EF444433", borderRadius:16, padding:28, maxWidth:400, width:"90%", boxShadow:"0 24px 80px rgba(0,0,0,0.8)" }}>
            <div style={{ fontSize:16, fontWeight:600, marginBottom:10 }}>{deleteConfirm.title || "Confirm Delete"}</div>
            <div style={{ fontSize:13, color:"#9A9AA2", marginBottom:20, lineHeight:1.6 }}>{deleteConfirm.label}</div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={()=>setDeleteConfirm(null)} style={{ padding:"8px 20px", borderRadius:8, background:"transparent", border:"1px solid #262629", color:"#9A9AA2", fontSize:13, cursor:"pointer" }}>Cancel</button>
              <button onClick={()=>{ deleteConfirm.onConfirm(); setDeleteConfirm(null); }} style={{ padding:"8px 20px", borderRadius:8, background: deleteConfirm.confirmBg||"#7F1D1D", border: deleteConfirm.confirmBorder||"1px solid #EF4444", color: deleteConfirm.confirmColor||"#FCA5A5", fontSize:13, cursor:"pointer", fontWeight:600 }}>{deleteConfirm.confirmLabel || "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Persistent upload status — visible from any tab */}
      {uploadQueue.some(q => q.status==="pending"||q.status==="classifying"||q.status==="processing") && (
        <div style={{ position:"fixed", bottom:100, left:"50%", transform:"translateX(-50%)", zIndex:999, background:"#141416", border:"1px solid #33333A", borderRadius:12, padding:"12px 20px", display:"flex", alignItems:"center", gap:12, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", minWidth:280 }}>
          <div style={{ display:"flex", gap:3 }}>
            {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#C7BFFF", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
          </div>
          <div>
            <div style={{ fontSize:13, color:"#F2F2F4", fontWeight:500 }}>
              Processing {uploadQueue.filter(q=>q.status==="pending"||q.status==="classifying"||q.status==="processing").length} file{uploadQueue.filter(q=>q.status==="pending"||q.status==="classifying"||q.status==="processing").length>1?"s":""}...
            </div>
            <div style={{ fontSize:11, color:"#86868F", marginTop:2 }}>
              {uploadQueue.find(q=>q.status==="processing"||q.status==="classifying")?.name || ""}
            </div>
          </div>
          <button onClick={()=>setView("dashboard")} style={{ marginLeft:"auto", background:"none", border:"1px solid #33333A", borderRadius:6, padding:"4px 10px", color:"#C7BFFF", fontSize:11, cursor:"pointer", flexShrink:0 }}>View</button>
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* Top Bar */}
        <div style={{ background:"#141416", borderBottom:"1px solid #1C1C20", flexShrink:0 }}>
          {/* Brand + Company + User row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 28px", height:54, borderBottom:"1px solid #1C1C20" }}>
            <div style={{ display:"flex", alignItems:"center", gap:24 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <svg width={26} height={26} viewBox="0 0 48 48" fill="none" aria-hidden style={{ flexShrink:0 }}>
                  <defs>
                    <linearGradient id="scTopMark" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#A99CFF" />
                      <stop offset="100%" stopColor="#6D5EF6" />
                    </linearGradient>
                  </defs>
                  <circle cx="24" cy="24" r="13" fill="url(#scTopMark)" />
                  <circle cx="30.5" cy="20.5" r="11" fill="#141416" />
                </svg>
                <span className="sc-wordmark" style={{ fontSize:16, letterSpacing:3, fontWeight:700, fontFamily:"'Space Grotesk','Montserrat','DM Sans',sans-serif" }}>SHADOW CFO</span>
              </div>
              <CompanySwitcher companies={companies} currentCompany={currentCompany} onSwitch={onSwitchCompany} onNew={onNewCompany} />
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button className="sc-cta" onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#6D5EF6,#4A3DB8)", border:"none", color:"#fff", borderRadius:8, padding:"7px 16px", fontSize:12, cursor:"pointer", fontWeight:500, letterSpacing:0.5, boxShadow:"0 4px 14px rgba(109,94,246,.28)" }}>✦ Ask Shadow CFO</button>
              <span style={{ fontSize:11, color:"#55555C" }}>{session?.user?.email}</span>
              <button onClick={onSignOut} style={{ padding:"6px 14px", borderRadius:8, background:"transparent", border:"1px solid #262629", color:"#86868F", fontSize:12, cursor:"pointer" }}>Sign out</button>
            </div>
          </div>
          {/* Nav — 6 core tabs, stretch full width */}
          <div style={{ display:"flex", width:"100%", borderBottom:"1px solid #161619" }}>
            {[
              { id:"dashboard", label:"Dashboard", sub:[] },
              { id:"ledger", label:"Ledger", sub:["invoices","bank","matching","recon","docs"] },
              { id:"money-in", label:"Money In", sub:["ar","send-invoice","customers"] },
              { id:"money-out", label:"Money Out", sub:["ap","payroll","vendors","rules","contracts","recurring"] },
              { id:"reports", label:"Reports", sub:["tax1099","audit"] },
              { id:"settings", label:"Settings", sub:["coa","opening-balances","onboard","settings"] },
            ].map(tab => {
              const isActive = view === tab.id || tab.sub.includes(view);
              return (
                <button key={tab.id}
                  onClick={()=>{ setView(tab.id); setVendorFilter("all"); }}
                  onMouseEnter={e=>{ if(!isActive){ e.currentTarget.style.background="#161619"; e.currentTarget.style.color="#A99CFF"; }}}
                  onMouseLeave={e=>{ if(!isActive){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#86868F"; }}}
                  style={{
                    flex:1, height:44, display:"flex", alignItems:"center", justifyContent:"center", gap:6, position:"relative",
                    background: isActive?"#1C1C20":"transparent",
                    border:"none",
                    borderBottom: isActive?"3px solid #8B7BFF":"3px solid transparent",
                    color: isActive?"#C7BFFF":"#86868F",
                    fontSize:13, fontWeight: isActive?600:400,
                    cursor:"pointer", transition:"all 0.12s", letterSpacing:0.3,
                  }}>
                  {tab.label}
                  {tab.id==="dashboard" && clarificationQueue.length>0 && (
                    <span style={{ background:"#F59E0B", color:"#000", fontSize:10, fontWeight:700, borderRadius:20, padding:"1px 6px", lineHeight:1.4 }}>{clarificationQueue.length}</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Sub-nav — shown when a main tab has sub-views */}
          {["ledger","money-in","money-out","reports","settings"].includes(view) || ["invoices","bank","matching","recon","docs","ar","send-invoice","customers","ap","payroll","vendors","rules","contracts","recurring","tax1099","audit","coa","opening-balances","onboard"].includes(view) ? (
            <div style={{ display:"flex", background:"#0C0C0E", borderBottom:"1px solid #161619", padding:"0 16px", gap:4 }}>
              {(view==="ledger"||["invoices","bank","matching","recon","docs"].includes(view)) && [
                { id:"invoices", label:"All Transactions" },
                { id:"bank", label:"Bank Feed", badge: bankTransactions.filter(t=>t.needs_review).length||null },
                { id:"recon", label:"Reconciliation" },
                { id:"matching", label:"Matching", badge: matchQueue.length||null },
                { id:"docs", label:"Documents", badge: docLibrary.length||null },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C7BFFF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#86868F"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B7BFF":"2px solid transparent", color:view===s.id?"#C7BFFF":"#86868F", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"color 0.12s" }}>
                  {s.label}{s.badge>0&&<span style={{background:"#6D5EF6",borderRadius:20,padding:"1px 5px",fontSize:9,color:"#fff"}}>{s.badge}</span>}
                </button>
              ))}
              {(view==="money-in"||["ar","send-invoice","customers"].includes(view)) && [
                { id:"ar", label:"Receivables", badge: invoices.filter(i=>glIsRevenue(i.gl_code)&&i.payment_status!=="collected").length||null },
                { id:"send-invoice", label:"Send Invoice" },
                { id:"customers", label:"Customers", badge: contacts.filter(c=>c.type==="customer").length||null },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C7BFFF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#86868F"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B7BFF":"2px solid transparent", color:view===s.id?"#C7BFFF":"#86868F", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"color 0.12s" }}>
                  {s.label}{s.badge>0&&<span style={{background:"#6D5EF6",borderRadius:20,padding:"1px 5px",fontSize:9,color:"#fff"}}>{s.badge}</span>}
                </button>
              ))}
              {(view==="money-out"||["ap","payroll","vendors","rules","contracts","recurring"].includes(view)) && [
                { id:"ap", label:"Payables", badge: invoices.filter(i=>glIsExpense(i.gl_code)&&i.payment_status!=="paid"&&i.approval_status==="pending_approval").length||null },
                { id:"vendors", label:"Vendors", badge: contacts.filter(c=>c.type==="vendor").length||null },
                { id:"contracts", label:"Contracts", badge: contracts.length||null },
                { id:"recurring", label:"Recurring", badge: recurring.filter(r=>r.active).length||null },
                { id:"payroll", label:"Payroll" },
                { id:"rules", label:"GL Rules", badge: rules.length||null },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C7BFFF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#86868F"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B7BFF":"2px solid transparent", color:view===s.id?"#C7BFFF":"#86868F", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"color 0.12s" }}>
                  {s.label}{s.badge>0&&<span style={{background:"#6D5EF6",borderRadius:20,padding:"1px 5px",fontSize:9,color:"#fff"}}>{s.badge}</span>}
                </button>
              ))}
              {(view==="reports"||["tax1099","audit"].includes(view)) && [
                { id:"reports", label:"Reports" },
                { id:"tax1099", label:"1099s" },
                { id:"audit", label:"Audit Trail" },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C7BFFF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#86868F"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B7BFF":"2px solid transparent", color:view===s.id?"#C7BFFF":"#86868F", fontSize:12, cursor:"pointer", transition:"color 0.12s" }}>
                  {s.label}
                </button>
              ))}
              {(view==="settings"||["coa","opening-balances","onboard"].includes(view)) && [
                { id:"settings", label:"Company" },
                { id:"coa", label:"Chart of Accounts" },
                { id:"opening-balances", label:"Opening Balances" },
                { id:"onboard", label:"Import QBO" },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C7BFFF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#86868F"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B7BFF":"2px solid transparent", color:view===s.id?"#C7BFFF":"#86868F", fontSize:12, cursor:"pointer", transition:"color 0.12s" }}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Main Content */}
        <div ref={mainContentRef} id="main-content" style={{ flex:1, overflowY:"auto" }}>
          {/* Review banner — visible from any non-dashboard view when items need input */}
          {clarificationQueue.length > 0 && view !== "dashboard" && (
            <div style={{ background:"#1A1200", borderBottom:"1px solid #F59E0B44", padding:"10px 32px", display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div style={{ fontSize:13, color:"#F59E0B" }}>⚠ {clarificationQueue.length} invoice{clarificationQueue.length!==1?"s":""} need{clarificationQueue.length===1?"s":""} review before booking</div>
              <button onClick={()=>setView("dashboard")} style={{ background:"#F59E0B22", border:"1px solid #F59E0B44", color:"#F59E0B", borderRadius:8, padding:"5px 12px", fontSize:12, cursor:"pointer" }}>Review →</button>
            </div>
          )}
          <div key={view} className="sc-rise" style={{ padding:"32px 40px" }}>

          {/* Top-level tab redirects */}
          {view==="ledger" && (() => { setView("invoices"); return null; })()}
          {view==="money-in" && (() => { setView("ar"); return null; })()}
          {view==="money-out" && (() => { setView("ap"); return null; })()}

          {/* DASHBOARD */}
          {view==="dashboard" && <DashboardView />}

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

          {/* ── DOCUMENT LIBRARY ─────────────────────────────────────────────── */}
          {view==="docs" && <DocsView />}

          {/* ── AUDIT TRAIL ──────────────────────────────────────────────────── */}
          {view==="audit" && <AuditView />}

          {/* ── QBO ONBOARDING ────────────────────────────────────────────────── */}
          {view==="onboard" && <OnboardView />}
          </div>
        </div>
      </div>

      {/* ── FLOATING AI CHAT ───────────────────────────────────────────────── */}
      {/* Bubble button */}
      <button onClick={()=>{ setChatOpen(o=>!o); setHasUnread(false); }} style={{
        position:"fixed", bottom:28, right:28, width:58, height:58, borderRadius:"50%",
        background:"linear-gradient(135deg,#6D5EF6,#9486FF)", border:"none", cursor:"pointer",
        boxShadow:"0 8px 32px rgba(109,40,217,0.5)", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:24, zIndex:1000, animation:"popbubble 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        transition:"transform 0.2s"
      }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
        {chatOpen ? "×" : "✦"}
        {hasUnread && !chatOpen && (
          <div style={{ position:"absolute", top:4, right:4, width:12, height:12, background:"#EF4444", borderRadius:"50%", border:"2px solid #0C0C0E" }} />
        )}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div style={{
          position:"fixed", bottom:100, right:28, width:440, height:560,
          background:"#141416", border:"1px solid #262629", borderRadius:20,
          boxShadow:"0 24px 80px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column",
          zIndex:999, animation:"slideup 0.25s cubic-bezier(0.34,1.56,0.64,1)", overflow:"hidden"
        }}>
          {/* Header */}
          <div style={{ padding:"18px 20px", borderBottom:"1px solid #1C1C20", background:"linear-gradient(135deg,#16121F,#141416)", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#6D5EF6,#9486FF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>✦</div>
              <div>
                <div style={{ fontSize:14, fontWeight:600 }}>Shadow CFO</div>
                <div style={{ fontSize:11, color:"#10B981" }}>● Online · Your AI Controller</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px" }}>
            {chatHistory.map((msg, idx)=>(
              <div key={msg.id||idx} style={{ marginBottom:14, display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start" }}>
                {msg.role==="assistant" && (
                  <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#6D5EF6,#9486FF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0, marginRight:8, marginTop:2 }}>✦</div>
                )}
                <div style={{ maxWidth:"80%" }}>
                  <div style={{
                    padding:"10px 14px", borderRadius:msg.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",
                    background:msg.role==="user"?"linear-gradient(135deg,#6D5EF6,#4A3DB8)":"#1C1C20",
                    fontSize:13, lineHeight:1.6, color:"#F2F2F4", whiteSpace:"pre-wrap"
                  }}>{msg.content}</div>
                  {msg.actions?.length>0 && (
                    <div style={{ marginTop:10, background:"#0C1F14", border:"1px solid #10B98144", borderRadius:12, padding:"12px 14px" }}>
                      <div style={{ fontSize:10, fontWeight:700, color:"#10B981", letterSpacing:1, marginBottom:8 }}>✓ ACTIONS TAKEN</div>
                      {msg.actions.map((a,i)=>(
                        <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:8, fontSize:12, color:"#6EE7B7", marginBottom: i < msg.actions.length-1 ? 6 : 0, lineHeight:1.4 }}>
                          <span style={{ color:"#10B981", flexShrink:0, marginTop:1 }}>⚡</span>
                          <span>{a}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {msg.role==="assistant" && msg.content.toLowerCase().includes("profit") || msg.role==="assistant" && msg.content.toLowerCase().includes("expense") || msg.role==="assistant" && msg.content.toLowerCase().includes("revenue") ? (
                    <button onClick={()=>{ setChatOpen(false); setView("reports"); }} style={{ marginTop:6, background:"none", border:"1px solid #262629", borderRadius:8, padding:"4px 12px", color:"#C7BFFF", fontSize:11, cursor:"pointer" }}>
                      Open Reports page →
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#6D5EF6,#9486FF)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>✦</div>
                <div style={{ padding:"10px 14px", background:"#1C1C20", borderRadius:"16px 16px 16px 4px" }}>
                  <div style={{ display:"flex", gap:4 }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#86868F", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Suggestions */}
          {chatHistory.length < 3 && (
            <div style={{ padding:"0 16px 8px", display:"flex", flexWrap:"wrap", gap:6 }}>
              {["What's our burn rate?","Show me this month's P&L","Recode all Stripe entries to Payment Processing","Are there any unusual expenses?"].map(s=>(
                <button key={s} onClick={()=>{ setChatInput(s); chatInputRef.current?.focus(); }} style={{ fontSize:11, padding:"5px 10px", borderRadius:20, background:"#1C1C20", border:"1px solid #262629", color:"#9A9AA2", cursor:"pointer", textAlign:"left" }}>{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding:"12px 16px", borderTop:"1px solid #1C1C20", display:"flex", gap:8, flexShrink:0 }}>
            <input ref={chatInputRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&handleChatSend()}
              placeholder="Ask anything about your books..."
              style={{ flex:1, background:"#0C0C0E", border:"1px solid #262629", borderRadius:10, padding:"10px 14px", color:"#F2F2F4", fontSize:13, outline:"none", fontFamily:"'DM Sans', sans-serif" }} />
            <button onClick={handleChatSend} disabled={chatLoading||!chatInput.trim()} style={{
              width:40, height:40, borderRadius:10, background:(chatLoading||!chatInput.trim())?"#1C1C20":"linear-gradient(135deg,#6D5EF6,#9486FF)",
              border:"none", color:"#F2F2F4", cursor:(chatLoading||!chatInput.trim())?"not-allowed":"pointer", fontSize:16, flexShrink:0
            }}>↑</button>
          </div>
        </div>
      )}
    </div>
    </ERPContext.Provider>
  );
}

export default AppWrapper;
