import React from "react";
import { t } from "../../lib/theme.js";
import { useCountUp } from "../../lib/useCountUp.js";

// StatCard — the SIGNATURE component of Shadow's dashboard. A tiny uppercase eyebrow
// over an oversized, count-up money figure in tabular mono, with a hairline gold rule.
// The number is the hero; gold is reserved for the primary/cash figure. Clicking drills.
//
// props: eyebrow, value (number), format (n→string), sub, accent ("gold"|"success"|
//        "error"|"text"), onClick, index (stagger), decimals
export default function StatCard({
  eyebrow, value = 0, format = (n) => n, sub, accent = "text", color,
  onClick, index = 0, decimals = 0,
}) {
  const n = useCountUp(Number(value) || 0, { duration: 1000, decimals });
  const figureColor = color || (
    accent === "gold" ? t.gold :
    accent === "success" ? t.success :
    accent === "error" ? t.error : t.text);
  const isHero = accent === "gold";

  return (
    <div
      className={`sc-card sc-rise-${Math.min(4, index + 1)}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } } : undefined}
      style={{
        position: "relative",
        background: t.surface,
        border: `1px solid ${isHero ? "var(--sc-gold-line)" : t.border}`,
        borderRadius: t.rLg,
        padding: "20px 22px 22px",
        cursor: onClick ? "pointer" : "default",
        overflow: "hidden",
        boxShadow: isHero ? t.glow : t.shadow,
      }}
    >
      {/* gold corner accent on the hero card */}
      {isHero && (
        <div aria-hidden style={{ position: "absolute", top: 0, right: 0, width: 120, height: 120, background: "radial-gradient(120px 120px at 100% 0%, var(--sc-gold-glow), transparent 70%)", pointerEvents: "none" }} />
      )}
      <div className="sc-eyebrow" style={{ marginBottom: 14 }}>{eyebrow}</div>
      <div
        className="sc-mono"
        style={{ fontSize: "clamp(34px, 4vw, 52px)", fontWeight: 500, lineHeight: 1, color: figureColor, letterSpacing: "-0.02em" }}
      >
        {format(n)}
      </div>
      <div style={{ height: 2, width: isHero ? 44 : 26, marginTop: 14, borderRadius: 2, background: isHero ? "linear-gradient(90deg, var(--sc-gold), transparent)" : t.border2 }} />
      {sub && <div style={{ marginTop: 12, fontSize: 12.5, color: t.textMut }}>{sub}</div>}
    </div>
  );
}
