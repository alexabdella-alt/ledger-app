import React from "react";
import { createPortal } from "react-dom";
import NavIcon from "./NavIcon";

// ═════════════════════════════════════════════════════════════════════════════
// C756 — THE OWNER'S PHONE TAB BAR, OUTSIDE THE PAGE. C753 drew the bar by fixing the menu's main
// section to the bottom of the screen — from INSIDE the side menu, a scrolling strip. On an iPhone
// a scrolling strip (`-webkit-overflow-scrolling: touch`) is its own layer, so the bar was painted
// UNDER the page: the Home cards covered it and taps never reached it (the operator's screenshots,
// 2026-11-19). It is now its own element, rendered straight into <body> above everything, so no
// page, card or animation can sit on top of it. Shown only at phone width (styles.css .sc-tabbar).
// `items` are the menu's main rows; `onGo`, `activeId` and `badgeFor` are the menu's own, so the
// bar and the menu can never disagree about where a tap goes.
// ═════════════════════════════════════════════════════════════════════════════
export default function OwnerTabBar({ items = [], activeId = null, onGo, badgeFor = () => null, chatOpen = false }) {
  if (typeof document === "undefined" || !document.body) return null;
  return createPortal(
    <nav aria-label="Main menu" className="sc-tabbar">
      {items.map(([id, label]) => {
        const active = id === "ask" ? chatOpen : (activeId === id && !chatOpen);
        const badge = badgeFor(id);
        return (
          <button key={id} type="button" data-tab={id} aria-current={active ? "page" : undefined}
            className={active ? "sc-tab active" : "sc-tab"} onClick={() => onGo && onGo(id)}>
            <NavIcon id={id} />
            <span className="sc-tablabel">{label}</span>
            {badge != null && <span className="sc-tabbadge">{badge}</span>}
          </button>
        );
      })}
    </nav>,
    document.body,
  );
}
