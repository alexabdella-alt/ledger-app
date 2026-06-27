import React from "react";
import { t } from "../../lib/theme.js";

// Card — the standard dark-slate surface. `hover` opts into the gold-edged lift
// (.sc-card). `glow` gives the gold-ringed hero treatment. Optional eyebrow header.
export default function Card({ hover = false, glow = false, eyebrow, pad = "20px 22px", style, children, ...rest }) {
  return (
    <div
      className={hover ? "sc-card" : undefined}
      style={{
        background: t.surface,
        border: `1px solid ${glow ? "var(--sc-gold-line)" : t.border}`,
        borderRadius: t.rLg,
        boxShadow: glow ? t.glow : t.shadow,
        padding: pad,
        ...style,
      }}
      {...rest}
    >
      {eyebrow && <div className="sc-eyebrow" style={{ marginBottom: 14 }}>{eyebrow}</div>}
      {children}
    </div>
  );
}

// Badge — small status pill. tone: "gold"|"success"|"error"|"warning"|"neutral".
export function Badge({ tone = "neutral", children, style }) {
  const map = {
    gold: [t.gold, t.goldSoft, t.goldLine],
    success: [t.success, t.successSoft, t.success],
    error: [t.error, t.errorSoft, t.error],
    warning: [t.warning, t.warningSoft, t.warning],
    neutral: [t.text2, t.surface2, t.border2],
  };
  const [fg, bg, bd] = map[tone] || map.neutral;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 11, fontWeight: 600, lineHeight: 1.4, whiteSpace: "nowrap",
      color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: 6, padding: "3px 9px",
      ...style,
    }}>{children}</span>
  );
}
