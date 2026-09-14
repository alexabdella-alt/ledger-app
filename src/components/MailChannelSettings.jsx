import React from "react";
import { useERP } from "./ERPContext";
import { MAIL_DOMAIN } from "../lib/constants";
import { inboundAddress } from "../../supabase/functions/_shared/mailChannel.js";

// ─────────────────────────────────────────────────────────────────────────────
// "YOUR DOCUMENTS ADDRESS" — Settings block (O82, C351; spec §6).
//
// Four states, each SAID rather than rendered as an empty box:
//   · the tables are not there yet / the load failed  → "not available right now" (O98: we
//     could not ask is not the same as there is nothing)
//   · email is not switched on (no MAIL_DOMAIN)        → the feature is named and dated, no
//     broken address is shown
//   · switched on, no channel yet                       → an admin can set one up; a member
//     is told to ask an admin
//   · a channel exists                                  → the address, copyable, and the
//     allowed-senders list (the token is admin-only: a member sees "set up", never the secret)
// Phase A copy says SAVED then BOOKED WHEN THE BOOKS ARE NEXT OPENED — the spec's §3.1 limit,
// stated where the person reads the address.
// ─────────────────────────────────────────────────────────────────────────────
export default function MailChannelSettings() {
  const { mailChannel, setupMailChannel, allowMailSender, isAdmin, isOwner, showNotification } = useERP();
  const [newSender, setNewSender] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const canManage = !!(isAdmin || isOwner);
  const channel = mailChannel?.channel || null;
  const configured = !!channel || !!mailChannel?.status?.configured;
  const address = channel && MAIL_DOMAIN ? inboundAddress(channel.inbound_token, MAIL_DOMAIN) : null;

  const box = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 24, marginBottom: 16 };
  const eyebrow = { fontSize: 12, fontWeight: 600, color: "var(--sc-gold)", letterSpacing: 0.5, marginBottom: 6 };
  const muted = { fontSize: 13, color: "var(--sc-text-2)", lineHeight: 1.5 };
  const btn = { height: 36, padding: "0 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" };

  let body;
  if (mailChannel && !mailChannel.ok) {
    body = <div style={muted}>We couldn't check your documents address right now. That's not a statement about whether one exists — try again in a moment.</div>;
  } else if (!MAIL_DOMAIN) {
    body = <div style={muted}>Forwarding documents by email isn't switched on yet. When it is, an address will appear here — anything you forward to it will be saved the moment it arrives.</div>;
  } else if (!configured) {
    body = canManage
      ? <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          <div style={muted}>Set up an address you can forward invoices, receipts and statements to. We'll save each one the moment it arrives and add it to your books the next time your books are opened.</div>
          <button style={btn} disabled={busy} onClick={async () => { setBusy(true); await setupMailChannel(); setBusy(false); }}>{busy ? "Setting up…" : "Set up my documents address"}</button>
        </div>
      : <div style={muted}>Your company doesn't have a documents address yet — an owner or admin can set one up here.</div>;
  } else if (!channel) {
    body = <div style={muted}>Your company has a documents address. Only an owner or admin can see it — ask them for it.</div>;
  } else {
    body = (
      <div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <code style={{ fontFamily: "'DM Mono', monospace", fontSize: 14, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 12px" }}>{address}</code>
          <button style={{ ...btn, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text)" }}
            onClick={async () => { try { await navigator.clipboard.writeText(address); showNotification("Address copied"); } catch { showNotification("Couldn't copy — select it and copy by hand.", "error"); } }}>Copy</button>
        </div>
        <div style={{ ...muted, marginBottom: 14 }}>Forward anything here — invoices, receipts, statements. We save it the moment it arrives and add it to your books the next time your books are opened. Only email from you, your team, or the addresses below is accepted; anything else waits for you on Home.</div>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: "var(--sc-text-2)", marginBottom: 6 }}>WHO ELSE MAY SEND</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {(channel.allowed_senders || []).length === 0
            ? <div style={muted}>Just you and your team so far.</div>
            : (channel.allowed_senders || []).map(a => <div key={a} style={{ fontSize: 13 }}>{a}</div>)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input value={newSender} onChange={e => setNewSender(e.target.value)} placeholder="someone@example.com"
            style={{ height: 36, borderRadius: 8, border: "1px solid var(--sc-border-2)", background: "var(--sc-surface-2)", color: "var(--sc-text)", padding: "0 12px", fontSize: 13, minWidth: 240 }} />
          <button style={btn} disabled={busy || !newSender.includes("@")} onClick={async () => { setBusy(true); const r = await allowMailSender(newSender); if (r.ok) setNewSender(""); setBusy(false); }}>Allow this address</button>
        </div>
      </div>
    );
  }

  return (
    <div style={box}>
      <div style={eyebrow}>YOUR DOCUMENTS ADDRESS</div>
      {body}
    </div>
  );
}
