import { getAuthHeaders } from "./supabase";
import { DEFAULT_CHART_OF_ACCOUNTS, PROJECTS, AI_PROXY_URL } from "./constants";
import { formatProfileForPrompt } from "./clientProfile";
import { fmtSignedMoney, todayLocal } from "./format";
import { fetchLedger } from "./ledger";
import { executeAITool } from "./aiTools";
import { classifyAIFailure } from "./aiFailure";
import {
  computeRevenue, computeExpenses, computeNetIncome, computeCategoryTotals,
  computeBurnRate, computeRunway, computeAR,
} from "./reports";

// Build a compact live financial snapshot from the full ledger so the AI always
// answers with REAL numbers (burn, runway, top categories MoM, overdue AR, net).
// Every figure flows through the canonical layer (reports.js) so the snapshot the
// AI sees is identical to the dashboard and the reports. cashBalance from the app.
function buildFinancials(invoices, cashBalance) {
  const now = new Date();
  const today = todayLocal();            // local period boundaries (were toISOString UTC)
  const thisMonth = today.slice(0, 7);
  const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonth = `${lm.getFullYear()}-${String(lm.getMonth() + 1).padStart(2, "0")}`;   // local month key
  const year = String(now.getFullYear());
  const money = n => fmtSignedMoney(n);   // canonical cents (was ad-hoc whole-dollar)
  const monthRange = ym => ({ from: `${ym}-01`, to: `${ym}-31` });

  const yearRange = { from: `${year}-01-01`, to: `${year}-12-31` };
  const revYTD = computeRevenue(invoices, yearRange);
  const expYTD = computeExpenses(invoices, yearRange);
  const netYTD = computeNetIncome(invoices, yearRange);
  const cash = Number(cashBalance) || 0;   // GL cash on hand, passed in from the app
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
    // ★★ CARRY THE STRUCTURE THROUGH THE THROW. This flattened everything into
    // `AI service error (429 Too Many Requests): …` — jargon on an owner surface, and it
    // discarded the fields the proxy had gone to the trouble of sending (`blocked_bucket`,
    // `resets_in_minutes` — O113a). Four situations needing four different responses
    // arrived as one string, so callers could only ever say one thing about them.
    let body = null, detail = "";
    try { body = await res.json(); detail = body?.error?.message || body?.error || body?.message || JSON.stringify(body); }
    catch { try { detail = await res.text(); } catch {} }
    const err = new Error(`AI service error (${res.status} ${res.statusText})${detail ? `: ${detail}` : ""}`);
    err.status = res.status;              // `classifyFailure` (intakeDrain) already reads this
    err.aiFailure = classifyAIFailure({ status: res.status, body, message: detail });
    throw err;
  }
  const data = await res.json();
  if (data?.error) {
    const err = new Error(`AI error: ${data.error.message || data.error}`);
    err.aiFailure = classifyAIFailure({ status: 200, body: data, message: data.error.message || data.error });
    throw err;
  }
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
    // Model + system are SERVER-OWNED (profile "classifier" in ai-proxy/aiProfiles.js).
    const d = await callAIProxy({
      profile: "classifier",
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

  // ── 4. Build the DATA context ─────────────────────────────────────────────────
  // The CFO instruction prompt lives SERVER-SIDE (profile "chat-brain" /
  // "chat-brain-fallback" in ai-proxy/aiProfiles.js). The client builds ONLY the
  // live-data context and passes it as the {{LEDGER_CONTEXT}} untrusted data slot,
  // so document-derived vendor/description/memo strings can never sit in
  // instruction position (CR-10). Today's date + calendar year are computed
  // server-side too.
  const profileBlock = formatProfileForPrompt(clientProfile);
  const anomalyList = Array.isArray(anomalies) ? anomalies : [];
  const anomalyBlock = anomalyList.length
    ? `DETECTED ANOMALIES (${anomalyList.length}) — unusual activity flagged automatically. Proactively raise the HIGH-severity ones when relevant; if the user asks "anything unusual?"/"any anomalies?" give the full rundown:\n${anomalyList.slice(0, 12).map(a => `- [${String(a.severity).toUpperCase()}] ${a.title}: ${a.description}`).join("\n")}`
    : "DETECTED ANOMALIES: none right now — the books look normal.";

  const toolMode = !!(supabase && companyId);

  // Build the DATA context only. In tool mode the ledger/financial SNAPSHOTS are
  // omitted (the AI queries the DB via server-owned tools); the legacy (no-tools)
  // fallback keeps the snapshots so it can still answer. The instruction prompt is
  // server-owned; this string becomes the {{LEDGER_CONTEXT}} untrusted data slot.
  const buildContext = (useTools) => {
    const financialsText = useTools ? "" : buildFinancials(invoices, cashBalance).text;
    const ledgerSection = useTools ? "" : legacyLedgerSection;
    const coaList = (chartOfAccounts || DEFAULT_CHART_OF_ACCOUNTS).map(a => `${a.code} - ${a.name} (${a.category})`).join("\n");
    const projectsList = [...PROJECTS, ...projects].filter((v, i, a) => a.indexOf(v) === i).join(", ");
    return `Chart of Accounts:
${coaList}

Available Projects: ${projectsList}
${businessType ? `\nBUSINESS TYPE: ${businessType}. Tailor your guidance to this kind of business (e.g. SaaS → MRR/runway; Consulting → AR/collections; Restaurant/Retail → COGS/margins).` : ""}

${financialsText ? financialsText + "\n\n" : ""}${anomalyBlock}
${profileBlock ? `\n${profileBlock}\n` : ""}
${memorySection}

${rulesSection}

${contactsSection}

${ledgerSection}`;
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
      const ledgerContext = buildContext(true);
      const messages = baseMessages.map(m => ({ ...m }));
      let lastText = "";
      // Loop: call → if tool_use, execute tools and feed results back → repeat → final text.
      // model + max_tokens + system (instructions) + tools are ALL server-owned
      // (profile "chat-brain"); the client sends only the live-data context as the
      // {{LEDGER_CONTEXT}} untrusted slot + the conversation messages.
      for (let turn = 0; turn < 6; turn++) {
        const data = await callAIProxy({ profile: "chat-brain", clientToday: todayLocal(), slots: { LEDGER_CONTEXT: ledgerContext }, messages });
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
  const data = await callAIProxy({ profile: "chat-brain-fallback", clientToday: todayLocal(), slots: { LEDGER_CONTEXT: buildContext(false) }, messages: baseMessages });
  const text = data.content?.find(b => b.type === "text")?.text;
  if (!text) throw new Error("AI returned an empty response. Check that the ai-proxy edge function and model are configured.");
  return parseAIReply(text);
}

export { classifyIntent, runAIBrain, callAIProxy, okAIResponse };
