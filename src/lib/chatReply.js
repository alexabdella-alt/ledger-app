// The chatbot must NEVER claim an action succeeded unless the underlying write actually
// committed. The AI's free-text `reply` is generated BEFORE/independent of tool execution
// (it predicts success), so it can't be trusted as the success signal on its own. This
// composes the message shown to the user from the VERIFIED result of the action loop:
// if any mutating action failed to commit, surface that instead of the AI's optimistic
// "✓ done." (Trust-layer principle — never report a write that didn't happen; ties O60.)
export function composeAssistantReply({ reply, actionFailures = [], actionSummary = [] } = {}) {
  if (Array.isArray(actionFailures) && actionFailures.length) {
    const failed = actionFailures.join(", ");
    const applied = (actionSummary && actionSummary.length)
      ? ` (Other changes did apply: ${actionSummary.join("; ")}.)`
      : "";
    return `⚠️ That didn't go through — I couldn't save ${failed}, so ${actionFailures.length === 1 ? "it wasn't" : "those weren't"} changed.${applied} Please try again, or check your connection/permissions.`;
  }
  return reply || "Done!";
}
