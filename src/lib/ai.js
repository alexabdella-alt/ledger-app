import { getAuthHeaders } from "./supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS, AI_MODEL, AI_MODEL_FAST, AI_PROXY_URL } from "./constants";
import { formatProfileForPrompt } from "./clientProfile";
import { AI_SANDBOX_STATEMENT } from "./aiCapabilities";
import { fetchLedger } from "./ledger";
import { AI_TOOLS, executeAITool } from "./aiTools";
import {
  computeRevenue, computeExpenses, computeNetIncome, computeCategoryTotals,
  computeCashPosition, computeBurnRate, computeRunway, computeAR,
} from "./reports";

// Build a compact live financial snapshot from the full ledger so the AI always
// answers with REAL numbers (burn, runway, top categories MoM, overdue AR, net).
// Every figure flows through the canonical layer (reports.js) so the snapshot the
// AI sees is identical to the dashboard and the reports. cashBalance from the app.
function buildFinancials(invoices, cashBalance) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
  const year = String(now.getFullYear());
  const money = n => "$" + Math.round(Number(n) || 0).toLocaleString("en-US");
  const monthRange = ym => ({ from: `${ym}-01`, to: `${ym}-31` });

  const yearRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  const revYTD = computeRevenue(invoices, yearRange);
  const expYTD = computeExpenses(invoices, yearRange);
  const netYTD = computeNetIncome(invoices, yearRange);
  const cash = computeCashPosition({ cashBalance });
  const burn = computeBurnRate(invoices, { asOf: today });
  const runway = computeRunway(cash, burn);
  const ar = computeAR(invoices, { now });

  const catLast = Object.fromEntries(computeCategoryTotals(invoices, monthRange(lastMonth)).map(c => [c.category, c.total]));
  const topThis = computeCategoryTotals(invoices, monthRange(thisMonth)).slice(0, 5)
    .map(c => `${c.category} ${money(c.total)}${catLast[c.category] != null ? ` (last month ${money(catLast[c.category])})` : " (new this month)"}`);

  const lines = [
    `FINANCIAL SNAPSHOT (live from the books — use these exact figures, do not invent numbers):`,
    `Cash on hand: ${cash > 0 ? money(cash) : "not set by the owner yet"}`,
    `Net income YTD (${year}): ${money(netYTD)} (revenue ${money(revYTD)} − expenses ${money(expYTD)})`,
    `Monthly burn (trailing 3-mo avg of expenses): ${burn > 0 ? money(burn) : "n/a"}`,
    `Runway: ${runway != null ? `${runway.toFixed(1)} months at current burn` : (cash > 0 ? "effectively unlimited (no recent burn)" : "unknown — cash balance not set")}`,
    `Top expense categories THIS month vs last: ${topThis.length ? topThis.join("; ") : "no expenses booked this month yet"}`,
    `Overdue receivables: ${ar.overdueCount > 0 ? `${money(ar.overdue)} across ${ar.overdueCount} invoice(s) past due` : "none past due"}`,
  ];
  return { runway, burn, cash, text: lines.join("\n") };
}

// Walk from `start` (an opening `open` char) and return the index of its matching
// close, respecting nesting. Returns -1 if unbalanced. Used so we can strip whole
// action objects/arrays (including nested data arrays) from leaked reply text.
function matchBracket(s, start, open, close) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close) { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// Scrub any leaked JSON out of the user-visible reply. Unlike a regex, this is
// brace-balanced so it removes a COMPLETE action object — e.g.
// {"type":"render_chart", ... ,"data":[{...},{...}],"report_view":"category"} —
// rather than stopping at the first nested "}".
function scrubLeakedActionJson(input) {
  let s = String(input || "");

  // 1. Remove every balanced { "type":"<action>" ... } object (with nesting).
  const typeRe = /\{\s*"?type"?\s*:\s*"[a-zA-Z_]+"/;
  for (let guard = 0; guard < 100; guard++) {
    const m = s.match(typeRe);
    if (!m) break;
    const end = matchBracket(s, m.index, "{", "}");
    s = end === -1 ? s.slice(0, m.index) : s.slice(0, m.index) + s.slice(end + 1);
  }

  // 2. Remove a leaked "actions": [ ... ] array (bracket-balanced).
  const am = s.match(/,?\s*"?actions"?\s*:\s*\[/i);
  if (am) {
    const br = s.indexOf("[", am.index);
    const end = br === -1 ? -1 : matchBracket(s, br, "[", "]");
    s = end === -1 ? s.slice(0, am.index) : s.slice(0, am.index) + s.slice(end + 1);
  }

  // 3. Tidy up stray structural leftovers without touching real prose.
  return s
    .replace(/^\s*[,}\]]+/, "")        // leading stray commas/closers
    .replace(/[,{[\s]+$/g, "")          // trailing stray commas/openers/space
    .replace(/^\s*[}\]]\s*$/gm, "")     // lone braces/brackets on a line
    .trim();
}

// Find and JSON.parse every balanced {"type":"..."} object in arbitrary text, so
// we can still recover (and render) actions even when the wrapper JSON is malformed.
function extractActionObjects(text) {
  const out = [];
  const typeRe = /\{\s*"?type"?\s*:\s*"[a-zA-Z_]+"/g;
  let m;
  while ((m = typeRe.exec(text)) !== null) {
    const end = matchBracket(text, m.index, "{", "}");
    if (end === -1) break;
    try { out.push(JSON.parse(text.slice(m.index, end + 1))); } catch { /* skip */ }
    typeRe.lastIndex = end + 1;
  }
  return out;
}

// Parse the AI's final text into { reply, actions }. The reply is scrubbed of any
// leaked action JSON; actions are recovered even from malformed wrapper JSON.
function parseAIReply(text) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  const result = (reply, actions) => ({ reply: scrubLeakedActionJson(reply), actions: Array.isArray(actions) ? actions : [] });

  // 1. Clean JSON object (the normal case): reply + actions are already separate.
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return result(parsed.reply ?? "", parsed.actions);
  } catch { /* fall through */ }

  // 2. JSON wrapped in surrounding prose — grab the outermost object and parse it.
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      const parsed = JSON.parse(objMatch[0]);
      if (parsed && typeof parsed === "object" && (parsed.reply != null || parsed.actions != null)) {
        return result(parsed.reply ?? cleaned.replace(objMatch[0], ""), parsed.actions);
      }
    } catch { /* fall through */ }
  }

  // 3. Malformed JSON: recover the reply string + any action objects individually.
  const replyMatch = cleaned.match(/"reply"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
  const replyText = replyMatch ? replyMatch[1].replace(/\\n/g, "\n") : cleaned;
  return result(replyText, extractActionObjects(cleaned));
}

// Validate an ai-proxy Response: throw on non-2xx OR an error body, otherwise
// return the parsed JSON. Use this anywhere a fetch to the proxy is already
// written so failures surface instead of being parsed as empty results.
async function okAIResponse(res) {
  if (!res.ok) {
    let detail = "";
    try { const eb = await res.json(); detail = eb?.error?.message || eb?.error || eb?.message || JSON.stringify(eb); }
    catch { try { detail = await res.text(); } catch {} }
    throw new Error(`AI service error (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`);
  }
  const data = await res.json();
  if (data?.error) throw new Error(`AI error: ${data.error.message || data.error}`);
  return data;
}

// Single entry point for the ai-proxy edge function (does the fetch for you).
async function callAIProxy(payload, headers) {
  const res = await fetch(AI_PROXY_URL, {
    method: "POST",
    headers: headers || getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  return okAIResponse(res);
}

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
    const d = await callAIProxy({
      model: AI_MODEL_FAST,
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
    });
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

async function runAIBrain({ userMessage, invoices, rules, projects, chatHistory, memory, contacts, chartOfAccounts, clientProfile, cashBalance, anomalies, businessType, supabase, companyId, getAccountByRole, recurring, onToolCall }) {
  // ── 1. Truncate history to last 10 turns (5 user + 5 assistant) ───────────────
  const truncatedHistory = chatHistory.slice(-10);

  // ── 2. Classify intent to decide what context to load ────────────────────────
  const intent = await classifyIntent(userMessage, truncatedHistory);

  // ── 3. Build context payload based on intent ──────────────────────────────────
  const needsLedger   = intent === "ledger";
  const needsContacts = intent === "ledger" || intent === "contacts";
  const needsRules    = intent === "ledger" || intent === "rules" || intent === "contacts";

  // The ledger snapshot is ONLY used by the legacy fallback (when tool-calling is
  // unavailable). In tool mode the AI queries the database directly via tools.
  const legacyLedgerSection = needsLedger
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

  // Your memory of past conversations with this user (last ~20 turns, with the
  // actions you took). Reference it naturally; answer "what did you do" from it.
  const memorySection = (memory && memory.length)
    ? `Recent conversation history (your memory of past exchanges with this user):\n${memory.map(m => {
        const when = m.created_at
          ? new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
          : "earlier";
        if (m.role === "user") return `[${when}] User: ${m.content}`;
        const acts = (m.actions && m.actions.length) ? ` — Actions taken: ${m.actions.join("; ")}` : "";
        return `[${when}] Assistant: ${m.content}${acts}`;
      }).join("\n")}`
    : "Recent conversation history: none yet (this is an early conversation).";

  // ── 4. Build system prompt ────────────────────────────────────────────────────
  const _now = new Date();
  const currentYear = _now.getFullYear();
  const todayStr = _now.toISOString().slice(0, 10);
  const profileBlock = formatProfileForPrompt(clientProfile);
  const anomalyList = Array.isArray(anomalies) ? anomalies : [];
  const anomalyBlock = anomalyList.length
    ? `DETECTED ANOMALIES (${anomalyList.length}) — unusual activity flagged automatically. Proactively raise the HIGH-severity ones when relevant; if the user asks "anything unusual?"/"any anomalies?" give the full rundown:\n${anomalyList.slice(0, 12).map(a => `- [${String(a.severity).toUpperCase()}] ${a.title}: ${a.description}`).join("\n")}`
    : "DETECTED ANOMALIES: none right now — the books look normal.";

  const toolMode = !!(supabase && companyId);

  // Build the system prompt. In tool mode the ledger/financial SNAPSHOTS are
  // omitted and the AI is told to query the database via tools; the legacy
  // (no-tools) fallback keeps the snapshots so it can still answer.
  const buildPrompt = (useTools) => {
    const financialsText = useTools ? "" : buildFinancials(invoices, cashBalance).text;
    const ledgerSection = useTools ? "" : legacyLedgerSection;
    const dataRule = useTools
      ? `NEVER invent numbers. You have tools to query this company's live database — ALWAYS call the relevant tool(s) to get exact, complete, current figures BEFORE answering any financial question. Never guess, estimate, or answer from memory or a sample.`
      : `NEVER invent numbers. If you don't have the data, say "I don't have that yet" and tell them how to get it. Only use figures from the snapshot and ledger below.`;
    const fiSource = useTools
      ? `Get these by calling the database tools before you answer — never guess.`
      : `The live figures are in the snapshot below — use them.`;
    const toolsInstruction = useTools
      ? `DATABASE TOOLS — you can query this company's live database directly. Tools available: search_transactions, get_category_totals, get_vendor_summary, get_financial_summary, get_overdue_invoices, get_anomalies, get_tax_summary, get_recurring_transactions. ALWAYS call the relevant tool(s) to get exact, complete, current data BEFORE answering any financial question — never guess or estimate from memory or a sample. The tools return COMPLETE data regardless of how many transactions exist. Call as many as you need, then give your final answer in the JSON format described below.\n\n`
      : ``;
    return `You are Shadow CFO — a world-class CFO and bookkeeper rolled into one, working for a busy business owner. You don't just answer questions; you watch their money like the CFO of a company you personally care about. You know this business deeply and you tell the owner the truth, in plain English, with real numbers.

WHO YOU ARE & HOW YOU TALK:
- Talk like a trusted CFO who knows the business cold — direct, confident, warm, zero jargon. If you must use an accounting term, explain it in the same breath.
- Be specific. Never say "revenue increased" when you can say "revenue increased $4,200 (23%) driven by two new invoices from Acme Corp." Always attach the number, the percentage, and the driver.
- Be honest, even when it's uncomfortable. If the books look concerning, say so plainly: "Your burn rate gives you about 4 months of runway. That's a problem — here's what I'd do."
- ${dataRule}
- Lead with the single most important thing. Keep it tight — busy owners don't read essays.

PROACTIVE INSIGHTS — volunteer these the moment you notice them, even if the owner didn't ask:
- Unusual spending spikes versus prior periods, and which vendor/category drove them.
- A vendor charging more than their usual amount.
- A tax deadline approaching, with the estimated dollar amount due.
- Entries that look like duplicates (same vendor + amount close together).
- Cash runway dropping below 6 months.
- A large expense that may need to be capitalized (>$2,500, useful life >1 year) rather than expensed.
- A vendor that normally appears every month but skipped one (possible service lapse or missed bill).

YOUR FINANCIAL INTELLIGENCE — always stay on top of: current burn rate and runway; the top 5 expense categories this month vs last; overdue invoices and total AR outstanding; upcoming tax deadlines and estimated amounts; whether the books are reconciled; and the difference between cash and accrual (explain it simply only when it actually matters to the answer). ${fiSource}

${toolsInstruction}${AI_SANDBOX_STATEMENT}

RESPONSE FORMAT:
- Lead with the most important thing first, then the supporting detail.
- Use real numbers and percentages, never vague descriptions.
- Keep it concise — a few sentences, not paragraphs.
- When you take an action, confirm EXACTLY what changed and the new state: "Done — I moved the $47 Mailchimp charge from Miscellaneous to Technology & Software. Your tech spend this month is now $5,506."
- When something needs attention, be direct and offer the next step: "You have $8,400 in overdue invoices — the oldest is 47 days past due from Acme Corp. Want me to flag these for follow-up?"

TODAY'S DATE is ${todayStr}. The CURRENT CALENDAR YEAR is ${currentYear}. Whenever a question is about "this year", year-to-date, deductions, or estimated taxes, use ${currentYear} only — include ONLY entries dated ${currentYear}-01-01 through ${currentYear}-12-31 and EXCLUDE every entry from any prior year (e.g. ignore all ${currentYear - 1} entries).

Chart of Accounts:
${(chartOfAccounts || DEFAULT_CHART_OF_ACCOUNTS).map(a => `${a.code} - ${a.name} (${a.category})`).join("\n")}

Available Projects: ${[...PROJECTS, ...projects].filter((v,i,a) => a.indexOf(v) === i).join(", ")}
${businessType ? `\nBUSINESS TYPE: ${businessType}. Tailor your guidance to this kind of business (e.g. SaaS → MRR/runway; Consulting → AR/collections; Restaurant/Retail → COGS/margins).` : ""}

${financialsText ? financialsText + "\n\n" : ""}${anomalyBlock}
${profileBlock ? `\n${profileBlock}\n` : ""}
MEMORY: You have memory of past conversations with this user (shown below as "Recent conversation history"). Reference relevant history naturally when answering questions. If asked what was done previously, answer from the history.

${memorySection}

${rulesSection}

${contactsSection}

${ledgerSection}

Respond ONLY with a JSON object (no markdown). The "reply" field is the ONLY thing the user sees — it must be plain prose with NO JSON, NO action objects, and NO mention of the actions array inside it. Put all machine instructions in the separate "actions" array; never write {"type":...} or "actions" anywhere inside the reply text.
{
  "reply": "Direct, intelligent response in plain English. Always include real numbers from the ledger. No markdown, no asterisks, no headers, no JSON. Write like a trusted CFO talking to their CEO.",
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
    // Recurring: { "type": "add_recurring", "name": "e.g. Office Rent", "vendor": "...", "amount": 4500, "gl_code": "6100", "gl_name": "Rent & Occupancy", "frequency": "monthly|weekly|quarterly|annual", "next_date": "YYYY-MM-DD" }
    // Recurring: { "type": "pause_recurring", "name": "..." }
    // Chart (renders inline in the chat): { "type": "render_chart", "chart_type": "bar|pie|line", "title": "Spending by Category — June 2026", "data": [{"label":"Technology","value":5459},{"label":"Rent","value":742}], "report_view": "category|vendor|pl|cashflow" }
    //   bar = compare categories/vendors; line = a trend over time (monthly burn, revenue); pie = spending distribution. Values are plain numbers (no $). The chart adds a "View full report" button via report_view.
    // CSV (renders a download button inline): { "type": "export_csv", "filename": "spending-by-category-june-2026.csv", "headers": ["Category","Amount","% of Total"], "rows": [["Technology & Software","$5,459","66.7%"]] }
    // Summary (renders a metric card inline): { "type": "render_summary", "title": "Q2 2026 Financial Summary", "metrics": [{"label":"Total Revenue","value":"$0","trend":"flat"},{"label":"Net Income","value":"-$8,165","trend":"down"}], "notes": "Biggest driver is Technology at 66.7% of spend." } — trend is up|down|flat|stable
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

VISUAL OUTPUT — default to a chart or summary when the question is analytical; don't answer in text when a picture is clearer. CRITICAL: the chart/CSV/summary — including the entire "data", "rows", and "metrics" arrays — MUST go in the actions array, NEVER in the reply text. The reply is plain prose only: write one short sentence like "Here's your spending breakdown:" and the chart renders below it automatically. Never write {"type":...}, "data":[...], "report_view", or any JSON inside the reply. Build the data yourself from the ledger (current-year, exclude voided/deleted). Use:
- "show me my spending" / "where is my money going" → render_chart (bar, by category). Set report_view so the chart shows a "View full report" button, but do NOT also emit a navigate action — let the user choose to click through; never auto-navigate when rendering a chart.
- "what does my burn look like over time" / "revenue trend" → render_chart (line, monthly values oldest→newest).
- "what's my biggest expense" / "spending breakdown" → render_chart (pie, distribution).
- "give me a summary of this month/quarter" → render_summary with the key metrics (revenue, expenses, net, burn) and a one-line note on the biggest driver.
- "export my transactions/spending to CSV" → export_csv with real headers and rows.
You may combine a short text reply with one chart/summary/csv. Keep chart data to the few values that matter (top 6–8).

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
- "What can I write off?" / "what are my deductions?" → Use this EXACT logic (it matches the Deductions Tracker in the Tax Center, so your numbers must agree with it to the dollar): include ONLY entries dated in ${currentYear} (${currentYear}-01-01 through ${currentYear}-12-31) — NEVER include any ${currentYear - 1} or earlier entry — and EXCLUDE any voided or deleted entry. Then total each deductible GL account: Salaries & Wages (6000), Rent & Occupancy (6100), Utilities (6200), Marketing & Advertising (6300), Travel & Entertainment (6400 — counted at 50% for the meals rule), Technology & Software (6500), Office Supplies (6600), Insurance (6700), Professional Services (6800), Depreciation & Amortization (6900), Miscellaneous (7100), and Interest Expense (8000). Sum each by its GL code (use the company's actual account numbers if they've been renumbered). Report only the categories that have ${currentYear} spend, with their dollar amounts. The total deductible = sum of all those category amounts WITH Travel & Entertainment counted at 50% (everything else at 100%). There is no separate vehicle/mileage line — vehicle costs live inside the GL accounts above. Do not estimate from vendor/description keywords — go strictly by GL account and the ${currentYear} date filter.
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

PRECISE TRANSACTION TARGETING — this is mandatory: When a user asks you to modify, delete, void, or recode a specific transaction, you MUST identify the exact transaction first. Use search_transactions to find every entry that matches their description. If multiple transactions match, list them all and ask the user to confirm which one before taking any action. Never act on ambiguous references. Example: if user says "delete the Adobe charge" and there are 3 Adobe charges, respond: "I found 3 Adobe charges — which one did you mean? Jun 9 $194.83, May 8 $194.83, or Apr 7 $194.83?" Only proceed (emit the delete/void/recode action) after the user explicitly confirms which one (or explicitly says "all"). The app also blocks any modify action that resolves to more than one entry without explicit confirmation, so you must disambiguate first.

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
  };

  // ── 5. Call the main model ────────────────────────────────────────────────────
  const baseMessages = [
    ...truncatedHistory.map(m => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage }
  ];

  // ── 5a. Tool-calling path (industry standard): the AI queries the DB directly ──
  if (toolMode) {
    try {
      let _ledger = null;
      const ctx = {
        supabase, companyId, chartOfAccounts, getAccountByRole, cashBalance, anomalies, recurring,
        getLedger: async () => { if (!_ledger) _ledger = await fetchLedger(supabase, companyId, chartOfAccounts); return _ledger; },
      };
      const systemPrompt = buildPrompt(true);
      const messages = baseMessages.map(m => ({ ...m }));
      let lastText = "";
      // Loop: call → if tool_use, execute tools and feed results back → repeat → final text.
      for (let turn = 0; turn < 6; turn++) {
        const data = await callAIProxy({ model: AI_MODEL, max_tokens: 4000, system: systemPrompt, messages, tools: AI_TOOLS });
        const blocks = Array.isArray(data.content) ? data.content : [];
        const tb = [...blocks].reverse().find(b => b.type === "text");
        if (tb?.text) lastText = tb.text;
        const toolUses = blocks.filter(b => b.type === "tool_use");
        if (data.stop_reason === "tool_use" && toolUses.length) {
          messages.push({ role: "assistant", content: blocks });
          const toolResults = [];
          for (const tu of toolUses) {
            let out;
            try { if (onToolCall) onToolCall(tu.name, tu.input || {}); out = await executeAITool(tu.name, tu.input || {}, ctx); }
            catch (e) { out = { error: String(e?.message || e) }; }
            toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 50000) });
          }
          messages.push({ role: "user", content: toolResults });
          continue;
        }
        if (!lastText) throw new Error("Empty tool-loop response");
        return parseAIReply(lastText);
      }
      return parseAIReply(lastText || "");
    } catch (e) {
      // Backwards-compatible fallback: if anything in the tool path fails, fall back
      // to the legacy single call with the ledger snapshot baked into the prompt.
      console.warn("[ai] tool path failed, falling back to ledger snapshot:", e?.message || e);
    }
  }

  // ── 5b. Legacy single-call path (no tools; ledger + financial snapshot in prompt) ──
  const data = await callAIProxy({ model: AI_MODEL, max_tokens: 4000, system: buildPrompt(false), messages: baseMessages });
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("AI returned an empty response. Check that the ai-proxy edge function and model are configured.");
  return parseAIReply(text);
}

export { classifyIntent, runAIBrain, callAIProxy, okAIResponse };
