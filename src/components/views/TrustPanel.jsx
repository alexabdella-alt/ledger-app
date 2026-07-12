import React from "react";
import { useERP } from "../ERPContext";
import { monthLabel } from "../../lib/ownerTrust";

// ─────────────────────────────────────────────────────────────────────────────
// O90 — OWNER TRUST PANEL (CR-27). The owner's at-a-glance "my books are handled
// and correct." A plain-language PROJECTION of the same trust data the CPA's
// ReviewView works (via `ownerTrust` / `ownerTrustState`, which runs the SAME
// evaluateSignOff gate) — reassurance, not a work queue. Shows green ONLY when all
// three nets clear; otherwise one honest, jargon-free line per net + at most one
// gentle "needs you" nudge. No GL codes, no confidence %, no accounting machinery.
// ─────────────────────────────────────────────────────────────────────────────

const TONE = {
  all_clear:   { color: "var(--sc-success)", soft: "var(--sc-success-soft)", glyph: "✓", label: "All handled" },
  in_progress: { color: "var(--sc-gold)",    soft: "var(--sc-gold-soft)",    glyph: "•", label: "Finishing up" },
  attention:   { color: "var(--sc-warning)", soft: "var(--sc-warning-soft)", glyph: "!", label: "Needs a look" },
};

// One status row. `state`: "ok" (green ✓), "info" (neutral, e.g. awaiting sign-off),
// or "attention" (amber •). Never red — this is reassurance, not alarm.
function Line({ state, title, text }) {
  const c = state === "ok" ? "var(--sc-success)" : state === "attention" ? "var(--sc-warning)" : "var(--sc-text-mut)";
  const glyph = state === "ok" ? "✓" : state === "attention" ? "•" : "◦";
  return (
    <div style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "11px 0" }}>
      <span style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "var(--sc-on-accent)", background: c }}>{glyph}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: "var(--sc-text-mut)", textTransform: "uppercase", marginBottom: 2 }}>{title}</div>
        <div style={{ fontSize: 14, color: "var(--sc-text)", lineHeight: 1.45 }}>{text}</div>
      </div>
    </div>
  );
}

export default function TrustPanel() {
  const { ownerTrust, onViewChange, setView } = useERP();
  if (!ownerTrust) return null;

  const { overall, headline, reviewedThrough, lines, nudge } = ownerTrust;
  const tone = TONE[overall] || TONE.attention;
  const goReview = () => (onViewChange ? onViewChange("review") : setView && setView("review"));
  const signedLabel = monthLabel(reviewedThrough);

  return (
    <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 16, padding: "20px 22px", marginBottom: 20 }} className="sc-card">
      {/* Headline + overall status */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap" }}>
        <span style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: "var(--sc-on-accent)", background: tone.color }}>{tone.glyph}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--sc-text)", lineHeight: 1.3 }}>{headline}</div>
          <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 2 }}>Your books, at a glance</div>
        </div>
        {/* Reassurance-at-a-glance: reviewed-through badge (only when genuinely signed off) */}
        {signedLabel && (
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-success)", background: "var(--sc-success-soft)", border: "1px solid var(--sc-success-soft)", borderRadius: 20, padding: "5px 12px", whiteSpace: "nowrap" }}>
            ✓ Reviewed through {signedLabel}
          </span>
        )}
      </div>

      {/* The three nets, in plain language (tri-state markers: ok / info / attention) */}
      <div style={{ marginTop: 14, borderTop: "1px solid var(--sc-border)", paddingTop: 4 }}>
        <Line state={lines.captured.state} title="Documents" text={lines.captured.text} />
        <div style={{ borderTop: "1px solid var(--sc-border)" }} />
        <Line state={lines.reviewed.state} title="Reviewed" text={lines.reviewed.text} />
        <div style={{ borderTop: "1px solid var(--sc-border)" }} />
        <Line state={lines.correct.state} title="Nothing wrong" text={lines.correct.text} />
      </div>

      {/* At most ONE gentle nudge (owner-actionable — a clarification to answer) */}
      {nudge && (
        <button onClick={goReview}
          style={{ marginTop: 14, width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold)", borderRadius: 12, padding: "12px 16px", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--sc-text)" }}>{lines.correct.text}</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--sc-gold)", whiteSpace: "nowrap" }}>{nudge.text} →</span>
        </button>
      )}
    </div>
  );
}
