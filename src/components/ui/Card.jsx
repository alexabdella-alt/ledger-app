import React from "react";
import { t } from "../../lib/theme.js";
import { card as cardStyle, badge as badgeStyle } from "../../lib/ui.js";

// Card — the standard dark-slate surface (single source: lib/ui card()). `hover`
// opts into the gold-edged lift (.sc-card); `glow` gives the gold-ringed hero
// treatment. Optional eyebrow header.
export default function Card({ hover = false, glow = false, eyebrow, pad = "20px 22px", style, children, ...rest }) {
  return (
    <div
      className={hover ? "sc-card" : undefined}
      style={{
        ...cardStyle({ pad }),
        ...(glow ? { border: `1px solid ${t.goldLine}`, boxShadow: t.glow } : {}),
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
// Single source: lib/ui badge().
export function Badge({ tone = "neutral", children, style }) {
  return <span style={{ ...badgeStyle(tone), ...style }}>{children}</span>;
}
