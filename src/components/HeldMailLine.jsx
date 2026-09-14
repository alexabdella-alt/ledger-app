import React from "react";
import { useERP } from "./ERPContext";
import { unknownSenderCopy } from "../../supabase/functions/_shared/mailChannel.js";

// ─────────────────────────────────────────────────────────────────────────────
// A MESSAGE THE SENDER WALL HELD (O82, C351; spec §2.2). One line per message, on Home,
// naming the SENDER so "allow" is a decision about a person. Renders nothing when nothing
// is held — an empty list is not a claim, it is the absence of one.
// ─────────────────────────────────────────────────────────────────────────────
export default function HeldMailLine() {
  const { heldInbound, releaseHeldInbound, ignoreHeldInbound, isAdmin, isOwner } = useERP();
  const [busy, setBusy] = React.useState(null);
  const rows = Array.isArray(heldInbound) ? heldInbound : [];
  if (!rows.length) return null;
  const canDecide = !!(isAdmin || isOwner);
  return (
    <div style={{ margin: "0 0 16px" }}>
      {rows.map(m => (
        <div key={m.id} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, padding: "12px 16px", marginBottom: 8, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--sc-text)", flex: "1 1 320px" }}>
            {unknownSenderCopy({ from: m.from_email, subject: m.subject })}
            {m.attachment_count > 0 && <span style={{ color: "var(--sc-text-2)" }}> {m.attachment_count} attachment{m.attachment_count === 1 ? "" : "s"} kept, not read.</span>}
          </span>
          {canDecide ? (
            <span style={{ display: "flex", gap: 8 }}>
              <button disabled={busy === m.id} onClick={async () => { setBusy(m.id); await releaseHeldInbound(m); setBusy(null); }}
                style={{ height: 32, padding: "0 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Allow this sender</button>
              <button disabled={busy === m.id} onClick={async () => { setBusy(m.id); await ignoreHeldInbound(m); setBusy(null); }}
                style={{ height: 32, padding: "0 12px", borderRadius: 8, fontSize: 12, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Ignore</button>
            </span>
          ) : <span style={{ fontSize: 12, color: "var(--sc-text-2)" }}>An owner or admin can allow or ignore it.</span>}
        </div>
      ))}
    </div>
  );
}
