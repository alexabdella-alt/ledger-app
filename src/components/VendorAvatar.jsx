import React from "react";
import { initials, vendorColor } from "../lib/format";
import { vendorLogo } from "../lib/vendorLogo";

// C395 — the vendor's logo where we KNOW their domain (the curated directory, or a
// website a person typed on the contact), initials otherwise. A logo that fails to load
// falls back to the initials so a broken image never sits beside a supplier's name.
export default function VendorAvatar({ vendor, size = 44, radius = 12, fontSize = 15, onClick, title }) {
  const name = vendor?.name || "";
  const logo = vendorLogo({ name, website: vendor?.website });
  const [failed, setFailed] = React.useState(false);
  const base = { width: size, height: size, borderRadius: radius, flexShrink: 0, cursor: onClick ? "pointer" : "default", overflow: "hidden" };
  if (logo && !failed) {
    return (
      <div onClick={onClick} title={title || `${name} · logo from ${logo.domain}`} data-vendor-logo={logo.domain}
        style={{ ...base, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src={logo.url} alt="" width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} loading="lazy" onError={() => setFailed(true)} style={{ display: "block" }} />
      </div>
    );
  }
  return (
    <div onClick={onClick} title={title} data-vendor-initials={initials(name)}
      style={{ ...base, background: vendorColor(name), display: "flex", alignItems: "center", justifyContent: "center", fontSize, fontWeight: 700, color: "var(--sc-on-accent)" }}>
      {initials(name)}
    </div>
  );
}
