import React from "react";
import { useERP } from "../ERPContext";
import { loadCompleteness } from "../../lib/completenessLoad";
import { ownerMonthLines } from "../../lib/completeness";

// ─────────────────────────────────────────────────────────────────────────────
// ★ C740 — THE OWNER'S MONTHS. Replaces the sign-off panel on Reports (operator, 2026-11-18: "I don't
// think this seems right for that 'couple things need a look' stuff"). One line per month, read from
// the same completeness report as the operator's page: complete, waiting on you (only what the owner
// can do — drop a statement), or our team finishing it. The owner never signs anything off; the
// operator closes months. A read that fails says so — it is never shown as "complete".
// ─────────────────────────────────────────────────────────────────────────────
const TONE = {
  done:     { c: "var(--sc-success)", g: "✓" },
  closed:   { c: "var(--sc-success)", g: "🔒" },
  you:      { c: "var(--sc-warning)", g: "•" },
  team:     { c: "var(--sc-text-2)",  g: "…" },
  progress: { c: "var(--sc-text-2)",  g: "…" },
};

export function MonthStatusView({ state }) {
  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "16px 20px", marginBottom: 20 };
  if (!state || state.loading) return <div data-month-status="loading" style={{ ...card, fontSize: 13, color: "var(--sc-text-2)" }}>Checking your months…</div>;
  if (state.failed) return <div data-month-status="failed" style={{ ...card, fontSize: 13, color: "var(--sc-text-2)" }}>We couldn't check your months just now — that's not a sign anything is wrong. Reload the page to try again.</div>;
  const r = (state.report || [])[0];
  if (!r || r.status === "empty") return null;
  const lines = ownerMonthLines([...(r.months || [])].reverse());   // C749 — a run of months says it once
  if (!lines.length) return null;
  return (
    <div data-month-status="ready" style={card}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--sc-text)" }}>Your months</div>
      <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2, marginBottom: 8 }}>A month is complete when every upload is in your books and it matches your bank to the penny.</div>
      {lines.map((l, i) => (
        <div key={i} data-month-line={l.tone} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "6px 0", borderTop: i ? "1px solid var(--sc-surface-2)" : "none", fontSize: 13, color: "var(--sc-text)" }}>
          <span style={{ color: TONE[l.tone]?.c, fontWeight: 700, width: 16, flexShrink: 0, textAlign: "center" }}>{TONE[l.tone]?.g}</span>
          <span>{l.text}</span>
        </div>
      ))}
    </div>
  );
}

export default function MonthStatus() {
  const { supabase, currentCompany } = useERP();
  const [state, setState] = React.useState({ loading: true });
  React.useEffect(() => {
    let cancelled = false;
    if (!currentCompany?.id || !supabase) return undefined;
    setState({ loading: true });
    loadCompleteness(supabase, new Date(), { companyId: currentCompany.id })
      .then((r) => { if (!cancelled) setState(r); })
      .catch((e) => { if (!cancelled) setState({ loading: false, failed: [String(e?.message || e)] }); });
    return () => { cancelled = true; };
  }, [currentCompany?.id, supabase]);
  return <MonthStatusView state={state} />;
}
