import React from "react";
import { useERP } from "../ERPContext";
import { MORE_SETTINGS_INTRO, MORE_SETTINGS_PAGES } from "../../lib/moreSettings";

// C638 — the owner's "More settings": every setup page they rarely need, one line each.
export default function MoreSettingsView() {
  const { setView, setChatOpen } = useERP();
  return (
    <div style={{ maxWidth: 760 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>More settings</h1>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>
          {MORE_SETTINGS_INTRO}{" "}
          <button onClick={() => setChatOpen && setChatOpen(true)} style={{ background: "none", border: "none", padding: 0, color: "var(--sc-gold)", fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Ask →</button>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {MORE_SETTINGS_PAGES.map((p) => (
          <button key={p.view} data-more-settings={p.view} onClick={() => setView(p.view)}
            style={{ textAlign: "left", background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, padding: "14px 18px", cursor: "pointer", fontFamily: "var(--sc-font-ui)", display: "flex", alignItems: "center", gap: 12 }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--sc-gold)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--sc-border)"; }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)" }}>{p.title}</div>
              <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 3, lineHeight: 1.45 }}>{p.what}</div>
            </div>
            <span style={{ color: "var(--sc-text-mut)", fontSize: 16 }}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}
