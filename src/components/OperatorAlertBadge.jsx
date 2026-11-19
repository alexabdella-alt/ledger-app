import React from "react";
import { loadCompleteness } from "../lib/completenessLoad";
import { completenessSummary } from "../lib/completeness";

// ─────────────────────────────────────────────────────────────────────────────
// ★ C742 — THE OPERATOR SEES A HOLE WITHOUT GOING TO LOOK. For a platform admin only: the top bar
// shows "⚠ N clients need you" when any client has something missing (the Completeness page's red),
// checked on sign-in and every 15 minutes, and opens Operations. Nothing shown while checking, when
// nothing is missing, or when the check couldn't run (a quiet "couldn't check" chip instead — a
// failed check must never read as "all clear", and must never shout either).
// ─────────────────────────────────────────────────────────────────────────────
export const OPERATOR_CHECK_MINUTES = 15;

export function operatorBadgeState(result) {
  if (!result || result.loading) return null;
  if (result.failed) return { tone: "unknown", text: "Couldn't check clients", short: "Couldn't check" };
  const n = completenessSummary(result.report || []).problem;
  return n > 0 ? { tone: "problem", text: `⚠ ${n} client${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} you`, short: `⚠ ${n}` } : null;
}

export default function OperatorAlertBadge({ supabase, onOpen }) {
  const [badge, setBadge] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    const check = () => loadCompleteness(supabase, new Date())
      .then((r) => { if (!cancelled) setBadge(operatorBadgeState(r)); })
      .catch(() => { if (!cancelled) setBadge(operatorBadgeState({ failed: ["check threw"] })); });
    check();
    const t = setInterval(check, OPERATOR_CHECK_MINUTES * 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [supabase]);
  if (!badge) return null;
  const red = badge.tone === "problem";
  return (
    <button data-operator-badge={badge.tone} onClick={onOpen} title="Open Operations → Completeness" aria-label={badge.text}
      style={{ padding: "7px 12px", borderRadius: 9, fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer",
        background: red ? "var(--sc-error-soft)" : "transparent", color: red ? "var(--sc-error)" : "var(--sc-text-mut)",
        border: `1px solid ${red ? "var(--sc-error)" : "var(--sc-border)"}` }}>
      {/* ★ C746 — on a phone the full sentence doesn't fit the top bar; the count does. It used to be
          hidden there entirely (found on the live app at 674px: "⚠ 7 clients need you", invisible). */}
      <span className="sc-hide-narrow">{badge.text}</span><span className="sc-show-narrow">{badge.short}</span>
    </button>
  );
}
