import React from "react";
import { useERP } from "../ERPContext";
import { loadCompleteness } from "../../lib/completenessLoad";
import { ownerBooksStatus, OWNER_BOOKS_COPY } from "../../lib/completeness";

// ─────────────────────────────────────────────────────────────────────────────
// ★ C740 — THE OWNER'S MONTHS. Replaces the sign-off panel on Reports (operator, 2026-11-18: "I don't
// think this seems right for that 'couple things need a look' stuff"). One line per month, read from
// the same completeness report as the operator's page: complete, waiting on you (only what the owner
// can do — drop a statement), or our team finishing it. The owner never signs anything off; the
// operator closes months. A read that fails says so — it is never shown as "complete".
// ─────────────────────────────────────────────────────────────────────────────
// ★ C759 — "Your books": what we need from the owner (only things they can do), and one line each for
// the months that match the bank and the months our team is still checking. No "closed", no "complete
// vs closed", nothing about sign-off, and nothing about the month that isn't over (lib/completeness.js
// ownerBooksStatus). The read failing says so — never shown as fine.
const ymNow = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

export function MonthStatusView({ state, now = new Date(), onUpload = null }) {
  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "16px 20px", marginBottom: 20 };
  if (!state || state.loading) return <div data-month-status="loading" style={{ ...card, fontSize: 13, color: "var(--sc-text-2)" }}>Checking your books…</div>;
  if (state.failed) return <div data-month-status="failed" style={{ ...card, fontSize: 13, color: "var(--sc-text-2)" }}>We couldn't check your books just now — that's not a sign anything is wrong. Reload the page to try again.</div>;
  const r = (state.report || [])[0];
  if (!r || r.status === "empty") return null;
  const st = ownerBooksStatus(r.months || [], { current: ymNow(now) });
  if (!st.need.length && !st.matched && !st.reviewing) return null;
  const row = { display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", fontSize: 13, color: "var(--sc-text)" };
  return (
    <div data-month-status="ready" style={card}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sc-text)", marginBottom: 6 }}>{OWNER_BOOKS_COPY.title}</div>
      {st.need.length ? (
        <div data-books-need>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-warning)", margin: "2px 0 2px" }}>{OWNER_BOOKS_COPY.needHead}</div>
          {st.need.map((l, i) => (
            <div key={i} data-month-line="you" style={row}>
              <span style={{ color: "var(--sc-warning)", fontWeight: 700, width: 16, flexShrink: 0, textAlign: "center" }}>•</span>
              <span>{l.text}</span>
            </div>
          ))}
          {onUpload && <button data-books-upload onClick={onUpload} style={{ marginTop: 6, marginLeft: 26, padding: "7px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", background: "var(--sc-gold)", color: "var(--sc-on-accent)", cursor: "pointer" }}>{OWNER_BOOKS_COPY.upload}</button>}
        </div>
      ) : (
        <div data-books-nothing style={row}><span style={{ color: "var(--sc-success)", fontWeight: 700, width: 16, flexShrink: 0, textAlign: "center" }}>✓</span><span>{OWNER_BOOKS_COPY.nothing}</span></div>
      )}
      {(st.matched || st.reviewing) && <div style={{ borderTop: "1px solid var(--sc-surface-2)", marginTop: 8, paddingTop: 4 }}>
        {st.matched && <div data-month-line="matched" style={row}><span style={{ color: "var(--sc-success)", fontWeight: 700, width: 16, flexShrink: 0, textAlign: "center" }}>✓</span><span>{OWNER_BOOKS_COPY.matched(st.matched)}</span></div>}
        {st.reviewing && <div data-month-line="team" style={{ ...row, color: "var(--sc-text-2)" }}><span style={{ fontWeight: 700, width: 16, flexShrink: 0, textAlign: "center" }}>…</span><span>{OWNER_BOOKS_COPY.reviewing(st.reviewing)}</span></div>}
      </div>}
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
  return <MonthStatusView state={state} onUpload={setView ? () => setView("home") : null} />;
}
