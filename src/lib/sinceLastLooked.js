// ─────────────────────────────────────────────────────────────────────────────
// ★ C731 — "WHAT'S CHANGED SINCE YOU LAST LOOKED" (the accountant's Home).
// A reviewer opening a client's books asks one question first: what happened since I was last
// here? The activity feed answered "everything, newest first" and left them to remember where
// they stopped. This marks the rows newer than the last visit and says how many there are.
// The last-visit time is a per-browser convenience (it can be missing: first visit, private
// window, cleared storage) — then nothing is marked and the header says "Latest changes",
// never a false "nothing new". Pure.
// ─────────────────────────────────────────────────────────────────────────────

export function markNewSince(items = [], lastSeen = null) {
  const t = lastSeen ? Date.parse(lastSeen) : NaN;
  if (!Number.isFinite(t)) return { items: (items || []).map((i) => ({ ...i, isNew: false })), newCount: 0, firstVisit: true };
  const out = (items || []).map((i) => {
    const v = Date.parse(i && i.ts ? i.ts : "");
    return { ...i, isNew: Number.isFinite(v) && v > t };
  });
  return { items: out, newCount: out.filter((i) => i.isNew).length, firstVisit: false };
}

export function sinceLastLookedHeader({ newCount = 0, firstVisit = true } = {}) {
  if (firstVisit) return "Latest changes";
  if (newCount > 0) return `${newCount} new since you last looked`;
  return "Nothing new since you last looked";
}
