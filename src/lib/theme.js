// ─────────────────────────────────────────────────────────────────────────────
// SHADOW theme accessors — "Midnight + Gold". The ACTUAL values live once in
// src/styles.css (:root CSS variables); this module exposes them as var(--sc-*)
// strings so inline-style objects (the app's styling convention) read the single
// source of truth instead of hardcoding hex. Change a color in styles.css → it
// changes everywhere that uses `t.*`.
// ─────────────────────────────────────────────────────────────────────────────

export const t = {
  // surfaces
  bg: "var(--sc-bg)",
  bgDeep: "var(--sc-bg-deep)",
  surface: "var(--sc-surface)",
  surface2: "var(--sc-surface-2)",
  surface3: "var(--sc-surface-3)",
  border: "var(--sc-border)",
  border2: "var(--sc-border-2)",
  // text
  text: "var(--sc-text)",
  text2: "var(--sc-text-2)",
  textMut: "var(--sc-text-mut)",
  textPh: "var(--sc-text-ph)",
  // gold
  gold: "var(--sc-gold)",
  goldBright: "var(--sc-gold-bright)",
  goldDeep: "var(--sc-gold-deep)",
  goldSoft: "var(--sc-gold-soft)",
  goldLine: "var(--sc-gold-line)",
  goldGlow: "var(--sc-gold-glow)",
  // semantic
  success: "var(--sc-success)",
  successSoft: "var(--sc-success-soft)",
  error: "var(--sc-error)",
  errorSoft: "var(--sc-error-soft)",
  warning: "var(--sc-warning)",
  warningSoft: "var(--sc-warning-soft)",
  info: "var(--sc-info)",
  infoSoft: "var(--sc-info-soft)",
  // elevation
  shadow: "var(--sc-shadow)",
  shadowLg: "var(--sc-shadow-lg)",
  glow: "var(--sc-glow)",
  // type
  fontDisplay: "var(--sc-font-display)",
  fontUi: "var(--sc-font-ui)",
  fontMono: "var(--sc-font-mono)",
  // radii
  rSm: "var(--sc-r-sm)",
  r: "var(--sc-r)",
  rCard: "var(--sc-r-card)",
  rLg: "var(--sc-r-lg)",
  rXl: "var(--sc-r-xl)",
  rPill: "var(--sc-r-pill)",
  onAccent: "var(--sc-on-accent)",
  // motion
  durFast: "var(--sc-dur-fast)",
  dur: "var(--sc-dur)",
  durSlow: "var(--sc-dur-slow)",
  ease: "var(--sc-ease)",
  easeInOut: "var(--sc-ease-in-out)",
};

// Does the user prefer reduced motion? (used to skip count-up / draw animations)
export function prefersReducedMotion() {
  try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  catch { return false; }
}

// Semantic color for a signed money figure (gold is reserved for the hero/primary
// figure; positive deltas are green, negative warm-red). Returns a token string.
export function moneyColor(n, { positive = t.success, negative = t.error, zero = t.text } = {}) {
  const v = Number(n) || 0;
  return v > 0 ? positive : v < 0 ? negative : zero;
}
