import React from "react";
import { useERP } from "../ERPContext";
import Icon from "../Icon";
import { fmtDate } from "../../lib/format";
import { PLANS, billingState, billingHeadline, billingSub } from "../../lib/billing";

// ═════════════════════════════════════════════════════════════════════════════
// C771 — SETTINGS → PLAN & BILLING. Where the company stands (trial / plan / payment problem), the
// plans, and two doors to Stripe's own hosted pages: Checkout to subscribe, the Billing Portal to
// change card, switch plan, cancel or download invoices. No card details ever touch this app.
// Only the owner or an admin can change billing; everyone else sees the status.
// ═════════════════════════════════════════════════════════════════════════════
export default function BillingView() {
  const { subscription, startCheckout, openBillingPortal, isOwner, isAdmin } = useERP();
  const [busy, setBusy] = React.useState(null);
  const st = billingState(subscription);
  const canChange = !!(isOwner || isAdmin);
  const paying = st.kind === "active" || st.kind === "past_due";
  const go = async (key, fn) => { if (!fn) return; setBusy(key); try { await fn(); } finally { setBusy(null); } };
  const card = { background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "18px 20px", marginBottom: 16 };
  const primary = { padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", background: "var(--sc-gold)", color: "var(--sc-on-accent)", cursor: "pointer" };
  const secondary = { padding: "9px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text)", cursor: "pointer" };

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 22 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Plan &amp; billing</h1>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>Your plan, and where to change your card or download invoices. Payments are handled securely by Stripe.</div>
      </div>

      <div data-billing-status={st.kind} style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name={st.kind === "past_due" || st.kind === "expired" ? "alert" : "card"} size={18} style={{ color: st.kind === "past_due" || st.kind === "expired" ? "var(--sc-warning)" : "var(--sc-text-2)" }} />
          <div style={{ fontSize: 16, fontWeight: 600, color: "var(--sc-text)" }}>{billingHeadline(st)}</div>
        </div>
        <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6, lineHeight: 1.55 }}>{billingSub(st)}</div>
        {st.kind === "active" && st.renews && <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 6 }}>Renews {fmtDate(st.renews)}.</div>}
        {paying && canChange && (
          <button data-billing-portal onClick={() => go("portal", openBillingPortal)} disabled={busy === "portal"} style={{ ...secondary, marginTop: 14 }}>
            {busy === "portal" ? "Opening…" : "Manage billing →"}
          </button>
        )}
      </div>

      {!paying && (
        <div data-billing-plans style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
          {PLANS.map((p) => (
            <div key={p.id} data-billing-plan={p.id} style={{ ...card, marginBottom: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)" }}>{p.name}</div>
              {p.price != null && <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6, fontFamily: "'DM Mono', monospace" }}>${p.price}<span style={{ fontSize: 13, color: "var(--sc-text-2)", fontWeight: 500 }}> / month</span></div>}
              <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 8, lineHeight: 1.55, flex: 1 }}>{p.blurb}</div>
              {canChange
                ? <button data-billing-choose={p.id} onClick={() => go(p.id, () => startCheckout(p.id))} disabled={!!busy} style={{ ...primary, marginTop: 14, alignSelf: "flex-start" }}>{busy === p.id ? "Opening…" : `Choose ${p.name}`}</button>
                : null}
            </div>
          ))}
        </div>
      )}
      {!canChange && <div data-billing-readonly style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 14 }}>Only the owner or an admin can change the plan.</div>}
    </div>
  );
}
