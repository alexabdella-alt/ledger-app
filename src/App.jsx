import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ── SUPABASE CLIENT ───────────────────────────────────────────
const SUPABASE_URL = "https://hhhuvoycumjzcjbawwff.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhoaHV2b3ljdW1qemNqYmF3d2ZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxMTM0MDQsImV4cCI6MjA4ODY4OTQwNH0.y5zZcLmdhO-o3D30tnfrU6DzmSeg-Tq_IuC628zT0kQ";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Module-level auth token — updated whenever session changes
let _authToken = "";
supabase.auth.onAuthStateChange((_event, session) => {
  _authToken = session?.access_token || "";
});
supabase.auth.getSession().then(({ data: { session } }) => {
  _authToken = session?.access_token || "";
});

function getAuthHeaders() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${_authToken}`
  };
}

// ── AUTH SCREEN ───────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = React.useState("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [message, setMessage] = React.useState(null);

  const handle = async () => {
    setLoading(true); setError(null); setMessage(null);
    try {
      if (mode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.session);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email, password,
          options: { data: { full_name: name } }
        });
        if (error) throw error;
        if (data.session) onAuth(data.session);
        else setMessage("Check your email to confirm your account, then log in.");
      }
    } catch(e) { setError(e.message); }
    setLoading(false);
  };

  const s = {
    wrap: { minHeight:"100vh", background:"#0A0A0F", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" },
    card: { background:"#14141A", border:"1px solid #2A2A3E", borderRadius:20, padding:40, width:400, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" },
    logo: { display:"flex", alignItems:"center", gap:12, marginBottom:32 },
    logoIcon: { width:44, height:44, borderRadius:12, background:"linear-gradient(135deg,#6D28D9,#9333EA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 },
    h1: { fontSize:24, fontWeight:700, color:"#E8E8F0", margin:0, letterSpacing:-0.5 },
    sub: { fontSize:13, color:"#6B6B8A", marginTop:4 },
    label: { fontSize:11, color:"#6B6B8A", marginBottom:4, letterSpacing:0.5 },
    input: { width:"100%", boxSizing:"border-box", background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:10, padding:"11px 14px", color:"#E8E8F0", fontSize:14, outline:"none", marginBottom:12 },
    btn: { width:"100%", padding:"12px", borderRadius:10, fontSize:14, fontWeight:600, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:"pointer", marginTop:8 },
    toggle: { textAlign:"center", marginTop:20, fontSize:13, color:"#6B6B8A" },
    toggleLink: { color:"#C8B8FF", cursor:"pointer", fontWeight:500 },
    error: { background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#EF4444", marginBottom:12 },
    success: { background:"#0A2A1A", border:"1px solid #10B98133", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#10B981", marginBottom:12 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>✦</div>
          <div>
            <div style={s.h1}>Ledger</div>
            <div style={s.sub}>AI-powered accounting</div>
          </div>
        </div>
        {error && <div style={s.error}>{error}</div>}
        {message && <div style={s.success}>{message}</div>}
        {mode === "signup" && (
          <div>
            <div style={s.label}>FULL NAME</div>
            <input style={s.input} value={name} onChange={e=>setName(e.target.value)} placeholder="Jane Smith"/>
          </div>
        )}
        <div style={s.label}>EMAIL</div>
        <input style={s.input} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" onKeyDown={e=>e.key==="Enter"&&handle()}/>
        <div style={s.label}>PASSWORD</div>
        <input style={s.input} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handle()}/>
        <button style={s.btn} onClick={handle} disabled={loading}>
          {loading ? "..." : mode === "login" ? "Sign In" : "Create Account"}
        </button>
        <div style={s.toggle}>
          {mode === "login" ? <>No account? <span style={s.toggleLink} onClick={()=>{setMode("signup");setError(null);}}>Sign up free</span></> : <>Have an account? <span style={s.toggleLink} onClick={()=>{setMode("login");setError(null);}}>Sign in</span></>}
        </div>
      </div>
    </div>
  );
}

// ── COMPANY SETUP SCREEN ──────────────────────────────────────
function CompanySetup({ session, onComplete }) {
  const [name, setName] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const create = async () => {
    if (!name.trim()) return;
    setLoading(true); setError(null);
    try {
      // Create company
      const { data: company, error: ce } = await supabase
        .from("companies").insert({ name: name.trim() }).select().single();
      if (ce) throw ce;
      // Seed chart of accounts
      await supabase.rpc("seed_company_accounts", { p_company_id: company.id });
      // Make user owner
      const { error: me } = await supabase.from("company_users").insert({
        company_id: company.id, user_id: session.user.id,
        role: "owner", accepted_at: new Date().toISOString()
      });
      if (me) throw me;
      // Create default bank account
      const { data: cashAcct } = await supabase.from("accounts")
        .select("id").eq("company_id", company.id).eq("code", "1000").single();
      if (cashAcct) {
        await supabase.from("bank_accounts").insert({
          company_id: company.id, name: "Primary Checking",
          type: "checking", gl_account_id: cashAcct.id
        });
      }
      // Stub subscription
      await supabase.from("subscriptions").insert({
        company_id: company.id, plan: "trial", status: "trialing",
        trial_ends_at: new Date(Date.now() + 14*24*60*60*1000).toISOString()
      });
      onComplete(company);
    } catch(e) { setError(e.message); setLoading(false); }
  };

  const s = {
    wrap: { minHeight:"100vh", background:"#0A0A0F", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Sans',system-ui,sans-serif" },
    card: { background:"#14141A", border:"1px solid #2A2A3E", borderRadius:20, padding:40, width:440, boxShadow:"0 24px 80px rgba(0,0,0,0.7)" },
    h1: { fontSize:24, fontWeight:700, color:"#E8E8F0", margin:"0 0 8px", letterSpacing:-0.5 },
    sub: { fontSize:13, color:"#6B6B8A", marginBottom:28 },
    label: { fontSize:11, color:"#6B6B8A", marginBottom:4, letterSpacing:0.5 },
    input: { width:"100%", boxSizing:"border-box", background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:10, padding:"12px 14px", color:"#E8E8F0", fontSize:15, outline:"none", marginBottom:20 },
    btn: { width:"100%", padding:"13px", borderRadius:10, fontSize:14, fontWeight:600, background:name.trim()?"linear-gradient(135deg,#6D28D9,#4C1D95)":"#1E1E2E", border:"none", color:"#E8E8F0", cursor:name.trim()?"pointer":"not-allowed" },
    error: { background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:8, padding:"10px 14px", fontSize:13, color:"#EF4444", marginBottom:12 },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.h1}>Create your company</div>
        <div style={s.sub}>You can add more companies later and switch between them.</div>
        {error && <div style={s.error}>{error}</div>}
        <div style={s.label}>COMPANY NAME</div>
        <input style={s.input} value={name} onChange={e=>setName(e.target.value)}
          placeholder="Acme Corp" autoFocus onKeyDown={e=>e.key==="Enter"&&create()}/>
        <button style={s.btn} onClick={create} disabled={loading||!name.trim()}>
          {loading ? "Setting up..." : "Create Company →"}
        </button>
      </div>
    </div>
  );
}

// ── COMPANY SWITCHER ──────────────────────────────────────────
function CompanySwitcher({ companies, currentCompany, onSwitch, onNew, userName }) {
  const [open, setOpen] = React.useState(false);
  const s = {
    wrap: { position:"relative" },
    btn: { display:"flex", alignItems:"center", gap:8, padding:"6px 12px", borderRadius:10, background:"#1E1E2E", border:"1px solid #2A2A3E", cursor:"pointer", color:"#E8E8F0", fontSize:13, fontWeight:500 },
    dot: { width:8, height:8, borderRadius:"50%", background:"#10B981", flexShrink:0 },
    dropdown: { position:"absolute", top:"calc(100% + 8px)", left:0, background:"#14141A", border:"1px solid #2A2A3E", borderRadius:12, minWidth:240, boxShadow:"0 16px 48px rgba(0,0,0,0.6)", zIndex:100, overflow:"hidden" },
    header: { padding:"12px 16px", borderBottom:"1px solid #1E1E2E", fontSize:11, color:"#6B6B8A", letterSpacing:1 },
    item: { padding:"11px 16px", cursor:"pointer", display:"flex", alignItems:"center", gap:10, fontSize:13 },
    check: { width:16, height:16, borderRadius:4, background:"#10B981", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", flexShrink:0 },
    empty: { width:16, height:16, borderRadius:4, border:"1px solid #2A2A3E", flexShrink:0 },
    addBtn: { padding:"11px 16px", cursor:"pointer", fontSize:13, color:"#C8B8FF", borderTop:"1px solid #1E1E2E", display:"flex", alignItems:"center", gap:8 },
  };
  return (
    <div style={s.wrap}>
      <div style={s.btn} onClick={()=>setOpen(o=>!o)}>
        <div style={s.dot}/>
        <span>{currentCompany?.name || "Select company"}</span>
        <span style={{color:"#6B6B8A",fontSize:10}}>▾</span>
      </div>
      {open && (
        <div style={s.dropdown}>
          <div style={s.header}>YOUR COMPANIES</div>
          {companies.map(c=>(
            <div key={c.id} style={{...s.item, background:c.id===currentCompany?.id?"#1A1A2E":"transparent"}}
              onClick={()=>{onSwitch(c);setOpen(false);}}>
              {c.id===currentCompany?.id ? <div style={s.check}>✓</div> : <div style={s.empty}/>}
              <span style={{fontWeight:c.id===currentCompany?.id?600:400}}>{c.name}</span>
            </div>
          ))}
          <div style={s.addBtn} onClick={()=>{onNew();setOpen(false);}}>
            <span>+</span> Add new company
          </div>
        </div>
      )}
    </div>
  );
}

// ── APP WRAPPER — handles auth state ─────────────────────────
function AppWrapper() {
  const [session, setSession] = React.useState(undefined); // undefined = loading
  const [companies, setCompanies] = React.useState([]);
  const [currentCompany, setCurrentCompany] = React.useState(null);
  const [showCompanySetup, setShowCompanySetup] = React.useState(false);
  const [appLoading, setAppLoading] = React.useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadCompanies(session);
      else setAppLoading(false);
    });
    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) loadCompanies(session);
      else { setCompanies([]); setCurrentCompany(null); setAppLoading(false); }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadCompanies = async (sess) => {
    setAppLoading(true);
    const { data } = await supabase
      .from("company_users")
      .select("company_id, role, companies(*)")
      .eq("user_id", sess.user.id)
      .not("accepted_at", "is", null);
    const cos = (data||[]).map(r=>({...r.companies, role:r.role}));
    setCompanies(cos);
    if (cos.length > 0) setCurrentCompany(cos[0]);
    else setShowCompanySetup(true);
    setAppLoading(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  if (session === undefined || appLoading) {
    return (
      <div style={{minHeight:"100vh",background:"#0A0A0F",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif"}}>
        <div style={{color:"#6B6B8A",fontSize:14}}>Loading...</div>
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
    />
  );
}

const DEFAULT_CHART_OF_ACCOUNTS = [
  { code: "1000", name: "Cash & Cash Equivalents", category: "Assets" },
  { code: "1100", name: "Accounts Receivable", category: "Assets" },
  { code: "1200", name: "Inventory", category: "Assets" },
  { code: "1300", name: "Prepaid Expenses", category: "Assets" },
  { code: "1500", name: "Property, Plant & Equipment", category: "Assets" },
  { code: "2000", name: "Accounts Payable", category: "Liabilities" },
  { code: "2100", name: "Accrued Liabilities", category: "Liabilities" },
  { code: "2200", name: "Short-Term Debt", category: "Liabilities" },
  { code: "2500", name: "Long-Term Debt", category: "Liabilities" },
  { code: "3000", name: "Common Stock", category: "Equity" },
  { code: "3100", name: "Retained Earnings", category: "Equity" },
  { code: "4000", name: "Sales Revenue", category: "Revenue" },
  { code: "4100", name: "Service Revenue", category: "Revenue" },
  { code: "4200", name: "Other Income", category: "Revenue" },
  { code: "5000", name: "Cost of Goods Sold", category: "Expenses" },
  { code: "5100", name: "Salaries & Wages", category: "Expenses" },
  { code: "5200", name: "Rent & Occupancy", category: "Expenses" },
  { code: "5300", name: "Utilities", category: "Expenses" },
  { code: "5400", name: "Marketing & Advertising", category: "Expenses" },
  { code: "5500", name: "Travel & Entertainment", category: "Expenses" },
  { code: "5600", name: "Office Supplies", category: "Expenses" },
  { code: "5700", name: "Insurance", category: "Expenses" },
  { code: "5800", name: "Professional Services", category: "Expenses" },
  { code: "5900", name: "Technology & Software", category: "Expenses" },
  { code: "6000", name: "Depreciation", category: "Expenses" },
  { code: "6100", name: "Interest Expense", category: "Expenses" },
  { code: "6200", name: "Miscellaneous Expense", category: "Expenses" },
];

const PROJECTS = ["General", "Marketing Campaign", "Office Renovation", "Product Launch", "Cloud Infrastructure", "R&D", "Sales Ops"];

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase();
}
function vendorColor(name) {
  const colors = ["#6D28D9","#0EA5E9","#10B981","#F59E0B","#EF4444","#8B5CF6","#EC4899","#14B8A6"];
  let hash = 0;
  for (let i = 0; i < (name||"").length; i++) hash = name.charCodeAt(i) + ((hash<<5)-hash);
  return colors[Math.abs(hash) % colors.length];
}

// ── GL CLASSIFICATION HELPERS ─────────────────────────────────────────────────
// P&L only shows income statement accounts (4xxx revenue, 5xxx/6xxx expense).
// Balance sheet accounts (1xxx assets, 2xxx liabilities, 3xxx equity) never appear on P&L.
const glIsRevenue     = (code) => typeof code === "string" && code.startsWith("4");
const glIsExpense     = (code) => typeof code === "string" && (code.startsWith("5") || code.startsWith("6"));
const glIsBalSheet    = (code) => typeof code === "string" && (code.startsWith("1") || code.startsWith("2") || code.startsWith("3"));
// Returns "revenue" | "expense" | null (null = balance sheet — exclude from P&L entirely)
const glPLType        = (code) => glIsRevenue(code) ? "revenue" : glIsExpense(code) ? "expense" : null;

// ── AI BRAIN ──────────────────────────────────────────────────────────────────
// Sends full ledger context + rules + chat history to Claude.
// Claude responds with a JSON action plan + a plain-English reply.
// ── INTENT CLASSIFIER ─────────────────────────────────────────────────────────
// Cheap pre-flight call (~150 tokens) that decides how much context the main
// call actually needs. Runs on claude-haiku for speed + cost.
async function classifyIntent(userMessage, recentHistory) {
  const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 20,
      system: `Classify what this accounting assistant message needs. Reply with ONLY one word:
- ledger    → needs invoice/transaction data (reports, P&L, expense breakdowns, recode, retag, "how much", "what did we spend", "show me")
- contacts  → only needs vendor/customer info (add/update vendor or customer, set terms, contact details)
- rules     → only needs GL rules (add/delete/change a coding rule)
- general   → needs nothing from the database (greetings, how-to questions, explanations)`,
      messages: [
        ...recentHistory.slice(-3).map(m => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessage }
      ]
    })
  });
  const d = await res.json();
  const t = (d.content?.find(b => b.type === "text")?.text || "").trim().toLowerCase();
  if (t.includes("ledger")) return "ledger";
  if (t.includes("contacts")) return "contacts";
  if (t.includes("rules")) return "rules";
  return "general";
}

async function runAIBrain({ userMessage, invoices, rules, projects, chatHistory, contacts, chartOfAccounts }) {
  // ── 1. Truncate history to last 10 turns (5 user + 5 assistant) ───────────────
  const truncatedHistory = chatHistory.slice(-10);

  // ── 2. Classify intent to decide what context to load ────────────────────────
  const intent = await classifyIntent(userMessage, truncatedHistory);

  // ── 3. Build context payload based on intent ──────────────────────────────────
  const needsLedger   = intent === "ledger";
  const needsContacts = intent === "ledger" || intent === "contacts";
  const needsRules    = intent === "ledger" || intent === "rules" || intent === "contacts";

  const ledgerSection = needsLedger
    ? `Current Ledger (${invoices.length} entries — showing most recent 80):
${invoices.length === 0 ? "Empty." : invoices.slice(0, 80).map(inv =>
  `ID:${inv.id} | ${inv.vendor} | $${inv.amount} | ${inv.date} | GL:${inv.gl_code} ${inv.gl_name} | Project:${inv.project||"General"} | Status:${inv.payment_status||"unpaid"}`
).join("\n")}`
    : `Ledger: not loaded for this query (${invoices.length} total entries available — ask a specific financial question to query it).`;

  const contactsSection = needsContacts && contacts.length > 0
    ? `Contacts (${contacts.length}):
${contacts.map(c =>
  `- [${c.type.toUpperCase()}] ${c.name} | Terms: ${c.payment_terms||"—"} | GL: ${c.gl_code||"—"} ${c.gl_name||""} | Email: ${c.email||"—"} | Phone: ${c.phone||"—"} | Expected: ${c.min_expected||"—"}–${c.max_expected||"—"} | Tags: ${(c.tags||[]).join(", ")||"none"} | Notes: ${c.notes||"none"}`
).join("\n")}`
    : contacts.length > 0
      ? `Contacts: ${contacts.length} on file (not loaded — ask about a specific vendor or customer to query).`
      : "Contacts: None yet.";

  const rulesSection = needsRules
    ? `Vendor Rules:\n${rules.length === 0 ? "None yet." : rules.map(r => `- ${r.vendor} → GL ${r.gl_code} (${r.gl_name})${r.project ? `, Project: ${r.project}` : ""}`).join("\n")}`
    : `Vendor Rules: ${rules.length} active (not loaded for this query).`;

  // ── 4. Build system prompt ────────────────────────────────────────────────────
  const systemPrompt = `You are CFAI — an AI CFO and bookkeeper in one, built for business owners who need real financial intelligence without the jargon. You think like a seasoned CFO who also handles the books. You proactively surface what matters, not just what was asked.

Chart of Accounts:
${(chartOfAccounts || DEFAULT_CHART_OF_ACCOUNTS).map(a => `${a.code} - ${a.name} (${a.category})`).join("\n")}

Available Projects: ${[...PROJECTS, ...projects].filter((v,i,a) => a.indexOf(v) === i).join(", ")}

${rulesSection}

${contactsSection}

${ledgerSection}

Respond ONLY with a JSON object (no markdown):
{
  "reply": "Direct, intelligent response in plain English. Always include real numbers from the ledger. No markdown, no asterisks, no headers. Write like a trusted CFO talking to their CEO.",
  "actions": [
    // Ledger: { "type": "recode", "invoiceIds": [id], "gl_code": "XXXX", "gl_name": "Name" }
    // Ledger: { "type": "retag_project", "invoiceIds": [id], "project": "Name" }
    // Ledger: { "type": "add_rule", "vendor": "Name", "gl_code": "XXXX", "gl_name": "Name", "project": "optional" }
    // Ledger: { "type": "delete_rule", "vendor": "Name" }
    // COA: { "type": "add_account", "code": "XXXX", "name": "Name", "category": "Revenue|Expenses|Assets|Liabilities|Equity" }
    // Contact: { "type": "add_contact", "contact_type": "vendor|customer", "name": "Name", "gl_code": "XXXX", "gl_name": "Name", "payment_terms": "Net 30", "email": "...", "phone": "...", "notes": "...", "tags": [], "min_expected": 0, "max_expected": 0 }
    // Contact: { "type": "update_contact", "name": "Name", "updates": { "email": "...", "phone": "...", "payment_terms": "...", "notes": "...", "min_expected": 0, "max_expected": 0, "tags": [] } }
    // Contact: { "type": "set_contact_rule", "name": "Name", "gl_code": "XXXX", "gl_name": "Name", "project": "optional" }
    // Recurring: { "type": "add_recurring", "name": "e.g. Office Rent", "vendor": "...", "amount": 4500, "gl_code": "5200", "gl_name": "Rent & Occupancy", "frequency": "monthly|weekly|quarterly|annual", "next_date": "YYYY-MM-DD" }
    // Recurring: { "type": "pause_recurring", "name": "..." }
    // { "type": "none" }
  ]
}

CFO Intelligence Guidelines:
BURN RATE & CASH — these are the #1 priority for most founders and small business owners:
- Always compute burn rate from the ledger when asked (total expenses in period)
- Net burn = expenses minus revenue. Always distinguish gross burn vs net burn.
- Runway = estimated cash / average monthly burn. Flag if under 6 months.
- When asked about cash, give: current position, monthly burn, runway, and top 3 burn drivers
- Proactively flag if burn is accelerating month over month
- Example: "Your burn is $42k/mo, up 18% from last month. At that rate your runway is about 8 months. Your top driver is payroll at $28k — everything else is pretty lean."

TAX AWARENESS:
- Track which expenses are tax-deductible and flag non-deductible items
- Remind about quarterly estimated tax deadlines (Apr 15, Jun 15, Sep 15, Jan 15)
- Estimated federal tax ≈ 25-30% of net income for most small businesses
- 1099 threshold: vendors paid $600+ annually need a 1099-NEC
- Flag when a vendor is approaching the $600 threshold
- Year-end reminder: W-2s due Jan 31, 1099s due Jan 31

CASH FLOW (cash basis, not accrual):
- Cash in = collected receivables + direct cash revenue
- Cash out = paid invoices + payroll + direct expenses
- Always distinguish between "revenue recorded" and "cash actually received"
- When asked about cash flow, use payment_status to determine actual cash movement

BUSINESS TYPE AWARENESS — adapt your guidance based on what you observe:
- High payroll + low revenue = startup burning VC money → focus on runway
- High AR outstanding = services/consulting business → focus on collections
- High COGS = product business → focus on margins
- Lots of 1099 vendors = agency/contractor model → flag compliance
- Recurring subscription revenue = SaaS → focus on MRR and churn cost

FOLLOW-UP QUESTIONS — if a request is ambiguous, ask ONE targeted question before acting:
- "Which month did you mean — this month or last month?"
- "Should I recode all past invoices from this vendor, or just going forward?"
- "Is this a one-time expense or should I set up a recurring entry?"
Never make a low-confidence change without confirming first.

GAAP AWARENESS — maintain proper books but explain simply:
- Accrual vs cash: explain the difference when relevant
- Always keep proper double-entry records behind the scenes
- But surface cash-basis numbers when that's what the owner cares about

- Always be warm, direct, and confident — you're their CFO, not a compliance officer
- NEVER use markdown — no asterisks, no bold, no dashes for bullets. Plain sentences only.`;

  // ── 5. Call the main model ────────────────────────────────────────────────────
  const messages = [
    ...truncatedHistory.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ];

  const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, system: systemPrompt, messages })
  });
  const data = await res.json();
  const text = data.content?.find(b => b.type === "text")?.text || "{}";
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch(e) {
    // If JSON parse fails, extract just the reply text and return it gracefully
    const replyMatch = cleaned.match(/"reply"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
    return { reply: replyMatch ? replyMatch[1].replace(/\\n/g, "\n") : cleaned, actions: [] };
  }
}

function ERP({ session, currentCompany, companies, onSwitchCompany, onNewCompany, onSignOut, supabase }) {
  const [invoices, setInvoices] = useState([]);
  const [rules, setRules] = useState([]); // { vendor, gl_code, gl_name, project }
  // Contacts: { id, name, type:"vendor"|"customer", gl_code, gl_name, payment_terms, email, phone, notes, tags:[], min_expected, max_expected, created_at }
  const [contacts, setContacts] = useState([]);
  const [customProjects, setCustomProjects] = useState([]);
  const [view, setView] = useState("dashboard");
  // ── CLARIFICATION QUEUE ── invoices waiting for user input before booking
  const [clarificationQueue, setClarificationQueue] = useState([]); // [{id, invoice, question, options, queueItemId}]
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [isAILoading, setIsAILoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [form, setForm] = useState({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General" });
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
  const [reportRange, setReportRange] = useState("all");
  const [reportDateFrom, setReportDateFrom] = useState("");
  const [reportDateTo, setReportDateTo] = useState("");
  const [basisMode, setBasisMode] = useState("cash"); // "cash" | "accrual" | "comparison"
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
  };

  // ── DOCUMENT STORAGE ─────────────────────────────────────────────────────────
  const [docLibrary, setDocLibrary] = useState([]);
  const storeDocument = (name, base64, mediaType, type, linkedId=null, tags=[]) => {
    const doc = { id: Date.now()+Math.random(), name, base64, mediaType, type, uploaded_at: new Date().toISOString(), linked_invoice_id: linkedId, tags };
    setDocLibrary(prev => [doc, ...prev]);
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
    { role: "assistant", content: "Hi! I'm your accounting assistant. Tell me what you need — I can recode invoices, tag projects, create vendor rules, or answer any question about your books. Just speak naturally!", id: 0 }
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

  useEffect(() => {
    if (chatOpen) { chatBottomRef.current?.scrollIntoView({ behavior: "smooth" }); setHasUnread(false); }
  }, [chatHistory, chatOpen]);

  useEffect(() => {
    if (view === "settings" && !settingsDraft) {
      setSettingsDraft(companySettings);
    }
  }, [view]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (mainContentRef.current) {
        mainContentRef.current.scrollTop = 0;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [view]);

  // ── SUPABASE DATA LOADING ──────────────────────────────────
  useEffect(() => {
    if (!currentCompany?.id) return;
    loadAllData();
  }, [currentCompany?.id]);

  const loadAllData = async () => {
    const cid = currentCompany.id;
    try {
      // Load journal entries + lines as flat invoices for backward compat
      const { data: entries } = await supabase
        .from("journal_entries")
        .select("*, journal_entry_lines(*, accounts(code,name))")
        .eq("company_id", cid)
        .eq("status", "posted")
        .order("entry_date", { ascending: false })
        .limit(200);

      if (entries) {
        const mapped = entries.map(e => {
          const debitLine = e.journal_entry_lines?.find(l => l.debit > 0);
          const creditLine = e.journal_entry_lines?.find(l => l.credit > 0);
          return {
            id: e.id, vendor: e.description?.split(" – ")[0] || e.description,
            description: e.description, amount: debitLine?.debit || creditLine?.credit || 0,
            date: e.entry_date, type: debitLine?.accounts?.code?.startsWith("4") ? "revenue" : "expense",
            gl_code: debitLine?.accounts?.code || creditLine?.accounts?.code,
            gl_name: debitLine?.accounts?.name || creditLine?.accounts?.name,
            secondary_gl_code: creditLine?.accounts?.code, secondary_gl_name: creditLine?.accounts?.name,
            debit_credit: debitLine ? "debit" : "credit",
            status: "booked", booked_at: e.created_at, source: e.source,
            payment_status: "unpaid", confidence: 99, reasoning: "Loaded from database",
            db_entry_id: e.id
          };
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
        .order("created_at", { ascending: false }).limit(100);
      if (auditData) {
        setAuditLog(auditData.map(a => ({
          id: a.id, ts: a.created_at, action: a.action,
          detail: a.detail, before: a.before_state, after: a.after_state, user: "owner"
        })));
      }

    } catch(e) { console.error("loadAllData error:", e); }
  };

  // ── SUPABASE PERSISTENCE ──────────────────────────────────────
  // Write a journal entry to Supabase when an invoice is booked
  const persistJournalEntry = async (invoice) => {
    if (!currentCompany?.id || !session?.user?.id) return;
    try {
      const { data: debitAcct } = await supabase.from("accounts")
        .select("id").eq("company_id", currentCompany.id).eq("code", invoice.gl_code).single();
      const { data: creditAcct } = await supabase.from("accounts")
        .select("id").eq("company_id", currentCompany.id).eq("code", invoice.secondary_gl_code||"2000").single();
      if (!debitAcct || !creditAcct) return;

      const { data: je, error: jeErr } = await supabase.from("journal_entries").insert({
        company_id: currentCompany.id, entry_date: invoice.date||new Date().toISOString().slice(0,10),
        description: `${invoice.vendor} – ${invoice.description||invoice.vendor}`,
        source: invoice.source||"manual", status: "posted",
        posted_at: new Date().toISOString(), created_by: session.user.id
      }).select().single();
      if (jeErr) { console.error("JE insert error:", jeErr); return; }

      await supabase.from("journal_entry_lines").insert({
        journal_entry_id: je.id, company_id: currentCompany.id,
        account_id: debitAcct.id, debit: invoice.amount, credit: 0,
        memo: invoice.description
      });
      await supabase.from("journal_entry_lines").insert({
        journal_entry_id: je.id, company_id: currentCompany.id,
        account_id: creditAcct.id, debit: 0, credit: invoice.amount,
        memo: invoice.description
      });
      await supabase.from("audit_log").insert({
        company_id: currentCompany.id, user_id: session.user.id,
        action: "invoice_booked",
        detail: `${invoice.vendor} $${invoice.amount} → ${invoice.gl_name}`
      });
    } catch(e) { console.error("persistJournalEntry error:", e); }
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
    setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General" });
    runFullAI(base64, file.type);
  };

  const runFullAI = async (base64, mediaType) => {
    setIsAILoading(true); setAiStep("extracting"); setAiSuggestion(null);
    try {
      const extractRes = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method: "POST", headers: getAuthHeaders(),
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000,
          system: `Extract invoice fields. "vendor" = exact legal name of the company issuing the invoice. Respond ONLY with valid JSON: {"vendor":"...","description":"...","amount":"123.45","date":"YYYY-MM-DD","type":"expense or revenue","notes":"line items, tax, invoice number etc"}`,
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

  const handleBookInvoice = () => {
    if (!form.vendor?.trim()) { showNotification("Vendor name is required.", "error"); return; }
    if (!form.description || !form.amount || !form.date) { showNotification("Please fill all fields.", "error"); return; }
    if (!aiSuggestion) { showNotification("Waiting for AI coding.", "error"); return; }
    const invoice = {
      id: Date.now(), ...form, vendor: form.vendor.trim(),
      amount: parseFloat(form.amount), project: form.project || "General",
      gl_code: aiSuggestion.gl_code, gl_name: aiSuggestion.gl_name,
      secondary_gl_code: aiSuggestion.secondary_gl_code, secondary_gl_name: aiSuggestion.secondary_gl_name,
      debit_credit: aiSuggestion.debit_credit, confidence: aiSuggestion.confidence,
      reasoning: aiSuggestion.reasoning, status: "booked", booked_at: new Date().toISOString(),
    };
    setInvoices(prev => [invoice, ...prev]);
    runAPScreen([invoice], [invoice, ...invoices]);
    checkWatchTriggers([invoice], unknownDocs);
    logAudit("invoice_booked", `Manual entry: ${invoice.vendor} $${invoice.amount} → ${invoice.gl_name}`, null, invoice);
    persistJournalEntry(invoice); // save to Supabase
    setForm({ vendor:"", description:"", amount:"", date:"", type:"expense", notes:"", project:"General" });
    setAiSuggestion(null); setUploadedFile(null);
    setView("dashboard");
    showNotification(`Booked to ${aiSuggestion.gl_name} ✓`);
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
  {"vendor":"Exact vendor name","description":"what was purchased","amount":"123.45","date":"YYYY-MM-DD","type":"expense or revenue","notes":"invoice number, line items, tax etc"},
  ...one object per invoice...
]

To determine type, reason about document direction:
- Look at who is BILLING whom. If a company is issuing the invoice TO this business (requesting payment), type = "expense"
- If this business is issuing the invoice TO a customer (requesting payment from them), type = "revenue"
- Signals of expense: "Bill To: [your company]", "Please remit", "Amount Due", vendor name is a supplier/service provider
- Signals of revenue: "Invoice To: [customer name]", "Payment from", this business appears as the issuing party

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
            const confidence = rule ? 99 : (coding.confidence || 75);
            const finalCode = rule ? rule.gl_code : (coding.gl_code || (extracted.type==="revenue" ? "4000" : "5900"));
            const finalName = rule ? rule.gl_name : (coding.gl_name || (extracted.type==="revenue" ? "Sales Revenue" : "Miscellaneous Expense"));

            const invoice = {
              id: Date.now() + Math.random() + idx,
              vendor: extracted.vendor?.trim() || "Unknown",
              description: extracted.description || "",
              amount: parseFloat(extracted.amount) || 0,
              date: extracted.date || new Date().toISOString().slice(0,10),
              type: extracted.type || "expense",
              notes: extracted.notes || "",
              project: rule?.project || "General",
              gl_code: finalCode,
              gl_name: finalName,
              secondary_gl_code: rule ? "2000" : (coding.secondary_gl_code || "2000"),
              secondary_gl_name: rule ? "Accounts Payable" : (coding.secondary_gl_name || "Accounts Payable"),
              debit_credit: "debit",
              confidence,
              reasoning: rule ? `Vendor rule: ${finalName}` : (coding.reasoning || "Auto-coded"),
              status: "booked",
              booked_at: new Date().toISOString(),
              source: "universal_upload",
            };

            if (confidence >= 85 || rule) {
              highConfidence.push(invoice);
            } else {
              // Build targeted clarification question
              const topAlternatives = CHART_OF_ACCOUNTS
                .filter(a => (extracted.type==="revenue" ? a.category==="Revenue" : a.category==="Expenses"))
                .sort((a,b) => {
                  // Sort by relevance to current coding
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
                  ? `I'm not sure how to code this ${extracted.type} from ${extracted.vendor} for $${parseFloat(extracted.amount).toFixed(2)}. ${coding.reasoning || "Which category fits best?"}:`
                  : `I coded this to "${finalName}" (${confidence}% confident). Does that look right?`,
                options: topAlternatives.map(a => ({ code: a.code, name: a.name })),
                suggestedCode: finalCode,
                suggestedName: finalName,
              });
            }
          });

          // Book high-confidence invoices immediately
          if (highConfidence.length > 0) {
            setInvoices(prev => [...highConfidence, ...prev]);
            highConfidence.forEach(inv => persistJournalEntry(inv));
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
            secondary_gl_code:t.type==="expense"?"2000":"1000", secondary_gl_name:t.type==="expense"?"Accounts Payable":"Cash",
            debit_credit:"debit", confidence:t.confidence, reasoning:"Imported via universal upload",
            status:"booked", booked_at:new Date().toISOString(), source:"universal_upload", payment_status:"unmatched",
          }));
          setInvoices(prev => [...newInvoices, ...prev]);
          newInvoices.forEach(inv => persistJournalEntry(inv));
          if (uncertain.length > 0) {
            setBankTransactions(prev => [...uncertain.map((t,i)=>({...t, id:Date.now()+Math.random(), checked:false})), ...prev]);
          }
          setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"done", result:{
            txnCount: withRules.length, autoBooked: confident.length, needsReview: uncertain.length
          }} : q));

        } else if (docType === "contract") {
          // Full contract analysis
          const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
            method:"POST", headers:getAuthHeaders(),
            body: JSON.stringify({
              model:"claude-sonnet-4-20250514", max_tokens:4000,
              system:`Expert CPA. Analyze this contract and generate accounting treatment + journal entry schedule. Respond ONLY with JSON: {"contract_type":"loan|revenue_contract|lease|subscription_paid|subscription_received|equipment_financing|service_agreement","counterparty":"...","description":"...","total_value":0,"start_date":"YYYY-MM-DD","end_date":"YYYY-MM-DD","payment_amount":0,"payment_frequency":"monthly","interest_rate":0,"accounting_treatment":"...","key_terms":[],"journal_entries":[{"date":"YYYY-MM-DD","description":"...","memo":"...","lines":[{"account_code":"XXXX","account_name":"...","debit":0,"credit":0}]}]}\nChart of Accounts:\n${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name}`).join("\n")}`,
              messages:[{role:"user",content:[
                {type:mediaType==="application/pdf"?"document":"image", source:{type:"base64",media_type:mediaType,data:base64}},
                {type:"text",text:"Analyze this contract and generate the full accounting treatment."}
              ]}]
            })
          });
          const d = await res.json();
          const contract = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
          const saved = { ...contract, id:Date.now()+Math.random(), file_name:item.name, uploaded_at:new Date().toISOString(), posted_entries:[] };
          setContracts(prev => [saved, ...prev]);
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
      setUploadQueue(prev => prev.map(q => q.id===item.id ? {...q, status:"error", error:"Processing failed — try again"} : q));
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
      secondary_gl_code: t.type==="expense"?"2000":"1000",
      secondary_gl_name: t.type==="expense"?"Accounts Payable":"Cash & Cash Equivalents",
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
    subscription_paid: { label:"Subscription (Paid)", color:"#8B5CF6", icon:"💳" },
    subscription_received: { label:"Subscription (Received)", color:"#0EA5E9", icon:"📦" },
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

      const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
        method:"POST", headers:getAuthHeaders(),
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:4000,
          system:`You are an expert CPA and contract analyst. Read this contract/agreement and extract all key terms, then generate the correct accounting treatment including a full journal entry schedule.

Contract types to identify: loan, revenue_contract, lease, subscription_paid, subscription_received, equipment_financing, service_agreement.

For each contract, generate:
1. Key extracted terms
2. The correct accounting treatment explanation (plain English, no jargon)
3. A schedule of journal entries

Respond ONLY with valid JSON, no markdown:
{
  "contract_type": "loan|revenue_contract|lease|subscription_paid|subscription_received|equipment_financing|service_agreement",
  "counterparty": "Other party name",
  "description": "One line summary of what this contract is",
  "total_value": 10000.00,
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "payment_amount": 500.00,
  "payment_frequency": "monthly|quarterly|annual|one-time",
  "interest_rate": 0.05,
  "accounting_treatment": "Plain English explanation of how this should be accounted for and why",
  "key_terms": ["term 1", "term 2"],
  "journal_entries": [
    {
      "date": "YYYY-MM-DD",
      "description": "Entry description",
      "memo": "Why this entry is made",
      "lines": [
        {"account_code": "XXXX", "account_name": "Account Name", "debit": 1000.00, "credit": 0},
        {"account_code": "XXXX", "account_name": "Account Name", "debit": 0, "credit": 1000.00}
      ]
    }
  ]
}

Chart of Accounts available:
${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}

Generate journal entries for:
- Loan: initial draw, then monthly interest + principal entries for full term
- Revenue contract: initial deferred revenue booking, then monthly recognition entries
- Lease: initial right-of-use asset (or just monthly expense for operating lease), monthly entries
- Subscription paid: prepaid asset booking + monthly amortization
- Subscription received: deferred revenue + monthly recognition
- Equipment financing: asset booking, liability, monthly interest + principal
- Service agreement: monthly accrual entries over term

Limit to first 12 entries if term is longer than 12 months, with a note.`,
          messages:[{role:"user", content:[
            {type: ext===".pdf"?"document":"image", source:{type:"base64", media_type:mediaType, data:base64}},
            {type:"text", text:"Analyze this contract and generate the full accounting treatment and journal entry schedule."}
          ]}]
        })
      });

      const data = await res.json();
      const raw = (data.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim();
      const contract = JSON.parse(raw);

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
      showNotification(`Contract analyzed — ${contract.journal_entries?.length||0} journal entries generated ✓`);
    } catch(e) {
      showNotification("Failed to analyze contract. Please try again.", "error");
      console.error(e);
    }
    setContractProcessing(false);
  };

  const postContractEntry = (contract, entryIdx) => {
    const entry = contract.journal_entries[entryIdx];
    if (!entry) return;
    // Post each line as a ledger transaction
    const newInvoices = entry.lines.filter(l=>l.debit>0).map(l => ({
      id: Date.now() + Math.random(),
      vendor: contract.counterparty,
      description: `${entry.description} — ${entry.memo}`,
      amount: l.debit,
      date: entry.date,
      // Use GL code to derive type — balance sheet lines stored but won't appear on P&L reports
      type: glIsRevenue(l.account_code) ? "revenue" : "expense",
      project: "General",
      gl_code: l.account_code,
      gl_name: l.account_name,
      secondary_gl_code: entry.lines.find(x=>x.credit>0)?.account_code||"2000",
      secondary_gl_name: entry.lines.find(x=>x.credit>0)?.account_name||"Accounts Payable",
      debit_credit: "debit", confidence: 99,
      reasoning: `Posted from contract: ${contract.description}`,
      status:"booked", booked_at: new Date().toISOString(), source:"contract"
    }));
    setInvoices(prev => [...newInvoices, ...prev]);
    // Mark entry as posted
    setContracts(prev => prev.map(c => c.id===contract.id
      ? {...c, posted_entries: [...(c.posted_entries||[]), entryIdx]}
      : c
    ));
    setSelectedContract(prev => ({...prev, posted_entries: [...(prev.posted_entries||[]), entryIdx]}));
    showNotification(`Journal entry posted to ledger ✓`);
  };

  const postAllContractEntries = (contract) => {
    const unposted = contract.journal_entries?.filter((_,i) => !contract.posted_entries?.includes(i)) || [];
    unposted.forEach((_,idx) => {
      const realIdx = contract.journal_entries.indexOf(_);
      postContractEntry(contract, realIdx);
    });
    showNotification(`All ${unposted.length} entries posted ✓`);
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
  const AP_PRIORITY = { critical:"#EF4444", high:"#F59E0B", normal:"#10B981", low:"#6B6B8A" };

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

  const approveInvoice = (invId) => {
    setInvoices(prev => prev.map(inv => inv.id !== invId ? inv : {
      ...inv,
      approval_status: "approved",
      approval_reason: "Manually approved",
      approved_at: new Date().toISOString(),
    }));
    showNotification("Invoice approved ✓");
  };

  const rejectInvoice = (invId) => {
    setInvoices(prev => prev.map(inv => inv.id !== invId ? inv : {
      ...inv,
      approval_status: "rejected",
      approval_reason: "Manually rejected",
      rejected_at: new Date().toISOString(),
      payment_status: "rejected",
    }));
    showNotification("Invoice rejected", "error");
  };

  const markPaid = (invIds, method = "ach") => {
    const ids = Array.isArray(invIds) ? invIds : [invIds];
    setInvoices(prev => prev.map(inv => !ids.includes(inv.id) ? inv : {
      ...inv,
      payment_status: "paid",
      payment_method_used: method,
      paid_at: new Date().toISOString(),
      matched: true,
    }));
    setSelectedPayments(new Set());
    setCheckRunMode(false);
    showNotification(`${ids.length} payment${ids.length!==1?"s":""} recorded as ${method.toUpperCase()} ✓`);
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
        if (action.type === "recode" && action.invoiceIds?.length) {
          setInvoices(prev => prev.map(inv =>
            action.invoiceIds.includes(inv.id)
              ? { ...inv, gl_code: action.gl_code, gl_name: action.gl_name, recode_note: `Recoded by AI assistant` }
              : inv
          ));
          logAudit("ai_recode", `AI recoded ${action.invoiceIds.length} invoice(s) → ${action.gl_name}`, null, { ids: action.invoiceIds, gl: action.gl_name });
          actionSummary.push(`Recoded ${action.invoiceIds.length} invoice(s) → ${action.gl_name}`);
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

  const inputStyle = { width:"100%", background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:8, padding:"10px 12px", color:"#E8E8F0", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"'DM Sans', sans-serif" };
  const labelStyle = { display:"block", fontSize:11, color:"#6B6B8A", marginBottom:6, letterSpacing:1 };

  return (
    <div style={{ fontFamily:"'DM Sans', sans-serif", minHeight:"100vh", background:"#0F0F13", color:"#E8E8F0" }}>
      <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&family=Montserrat:wght@700;800;900&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes slideup{from{opacity:0;transform:translateY(20px) scale(0.95)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes popbubble{from{transform:scale(0.7)}to{transform:scale(1)}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-track{background:#0F0F13} ::-webkit-scrollbar-thumb{background:#2A2A3E;border-radius:2px}
      `}</style>

      {notification && (
        <div style={{ position:"fixed", top:20, right:20, zIndex:9999, background:notification.type==="error"?"#2A0A0A":"#0A2A1A", border:`1px solid ${notification.type==="error"?"#EF4444":"#10B981"}`, color:notification.type==="error"?"#FCA5A5":"#6EE7B7", padding:"12px 20px", borderRadius:10, fontSize:14, animation:"fadein 0.2s ease", boxShadow:"0 8px 32px rgba(0,0,0,0.6)" }}>
          {notification.msg}
        </div>
      )}

      <div style={{ display:"flex", flexDirection:"column", height:"100vh", overflow:"hidden" }}>
        {/* Top Bar */}
        <div style={{ background:"#14141A", borderBottom:"1px solid #1E1E2E", flexShrink:0 }}>
          {/* Brand + Company + User row */}
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 28px", height:54, borderBottom:"1px solid #1E1E2E" }}>
            <div style={{ display:"flex", alignItems:"center", gap:24 }}>
              <div style={{ fontSize:18, letterSpacing:4, color:"#C8B8FF", fontWeight:800, fontFamily:"'Montserrat', 'DM Sans', sans-serif", background:"linear-gradient(135deg,#C8B8FF,#8B5CF6)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>CFAI</div>
              <CompanySwitcher companies={companies} currentCompany={currentCompany} onSwitch={onSwitchCompany} onNew={onNewCompany} />
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", borderRadius:8, padding:"7px 16px", fontSize:12, cursor:"pointer", fontWeight:500, letterSpacing:0.5 }}>✦ AI Assistant</button>
              <span style={{ fontSize:11, color:"#4B4B6A" }}>{session?.user?.email}</span>
              <button onClick={onSignOut} style={{ padding:"6px 14px", borderRadius:8, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", fontSize:12, cursor:"pointer" }}>Sign out</button>
            </div>
          </div>
          {/* Nav — 6 core tabs, stretch full width */}
          <div style={{ display:"flex", width:"100%", borderBottom:"1px solid #1A1A28" }}>
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
                  onMouseEnter={e=>{ if(!isActive){ e.currentTarget.style.background="#1A1A28"; e.currentTarget.style.color="#A78BFA"; }}}
                  onMouseLeave={e=>{ if(!isActive){ e.currentTarget.style.background="transparent"; e.currentTarget.style.color="#6B6B8A"; }}}
                  style={{
                    flex:1, height:44, display:"flex", alignItems:"center", justifyContent:"center",
                    background: isActive?"#1E1E2E":"transparent",
                    border:"none",
                    borderBottom: isActive?"3px solid #8B5CF6":"3px solid transparent",
                    color: isActive?"#C8B8FF":"#6B6B8A",
                    fontSize:13, fontWeight: isActive?600:400,
                    cursor:"pointer", transition:"all 0.12s", letterSpacing:0.3,
                  }}>
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Sub-nav — shown when a main tab has sub-views */}
          {["ledger","money-in","money-out","reports","settings"].includes(view) || ["invoices","bank","matching","recon","docs","ar","send-invoice","customers","ap","payroll","vendors","rules","contracts","recurring","tax1099","audit","coa","opening-balances","onboard"].includes(view) ? (
            <div style={{ display:"flex", background:"#0F0F13", borderBottom:"1px solid #1A1A28", padding:"0 16px", gap:4 }}>
              {(view==="ledger"||["invoices","bank","matching","recon","docs"].includes(view)) && [
                { id:"invoices", label:"All Transactions" },
                { id:"bank", label:"Bank Feed", badge: bankTransactions.filter(t=>t.needs_review).length||null },
                { id:"recon", label:"Reconciliation" },
                { id:"matching", label:"Matching", badge: matchQueue.length||null },
                { id:"docs", label:"Documents", badge: docLibrary.length||null },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C8B8FF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#6B6B8A"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B5CF6":"2px solid transparent", color:view===s.id?"#C8B8FF":"#6B6B8A", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"color 0.12s" }}>
                  {s.label}{s.badge>0&&<span style={{background:"#6D28D9",borderRadius:20,padding:"1px 5px",fontSize:9,color:"#fff"}}>{s.badge}</span>}
                </button>
              ))}
              {(view==="money-in"||["ar","send-invoice","customers"].includes(view)) && [
                { id:"ar", label:"Receivables", badge: invoices.filter(i=>glIsRevenue(i.gl_code)&&i.payment_status!=="collected").length||null },
                { id:"send-invoice", label:"Send Invoice" },
                { id:"customers", label:"Customers", badge: contacts.filter(c=>c.type==="customer").length||null },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C8B8FF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#6B6B8A"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B5CF6":"2px solid transparent", color:view===s.id?"#C8B8FF":"#6B6B8A", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"color 0.12s" }}>
                  {s.label}{s.badge>0&&<span style={{background:"#6D28D9",borderRadius:20,padding:"1px 5px",fontSize:9,color:"#fff"}}>{s.badge}</span>}
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
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C8B8FF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#6B6B8A"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B5CF6":"2px solid transparent", color:view===s.id?"#C8B8FF":"#6B6B8A", fontSize:12, cursor:"pointer", display:"flex", alignItems:"center", gap:5, transition:"color 0.12s" }}>
                  {s.label}{s.badge>0&&<span style={{background:"#6D28D9",borderRadius:20,padding:"1px 5px",fontSize:9,color:"#fff"}}>{s.badge}</span>}
                </button>
              ))}
              {(view==="reports"||["tax1099","audit"].includes(view)) && [
                { id:"reports", label:"Reports" },
                { id:"tax1099", label:"1099s" },
                { id:"audit", label:"Audit Trail" },
              ].map(s => (
                <button key={s.id} onClick={()=>setView(s.id)}
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C8B8FF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#6B6B8A"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B5CF6":"2px solid transparent", color:view===s.id?"#C8B8FF":"#6B6B8A", fontSize:12, cursor:"pointer", transition:"color 0.12s" }}>
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
                  onMouseEnter={e=>{ if(view!==s.id){ e.currentTarget.style.color="#C8B8FF"; }}}
                  onMouseLeave={e=>{ if(view!==s.id){ e.currentTarget.style.color="#6B6B8A"; }}}
                  style={{ padding:"8px 14px", background:"none", border:"none", borderBottom:view===s.id?"2px solid #8B5CF6":"2px solid transparent", color:view===s.id?"#C8B8FF":"#6B6B8A", fontSize:12, cursor:"pointer", transition:"color 0.12s" }}>
                  {s.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {/* Main Content */}
        <div ref={mainContentRef} id="main-content" style={{ flex:1, padding:"32px 40px", overflowY:"auto" }}>

          {/* Top-level tab redirects */}
          {view==="ledger" && (() => { setView("invoices"); return null; })()}
          {view==="money-in" && (() => { setView("ar"); return null; })()}
          {view==="money-out" && (() => { setView("ap"); return null; })()}

          {/* DASHBOARD */}
          {view==="dashboard" && (
            <div>
              {/* ── UNIVERSAL UPLOAD ZONE ── */}
              <div
                onDragOver={e=>{e.preventDefault();setUniversalDragOver(true);}}
                onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget))setUniversalDragOver(false);}}
                onDrop={e=>{e.preventDefault();setUniversalDragOver(false);handleUniversalUpload(e.dataTransfer.files);}}
                onClick={()=>document.getElementById("universal-upload").click()}
                style={{
                  border:`2px dashed ${universalDragOver?"#C8B8FF":"#2A2A3E"}`,
                  borderRadius:16, padding:"52px 32px", textAlign:"center", cursor:"pointer",
                  background:universalDragOver?"#1A1A2E":"#14141A", transition:"all 0.18s",
                  boxShadow:universalDragOver?"0 0 48px rgba(200,184,255,0.10)":"none",
                  marginBottom:20,
                }}>
                <input id="universal-upload" type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.csv,.xlsx,.xls" style={{display:"none"}} onChange={e=>handleUniversalUpload(e.target.files)} />
                <div style={{ fontSize:28, marginBottom:12, opacity: universalDragOver ? 1 : 0.4, transition:"opacity 0.18s" }}>⬆</div>
                <div style={{ fontSize:15, fontWeight:500, color:universalDragOver?"#C8B8FF":"#9CA3AF", transition:"color 0.18s" }}>
                  {universalDragOver ? "Release to upload" : "Drop anything here, or click to browse"}
                </div>
              </div>

              {/* ── UPLOAD QUEUE ── */}
              {uploadQueue.length > 0 && (
                <div style={{ marginBottom:24 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
                    <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2 }}>PROCESSING QUEUE</div>
                    {uploadQueue.every(q=>q.status==="done"||q.status==="error") && (
                      <button onClick={()=>setUploadQueue([])} style={{ background:"none", border:"none", color:"#6B6B8A", fontSize:12, cursor:"pointer", padding:0 }}>Clear ×</button>
                    )}
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {uploadQueue.map(item => {
                      const typeConfig = {
                        invoice:       { icon:"🧾", label:"Invoice",         color:"#C8B8FF" },
                        bank_statement:{ icon:"🏦", label:"Bank Statement",  color:"#0EA5E9" },
                        contract:      { icon:"📋", label:"Contract",        color:"#F59E0B" },
                        unknown:       { icon:"❓", label:"Unknown",         color:"#EF4444" },
                      };
                      const tc = typeConfig[item.type] || { icon:"📄", label:"Document", color:"#6B6B8A" };
                      return (
                        <div key={item.id} style={{ background:"#14141A", border:`1px solid ${item.status==="error"?"#EF444433":item.status==="done"?"#10B98133":"#1E1E2E"}`, borderRadius:12, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
                          {/* File icon */}
                          <div style={{ width:38, height:38, borderRadius:10, background:"#1E1E2E", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>
                            {item.status==="done" ? tc.icon : item.status==="error" ? "⚠" : "📄"}
                          </div>
                          {/* Info */}
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{item.name}</div>
                            <div style={{ fontSize:11, marginTop:3, color:item.status==="error"?"#EF4444":item.status==="done"?tc.color:"#6B6B8A" }}>
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
                                {[0,1,2].map(i=><div key={i} style={{ width:5, height:5, borderRadius:"50%", background:"#6B6B8A", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                              </div>
                            )}
                            {item.status==="done" && <span style={{ fontSize:11, color:"#10B981", background:"#0A2A1A", border:"1px solid #10B98133", borderRadius:20, padding:"3px 10px" }}>Done</span>}
                            {item.status==="error" && <span style={{ fontSize:11, color:"#EF4444", background:"#2A0A0A", border:"1px solid #EF444433", borderRadius:20, padding:"3px 10px" }}>Error</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* Bank review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="bank_statement"&&q.result?.needsReview>0) && (
                    <div style={{ marginTop:12, background:"#1A1200", border:"1px solid #F59E0B44", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#F59E0B" }}>⚠ Some bank transactions need your GL selection</div>
                      <button onClick={()=>setView("bank")} style={{ background:"#F59E0B22", border:"1px solid #F59E0B44", color:"#F59E0B", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Now →</button>
                    </div>
                  )}
                  {/* Contract review prompt */}
                  {uploadQueue.some(q=>q.status==="done"&&q.type==="contract") && (
                    <div style={{ marginTop:8, background:"#0A1A2E", border:"1px solid #0EA5E944", borderRadius:10, padding:"12px 16px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <div style={{ fontSize:13, color:"#0EA5E9" }}>📋 Contract journal entries ready to post</div>
                      <button onClick={()=>{ setView("contracts"); setContractView("list"); }} style={{ background:"#0EA5E922", border:"1px solid #0EA5E944", color:"#0EA5E9", borderRadius:8, padding:"6px 14px", fontSize:12, cursor:"pointer" }}>Review Contracts →</button>
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
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:11, color:"#F59E0B", letterSpacing:2, marginBottom:12 }}>⚠ NEEDS YOUR INPUT — {clarificationQueue.length} invoice{clarificationQueue.length>1?"s":""}</div>
                  {clarificationQueue.map(item => (
                    <div key={item.id} style={{ background:"#1A1400", border:"1px solid #F59E0B44", borderRadius:14, padding:20, marginBottom:12 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                        <div>
                          <div style={{ fontSize:15, fontWeight:600, marginBottom:4 }}>{item.invoice.vendor} — ${item.invoice.amount.toFixed(2)}</div>
                          <div style={{ fontSize:13, color:"#9CA3AF" }}>{item.question}</div>
                        </div>
                        <div style={{ fontSize:11, color:"#F59E0B", background:"#F59E0B22", borderRadius:20, padding:"3px 10px", flexShrink:0, marginLeft:12 }}>
                          {Math.round(item.invoice.confidence)}% confident
                        </div>
                      </div>
                      <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:12 }}>
                        {item.options.map(opt => (
                          <button key={opt.code}
                            onClick={() => {
                              const finalInv = {...item.invoice, gl_code: opt.code, gl_name: opt.name, confidence: 100, status:"booked"};
                              setInvoices(prev => [finalInv, ...prev]);
                              persistJournalEntry(finalInv);
                              setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                              showNotification(`Booked to ${opt.name} ✓`);
                            }}
                            style={{
                              padding:"8px 16px", borderRadius:20, fontSize:12, cursor:"pointer",
                              background: opt.code === item.suggestedCode ? "#3B1F7A" : "#1E1E2E",
                              border: `1px solid ${opt.code === item.suggestedCode ? "#8B5CF6" : "#2A2A3E"}`,
                              color: opt.code === item.suggestedCode ? "#C8B8FF" : "#9CA3AF",
                              fontWeight: opt.code === item.suggestedCode ? 600 : 400,
                            }}>
                            {opt.code === item.suggestedCode ? "★ " : ""}{opt.name}
                          </button>
                        ))}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <button onClick={() => {
                          const finalInv = {...item.invoice, confidence:100, status:"booked"};
                          setInvoices(prev => [finalInv, ...prev]);
                          persistJournalEntry(finalInv);
                          setClarificationQueue(prev => prev.filter(c => c.id !== item.id));
                          showNotification(`Booked to ${item.invoice.gl_name} ✓`);
                        }} style={{ fontSize:12, padding:"6px 14px", borderRadius:8, background:"#065F46", border:"1px solid #10B98144", color:"#6EE7B7", cursor:"pointer" }}>
                          ✓ Use suggested: {item.suggestedName}
                        </button>
                        <button onClick={() => setClarificationQueue(prev => prev.filter(c => c.id !== item.id))}
                          style={{ fontSize:12, padding:"6px 14px", borderRadius:8, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>
                          Skip for now
                        </button>
                      </div>
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
                const runwayColor = runway===null?"#6B6B8A":runway<=3?"#EF4444":runway<=6?"#F59E0B":"#10B981";
                const burnTrend = burnLastMonth>0 ? ((burnThisMonth-burnLastMonth)/burnLastMonth*100) : 0;
                const burnDrivers = Object.entries(invoices.filter(i=>glIsExpense(i.gl_code)&&i.date?.startsWith(currentMonth)).reduce((acc,i)=>{acc[i.gl_name]=(acc[i.gl_name]||0)+i.amount;return acc;},{})).sort((a,b)=>b[1]-a[1]).slice(0,3);
                const ytdNet = invoices.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0) - invoices.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
                const estimatedTax = Math.max(0, ytdNet*0.25);
                const m = today.getMonth();
                const nextQtr = m<3?"Apr 15":m<5?"Jun 15":m<8?"Sep 15":"Jan 15";
                return (
                  <div style={{marginBottom:24}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
                      <div style={{background:"#1A0A0A",border:"1px solid #EF444433",borderRadius:14,padding:"20px 22px"}}>
                        <div style={{fontSize:10,color:"#EF4444",letterSpacing:2,marginBottom:8}}>MONTHLY BURN</div>
                        <div style={{fontSize:26,fontWeight:700,color:"#EF4444",fontFamily:"'DM Mono',monospace"}}>${burnThisMonth.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginTop:6}}>
                          {Math.abs(burnTrend)>5 ? (burnTrend>0?<span style={{color:"#EF4444"}}>↑ {Math.abs(burnTrend).toFixed(0)}% vs last mo</span>:<span style={{color:"#10B981"}}>↓ {Math.abs(burnTrend).toFixed(0)}% vs last mo</span>) : "Stable vs last month"}
                        </div>
                      </div>
                      <div style={{background:"#0A0A1A",border:"1px solid #6D28D933",borderRadius:14,padding:"20px 22px"}}>
                        <div style={{fontSize:10,color:"#A78BFA",letterSpacing:2,marginBottom:8}}>NET BURN</div>
                        <div style={{fontSize:26,fontWeight:700,color:netBurn>0?"#EF4444":"#10B981",fontFamily:"'DM Mono',monospace"}}>{netBurn>0?"-":"+"} ${Math.abs(netBurn).toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginTop:6}}>{revenueThisMonth>0?`$${revenueThisMonth.toLocaleString("en-US",{maximumFractionDigits:0})} revenue offset`:"No revenue this month"}</div>
                      </div>
                      <div style={{background:runway!==null&&runway<=3?"#1A0A0A":runway!==null&&runway<=6?"#1A1200":"#0A1A0A",border:`1px solid ${runwayColor}33`,borderRadius:14,padding:"20px 22px"}}>
                        <div style={{fontSize:10,color:runwayColor,letterSpacing:2,marginBottom:8}}>RUNWAY</div>
                        <div style={{fontSize:26,fontWeight:700,color:runwayColor,fontFamily:"'DM Mono',monospace"}}>{runway===null?"∞":`${runway}mo`}</div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginTop:6}}>{runway===null?"Set cash balance for runway":runway<=3?"⚠ Critical — act now":runway<=6?"Watch closely":"Healthy"}</div>
                      </div>
                      <div style={{background:"#0A1400",border:"1px solid #10B98133",borderRadius:14,padding:"20px 22px"}}>
                        <div style={{fontSize:10,color:"#10B981",letterSpacing:2,marginBottom:8}}>EST. TAX DUE</div>
                        <div style={{fontSize:26,fontWeight:700,color:"#10B981",fontFamily:"'DM Mono',monospace"}}>${estimatedTax.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginTop:6}}>Next: {nextQtr} · ~25% of net income</div>
                      </div>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:"18px 20px"}}>
                        <div style={{fontSize:10,color:"#6B6B8A",letterSpacing:2,marginBottom:14}}>TOP BURN DRIVERS THIS MONTH</div>
                        {burnDrivers.length===0 ? <div style={{fontSize:13,color:"#6B6B8A"}}>No expenses this month yet</div> :
                          burnDrivers.map(([name,amt])=>(
                            <div key={name} style={{marginBottom:12}}>
                              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                                <div style={{fontSize:13,color:"#E8E8F0"}}>{name}</div>
                                <div style={{fontSize:13,fontFamily:"'DM Mono',monospace",color:"#EF4444"}}>${amt.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                              </div>
                              <div style={{height:3,background:"#1E1E2E",borderRadius:2}}>
                                <div style={{height:"100%",width:`${Math.min(100,burnThisMonth>0?amt/burnThisMonth*100:0)}%`,background:"linear-gradient(90deg,#EF4444,#F59E0B)",borderRadius:2}} />
                              </div>
                            </div>
                          ))
                        }
                      </div>
                      <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:"18px 20px"}}>
                        <div style={{fontSize:10,color:"#6B6B8A",letterSpacing:2,marginBottom:10}}>CASH POSITION</div>
                        <div style={{fontSize:32,fontWeight:700,color:estimatedCash>=0?"#E8E8F0":"#EF4444",fontFamily:"'DM Mono',monospace",marginBottom:12}}>${estimatedCash.toLocaleString("en-US",{maximumFractionDigits:0})}</div>
                        <div style={{display:"flex",gap:20}}>
                          <div><div style={{fontSize:10,color:"#6B6B8A",marginBottom:2}}>COLLECTED</div><div style={{fontSize:13,color:"#10B981",fontFamily:"'DM Mono',monospace"}}>+${cashInflows.toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
                          <div><div style={{fontSize:10,color:"#6B6B8A",marginBottom:2}}>PAID OUT</div><div style={{fontSize:13,color:"#EF4444",fontFamily:"'DM Mono',monospace"}}>-${cashOutflows.toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
                          <div><div style={{fontSize:10,color:"#6B6B8A",marginBottom:2}}>AVG BURN/MO</div><div style={{fontSize:13,color:"#F59E0B",fontFamily:"'DM Mono',monospace"}}>${avgBurn.toLocaleString("en-US",{maximumFractionDigits:0})}</div></div>
                        </div>
                        {openingCash===0&&<button onClick={()=>setView("opening-balances")} style={{marginTop:12,background:"none",border:"1px solid #2A2A3E",borderRadius:8,padding:"6px 12px",color:"#C8B8FF",fontSize:11,cursor:"pointer"}}>+ Add opening cash balance →</button>}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:16, marginBottom:24 }}>
                {[
                  { label:"Total Revenue", value:totalRevenue, color:"#10B981" },
                  { label:"Total Expenses", value:totalExpenses, color:"#EF4444" },
                  { label:"Net Income", value:netIncome, color:netIncome>=0?"#10B981":"#EF4444" },
                ].map(card => (
                  <div key={card.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:"22px 26px" }}>
                    <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:10, letterSpacing:1 }}>{card.label.toUpperCase()}</div>
                    <div style={{ fontSize:28, fontWeight:600, color:card.color, fontFamily:"'DM Mono', monospace" }}>
                      {netIncome<0&&card.label==="Net Income"?"-":""}${Math.abs(card.value).toLocaleString("en-US",{minimumFractionDigits:2})}
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:24 }}>
                  <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:18, letterSpacing:1 }}>GL ACCOUNT BREAKDOWN</div>
                  {Object.keys(glBreakdown).length===0 ? <div style={{ color:"#6B6B8A", fontSize:13 }}>No transactions yet.</div> :
                    Object.entries(glBreakdown).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,amt])=>(
                      <div key={name} style={{ display:"flex", justifyContent:"space-between", marginBottom:11 }}>
                        <div style={{ fontSize:13, color:"#C8C8D8" }}>{name}</div>
                        <div style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#C8B8FF" }}>${amt.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                      </div>
                    ))
                  }
                </div>
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:24 }}>
                  <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:18, letterSpacing:1 }}>TOP VENDORS BY SPEND</div>
                  {vendorSummary.length===0 ? <div style={{ color:"#6B6B8A", fontSize:13 }}>No vendors yet.</div> :
                    vendorSummary.slice(0,5).map(v=>(
                      <div key={v.name} onClick={()=>{ setVendorFilter(v.name); setView("invoices"); }} style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12, cursor:"pointer" }}>
                        <div style={{ width:30, height:30, borderRadius:8, background:vendorColor(v.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(v.name)}</div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:500, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{v.name}</div>
                          <div style={{ fontSize:11, color:"#6B6B8A" }}>{v.count} invoice{v.count!==1?"s":""}</div>
                        </div>
                        <div style={{ fontSize:13, fontFamily:"'DM Mono', monospace", flexShrink:0 }}>${v.total.toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                      </div>
                    ))
                  }
                  {vendorSummary.length>0 && <button onClick={()=>setView("vendors")} style={{ background:"none", border:"none", color:"#C8B8FF", fontSize:12, cursor:"pointer", padding:0, marginTop:4 }}>View all →</button>}
                </div>
              </div>
              <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:24 }}>
                <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:18, letterSpacing:1 }}>RECENT ACTIVITY</div>
                {invoices.length===0 ? (
                  <div style={{ color:"#6B6B8A", fontSize:14, textAlign:"center", padding:"20px 0" }}>No transactions yet — drop files above to get started</div>
                ) : invoices.slice(0,8).map(inv=>(
                  <div key={inv.id} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"10px 0", borderBottom:"1px solid #1E1E2E", cursor:"pointer" }}>
                    <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                      <div style={{ width:32, height:32, borderRadius:8, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                      <div>
                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                        <div style={{ fontSize:11, color:"#6B6B8A" }}>
                          {inv.gl_name} · {inv.project||"General"} · {inv.date}
                          {inv.source==="universal_upload"&&<span style={{ color:"#C8B8FF", marginLeft:6 }}>⬆</span>}
                          {inv.source==="bank_feed"&&<span style={{ color:"#0EA5E9", marginLeft:6 }}>🏦</span>}
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
            </div>
          )}

          {/* ADD INVOICE */}
          {view==="add" && (
            <div style={{ maxWidth:680 }}>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>NEW ENTRY</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Upload Invoice</h1>
              </div>
              {/* Quick nav to other upload types */}
              {!uploadedFile && (
                <div style={{ display:"flex", gap:10, marginBottom:20 }}>
                  {[
                    { label:"📄 Invoice", active:true },
                    { label:"🏦 Bank Statement", onClick:()=>setView("bank") },
                    { label:"📋 Contract / Agreement", onClick:()=>{ setView("contracts"); setContractView("list"); } },
                  ].map(btn=>(
                    <button key={btn.label} onClick={btn.onClick} style={{ padding:"8px 16px", borderRadius:20, fontSize:12, background:btn.active?"#C8B8FF":"transparent", border:`1px solid ${btn.active?"#C8B8FF":"#2A2A3E"}`, color:btn.active?"#0F0F13":"#6B6B8A", cursor:btn.onClick?"pointer":"default", fontWeight:btn.active?600:400 }}>{btn.label}</button>
                  ))}
                </div>
              )}
              {!uploadedFile && (
                <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)}
                  onDrop={e=>{e.preventDefault();setDragOver(false);handleFileSelect(e.dataTransfer.files[0]);}}
                  onClick={()=>document.getElementById("invoice-upload").click()}
                  style={{ border:`2px dashed ${dragOver?"#C8B8FF":"#2A2A3E"}`, borderRadius:16, padding:"56px 32px", textAlign:"center", cursor:"pointer", background:dragOver?"#1A1A2E":"#14141A", transition:"all 0.2s", marginBottom:24 }}>
                  <div style={{ fontSize:38, marginBottom:14 }}>⬆</div>
                  <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop your invoice here</div>
                  <div style={{ fontSize:13, color:"#6B6B8A" }}>PDF, JPG, PNG or WEBP · AI reads, extracts vendor & codes automatically</div>
                  <input id="invoice-upload" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:"none" }} onChange={e=>handleFileSelect(e.target.files[0])} />
                </div>
              )}
              {uploadedFile && (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:16, padding:28, marginBottom:20 }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                      <div style={{ width:36, height:36, background:"#1E1E2E", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>{uploadedFile.mediaType==="application/pdf"?"📄":"🖼"}</div>
                      <div>
                        <div style={{ fontSize:14, fontWeight:500 }}>{uploadedFile.name}</div>
                        <div style={{ fontSize:12, color:isAILoading?"#C8B8FF":"#10B981" }}>
                          {isAILoading?(aiStep==="extracting"?"⟳ Reading invoice & extracting vendor...":"⟳ Coding to GL accounts..."):"✓ Processed"}
                        </div>
                      </div>
                    </div>
                    <button onClick={()=>{setUploadedFile(null);setAiSuggestion(null);setForm({vendor:"",description:"",amount:"",date:"",type:"expense",notes:"",project:"General"});}}
                      style={{ background:"none", border:"none", color:"#6B6B8A", cursor:"pointer", fontSize:20 }}>×</button>
                  </div>
                  {isAILoading && (
                    <div style={{ marginBottom:20 }}>
                      <div style={{ height:3, background:"#1E1E2E", borderRadius:2, overflow:"hidden" }}>
                        <div style={{ height:"100%", background:"linear-gradient(90deg,#6D28D9,#C8B8FF)", borderRadius:2, width:aiStep==="coding"?"85%":"45%", transition:"width 1.2s ease", animation:"pulse 2s ease-in-out infinite" }} />
                      </div>
                    </div>
                  )}
                  {!isAILoading && (form.vendor||form.amount) && (
                    <div>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:16 }}>EXTRACTED FIELDS — REVIEW & EDIT</div>
                      <div style={{ marginBottom:16, background:"#0A0A14", border:`1px solid ${form.vendor?"#3B3B5E":"#EF4444"}`, borderRadius:10, padding:14 }}>
                        <label style={{ ...labelStyle, color:"#C8B8FF" }}>VENDOR NAME <span style={{ color:"#EF4444" }}>*</span></label>
                        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                          {form.vendor && <div style={{ width:34, height:34, borderRadius:8, background:vendorColor(form.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(form.vendor)}</div>}
                          <input value={form.vendor} onChange={e=>handleFormChange("vendor",e.target.value)} placeholder="Vendor name — required" style={{ ...inputStyle, border:!form.vendor?"1px solid #EF4444":"1px solid #3B3B5E", background:"#0F0F13", fontWeight:500, fontSize:14 }} />
                        </div>
                        {!form.vendor && <div style={{ fontSize:11, color:"#EF4444", marginTop:6 }}>⚠ Required for tracking & rules</div>}
                        {form.vendor && rules.find(r=>r.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"#10B981", marginTop:6 }}>⚡ Vendor rule active — GL auto-applied</div>
                        )}
                        {form.vendor && allVendorNames.includes(form.vendor) && !rules.find(r=>r.vendor?.toLowerCase()===form.vendor?.toLowerCase()) && (
                          <div style={{ fontSize:11, color:"#10B981", marginTop:6 }}>✓ Existing vendor — will group with previous invoices</div>
                        )}
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                        {[{field:"amount",label:"Amount ($)",type:"number"},{field:"date",label:"Date",type:"date"}].map(({field,label,type})=>(
                          <div key={field}>
                            <label style={labelStyle}>{label.toUpperCase()}</label>
                            <input type={type} value={form[field]} onChange={e=>handleFormChange(field,e.target.value)} style={inputStyle} />
                          </div>
                        ))}
                      </div>
                      <div style={{ marginBottom:14 }}>
                        <label style={labelStyle}>DESCRIPTION</label>
                        <input value={form.description} onChange={e=>handleFormChange("description",e.target.value)} style={inputStyle} />
                      </div>
                      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                        <div>
                          <label style={labelStyle}>TYPE</label>
                          <div style={{ display:"flex", gap:8 }}>
                            {["expense","revenue"].map(t=>(
                              <button key={t} onClick={()=>handleFormChange("type",t)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, background:form.type===t?(t==="expense"?"#3B0A0A":"#0A2A1A"):"#0F0F13", border:`1px solid ${form.type===t?(t==="expense"?"#EF4444":"#10B981"):"#2A2A3E"}`, color:form.type===t?(t==="expense"?"#FCA5A5":"#6EE7B7"):"#6B6B8A", cursor:"pointer", textTransform:"capitalize" }}>{t}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label style={labelStyle}>PROJECT</label>
                          <select value={form.project||"General"} onChange={e=>handleFormChange("project",e.target.value)} style={{ ...inputStyle, cursor:"pointer" }}>
                            {allProjects.map(p=><option key={p} value={p}>{p}</option>)}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {aiSuggestion && (
                <div style={{ background:"#0A0A14", border:"1px solid #3B3B5E", borderRadius:14, padding:24, marginBottom:20 }}>
                  <div style={{ fontSize:11, color:"#C8B8FF", letterSpacing:2, marginBottom:16 }}>✦ AI GL CODING</div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14, marginBottom:14 }}>
                    <div style={{ background:"#14141A", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:6 }}>PRIMARY ACCOUNT</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"#C8B8FF" }}>{aiSuggestion.gl_code}</div>
                      <div style={{ fontSize:13, color:"#E8E8F0", marginTop:2 }}>{aiSuggestion.gl_name}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{aiSuggestion.debit_credit?.toUpperCase()}</div>
                    </div>
                    <div style={{ background:"#14141A", borderRadius:10, padding:14 }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:6 }}>OFFSET ACCOUNT</div>
                      <div style={{ fontSize:15, fontWeight:600, color:"#9CA3AF" }}>{aiSuggestion.secondary_gl_code}</div>
                      <div style={{ fontSize:13, color:"#9CA3AF", marginTop:2 }}>{aiSuggestion.secondary_gl_name}</div>
                    </div>
                  </div>
                  <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:14, lineHeight:1.7 }}>{aiSuggestion.reasoning}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                    <div style={{ height:5, flex:1, background:"#1E1E2E", borderRadius:3 }}>
                      <div style={{ height:"100%", width:`${aiSuggestion.confidence}%`, background:aiSuggestion.confidence>=85?"#10B981":"#F59E0B", borderRadius:3 }} />
                    </div>
                    <div style={{ fontSize:12, color:aiSuggestion.confidence>=85?"#10B981":"#F59E0B", fontFamily:"'DM Mono', monospace", whiteSpace:"nowrap" }}>{aiSuggestion.confidence}% confident</div>
                  </div>
                </div>
              )}
              {uploadedFile && !isAILoading && (
                <button onClick={handleBookInvoice} disabled={!aiSuggestion||!form.vendor?.trim()} style={{ width:"100%", padding:"15px", borderRadius:12, fontSize:15, fontWeight:600, background:(aiSuggestion&&form.vendor?.trim())?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"none", color:(aiSuggestion&&form.vendor?.trim())?"#6EE7B7":"#6B6B8A", cursor:(aiSuggestion&&form.vendor?.trim())?"pointer":"not-allowed" }}>
                  ✓ Book Invoice to GL
                </button>
              )}
            </div>
          )}

          {/* ALL INVOICES */}
          {/* ACCOUNTS PAYABLE */}
          {view==="ap" && (() => {
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const today = new Date().toISOString().slice(0,10);

            // All open expense invoices that have been AP-screened or are payable
            const apAll = invoices.filter(i => glIsExpense(i.gl_code) || i.type==="expense");
            const apOpen = apAll.filter(i => i.payment_status !== "paid" && i.approval_status !== "rejected");
            const apPending = apAll.filter(i => i.approval_status === "pending_approval" || i.approval_status === "flagged");
            const apApproved = apOpen.filter(i => i.approval_status === "approved" || i.approval_status === "auto_approved");
            const apOverdue = apOpen.filter(i => i.due_date && i.due_date < today);

            // Aging buckets (based on invoice date)
            const agingBuckets = { current:{count:0,total:0,items:[]}, d60:{count:0,total:0,items:[]}, d90:{count:0,total:0,items:[]}, d90plus:{count:0,total:0,items:[]} };
            apOpen.forEach(inv => {
              const days = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
              const bucket = days<=30?"current":days<=60?"d60":days<=90?"d90":"d90plus";
              agingBuckets[bucket].count++; agingBuckets[bucket].total+=inv.amount; agingBuckets[bucket].items.push(inv);
            });

            const totalOpen = apOpen.reduce((s,i)=>s+i.amount,0);
            const cashAmt = parseFloat(cashBalance)||0;

            const priorityConfig = {
              critical:{ color:"#EF4444", bg:"#2A0A0A", label:"Critical" },
              high:    { color:"#F59E0B", bg:"#1A1200", label:"High" },
              normal:  { color:"#C8B8FF", bg:"#1A1A2E", label:"Normal" },
              low:     { color:"#6B6B8A", bg:"#14141A", label:"Low" },
            };
            const approvalConfig = {
              auto_approved:    { color:"#10B981", label:"Auto-approved" },
              approved:         { color:"#10B981", label:"Approved" },
              pending_approval: { color:"#F59E0B", label:"Needs approval" },
              flagged:          { color:"#EF4444", label:"Flagged" },
              rejected:         { color:"#6B6B8A", label:"Rejected" },
            };

            return (
              <div>
                {/* Header */}
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>ACCOUNTS PAYABLE</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>AP Management</h1>
                  </div>
                  {/* Cash input */}
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <span style={{ fontSize:12, color:"#6B6B8A" }}>Available cash:</span>
                    <div style={{ position:"relative" }}>
                      <span style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)", color:"#6B6B8A", fontSize:13 }}>$</span>
                      <input value={cashBalance} onChange={e=>setCashBalance(e.target.value.replace(/[^0-9.]/g,""))}
                        placeholder="0.00" style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 12px 8px 22px", color:"#E8E8F0", fontSize:13, outline:"none", width:130 }} />
                    </div>
                  </div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                  {[
                    { label:"Total Open AP",    value:fmt(totalOpen),        sub:`${apOpen.length} invoices`,              color:"#E8E8F0" },
                    { label:"Needs Approval",   value:apPending.length,      sub:`${fmt(apPending.reduce((s,i)=>s+i.amount,0))} held`, color:"#F59E0B" },
                    { label:"Overdue",          value:apOverdue.length,      sub:`${fmt(apOverdue.reduce((s,i)=>s+i.amount,0))} past due`, color:"#EF4444" },
                    { label:"Cash vs AP",       value:cashAmt>0?fmt(cashAmt-totalOpen):"—", sub:cashAmt>0?(cashAmt>=totalOpen?"Sufficient to pay all":"Shortfall — prioritize"):"Enter cash balance", color:cashAmt>0?(cashAmt>=totalOpen?"#10B981":"#EF4444"):"#6B6B8A" },
                  ].map(c=>(
                    <div key={c.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"16px 18px" }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:1, marginBottom:8 }}>{c.label.toUpperCase()}</div>
                      <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace", color:c.color }}>{c.value}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Tab bar */}
                <div style={{ display:"flex", gap:2, background:"#0F0F13", borderRadius:10, padding:3, border:"1px solid #1E1E2E", marginBottom:20, width:"fit-content" }}>
                  {[["inbox","📥 Inbox"],["queue","💳 Payment Queue"],["approvals","✓ Approvals"],["aging","📊 Aging"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setApView(id)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:apView===id?600:400,
                      background:apView===id?"#1E1E2E":"transparent", border:"none", color:apView===id?"#C8B8FF":"#6B6B8A", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:6 }}>
                      {label}
                      {id==="approvals"&&apPending.length>0&&<span style={{ background:"#F59E0B", color:"#000", borderRadius:20, fontSize:10, fontWeight:700, padding:"1px 6px" }}>{apPending.length}</span>}
                    </button>
                  ))}
                </div>

                {/* ── INBOX TAB ── */}
                {apView==="inbox" && (
                  <div>
                    {apAll.length===0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                        <div style={{ fontSize:32, marginBottom:12 }}>📥</div>
                        <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No invoices yet</div>
                        <div style={{ fontSize:13, color:"#6B6B8A" }}>Upload invoices from the dashboard — each one is automatically screened for duplicates, anomalies, and routed for approval.</div>
                      </div>
                    )}
                    {apAll.length>0 && (
                      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                        {apAll.sort((a,b)=>{
                          const po = {critical:0,high:1,normal:2,low:3};
                          return (po[a.payment_priority==="1"?"critical":a.payment_priority==="2"?"high":"low"]||2) - (po[b.payment_priority==="1"?"critical":b.payment_priority==="2"?"high":"low"]||2);
                        }).map(inv => {
                          const pc = priorityConfig[inv.payment_priority==="1"?"critical":inv.payment_priority==="2"?"high":inv.payment_priority==="3"?"low":"normal"] || priorityConfig.normal;
                          const ac = approvalConfig[inv.approval_status] || approvalConfig.pending_approval;
                          const daysUntilDue = inv.due_date ? Math.floor((new Date(inv.due_date)-new Date(today))/86400000) : null;
                          const isPaid = inv.payment_status==="paid";
                          return (
                            <div key={inv.id} style={{ background:"#14141A", border:`1px solid ${isPaid?"#1E1E2E":(inv.duplicate_flag||inv.anomaly_flag)?"#EF444433":inv.approval_status==="pending_approval"?"#F59E0B33":"#1E1E2E"}`, borderRadius:14, overflow:"hidden", opacity:isPaid?0.5:1 }}>
                              <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                                {/* Vendor avatar */}
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                {/* Main info */}
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    <span style={{ fontSize:11, background:ac.color+"22", color:ac.color, borderRadius:20, padding:"2px 8px" }}>{ac.label}</span>
                                    {inv.early_pay_discount && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>💰 Early discount</span>}
                                    {inv.duplicate_flag && <span style={{ fontSize:11, background:"#EF444422", color:"#EF4444", borderRadius:20, padding:"2px 8px" }}>⚠ Possible duplicate</span>}
                                    {inv.anomaly_flag && <span style={{ fontSize:11, background:"#F59E0B22", color:"#F59E0B", borderRadius:20, padding:"2px 8px" }}>⚠ Unusual amount</span>}
                                    {isPaid && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>✓ Paid{inv.payment_method_used ? ` via ${inv.payment_method_used.toUpperCase()}` : ""}</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:"#9CA3AF" }}>
                                    {inv.description} · {inv.gl_name} · {inv.date}
                                    {inv.payment_terms && <span style={{ marginLeft:8, color:"#6B6B8A" }}>{inv.payment_terms}</span>}
                                  </div>
                                  {inv.notes_for_reviewer && <div style={{ fontSize:11, color:"#C8B8FF", marginTop:4 }}>✦ {inv.notes_for_reviewer}</div>}
                                  {inv.duplicate_reason && <div style={{ fontSize:11, color:"#EF4444", marginTop:3 }}>⚠ {inv.duplicate_reason}</div>}
                                  {inv.anomaly_reason && <div style={{ fontSize:11, color:"#F59E0B", marginTop:3 }}>⚠ {inv.anomaly_reason}</div>}
                                </div>
                                {/* Amount + due date */}
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(inv.amount)}</div>
                                  {daysUntilDue!==null && !isPaid && (
                                    <div style={{ fontSize:11, marginTop:3, color:daysUntilDue<0?"#EF4444":daysUntilDue<=7?"#F59E0B":"#6B6B8A" }}>
                                      {daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Due today":`Due in ${daysUntilDue}d`}
                                    </div>
                                  )}
                                  {inv.due_date && <div style={{ fontSize:10, color:"#6B6B8A" }}>{inv.due_date}</div>}
                                </div>
                              </div>
                              {/* Action row */}
                              {!isPaid && (
                                <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"flex", gap:8, alignItems:"center" }}>
                                  {(inv.approval_status==="pending_approval"||inv.approval_status==="flagged") && <>
                                    <button onClick={()=>approveInvoice(inv.id)} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#065F4622", border:"1px solid #10B98144", color:"#10B981", cursor:"pointer" }}>✓ Approve</button>
                                    <button onClick={()=>rejectInvoice(inv.id)} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>✗ Reject</button>
                                    <div style={{ width:1, height:20, background:"#2A2A3E", margin:"0 4px" }} />
                                  </>}
                                  {(inv.approval_status==="approved"||inv.approval_status==="auto_approved") && <>
                                    <button onClick={()=>markPaid(inv.id,"ach")} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, fontWeight:600, background:"#1A1A2E", border:"1px solid #C8B8FF44", color:"#C8B8FF", cursor:"pointer" }}>Pay ACH</button>
                                    <button onClick={()=>markPaid(inv.id,"check")} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>Pay Check</button>
                                  </>}
                                  <button onClick={()=>{ setApView("queue"); }} style={{ marginLeft:"auto", padding:"6px 12px", borderRadius:8, fontSize:11, background:"transparent", border:"none", color:"#6B6B8A", cursor:"pointer" }}>Add to queue →</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PAYMENT QUEUE TAB ── */}
                {apView==="queue" && (
                  <div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
                      <div style={{ fontSize:13, color:"#6B6B8A" }}>
                        {apApproved.length} approved invoices ready to pay · {fmt(apApproved.reduce((s,i)=>s+i.amount,0))} total
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        {checkRunMode ? <>
                          <button onClick={()=>{ const ids=[...selectedPayments]; markPaid(ids,"check"); setCheckRunMode(false); }} disabled={selectedPayments.size===0}
                            style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:600, background:selectedPayments.size>0?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"none", color:selectedPayments.size>0?"#6EE7B7":"#6B6B8A", cursor:selectedPayments.size>0?"pointer":"not-allowed" }}>
                            Print Check Run ({selectedPayments.size})
                          </button>
                          <button onClick={()=>{ setCheckRunMode(false); setSelectedPayments(new Set()); }} style={{ padding:"8px 14px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>Cancel</button>
                        </> : <>
                          <button onClick={()=>setCheckRunMode(true)} style={{ padding:"8px 16px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>🗒 Check Run</button>
                          <button onClick={()=>{ const ids=apApproved.map(i=>i.id); markPaid(ids,"ach"); }} disabled={apApproved.length===0}
                            style={{ padding:"8px 18px", borderRadius:10, fontSize:13, fontWeight:600, background:apApproved.length>0?"linear-gradient(135deg,#6D28D9,#4C1D95)":"#1E1E2E", border:"none", color:apApproved.length>0?"#E8E8F0":"#6B6B8A", cursor:apApproved.length>0?"pointer":"not-allowed" }}>
                            Pay All via ACH
                          </button>
                        </>}
                      </div>
                    </div>

                    {/* Cash coverage bar */}
                    {cashAmt>0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"14px 18px", marginBottom:16, display:"flex", alignItems:"center", gap:14 }}>
                        <div style={{ flex:1 }}>
                          <div style={{ display:"flex", justifyContent:"space-between", fontSize:12, marginBottom:6 }}>
                            <span style={{ color:"#6B6B8A" }}>Cash available: {fmt(cashAmt)}</span>
                            <span style={{ color: cashAmt>=totalOpen?"#10B981":"#EF4444" }}>Total open AP: {fmt(totalOpen)}</span>
                          </div>
                          <div style={{ height:6, background:"#1E1E2E", borderRadius:3 }}>
                            <div style={{ height:"100%", width:`${Math.min(100,(cashAmt/totalOpen)*100||0)}%`, background:cashAmt>=totalOpen?"#10B981":"#EF4444", borderRadius:3, transition:"width 0.4s" }} />
                          </div>
                        </div>
                        <div style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:cashAmt>=totalOpen?"#10B981":"#EF4444", flexShrink:0 }}>
                          {cashAmt>=totalOpen ? "✓ Can pay all" : `${fmt(totalOpen-cashAmt)} shortfall`}
                        </div>
                      </div>
                    )}

                    {apApproved.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:32, textAlign:"center", color:"#6B6B8A", fontSize:13 }}>
                        No approved invoices ready for payment.{apPending.length>0?` ${apPending.length} awaiting approval.`:""}
                      </div>
                    ) : (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {checkRunMode && <th style={{ padding:"10px 16px", width:40 }}><input type="checkbox" onChange={e=>{ if(e.target.checked)setSelectedPayments(new Set(apApproved.map(i=>i.id))); else setSelectedPayments(new Set()); }} /></th>}
                            {["Vendor","Due Date","Terms","Amount","Method","Action"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {[...apApproved].sort((a,b)=>{
                              if(!a.due_date) return 1; if(!b.due_date) return -1;
                              return a.due_date.localeCompare(b.due_date);
                            }).map((inv,i)=>{
                              const daysUntilDue = inv.due_date ? Math.floor((new Date(inv.due_date)-new Date(today))/86400000) : 30;
                              const isSelected = selectedPayments.has(inv.id);
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:isSelected?"#1A1A2E":i%2===0?"transparent":"#0A0A10" }}
                                  onClick={()=>checkRunMode&&setSelectedPayments(prev=>{ const n=new Set(prev); isSelected?n.delete(inv.id):n.add(inv.id); return n; })}>
                                  {checkRunMode && <td style={{ padding:"12px 16px" }}><input type="checkbox" checked={isSelected} readOnly /></td>}
                                  <td style={{ padding:"12px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                                        <div style={{ fontSize:11, color:"#6B6B8A" }}>{inv.description?.slice(0,30)}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding:"12px 16px" }}>
                                    <div style={{ fontSize:13, color:daysUntilDue<0?"#EF4444":daysUntilDue<=7?"#F59E0B":"#E8E8F0" }}>{inv.due_date||"—"}</div>
                                    <div style={{ fontSize:11, color:"#6B6B8A" }}>{daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Today":`${daysUntilDue}d`}</div>
                                  </td>
                                  <td style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.payment_terms||"Net 30"}</td>
                                  <td style={{ padding:"12px 16px", fontSize:14, fontFamily:"'DM Mono',monospace", color:"#EF4444", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"12px 16px" }}>
                                    <span style={{ fontSize:11, background:"#1E1E2E", borderRadius:20, padding:"3px 10px", color:"#9CA3AF" }}>{inv.payment_method==="ach"?"ACH":"Check"}</span>
                                    {inv.early_pay_discount && <div style={{ fontSize:10, color:"#10B981", marginTop:3 }}>💰 Discount available</div>}
                                  </td>
                                  <td style={{ padding:"12px 16px" }}>
                                    {!checkRunMode && (
                                      <div style={{ display:"flex", gap:6 }}>
                                        <button onClick={()=>markPaid(inv.id,"ach")} style={{ padding:"5px 12px", borderRadius:7, fontSize:11, fontWeight:600, background:"#1A1A2E", border:"1px solid #C8B8FF44", color:"#C8B8FF", cursor:"pointer" }}>ACH</button>
                                        <button onClick={()=>markPaid(inv.id,"check")} style={{ padding:"5px 10px", borderRadius:7, fontSize:11, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>Check</button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop:"2px solid #2A2A3E", background:"#0F0F13" }}>
                              {checkRunMode && <td />}
                              <td colSpan={3} style={{ padding:"12px 16px", fontSize:13, fontWeight:600 }}>Total</td>
                              <td style={{ padding:"12px 16px", fontSize:15, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#EF4444" }}>{fmt(apApproved.reduce((s,i)=>s+i.amount,0))}</td>
                              <td colSpan={2} />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── APPROVALS TAB ── */}
                {apView==="approvals" && (
                  <div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:16 }}>
                      Auto-approve threshold: <strong style={{ color:"#C8B8FF" }}>${apSettings.autoApproveThreshold.toLocaleString()}</strong> · Invoices above this amount need manual approval.
                    </div>
                    {apPending.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:32, textAlign:"center", color:"#6B6B8A", fontSize:13 }}>
                        ✓ No invoices pending approval
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                        {apPending.map(inv => {
                          const ac = approvalConfig[inv.approval_status] || approvalConfig.pending_approval;
                          return (
                            <div key={inv.id} style={{ background:"#14141A", border:`1px solid ${inv.approval_status==="flagged"?"#EF444433":"#F59E0B33"}`, borderRadius:14, padding:"18px 20px" }}>
                              <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                <div style={{ flex:1 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    <span style={{ fontSize:11, background:ac.color+"22", color:ac.color, borderRadius:20, padding:"2px 8px" }}>{ac.label}</span>
                                  </div>
                                  <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:8 }}>{inv.description} · {inv.date} · {inv.gl_name}</div>
                                  {inv.notes_for_reviewer && (
                                    <div style={{ background:"#0A0A14", border:"1px solid #C8B8FF33", borderRadius:8, padding:"10px 14px", marginBottom:10 }}>
                                      <div style={{ fontSize:11, color:"#C8B8FF", marginBottom:4 }}>✦ AI REVIEW NOTE</div>
                                      <div style={{ fontSize:12, color:"#C8C8D8", lineHeight:1.6 }}>{inv.notes_for_reviewer}</div>
                                    </div>
                                  )}
                                  {inv.duplicate_reason && <div style={{ fontSize:12, color:"#EF4444", marginBottom:6 }}>⚠ Duplicate flag: {inv.duplicate_reason}</div>}
                                  {inv.anomaly_reason && <div style={{ fontSize:12, color:"#F59E0B", marginBottom:6 }}>⚠ Anomaly: {inv.anomaly_reason}</div>}
                                  {inv.approval_reason && <div style={{ fontSize:12, color:"#6B6B8A", marginBottom:8 }}>Reason: {inv.approval_reason}</div>}
                                  <div style={{ display:"flex", gap:8 }}>
                                    <button onClick={()=>approveInvoice(inv.id)} style={{ padding:"8px 20px", borderRadius:9, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>✓ Approve {fmt(inv.amount)}</button>
                                    <button onClick={()=>rejectInvoice(inv.id)} style={{ padding:"8px 16px", borderRadius:9, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer" }}>✗ Reject</button>
                                  </div>
                                </div>
                                <div style={{ fontSize:20, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444", flexShrink:0 }}>{fmt(inv.amount)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Audit trail */}
                    {apAll.filter(i=>i.approved_at||i.rejected_at).length>0 && (
                      <div style={{ marginTop:24 }}>
                        <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:12 }}>AUDIT TRAIL</div>
                        <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, overflow:"hidden" }}>
                          {apAll.filter(i=>i.approved_at||i.rejected_at).map((inv,i)=>(
                            <div key={inv.id} style={{ padding:"12px 18px", borderTop:i>0?"1px solid #1E1E2E":"none", display:"flex", alignItems:"center", gap:10 }}>
                              <div style={{ width:20, height:20, borderRadius:"50%", background:inv.approved_at?"#10B98122":"#EF444422", border:`1px solid ${inv.approved_at?"#10B98155":"#EF444455"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:10 }}>
                                {inv.approved_at?"✓":"✗"}
                              </div>
                              <div style={{ flex:1, fontSize:12 }}>
                                <span style={{ fontWeight:500 }}>{inv.vendor}</span>
                                <span style={{ color:"#6B6B8A", marginLeft:8 }}>{inv.approved_at?"Approved":"Rejected"} · {fmt(inv.amount)}</span>
                              </div>
                              <div style={{ fontSize:11, color:"#6B6B8A" }}>{(inv.approved_at||inv.rejected_at||"").slice(0,10)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ── AGING TAB ── */}
                {apView==="aging" && (
                  <div>
                    {/* Aging buckets */}
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                      {[
                        { label:"Current (0–30d)",  bucket:agingBuckets.current, color:"#10B981" },
                        { label:"31–60 Days",        bucket:agingBuckets.d60,     color:"#F59E0B" },
                        { label:"61–90 Days",        bucket:agingBuckets.d90,     color:"#EF4444" },
                        { label:"90+ Days",          bucket:agingBuckets.d90plus, color:"#7F1D1D" },
                      ].map(({label,bucket,color})=>(
                        <div key={label} style={{ background:"#14141A", border:`1px solid ${color}33`, borderRadius:12, padding:"16px 18px" }}>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:8 }}>{label}</div>
                          <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmt(bucket.total)}</div>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{bucket.count} invoice{bucket.count!==1?"s":""}</div>
                          <div style={{ marginTop:10, height:3, background:"#1E1E2E", borderRadius:2 }}>
                            <div style={{ height:"100%", width:totalOpen>0?`${Math.min(100,(bucket.total/totalOpen)*100)}%`:"0%", background:color, borderRadius:2 }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI commentary */}
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:apAgingNarration||apAgingLoading?16:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>✦ CFO Commentary</div>
                        <button onClick={()=>handleAgingNarration(agingBuckets)} disabled={apAgingLoading}
                          style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:apAgingLoading?"wait":"pointer" }}>
                          {apAgingLoading?"⟳ Analyzing...":"Generate Analysis"}
                        </button>
                      </div>
                      {apAgingLoading && <div style={{ display:"flex", gap:5, alignItems:"center" }}>{[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#6B6B8A",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>}
                      {apAgingNarration && <div style={{ fontSize:13, color:"#C8C8D8", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{apAgingNarration}</div>}
                      {!apAgingNarration && !apAgingLoading && <div style={{ fontSize:13, color:"#6B6B8A" }}>Click Generate Analysis for AI commentary on your AP aging position.</div>}
                    </div>

                    {/* Aged invoice detail */}
                    {apOpen.length>0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"14px 20px", borderBottom:"1px solid #1E1E2E", fontSize:13, fontWeight:600 }}>All Open Payables</div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Vendor","Invoice Date","Due Date","Age","Amount","Status"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                          </tr></thead>
                          <tbody>
                            {[...apOpen].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map((inv,i)=>{
                              const ageDays = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
                              const ageColor = ageDays<=30?"#10B981":ageDays<=60?"#F59E0B":ageDays<=90?"#EF4444":"#7F1D1D";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"11px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:24,height:24,borderRadius:6,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date||"—"}</td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:inv.due_date&&inv.due_date<today?"#EF4444":"#9CA3AF" }}>{inv.due_date||"—"}</td>
                                  <td style={{ padding:"11px 16px" }}><span style={{ fontSize:12, color:ageColor, fontFamily:"'DM Mono',monospace" }}>{ageDays}d</span></td>
                                  <td style={{ padding:"11px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#EF4444", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"11px 16px" }}>
                                    <span style={{ fontSize:11, background:(approvalConfig[inv.approval_status]?.color||"#6B6B8A")+"22", color:approvalConfig[inv.approval_status]?.color||"#6B6B8A", borderRadius:20, padding:"2px 9px" }}>
                                      {approvalConfig[inv.approval_status]?.label||"Pending"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ACCOUNTS RECEIVABLE */}
          {view==="ar" && (() => {
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const today = new Date().toISOString().slice(0,10);
            // arAgingNarration moved to top-level state
            // arAgingLoading moved to top-level state
            // arView moved to top-level state

            // All revenue invoices = AR
            const arAll   = invoices.filter(i => glIsRevenue(i.gl_code) || i.type==="revenue");
            const arOpen  = arAll.filter(i => i.payment_status !== "collected" && i.payment_status !== "paid");
            const arOverdue = arOpen.filter(i => i.due_date && i.due_date < today);

            const totalAR = arOpen.reduce((s,i)=>s+i.amount,0);

            // Aging buckets by invoice date
            const aging = { current:{count:0,total:0,items:[]}, d60:{count:0,total:0,items:[]}, d90:{count:0,total:0,items:[]}, d90plus:{count:0,total:0,items:[]} };
            arOpen.forEach(inv => {
              const days = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
              const b = days<=30?"current":days<=60?"d60":days<=90?"d90":"d90plus";
              aging[b].count++; aging[b].total+=inv.amount; aging[b].items.push(inv);
            });

            // Collections queue — overdue sorted by amount desc
            const collectionsQueue = [...arOverdue].sort((a,b)=>b.amount-a.amount);

            const markCollected = (id) => {
              setInvoices(prev => prev.map(i => i.id!==id ? i : {...i, payment_status:"collected", collected_at:new Date().toISOString(), matched:true}));
              showNotification("Marked as collected ✓");
            };

            const handleArAging = async () => {
              setArAgingLoading(true); setArAgingNarration(null);
              try {
                const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    model:"claude-sonnet-4-20250514", max_tokens:700,
                    system:`You are a CFO advisor reviewing an accounts receivable aging report. Be direct, practical, specific. 3-4 short paragraphs. Flag collection risks. Suggest concrete follow-up actions. No jargon.`,
                    messages:[{role:"user", content:
`AR Aging Summary:
Current (0-30 days): ${aging.current.count} invoices · $${aging.current.total.toLocaleString()}
31-60 days: ${aging.d60.count} invoices · $${aging.d60.total.toLocaleString()}
61-90 days: ${aging.d90.count} invoices · $${aging.d90.total.toLocaleString()}
90+ days: ${aging.d90plus.count} invoices · $${aging.d90plus.total.toLocaleString()}
Total outstanding: $${totalAR.toLocaleString()}
Overdue customers: ${[...new Set(arOverdue.map(i=>i.vendor))].join(", ")||"none"}
90+ day customers: ${[...new Set(aging.d90plus.items.map(i=>i.vendor))].join(", ")||"none"}

What should this business owner know and do?`}]
                  })
                });
                const d = await res.json();
                setArAgingNarration(d.content?.find(b=>b.type==="text")?.text||"");
              } catch(e) { setArAgingNarration("Could not generate commentary."); }
              setArAgingLoading(false);
            };

            return (
              <div>
                {/* Header */}
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>AR Management</h1>
                  <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Outstanding invoices you've issued to customers.</div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                  {[
                    { label:"Total Outstanding", value:fmt(totalAR),         sub:`${arOpen.length} open invoices`,          color:"#10B981" },
                    { label:"Overdue",            value:arOverdue.length,     sub:fmt(arOverdue.reduce((s,i)=>s+i.amount,0))+" past due", color:"#EF4444" },
                    { label:"Current (0–30d)",    value:fmt(aging.current.total), sub:`${aging.current.count} invoices`,     color:"#C8B8FF" },
                    { label:"Collected (Total)",  value:fmt(arAll.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").reduce((s,i)=>s+i.amount,0)), sub:`${arAll.filter(i=>i.payment_status==="collected"||i.payment_status==="paid").length} invoices`, color:"#6B6B8A" },
                  ].map(c=>(
                    <div key={c.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"16px 18px" }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:1, marginBottom:8 }}>{c.label.toUpperCase()}</div>
                      <div style={{ fontSize:22, fontWeight:700, fontFamily:"'DM Mono',monospace", color:c.color }}>{c.value}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{c.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Tab bar */}
                <div style={{ display:"flex", gap:2, background:"#0F0F13", borderRadius:10, padding:3, border:"1px solid #1E1E2E", marginBottom:20, width:"fit-content" }}>
                  {[["inbox","📥 Inbox"],["collections","📞 Collections"],["aging","📊 Aging"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setArView(id)} style={{ padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:arView===id?600:400,
                      background:arView===id?"#1E1E2E":"transparent", border:"none", color:arView===id?"#10B981":"#6B6B8A", cursor:"pointer",
                      display:"flex", alignItems:"center", gap:6 }}>
                      {label}
                      {id==="collections"&&collectionsQueue.length>0&&<span style={{ background:"#EF4444", color:"#fff", borderRadius:20, fontSize:10, fontWeight:700, padding:"1px 6px" }}>{collectionsQueue.length}</span>}
                    </button>
                  ))}
                </div>

                {/* ── AR INBOX ── */}
                {arView==="inbox" && (
                  <div>
                    {arAll.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                        <div style={{ fontSize:32, marginBottom:12 }}>📥</div>
                        <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No revenue invoices yet</div>
                        <div style={{ fontSize:13, color:"#6B6B8A" }}>Upload invoices you've sent to customers — they'll appear here as outstanding receivables.</div>
                      </div>
                    ) : (
                      <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                        {[...arAll].sort((a,b) => {
                          if (a.payment_status==="collected"&&b.payment_status!=="collected") return 1;
                          if (b.payment_status==="collected"&&a.payment_status!=="collected") return -1;
                          return (a.due_date||"9999").localeCompare(b.due_date||"9999");
                        }).map(inv => {
                          const isCollected = inv.payment_status==="collected"||inv.payment_status==="paid";
                          const daysUntilDue = inv.due_date ? Math.floor((new Date(inv.due_date)-new Date(today))/86400000) : null;
                          const isOverdue = daysUntilDue !== null && daysUntilDue < 0;
                          return (
                            <div key={inv.id} style={{ background:"#14141A", border:`1px solid ${isCollected?"#1E1E2E":isOverdue?"#EF444433":"#1E1E2E"}`, borderRadius:14, overflow:"hidden", opacity:isCollected?0.5:1 }}>
                              <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                                <div style={{ width:40, height:40, borderRadius:10, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:13, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                                <div style={{ flex:1, minWidth:0 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3, flexWrap:"wrap" }}>
                                    <span style={{ fontSize:14, fontWeight:600 }}>{inv.vendor}</span>
                                    {isCollected && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>✓ Collected</span>}
                                    {isOverdue && !isCollected && <span style={{ fontSize:11, background:"#EF444422", color:"#EF4444", borderRadius:20, padding:"2px 8px" }}>Overdue</span>}
                                    {inv.early_pay_discount && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 8px" }}>Early discount offered</span>}
                                  </div>
                                  <div style={{ fontSize:12, color:"#9CA3AF" }}>{inv.description} · {inv.gl_name} · {inv.date}
                                    {inv.payment_terms && <span style={{ color:"#6B6B8A", marginLeft:8 }}>{inv.payment_terms}</span>}
                                  </div>
                                </div>
                                <div style={{ textAlign:"right", flexShrink:0 }}>
                                  <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(inv.amount)}</div>
                                  {daysUntilDue!==null && !isCollected && (
                                    <div style={{ fontSize:11, marginTop:3, color:daysUntilDue<0?"#EF4444":daysUntilDue<=7?"#F59E0B":"#6B6B8A" }}>
                                      {daysUntilDue<0?`${Math.abs(daysUntilDue)}d overdue`:daysUntilDue===0?"Due today":`Due in ${daysUntilDue}d`}
                                    </div>
                                  )}
                                  {inv.due_date && <div style={{ fontSize:10, color:"#6B6B8A" }}>{inv.due_date}</div>}
                                </div>
                              </div>
                              {!isCollected && (
                                <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"flex", gap:8 }}>
                                  <button onClick={()=>markCollected(inv.id)} style={{ padding:"6px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>✓ Mark Collected</button>
                                  <button style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }} onClick={()=>setArView("collections")}>Follow Up →</button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* ── COLLECTIONS QUEUE ── */}
                {arView==="collections" && (
                  <div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:16 }}>Overdue invoices sorted by amount — largest first.</div>
                    {collectionsQueue.length===0 ? (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:32, textAlign:"center", color:"#6B6B8A", fontSize:13 }}>
                        ✓ No overdue invoices — all receivables are current.
                      </div>
                    ) : (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Customer","Invoice Date","Due Date","Days Overdue","Amount","Action"].map(h=>(
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {collectionsQueue.map((inv,i) => {
                              const daysOverdue = Math.floor((new Date(today)-new Date(inv.due_date))/86400000);
                              const urgencyColor = daysOverdue>90?"#7F1D1D":daysOverdue>60?"#EF4444":daysOverdue>30?"#F59E0B":"#C8B8FF";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"13px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:28,height:28,borderRadius:7,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <div>
                                        <div style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</div>
                                        <div style={{ fontSize:11, color:"#6B6B8A" }}>{inv.description?.slice(0,35)}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding:"13px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date}</td>
                                  <td style={{ padding:"13px 16px", fontSize:12, color:"#EF4444" }}>{inv.due_date}</td>
                                  <td style={{ padding:"13px 16px" }}>
                                    <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:urgencyColor, fontWeight:600 }}>{daysOverdue}d</span>
                                  </td>
                                  <td style={{ padding:"13px 16px", fontSize:14, fontFamily:"'DM Mono',monospace", color:"#10B981", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"13px 16px" }}>
                                    <button onClick={()=>markCollected(inv.id)} style={{ padding:"5px 14px", borderRadius:8, fontSize:11, fontWeight:600, background:"#065F4622", border:"1px solid #10B98144", color:"#10B981", cursor:"pointer" }}>✓ Collected</button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop:"2px solid #2A2A3E", background:"#0F0F13" }}>
                              <td colSpan={4} style={{ padding:"12px 16px", fontSize:13, fontWeight:600 }}>Total Overdue</td>
                              <td style={{ padding:"12px 16px", fontSize:15, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#EF4444" }}>{fmt(collectionsQueue.reduce((s,i)=>s+i.amount,0))}</td>
                              <td />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}

                {/* ── AR AGING ── */}
                {arView==="aging" && (
                  <div>
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:20 }}>
                      {[
                        { label:"Current (0–30d)", bucket:aging.current, color:"#10B981" },
                        { label:"31–60 Days",      bucket:aging.d60,     color:"#F59E0B" },
                        { label:"61–90 Days",      bucket:aging.d90,     color:"#EF4444" },
                        { label:"90+ Days",        bucket:aging.d90plus, color:"#7F1D1D" },
                      ].map(({label,bucket,color})=>(
                        <div key={label} style={{ background:"#14141A", border:`1px solid ${color}33`, borderRadius:12, padding:"16px 18px" }}>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:8 }}>{label}</div>
                          <div style={{ fontSize:24, fontWeight:700, fontFamily:"'DM Mono',monospace", color }}>{fmt(bucket.total)}</div>
                          <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{bucket.count} invoice{bucket.count!==1?"s":""}</div>
                          <div style={{ marginTop:10, height:3, background:"#1E1E2E", borderRadius:2 }}>
                            <div style={{ height:"100%", width:totalAR>0?`${Math.min(100,(bucket.total/totalAR)*100)}%`:"0%", background:color, borderRadius:2 }} />
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* AI Commentary */}
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:arAgingNarration||arAgingLoading?16:0 }}>
                        <div style={{ fontSize:13, fontWeight:500 }}>✦ CFO Commentary</div>
                        <button onClick={handleArAging} disabled={arAgingLoading}
                          style={{ padding:"7px 16px", borderRadius:8, fontSize:12, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:arAgingLoading?"wait":"pointer" }}>
                          {arAgingLoading?"⟳ Analyzing...":"Generate Analysis"}
                        </button>
                      </div>
                      {arAgingLoading && <div style={{ display:"flex", gap:5 }}>{[0,1,2].map(i=><div key={i} style={{ width:6,height:6,borderRadius:"50%",background:"#6B6B8A",animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}</div>}
                      {arAgingNarration && <div style={{ fontSize:13, color:"#C8C8D8", lineHeight:1.8, whiteSpace:"pre-wrap" }}>{arAgingNarration}</div>}
                      {!arAgingNarration && !arAgingLoading && <div style={{ fontSize:13, color:"#6B6B8A" }}>Click Generate Analysis for AI commentary on your AR position and collection risk.</div>}
                    </div>

                    {/* Aging detail table */}
                    {arOpen.length>0 && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"14px 20px", borderBottom:"1px solid #1E1E2E", fontSize:13, fontWeight:600 }}>All Open Receivables</div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Customer","Invoice Date","Due Date","Age","Amount","Status"].map(h=>(
                              <th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr></thead>
                          <tbody>
                            {[...arOpen].sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map((inv,i) => {
                              const ageDays = Math.floor((new Date(today)-new Date(inv.date||today))/86400000);
                              const ageColor = ageDays<=30?"#10B981":ageDays<=60?"#F59E0B":ageDays<=90?"#EF4444":"#7F1D1D";
                              return (
                                <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"11px 16px" }}>
                                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                      <div style={{ width:24,height:24,borderRadius:6,background:vendorColor(inv.vendor),display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,fontWeight:700,color:"#fff" }}>{initials(inv.vendor)}</div>
                                      <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date||"—"}</td>
                                  <td style={{ padding:"11px 16px", fontSize:12, color:inv.due_date&&inv.due_date<today?"#EF4444":"#9CA3AF" }}>{inv.due_date||"—"}</td>
                                  <td style={{ padding:"11px 16px" }}><span style={{ fontSize:12, color:ageColor, fontFamily:"'DM Mono',monospace" }}>{ageDays}d</span></td>
                                  <td style={{ padding:"11px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#10B981", fontWeight:600 }}>{fmt(inv.amount)}</td>
                                  <td style={{ padding:"11px 16px" }}>
                                    <span style={{ fontSize:11, background:inv.due_date&&inv.due_date<today?"#EF444422":"#10B98122", color:inv.due_date&&inv.due_date<today?"#EF4444":"#10B981", borderRadius:20, padding:"2px 9px" }}>
                                      {inv.due_date&&inv.due_date<today?"Overdue":"Current"}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {/* NEEDS REVIEW */}
          {view==="review" && (
            <div>
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>DOCUMENT REVIEW</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Needs Review</h1>
                <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Documents that needed a closer look. Claude has read each one and proposed the correct accounting treatment — review and post with one click.</div>
              </div>
              {unknownDocs.length===0 ? (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>✓</div>
                  <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>Nothing needs review</div>
                  <div style={{ fontSize:13, color:"#6B6B8A" }}>Any document the system can't classify will land here with an AI explanation and proposed entry.</div>
                </div>
              ) : (
                <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
                  {unknownDocs.map(doc => {
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
                        secondary_gl_code: creditLine?.account_code || "2000",
                        secondary_gl_name: creditLine?.account_name || "Accounts Payable",
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
                      <div key={doc.id} style={{ background:"#14141A", border:`1px solid ${doc.posted?"#10B98133":doc.entry_needed?"#C8B8FF22":"#1E1E2E"}`, borderRadius:14, overflow:"hidden" }}>

                        {/* Header */}
                        <div style={{ padding:"18px 20px", display:"flex", alignItems:"flex-start", gap:14 }}>
                          <div style={{ width:44, height:44, borderRadius:11, background:doc.posted?"#065F4622":doc.entry_needed?"#1A1A2E":"#14141A", border:`1px solid ${doc.posted?"#10B98144":doc.entry_needed?"#C8B8FF33":"#2A2A3E"}`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:20, flexShrink:0 }}>
                            {doc.posted ? "✓" : doc.entry_needed ? "📋" : "📄"}
                          </div>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4, flexWrap:"wrap" }}>
                              <span style={{ fontSize:15, fontWeight:600 }}>{doc.document_type}</span>
                              {doc.posted && <span style={{ fontSize:11, background:"#10B98122", color:"#10B981", borderRadius:20, padding:"2px 9px" }}>✓ Posted</span>}
                              {!doc.posted && doc.entry_needed && <span style={{ fontSize:11, background:"#C8B8FF22", color:"#C8B8FF", borderRadius:20, padding:"2px 9px" }}>Entry proposed</span>}
                              {!doc.posted && !doc.entry_needed && <span style={{ fontSize:11, background:"#1E1E2E", color:"#6B6B8A", borderRadius:20, padding:"2px 9px" }}>No entry needed</span>}
                            </div>
                            <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:12 }}>{doc.name} · Uploaded {doc.uploaded_at?.slice(0,10)}</div>

                            {/* AI explanation */}
                            <div style={{ background:"#0A0A14", border:"1px solid #C8B8FF22", borderRadius:10, padding:"12px 16px", marginBottom: doc.entry_needed && !doc.posted ? 14 : 0 }}>
                              <div style={{ fontSize:10, color:"#C8B8FF", marginBottom:6, letterSpacing:1.5 }}>✦ AI ANALYSIS</div>
                              <div style={{ fontSize:13, color:"#C8C8D8", lineHeight:1.75 }}>{doc.ai_explanation}</div>
                              {doc.no_entry_reason && <div style={{ fontSize:12, color:"#6B6B8A", marginTop:8, borderTop:"1px solid #1E1E2E", paddingTop:8 }}>No entry needed: {doc.no_entry_reason}</div>}
                            </div>

                            {/* Proposed journal entry */}
                            {doc.entry_needed && doc.journal_entry && !doc.posted && (
                              <div style={{ background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:10, overflow:"hidden" }}>
                                <div style={{ padding:"10px 14px", borderBottom:"1px solid #2A2A3E", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                                  <div>
                                    <div style={{ fontSize:11, color:"#C8B8FF", letterSpacing:1 }}>PROPOSED JOURNAL ENTRY</div>
                                    <div style={{ fontSize:12, color:"#6B6B8A", marginTop:2 }}>{doc.journal_entry.description} · {doc.journal_entry.date}</div>
                                  </div>
                                  <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", fontWeight:700, color:"#E8E8F0" }}>{fmt(totalDebits)}</div>
                                </div>
                                <table style={{ width:"100%", borderCollapse:"collapse" }}>
                                  <thead><tr style={{ background:"#0A0A0A" }}>
                                    {["Account","Debit","Credit"].map(h=><th key={h} style={{ padding:"8px 14px", textAlign:"left", fontSize:10, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                                  </tr></thead>
                                  <tbody>
                                    {doc.journal_entry.lines.map((line,i)=>(
                                      <tr key={i} style={{ borderTop:"1px solid #1E1E2E" }}>
                                        <td style={{ padding:"10px 14px" }}>
                                          <span style={{ fontSize:11, background:"#1E1E2E", color:"#9CA3AF", borderRadius:4, padding:"2px 7px", marginRight:8 }}>{line.account_code}</span>
                                          <span style={{ fontSize:13, color:line.debit>0?"#E8E8F0":"#9CA3AF", paddingLeft:line.credit>0?16:0 }}>{line.account_name}</span>
                                        </td>
                                        <td style={{ padding:"10px 14px", fontFamily:"'DM Mono',monospace", fontSize:13, color:"#E8E8F0" }}>{line.debit>0?fmt(line.debit):"—"}</td>
                                        <td style={{ padding:"10px 14px", fontFamily:"'DM Mono',monospace", fontSize:13, color:"#9CA3AF" }}>{line.credit>0?fmt(line.credit):"—"}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}

                            {/* Already posted confirmation */}
                            {doc.posted && (
                              <div style={{ marginTop:12, fontSize:13, color:"#10B981" }}>✓ Entry posted to ledger · {doc.journal_entry?.date}</div>
                            )}

                            {/* Watch match alerts — triggered conditions */}
                            {(doc.watch_matches||[]).length > 0 && (
                              <div style={{ marginTop:14 }}>
                                {doc.watch_matches.map((match, mi) => (
                                  <div key={mi} style={{ background:"#1A0A00", border:"1px solid #F59E0B44", borderRadius:10, padding:"12px 16px", marginBottom:8 }}>
                                    <div style={{ fontSize:11, color:"#F59E0B", letterSpacing:1.2, marginBottom:6 }}>🔔 WATCH TRIGGERED</div>
                                    <div style={{ fontSize:13, color:"#E8E8F0", marginBottom:6, fontWeight:500 }}>{match.trigger_description}</div>
                                    <div style={{ fontSize:12, color:"#9CA3AF", marginBottom:10 }}>
                                      Matched: <strong style={{ color:"#E8E8F0" }}>{match.vendor}</strong> · {fmt(match.amount)} · {match.date}
                                    </div>
                                    {match.suggested_entry_description && (
                                      <div style={{ fontSize:12, color:"#F59E0B", marginBottom:10 }}>
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
                                          gl_code: match.suggested_gl_code || "5900",
                                          gl_name: match.suggested_gl_name || "Miscellaneous Expense",
                                          secondary_gl_code: "1000",
                                          secondary_gl_name: "Cash & Cash Equivalents",
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
                                      style={{ padding:"7px 16px", borderRadius:8, fontSize:12, fontWeight:600, background:match.posted?"#1E1E2E":"linear-gradient(135deg,#92400E,#78350F)", border:"none", color:match.posted?"#6B6B8A":"#FCD34D", cursor:match.posted?"default":"pointer" }}>
                                      {match.posted ? "✓ Entry Posted" : "Post Entry for This Event"}
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Watching for — active conditions */}
                            {!doc.posted && (doc.watch_for||[]).length > 0 && (
                              <div style={{ marginTop:14, background:"#0A0F0A", border:"1px solid #10B98122", borderRadius:10, padding:"12px 16px" }}>
                                <div style={{ fontSize:10, color:"#10B981", letterSpacing:1.5, marginBottom:8 }}>👁 WATCHING FOR</div>
                                {doc.watch_for.map((w, wi) => (
                                  <div key={wi} style={{ display:"flex", alignItems:"flex-start", gap:8, marginBottom: wi < doc.watch_for.length-1 ? 10 : 0 }}>
                                    <div style={{ width:5, height:5, borderRadius:"50%", background:"#10B981", marginTop:6, flexShrink:0 }} />
                                    <div>
                                      <div style={{ fontSize:13, color:"#C8C8D8" }}>{w.trigger_description}</div>
                                      {w.suggested_entry_description && (
                                        <div style={{ fontSize:11, color:"#6B6B8A", marginTop:2 }}>If triggered → {w.suggested_entry_description}</div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <div style={{ fontSize:11, color:"#6B6B8A", marginTop:10, borderTop:"1px solid #1E1E2E", paddingTop:8 }}>
                                  The system will automatically detect related transactions and alert you here.
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Dismiss button */}
                          {doc.posted && (
                            <button onClick={dismiss} style={{ background:"transparent", border:"none", color:"#6B6B8A", cursor:"pointer", fontSize:16, padding:"2px 6px", flexShrink:0 }}>×</button>
                          )}
                        </div>

                        {/* Action bar */}
                        {!doc.posted && (
                          <div style={{ padding:"12px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"flex", gap:8, alignItems:"center" }}>
                            {doc.entry_needed && doc.journal_entry && (
                              <button onClick={postEntry} style={{ padding:"9px 22px", borderRadius:9, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:"pointer" }}>
                                Post Entry to Ledger
                              </button>
                            )}
                            <button onClick={dismiss} style={{ padding:"9px 16px", borderRadius:9, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>
                              {doc.entry_needed ? "Dismiss Without Posting" : "Dismiss"}
                            </button>
                            <div style={{ marginLeft:"auto", fontSize:12, color:"#6B6B8A" }}>
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

          {/* BANK FEED */}
          {view==="bank" && (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>BANK FEED</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Import Bank Transactions</h1>
                <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Upload a CSV, Excel, or PDF bank statement — AI reads every transaction, auto-categorizes, and flags anything it's unsure about.</div>
              </div>

              {/* Upload zone */}
              {!bankProcessing && bankTransactions.length === 0 && (
                <div onDragOver={e=>{e.preventDefault();setBankDragOver(true);}} onDragLeave={()=>setBankDragOver(false)}
                  onDrop={e=>{e.preventDefault();setBankDragOver(false);handleBankFile(e.dataTransfer.files[0]);}}
                  onClick={()=>document.getElementById("bank-upload").click()}
                  style={{ border:`2px dashed ${bankDragOver?"#0EA5E9":"#2A2A3E"}`, borderRadius:16, padding:"52px 32px", textAlign:"center", cursor:"pointer", background:bankDragOver?"#0A1A2E":"#14141A", transition:"all 0.2s", marginBottom:24 }}>
                  <div style={{ fontSize:40, marginBottom:14 }}>🏦</div>
                  <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop your bank statement here</div>
                  <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:16 }}>CSV · Excel (.xlsx) · PDF — from any bank</div>
                  <div style={{ display:"flex", justifyContent:"center", gap:10 }}>
                    {["CSV","XLSX","PDF"].map(f=><span key={f} style={{ background:"#1E1E2E", border:"1px solid #2A2A3E", borderRadius:6, padding:"4px 12px", fontSize:11, color:"#6B6B8A" }}>{f}</span>)}
                  </div>
                  <input id="bank-upload" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display:"none" }} onChange={e=>handleBankFile(e.target.files[0])} />
                </div>
              )}

              {/* Processing state */}
              {bankProcessing && (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:16, padding:36, textAlign:"center", marginBottom:24 }}>
                  <div style={{ fontSize:13, color:"#C8B8FF", marginBottom:20 }}>
                    {bankStep==="parsing" ? "⟳ Reading bank statement..." : "⟳ AI is categorizing all transactions..."}
                  </div>
                  <div style={{ height:6, background:"#1E1E2E", borderRadius:3, overflow:"hidden", maxWidth:400, margin:"0 auto 12px" }}>
                    <div style={{ height:"100%", background:"linear-gradient(90deg,#0EA5E9,#6D28D9)", borderRadius:3, width:`${bankProgress}%`, transition:"width 0.8s ease", animation:"pulse 2s ease-in-out infinite" }} />
                  </div>
                  <div style={{ fontSize:12, color:"#6B6B8A" }}>{bankFileName}</div>
                </div>
              )}

              {/* Transaction review table */}
              {bankTransactions.length > 0 && (
                <div>
                  {/* Summary bar */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:14, marginBottom:20 }}>
                    {[
                      { label:"Total Transactions", value:bankTransactions.length, color:"#E8E8F0" },
                      { label:"Auto-Categorized", value:bankTransactions.filter(t=>!t.needs_review).length, color:"#10B981" },
                      { label:"Needs Review", value:bankTransactions.filter(t=>t.needs_review).length, color:"#F59E0B" },
                    ].map(s=>(
                      <div key={s.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"16px 20px" }}>
                        <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:6, letterSpacing:1 }}>{s.label.toUpperCase()}</div>
                        <div style={{ fontSize:24, fontWeight:600, color:s.color, fontFamily:"'DM Mono', monospace" }}>{s.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Needs review section */}
                  {bankTransactions.filter(t=>t.needs_review).length > 0 && (
                    <div style={{ background:"#1A1200", border:"1px solid #F59E0B44", borderRadius:14, padding:20, marginBottom:20 }}>
                      <div style={{ fontSize:12, color:"#F59E0B", marginBottom:16, display:"flex", alignItems:"center", gap:8 }}>
                        <span>⚠</span> <span>These transactions need your input — AI wasn't confident enough to auto-categorize</span>
                      </div>
                      {bankTransactions.filter(t=>t.needs_review).map(t=>(
                        <div key={t.id} style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:10, padding:"14px 16px", marginBottom:10 }}>
                          <div style={{ display:"grid", gridTemplateColumns:"1fr 120px 160px 40px", gap:12, alignItems:"center" }}>
                            <div>
                              <div style={{ fontSize:13, fontWeight:500 }}>{t.description}</div>
                              <div style={{ fontSize:11, color:"#6B6B8A", marginTop:2 }}>{t.date} · Detected vendor: <span style={{ color:"#C8B8FF" }}>{t.vendor||"Unknown"}</span></div>
                            </div>
                            <div style={{ fontSize:14, fontFamily:"'DM Mono', monospace", color:t.type==="revenue"?"#10B981":"#EF4444", textAlign:"right" }}>
                              {t.type==="revenue"?"+":"-"}${Math.abs(t.amount).toLocaleString("en-US",{minimumFractionDigits:2})}
                            </div>
                            <select value={t.gl_code} onChange={e=>{
                              const acct = CHART_OF_ACCOUNTS.find(a=>a.code===e.target.value);
                              setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,gl_code:acct.code,gl_name:acct.name,needs_review:false,checked:true}:tx));
                            }} style={{ background:"#0F0F13", border:"1px solid #3B3B5E", borderRadius:8, padding:"6px 10px", color:"#E8E8F0", fontSize:12, outline:"none", cursor:"pointer" }}>
                              <option value="">— Select GL Account —</option>
                              {CHART_OF_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                            </select>
                            <input type="checkbox" checked={t.checked||false} onChange={e=>setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,checked:e.target.checked}:tx))}
                              style={{ width:18, height:18, cursor:"pointer", accentColor:"#10B981" }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Auto-categorized table */}
                  {bankTransactions.filter(t=>!t.needs_review).length > 0 && (
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden", marginBottom:20 }}>
                      <div style={{ padding:"14px 20px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div style={{ fontSize:12, color:"#10B981" }}>✓ Auto-categorized — review & uncheck any you want to skip</div>
                        <div style={{ display:"flex", gap:8 }}>
                          <button onClick={()=>setBankTransactions(prev=>prev.map(t=>t.needs_review?t:{...t,checked:true}))} style={{ background:"none", border:"1px solid #2A2A3E", color:"#9CA3AF", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Select all</button>
                          <button onClick={()=>setBankTransactions(prev=>prev.map(t=>t.needs_review?t:{...t,checked:false}))} style={{ background:"none", border:"1px solid #2A2A3E", color:"#9CA3AF", borderRadius:6, padding:"4px 10px", fontSize:11, cursor:"pointer" }}>Deselect all</button>
                        </div>
                      </div>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead>
                          <tr style={{ background:"#0F0F13" }}>
                            {["","Vendor","Date","Description","GL Account","Amount"].map((h,i)=>(
                              <th key={i} style={{ padding:"11px 14px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bankTransactions.filter(t=>!t.needs_review).map((t,i)=>(
                            <tr key={t.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10", opacity:t.checked?1:0.45 }}>
                              <td style={{ padding:"11px 14px" }}>
                                <input type="checkbox" checked={t.checked||false} onChange={e=>setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,checked:e.target.checked}:tx))}
                                  style={{ width:16, height:16, cursor:"pointer", accentColor:"#10B981" }} />
                              </td>
                              <td style={{ padding:"11px 14px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(t.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(t.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{t.vendor}</span>
                                  {t.rule_applied && <span style={{ fontSize:10, color:"#C8B8FF", background:"#1E1E2E", borderRadius:10, padding:"1px 6px" }}>⚡rule</span>}
                                </div>
                              </td>
                              <td style={{ padding:"11px 14px", fontSize:12, color:"#9CA3AF" }}>{t.date}</td>
                              <td style={{ padding:"11px 14px", fontSize:12, color:"#9CA3AF", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{t.description}</td>
                              <td style={{ padding:"11px 14px" }}>
                                <select value={t.gl_code} onChange={e=>{
                                  const acct=CHART_OF_ACCOUNTS.find(a=>a.code===e.target.value);
                                  if(acct) setBankTransactions(prev=>prev.map(tx=>tx.id===t.id?{...tx,gl_code:acct.code,gl_name:acct.name}:tx));
                                }} style={{ background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:6, padding:"4px 8px", color:"#C8B8FF", fontSize:11, outline:"none", cursor:"pointer" }}>
                                  {CHART_OF_ACCOUNTS.map(a=><option key={a.code} value={a.code}>{a.code} · {a.name}</option>)}
                                </select>
                              </td>
                              <td style={{ padding:"11px 14px", fontSize:13, fontFamily:"'DM Mono', monospace", color:t.type==="revenue"?"#10B981":"#EF4444" }}>
                                {t.type==="revenue"?"+":"-"}${Math.abs(t.amount).toLocaleString("en-US",{minimumFractionDigits:2})}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Action bar */}
                  <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                    <button onClick={bookBankTransactions} style={{
                      flex:1, padding:"14px", borderRadius:12, fontSize:14, fontWeight:600,
                      background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer"
                    }}>
                      ✓ Book {bankTransactions.filter(t=>t.checked).length} Selected Transaction{bankTransactions.filter(t=>t.checked).length!==1?"s":""} to Ledger
                    </button>
                    <button onClick={()=>{setBankTransactions([]);setBankFileName("");}} style={{ padding:"14px 20px", borderRadius:12, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>
                      Clear
                    </button>
                  </div>
                </div>
              )}

              {/* Upload new while reviewing */}
              {bankTransactions.length > 0 && !bankProcessing && (
                <div style={{ marginTop:16, textAlign:"center" }}>
                  <button onClick={()=>document.getElementById("bank-upload-2").click()} style={{ background:"none", border:"none", color:"#C8B8FF", fontSize:13, cursor:"pointer" }}>
                    + Upload another statement
                  </button>
                  <input id="bank-upload-2" type="file" accept=".csv,.xlsx,.xls,.pdf,.txt" style={{ display:"none" }} onChange={e=>handleBankFile(e.target.files[0])} />
                </div>
              )}
            </div>
          )}

          {view==="invoices" && (
            <div>
              <div style={{ marginBottom:28, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>LEDGER</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>{vendorFilter==="all"?"All Invoices":vendorFilter}</h1>
                  {vendorFilter!=="all" && <div style={{ fontSize:13, color:"#6B6B8A", marginTop:4 }}>{filteredInvoices.length} invoice{filteredInvoices.length!==1?"s":""} · ${filteredInvoices.reduce((s,i)=>s+i.amount,0).toLocaleString("en-US",{minimumFractionDigits:2})} total</div>}
                </div>
                <button onClick={()=>setView("add")} style={{ padding:"10px 20px", borderRadius:8, background:"#1E1E2E", border:"1px solid #3B3B5E", color:"#C8B8FF", fontSize:13, cursor:"pointer" }}>+ New Invoice</button>
              </div>
              {allVendorNames.length>0 && (
                <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:20 }}>
                  <button onClick={()=>setVendorFilter("all")} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, background:vendorFilter==="all"?"#1E1E2E":"transparent", border:`1px solid ${vendorFilter==="all"?"#C8B8FF":"#2A2A3E"}`, color:vendorFilter==="all"?"#C8B8FF":"#6B6B8A", cursor:"pointer" }}>All</button>
                  {allVendorNames.map(v=>(
                    <button key={v} onClick={()=>setVendorFilter(v)} style={{ padding:"6px 14px", borderRadius:20, fontSize:12, display:"flex", alignItems:"center", gap:6, background:vendorFilter===v?vendorColor(v)+"33":"transparent", border:`1px solid ${vendorFilter===v?vendorColor(v):"#2A2A3E"}`, color:vendorFilter===v?"#E8E8F0":"#6B6B8A", cursor:"pointer" }}>
                      <span style={{ width:8, height:8, borderRadius:"50%", background:vendorColor(v), display:"inline-block" }} />{v}
                    </button>
                  ))}
                </div>
              )}
              {filteredInvoices.length===0 ? <div style={{ color:"#6B6B8A", fontSize:14 }}>No invoices yet.</div> : (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#0F0F13" }}>
                        {["Vendor","Date","Description","GL Account","Project","Amount"].map(h=>(
                          <th key={h} style={{ padding:"13px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.5, fontWeight:500 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredInvoices.map((inv,i)=>(
                        <tr key={inv.id} onClick={()=>{ setSelectedInvoice(inv); setView("detail"); }} style={{ borderTop:"1px solid #1E1E2E", cursor:"pointer", background:i%2===0?"transparent":"#0A0A10" }}>
                          <td style={{ padding:"13px 16px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                              <div style={{ width:28, height:28, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff", flexShrink:0 }}>{initials(inv.vendor)}</div>
                              <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                            </div>
                          </td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"#9CA3AF" }}>{inv.date}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, color:"#9CA3AF", maxWidth:140, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                          <td style={{ padding:"13px 16px", fontSize:12 }}><span style={{ background:"#1E1E2E", padding:"3px 10px", borderRadius:20, color:"#C8B8FF" }}>{inv.gl_code} · {inv.gl_name}</span></td>
                          <td style={{ padding:"13px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.project||"General"}</td>
                          <td style={{ padding:"13px 16px", fontSize:13, fontFamily:"'DM Mono', monospace", color:inv.type==="revenue"?"#10B981":"#EF4444" }}>
                            {inv.type==="revenue"?"+":"-"}${inv.amount.toLocaleString("en-US",{minimumFractionDigits:2})}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* VENDORS */}
          {view==="vendors" && (() => {
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const selectedContact = vendorsSelectedContact; const setSelectedContact = setVendorsSelectedContact;
            const editingId = vendorsEditingId; const setEditingId = setVendorsEditingId; const editDraft = vendorsEditDraft; const setEditDraft = setVendorsEditDraft;

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

            const startEdit = (v) => {
              setEditingId(v.id||v.name);
              setEditDraft({ payment_terms:v.payment_terms||"", email:v.email||"", phone:v.phone||"", notes:v.notes||"", tags:(v.tags||[]).join(", "), min_expected:v.min_expected||"", max_expected:v.max_expected||"" });
            };
            const saveEdit = (v) => {
              if (v.fromContact) {
                setContacts(prev => prev.map(c => c.id===v.id ? {...c, ...editDraft, tags: editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null } : c));
              } else {
                const newC = { id:Date.now()+Math.random(), name:v.name, type:"vendor", ...editDraft, tags:editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null, created_at:new Date().toISOString() };
                setContacts(prev => [newC, ...prev]);
              }
              setEditingId(null);
            };

            return (
              <div>
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>VENDOR MANAGEMENT</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Vendors</h1>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Or just tell the AI chat — "Add Johnson Electric as a vendor, Net 30, around $2k/month"</div>
                  </div>
                  <button onClick={()=>{ setChatOpen(true); }} style={{ padding:"9px 18px", borderRadius:10, fontSize:13, background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", cursor:"pointer" }}>+ Add via Chat</button>
                </div>

                {allVendors.length===0 ? (
                  <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>◈</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No vendors yet</div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:20 }}>Vendors appear automatically when you upload invoices, or tell the AI chat to add one.</div>
                    <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {allVendors.map(v => {
                      const isEditing = editingId===(v.id||v.name);
                      const openAP = invoices.filter(i => i.vendor?.toLowerCase()===v.name?.toLowerCase() && glIsExpense(i.gl_code) && i.payment_status!=="paid").reduce((s,i)=>s+i.amount,0);
                      const totalSpend = v.ledger?.total || 0;
                      const rule = rules.find(r=>r.vendor?.toLowerCase()===v.name?.toLowerCase());
                      return (
                        <div key={v.id||v.name} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                          {/* Header row */}
                          <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                            <div style={{ width:44,height:44,borderRadius:12,background:vendorColor(v.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(v.name)}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ fontSize:15, fontWeight:600 }}>{v.name}</span>
                                {v.fromContact && <span style={{ fontSize:10, background:"#1A1A2E", color:"#C8B8FF", borderRadius:20, padding:"2px 7px" }}>Contact</span>}
                                {rule && <span style={{ fontSize:10, background:"#1A1A2E", color:"#C8B8FF", borderRadius:20, padding:"2px 7px" }}>⚡ {rule.gl_name}</span>}
                                {v.fromContact && <span onClick={e=>{e.stopPropagation();setContacts(prev=>prev.map(c=>c.id===v.id?{...c,is1099:!c.is1099}:c));logAudit("1099_flagged",`${v.name} 1099 flag toggled`);}} style={{ fontSize:10, background:v.is1099?"#F59E0B22":"#1E1E2E", color:v.is1099?"#F59E0B":"#6B6B8A", borderRadius:20, padding:"2px 7px", cursor:"pointer", border:`1px solid ${v.is1099?"#F59E0B44":"#2A2A3E"}` }}>{v.is1099?"1099 ✓":"+ 1099"}</span>}
                                {v.payment_terms && <span style={{ fontSize:10, background:"#0F0F13", color:"#9CA3AF", borderRadius:20, padding:"2px 7px", border:"1px solid #2A2A3E" }}>{v.payment_terms}</span>}
                                {(v.tags||[]).map(t=><span key={t} style={{ fontSize:10, background:"#1E1E2E", color:"#6B6B8A", borderRadius:20, padding:"2px 7px" }}>{t}</span>)}
                              </div>
                              <div style={{ fontSize:12, color:"#6B6B8A", marginTop:3 }}>
                                {v.ledger ? `${v.ledger.count} invoice${v.ledger.count!==1?"s":""} · last ${v.ledger.lastDate}` : "No invoices yet"}
                                {v.email && <span style={{ marginLeft:10 }}>✉ {v.email}</span>}
                                {v.phone && <span style={{ marginLeft:10 }}>📞 {v.phone}</span>}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                              {totalSpend>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>TOTAL SPEND</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(totalSpend)}</div>
                              </div>}
                              {openAP>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>OPEN AP</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#F59E0B" }}>{fmt(openAP)}</div>
                              </div>}
                              <button onClick={()=>isEditing?saveEdit(v):startEdit(v)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, background:isEditing?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"1px solid #2A2A3E", color:isEditing?"#6EE7B7":"#9CA3AF", cursor:"pointer" }}>
                                {isEditing?"Save":"Edit"}
                              </button>
                              {isEditing && <button onClick={()=>setEditingId(null)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>×</button>}
                            </div>
                          </div>

                          {/* Edit form */}
                          {isEditing && (
                            <div style={{ padding:"16px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                              {[
                                { key:"payment_terms", label:"Payment Terms", placeholder:"Net 30" },
                                { key:"email", label:"Email", placeholder:"billing@vendor.com" },
                                { key:"phone", label:"Phone", placeholder:"+1 555 000 0000" },
                                { key:"min_expected", label:"Min Expected ($)", placeholder:"500" },
                                { key:"max_expected", label:"Max Expected ($)", placeholder:"2000" },
                                { key:"tags", label:"Tags (comma-separated)", placeholder:"IT, recurring" },
                              ].map(f=>(
                                <div key={f.key}>
                                  <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>{f.label}</div>
                                  <input value={editDraft[f.key]||""} onChange={e=>setEditDraft(d=>({...d,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                    style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                                </div>
                              ))}
                              <div style={{ gridColumn:"1/-1" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>Notes</div>
                                <input value={editDraft.notes||""} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} placeholder="Any notes about this vendor..."
                                  style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                              </div>
                            </div>
                          )}

                          {/* Notes display */}
                          {!isEditing && v.notes && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#9CA3AF" }}>📝 {v.notes}</div>
                          )}
                          {!isEditing && (v.min_expected||v.max_expected) && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#6B6B8A" }}>
                              Expected range: <span style={{ color:"#C8B8FF" }}>{fmt(v.min_expected||0)} – {fmt(v.max_expected||0)}/invoice</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* CUSTOMERS */}
          {view==="customers" && (() => {
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const editingId = customersEditingId; const setEditingId = setCustomersEditingId;
            const editDraft = customersEditDraft; const setEditDraft = setCustomersEditDraft;

            const customerContacts = contacts.filter(c => c.type==="customer");
            // Also pull customers from ledger (revenue invoices) not yet in contacts
            const ledgerCustomers = [...new Set(invoices.filter(i=>glIsRevenue(i.gl_code)||i.type==="revenue").map(i=>i.vendor))];
            const ledgerOnlyCustomers = ledgerCustomers.filter(name =>
              !customerContacts.find(c => c.name?.toLowerCase()===name?.toLowerCase())
            );
            const allCustomers = [
              ...customerContacts.map(c => ({ ...c, fromContact:true })),
              ...ledgerOnlyCustomers.map(name => ({ id:name, name, type:"customer", fromContact:false })),
            ];

            const startEdit = (c) => { setEditingId(c.id||c.name); setEditDraft({ payment_terms:c.payment_terms||"", email:c.email||"", phone:c.phone||"", notes:c.notes||"", tags:(c.tags||[]).join(", "), min_expected:c.min_expected||"", max_expected:c.max_expected||"" }); };
            const saveEdit = (c) => {
              const updates = { ...editDraft, tags:editDraft.tags.split(",").map(t=>t.trim()).filter(Boolean), min_expected:parseFloat(editDraft.min_expected)||null, max_expected:parseFloat(editDraft.max_expected)||null };
              if (c.fromContact) {
                setContacts(prev => prev.map(x => x.id===c.id ? {...x,...updates} : x));
              } else {
                setContacts(prev => [{ id:Date.now()+Math.random(), name:c.name, type:"customer", ...updates, created_at:new Date().toISOString() }, ...prev]);
              }
              setEditingId(null);
            };

            return (
              <div>
                <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                  <div>
                    <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>CUSTOMER MANAGEMENT</div>
                    <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Customers</h1>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Or just tell the AI chat — "Add Metro Cafe as a customer, they're on Net 15"</div>
                  </div>
                  <button onClick={()=>setChatOpen(true)} style={{ padding:"9px 18px", borderRadius:10, fontSize:13, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>+ Add via Chat</button>
                </div>

                {allCustomers.length===0 ? (
                  <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>◉</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No customers yet</div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:20 }}>Customers appear when you upload revenue invoices, or tell the AI chat to add one.</div>
                    <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                  </div>
                ) : (
                  <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
                    {allCustomers.map(c => {
                      const isEditing = editingId===(c.id||c.name);
                      const custInvoices = invoices.filter(i => i.vendor?.toLowerCase()===c.name?.toLowerCase() && (glIsRevenue(i.gl_code)||i.type==="revenue"));
                      const totalRevenue = custInvoices.reduce((s,i)=>s+i.amount,0);
                      const openAR = custInvoices.filter(i=>i.payment_status!=="collected"&&i.payment_status!=="paid").reduce((s,i)=>s+i.amount,0);
                      const overdueAR = custInvoices.filter(i=>i.payment_status!=="collected"&&i.payment_status!=="paid"&&i.due_date&&i.due_date<new Date().toISOString().slice(0,10)).reduce((s,i)=>s+i.amount,0);
                      return (
                        <div key={c.id||c.name} style={{ background:"#14141A", border:`1px solid ${overdueAR>0?"#EF444433":"#1E1E2E"}`, borderRadius:14, overflow:"hidden" }}>
                          <div style={{ padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
                            <div style={{ width:44,height:44,borderRadius:12,background:vendorColor(c.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:15,fontWeight:700,color:"#fff",flexShrink:0 }}>{initials(c.name)}</div>
                            <div style={{ flex:1, minWidth:0 }}>
                              <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                                <span style={{ fontSize:15, fontWeight:600 }}>{c.name}</span>
                                {c.fromContact && <span style={{ fontSize:10, background:"#0A1A0A", color:"#10B981", borderRadius:20, padding:"2px 7px" }}>Contact</span>}
                                {c.payment_terms && <span style={{ fontSize:10, background:"#0F0F13", color:"#9CA3AF", borderRadius:20, padding:"2px 7px", border:"1px solid #2A2A3E" }}>{c.payment_terms}</span>}
                                {overdueAR>0 && <span style={{ fontSize:10, background:"#EF444422", color:"#EF4444", borderRadius:20, padding:"2px 7px" }}>Overdue</span>}
                                {(c.tags||[]).map(t=><span key={t} style={{ fontSize:10, background:"#1E1E2E", color:"#6B6B8A", borderRadius:20, padding:"2px 7px" }}>{t}</span>)}
                              </div>
                              <div style={{ fontSize:12, color:"#6B6B8A", marginTop:3 }}>
                                {custInvoices.length>0 ? `${custInvoices.length} invoice${custInvoices.length!==1?"s":""}` : "No invoices yet"}
                                {c.email && <span style={{ marginLeft:10 }}>✉ {c.email}</span>}
                                {c.phone && <span style={{ marginLeft:10 }}>📞 {c.phone}</span>}
                              </div>
                            </div>
                            <div style={{ display:"flex", gap:10, alignItems:"center", flexShrink:0 }}>
                              {totalRevenue>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>TOTAL REVENUE</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(totalRevenue)}</div>
                              </div>}
                              {openAR>0 && <div style={{ textAlign:"right" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A" }}>OPEN AR</div>
                                <div style={{ fontSize:16, fontWeight:700, fontFamily:"'DM Mono',monospace", color:overdueAR>0?"#EF4444":"#F59E0B" }}>{fmt(openAR)}</div>
                              </div>}
                              <button onClick={()=>isEditing?saveEdit(c):startEdit(c)} style={{ padding:"7px 14px", borderRadius:8, fontSize:12, background:isEditing?"linear-gradient(135deg,#065F46,#047857)":"#1E1E2E", border:"1px solid #2A2A3E", color:isEditing?"#6EE7B7":"#9CA3AF", cursor:"pointer" }}>
                                {isEditing?"Save":"Edit"}
                              </button>
                              {isEditing && <button onClick={()=>setEditingId(null)} style={{ padding:"7px 10px", borderRadius:8, fontSize:12, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>×</button>}
                            </div>
                          </div>
                          {isEditing && (
                            <div style={{ padding:"16px 20px", borderTop:"1px solid #1E1E2E", background:"#0F0F13", display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
                              {[
                                { key:"payment_terms", label:"Payment Terms", placeholder:"Net 15" },
                                { key:"email", label:"Email", placeholder:"billing@customer.com" },
                                { key:"phone", label:"Phone", placeholder:"+1 555 000 0000" },
                                { key:"min_expected", label:"Min Revenue ($)", placeholder:"1000" },
                                { key:"max_expected", label:"Max Revenue ($)", placeholder:"5000" },
                                { key:"tags", label:"Tags (comma-separated)", placeholder:"enterprise, monthly" },
                              ].map(f=>(
                                <div key={f.key}>
                                  <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>{f.label}</div>
                                  <input value={editDraft[f.key]||""} onChange={e=>setEditDraft(d=>({...d,[f.key]:e.target.value}))} placeholder={f.placeholder}
                                    style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                                </div>
                              ))}
                              <div style={{ gridColumn:"1/-1" }}>
                                <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:4 }}>Notes</div>
                                <input value={editDraft.notes||""} onChange={e=>setEditDraft(d=>({...d,notes:e.target.value}))} placeholder="Anything worth noting about this customer..."
                                  style={{ width:"100%", boxSizing:"border-box", background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 10px", color:"#E8E8F0", fontSize:12, outline:"none" }} />
                              </div>
                            </div>
                          )}
                          {!isEditing && c.notes && <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#9CA3AF" }}>📝 {c.notes}</div>}
                          {!isEditing && (c.min_expected||c.max_expected) && (
                            <div style={{ padding:"10px 20px", borderTop:"1px solid #1E1E2E", fontSize:12, color:"#6B6B8A" }}>
                              Expected revenue: <span style={{ color:"#10B981" }}>{fmt(c.min_expected||0)} – {fmt(c.max_expected||0)}/invoice</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* RULES */}
          {view==="rules" && (
            <div>
              <div style={{ marginBottom:28 }}>
                <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>AUTOMATION</div>
                <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Vendor Rules</h1>
                <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Rules auto-apply when invoices are uploaded. Create them by chatting with the AI assistant.</div>
              </div>
              {rules.length===0 ? (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:40, textAlign:"center" }}>
                  <div style={{ fontSize:32, marginBottom:12 }}>⚡</div>
                  <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No rules yet</div>
                  <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:20 }}>Tell the AI assistant things like "Always tag FedEx invoices to Shipping & Freight"</div>
                  <button onClick={()=>setChatOpen(true)} style={{ background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Open AI Assistant</button>
                </div>
              ) : (
                <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse" }}>
                    <thead>
                      <tr style={{ background:"#0F0F13" }}>
                        {["Vendor","GL Account","Project",""].map(h=>(
                          <th key={h} style={{ padding:"13px 20px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.5, fontWeight:500 }}>{h.toUpperCase()}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map((rule,i)=>(
                        <tr key={rule.vendor} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                          <td style={{ padding:"14px 20px" }}>
                            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                              <div style={{ width:30, height:30, borderRadius:8, background:vendorColor(rule.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, color:"#fff" }}>{initials(rule.vendor)}</div>
                              <span style={{ fontSize:14, fontWeight:500 }}>{rule.vendor}</span>
                            </div>
                          </td>
                          <td style={{ padding:"14px 20px" }}><span style={{ background:"#1E1E2E", padding:"4px 12px", borderRadius:20, fontSize:12, color:"#C8B8FF" }}>{rule.gl_code} · {rule.gl_name}</span></td>
                          <td style={{ padding:"14px 20px", fontSize:13, color:"#9CA3AF" }}>{rule.project||"—"}</td>
                          <td style={{ padding:"14px 20px" }}>
                            <button onClick={()=>setRules(r=>r.filter(x=>x.vendor!==rule.vendor))} style={{ background:"none", border:"1px solid #2A2A3E", color:"#EF4444", borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer" }}>Remove</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* REPORTS */}
          {view==="reports" && (() => {
            // Date filter helper
            const filterByRange = (invList) => {
              if (reportRange === "all") return invList;
              const now = new Date();
              return invList.filter(inv => {
                if (!inv.date) return false;
                const d = new Date(inv.date);
                if (reportRange === "custom") return (!reportDateFrom || d >= new Date(reportDateFrom)) && (!reportDateTo || d <= new Date(reportDateTo));
                if (reportRange === "thismonth") return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
                if (reportRange === "lastmonth") { const lm=new Date(now.getFullYear(),now.getMonth()-1,1); return d.getMonth()===lm.getMonth()&&d.getFullYear()===lm.getFullYear(); }
                if (reportRange === "q1") return d.getMonth()<3 && d.getFullYear()===now.getFullYear();
                if (reportRange === "q2") return d.getMonth()>=3&&d.getMonth()<6&&d.getFullYear()===now.getFullYear();
                if (reportRange === "q3") return d.getMonth()>=6&&d.getMonth()<9&&d.getFullYear()===now.getFullYear();
                if (reportRange === "q4") return d.getMonth()>=9&&d.getFullYear()===now.getFullYear();
                if (reportRange === "ytd") return d.getFullYear()===now.getFullYear();
                return true;
              });
            };
            const filtered = filterByRange(invoices);
            // Strictly GL-code driven — balance sheet accounts never touch the P&L
            const revenue  = filtered.filter(i=>glIsRevenue(i.gl_code)).reduce((s,i)=>s+i.amount,0);
            const expenses = filtered.filter(i=>glIsExpense(i.gl_code)).reduce((s,i)=>s+i.amount,0);
            const net = revenue - expenses;

            // Group by GL for expense breakdown — expenses only (5xxx/6xxx)
            const byGL = {};
            filtered.filter(i=>glIsExpense(i.gl_code)).forEach(inv => {
              const k = `${inv.gl_code} · ${inv.gl_name}`;
              if (!byGL[k]) byGL[k] = { name: inv.gl_name, code: inv.gl_code, total:0, count:0 };
              byGL[k].total += inv.amount; byGL[k].count++;
            });
            const glRows = Object.values(byGL).sort((a,b)=>b.total-a.total);

            // Group by vendor — only P&L accounts (income statement items)
            const byVendor = {};
            filtered.filter(i=>glPLType(i.gl_code)).forEach(inv => {
              const v = inv.vendor||"Unknown";
              if (!byVendor[v]) byVendor[v] = { name:v, total:0, count:0 };
              byVendor[v].total += inv.amount; byVendor[v].count++;
            });
            const vendorRows = Object.values(byVendor).sort((a,b)=>b.total-a.total);

            // Cash flow by month — revenue = inflow (4xxx), expense = outflow (5xxx/6xxx)
            const byMonth = {};
            filtered.filter(i=>glPLType(i.gl_code)).forEach(inv => {
              if (!inv.date) return;
              const m = inv.date.slice(0,7);
              if (!byMonth[m]) byMonth[m] = { month:m, inflow:0, outflow:0 };
              if (glIsRevenue(inv.gl_code)) byMonth[m].inflow+=inv.amount;
              else byMonth[m].outflow+=inv.amount;
            });
            const cashRows = Object.values(byMonth).sort((a,b)=>a.month.localeCompare(b.month));

            // By project — only P&L accounts
            const byProject = {};
            filtered.filter(i=>glPLType(i.gl_code)).forEach(inv => {
              const p = inv.project||"General";
              if (!byProject[p]) byProject[p] = { name:p, expenses:0, revenue:0, count:0 };
              if (glIsExpense(inv.gl_code)) byProject[p].expenses+=inv.amount;
              else byProject[p].revenue+=inv.amount;
              byProject[p].count++;
            });
            const projectRows = Object.values(byProject).sort((a,b)=>b.expenses-a.expenses);

            const fmt = (n) => "$"+Math.abs(n).toLocaleString("en-US",{minimumFractionDigits:2});
            const rangeLabels = { all:"All Time", thismonth:"This Month", lastmonth:"Last Month", q1:"Q1", q2:"Q2", q3:"Q3", q4:"Q4", ytd:"Year to Date", custom:"Custom Range" };

            return (
              <div>
                <div style={{ marginBottom:24 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>REPORTING</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Reports</h1>
                </div>

                {/* Controls */}
                <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:24, alignItems:"center" }}>
                  {[["pl","P&L"],["vendor","By Vendor"],["gl","By Category"],["cashflow","Cash Flow"],["project","By Project"]].map(([id,label])=>(
                    <button key={id} onClick={()=>setReportType(id)} style={{ padding:"8px 16px", borderRadius:20, fontSize:13, background:reportType===id?"#C8B8FF":"transparent", border:`1px solid ${reportType===id?"#C8B8FF":"#2A2A3E"}`, color:reportType===id?"#0F0F13":"#6B6B8A", cursor:"pointer", fontWeight:reportType===id?600:400 }}>{label}</button>
                  ))}
                  <div style={{ flex:1 }} />
                  <select value={reportRange} onChange={e=>setReportRange(e.target.value)} style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"8px 12px", color:"#E8E8F0", fontSize:13, outline:"none", cursor:"pointer" }}>
                    {Object.entries(rangeLabels).map(([v,l])=><option key={v} value={v}>{l}</option>)}
                  </select>
                  {reportRange==="custom" && <>
                    <input type="date" value={reportDateFrom} onChange={e=>setReportDateFrom(e.target.value)} style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"7px 10px", color:"#E8E8F0", fontSize:13, outline:"none" }} />
                    <span style={{ color:"#6B6B8A", fontSize:13 }}>to</span>
                    <input type="date" value={reportDateTo} onChange={e=>setReportDateTo(e.target.value)} style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:8, padding:"7px 10px", color:"#E8E8F0", fontSize:13, outline:"none" }} />
                  </>}
                </div>

                {invoices.length===0 && <div style={{ color:"#6B6B8A", fontSize:14 }}>No data yet. Upload invoices or a bank statement to generate reports.</div>}

                {invoices.length>0 && (
                  <div>
                    {/* P&L */}
                    {reportType==="pl" && (
                      <div>
                        <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden", marginBottom:16 }}>
                          <div style={{ padding:"18px 24px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between" }}>
                            <div style={{ fontSize:14, fontWeight:600 }}>Profit & Loss Statement</div>
                            <div style={{ fontSize:12, color:"#6B6B8A" }}>{rangeLabels[reportRange]} · {filtered.length} transactions</div>
                          </div>
                          <div style={{ padding:"0 24px" }}>
                            {/* Revenue */}
                            <div style={{ padding:"16px 0", borderBottom:"1px solid #1E1E2E" }}>
                              <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:12 }}>REVENUE</div>
                              {filtered.filter(i=>glIsRevenue(i.gl_code)).length===0 ? <div style={{ fontSize:13, color:"#6B6B8A" }}>No revenue recorded</div> :
                                Object.entries(filtered.filter(i=>glIsRevenue(i.gl_code)).reduce((a,i)=>{ a[i.gl_name]=(a[i.gl_name]||0)+i.amount; return a; },{})).map(([name,amt])=>(
                                  <div key={name} style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                                    <span style={{ fontSize:13, color:"#C8C8D8", paddingLeft:12 }}>{name}</span>
                                    <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#10B981" }}>{fmt(amt)}</span>
                                  </div>
                                ))
                              }
                              <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid #1E1E2E" }}>
                                <span style={{ fontSize:13, fontWeight:600 }}>Total Revenue</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"#10B981" }}>{fmt(revenue)}</span>
                              </div>
                            </div>
                            {/* Expenses */}
                            <div style={{ padding:"16px 0", borderBottom:"1px solid #1E1E2E" }}>
                              <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:12 }}>EXPENSES</div>
                              {glRows.length===0 ? <div style={{ fontSize:13, color:"#6B6B8A" }}>No expenses recorded</div> :
                                glRows.map(row=>(
                                  <div key={row.code} style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                                    <span style={{ fontSize:13, color:"#C8C8D8", paddingLeft:12 }}>{row.name}</span>
                                    <span style={{ fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.total)})</span>
                                  </div>
                                ))
                              }
                              <div style={{ display:"flex", justifyContent:"space-between", marginTop:12, paddingTop:8, borderTop:"1px solid #1E1E2E" }}>
                                <span style={{ fontSize:13, fontWeight:600 }}>Total Expenses</span>
                                <span style={{ fontSize:14, fontFamily:"'DM Mono', monospace", fontWeight:600, color:"#EF4444" }}>({fmt(expenses)})</span>
                              </div>
                            </div>
                            {/* Net */}
                            <div style={{ padding:"18px 0", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                              <span style={{ fontSize:16, fontWeight:700 }}>Net {net>=0?"Income":"Loss"}</span>
                              <span style={{ fontSize:20, fontFamily:"'DM Mono', monospace", fontWeight:700, color:net>=0?"#10B981":"#EF4444" }}>{net<0?"-":""}{fmt(net)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* BY VENDOR */}
                    {reportType==="vendor" && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Expenses by Vendor</div>
                          <div style={{ fontSize:12, color:"#6B6B8A" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Vendor","Invoices","Total Spend","% of Total"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {vendorRows.map((v,i)=>(
                              <tr key={v.name} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                                    <div style={{ width:28, height:28, borderRadius:7, background:vendorColor(v.name), display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, fontWeight:700, color:"#fff" }}>{initials(v.name)}</div>
                                    <span style={{ fontSize:13, fontWeight:500 }}>{v.name}</span>
                                  </div>
                                </td>
                                <td style={{ padding:"13px 20px", fontSize:13, color:"#9CA3AF" }}>{v.count}</td>
                                <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#E8E8F0" }}>{fmt(v.total)}</td>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ height:6, width:80, background:"#1E1E2E", borderRadius:3 }}>
                                      <div style={{ height:"100%", width:`${Math.min(100,(v.total/(expenses||1))*100)}%`, background:vendorColor(v.name), borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:12, color:"#9CA3AF", fontFamily:"'DM Mono', monospace" }}>{expenses>0?((v.total/expenses)*100).toFixed(1):0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* BY GL CATEGORY */}
                    {reportType==="gl" && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Expenses by GL Category</div>
                          <div style={{ fontSize:12, color:"#6B6B8A" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["GL Account","Transactions","Amount","% of Expenses"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {glRows.map((row,i)=>(
                              <tr key={row.code} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                <td style={{ padding:"13px 20px" }}>
                                  <span style={{ background:"#1E1E2E", padding:"3px 10px", borderRadius:20, fontSize:12, color:"#C8B8FF" }}>{row.code} · {row.name}</span>
                                </td>
                                <td style={{ padding:"13px 20px", fontSize:13, color:"#9CA3AF" }}>{row.count}</td>
                                <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.total)})</td>
                                <td style={{ padding:"13px 20px" }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ height:6, width:80, background:"#1E1E2E", borderRadius:3 }}>
                                      <div style={{ height:"100%", width:`${Math.min(100,(row.total/(expenses||1))*100)}%`, background:"#C8B8FF", borderRadius:3 }} />
                                    </div>
                                    <span style={{ fontSize:12, color:"#9CA3AF", fontFamily:"'DM Mono', monospace" }}>{expenses>0?((row.total/expenses)*100).toFixed(1):0}%</span>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* CASH FLOW */}
                    {reportType==="cashflow" && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Cash Flow Summary</div>
                          <div style={{ fontSize:12, color:"#6B6B8A" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        {cashRows.length===0 ? <div style={{ padding:24, color:"#6B6B8A", fontSize:13 }}>No data for selected range.</div> : (
                          <table style={{ width:"100%", borderCollapse:"collapse" }}>
                            <thead><tr style={{ background:"#0F0F13" }}>
                              {["Month","Inflow","Outflow","Net","Running"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                            </tr></thead>
                            <tbody>
                              {cashRows.map((row,i)=>{
                                const net = row.inflow - row.outflow;
                                const running = cashRows.slice(0,i+1).reduce((s,r)=>s+(r.inflow-r.outflow),0);
                                return (
                                  <tr key={row.month} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontWeight:500 }}>{row.month}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#10B981" }}>{fmt(row.inflow)}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(row.outflow)})</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:net>=0?"#10B981":"#EF4444" }}>{net<0?"-":""}{fmt(net)}</td>
                                    <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:running>=0?"#E8E8F0":"#EF4444" }}>{running<0?"-":""}{fmt(running)}</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}

                    {/* BY PROJECT */}
                    {reportType==="project" && (
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                        <div style={{ padding:"18px 24px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between" }}>
                          <div style={{ fontSize:14, fontWeight:600 }}>Project Cost Breakdown</div>
                          <div style={{ fontSize:12, color:"#6B6B8A" }}>{rangeLabels[reportRange]}</div>
                        </div>
                        <table style={{ width:"100%", borderCollapse:"collapse" }}>
                          <thead><tr style={{ background:"#0F0F13" }}>
                            {["Project","Transactions","Revenue","Expenses","Net"].map(h=><th key={h} style={{ padding:"11px 20px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h.toUpperCase()}</th>)}
                          </tr></thead>
                          <tbody>
                            {projectRows.map((p,i)=>{
                              const pnet = p.revenue - p.expenses;
                              return (
                                <tr key={p.name} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontWeight:500, color:"#C8B8FF" }}>{p.name}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, color:"#9CA3AF" }}>{p.count}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#10B981" }}>{fmt(p.revenue)}</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:"#EF4444" }}>({fmt(p.expenses)})</td>
                                  <td style={{ padding:"13px 20px", fontSize:13, fontFamily:"'DM Mono', monospace", color:pnet>=0?"#10B981":"#EF4444" }}>{pnet<0?"-":""}{fmt(pnet)}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Ask AI button */}
                    <div style={{ marginTop:16, display:"flex", justifyContent:"flex-end" }}>
                      <button onClick={()=>{ setChatOpen(true); setChatInput(`Give me a detailed analysis of my ${reportType==="pl"?"profit and loss":reportType==="vendor"?"vendor spend":reportType==="gl"?"expense categories":reportType==="cashflow"?"cash flow":"project costs"} for ${rangeLabels[reportRange]}`); }} style={{ background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", borderRadius:10, padding:"10px 20px", fontSize:13, cursor:"pointer" }}>
                        ✦ Ask AI to analyze this report
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* MATCHING ENGINE */}
          {view==="matching" && (() => {
            const fmt = n => "$"+Math.abs(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const openPayables    = invoices.filter(i => i.type==="expense" && !i.matched && i.payment_status!=="paid" && !glIsBalSheet(i.gl_code));
            const openReceivables = invoices.filter(i => i.type==="revenue" && !i.matched && i.payment_status!=="collected" && !glIsBalSheet(i.gl_code));
            const partialItems = invoices.filter(i => i.payment_status==="partial");

            const matchTypeLabel = {
              ap_clear: { label:"AP Cleared", color:"#10B981", icon:"✓", desc:"Bank payment clears accrued expense" },
              ar_clear: { label:"AR Collected", color:"#0EA5E9", icon:"✓", desc:"Bank deposit clears receivable" },
              partial_ap: { label:"Partial Payment", color:"#F59E0B", icon:"½", desc:"Partial payment against invoice" },
              partial_ar: { label:"Partial Collection", color:"#F59E0B", icon:"½", desc:"Partial collection against receivable" },
            };

            return (
              <div>
                <div style={{ marginBottom:28 }}>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>RECONCILIATION</div>
                  <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Matching Engine</h1>
                  <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Bank transactions are automatically matched to open invoices and accruals. High-confidence matches are auto-cleared. Review ambiguous ones below.</div>
                </div>

                {/* Summary cards */}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
                  {[
                    { label:"Open Payables", value:openPayables.length, sub:fmt(openPayables.reduce((s,i)=>s+i.amount,0))+" outstanding", color:"#EF4444" },
                    { label:"Open Receivables", value:openReceivables.length, sub:fmt(openReceivables.reduce((s,i)=>s+i.amount,0))+" outstanding", color:"#10B981" },
                    { label:"Needs Review", value:matchQueue.length, sub:"matches awaiting confirmation", color:"#F59E0B" },
                    { label:"Cleared This Session", value:matchHistory.length, sub:fmt(matchHistory.reduce((s,m)=>s+(m.amount_matched||0),0))+" matched", color:"#C8B8FF" },
                  ].map(card=>(
                    <div key={card.label} style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:12, padding:"18px 20px" }}>
                      <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:1, marginBottom:8 }}>{card.label.toUpperCase()}</div>
                      <div style={{ fontSize:26, fontWeight:700, fontFamily:"'DM Mono',monospace", color:card.color }}>{card.value}</div>
                      <div style={{ fontSize:11, color:"#6B6B8A", marginTop:4 }}>{card.sub}</div>
                    </div>
                  ))}
                </div>

                {/* Match review queue */}
                {matchQueue.length > 0 && (
                  <div style={{ marginBottom:28 }}>
                    <div style={{ fontSize:11, color:"#F59E0B", letterSpacing:2, marginBottom:14, display:"flex", alignItems:"center", gap:8 }}>
                      <span>⚠ NEEDS REVIEW</span>
                      <span style={{ background:"#F59E0B22", border:"1px solid #F59E0B44", borderRadius:20, padding:"1px 10px", fontSize:11 }}>{matchQueue.length}</span>
                    </div>
                    <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                      {matchQueue.map(match => {
                        const mt = matchTypeLabel[match.match_type] || { label:match.match_type, color:"#6B6B8A", icon:"?", desc:"" };
                        return (
                          <div key={match.id} style={{ background:"#14141A", border:"1px solid #2A2A3E", borderRadius:14, overflow:"hidden" }}>
                            {/* Match header */}
                            <div style={{ padding:"16px 20px", borderBottom:"1px solid #1E1E2E", display:"flex", alignItems:"center", gap:14 }}>
                              <div style={{ width:38, height:38, borderRadius:10, background:mt.color+"22", border:`1px solid ${mt.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, flexShrink:0 }}>{mt.icon}</div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:3 }}>
                                  <span style={{ fontSize:14, fontWeight:600 }}>{match.bank_txn?.vendor || "Unknown"}</span>
                                  <span style={{ fontSize:11, background:mt.color+"22", color:mt.color, borderRadius:20, padding:"2px 8px" }}>{mt.label}</span>
                                  <span style={{ fontSize:11, background:"#1E1E2E", color:match.confidence>=80?"#10B981":"#F59E0B", borderRadius:20, padding:"2px 8px", fontFamily:"'DM Mono',monospace" }}>{match.confidence}% match</span>
                                </div>
                                <div style={{ fontSize:12, color:"#6B6B8A" }}>{match.bank_txn?.date} · {match.bank_txn?.description}</div>
                              </div>
                              <div style={{ textAlign:"right", flexShrink:0 }}>
                                <div style={{ fontSize:18, fontWeight:700, fontFamily:"'DM Mono',monospace", color:"#E8E8F0" }}>{fmt(match.amount_matched)}</div>
                                {match.amount_remaining > 0.01 && <div style={{ fontSize:11, color:"#F59E0B" }}>{fmt(match.amount_remaining)} remaining</div>}
                              </div>
                            </div>

                            {/* Matched invoice(s) */}
                            <div style={{ padding:"12px 20px", background:"#0A0A10", borderBottom:"1px solid #1E1E2E" }}>
                              <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:8 }}>MATCHING AGAINST</div>
                              {match.matched_invoices?.map(inv=>(
                                <div key={inv.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
                                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                    <div style={{ width:24, height:24, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                    <div>
                                      <div style={{ fontSize:12, fontWeight:500 }}>{inv.vendor}</div>
                                      <div style={{ fontSize:11, color:"#6B6B8A" }}>{inv.description} · {inv.date}</div>
                                    </div>
                                  </div>
                                  <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:inv.type==="revenue"?"#10B981":"#EF4444" }}>{fmt(inv.amount)}</div>
                                </div>
                              ))}
                            </div>

                            {/* AI reasoning */}
                            <div style={{ padding:"12px 20px", borderBottom:"1px solid #1E1E2E" }}>
                              <div style={{ fontSize:11, color:"#C8B8FF", marginBottom:4 }}>✦ WHY THIS MATCHES</div>
                              <div style={{ fontSize:12, color:"#9CA3AF", lineHeight:1.6 }}>{match.reasoning}</div>
                            </div>

                            {/* Clearing entry preview */}
                            {match.clearing_entry && (
                              <div style={{ padding:"12px 20px", background:"#0A1A0A", borderBottom:"1px solid #1E1E2E" }}>
                                <div style={{ fontSize:11, color:"#10B981", marginBottom:8 }}>CLEARING JOURNAL ENTRY</div>
                                <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 100px 100px", gap:8, fontSize:12 }}>
                                  <span style={{ color:"#C8B8FF", fontFamily:"'DM Mono',monospace" }}>{match.clearing_entry.debit_account_code}</span>
                                  <span style={{ color:"#C8C8D8" }}>{match.clearing_entry.debit_account_name}</span>
                                  <span style={{ color:"#10B981", textAlign:"right", fontFamily:"'DM Mono',monospace" }}>{fmt(match.clearing_entry.amount)}</span>
                                  <span style={{ color:"#6B6B8A", textAlign:"right" }}>—</span>
                                </div>
                                <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 100px 100px", gap:8, fontSize:12, marginTop:6 }}>
                                  <span style={{ color:"#C8B8FF", fontFamily:"'DM Mono',monospace" }}>{match.clearing_entry.credit_account_code}</span>
                                  <span style={{ color:"#C8C8D8", paddingLeft:16 }}>{match.clearing_entry.credit_account_name}</span>
                                  <span style={{ color:"#6B6B8A", textAlign:"right" }}>—</span>
                                  <span style={{ color:"#9CA3AF", textAlign:"right", fontFamily:"'DM Mono',monospace" }}>{fmt(match.clearing_entry.amount)}</span>
                                </div>
                              </div>
                            )}

                            {/* Actions */}
                            <div style={{ padding:"14px 20px", display:"flex", gap:10 }}>
                              <button onClick={()=>applyMatch(match)} style={{ flex:1, padding:"10px", borderRadius:10, fontSize:13, fontWeight:600, background:"linear-gradient(135deg,#065F46,#047857)", border:"none", color:"#6EE7B7", cursor:"pointer" }}>
                                ✓ Confirm Match & Post Entry
                              </button>
                              <button onClick={()=>dismissMatch(match.id)} style={{ padding:"10px 18px", borderRadius:10, fontSize:13, background:"transparent", border:"1px solid #2A2A3E", color:"#6B6B8A", cursor:"pointer" }}>
                                Dismiss
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Open Payables */}
                {openPayables.length > 0 && (
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:11, color:"#EF4444", letterSpacing:2, marginBottom:14 }}>OPEN PAYABLES — AWAITING PAYMENT</div>
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead><tr style={{ background:"#0F0F13" }}>
                          {["Vendor","Date","Description","GL Account","Amount","Status"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {openPayables.map((inv,i)=>(
                            <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                              <td style={{ padding:"12px 16px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                </div>
                              </td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date}</td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                              <td style={{ padding:"12px 16px" }}><span style={{ background:"#1E1E2E", padding:"2px 8px", borderRadius:20, fontSize:11, color:"#C8B8FF" }}>{inv.gl_code} · {inv.gl_name}</span></td>
                              <td style={{ padding:"12px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#EF4444" }}>{fmt(inv.balance_remaining || inv.amount)}</td>
                              <td style={{ padding:"12px 16px" }}>
                                <span style={{ fontSize:11, background:inv.payment_status==="partial"?"#1A1200":"#1A0A0A", border:`1px solid ${inv.payment_status==="partial"?"#F59E0B44":"#EF444444"}`, color:inv.payment_status==="partial"?"#F59E0B":"#EF4444", borderRadius:20, padding:"2px 10px" }}>
                                  {inv.payment_status==="partial"?"Partial":"Unpaid"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Open Receivables */}
                {openReceivables.length > 0 && (
                  <div style={{ marginBottom:24 }}>
                    <div style={{ fontSize:11, color:"#10B981", letterSpacing:2, marginBottom:14 }}>OPEN RECEIVABLES — AWAITING COLLECTION</div>
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                      <table style={{ width:"100%", borderCollapse:"collapse" }}>
                        <thead><tr style={{ background:"#0F0F13" }}>
                          {["Customer","Date","Description","Amount","Status"].map(h=><th key={h} style={{ padding:"10px 16px", textAlign:"left", fontSize:11, color:"#6B6B8A", letterSpacing:1.2, fontWeight:500 }}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {openReceivables.map((inv,i)=>(
                            <tr key={inv.id} style={{ borderTop:"1px solid #1E1E2E", background:i%2===0?"transparent":"#0A0A10" }}>
                              <td style={{ padding:"12px 16px" }}>
                                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                                  <div style={{ width:26, height:26, borderRadius:6, background:vendorColor(inv.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:9, fontWeight:700, color:"#fff" }}>{initials(inv.vendor)}</div>
                                  <span style={{ fontSize:13, fontWeight:500 }}>{inv.vendor}</span>
                                </div>
                              </td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF" }}>{inv.date}</td>
                              <td style={{ padding:"12px 16px", fontSize:12, color:"#9CA3AF", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{inv.description}</td>
                              <td style={{ padding:"12px 16px", fontSize:13, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(inv.balance_remaining || inv.amount)}</td>
                              <td style={{ padding:"12px 16px" }}>
                                <span style={{ fontSize:11, background:inv.payment_status==="partial"?"#1A1200":"#0A2A1A", border:`1px solid ${inv.payment_status==="partial"?"#F59E0B44":"#10B98144"}`, color:inv.payment_status==="partial"?"#F59E0B":"#10B981", borderRadius:20, padding:"2px 10px" }}>
                                  {inv.payment_status==="partial"?"Partial":"Outstanding"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Match history */}
                {matchHistory.length > 0 && (
                  <div>
                    <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:14 }}>CLEARED THIS SESSION</div>
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                      {matchHistory.map((m,i)=>{
                        const mt = matchTypeLabel[m.match_type] || { label:m.match_type, color:"#10B981", icon:"✓" };
                        return (
                          <div key={m.id} style={{ padding:"14px 20px", borderTop:i>0?"1px solid #1E1E2E":"none", display:"flex", alignItems:"center", gap:12 }}>
                            <div style={{ width:28, height:28, borderRadius:8, background:"#10B98122", border:"1px solid #10B98155", display:"flex", alignItems:"center", justifyContent:"center", fontSize:13 }}>✓</div>
                            <div style={{ flex:1 }}>
                              <div style={{ fontSize:13, fontWeight:500 }}>{m.bank_txn?.vendor} matched → {m.matched_invoices?.map(i=>i.vendor).join(", ")}</div>
                              <div style={{ fontSize:11, color:"#6B6B8A" }}>{mt.label} · {m.confidence}% confidence · {m.bank_txn?.date}</div>
                            </div>
                            <div style={{ fontSize:13, fontFamily:"'DM Mono',monospace", color:"#10B981" }}>{fmt(m.amount_matched)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {matchQueue.length===0 && openPayables.length===0 && openReceivables.length===0 && matchHistory.length===0 && (
                  <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:48, textAlign:"center" }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>⇋</div>
                    <div style={{ fontSize:15, fontWeight:500, marginBottom:8 }}>No open items to match</div>
                    <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:20 }}>Upload a bank statement to automatically match payments against open invoices and accruals.</div>
                    <button onClick={()=>setView("bank")} style={{ background:"linear-gradient(135deg,#6D28D9,#4C1D95)", border:"none", color:"#E8E8F0", borderRadius:10, padding:"10px 24px", fontSize:13, cursor:"pointer" }}>Go to Bank Feed →</button>
                  </div>
                )}
              </div>
            );
          })()}

          {/* CONTRACTS */}
          {view==="contracts" && (
            <div>
              {contractView==="list" && (
                <div>
                  <div style={{ marginBottom:24, display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
                    <div>
                      <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:8 }}>CONTRACTS & AGREEMENTS</div>
                      <h1 style={{ fontSize:28, fontWeight:600, margin:0, letterSpacing:-0.5 }}>Contracts</h1>
                      <div style={{ fontSize:13, color:"#6B6B8A", marginTop:6 }}>Upload any contract — loans, leases, subscriptions, revenue agreements. AI reads it and generates the correct journal entries automatically.</div>
                    </div>
                  </div>

                  {/* Upload zone */}
                  <div onDragOver={e=>{e.preventDefault();setContractDragOver(true);}} onDragLeave={()=>setContractDragOver(false)}
                    onDrop={e=>{e.preventDefault();setContractDragOver(false);handleContractFile(e.dataTransfer.files[0]);}}
                    onClick={()=>!contractProcessing&&document.getElementById("contract-upload").click()}
                    style={{ border:`2px dashed ${contractDragOver?"#C8B8FF":"#2A2A3E"}`, borderRadius:16, padding:contractProcessing?"36px":"44px 32px", textAlign:"center", cursor:contractProcessing?"default":"pointer", background:contractDragOver?"#1A1A2E":"#14141A", transition:"all 0.2s", marginBottom:24 }}>
                    {contractProcessing ? (
                      <div>
                        <div style={{ fontSize:13, color:"#C8B8FF", marginBottom:16 }}>⟳ Reading contract and generating journal entries...</div>
                        <div style={{ height:4, background:"#1E1E2E", borderRadius:2, overflow:"hidden", maxWidth:360, margin:"0 auto" }}>
                          <div style={{ height:"100%", background:"linear-gradient(90deg,#6D28D9,#C8B8FF)", borderRadius:2, width:"70%", animation:"pulse 1.5s ease-in-out infinite" }} />
                        </div>
                        <div style={{ fontSize:12, color:"#6B6B8A", marginTop:12 }}>This may take 15–20 seconds for complex contracts</div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
                        <div style={{ fontSize:16, fontWeight:500, marginBottom:8 }}>Drop a contract or agreement here</div>
                        <div style={{ fontSize:13, color:"#6B6B8A", marginBottom:16 }}>PDF or image · Loans · Leases · Revenue contracts · Subscriptions · Equipment financing · Service agreements</div>
                        <div style={{ display:"flex", justifyContent:"center", gap:8, flexWrap:"wrap" }}>
                          {Object.values(CONTRACT_TYPES).map(t=><span key={t.label} style={{ background:"#1E1E2E", border:"1px solid #2A2A3E", borderRadius:20, padding:"4px 12px", fontSize:11, color:"#9CA3AF" }}>{t.icon} {t.label}</span>)}
                        </div>
                      </div>
                    )}
                    <input id="contract-upload" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display:"none" }} onChange={e=>handleContractFile(e.target.files[0])} />
                  </div>

                  {/* Contract list */}
                  {contracts.length===0 ? null : (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))", gap:16 }}>
                      {contracts.map(c => {
                        const ct = CONTRACT_TYPES[c.contract_type] || { label:c.contract_type, color:"#6B6B8A", icon:"📄" };
                        const postedCount = c.posted_entries?.length||0;
                        const totalEntries = c.journal_entries?.length||0;
                        return (
                          <div key={c.id} onClick={()=>{ setSelectedContract(c); setContractView("detail"); }}
                            style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:22, cursor:"pointer", transition:"border-color 0.15s" }}
                            onMouseEnter={e=>e.currentTarget.style.borderColor=ct.color}
                            onMouseLeave={e=>e.currentTarget.style.borderColor="#1E1E2E"}>
                            <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:14 }}>
                              <div style={{ width:42, height:42, borderRadius:10, background:ct.color+"22", border:`1px solid ${ct.color}44`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, flexShrink:0 }}>{ct.icon}</div>
                              <div style={{ flex:1, minWidth:0 }}>
                                <div style={{ fontSize:11, color:ct.color, letterSpacing:1, marginBottom:4 }}>{ct.label.toUpperCase()}</div>
                                <div style={{ fontSize:14, fontWeight:600, lineHeight:1.3 }}>{c.counterparty}</div>
                                <div style={{ fontSize:12, color:"#6B6B8A", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{c.description}</div>
                              </div>
                            </div>
                            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
                              <div>
                                <div style={{ fontSize:10, color:"#6B6B8A", marginBottom:3 }}>TOTAL VALUE</div>
                                <div style={{ fontSize:16, fontWeight:600, fontFamily:"'DM Mono',monospace" }}>${(c.total_value||0).toLocaleString("en-US",{minimumFractionDigits:2})}</div>
                              </div>
                              <div>
                                <div style={{ fontSize:10, color:"#6B6B8A", marginBottom:3 }}>TERM</div>
                                <div style={{ fontSize:13, color:"#C8C8D8" }}>{c.start_date||"—"} → {c.end_date||"—"}</div>
                              </div>
                            </div>
                            {/* Entry progress bar */}
                            <div>
                              <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                                <span style={{ fontSize:11, color:"#6B6B8A" }}>Journal entries posted</span>
                                <span style={{ fontSize:11, color: postedCount===totalEntries&&totalEntries>0?"#10B981":"#9CA3AF", fontFamily:"'DM Mono',monospace" }}>{postedCount}/{totalEntries}</span>
                              </div>
                              <div style={{ height:4, background:"#1E1E2E", borderRadius:2 }}>
                                <div style={{ height:"100%", width:totalEntries>0?`${(postedCount/totalEntries)*100}%`:"0%", background:postedCount===totalEntries&&totalEntries>0?"#10B981":ct.color, borderRadius:2, transition:"width 0.4s" }} />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* CONTRACT DETAIL */}
              {contractView==="detail" && selectedContract && (() => {
                const ct = CONTRACT_TYPES[selectedContract.contract_type] || { label:selectedContract.contract_type, color:"#6B6B8A", icon:"📄" };
                const fmt = n => "$"+(n||0).toLocaleString("en-US",{minimumFractionDigits:2});
                return (
                  <div>
                    <button onClick={()=>setContractView("list")} style={{ background:"none", border:"none", color:"#6B6B8A", cursor:"pointer", fontSize:14, marginBottom:24, padding:0 }}>← Back to contracts</button>

                    {/* Header */}
                    <div style={{ display:"flex", alignItems:"center", gap:16, marginBottom:28 }}>
                      <div style={{ width:52, height:52, borderRadius:14, background:ct.color+"22", border:`1px solid ${ct.color}55`, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>{ct.icon}</div>
                      <div>
                        <div style={{ fontSize:11, color:ct.color, letterSpacing:2, marginBottom:4 }}>{ct.label.toUpperCase()}</div>
                        <h1 style={{ fontSize:24, fontWeight:600, margin:0 }}>{selectedContract.counterparty}</h1>
                        <div style={{ fontSize:13, color:"#6B6B8A", marginTop:2 }}>{selectedContract.description}</div>
                      </div>
                      <div style={{ marginLeft:"auto" }}>
                        <button onClick={()=>postAllContractEntries(selectedContract)}
                          disabled={(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)}
                          style={{ padding:"10px 20px", borderRadius:10, fontSize:13, fontWeight:600, background:(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"#1E1E2E":"linear-gradient(135deg,#065F46,#047857)", border:"none", color:(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"#6B6B8A":"#6EE7B7", cursor:(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"not-allowed":"pointer" }}>
                          {(selectedContract.posted_entries?.length||0)>=(selectedContract.journal_entries?.length||0)?"✓ All Posted":"Post All Entries"}
                        </button>
                      </div>
                    </div>

                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:24 }}>
                      {/* Key terms */}
                      <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, padding:22 }}>
                        <div style={{ fontSize:11, color:"#6B6B8A", letterSpacing:2, marginBottom:16 }}>CONTRACT TERMS</div>
                        {[
                          ["Total Value", fmt(selectedContract.total_value)],
                          ["Payment", `${fmt(selectedContract.payment_amount)} / ${selectedContract.payment_frequency||"—"}`],
                          ["Start Date", selectedContract.start_date||"—"],
                          ["End Date", selectedContract.end_date||"—"],
                          ["Interest Rate", selectedContract.interest_rate ? `${(selectedContract.interest_rate*100).toFixed(2)}%` : "N/A"],
                          ["File", selectedContract.file_name],
                        ].map(([l,v])=>(
                          <div key={l} style={{ display:"flex", justifyContent:"space-between", padding:"9px 0", borderBottom:"1px solid #1E1E2E" }}>
                            <span style={{ fontSize:12, color:"#6B6B8A" }}>{l}</span>
                            <span style={{ fontSize:13, color:"#E8E8F0", fontWeight:500, textAlign:"right", maxWidth:"55%" }}>{v}</span>
                          </div>
                        ))}
                        {selectedContract.key_terms?.length>0 && (
                          <div style={{ marginTop:14 }}>
                            <div style={{ fontSize:11, color:"#6B6B8A", marginBottom:8 }}>KEY TERMS</div>
                            {selectedContract.key_terms.map((t,i)=>(
                              <div key={i} style={{ fontSize:12, color:"#9CA3AF", padding:"4px 0", borderBottom:"1px solid #1E1E2E11" }}>· {t}</div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Accounting treatment */}
                      <div style={{ background:"#0A0A14", border:`1px solid ${ct.color}44`, borderRadius:14, padding:22 }}>
                        <div style={{ fontSize:11, color:ct.color, letterSpacing:2, marginBottom:12 }}>✦ AI ACCOUNTING TREATMENT</div>
                        <div style={{ fontSize:13, color:"#C8C8D8", lineHeight:1.8 }}>{selectedContract.accounting_treatment}</div>
                      </div>
                    </div>

                    {/* Journal entry schedule */}
                    <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:14, overflow:"hidden" }}>
                      <div style={{ padding:"16px 22px", borderBottom:"1px solid #1E1E2E", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                        <div>
                          <div style={{ fontSize:14, fontWeight:600 }}>Journal Entry Schedule</div>
                          <div style={{ fontSize:12, color:"#6B6B8A", marginTop:2 }}>{selectedContract.journal_entries?.length||0} entries generated · {selectedContract.posted_entries?.length||0} posted to ledger</div>
                        </div>
                      </div>
                      {(selectedContract.journal_entries||[]).map((entry, idx) => {
                        const isPosted = selectedContract.posted_entries?.includes(idx);
                        return (
                          <div key={idx} style={{ borderBottom:"1px solid #1E1E2E", background:isPosted?"#0A1A0A":idx%2===0?"transparent":"#0A0A10" }}>
                            <div style={{ padding:"14px 22px", display:"flex", alignItems:"center", gap:14 }}>
                              <div style={{ flexShrink:0 }}>
                                {isPosted
                                  ? <div style={{ width:28, height:28, borderRadius:8, background:"#10B98122", border:"1px solid #10B98155", display:"flex", alignItems:"center", justifyContent:"center", fontSize:14 }}>✓</div>
                                  : <div style={{ width:28, height:28, borderRadius:8, background:"#1E1E2E", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, color:"#6B6B8A", fontFamily:"'DM Mono',monospace" }}>{idx+1}</div>
                                }
                              </div>
                              <div style={{ flex:1 }}>
                                <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:2 }}>
                                  <span style={{ fontSize:13, fontWeight:600 }}>{entry.description}</span>
                                  <span style={{ fontSize:11, color:"#6B6B8A", fontFamily:"'DM Mono',monospace" }}>{entry.date}</span>
                                </div>
                                <div style={{ fontSize:12, color:"#6B6B8A" }}>{entry.memo}</div>
                                {/* Entry lines */}
                                <div style={{ marginTop:10, background:"#0F0F13", borderRadius:8, padding:"10px 14px" }}>
                                  {entry.lines?.map((line,li)=>(
                                    <div key={li} style={{ display:"grid", gridTemplateColumns:"80px 1fr 120px 120px", gap:8, marginBottom:li<entry.lines.length-1?6:0, alignItems:"center" }}>
                                      <span style={{ fontSize:11, color:"#C8B8FF", fontFamily:"'DM Mono',monospace" }}>{line.account_code}</span>
                                      <span style={{ fontSize:12, color:"#C8C8D8" }}>{line.account_name}</span>
                                      <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:"#10B981", textAlign:"right" }}>{line.debit>0?fmt(line.debit):""}</span>
                                      <span style={{ fontSize:12, fontFamily:"'DM Mono',monospace", color:"#9CA3AF", textAlign:"right" }}>{line.credit>0?fmt(line.credit):""}</span>
                                    </div>
                                  ))}
                                  <div style={{ display:"grid", gridTemplateColumns:"80px 1fr 120px 120px", gap:8, marginTop:8, paddingTop:8, borderTop:"1px solid #1E1E2E" }}>
                                    <span /><span style={{ fontSize:11, color:"#6B6B8A" }}>TOTALS</span>
                                    <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:"#10B981", textAlign:"right" }}>{fmt(entry.lines?.reduce((s,l)=>s+(l.debit||0),0))}</span>
                                    <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:"#9CA3AF", textAlign:"right" }}>{fmt(entry.lines?.reduce((s,l)=>s+(l.credit||0),0))}</span>
                                  </div>
                                </div>
                              </div>
                              <div style={{ flexShrink:0 }}>
                                {isPosted
                                  ? <span style={{ fontSize:11, color:"#10B981" }}>Posted</span>
                                  : <button onClick={e=>{e.stopPropagation();postContractEntry(selectedContract,idx);}} style={{ padding:"6px 14px", borderRadius:8, fontSize:12, background:"#1E1E2E", border:"1px solid #3B3B5E", color:"#C8B8FF", cursor:"pointer" }}>Post</button>
                                }
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* DETAIL */}
          {view==="detail" && selectedInvoice && (
            <div style={{ maxWidth:580 }}>
              <button onClick={()=>setView("invoices")} style={{ background:"none", border:"none", color:"#6B6B8A", cursor:"pointer", fontSize:14, marginBottom:24, padding:0 }}>← Back to invoices</button>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:28 }}>
                <div style={{ width:48, height:48, borderRadius:12, background:vendorColor(selectedInvoice.vendor), display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:700, color:"#fff" }}>{initials(selectedInvoice.vendor)}</div>
                <div>
                  <div style={{ fontSize:10, letterSpacing:3, color:"#6B6B8A", marginBottom:4 }}>INVOICE DETAIL</div>
                  <h1 style={{ fontSize:24, fontWeight:600, margin:0 }}>{selectedInvoice.vendor}</h1>
                </div>
              </div>
              <div style={{ background:"#14141A", border:"1px solid #1E1E2E", borderRadius:16, padding:28 }}>
                {[
                  ["Vendor", selectedInvoice.vendor],
                  ["Description", selectedInvoice.description],
                  ["Date", selectedInvoice.date],
                  ["Type", selectedInvoice.type],
                  ["Project", selectedInvoice.project||"General"],
                  ["Amount", `$${selectedInvoice.amount.toLocaleString("en-US",{minimumFractionDigits:2})}`],
                  ["GL Account", `${selectedInvoice.gl_code} — ${selectedInvoice.gl_name}`],
                  ["Offset Account", `${selectedInvoice.secondary_gl_code} — ${selectedInvoice.secondary_gl_name}`],
                  ["AI Confidence", `${selectedInvoice.confidence}%`],
                ].map(([label,value])=>(
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"12px 0", borderBottom:"1px solid #1E1E2E" }}>
                    <span style={{ fontSize:12, color:label==="Vendor"?"#C8B8FF":"#6B6B8A", letterSpacing:0.5, fontWeight:label==="Vendor"?600:400 }}>{label}</span>
                    <span style={{ fontSize:14, color:"#E8E8F0", fontWeight:label==="Vendor"?600:500, textAlign:"right", maxWidth:"60%" }}>{value}</span>
                  </div>
                ))}
                {selectedInvoice.reasoning && (
                  <div style={{ marginTop:20, padding:16, background:"#0A0A14", borderRadius:10, border:"1px solid #1E1E2E" }}>
                    <div style={{ fontSize:11, color:"#C8B8FF", marginBottom:8, letterSpacing:1 }}>AI REASONING</div>
                    <div style={{ fontSize:13, color:"#9CA3AF", lineHeight:1.7 }}>{selectedInvoice.reasoning}</div>
                  </div>
                )}
                <button onClick={()=>{ setVendorFilter(selectedInvoice.vendor); setView("invoices"); }} style={{ marginTop:20, background:"none", border:"1px solid #2A2A3E", borderRadius:8, padding:"10px 16px", color:"#C8B8FF", fontSize:13, cursor:"pointer", width:"100%" }}>
                  View all invoices for {selectedInvoice.vendor} →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>


    
          {/* ── SETTINGS ─────────────────────────────────────────────────────── */}
          {view==="settings" && (() => {
            const draft = settingsDraft || companySettings; const setDraft = setSettingsDraft;
            const saved = settingsSaved; const setSaved = setSettingsSaved;
            const logoPreview = settingsLogoPreview ?? companySettings.logoBase64; const setLogoPreview = setSettingsLogoPreview;
            const save = () => {
              setCompanySettings(draft);
              logAudit("settings_saved", `Company settings updated: ${draft.name}`);
              setSaved(true); setTimeout(()=>setSaved(false), 2000);
            };
            const handleLogo = (file) => {
              const r = new FileReader();
              r.onload = e => { const b64 = e.target.result; setLogoPreview(b64); setDraft(d=>({...d, logoBase64:b64})); };
              r.readAsDataURL(file);
            };
            const inp = (k,l,p,type="text") => (
              <div>
                <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>{l}</div>
                <input type={type} value={draft[k]||""} onChange={e=>setDraft(d=>({...d,[k]:e.target.value}))} placeholder={p}
                  style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"9px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
              </div>
            );
            return (
              <div style={{maxWidth:720}}>
                <div style={{marginBottom:28}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>CONFIGURATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Settings</h1>
                </div>

                {/* Company identity */}
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:24,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#C8B8FF",letterSpacing:0.5,marginBottom:16}}>COMPANY</div>
                  <div style={{display:"flex",gap:16,marginBottom:16,alignItems:"flex-start"}}>
                    {/* Logo */}
                    <div style={{flexShrink:0}}>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:6}}>LOGO</div>
                      <div onClick={()=>{const i=document.createElement("input");i.type="file";i.accept="image/*";i.onchange=e=>handleLogo(e.target.files[0]);i.click();}}
                        style={{width:80,height:80,borderRadius:12,border:"2px dashed #2A2A3E",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",overflow:"hidden",background:"#0F0F13"}}>
                        {logoPreview ? <img src={logoPreview} style={{width:"100%",height:"100%",objectFit:"contain"}} alt="logo"/> : <span style={{fontSize:24}}>🏢</span>}
                      </div>
                    </div>
                    <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                      {inp("name","Company Name","Acme Corp")}
                      {inp("taxId","EIN / Tax ID","XX-XXXXXXX")}
                    </div>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:12}}>
                    {inp("address","Street Address","123 Main St")}
                    {inp("city","City","Austin")}
                    {inp("state","State","TX")}
                    {inp("zip","ZIP","78701")}
                  </div>
                </div>

                {/* Accounting settings */}
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:24,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#C8B8FF",letterSpacing:0.5,marginBottom:16}}>ACCOUNTING</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
                    <div>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>FISCAL YEAR END</div>
                      <select value={draft.fiscalYearEnd} onChange={e=>setDraft(d=>({...d,fiscalYearEnd:e.target.value}))}
                        style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"9px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}>
                        {[["12-31","December 31"],["03-31","March 31"],["06-30","June 30"],["09-30","September 30"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>DEFAULT CASH ACCOUNT</div>
                      <select value={draft.defaultCashAccount} onChange={e=>setDraft(d=>({...d,defaultCashAccount:e.target.value}))}
                        style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"9px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}>
                        {CHART_OF_ACCOUNTS.filter(a=>a.category==="Assets").map(a=><option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>CURRENCY</div>
                      <select value={draft.currency||"USD"} onChange={e=>setDraft(d=>({...d,currency:e.target.value}))}
                        style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"9px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}>
                        {["USD","EUR","GBP","CAD","AUD"].map(c=><option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Bank accounts */}
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:24,marginBottom:16}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#C8B8FF",letterSpacing:0.5,marginBottom:16}}>BANK ACCOUNTS</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:14}}>
                    {bankAccounts.map(ba=>(
                      <div key={ba.id} style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr auto",gap:10,alignItems:"center"}}>
                        <input value={ba.name} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,name:e.target.value}:b))}
                          placeholder="Account name" style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}/>
                        <select value={ba.type} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,type:e.target.value}:b))}
                          style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}>
                          {["checking","savings","credit_card","loan","other"].map(t=><option key={t} value={t}>{t.replace("_"," ")}</option>)}
                        </select>
                        <select value={ba.gl_code} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,gl_code:e.target.value}:b))}
                          style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}>
                          {CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities"].includes(a.category)).map(a=><option key={a.code} value={a.code}>{a.code}</option>)}
                        </select>
                        <input value={ba.institution||""} onChange={e=>setBankAccounts(prev=>prev.map(b=>b.id===ba.id?{...b,institution:e.target.value}:b))}
                          placeholder="Bank name" style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}/>
                        <button onClick={()=>setBankAccounts(prev=>prev.filter(b=>b.id!==ba.id))} style={{background:"transparent",border:"1px solid #2A2A3E",borderRadius:7,padding:"7px 10px",color:"#EF4444",cursor:"pointer",fontSize:13}}>×</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={()=>setBankAccounts(prev=>[...prev,{id:Date.now()+Math.random(),name:"",type:"checking",gl_code:"1000",institution:""}])}
                    style={{fontSize:12,background:"transparent",border:"1px dashed #2A2A3E",borderRadius:8,padding:"7px 16px",color:"#9CA3AF",cursor:"pointer"}}>+ Add Bank Account</button>
                </div>

                <button onClick={save} style={{padding:"11px 32px",borderRadius:10,fontSize:14,fontWeight:600,background:saved?"linear-gradient(135deg,#065F46,#047857)":"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:saved?"#6EE7B7":"#E8E8F0",cursor:"pointer",transition:"all 0.3s"}}>
                  {saved ? "✓ Saved" : "Save Settings"}
                </button>
              </div>
            );
          })()}

          {/* ── CHART OF ACCOUNTS ─────────────────────────────────────────────── */}
          {view==="coa" && (() => {
            const editingCode = coaEditingCode; const setEditingCode = setCoaEditingCode;
            const editDraft = coaEditDraft; const setEditDraft = setCoaEditDraft;
            const addDraft = coaAddDraft; const setAddDraft = setCoaAddDraft;
            const showAdd = coaShowAdd; const setShowAdd = setCoaShowAdd;
            const categories = ["Assets","Liabilities","Equity","Revenue","Expenses"];
            const grouped = categories.map(cat => ({cat, accounts: customCOA.filter(a=>a.category===cat)}));

            const saveEdit = (code) => {
              setCustomCOA(prev => prev.map(a => a.code===code ? {...a,...editDraft} : a));
              logAudit("coa_edited", `Account ${code} updated: ${editDraft.name}`);
              setEditingCode(null);
            };
            const addAccount = () => {
              if (!addDraft.code || !addDraft.name) return;
              if (customCOA.find(a=>a.code===addDraft.code)) { showNotification("Account code already exists.","error"); return; }
              setCustomCOA(prev => [...prev, {...addDraft, active:true}].sort((a,b)=>a.code.localeCompare(b.code)));
              logAudit("coa_added", `Account added: ${addDraft.code} – ${addDraft.name}`);
              setAddDraft({code:"",name:"",category:"Expenses"});
              setShowAdd(false);
              showNotification(`Account ${addDraft.code} added ✓`);
            };
            const toggleActive = (code) => {
              setCustomCOA(prev => prev.map(a => a.code===code ? {...a, active:a.active===false?true:false} : a));
              logAudit("coa_toggled", `Account ${code} toggled`);
            };

            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>CONFIGURATION</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Chart of Accounts</h1>
                    <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Customize your account structure. Deactivated accounts won't appear in dropdowns but won't delete historical data.</div>
                  </div>
                  <button onClick={()=>setShowAdd(v=>!v)} style={{padding:"9px 20px",borderRadius:10,fontSize:13,fontWeight:500,background:"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:"pointer"}}>+ Add Account</button>
                </div>

                {showAdd && (
                  <div style={{background:"#14141A",border:"1px solid #C8B8FF33",borderRadius:12,padding:20,marginBottom:20}}>
                    <div style={{fontSize:12,color:"#C8B8FF",fontWeight:600,marginBottom:14,letterSpacing:0.5}}>NEW ACCOUNT</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 2fr 1fr auto",gap:12,alignItems:"flex-end"}}>
                      <div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>CODE</div>
                        <input value={addDraft.code} onChange={e=>setAddDraft(d=>({...d,code:e.target.value}))} placeholder="e.g. 5950"
                          style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>NAME</div>
                        <input value={addDraft.name} onChange={e=>setAddDraft(d=>({...d,name:e.target.value}))} placeholder="e.g. Research & Development"
                          style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                      </div>
                      <div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>CATEGORY</div>
                        <select value={addDraft.category} onChange={e=>setAddDraft(d=>({...d,category:e.target.value}))}
                          style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:13,outline:"none"}}>
                          {categories.map(c=><option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <button onClick={addAccount} style={{padding:"9px 20px",borderRadius:8,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:"pointer"}}>Add</button>
                    </div>
                  </div>
                )}

                {grouped.map(({cat, accounts}) => (
                  <div key={cat} style={{marginBottom:20}}>
                    <div style={{fontSize:11,color:"#6B6B8A",letterSpacing:2,marginBottom:10,paddingLeft:4}}>{cat.toUpperCase()} — {accounts.length} accounts</div>
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <tbody>
                          {accounts.map((acct,i) => {
                            const isEditing = editingCode===acct.code;
                            const isInactive = acct.active===false;
                            return (
                              <tr key={acct.code} style={{borderTop:i>0?"1px solid #1E1E2E":"none",background:isInactive?"#0A0A0A":i%2===0?"transparent":"#0A0A10",opacity:isInactive?0.5:1}}>
                                <td style={{padding:"11px 16px",width:80}}>
                                  {isEditing
                                    ? <input value={editDraft.code||acct.code} onChange={e=>setEditDraft(d=>({...d,code:e.target.value}))}
                                        style={{width:64,background:"#0F0F13",border:"1px solid #6D28D9",borderRadius:6,padding:"4px 8px",color:"#E8E8F0",fontSize:12,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                                    : <span style={{fontFamily:"'DM Mono',monospace",fontSize:12,color:"#9CA3AF"}}>{acct.code}</span>}
                                </td>
                                <td style={{padding:"11px 16px",flex:1}}>
                                  {isEditing
                                    ? <input value={editDraft.name||acct.name} onChange={e=>setEditDraft(d=>({...d,name:e.target.value}))}
                                        style={{width:"100%",background:"#0F0F13",border:"1px solid #6D28D9",borderRadius:6,padding:"4px 8px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                                    : <span style={{fontSize:13,fontWeight:500,color:isInactive?"#6B6B8A":"#E8E8F0"}}>{acct.name}</span>}
                                </td>
                                <td style={{padding:"11px 16px",width:120}}>
                                  <span style={{fontSize:11,background:"#1E1E2E",color:"#9CA3AF",borderRadius:20,padding:"2px 9px"}}>{acct.category}</span>
                                </td>
                                <td style={{padding:"11px 16px",width:160}}>
                                  <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                                    {isEditing ? (
                                      <>
                                        <button onClick={()=>saveEdit(acct.code)} style={{padding:"4px 12px",borderRadius:7,fontSize:11,fontWeight:600,background:"linear-gradient(135deg,#065F46,#047857)",border:"none",color:"#6EE7B7",cursor:"pointer"}}>Save</button>
                                        <button onClick={()=>setEditingCode(null)} style={{padding:"4px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #2A2A3E",color:"#6B6B8A",cursor:"pointer"}}>×</button>
                                      </>
                                    ) : (
                                      <>
                                        <button onClick={()=>{setEditingCode(acct.code);setEditDraft({code:acct.code,name:acct.name});}} style={{padding:"4px 12px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #2A2A3E",color:"#9CA3AF",cursor:"pointer"}}>Edit</button>
                                        <button onClick={()=>toggleActive(acct.code)} style={{padding:"4px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #2A2A3E",color:isInactive?"#10B981":"#EF4444",cursor:"pointer"}}>{isInactive?"Enable":"Disable"}</button>
                                      </>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ── OPENING BALANCES ──────────────────────────────────────────────── */}
          {view==="opening-balances" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const asOfDate = openingBalAsOfDate; const setAsOfDate = setOpeningBalAsOfDate;
            const balancesInit = (() => {
              const existing = {};
              openingBalances.forEach(b => { existing[b.account_code] = b.balance; });
              return CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category)).reduce((acc,a) => ({...acc,[a.code]: existing[a.code]||""}), {});
            })();
            const balances = Object.keys(openingBalBalances).length > 0 ? openingBalBalances : balancesInit;
            const setBalances = setOpeningBalBalances;
            const totalAssets = CHART_OF_ACCOUNTS.filter(a=>a.category==="Assets").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalLiab = CHART_OF_ACCOUNTS.filter(a=>a.category==="Liabilities").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const totalEquity = CHART_OF_ACCOUNTS.filter(a=>a.category==="Equity").reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0);
            const isBalanced = Math.abs(totalAssets - totalLiab - totalEquity) < 0.01;

            const post = () => {
              const entries = CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category))
                .filter(a => parseFloat(balances[a.code])||0 !== 0)
                .map(a => ({
                  id: Date.now()+Math.random(), vendor:"Opening Balance", description:`Opening balance – ${a.name}`,
                  amount: Math.abs(parseFloat(balances[a.code])||0), date: asOfDate, type:"opening",
                  gl_code: a.code, gl_name: a.name, secondary_gl_code:"3100", secondary_gl_name:"Retained Earnings",
                  debit_credit: a.category==="Assets"?"debit":"credit",
                  confidence:100, reasoning:"Opening balance entry", status:"booked",
                  booked_at: new Date().toISOString(), source:"opening_balance", payment_status:"paid"
                }));
              setInvoices(prev => [...entries, ...prev.filter(i=>i.source!=="opening_balance")]);
              const obRecords = CHART_OF_ACCOUNTS.filter(a=>["Assets","Liabilities","Equity"].includes(a.category))
                .filter(a=>parseFloat(balances[a.code])||0)
                .map(a=>({account_code:a.code,account_name:a.name,balance:parseFloat(balances[a.code]),as_of_date:asOfDate,posted:true}));
              setOpeningBalances(obRecords);
              logAudit("opening_balances_posted",`Opening balances posted as of ${asOfDate}: Assets ${fmt(totalAssets)}, Liabilities ${fmt(totalLiab)}, Equity ${fmt(totalEquity)}`);
              showNotification(`Opening balances posted as of ${asOfDate} ✓`);
            };

            return (
              <div style={{maxWidth:680}}>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>SETUP</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Opening Balances</h1>
                  <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Enter your account balances as of the date you're starting your books. This sets the baseline for all reports.</div>
                </div>

                {/* As-of date */}
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:16}}>
                  <div style={{fontSize:13,color:"#9CA3AF",flexShrink:0}}>As of date:</div>
                  <input type="date" value={asOfDate} onChange={e=>setAsOfDate(e.target.value)}
                    style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"7px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                  <div style={{marginLeft:"auto",fontSize:12,color:isBalanced?"#10B981":"#EF4444",fontWeight:500}}>
                    {isBalanced ? "✓ Balanced" : `Out of balance by ${fmt(Math.abs(totalAssets-totalLiab-totalEquity))}`}
                  </div>
                </div>

                {/* Balance sheet input by category */}
                {["Assets","Liabilities","Equity"].map(cat => (
                  <div key={cat} style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,overflow:"hidden",marginBottom:12}}>
                    <div style={{padding:"12px 20px",background:"#0F0F13",borderBottom:"1px solid #1E1E2E",display:"flex",justifyContent:"space-between"}}>
                      <div style={{fontSize:12,fontWeight:600,color:"#C8B8FF",letterSpacing:0.5}}>{cat.toUpperCase()}</div>
                      <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:700,color:"#E8E8F0"}}>
                        {fmt(CHART_OF_ACCOUNTS.filter(a=>a.category===cat).reduce((s,a)=>s+(parseFloat(balances[a.code])||0),0))}
                      </div>
                    </div>
                    {CHART_OF_ACCOUNTS.filter(a=>a.category===cat).map((acct,i)=>(
                      <div key={acct.code} style={{display:"flex",alignItems:"center",padding:"10px 20px",borderTop:i>0?"1px solid #1E1E2E":"none"}}>
                        <div style={{flex:1}}>
                          <span style={{fontFamily:"'DM Mono',monospace",fontSize:11,color:"#6B6B8A",marginRight:10}}>{acct.code}</span>
                          <span style={{fontSize:13}}>{acct.name}</span>
                        </div>
                        <input type="number" value={balances[acct.code]||""} onChange={e=>setBalances(b=>({...b,[acct.code]:e.target.value}))}
                          placeholder="0.00" step="0.01"
                          style={{width:140,background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"7px 12px",color:"#E8E8F0",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",textAlign:"right"}}/>
                      </div>
                    ))}
                  </div>
                ))}

                {/* Summary */}
                <div style={{background:"#14141A",border:"1px solid #2A2A3E",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:16,textAlign:"center"}}>
                  {[["Total Assets",totalAssets,"#10B981"],["Total Liabilities",totalLiab,"#EF4444"],["Total Equity",totalEquity,"#C8B8FF"]].map(([l,v,c])=>(
                    <div key={l}>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>{l}</div>
                      <div style={{fontSize:18,fontWeight:700,fontFamily:"'DM Mono',monospace",color:c}}>{fmt(v)}</div>
                    </div>
                  ))}
                </div>

                <button onClick={post} disabled={!isBalanced} style={{padding:"11px 32px",borderRadius:10,fontSize:14,fontWeight:600,background:isBalanced?"linear-gradient(135deg,#6D28D9,#4C1D95)":"#1E1E2E",border:"none",color:isBalanced?"#E8E8F0":"#6B6B8A",cursor:isBalanced?"pointer":"not-allowed"}}>
                  Post Opening Balances
                </button>
              </div>
            );
          })()}

          {/* ── SEND INVOICE ──────────────────────────────────────────────────── */}
          {view==="send-invoice" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const nextNum = `INV-${String((sentInvoices.length+1)).padStart(4,"0")}`;
            const emptyLine = () => ({id:Date.now()+Math.random(),description:"",qty:1,rate:"",amount:0});
            const draft = sendInvoiceDraftState || sentInvoiceDraft || {
              invoice_number: nextNum, customer:"", customer_email:"",
              issue_date: new Date().toISOString().slice(0,10),
              due_date: "", notes:"", terms:"Net 30",
              line_items:[emptyLine()],
              status:"draft"
            };
            const setDraft = setSendInvoiceDraftState;
            const showPreview = sendInvoiceShowPreview; const setShowPreview = setSendInvoiceShowPreview;

            const updateLine = (id, field, val) => {
              setDraft(d => ({...d, line_items: d.line_items.map(l => {
                if (l.id!==id) return l;
                const updated = {...l, [field]:val};
                if (field==="qty"||field==="rate") updated.amount = (parseFloat(updated.qty)||0)*(parseFloat(updated.rate)||0);
                return updated;
              })}));
            };
            const subtotal = draft.line_items.reduce((s,l)=>s+(l.amount||0),0);
            const taxRate = 0; // user can add later when multi-currency/tax is built
            const total = subtotal * (1+taxRate);

            const saveDraft = () => {
              const inv = {...draft, id: draft.id||Date.now()+Math.random(), updated_at:new Date().toISOString()};
              if (!inv.created_at) inv.created_at = new Date().toISOString();
              setSentInvoices(prev => {
                const exists = prev.findIndex(i=>i.id===inv.id);
                if (exists>=0){const u=[...prev];u[exists]=inv;return u;}
                return [inv,...prev];
              });
              setSentInvoiceDraft(inv);
              logAudit("invoice_created",`Invoice ${inv.invoice_number} created for ${inv.customer} ${fmt(total)}`);
              showNotification(`Invoice ${inv.invoice_number} saved ✓`);
            };

            const downloadPDF = () => {
              // Build a clean HTML invoice and open print dialog
              const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${draft.invoice_number}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;color:#111;font-size:14px}
  .header{display:flex;justify-content:space-between;margin-bottom:40px}
  .company{font-size:22px;font-weight:700}
  .invoice-meta{text-align:right}
  .invoice-number{font-size:28px;font-weight:700;color:#6D28D9}
  table{width:100%;border-collapse:collapse;margin:24px 0}
  th{background:#f5f5f5;padding:10px 12px;text-align:left;font-size:12px;letter-spacing:1px;text-transform:uppercase}
  td{padding:10px 12px;border-bottom:1px solid #eee}
  .totals{margin-left:auto;width:280px;margin-top:16px}
  .total-row{display:flex;justify-content:space-between;padding:6px 0}
  .grand-total{font-size:18px;font-weight:700;border-top:2px solid #111;padding-top:10px;margin-top:6px}
  .footer{margin-top:40px;padding-top:20px;border-top:1px solid #eee;color:#888;font-size:12px}
</style></head><body>
<div class="header">
  <div>
    <div class="company">${companySettings.name||"Your Company"}</div>
    <div style="margin-top:4px;color:#666">${companySettings.address||""} ${companySettings.city||""} ${companySettings.state||""}</div>
    <div style="color:#666">${companySettings.taxId?"EIN: "+companySettings.taxId:""}</div>
  </div>
  <div class="invoice-meta">
    <div class="invoice-number">${draft.invoice_number}</div>
    <div style="margin-top:8px"><strong>Bill To:</strong> ${draft.customer}</div>
    <div style="color:#666">${draft.customer_email||""}</div>
    <div style="margin-top:8px">Issue Date: ${draft.issue_date}</div>
    <div>Due Date: ${draft.due_date||"On Receipt"}</div>
    <div>Terms: ${draft.terms||"Net 30"}</div>
  </div>
</div>
<table>
  <thead><tr><th>Description</th><th style="text-align:right">Qty</th><th style="text-align:right">Rate</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    ${draft.line_items.map(l=>`<tr><td>${l.description||""}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">$${parseFloat(l.rate||0).toFixed(2)}</td><td style="text-align:right">$${(l.amount||0).toFixed(2)}</td></tr>`).join("")}
  </tbody>
</table>
<div class="totals">
  <div class="total-row"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
  <div class="total-row grand-total"><span>Total Due</span><span>$${total.toFixed(2)}</span></div>
</div>
${draft.notes?`<div class="footer">Notes: ${draft.notes}</div>`:""}
</body></html>`;
              const w = window.open("","_blank");
              w.document.write(html);
              w.document.close();
              w.print();
              logAudit("invoice_printed",`Invoice ${draft.invoice_number} printed/PDF'd`);
            };

            const markPaid = (inv) => {
              setSentInvoices(prev=>prev.map(i=>i.id===inv.id?{...i,status:"paid",paid_at:new Date().toISOString()}:i));
              // Also book as revenue
              const entry = {
                id:Date.now()+Math.random(), vendor:inv.customer, description:`Payment received – ${inv.invoice_number}`,
                amount:inv.line_items.reduce((s,l)=>s+(l.amount||0),0), date:new Date().toISOString().slice(0,10),
                type:"revenue", gl_code:"4000", gl_name:"Sales Revenue",
                secondary_gl_code:"1000", secondary_gl_name:"Cash & Cash Equivalents",
                debit_credit:"credit", confidence:100, reasoning:`Invoice ${inv.invoice_number} paid`,
                status:"booked", booked_at:new Date().toISOString(), source:"sent_invoice", payment_status:"collected"
              };
              setInvoices(prev=>[entry,...prev]);
              logAudit("invoice_paid",`Invoice ${inv.invoice_number} marked paid – ${fmt(entry.amount)}`);
              showNotification(`${inv.invoice_number} marked paid – revenue booked ✓`);
            };

            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>ACCOUNTS RECEIVABLE</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Send Invoice</h1>
                </div>

                <div style={{display:"grid",gridTemplateColumns:"1fr 380px",gap:20,alignItems:"flex-start"}}>
                  {/* Editor */}
                  <div>
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:24,marginBottom:16}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:16}}>
                        <div>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>INVOICE NUMBER</div>
                          <input value={draft.invoice_number} onChange={e=>setDraft(d=>({...d,invoice_number:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#C8B8FF",fontSize:13,outline:"none",fontFamily:"'DM Mono',monospace",fontWeight:600}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>TERMS</div>
                          <select value={draft.terms} onChange={e=>setDraft(d=>({...d,terms:e.target.value}))}
                            style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}>
                            {["On Receipt","Net 15","Net 30","Net 60","Net 90"].map(t=><option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>BILL TO</div>
                          <input value={draft.customer} onChange={e=>setDraft(d=>({...d,customer:e.target.value}))} placeholder="Customer name"
                            list="customer-list"
                            style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                          <datalist id="customer-list">{contacts.filter(c=>c.type==="customer").map(c=><option key={c.id} value={c.name}/>)}</datalist>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>EMAIL</div>
                          <input type="email" value={draft.customer_email} onChange={e=>setDraft(d=>({...d,customer_email:e.target.value}))} placeholder="customer@email.com"
                            style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>ISSUE DATE</div>
                          <input type="date" value={draft.issue_date} onChange={e=>setDraft(d=>({...d,issue_date:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                        </div>
                        <div>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>DUE DATE</div>
                          <input type="date" value={draft.due_date} onChange={e=>setDraft(d=>({...d,due_date:e.target.value}))}
                            style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#E8E8F0",fontSize:13,outline:"none"}}/>
                        </div>
                      </div>

                      {/* Line items */}
                      <div style={{marginBottom:12}}>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:8,letterSpacing:1}}>LINE ITEMS</div>
                        {draft.line_items.map((line,i)=>(
                          <div key={line.id} style={{display:"grid",gridTemplateColumns:"3fr 80px 100px 100px 36px",gap:8,marginBottom:8,alignItems:"center"}}>
                            <input value={line.description} onChange={e=>updateLine(line.id,"description",e.target.value)} placeholder="Description of service or product"
                              style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}/>
                            <input type="number" value={line.qty} onChange={e=>updateLine(line.id,"qty",e.target.value)} placeholder="Qty"
                              style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none",textAlign:"center"}}/>
                            <input type="number" value={line.rate} onChange={e=>updateLine(line.id,"rate",e.target.value)} placeholder="Rate"
                              style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none",textAlign:"right"}}/>
                            <div style={{fontFamily:"'DM Mono',monospace",fontSize:13,textAlign:"right",color:"#E8E8F0",padding:"0 4px"}}>{fmt(line.amount)}</div>
                            <button onClick={()=>setDraft(d=>({...d,line_items:d.line_items.filter(l=>l.id!==line.id)}))} style={{background:"transparent",border:"1px solid #2A2A3E",borderRadius:7,color:"#EF4444",cursor:"pointer",fontSize:14,padding:"6px"}}>×</button>
                          </div>
                        ))}
                        <button onClick={()=>setDraft(d=>({...d,line_items:[...d.line_items,emptyLine()]}))} style={{fontSize:12,background:"transparent",border:"1px dashed #2A2A3E",borderRadius:8,padding:"7px 16px",color:"#9CA3AF",cursor:"pointer",marginTop:4}}>+ Add Line</button>
                      </div>

                      {/* Notes */}
                      <div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>NOTES / PAYMENT INSTRUCTIONS</div>
                        <textarea value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} rows={2} placeholder="Thank you for your business. Please remit payment by due date."
                          style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#9CA3AF",fontSize:12,outline:"none",resize:"vertical",fontFamily:"inherit"}}/>
                      </div>
                    </div>

                    <div style={{display:"flex",gap:10}}>
                      <button onClick={saveDraft} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:"pointer"}}>Save Draft</button>
                      <button onClick={downloadPDF} style={{padding:"9px 22px",borderRadius:9,fontSize:13,background:"#1E1E2E",border:"1px solid #2A2A3E",color:"#C8B8FF",cursor:"pointer"}}>Download / Print PDF</button>
                    </div>
                  </div>

                  {/* Right panel: totals + invoice list */}
                  <div>
                    {/* Total card */}
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:20,marginBottom:16}}>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:12,letterSpacing:1}}>INVOICE TOTAL</div>
                      <div style={{display:"flex",flexDirection:"column",gap:6}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:"#9CA3AF"}}><span>Subtotal</span><span style={{fontFamily:"'DM Mono',monospace"}}>{fmt(subtotal)}</span></div>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:16,fontWeight:700,borderTop:"1px solid #2A2A3E",paddingTop:10,marginTop:4}}><span>Total Due</span><span style={{fontFamily:"'DM Mono',monospace",color:"#10B981"}}>{fmt(total)}</span></div>
                      </div>
                    </div>

                    {/* Recent invoices */}
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                      <div style={{padding:"12px 16px",borderBottom:"1px solid #1E1E2E",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                        <div style={{fontSize:12,fontWeight:600,color:"#C8B8FF"}}>RECENT INVOICES</div>
                        <button onClick={()=>setDraft({invoice_number:nextNum,customer:"",customer_email:"",issue_date:new Date().toISOString().slice(0,10),due_date:"",notes:"",terms:"Net 30",line_items:[emptyLine()],status:"draft"})} style={{fontSize:11,background:"transparent",border:"1px solid #2A2A3E",borderRadius:7,padding:"3px 10px",color:"#9CA3AF",cursor:"pointer"}}>+ New</button>
                      </div>
                      {sentInvoices.length===0 ? (
                        <div style={{padding:24,textAlign:"center",color:"#6B6B8A",fontSize:12}}>No invoices yet</div>
                      ) : sentInvoices.slice(0,8).map(inv=>{
                        const invTotal = inv.line_items?.reduce((s,l)=>s+(l.amount||0),0)||0;
                        return (
                          <div key={inv.id} style={{padding:"12px 16px",borderTop:"1px solid #1E1E2E",cursor:"pointer",background:"transparent"}}
                            onClick={()=>setDraft(inv)}>
                            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                              <div>
                                <div style={{fontSize:12,fontWeight:600,fontFamily:"'DM Mono',monospace",color:"#C8B8FF"}}>{inv.invoice_number}</div>
                                <div style={{fontSize:11,color:"#9CA3AF",marginTop:2}}>{inv.customer}</div>
                              </div>
                              <div style={{textAlign:"right"}}>
                                <div style={{fontSize:13,fontWeight:700,fontFamily:"'DM Mono',monospace",color:inv.status==="paid"?"#10B981":"#E8E8F0"}}>{fmt(invTotal)}</div>
                                <span style={{fontSize:10,background:inv.status==="paid"?"#10B98122":inv.status==="draft"?"#1E1E2E":"#C8B8FF22",color:inv.status==="paid"?"#10B981":inv.status==="draft"?"#6B6B8A":"#C8B8FF",borderRadius:20,padding:"1px 7px"}}>{inv.status}</span>
                              </div>
                            </div>
                            {inv.status!=="paid" && (
                              <button onClick={e=>{e.stopPropagation();markPaid(inv);}} style={{marginTop:8,fontSize:11,padding:"4px 12px",borderRadius:7,background:"transparent",border:"1px solid #10B98133",color:"#10B981",cursor:"pointer"}}>Mark Paid → Book Revenue</button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}


      {/* ── PAYROLL IMPORT ─────────────────────────────────────────────── */}
          {view==="payroll" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const handlePayrollFile = async (file) => {
              if (!file) return;
              setPayrollProcessing(true);
              logAudit("payroll_upload_started", `Uploading payroll file: ${file.name}`);
              try {
                const text = await file.text();
                const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    model:"claude-sonnet-4-20250514", max_tokens:2000,
                    system:`You are a payroll accountant. Parse this payroll export (Gusto, ADP, or generic CSV) and return ONLY valid JSON:
{
  "source": "Gusto|ADP|Other",
  "period_start": "YYYY-MM-DD",
  "period_end": "YYYY-MM-DD",
  "pay_date": "YYYY-MM-DD",
  "total_gross": 0,
  "total_net": 0,
  "total_employer_taxes": 0,
  "total_deductions": 0,
  "journal_entries": [
    { "account_code": "5100", "account_name": "Salaries & Wages", "debit": 0, "credit": 0, "memo": "..." }
  ],
  "employees": [
    { "name": "...", "gross": 0, "net": 0, "taxes": 0 }
  ]
}
Journal entry rules:
- Debit 5100 Salaries & Wages for gross payroll
- Debit 5101 Payroll Tax Expense for employer taxes  
- Credit 2100 Accrued Liabilities for net pay
- Credit 2101 Payroll Taxes Payable for all taxes
- Entries must balance. Use today's date if pay_date unclear.`,
                    messages:[{role:"user", content:`Parse this payroll file:\n\n${text.slice(0,8000)}`}]
                  })
                });
                const d = await res.json();
                const parsed = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
                const importRecord = { id:Date.now()+Math.random(), source:parsed.source||"Unknown", period:`${parsed.period_start} – ${parsed.period_end}`, pay_date:parsed.pay_date, total_gross:parsed.total_gross, total_net:parsed.total_net, total_employer_taxes:parsed.total_employer_taxes, journal_entries:parsed.journal_entries||[], employees:parsed.employees||[], imported_at:new Date().toISOString(), file_name:file.name, posted:false };
                setPayrollImports(prev => [importRecord, ...prev]);
                logAudit("payroll_parsed", `${parsed.source} payroll parsed: ${fmt(parsed.total_gross)} gross, ${(parsed.employees||[]).length} employees`);
                storeDocument(file.name, null, "text/csv", "payroll", importRecord.id, ["payroll"]);
              } catch(e) { console.error(e); }
              setPayrollProcessing(false);
            };
            const postPayroll = (imp) => {
              const newInvoices = imp.journal_entries.filter(e=>e.debit>0).map(e => ({
                id:Date.now()+Math.random(), vendor:"Payroll", description:`${imp.source} Payroll – ${imp.period}`,
                amount:e.debit, date:imp.pay_date, type:"expense",
                gl_code:e.account_code, gl_name:e.account_name,
                secondary_gl_code:"2100", secondary_gl_name:"Accrued Liabilities",
                debit_credit:"debit", confidence:99, reasoning:`Payroll import: ${imp.source}`,
                status:"booked", booked_at:new Date().toISOString(), source:"payroll", payment_status:"paid"
              }));
              setInvoices(prev => [...newInvoices, ...prev]);
              setPayrollImports(prev => prev.map(p => p.id===imp.id ? {...p, posted:true} : p));
              logAudit("payroll_posted", `${imp.source} payroll posted: ${fmt(imp.total_gross)} gross, ${newInvoices.length} entries`);
              showNotification(`Payroll posted: ${fmt(imp.total_gross)} gross ✓`);
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>PAYROLL</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Payroll Import</h1>
                  <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Upload a Gusto or ADP payroll export (CSV). AI reads it, generates the journal entries, and posts to your books.</div>
                </div>
                {/* Upload zone */}
                <div onDragOver={e=>{e.preventDefault();setPayrollDragOver(true);}} onDragLeave={()=>setPayrollDragOver(false)}
                  onDrop={e=>{e.preventDefault();setPayrollDragOver(false);const f=e.dataTransfer.files[0];if(f)handlePayrollFile(f);}}
                  style={{border:`2px dashed ${payrollDragOver?"#6D28D9":"#2A2A3E"}`,borderRadius:14,padding:32,textAlign:"center",marginBottom:24,background:payrollDragOver?"#1A0A2E":"#0F0F13",transition:"all 0.2s",cursor:"pointer"}}
                  onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls";i.onchange=e=>handlePayrollFile(e.target.files[0]);i.click();}}>
                  {payrollProcessing ? <div style={{color:"#C8B8FF",fontSize:14}}>⏳ Parsing payroll data...</div> : (
                    <div>
                      <div style={{fontSize:28,marginBottom:8}}>💼</div>
                      <div style={{fontSize:14,fontWeight:500,marginBottom:4}}>Drop Gusto or ADP export here</div>
                      <div style={{fontSize:12,color:"#6B6B8A"}}>CSV or Excel · AI auto-detects format and generates journal entries</div>
                      <div style={{marginTop:16,display:"flex",gap:10,justifyContent:"center"}}>
                        {["Gusto CSV","ADP RUN","ADP Workforce Now","Generic Payroll CSV"].map(s=>(
                          <span key={s} style={{fontSize:11,background:"#1E1E2E",color:"#9CA3AF",borderRadius:20,padding:"3px 10px"}}>{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                {/* Import history */}
                {payrollImports.length===0 ? (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:40,textAlign:"center"}}>
                    <div style={{fontSize:13,color:"#6B6B8A"}}>No payroll imports yet. Upload a payroll export above.</div>
                  </div>
                ) : payrollImports.map(imp => (
                  <div key={imp.id} style={{background:"#14141A",border:`1px solid ${imp.posted?"#10B98133":"#1E1E2E"}`,borderRadius:14,marginBottom:12,overflow:"hidden"}}>
                    <div style={{padding:"16px 20px",display:"flex",alignItems:"center",gap:16}}>
                      <div style={{flex:1}}>
                        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                          <span style={{fontSize:15,fontWeight:600}}>{imp.source} Payroll</span>
                          {imp.posted && <span style={{fontSize:11,background:"#10B98122",color:"#10B981",borderRadius:20,padding:"2px 9px"}}>✓ Posted</span>}
                        </div>
                        <div style={{fontSize:12,color:"#6B6B8A"}}>{imp.period} · Pay date: {imp.pay_date} · {imp.employees?.length||0} employees</div>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontSize:11,color:"#6B6B8A"}}>GROSS PAYROLL</div>
                        <div style={{fontSize:20,fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#EF4444"}}>{fmt(imp.total_gross)}</div>
                      </div>
                      {!imp.posted && <button onClick={()=>postPayroll(imp)} style={{padding:"9px 20px",borderRadius:9,fontSize:13,fontWeight:600,background:"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:"pointer"}}>Post to Ledger</button>}
                    </div>
                    {/* Journal entries preview */}
                    <div style={{borderTop:"1px solid #1E1E2E",overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#0F0F13"}}>
                          {["Account","Debit","Credit"].map(h=><th key={h} style={{padding:"8px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {(imp.journal_entries||[]).map((e,i)=>(
                            <tr key={i} style={{borderTop:"1px solid #1E1E2E"}}>
                              <td style={{padding:"10px 16px"}}>
                                <span style={{fontSize:11,background:"#1E1E2E",color:"#9CA3AF",borderRadius:4,padding:"2px 7px",marginRight:8}}>{e.account_code}</span>
                                <span style={{fontSize:13,color:e.debit>0?"#E8E8F0":"#9CA3AF",paddingLeft:e.credit>0?16:0}}>{e.account_name}</span>
                              </td>
                              <td style={{padding:"10px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,color:"#E8E8F0"}}>{e.debit>0?fmt(e.debit):"—"}</td>
                              <td style={{padding:"10px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,color:"#9CA3AF"}}>{e.credit>0?fmt(e.credit):"—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* ── RECURRING TRANSACTIONS ─────────────────────────────────────── */}
          {view==="recurring" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const today = new Date().toISOString().slice(0,10);
            const due = recurring.filter(r=>r.active && r.next_date && r.next_date<=today);
            const runRecurring = (r) => {
              const inv = {
                id:Date.now()+Math.random(), vendor:r.vendor, description:r.description||r.name,
                amount:r.amount, date:today, type:"expense", gl_code:r.gl_code, gl_name:r.gl_name,
                project:r.project||"General", secondary_gl_code:"2000", secondary_gl_name:"Accounts Payable",
                debit_credit:"debit", confidence:99, reasoning:`Recurring: ${r.name}`,
                status:"booked", booked_at:new Date().toISOString(), source:"recurring", payment_status:"unpaid"
              };
              setInvoices(prev => [inv, ...prev]);
              const next = new Date(r.next_date);
              if (r.frequency==="weekly") next.setDate(next.getDate()+7);
              else if (r.frequency==="monthly") next.setMonth(next.getMonth()+1);
              else if (r.frequency==="quarterly") next.setMonth(next.getMonth()+3);
              else if (r.frequency==="annual") next.setFullYear(next.getFullYear()+1);
              setRecurring(prev => prev.map(x => x.id===r.id ? {...x, last_run:today, next_date:next.toISOString().slice(0,10)} : x));
              logAudit("recurring_posted", `Recurring posted: ${r.name} ${fmt(r.amount)}`);
              showNotification(`Posted: ${r.name} ${fmt(r.amount)} ✓`);
            };
            const newRec = recurringNewRec; const setNewRec = setRecurringNewRec;
            const addRecurring = () => {
              if (!newRec.name||!newRec.amount) return;
              const r = {...newRec, id:Date.now()+Math.random(), amount:parseFloat(newRec.amount), active:true, created_at:new Date().toISOString(), last_run:null};
              setRecurring(prev => [r, ...prev]);
              logAudit("recurring_created", `Recurring created: ${r.name} ${fmt(r.amount)} ${r.frequency}`);
              setNewRec({name:"",vendor:"",amount:"",gl_code:"5200",gl_name:"Rent & Occupancy",frequency:"monthly",next_date:today,project:"General"});
              showNotification(`Recurring "${r.name}" created ✓`);
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>AUTOMATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Recurring Transactions</h1>
                  <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Set up transactions that repeat automatically. You can also tell the AI chat — "set up rent as $4,500/month starting June 1".</div>
                </div>
                {/* Due now alert */}
                {due.length>0 && (
                  <div style={{background:"#1A1000",border:"1px solid #F59E0B44",borderRadius:12,padding:"14px 20px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                    <div style={{fontSize:13,color:"#F59E0B",fontWeight:500}}>⏰ {due.length} recurring transaction{due.length!==1?"s":""} due today</div>
                    <button onClick={()=>due.forEach(runRecurring)} style={{padding:"7px 16px",borderRadius:8,fontSize:12,fontWeight:600,background:"#F59E0B",border:"none",color:"#000",cursor:"pointer"}}>Post All Due</button>
                  </div>
                )}
                {/* Add new */}
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:20,marginBottom:20}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#C8B8FF",marginBottom:14,letterSpacing:0.5}}>+ NEW RECURRING TRANSACTION</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:12}}>
                    {[{k:"name",l:"Name",p:"e.g. Office Rent"},{k:"vendor",l:"Vendor",p:"Landlord name"},{k:"amount",l:"Amount ($)",p:"4500"}].map(f=>(
                      <div key={f.k}>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>{f.l}</div>
                        <input value={newRec[f.k]} onChange={e=>setNewRec(d=>({...d,[f.k]:e.target.value}))} placeholder={f.p}
                          style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}/>
                      </div>
                    ))}
                    <div>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>GL Account</div>
                      <select value={newRec.gl_code} onChange={e=>{const a=CHART_OF_ACCOUNTS.find(x=>x.code===e.target.value);setNewRec(d=>({...d,gl_code:e.target.value,gl_name:a?.name||""}));}}
                        style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}>
                        {CHART_OF_ACCOUNTS.filter(a=>a.category==="Expenses").map(a=><option key={a.code} value={a.code}>{a.code} – {a.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>Frequency</div>
                      <select value={newRec.frequency} onChange={e=>setNewRec(d=>({...d,frequency:e.target.value}))}
                        style={{width:"100%",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}>
                        {["weekly","monthly","quarterly","annual"].map(f=><option key={f} value={f}>{f.charAt(0).toUpperCase()+f.slice(1)}</option>)}
                      </select>
                    </div>
                    <div>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>First / Next Date</div>
                      <input type="date" value={newRec.next_date} onChange={e=>setNewRec(d=>({...d,next_date:e.target.value}))}
                        style={{width:"100%",boxSizing:"border-box",background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 10px",color:"#E8E8F0",fontSize:12,outline:"none"}}/>
                    </div>
                  </div>
                  <button onClick={addRecurring} disabled={!newRec.name||!newRec.amount} style={{padding:"9px 22px",borderRadius:9,fontSize:13,fontWeight:600,background:(!newRec.name||!newRec.amount)?"#1E1E2E":"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:(!newRec.name||!newRec.amount)?"not-allowed":"pointer"}}>Save Recurring Transaction</button>
                </div>
                {/* List */}
                {recurring.length===0 ? (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:40,textAlign:"center",color:"#6B6B8A",fontSize:13}}>No recurring transactions yet.</div>
                ) : (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"#0F0F13"}}>
                        {["Name","Vendor","Amount","GL","Frequency","Next Date",""].map(h=><th key={h} style={{padding:"11px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {recurring.map((r,i)=>{
                          const isDue = r.active && r.next_date && r.next_date<=today;
                          return (
                            <tr key={r.id} style={{borderTop:"1px solid #1E1E2E",background:isDue?"#1A1000":i%2===0?"transparent":"#0A0A10"}}>
                              <td style={{padding:"12px 16px"}}>
                                <div style={{fontSize:13,fontWeight:500}}>{r.name}</div>
                                {!r.active && <span style={{fontSize:10,color:"#6B6B8A"}}>Paused</span>}
                                {isDue && <span style={{fontSize:10,color:"#F59E0B",marginLeft:6}}>Due today</span>}
                              </td>
                              <td style={{padding:"12px 16px",fontSize:13,color:"#9CA3AF"}}>{r.vendor||"—"}</td>
                              <td style={{padding:"12px 16px",fontFamily:"'DM Mono',monospace",fontSize:14,fontWeight:600,color:"#EF4444"}}>{"$"+(r.amount||0).toLocaleString("en-US",{minimumFractionDigits:2})}</td>
                              <td style={{padding:"12px 16px"}}><span style={{fontSize:11,background:"#1E1E2E",color:"#C8B8FF",borderRadius:20,padding:"2px 9px"}}>{r.gl_code} {r.gl_name}</span></td>
                              <td style={{padding:"12px 16px",fontSize:12,color:"#9CA3AF",textTransform:"capitalize"}}>{r.frequency}</td>
                              <td style={{padding:"12px 16px",fontSize:12,color:isDue?"#F59E0B":"#9CA3AF",fontFamily:"'DM Mono',monospace"}}>{r.next_date||"—"}</td>
                              <td style={{padding:"12px 16px"}}>
                                <div style={{display:"flex",gap:6}}>
                                  {isDue && <button onClick={()=>runRecurring(r)} style={{padding:"5px 12px",borderRadius:7,fontSize:11,fontWeight:600,background:"#F59E0B",border:"none",color:"#000",cursor:"pointer"}}>Post</button>}
                                  <button onClick={()=>setRecurring(prev=>prev.map(x=>x.id===r.id?{...x,active:!x.active}:x))} style={{padding:"5px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #2A2A3E",color:"#6B6B8A",cursor:"pointer"}}>{r.active?"Pause":"Resume"}</button>
                                  <button onClick={()=>{setRecurring(prev=>prev.filter(x=>x.id!==r.id));logAudit("recurring_deleted",`Deleted: ${r.name}`);}} style={{padding:"5px 10px",borderRadius:7,fontSize:11,background:"transparent",border:"1px solid #2A2A3E",color:"#EF4444",cursor:"pointer"}}>×</button>
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
          })()}

          {/* ── RECONCILIATION ────────────────────────────────────────────────── */}
          {view==="recon" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const balSheetAccounts = [
              {code:"1000",name:"Cash & Cash Equivalents",type:"asset"},
              {code:"1100",name:"Accounts Receivable",type:"asset"},
              {code:"1200",name:"Inventory",type:"asset"},
              {code:"2000",name:"Accounts Payable",type:"liability"},
              {code:"2200",name:"Short-Term Debt",type:"liability"},
              {code:"2500",name:"Long-Term Debt",type:"liability"},
            ];
            if (activeRecon) {
              const session = reconSessions.find(s=>s.id===activeRecon);
              if (!session) { setActiveRecon(null); return null; }
              const acctInvoices = invoices.filter(i => i.gl_code===session.account_code || i.secondary_gl_code===session.account_code);
              const cleared = new Set(session.cleared_ids||[]);
              const clearedAmt = acctInvoices.filter(i=>cleared.has(i.id)).reduce((s,i)=>s+(i.debit_credit==="debit"?i.amount:-i.amount),0);
              const statBal = parseFloat(reconStatementBalance)||0;
              const bookBal = acctInvoices.reduce((s,i)=>s+(i.debit_credit==="debit"?i.amount:-i.amount),0);
              const diff = statBal - clearedAmt;
              const isBalanced = Math.abs(diff) < 0.01;
              const toggleCleared = (id) => {
                setReconSessions(prev=>prev.map(s=>s.id===session.id?{...s,cleared_ids:cleared.has(id)?[...cleared].filter(x=>x!==id):[...cleared,id]}:s));
              };
              const finishRecon = () => {
                setReconSessions(prev=>prev.map(s=>s.id===session.id?{...s,status:"complete",completed_at:new Date().toISOString(),final_balance:statBal}:s));
                logAudit("recon_complete",`Reconciliation complete: ${session.account_name} – Statement bal ${fmt(statBal)}`);
                setActiveRecon(null);
                showNotification(`${session.account_name} reconciled ✓`);
              };
              return (
                <div>
                  <div style={{marginBottom:20,display:"flex",alignItems:"center",gap:12}}>
                    <button onClick={()=>setActiveRecon(null)} style={{background:"transparent",border:"1px solid #2A2A3E",borderRadius:8,padding:"6px 12px",color:"#9CA3AF",cursor:"pointer",fontSize:12}}>← Back</button>
                    <div>
                      <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A"}}>RECONCILIATION</div>
                      <h1 style={{fontSize:24,fontWeight:600,margin:0}}>{session.account_name}</h1>
                    </div>
                  </div>
                  {/* Balance summary bar */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:20}}>
                    {[
                      {l:"Statement Balance",v:fmt(statBal),c:"#E8E8F0"},
                      {l:"Book Balance",v:fmt(bookBal),c:"#E8E8F0"},
                      {l:"Cleared Balance",v:fmt(clearedAmt),c:"#C8B8FF"},
                      {l:"Difference",v:fmt(diff),c:isBalanced?"#10B981":"#EF4444"},
                    ].map(s=>(
                      <div key={s.l} style={{background:"#14141A",border:`1px solid ${s.l==="Difference"?(isBalanced?"#10B98133":"#EF444433"):"#1E1E2E"}`,borderRadius:12,padding:"14px 16px"}}>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:6}}>{s.l}</div>
                        <div style={{fontSize:20,fontWeight:700,fontFamily:"'DM Mono',monospace",color:s.c}}>{s.v}</div>
                      </div>
                    ))}
                  </div>
                  {/* Statement balance input */}
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,padding:"14px 20px",marginBottom:16,display:"flex",alignItems:"center",gap:12}}>
                    <div style={{fontSize:13,color:"#9CA3AF",flexShrink:0}}>Enter statement ending balance:</div>
                    <input value={reconStatementBalance} onChange={e=>setReconStatementBalance(e.target.value)} placeholder="0.00" type="number"
                      style={{flex:1,background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"8px 12px",color:"#E8E8F0",fontSize:14,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                    {isBalanced && <button onClick={finishRecon} style={{padding:"9px 22px",borderRadius:9,fontWeight:600,fontSize:13,background:"linear-gradient(135deg,#065F46,#047857)",border:"none",color:"#6EE7B7",cursor:"pointer"}}>✓ Complete Reconciliation</button>}
                  </div>
                  {/* Transaction list */}
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                    <div style={{padding:"12px 16px",borderBottom:"1px solid #1E1E2E",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:12,color:"#6B6B8A"}}>{acctInvoices.length} transactions · {cleared.size} cleared</div>
                      <button onClick={()=>setReconSessions(prev=>prev.map(s=>s.id===session.id?{...s,cleared_ids:acctInvoices.map(i=>i.id)}:s))} style={{fontSize:12,background:"transparent",border:"1px solid #2A2A3E",borderRadius:7,padding:"4px 12px",color:"#9CA3AF",cursor:"pointer"}}>Clear All</button>
                    </div>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"#0F0F13"}}>
                        {["✓","Date","Vendor / Description","Amount","Type"].map(h=><th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}
                      </tr></thead>
                      <tbody>
                        {acctInvoices.sort((a,b)=>a.date>b.date?1:-1).map((inv,i)=>{
                          const isCleared = cleared.has(inv.id);
                          const amt = inv.debit_credit==="debit"?inv.amount:-inv.amount;
                          return (
                            <tr key={inv.id} style={{borderTop:"1px solid #1E1E2E",background:isCleared?"#0A1A0A":i%2===0?"transparent":"#0A0A10",cursor:"pointer"}} onClick={()=>toggleCleared(inv.id)}>
                              <td style={{padding:"11px 14px"}}><div style={{width:18,height:18,borderRadius:5,border:`2px solid ${isCleared?"#10B981":"#2A2A3E"}`,background:isCleared?"#10B981":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,color:"#fff"}}>{isCleared?"✓":""}</div></td>
                              <td style={{padding:"11px 14px",fontSize:12,color:"#9CA3AF",fontFamily:"'DM Mono',monospace"}}>{inv.date}</td>
                              <td style={{padding:"11px 14px",fontSize:13}}>{inv.vendor} <span style={{fontSize:11,color:"#6B6B8A"}}>· {inv.description}</span></td>
                              <td style={{padding:"11px 14px",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:amt>=0?"#10B981":"#EF4444"}}>{amt>=0?"+":""}{fmt(Math.abs(amt))}</td>
                              <td style={{padding:"11px 14px"}}><span style={{fontSize:11,background:"#1E1E2E",color:"#9CA3AF",borderRadius:20,padding:"2px 8px"}}>{inv.gl_name}</span></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            }
            // Account selection screen
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>RECONCILIATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Reconciliation</h1>
                  <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Match your books to your bank and account statements. Start a reconciliation for any balance sheet account.</div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
                  {balSheetAccounts.map(acct => {
                    const lastRecon = reconSessions.filter(s=>s.account_code===acct.code&&s.status==="complete").sort((a,b)=>b.completed_at>a.completed_at?1:-1)[0];
                    const openRecon = reconSessions.find(s=>s.account_code===acct.code&&s.status==="open");
                    const acctTotal = invoices.filter(i=>i.gl_code===acct.code||i.secondary_gl_code===acct.code).reduce((s,i)=>s+(i.debit_credit==="debit"?i.amount:-i.amount),0);
                    return (
                      <div key={acct.code} style={{background:"#14141A",border:`1px solid ${openRecon?"#C8B8FF33":"#1E1E2E"}`,borderRadius:14,padding:22}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
                          <div>
                            <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>{acct.code} · {acct.type.toUpperCase()}</div>
                            <div style={{fontSize:16,fontWeight:600}}>{acct.name}</div>
                          </div>
                          {openRecon && <span style={{fontSize:11,background:"#C8B8FF22",color:"#C8B8FF",borderRadius:20,padding:"2px 9px"}}>In Progress</span>}
                          {lastRecon&&!openRecon && <span style={{fontSize:11,background:"#10B98122",color:"#10B981",borderRadius:20,padding:"2px 9px"}}>Last: {lastRecon.completed_at?.slice(0,10)}</span>}
                        </div>
                        <div style={{marginBottom:16}}>
                          <div style={{fontSize:11,color:"#6B6B8A",marginBottom:4}}>BOOK BALANCE</div>
                          <div style={{fontSize:22,fontWeight:700,fontFamily:"'DM Mono',monospace",color:acctTotal>=0?"#10B981":"#EF4444"}}>{acctTotal>=0?"+":""}{fmt(Math.abs(acctTotal))}</div>
                        </div>
                        <button onClick={()=>{
                          if (openRecon) { setActiveRecon(openRecon.id); }
                          else {
                            const s = {id:Date.now()+Math.random(),account_code:acct.code,account_name:acct.name,status:"open",created_at:new Date().toISOString(),cleared_ids:[]};
                            setReconSessions(prev=>[s,...prev]);
                            setActiveRecon(s.id);
                            setReconStatementBalance("");
                            logAudit("recon_started",`Started reconciliation: ${acct.name}`);
                          }
                        }} style={{width:"100%",padding:"9px",borderRadius:9,fontSize:13,fontWeight:500,background:openRecon?"linear-gradient(135deg,#3B1F8C,#4C1D95)":"#1E1E2E",border:"none",color:openRecon?"#C8B8FF":"#9CA3AF",cursor:"pointer"}}>
                          {openRecon?"Resume Reconciliation →":"Start Reconciliation →"}
                        </button>
                      </div>
                    );
                  })}
                </div>
                {/* History */}
                {reconSessions.filter(s=>s.status==="complete").length>0 && (
                  <div style={{marginTop:28}}>
                    <div style={{fontSize:11,color:"#6B6B8A",letterSpacing:2,marginBottom:12}}>RECONCILIATION HISTORY</div>
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#0F0F13"}}>{["Account","Completed","Statement Balance","Status"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {reconSessions.filter(s=>s.status==="complete").map((s,i)=>(
                            <tr key={s.id} style={{borderTop:"1px solid #1E1E2E",background:i%2===0?"transparent":"#0A0A10"}}>
                              <td style={{padding:"12px 16px",fontSize:13,fontWeight:500}}>{s.account_name}</td>
                              <td style={{padding:"12px 16px",fontSize:12,color:"#9CA3AF",fontFamily:"'DM Mono',monospace"}}>{s.completed_at?.slice(0,10)}</td>
                              <td style={{padding:"12px 16px",fontFamily:"'DM Mono',monospace",fontSize:13,fontWeight:600,color:"#10B981"}}>{fmt(s.final_balance)}</td>
                              <td style={{padding:"12px 16px"}}><span style={{fontSize:11,background:"#10B98122",color:"#10B981",borderRadius:20,padding:"2px 9px"}}>✓ Balanced</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── 1099 TRACKER ─────────────────────────────────────────────────── */}
          {view==="tax1099" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const year = new Date().getFullYear();
            const eligible = contacts.filter(c=>c.is1099&&c.type==="vendor");
            const vendorTotals = eligible.map(c => {
              const paid = invoices.filter(i=>i.vendor?.toLowerCase()===c.name?.toLowerCase()&&i.type==="expense"&&i.date?.startsWith(year)).reduce((s,i)=>s+i.amount,0);
              return {...c, ytd_paid:paid, needs1099:paid>=600};
            });
            const export1099 = () => {
              const rows = [["Vendor Name","EIN/SSN","Address","YTD Payments","Needs 1099"],...vendorTotals.map(v=>[v.name,v.ein||"",v.address||"",v.ytd_paid.toFixed(2),v.needs1099?"YES":"NO"])];
              const csv = rows.map(r=>r.join(",")).join("\n");
              const blob = new Blob([csv],{type:"text/csv"});
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href=url; a.download=`1099-report-${year}.csv`; a.click();
              logAudit("1099_exported",`1099 report exported for ${year}`);
            };
            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>TAX</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>1099 Tracker — {year}</h1>
                    <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Track contractor payments. Flag vendors in the Vendors page as 1099-eligible. $600 threshold triggers a 1099-NEC.</div>
                  </div>
                  {vendorTotals.length>0 && <button onClick={export1099} style={{padding:"9px 20px",borderRadius:9,fontSize:13,background:"#1E1E2E",border:"1px solid #2A2A3E",color:"#C8B8FF",cursor:"pointer"}}>Export CSV</button>}
                </div>
                {/* Summary cards */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:14,marginBottom:24}}>
                  {[
                    {l:"1099-Eligible Vendors",v:eligible.length,c:"#C8B8FF"},
                    {l:"Need 1099-NEC (≥$600)",v:vendorTotals.filter(v=>v.needs1099).length,c:"#F59E0B"},
                    {l:"Total Contractor Spend",v:fmt(vendorTotals.reduce((s,v)=>s+v.ytd_paid,0)),c:"#EF4444"},
                  ].map(s=>(
                    <div key={s.l} style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,padding:"16px 20px"}}>
                      <div style={{fontSize:11,color:"#6B6B8A",marginBottom:6}}>{s.l}</div>
                      <div style={{fontSize:24,fontWeight:700,fontFamily:"'DM Mono',monospace",color:s.c}}>{s.v}</div>
                    </div>
                  ))}
                </div>
                {/* Flag non-eligible vendors prompt */}
                {contacts.filter(c=>c.type==="vendor"&&!c.is1099).length>0 && (
                  <div style={{background:"#14141A",border:"1px solid #F59E0B33",borderRadius:12,padding:"14px 20px",marginBottom:20}}>
                    <div style={{fontSize:13,color:"#F59E0B",marginBottom:8,fontWeight:500}}>⚠ Some vendors may need 1099 flags</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
                      {contacts.filter(c=>c.type==="vendor"&&!c.is1099).filter(c=>{
                        const paid=invoices.filter(i=>i.vendor?.toLowerCase()===c.name?.toLowerCase()&&i.type==="expense"&&i.date?.startsWith(year)).reduce((s,i)=>s+i.amount,0);
                        return paid>=600;
                      }).map(c=>(
                        <div key={c.id} style={{display:"flex",alignItems:"center",gap:6,background:"#1A1000",border:"1px solid #F59E0B22",borderRadius:8,padding:"6px 12px"}}>
                          <span style={{fontSize:12,color:"#F59E0B"}}>{c.name} — {fmt(invoices.filter(i=>i.vendor?.toLowerCase()===c.name?.toLowerCase()&&i.type==="expense"&&i.date?.startsWith(year)).reduce((s,i)=>s+i.amount,0))} paid YTD</span>
                          <button onClick={()=>{setContacts(prev=>prev.map(x=>x.id===c.id?{...x,is1099:true}:x));logAudit("1099_flagged",`${c.name} flagged as 1099-eligible`);}} style={{fontSize:11,padding:"3px 8px",borderRadius:6,background:"#F59E0B",border:"none",color:"#000",cursor:"pointer",fontWeight:600}}>Flag 1099</button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* 1099 vendor table */}
                {vendorTotals.length===0 ? (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:40,textAlign:"center"}}>
                    <div style={{fontSize:13,color:"#6B6B8A",marginBottom:12}}>No 1099-eligible vendors yet. Go to the Vendors page and toggle the 1099 flag on any contractor.</div>
                    <button onClick={()=>setView("vendors")} style={{padding:"9px 20px",borderRadius:9,fontSize:13,background:"#1E1E2E",border:"1px solid #2A2A3E",color:"#9CA3AF",cursor:"pointer"}}>Go to Vendors →</button>
                  </div>
                ) : (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                    <table style={{width:"100%",borderCollapse:"collapse"}}>
                      <thead><tr style={{background:"#0F0F13"}}>{["Vendor","EIN/SSN","YTD Payments","Status",""].map(h=><th key={h} style={{padding:"11px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                      <tbody>
                        {vendorTotals.sort((a,b)=>b.ytd_paid-a.ytd_paid).map((v,i)=>(
                          <tr key={v.id} style={{borderTop:"1px solid #1E1E2E",background:i%2===0?"transparent":"#0A0A10"}}>
                            <td style={{padding:"13px 16px"}}>
                              <div style={{display:"flex",alignItems:"center",gap:10}}>
                                <div style={{width:32,height:32,borderRadius:8,background:vendorColor(v.name),display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff"}}>{initials(v.name)}</div>
                                <span style={{fontSize:13,fontWeight:500}}>{v.name}</span>
                              </div>
                            </td>
                            <td style={{padding:"13px 16px"}}>
                              <input value={v.ein||""} onChange={e=>setContacts(prev=>prev.map(c=>c.id===v.id?{...c,ein:e.target.value}:c))} placeholder="XX-XXXXXXX"
                                style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:6,padding:"5px 9px",color:"#E8E8F0",fontSize:12,width:110,outline:"none",fontFamily:"'DM Mono',monospace"}}/>
                            </td>
                            <td style={{padding:"13px 16px",fontFamily:"'DM Mono',monospace",fontSize:15,fontWeight:700,color:v.needs1099?"#F59E0B":"#9CA3AF"}}>{fmt(v.ytd_paid)}</td>
                            <td style={{padding:"13px 16px"}}>
                              {v.needs1099
                                ? <span style={{fontSize:12,background:"#F59E0B22",color:"#F59E0B",borderRadius:20,padding:"3px 10px",fontWeight:600}}>⚠ 1099-NEC Required</span>
                                : <span style={{fontSize:12,background:"#1E1E2E",color:"#6B6B8A",borderRadius:20,padding:"3px 10px"}}>{fmt(600-v.ytd_paid)} below threshold</span>}
                            </td>
                            <td style={{padding:"13px 16px"}}>
                              <button onClick={()=>{setContacts(prev=>prev.map(c=>c.id===v.id?{...c,is1099:false}:c));}} style={{fontSize:11,background:"transparent",border:"1px solid #2A2A3E",borderRadius:6,padding:"4px 10px",color:"#6B6B8A",cursor:"pointer"}}>Remove flag</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── DOCUMENT LIBRARY ─────────────────────────────────────────────── */}
          {view==="docs" && (() => {
            const preview = docsPreview; const setPreview = setDocsPreview;
            const filterType = docsFilterType; const setFilterType = setDocsFilterType;
            const types = ["all",...new Set(docLibrary.map(d=>d.type))];
            const filtered = filterType==="all"?docLibrary:docLibrary.filter(d=>d.type===filterType);
            return (
              <div>
                <div style={{marginBottom:24,display:"flex",justifyContent:"space-between",alignItems:"flex-end"}}>
                  <div>
                    <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>DOCUMENT LIBRARY</div>
                    <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Documents</h1>
                    <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Every uploaded file — invoices, contracts, bank statements, payroll — stored and searchable. {docLibrary.length} document{docLibrary.length!==1?"s":""} stored.</div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    {types.map(t=>(
                      <button key={t} onClick={()=>setFilterType(t)} style={{padding:"6px 14px",borderRadius:20,fontSize:12,background:filterType===t?"#6D28D9":"#1E1E2E",border:"none",color:filterType===t?"#E8E8F0":"#9CA3AF",cursor:"pointer",textTransform:"capitalize"}}>{t}</button>
                    ))}
                  </div>
                </div>
                {preview && (
                  <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:2000,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setPreview(null)}>
                    <div style={{background:"#14141A",border:"1px solid #2A2A3E",borderRadius:16,padding:24,maxWidth:700,width:"90%",maxHeight:"80vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
                        <div style={{fontSize:15,fontWeight:600}}>{preview.name}</div>
                        <button onClick={()=>setPreview(null)} style={{background:"transparent",border:"none",color:"#9CA3AF",fontSize:20,cursor:"pointer"}}>×</button>
                      </div>
                      {preview.base64 && preview.mediaType?.startsWith("image") && (
                        <img src={`data:${preview.mediaType};base64,${preview.base64}`} style={{width:"100%",borderRadius:8}} alt={preview.name}/>
                      )}
                      {preview.base64 && preview.mediaType==="application/pdf" && (
                        <iframe src={`data:application/pdf;base64,${preview.base64}`} style={{width:"100%",height:500,border:"none",borderRadius:8}} title={preview.name}/>
                      )}
                      {!preview.base64 && <div style={{color:"#6B6B8A",fontSize:13,textAlign:"center",padding:40}}>File content not available for preview. Metadata stored.</div>}
                      <div style={{marginTop:16,fontSize:12,color:"#6B6B8A"}}>Uploaded {preview.uploaded_at?.slice(0,10)} · Type: {preview.type} · {preview.mediaType}</div>
                    </div>
                  </div>
                )}
                {filtered.length===0 ? (
                  <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:48,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:12}}>📁</div>
                    <div style={{fontSize:15,fontWeight:500,marginBottom:8}}>No documents yet</div>
                    <div style={{fontSize:13,color:"#6B6B8A"}}>Documents are stored automatically when you upload invoices, contracts, bank statements, and payroll files.</div>
                  </div>
                ) : (
                  <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:12}}>
                    {filtered.map(doc=>(
                      <div key={doc.id} style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:12,padding:18,cursor:"pointer",transition:"border-color 0.15s"}}
                        onMouseEnter={e=>e.currentTarget.style.borderColor="#C8B8FF"}
                        onMouseLeave={e=>e.currentTarget.style.borderColor="#1E1E2E"}
                        onClick={()=>setPreview(doc)}>
                        <div style={{fontSize:32,marginBottom:12}}>
                          {doc.type==="invoice"?"🧾":doc.type==="contract"?"📄":doc.type==="bank_statement"?"🏦":doc.type==="payroll"?"💼":"📋"}
                        </div>
                        <div style={{fontSize:13,fontWeight:500,marginBottom:4,wordBreak:"break-word"}}>{doc.name}</div>
                        <div style={{fontSize:11,color:"#6B6B8A",marginBottom:8}}>{doc.uploaded_at?.slice(0,10)}</div>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <span style={{fontSize:10,background:"#1E1E2E",color:"#9CA3AF",borderRadius:20,padding:"2px 8px",textTransform:"capitalize"}}>{doc.type}</span>
                          {(doc.tags||[]).map(t=><span key={t} style={{fontSize:10,background:"#1A1A2E",color:"#C8B8FF",borderRadius:20,padding:"2px 8px"}}>{t}</span>)}
                        </div>
                        <div style={{marginTop:10,fontSize:11,color:"#6B6B8A"}}>Click to preview →</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── AUDIT TRAIL ──────────────────────────────────────────────────── */}
          {view==="audit" && (
            <div>
              <div style={{marginBottom:24}}>
                <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>COMPLIANCE</div>
                <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Audit Trail</h1>
                <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Every action logged with timestamp. Immutable record of who did what and when.</div>
              </div>
              {auditLog.length===0 ? (
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:48,textAlign:"center"}}>
                  <div style={{fontSize:32,marginBottom:12}}>🔍</div>
                  <div style={{fontSize:15,fontWeight:500,marginBottom:8}}>No activity yet</div>
                  <div style={{fontSize:13,color:"#6B6B8A"}}>Every booking, recode, contact change, and reconciliation will appear here.</div>
                </div>
              ) : (
                <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden"}}>
                  <table style={{width:"100%",borderCollapse:"collapse"}}>
                    <thead><tr style={{background:"#0F0F13"}}>{["Timestamp","Action","Detail","User"].map(h=><th key={h} style={{padding:"11px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                    <tbody>
                      {auditLog.map((entry,i)=>{
                        const actionColor = {invoice_booked:"#10B981",ai_recode:"#C8B8FF",contact_added:"#0EA5E9",payroll_posted:"#F59E0B",recon_complete:"#10B981",recurring_posted:"#C8B8FF","1099_flagged":"#F59E0B","1099_exported":"#9CA3AF",payroll_upload_started:"#6B6B8A",qbo_imported:"#10B981"}[entry.action]||"#6B6B8A";
                        return (
                          <tr key={entry.id} style={{borderTop:"1px solid #1E1E2E",background:i%2===0?"transparent":"#0A0A10"}}>
                            <td style={{padding:"12px 16px",fontSize:11,color:"#6B6B8A",fontFamily:"'DM Mono',monospace",whiteSpace:"nowrap"}}>{entry.ts?.replace("T"," ").slice(0,19)}</td>
                            <td style={{padding:"12px 16px"}}><span style={{fontSize:11,background:actionColor+"22",color:actionColor,borderRadius:20,padding:"2px 9px",fontWeight:500,whiteSpace:"nowrap"}}>{entry.action.replace(/_/g," ")}</span></td>
                            <td style={{padding:"12px 16px",fontSize:13,color:"#C8C8D8"}}>{entry.detail}</td>
                            <td style={{padding:"12px 16px",fontSize:12,color:"#6B6B8A"}}>{entry.user}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── QBO ONBOARDING ────────────────────────────────────────────────── */}
          {view==="onboard" && (() => {
            const fmt = n => "$"+(Math.abs(n)||0).toLocaleString("en-US",{minimumFractionDigits:2});
            const handleQBOFile = async (file) => {
              setQboProcessing(true);
              try {
                const text = await file.text();
                const res = await fetch("https://hhhuvoycumjzcjbawwff.supabase.co/functions/v1/ai-proxy", {
                  method:"POST", headers:getAuthHeaders(),
                  body: JSON.stringify({
                    model:"claude-sonnet-4-20250514", max_tokens:4000,
                    system:`You are a QBO migration expert. Parse this QuickBooks Online export (CSV, IIF, or tabular format) and return ONLY valid JSON:
{
  "source_accounts": [
    { "qbo_name": "Checking Account", "qbo_code": "1010", "suggested_our_code": "1000", "suggested_our_name": "Cash & Cash Equivalents", "category": "Assets" }
  ],
  "transactions": [
    { "date": "YYYY-MM-DD", "vendor": "Vendor Name", "description": "Description", "amount": 0, "type": "expense|revenue", "qbo_account": "QBO Account Name", "suggested_gl_code": "5XXX", "suggested_gl_name": "GL Name" }
  ],
  "summary": { "total_transactions": 0, "date_range_start": "YYYY-MM-DD", "date_range_end": "YYYY-MM-DD", "total_vendors": 0 }
}
Our Chart of Accounts:
${CHART_OF_ACCOUNTS.map(a=>`${a.code} - ${a.name} (${a.category})`).join("\n")}
Map QBO accounts to our closest matching GL code. Parse up to 200 transactions.`,
                    messages:[{role:"user", content:`Parse this QBO export:\n\n${text.slice(0,12000)}`}]
                  })
                });
                const d = await res.json();
                const parsed = JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim());
                setQboData(parsed);
                const mapping = {};
                (parsed.source_accounts||[]).forEach(a=>{ mapping[a.qbo_name]=a.suggested_our_code; });
                setQboMapping(mapping);
                setQboStep("mapping");
              } catch(e) { console.error(e); showNotification("Could not parse QBO file. Try exporting as CSV from QBO.", "error"); }
              setQboProcessing(false);
            };
            const confirmImport = () => {
              const mapped = (qboData?.transactions||[]).map((t,i) => ({
                id:Date.now()+i, vendor:t.vendor, description:t.description, amount:Math.abs(t.amount),
                date:t.date, type:t.type,
                gl_code: qboMapping[t.qbo_account]||t.suggested_gl_code||"6200",
                gl_name: CHART_OF_ACCOUNTS.find(a=>a.code===(qboMapping[t.qbo_account]||t.suggested_gl_code))?.name||t.suggested_gl_name||"Miscellaneous",
                project:"General", secondary_gl_code:t.type==="expense"?"2000":"1000",
                secondary_gl_name:t.type==="expense"?"Accounts Payable":"Cash & Cash Equivalents",
                debit_credit:t.type==="expense"?"debit":"credit", confidence:90,
                reasoning:"Imported from QBO", status:"booked", booked_at:new Date().toISOString(), source:"qbo_import", payment_status:"unpaid"
              }));
              setInvoices(prev=>[...mapped,...prev]);
              logAudit("qbo_imported",`QBO import complete: ${mapped.length} transactions imported from ${qboData?.summary?.date_range_start} to ${qboData?.summary?.date_range_end}`);
              showNotification(`QBO import complete: ${mapped.length} transactions added ✓`);
              setQboStep("done");
            };
            return (
              <div>
                <div style={{marginBottom:24}}>
                  <div style={{fontSize:10,letterSpacing:3,color:"#6B6B8A",marginBottom:8}}>MIGRATION</div>
                  <h1 style={{fontSize:28,fontWeight:600,margin:0,letterSpacing:-0.5}}>Import from QuickBooks Online</h1>
                  <div style={{fontSize:13,color:"#6B6B8A",marginTop:6}}>Export your data from QBO and upload here. AI maps their accounts to ours and imports everything.</div>
                </div>
                {/* Steps indicator */}
                <div style={{display:"flex",gap:0,marginBottom:28}}>
                  {[["upload","1. Upload"],["mapping","2. Review Mapping"],["done","3. Complete"]].map(([s,l],i,arr)=>(
                    <div key={s} style={{display:"flex",alignItems:"center"}}>
                      <div style={{padding:"6px 18px",borderRadius:20,fontSize:12,fontWeight:500,background:qboStep===s?"linear-gradient(135deg,#6D28D9,#4C1D95)":["done","mapping"].includes(qboStep)&&i<["upload","mapping","done"].indexOf(qboStep)?"#10B98122":"#1E1E2E",color:qboStep===s?"#E8E8F0":"#6B6B8A",border:"none"}}>{l}</div>
                      {i<arr.length-1 && <div style={{width:24,height:1,background:"#2A2A3E"}}/>}
                    </div>
                  ))}
                </div>
                {qboStep==="upload" && (
                  <div>
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:24,marginBottom:20}}>
                      <div style={{fontSize:13,fontWeight:500,marginBottom:12}}>How to export from QuickBooks Online:</div>
                      {[["1","Go to Reports → Transaction List by Date"],["2","Set date range to All Dates"],["3","Click Export → Export to Excel or CSV"],["4","Upload that file below"]].map(([n,t])=>(
                        <div key={n} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
                          <div style={{width:22,height:22,borderRadius:"50%",background:"#6D28D9",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>{n}</div>
                          <div style={{fontSize:13,color:"#C8C8D8",paddingTop:2}}>{t}</div>
                        </div>
                      ))}
                    </div>
                    <div onDragOver={e=>{e.preventDefault();setQboDragOver(true);}} onDragLeave={()=>setQboDragOver(false)}
                      onDrop={e=>{e.preventDefault();setQboDragOver(false);const f=e.dataTransfer.files[0];if(f)handleQBOFile(f);}}
                      style={{border:`2px dashed ${qboDragOver?"#6D28D9":"#2A2A3E"}`,borderRadius:14,padding:40,textAlign:"center",background:qboDragOver?"#1A0A2E":"#0F0F13",transition:"all 0.2s",cursor:"pointer"}}
                      onClick={()=>{const i=document.createElement("input");i.type="file";i.accept=".csv,.xlsx,.xls,.iif,.txt";i.onchange=e=>handleQBOFile(e.target.files[0]);i.click();}}>
                      {qboProcessing ? <div style={{color:"#C8B8FF",fontSize:14}}>⏳ Reading your QBO data... mapping accounts...</div> : (
                        <div>
                          <div style={{fontSize:36,marginBottom:10}}>⬆</div>
                          <div style={{fontSize:15,fontWeight:500,marginBottom:4}}>Drop your QBO export here</div>
                          <div style={{fontSize:12,color:"#6B6B8A"}}>CSV, Excel, IIF · AI reads the format automatically</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {qboStep==="mapping" && qboData && (
                  <div>
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,padding:"14px 20px",marginBottom:16,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div style={{fontSize:13,color:"#9CA3AF"}}>Found <strong style={{color:"#E8E8F0"}}>{qboData.summary?.total_transactions||0} transactions</strong> from {qboData.summary?.date_range_start} to {qboData.summary?.date_range_end} · {qboData.summary?.total_vendors||0} vendors</div>
                      <button onClick={confirmImport} style={{padding:"9px 24px",borderRadius:9,fontWeight:600,fontSize:13,background:"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:"pointer"}}>Import Everything →</button>
                    </div>
                    <div style={{fontSize:12,color:"#6B6B8A",marginBottom:12}}>Review how QBO accounts map to our chart of accounts. Edit any mapping before importing.</div>
                    <div style={{background:"#14141A",border:"1px solid #1E1E2E",borderRadius:14,overflow:"hidden",marginBottom:20}}>
                      <table style={{width:"100%",borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#0F0F13"}}>{["QBO Account","→","Our Account"].map(h=><th key={h} style={{padding:"10px 16px",textAlign:"left",fontSize:10,color:"#6B6B8A",letterSpacing:1.2,fontWeight:500}}>{h}</th>)}</tr></thead>
                        <tbody>
                          {(qboData.source_accounts||[]).map((a,i)=>(
                            <tr key={a.qbo_name} style={{borderTop:"1px solid #1E1E2E",background:i%2===0?"transparent":"#0A0A10"}}>
                              <td style={{padding:"11px 16px",fontSize:13,color:"#C8C8D8"}}>{a.qbo_name} <span style={{fontSize:11,color:"#6B6B8A"}}>({a.qbo_code})</span></td>
                              <td style={{padding:"11px 16px",color:"#6B6B8A"}}>→</td>
                              <td style={{padding:"11px 16px"}}>
                                <select value={qboMapping[a.qbo_name]||a.suggested_our_code||""} onChange={e=>setQboMapping(m=>({...m,[a.qbo_name]:e.target.value}))}
                                  style={{background:"#0F0F13",border:"1px solid #2A2A3E",borderRadius:8,padding:"6px 10px",color:"#E8E8F0",fontSize:12,outline:"none",width:"100%"}}>
                                  {CHART_OF_ACCOUNTS.map(ac=><option key={ac.code} value={ac.code}>{ac.code} – {ac.name}</option>)}
                                </select>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {qboStep==="done" && (
                  <div style={{background:"#14141A",border:"1px solid #10B98133",borderRadius:14,padding:48,textAlign:"center"}}>
                    <div style={{fontSize:48,marginBottom:16}}>✓</div>
                    <div style={{fontSize:22,fontWeight:700,marginBottom:8,color:"#10B981"}}>Import Complete</div>
                    <div style={{fontSize:14,color:"#9CA3AF",marginBottom:24}}>Your QBO data is now in your ledger, categorized and ready. Check the Audit Trail for a full import log.</div>
                    <div style={{display:"flex",gap:12,justifyContent:"center"}}>
                      <button onClick={()=>setView("invoices")} style={{padding:"10px 24px",borderRadius:10,fontSize:14,background:"linear-gradient(135deg,#6D28D9,#4C1D95)",border:"none",color:"#E8E8F0",cursor:"pointer"}}>View Ledger →</button>
                      <button onClick={()=>setView("reports")} style={{padding:"10px 24px",borderRadius:10,fontSize:14,background:"#1E1E2E",border:"1px solid #2A2A3E",color:"#9CA3AF",cursor:"pointer"}}>View Reports →</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

      {/* ── FLOATING AI CHAT ───────────────────────────────────────────────── */}
      {/* Bubble button */}
      <button onClick={()=>{ setChatOpen(o=>!o); setHasUnread(false); }} style={{
        position:"fixed", bottom:28, right:28, width:58, height:58, borderRadius:"50%",
        background:"linear-gradient(135deg,#6D28D9,#9333EA)", border:"none", cursor:"pointer",
        boxShadow:"0 8px 32px rgba(109,40,217,0.5)", display:"flex", alignItems:"center", justifyContent:"center",
        fontSize:24, zIndex:1000, animation:"popbubble 0.3s cubic-bezier(0.34,1.56,0.64,1)",
        transition:"transform 0.2s"
      }} onMouseEnter={e=>e.currentTarget.style.transform="scale(1.1)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
        {chatOpen ? "×" : "✦"}
        {hasUnread && !chatOpen && (
          <div style={{ position:"absolute", top:4, right:4, width:12, height:12, background:"#EF4444", borderRadius:"50%", border:"2px solid #0F0F13" }} />
        )}
      </button>

      {/* Chat panel */}
      {chatOpen && (
        <div style={{
          position:"fixed", bottom:100, right:28, width:400, height:560,
          background:"#14141A", border:"1px solid #2A2A3E", borderRadius:20,
          boxShadow:"0 24px 80px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column",
          zIndex:999, animation:"slideup 0.25s cubic-bezier(0.34,1.56,0.64,1)", overflow:"hidden"
        }}>
          {/* Header */}
          <div style={{ padding:"18px 20px", borderBottom:"1px solid #1E1E2E", background:"linear-gradient(135deg,#1A0A2E,#14141A)", flexShrink:0 }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <div style={{ width:36, height:36, borderRadius:10, background:"linear-gradient(135deg,#6D28D9,#9333EA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>✦</div>
              <div>
                <div style={{ fontSize:14, fontWeight:600 }}>AI Accounting Assistant</div>
                <div style={{ fontSize:11, color:"#10B981" }}>● Online · Knows your full ledger</div>
              </div>
            </div>
          </div>

          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"16px 16px 8px" }}>
            {chatHistory.map((msg, idx)=>(
              <div key={msg.id||idx} style={{ marginBottom:14, display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start" }}>
                {msg.role==="assistant" && (
                  <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#6D28D9,#9333EA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0, marginRight:8, marginTop:2 }}>✦</div>
                )}
                <div style={{ maxWidth:"80%" }}>
                  <div style={{
                    padding:"10px 14px", borderRadius:msg.role==="user"?"16px 16px 4px 16px":"16px 16px 16px 4px",
                    background:msg.role==="user"?"linear-gradient(135deg,#6D28D9,#4C1D95)":"#1E1E2E",
                    fontSize:13, lineHeight:1.6, color:"#E8E8F0", whiteSpace:"pre-wrap"
                  }}>{msg.content}</div>
                  {msg.actions?.length>0 && (
                    <div style={{ marginTop:8 }}>
                      {msg.actions.map((a,i)=>(
                        <div key={i} style={{ fontSize:11, color:"#10B981", background:"#0A2A1A", border:"1px solid #10B98133", borderRadius:8, padding:"4px 10px", marginBottom:4 }}>⚡ {a}</div>
                      ))}
                    </div>
                  )}
                  {msg.role==="assistant" && msg.content.toLowerCase().includes("profit") || msg.role==="assistant" && msg.content.toLowerCase().includes("expense") || msg.role==="assistant" && msg.content.toLowerCase().includes("revenue") ? (
                    <button onClick={()=>{ setChatOpen(false); setView("reports"); }} style={{ marginTop:6, background:"none", border:"1px solid #2A2A3E", borderRadius:8, padding:"4px 12px", color:"#C8B8FF", fontSize:11, cursor:"pointer" }}>
                      Open Reports page →
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:14 }}>
                <div style={{ width:28, height:28, borderRadius:8, background:"linear-gradient(135deg,#6D28D9,#9333EA)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, flexShrink:0 }}>✦</div>
                <div style={{ padding:"10px 14px", background:"#1E1E2E", borderRadius:"16px 16px 16px 4px" }}>
                  <div style={{ display:"flex", gap:4 }}>
                    {[0,1,2].map(i=><div key={i} style={{ width:6, height:6, borderRadius:"50%", background:"#6B6B8A", animation:`pulse 1.2s ease-in-out ${i*0.2}s infinite` }} />)}
                  </div>
                </div>
              </div>
            )}
            <div ref={chatBottomRef} />
          </div>

          {/* Suggestions */}
          {chatHistory.length < 3 && (
            <div style={{ padding:"0 16px 8px", display:"flex", flexWrap:"wrap", gap:6 }}>
              {["Show me a P&L for this month","How much have we spent this month?","Tag all AWS invoices to Cloud Infrastructure","What's our biggest expense category?"].map(s=>(
                <button key={s} onClick={()=>{ setChatInput(s); chatInputRef.current?.focus(); }} style={{ fontSize:11, padding:"5px 10px", borderRadius:20, background:"#1E1E2E", border:"1px solid #2A2A3E", color:"#9CA3AF", cursor:"pointer", textAlign:"left" }}>{s}</button>
              ))}
            </div>
          )}

          {/* Input */}
          <div style={{ padding:"12px 16px", borderTop:"1px solid #1E1E2E", display:"flex", gap:8, flexShrink:0 }}>
            <input ref={chatInputRef} value={chatInput} onChange={e=>setChatInput(e.target.value)}
              onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&handleChatSend()}
              placeholder="Ask anything about your books..."
              style={{ flex:1, background:"#0F0F13", border:"1px solid #2A2A3E", borderRadius:10, padding:"10px 14px", color:"#E8E8F0", fontSize:13, outline:"none", fontFamily:"'DM Sans', sans-serif" }} />
            <button onClick={handleChatSend} disabled={chatLoading||!chatInput.trim()} style={{
              width:40, height:40, borderRadius:10, background:(chatLoading||!chatInput.trim())?"#1E1E2E":"linear-gradient(135deg,#6D28D9,#9333EA)",
              border:"none", color:"#E8E8F0", cursor:(chatLoading||!chatInput.trim())?"not-allowed":"pointer", fontSize:16, flexShrink:0
            }}>↑</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppWrapper;
