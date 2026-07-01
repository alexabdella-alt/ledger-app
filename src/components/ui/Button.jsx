import React from "react";
import { btn } from "../../lib/ui.js";

// Button — token-driven, single source (lib/ui btn()). `primary` is the gold ingot
// (the one bold move, reserved for the main action), `ghost` a quiet outline,
// `gold-ghost` a soft gold tint, `danger` warm-red. Active scale + the CTA sheen
// come from styles.css (.sc-cta / button:active).
//
// props: variant ("primary"|"ghost"|"gold-ghost"|"danger"), size ("sm"|"md"|"lg"),
//        full, plus native button props.
export default function Button({ variant = "primary", size = "md", full = false, style, children, ...rest }) {
  return (
    <button
      className={variant === "primary" ? "sc-cta" : undefined}
      style={{
        ...btn(variant, size),
        ...(full ? { width: "100%" } : {}),
        ...(rest.disabled ? { cursor: "not-allowed", opacity: 0.55 } : {}),
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
