// ─────────────────────────────────────────────────────────────────────────────
// AI sandbox: the single source of truth for what the assistant is allowed to do.
// Used in three places so they can never drift apart:
//   1. The action-processing loop (hard whitelist — anything else is refused + logged)
//   2. The system prompt (the AI is told it is sandboxed to this exact list)
//   3. The user-facing "AI Capability Document" (help/info panel)
// ─────────────────────────────────────────────────────────────────────────────

// Every action type the app actually implements a handler for. The AI may emit
// ONLY these; the loop refuses (and logs) anything outside this set.
export const AI_ALLOWED_ACTIONS = [
  "none",
  "navigate",
  "recode",
  "retag_project",
  "add_account",
  "add_rule",
  "delete_rule",
  "delete_invoice",   // soft-delete (recoverable)
  "void_invoice",     // void (keeps record, zeroes effect)
  "reverse_entry",    // GAAP reversing entry
  "delete_contract",  // soft-delete a contract
  "add_recurring",
  "pause_recurring",
  "add_contact",
  "update_contact",
  "set_contact_rule",
  // Display-only outputs (render in the chat, never mutate data):
  "render_chart",
  "export_csv",
  "render_summary",
];

export const AI_ALLOWED_ACTIONS_SET = new Set(AI_ALLOWED_ACTIONS);

export const isAllowedAIAction = (type) => AI_ALLOWED_ACTIONS_SET.has(String(type || ""));

// Max items a single AI request may delete/void at once (bulk-delete protection).
export const AI_BULK_LIMIT = 3;

// Dropped verbatim into the system prompt.
export const AI_SANDBOX_STATEMENT =
`YOU ARE SANDBOXED. You can ONLY execute actions from this exact list: recode, retag_project, add_account, add_rule, delete_rule, delete_invoice (soft-delete, recoverable), void_invoice, reverse_entry, delete_contract, add_recurring, pause_recurring, add_contact, update_contact, set_contact_rule, render_chart, export_csv, render_summary, navigate, none. Any other action you suggest will be REFUSED and logged. You cannot modify the app's code or settings, you cannot access any other company's data, you cannot send emails or any external communication, you cannot process payments or move money, you cannot change database structure or security rules, you cannot delete or void more than ${AI_BULK_LIMIT} items in one request, and you cannot modify a reconciled/locked period without the user explicitly unlocking it first. If a user asks for something outside these limits, say plainly that you can't do it and explain what you can do instead.`;

// Plain-English capability document — shown to users and used as internal docs.
export const AI_CAPABILITIES = {
  canTitle: "Here's what I can help you with:",
  can: [
    "Recode transactions — move one or more entries to a different GL account.",
    "Void a transaction — keep the record for the audit trail but cancel its effect.",
    "Delete a transaction — soft-delete (recoverable from the audit trail).",
    "Reverse an entry — create a proper GAAP reversing journal entry.",
    "Create vendor coding rules so future transactions from a vendor are coded automatically.",
    "Add a new GL account to your chart of accounts.",
    "Add or update vendors and customers, and set their default coding.",
    "Set up or pause recurring transactions (rent, subscriptions, etc.).",
    "Navigate you to any page — Books, Reports, Tax Center, reconciliation, and more.",
    "Answer any question about your books with real numbers — burn, runway, P&L, AR, taxes.",
    "Draw charts right in the chat — spending by category, vendor comparisons, burn over time.",
    "Build you a CSV export and a quick summary card without leaving the conversation.",
    "Spot recurring charges and offer to set them up so they're always expected and auto-coded.",
    "Proactively flag issues — duplicates, spending spikes, low runway, upcoming tax deadlines.",
  ],
  cannotTitle: "What the assistant cannot do",
  cannot: [
    "Modify the app's code, settings, or security rules.",
    "Access or reveal any other company's data — it only ever sees your books.",
    "Send emails or any external communication on your behalf.",
    "Process payments or move money.",
    "Change the database structure or row-level security policies.",
    "Delete or void more than 3 items in a single request (a safety guardrail).",
    "Modify a reconciled or locked period unless you explicitly unlock it first.",
    "Make up numbers — if it doesn't have the data, it will tell you.",
  ],
};
