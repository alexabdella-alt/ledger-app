import React from "react";
import { t } from "../../lib/theme.js";

// Button — token-driven, three intents. `primary` is the gold ingot (the one bold
// move, reserved for the main action), `ghost` is a quiet outline, `danger` warm-red.
// Active scale + the CTA sheen come from styles.css (.sc-cta / button:active).
//
// props: variant ("primary"|"ghost"|"danger"|"gold-ghost"), size ("sm"|"md"|"lg"),
//        full, plus native button props.
export default function Button({ variant = "primary", size = "md", full = false, style, children, ...rest }) {
  const pad = size === "sm" ? "7px 14px" : size === "lg" ? "13px 26px" : "10px 20px";
  const fs = size === "sm" ? 13 : size === "lg" ? 15 : 14;

  const variants = {
    primary: {
      background: `linear-gradient(180deg, ${t.goldBright}, ${t.gold})`,
      color: "#1a1205", border: "1px solid var(--sc-gold-deep)", fontWeight: 700,
      boxShadow: "0 6px 18px -6px var(--sc-gold-glow)",
    },
    ghost: {
      background: "transparent", color: t.text2, border: `1px solid ${t.border2}`, fontWeight: 500,
    },
    "gold-ghost": {
      background: t.goldSoft, color: t.gold, border: `1px solid ${t.goldLine}`, fontWeight: 600,
    },
    danger: {
      background: t.errorSoft, color: t.error, border: `1px solid ${t.error}`, fontWeight: 600,
    },
  };

  return (
    <button
      className={variant === "primary" ? "sc-cta" : undefined}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        padding: pad, fontSize: fs, fontFamily: t.fontUi, borderRadius: t.rSm,
        cursor: rest.disabled ? "not-allowed" : "pointer", opacity: rest.disabled ? 0.55 : 1,
        width: full ? "100%" : undefined, whiteSpace: "nowrap",
        ...variants[variant], ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
