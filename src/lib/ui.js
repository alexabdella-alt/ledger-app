// ─────────────────────────────────────────────────────────────────────────────
// UI KIT — the ONE canonical set of composite styles, built on the Midnight+Gold
// tokens (src/styles.css :root / src/lib/theme.js). The app styles with inline
// objects, so these are STYLE FACTORIES (plain objects/functions) that any screen
// can spread — `style={card()}` / `style={sectionTitle}` / `style={pill(active)}`.
// The React components in src/components/ui/* consume these same factories, so a
// card looks identical whether a screen uses <Card> or card(). Change it here →
// it changes everywhere. This kills the per-screen re-rolled primitives.
// ─────────────────────────────────────────────────────────────────────────────
import { t } from "./theme.js";

// Spacing — one 4px rhythm. sp(3) → 12, sp(6) → 24. Use for padding/margin/gap.
export const sp = (n) => n * 4;

// Radius scale (numbers, for inline styles). Mirror of the --sc-r-* tokens.
export const radius = { sm: 8, md: 12, card: 14, lg: 16, pill: 999 };

// Type scale (numeric fontSize for inline styles). One ladder — no more 11.5/12.5/13.5 drift.
//   eyebrow 11 · caption 12 · label 13 · body 14 · base 15 · lg 18 · h3 22 · h2 28 · h1 40
export const fs = { eyebrow: 11, caption: 12, label: 13, body: 14, base: 15, lg: 18, h3: 22, h2: 28, h1: 40 };

// Font weights — the only four we use.
export const fw = { regular: 400, medium: 500, semibold: 600, bold: 700 };

// ── Card / panel ── the standard dark-slate surface. One definition everywhere.
export const card = ({ pad = "20px 22px", mb = 0, hover = false } = {}) => ({
  background: t.surface,
  border: `1px solid ${t.border}`,
  borderRadius: radius.card,
  boxShadow: t.shadow,
  padding: typeof pad === "number" ? `${pad}px` : pad,
  ...(mb ? { marginBottom: typeof mb === "number" ? `${mb}px` : mb } : {}),
  ...(hover ? { transition: `transform ${t.dur} ${t.ease}, box-shadow ${t.durSlow} ease` } : {}),
});

// ── Section title ── the small bold heading above a card's content.
export const sectionTitle = {
  fontSize: fs.label, fontWeight: fw.bold, color: t.text, marginBottom: 12, letterSpacing: 0.2,
};

// ── Eyebrow ── uppercase micro-label (tokened; mirrors .sc-eyebrow).
export const eyebrow = {
  fontSize: fs.eyebrow, fontWeight: fw.semibold, letterSpacing: "0.14em",
  textTransform: "uppercase", color: t.textMut,
};

// ── Filter / tab pill ── one pill everywhere: gold fill + dark ink when active,
// quiet outline when idle. (Replaces the per-screen radius-8 vs radius-20 forks.)
export const pill = (active = false) => ({
  display: "inline-flex", alignItems: "center", gap: 6,
  fontSize: fs.label, fontWeight: active ? fw.semibold : fw.regular, lineHeight: 1.2, whiteSpace: "nowrap",
  padding: "7px 14px", borderRadius: radius.pill, cursor: "pointer",
  border: `1px solid ${active ? t.gold : t.border2}`,
  background: active ? t.gold : "transparent",
  color: active ? t.onAccent : t.text2,
  transition: `background ${t.dur} ease, color ${t.dur} ease, border-color ${t.dur} ease`,
});

// ── Badge / status chip ── tone: gold|success|error|warning|neutral. Matches ui Badge.
const BADGE = {
  gold: [t.gold, t.goldSoft, t.goldLine],
  success: [t.success, t.successSoft, t.success],
  error: [t.error, t.errorSoft, t.error],
  warning: [t.warning, t.warningSoft, t.warning],
  info: [t.info, t.infoSoft, t.info],
  neutral: [t.text2, t.surface2, t.border2],
};
export const badge = (tone = "neutral") => {
  const [fg, bg, bd] = BADGE[tone] || BADGE.neutral;
  return {
    display: "inline-flex", alignItems: "center", gap: 5,
    fontSize: fs.eyebrow, fontWeight: fw.semibold, lineHeight: 1.4, whiteSpace: "nowrap",
    color: fg, background: bg, border: `1px solid ${bd}`, borderRadius: radius.sm, padding: "3px 9px",
  };
};

// ── Input / field ── one text-field style.
export const field = {
  width: "100%", boxSizing: "border-box",
  background: t.surface2, border: `1px solid ${t.border2}`, borderRadius: radius.sm,
  padding: "9px 12px", fontSize: fs.body, color: t.text, fontFamily: t.fontUi, outline: "none",
};

// ── Button ── variant: primary|ghost|gold-ghost|danger; size: sm|md|lg. Matches ui Button.
export const btn = (variant = "primary", size = "md") => {
  const pad = size === "sm" ? "7px 14px" : size === "lg" ? "13px 26px" : "10px 20px";
  const size_fs = size === "sm" ? fs.label : size === "lg" ? fs.base : fs.body;
  const variants = {
    primary: { background: `linear-gradient(180deg, ${t.goldBright}, ${t.gold})`, color: t.onAccent, border: `1px solid ${t.goldDeep}`, fontWeight: fw.bold },
    ghost: { background: "transparent", color: t.text2, border: `1px solid ${t.border2}`, fontWeight: fw.medium },
    "gold-ghost": { background: t.goldSoft, color: t.gold, border: `1px solid ${t.goldLine}`, fontWeight: fw.semibold },
    danger: { background: t.errorSoft, color: t.error, border: `1px solid ${t.error}`, fontWeight: fw.semibold },
  };
  return {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
    padding: pad, fontSize: size_fs, fontFamily: t.fontUi, borderRadius: radius.sm,
    cursor: "pointer", whiteSpace: "nowrap", ...variants[variant],
  };
};

// ── Divider ── one hairline.
export const divider = { height: 1, background: t.border, border: "none", margin: 0 };
