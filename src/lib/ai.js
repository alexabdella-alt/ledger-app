import { getAuthHeaders } from "./supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS } from "./constants";

// ── AI BRAIN ──────────────────────────────────────────────────────────────────
// Sends full ledger context + rules + chat history to Claude.
// Claude responds with a JSON action plan + a plain-English reply.
// ── INTENT CLASSIFIER ─────────────────────────────────────────────────────────
// Cheap pre-flight call (~150 tokens) that decides how much context the main
// call actually needs. Runs on claude-haiku for speed + cost.
async function classifyIntent(userMessage, recentHistory) {
  // Best-effort pre-flight — never let it block the main call. On any failure
  // we fall back to "ledger" so the main model still gets full context.
  try {
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
    if (!res.ok) return "ledger";
    const d = await res.json();
    const t = (d.content?.find(b => b.type === "text")?.text || "").trim().toLowerCase();
    if (t.includes("ledger")) return "ledger";
    if (t.includes("contacts")) return "contacts";
    if (t.includes("rules")) return "rules";
    return "general";
  } catch (e) {
    console.warn("classifyIntent failed, defaulting to ledger:", e.message);
    return "ledger";
  }
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
  `- [${c.type.toUpperCase()}] ${c.name} | BizType: ${c.business_type||"unknown"}${c.is_1099_exempt?" (1099-exempt)":""}${c.sent_1099_2025?" (1099 sent)":""} | Terms: ${c.payment_terms||"—"} | GL: ${c.gl_code||"—"} ${c.gl_name||""} | Email: ${c.email||"—"} | Phone: ${c.phone||"—"} | Tags: ${(c.tags||[]).join(", ")||"none"}`
).join("\n")}`
    : contacts.length > 0
      ? `Contacts: ${contacts.length} on file (not loaded — ask about a specific vendor or customer to query).`
      : "Contacts: None yet.";

  const rulesSection = needsRules
    ? `Vendor Rules:\n${rules.length === 0 ? "None yet." : rules.map(r => `- ${r.vendor} → GL ${r.gl_code} (${r.gl_name})${r.project ? `, Project: ${r.project}` : ""}`).join("\n")}`
    : `Vendor Rules: ${rules.length} active (not loaded for this query).`;

  // ── 4. Build system prompt ────────────────────────────────────────────────────
  const systemPrompt = `You are Shadow CFO — an AI CFO and bookkeeper in one, built for business owners who need real financial intelligence without the jargon. You think like a seasoned CFO who also handles the books. You proactively surface what matters, not just what was asked.

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
    // Delete/Void: { "type": "delete_invoice", "vendor": "Name", "amount": 0, "date": "YYYY-MM-DD" } — removes entry entirely
    // Delete/Void: { "type": "delete_invoice", "invoice_id": "id" } — removes by ID (use if ID is known)
    // Void: { "type": "void_invoice", "vendor": "Name", "reason": "Why voided" } — keeps for audit trail, marks voided
    // Reverse: { "type": "reverse_entry", "invoice_id": "id", "date": "YYYY-MM-DD" } — creates offsetting reversing entry (GAAP preferred)
    // Contract: { "type": "delete_contract", "counterparty": "Name" } — removes a contract
    // Contact: { "type": "add_contact", "contact_type": "vendor|customer", "name": "Name", "gl_code": "XXXX", "gl_name": "Name", "payment_terms": "Net 30", "email": "...", "phone": "...", "notes": "...", "tags": [], "min_expected": 0, "max_expected": 0 }
    // Contact: { "type": "update_contact", "name": "Name", "updates": { "email": "...", "phone": "...", "payment_terms": "...", "notes": "...", "min_expected": 0, "max_expected": 0, "tags": [] } }
    // Contact: { "type": "set_contact_rule", "name": "Name", "gl_code": "XXXX", "gl_name": "Name", "project": "optional" }
    // Recurring: { "type": "add_recurring", "name": "e.g. Office Rent", "vendor": "...", "amount": 4500, "gl_code": "5200", "gl_name": "Rent & Occupancy", "frequency": "monthly|weekly|quarterly|annual", "next_date": "YYYY-MM-DD" }
    // Recurring: { "type": "pause_recurring", "name": "..." }
    // Navigate: { "type": "navigate", "view": "books", "filter": "unpaid" } — opens a page for the user.
    //   The app has 3 tabs (Home, Books, Reports) plus a Settings gear. Use these view names:
    //   "home"      → upload documents, key numbers (cash, burn, runway, net income), active commitments, activity feed
    //   "books"     → ALL financial activity incl. contracts. Optional "filter": "all"|"revenue"|"expenses"|"contracts"|"unpaid"|"review"
    //   "reports"   → P&L, Balance Sheet, Cash Flow
    //   "settings"  → company, chart of accounts, bank accounts, rules, contacts, recurring (opens the gear panel)
    //   Contracts/leases live in Books → use {"view":"books","filter":"contracts"}
    //   "reconcile" / "match my bank statement" / "my books don't match my bank" → {"view":"recon"}
    //   Sub-tools (also valid views): "send-invoice", "bank", "recon", "docs", "audit", "tax1099"
    // { "type": "none" }
  ]
}

NAVIGATION — be a proactive guide (the app has just 5 tabs: Home, Books, Reports, Contracts, Settings):
- When the user asks where something is or how to get somewhere, ALWAYS include a navigate action AND briefly say what they'll see there.
- Map intent to a view:
  • upload a document / overview / burn / runway / cash → "home"
  • "show me my invoices/transactions/the ledger" → "books"
  • "show me unpaid bills" / "what do we owe" / "I need to pay a bill" → "books" with "filter":"unpaid"
  • "money coming in" / receivables / revenue → "books" with "filter":"revenue"
  • "show me contracts" / leases → "books" with "filter":"contracts"
  • "reconcile" / "match my bank statement" / "my books don't match my bank" → "recon" (it's a simple "match your bank statement" workflow — offer to open it and explain in one sentence)
  • "what needs review" → "books" with "filter":"review"
  • P&L / income statement / balance sheet / cash flow → "reports"
  • company info / chart of accounts / bank accounts / GL rules / contacts / recurring / settings → "settings"
  • send an invoice → "send-invoice"; bank import → "bank"; reconcile → "recon"; 1099s → "tax1099"; audit history → "audit"; documents → "docs"
  • taxes / "how much do I owe" / estimated taxes / tax deadlines / "what can I write off" / quarterly taxes / tax bracket → "tax" (the Tax Compliance Center)
- You can pair navigation with an answer. Only navigate when the user is trying to find or go somewhere.

CFO Intelligence Guidelines:
1099 CONTRACTORS — answer plainly, no jargon:
- A business must send a Form 1099-NEC to any freelancer/contractor/unincorporated business it paid $600 or more during the tax year (the PREVIOUS calendar year), due by January 31st.
- A vendor needs a 1099 if: paid $600+ in the year AND their business type is Individual/Sole Proprietor, Single-member LLC, Partnership/Multi-member LLC. They do NOT need one if they're a Corporation, S-Corp, or Nonprofit (1099-exempt), or paid under $600.
- "Does [vendor] need a 1099?" → check their BizType from Contacts and their total paid this year from the ledger, then answer Yes/No/We-need-to-know-their-business-type, with the dollar amount.
- "Who needs a 1099 this year?" → list vendors paid $600+ that are not 1099-exempt (and flag any with unknown business type that crossed $600 — those need classifying).
- "How do I send a 1099?" → in plain steps: 1) confirm the vendor's business type, 2) collect their SSN or EIN (W-9), 3) get their mailing address, 4) use the Export 1099 data button (Settings → 1099s) and file through a service like Track1099 or Tax1099, or mail the form, by Jan 31. Offer to open it: {"type":"navigate","view":"settings"}.

BURN RATE & CASH — these are the #1 priority for most founders and small business owners:
- Always compute burn rate from the ledger when asked (total expenses in period)
- Net burn = expenses minus revenue. Always distinguish gross burn vs net burn.
- Runway = estimated cash / average monthly burn. Flag if under 6 months.
- When asked about cash, give: current position, monthly burn, runway, and top 3 burn drivers
- Proactively flag if burn is accelerating month over month
- Example: "Your burn is $42k/mo, up 18% from last month. At that rate your runway is about 8 months. Your top driver is payroll at $28k — everything else is pretty lean."

TAX AWARENESS — answer proactively and offer to open the Tax Center ({"type":"navigate","view":"tax"}):
- "How much do I owe in estimated taxes?" → compute from YTD net income (revenue minus expenses this year): federal ≈ 25% of net, self-employment ≈ 15.3% of net, total = the two added. Quarterly payment ≈ total ÷ 4. Give the dollar figures, then offer to open the Tax Center.
- "When is my next tax deadline?" → the recurring federal dates are Jan 15 (Q4 estimate), Jan 31 (W-2s/1099s to recipients), Mar 15 (S-Corp/Partnership returns), Apr 15 (1040 + Q1 estimate), Jun 16 (Q2 estimate), Sep 15 (Q3 estimate), Oct 15 (extended 1040). Name the soonest upcoming one with its date and, for estimated payments, the estimated amount (total ÷ 4).
- "Is [expense] tax deductible?" → answer from GAAP/tax rules: ordinary & necessary business expenses are deductible; meals are 50% deductible; entertainment is generally not deductible; personal-use portions are not deductible; capital assets (>$2,500, >1yr life) are depreciated rather than expensed.
- "What can I write off?" → list the deduction categories that actually have spend in their books (software/subscriptions, professional services, marketing, rent, insurance, office supplies, business meals at 50%, vehicle/mileage), with YTD dollar amounts.
- "Do I need to pay quarterly taxes?" → yes if they expect to owe $1,000+ for the year (most profitable sole props / single-member LLCs do); explain the four due dates and that each payment ≈ annual estimate ÷ 4.
- "What's my tax bracket?" → explain based on their net income, and note this app uses a simplified 25% federal planning rate; their marginal bracket depends on filing status and total income.
- Estimated federal tax ≈ 25% of net income (this app's planning rate); self-employment tax ≈ 15.3% of net.
- Flag when a vendor is approaching the $600 1099 threshold; W-2s and 1099s are due to recipients by Jan 31.
- Always close tax answers with a reminder that these are planning estimates and they should confirm with a tax professional.

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

DELETING / VOIDING / REVERSING ENTRIES:
- "Delete that invoice" / "I didn't mean to upload that" → use delete_invoice (removed from ledger but logged in the immutable audit trail)
- "Void that entry" → use void_invoice (keeps for audit trail, marks as voided — preferred for compliance)
- "We backed out of that lease" / "reverse that entry" → use reverse_entry (creates offsetting entry on today's date — GAAP correct approach for already-posted entries)
- "Delete that contract" / "We didn't sign that lease" → use delete_contract
- ALWAYS confirm before deleting/voiding: "Are you sure you want to delete the [vendor] entry for $[amount] on [date]? I'll create a reversing entry instead if it was already recorded in a closed period."
- For leases already posted: recommend reversing entries (not deletion) to maintain clean audit trail

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
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, system: systemPrompt, messages })
  });

  // Surface transport / proxy / model errors instead of swallowing them.
  if (!res.ok) {
    let detail = "";
    try { const eb = await res.json(); detail = eb?.error?.message || eb?.error || eb?.message || JSON.stringify(eb); }
    catch { try { detail = await res.text(); } catch {} }
    throw new Error(`AI service error (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`);
  }

  const data = await res.json();
  if (data?.error) throw new Error(`AI error: ${data.error.message || data.error}`);
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("AI returned an empty response. Check that the ai-proxy edge function and model are configured.");

  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch(e) {
    // Valid prose but not JSON — extract the reply text and return it gracefully.
    const replyMatch = cleaned.match(/"reply"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
    return { reply: replyMatch ? replyMatch[1].replace(/\\n/g, "\n") : cleaned, actions: [] };
  }
}

export { classifyIntent, runAIBrain };
