import React from "react";
import { useERP } from "../ERPContext";

// Team management (Item 20) — owner-only. Lists members, pending invites (with
// revoke), and an invite form that produces a copyable invite link.
export default function TeamView() {
  const { currentCompany, session, supabase, isOwner, logAudit, showNotification } = useERP();
  const [members, setMembers] = React.useState([]);
  const [invites, setInvites] = React.useState([]);
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("viewer");   // the least-privilege default
  const [busy, setBusy] = React.useState(false);
  const [lastLink, setLastLink] = React.useState(null);
  const [copied, setCopied] = React.useState(false);

  const load = React.useCallback(async () => {
    const cid = currentCompany?.id;
    if (!cid) return;
    try {
      const { data: m } = await supabase.rpc("list_company_members", { p_company: cid });
      setMembers(Array.isArray(m) ? m : []);
    } catch { /* RPC may be absent pre-migration */ }
    try {
      const { data: inv } = await supabase.from("company_invites")
        .select("*").eq("company_id", cid).eq("status", "pending").order("created_at", { ascending: false });
      setInvites(Array.isArray(inv) ? inv : []);
    } catch {}
  }, [currentCompany?.id, supabase]);

  React.useEffect(() => { load(); }, [load]);

  const linkFor = (token) => `${window.location.origin}/?invite=${token}`;

  const sendInvite = async () => {
    const e = email.trim().toLowerCase();
    if (!e || !/.+@.+\..+/.test(e)) { showNotification("Enter a valid email address.", "error"); return; }
    setBusy(true);
    try {
      const { data, error } = await supabase.from("company_invites")
        .insert({ company_id: currentCompany.id, email: e, role, invited_by: session.user.id })
        .select("*").single();
      if (error) throw error;
      setLastLink(linkFor(data.token)); setCopied(false);
      setEmail("");
      logAudit && logAudit("invite_sent", `Invited ${e} as ${role}`, null, { email: e, role });
      load();
    } catch (err) {
      showNotification("Couldn't create the invite — " + (err?.message || err), "error");
    }
    setBusy(false);
  };

  const revoke = async (inv) => {
    try {
      await supabase.from("company_invites").delete().eq("id", inv.id).eq("company_id", currentCompany.id);
      logAudit && logAudit("invite_revoked", `Revoked invite for ${inv.email}`, inv, null);
      if (lastLink && lastLink.includes(inv.token)) setLastLink(null);
      load();
    } catch (err) { showNotification("Couldn't revoke — " + (err?.message || err), "error"); }
  };

  const copy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { showNotification("Copy failed — select and copy the link manually.", "error"); }
  };

  const roleBadge = (r) => {
    const c = r === "owner" ? "var(--sc-gold)" : r === "admin" ? "var(--sc-success)" : "var(--sc-text-2)";
    return <span style={{ fontSize: 11, fontWeight: 600, color: c, background: c + "14", border: `1px solid ${c}33`, borderRadius: 6, padding: "2px 9px", textTransform: "capitalize" }}>{r}</span>;
  };
  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 22, marginBottom: 16 };
  const input = { background: "var(--sc-surface-2)", border: "1px solid var(--sc-border-2)", borderRadius: 10, padding: "10px 12px", color: "var(--sc-text)", fontSize: 14, outline: "none" };

  if (!isOwner) {
    return <div style={{ maxWidth: 720, color: "var(--sc-text-2)", fontSize: 14 }}>Only the company owner can manage the team.</div>;
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 22 }}>
        <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--sc-text-2)", marginBottom: 8 }}>TEAM</div>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Team & invites</h1>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>Invite teammates as admins (full access) or members (upload, view, and ask the AI — no destructive changes).</div>
      </div>

      {/* ── Invite form ── */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-gold)", letterSpacing: 0.5, marginBottom: 14 }}>INVITE A TEAMMATE</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...input, flex: "1 1 240px" }} type="email" placeholder="teammate@company.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && sendInvite()} />
          <select style={input} value={role} onChange={e => setRole(e.target.value)}>
            {/* ★★ THESE ARE THE ROLES THE DATABASE ACTUALLY ALLOWS.
                `company_users_role_check` permits exactly owner | admin | accountant |
                viewer. This offered "Member", which is in none of them — so `accept_invite`
                inserted a role the check rejects and **the invite could not be accepted at
                all.** The default option was the broken one. Pinned by a test that reads
                the allowed set out of the schema, so the two cannot drift again. */}
            <option value="viewer">Viewer — can see the books, can't change anything</option>
            <option value="accountant">Accountant — can review and sign off a month</option>
            <option value="admin">Admin — full access, can invite others</option>
          </select>
          <button onClick={sendInvite} disabled={busy} style={{ height: 40, padding: "0 18px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "var(--sc-on-accent)", background: busy ? "var(--sc-gold)" : "var(--sc-gold)", border: "none", cursor: busy ? "default" : "pointer" }}>
            {busy ? "Creating…" : "Create invite"}
          </button>
        </div>
        {lastLink && (
          <div style={{ marginTop: 14, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 13, color: "var(--sc-gold)", marginBottom: 8 }}>Copy this link and send it to your teammate. It works once and expires in 7 days.</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input readOnly value={lastLink} onFocus={e => e.target.select()} style={{ ...input, flex: "1 1 280px", fontSize: 13, fontFamily: "'DM Mono',monospace", background: "var(--sc-surface)" }} />
              <button onClick={() => copy(lastLink)} style={{ height: 40, padding: "0 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, color: copied ? "var(--sc-success)" : "var(--sc-surface)", background: copied ? "var(--sc-success-soft)" : "var(--sc-gold)", border: copied ? "1px solid var(--sc-success-soft)" : "none", cursor: "pointer" }}>{copied ? "Copied ✓" : "Copy link"}</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Pending invites ── */}
      {invites.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-gold)", letterSpacing: 0.5, marginBottom: 6 }}>PENDING INVITES ({invites.length})</div>
          {invites.map(inv => (
            <div key={inv.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid var(--sc-surface-2)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: "var(--sc-text)" }}>{inv.email}</div>
                <div style={{ fontSize: 12, color: "var(--sc-text-mut)", marginTop: 2 }}>Invited {new Date(inv.created_at).toLocaleDateString()} · expires {new Date(inv.expires_at).toLocaleDateString()}</div>
              </div>
              {roleBadge(inv.role)}
              <button onClick={() => copy(linkFor(inv.token))} style={{ fontSize: 12, color: "var(--sc-gold)", background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>Copy link</button>
              <button onClick={() => revoke(inv)} style={{ fontSize: 12, color: "var(--sc-error)", background: "var(--sc-surface)", border: "1px solid var(--sc-error-soft)", borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontWeight: 600 }}>Revoke</button>
            </div>
          ))}
        </div>
      )}

      {/* ── Current members ── */}
      <div style={card}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-gold)", letterSpacing: 0.5, marginBottom: 6 }}>MEMBERS ({members.length})</div>
        {members.length === 0 ? (
          <div style={{ fontSize: 13, color: "var(--sc-text-2)", paddingTop: 10 }}>Just you for now. Invite a teammate above.</div>
        ) : members.map(m => (
          <div key={m.user_id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", borderTop: "1px solid var(--sc-surface-2)" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--sc-text)" }}>{m.full_name || m.email}{m.user_id === session?.user?.id ? " (you)" : ""}</div>
              <div style={{ fontSize: 12, color: "var(--sc-text-mut)", marginTop: 2 }}>{m.email}</div>
            </div>
            {roleBadge(m.role)}
          </div>
        ))}
      </div>
    </div>
  );
}
