import React from "react";
import { useERP } from "../ERPContext";
import { loadCompleteness } from "../../lib/completenessLoad";
import { ownerBooksStatus, REPORTS_TRUST_COPY } from "../../lib/completeness";

// ─────────────────────────────────────────────────────────────────────────────
// ★ C740 → C759 → C761 — WHAT AN OWNER SEES OF THEIR MONTHS, read from the same completeness report as
// the operator's page. C740 listed every month (complete / closed / our team finishing); C759 made it
// "what we need from you" + "matched"; C761 moved the asking to Home and left Reports one line — how
// far the figures match the bank. The owner never signs anything off and never sees our process.
// ─────────────────────────────────────────────────────────────────────────────
// ★ C761 — ON REPORTS, ONE LINE: how far the figures match the bank, and — if we need something —
// a pointer to Home, where the asking lives. Nothing while loading or if the read failed (it never
// claims the books match on a read it didn't make). No "our team is checking": that is our process,
// not the owner's business.
const ymNow = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function MonthStatusView({ state, now = new Date(), onSeeHome = null }) {
  if (!state || state.loading || state.failed) return null;
  const r = (state.report || [])[0];
  if (!r || r.status === "empty") return null;
  const st = ownerBooksStatus(r.months || [], { current: ymNow(now) });
  const ok = !!st.matchedThrough;
  return (
    <div data-month-status="ready" data-matched-through={st.matchedThrough || ""} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 13, color: "var(--sc-text-2)", marginBottom: 14 }}>
      <span style={{ color: ok ? "var(--sc-success)" : "var(--sc-text-2)", fontWeight: 700 }}>{ok ? "✓" : "•"}</span>
      <span style={{ color: "var(--sc-text)" }}>{ok ? REPORTS_TRUST_COPY.through(st.matchedThrough) : REPORTS_TRUST_COPY.none}</span>
      {st.need.length > 0 && <span>{REPORTS_TRUST_COPY.needs}</span>}
      {st.need.length > 0 && onSeeHome && <button data-books-see-home onClick={onSeeHome} style={{ background: "none", border: "none", padding: 0, color: "var(--sc-gold)", fontWeight: 600, fontSize: 13, cursor: "pointer" }}>{REPORTS_TRUST_COPY.seeHome}</button>}
    </div>
  );
}

// C760 — the completeness read for THIS company, shared by "Your books" (Reports) and Home's
// "We need from you". `enabled: false` (the accountant's seat) reads nothing.
export function useCompletenessState(enabled = true) {
  const { supabase, currentCompany } = useERP();
  const [state, setState] = React.useState({ loading: true });
  React.useEffect(() => {
    let cancelled = false;
    if (!enabled || !currentCompany?.id || !supabase) return undefined;
    setState({ loading: true });
    loadCompleteness(supabase, new Date(), { companyId: currentCompany.id })
      .then((r) => { if (!cancelled) setState(r); })
      .catch((e) => { if (!cancelled) setState({ loading: false, failed: [String(e?.message || e)] }); });
    return () => { cancelled = true; };
  }, [enabled, currentCompany?.id, supabase]);
  return state;
}

// The specific statements we need from the owner, for Home (empty while loading or if the read failed).
export function statementNeedsFrom(state, now = new Date()) {
  const r = state && !state.loading && !state.failed ? (state.report || [])[0] : null;
  return r ? ownerBooksStatus(r.months || [], { current: ymNow(now) }).need : [];
}

export default function MonthStatus() {
  const { setView } = useERP();
  const state = useCompletenessState(true);
  return <MonthStatusView state={state} onSeeHome={setView ? () => setView("home") : null} />;
}
