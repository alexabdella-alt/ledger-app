// The chatbot must NEVER claim an action succeeded unless the underlying write actually
// committed. The AI's free-text `reply` is generated BEFORE/independent of tool execution
// (it predicts success), so it can't be trusted as the success signal on its own. This
// composes the message shown to the user from the VERIFIED result of the action loop:
// if any mutating action failed to commit, surface that instead of the AI's optimistic
// "✓ done." (Trust-layer principle — never report a write that didn't happen; ties O60.)
export function composeAssistantReply({ reply, actionFailures = [], actionSummary = [] } = {}) {
  if (Array.isArray(actionFailures) && actionFailures.length) {
    // A failure is either a bare label (most callers) or `{ label, reason }`.
    const failed = actionFailures.map((f) => (f && f.label) || f).join(", ");
    const applied = (actionSummary && actionSummary.length)
      ? ` (Other changes did apply: ${actionSummary.join("; ")}.)`
      : "";
    // ★★ C546 — THE TAIL NAMED A CAUSE NOBODY HAD ESTABLISHED. "check your connection/permissions"
    // was appended to EVERY failure, and the live one it was appended to was neither: the
    // executor had resolved no transactions at all. §9 forbids exactly this (a claim about the
    // world derived from nothing), and `O114` records what it costs — an invented reason made a
    // whole drive undiagnosable, because everyone went looking where the sentence pointed.
    // A failure whose reason we KNOW says it; one we do not is left unexplained rather than
    // explained wrongly.
    const reason = actionFailures.map((f) => (f && f.reason) || "").find(Boolean);
    const tail = reason ? ` ${reason}` : " Nothing else changed.";
    return `⚠️ That didn't go through — I couldn't save ${failed}, so ${actionFailures.length === 1 ? "it wasn't" : "those weren't"} changed.${applied}${tail}`;
  }
  return reply || "Done!";
}
