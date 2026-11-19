import React from "react";

// ═════════════════════════════════════════════════════════════════════════════
// C753 — ICONS FOR THE OWNER'S PHONE TAB BAR. On a phone the owner's five main places sit in a
// bar along the bottom of the screen (styles.css, `.sc-owner-nav`), each an icon over its name —
// the shape every phone app uses. The icons are hidden on a laptop, where the menu is a column.
// Stroke icons in `currentColor`, so the active tab's gold colours them too.
// ═════════════════════════════════════════════════════════════════════════════
const PATHS = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" /></>,
  money: <><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v5M18 9.5v5" /></>,
  tax: <><path d="M6 3h9l4 4v14H6z" /><path d="M14.5 3v4.5H19" /><path d="M9 16l6-6" /><circle cx="9.5" cy="10.5" r="1" /><circle cx="14.5" cy="15.5" r="1" /></>,
  reports: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  ask: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
};

export const NAV_ICON_IDS = Object.keys(PATHS);

export default function NavIcon({ id }) {
  const p = PATHS[id];
  if (!p) return null;
  return (
    <span className="sc-navicon" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{p}</svg>
    </span>
  );
}
