import React from "react";

// Shared onion-layer drill navigation controls: ‹ back / › forward arrows + a breadcrumb
// trail, rendered identically on every drilled view. Back steps ONE layer (hidden at the top
// of a stack); forward re-advances (shown only when there's history); breadcrumb jumps to any
// level. Driven entirely by props from useDrillStack — no local nav state of its own.
//
// props: crumbs [{label,index}] (index -1 = root) · canBack · canForward ·
//        onBack() · onForward() · onJump(index)
export default function DrillNav({ crumbs = [], canBack, canForward, onBack, onForward, onJump }) {
  const arrow = (enabled, glyph, onClick, title) => (
    <button onClick={enabled ? onClick : undefined} disabled={!enabled} title={title}
      style={{
        width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", flexShrink: 0,
        color: enabled ? "var(--sc-text)" : "var(--sc-text-mut)", cursor: enabled ? "pointer" : "default",
        fontSize: 16, fontWeight: 700, lineHeight: 1, opacity: enabled ? 1 : 0.4,
      }}
      onMouseEnter={enabled ? (e => e.currentTarget.style.background = "var(--sc-surface-2)") : undefined}
      onMouseLeave={enabled ? (e => e.currentTarget.style.background = "var(--sc-surface)") : undefined}>
      {glyph}
    </button>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      {/* Back is HIDDEN at the top of the stack (nothing to go back to); Forward shows only with history. */}
      {canBack && arrow(true, "‹", onBack, "Back one level")}
      {canForward && arrow(true, "›", onForward, "Forward")}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13 }}>
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <span key={`${c.index}-${i}`} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span onClick={last ? undefined : () => onJump && onJump(c.index)}
                style={{ cursor: last ? "default" : "pointer", color: last ? "var(--sc-text)" : "var(--sc-gold)", fontWeight: last ? 600 : 500, whiteSpace: "nowrap" }}>
                {c.label}
              </span>
              {!last && <span style={{ color: "var(--sc-text-mut)" }}>›</span>}
            </span>
          );
        })}
      </div>
    </div>
  );
}
