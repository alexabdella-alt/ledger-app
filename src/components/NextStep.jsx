import React from "react";

// C577 — the button an empty screen offers, so "nothing here yet" always comes with where to
// go to change that. One look everywhere, so an owner learns it once.
export default function NextStep({ label, onClick, secondary = false }) {
  return (
    <button data-next-step onClick={onClick} style={{
      height: 36, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
      background: secondary ? "transparent" : "var(--sc-gold)",
      border: secondary ? "1px solid var(--sc-border-2)" : "none",
      color: secondary ? "var(--sc-text)" : "var(--sc-on-accent)",
    }}>{label}</button>
  );
}
