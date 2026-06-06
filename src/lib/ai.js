import { getAuthHeaders } from "./supabase";

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
  `- [${c.type.toUpperCase()}] ${c.name} | Terms: ${c.payment_terms||"—"} | GL: ${c.gl_code||"—"} ${c.gl_name||""} | Email: ${c.email||"—"} | Phone: ${c.phone||"—"} | Expected: ${c.min_expected||"—"}–${c.max_expected||"—"} | Tags: ${(c.tags||[]).join(", ")||"none"} | Notes: ${c.notes||"none"}`
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
    // Navigate: { "type": "navigate", "view": "contracts" } — opens a page for the user. Available views:
    //   dashboard (home/overview), invoices (the ledger / all transactions), contracts, reports (P&L, balance sheet),
    //   ar (money in / receivables / send invoices), ap (money out / bills to pay), settings (company, bank accounts, chart of accounts),
    //   recurring (recurring transactions), tax1099 (1099 tracker), audittrail (full audit log), bank (bank feed / import), docs (document library)
    // { "type": "none" }
  ]
}

NAVIGATION — be a proactive guide:
- When the user asks where something is or how to get somewhere ("where are my contracts?", "how do I see reports?", "where do I upload invoices?", "take me to settings", "show me the P&L"), ALWAYS include a navigate action with the right view AND briefly tell them in the reply what they'll see there.
- Map intent to a view: contracts→contracts; reports/P&L/income statement/balance sheet→reports; upload invoices or see transactions/the ledger→invoices; bills/what we owe/pay vendors→ap; money owed to us/receivables/send an invoice→ar; recurring/subscriptions→recurring; 1099s→tax1099; audit history/who changed what→audittrail; bank statements/import→bank; uploaded files/documents→docs; company info/bank accounts/chart of accounts→settings; overview/burn/runway→dashboard.
- You can pair navigation with an answer (e.g. answer the question AND open the relevant page). Only navigate when the user is clearly trying to find or go somewhere.

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
