import React from "react";
import { useERP } from "./ERPContext";
import { fmtMoney, fmtDate, todayLocal } from "../lib/format";
import { personalCandidates, personalSortDue, PERSONAL_SHOW, PERSONAL_SORT_COPY } from "../lib/personalSort";
import Icon from "./Icon";

// ═════════════════════════════════════════════════════════════════════════════
// C779 — "WERE THESE PERSONAL?", ON HOME. Charges that look like everyday personal spending, ticked
// by default; untick the business ones and save. Personal → money the owner took out (never spending);
// every answer is remembered as a rule, so each vendor is asked once (lib/personalSort.js decides who).
// Shows only once a few are waiting or the oldest has waited a week; nothing for a view-only teammate.
// ═════════════════════════════════════════════════════════════════════════════
export default function PersonalSort() {
  const { invoices, rules, sortPersonalCharges, isViewer } = useERP();
  const all = React.useMemo(() => personalCandidates({ invoices: invoices || [], rules: rules || [], today: todayLocal() }), [invoices, rules]);
  const items = all.slice(0, PERSONAL_SHOW);
  const [unticked, setUnticked] = React.useState(() => new Set());
  const [busy, setBusy] = React.useState(false);
  if (isViewer || !sortPersonalCharges || !personalSortDue(all)) return null;
  const personalIds = new Set(items.filter((i) => !unticked.has(i.entryId)).map((i) => i.entryId));
  const toggle = (id) => setUnticked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const save = async () => {
    setBusy(true);
    try { await sortPersonalCharges(items, personalIds); setUnticked(new Set()); } finally { setBusy(false); }
  };

  return (
    <section data-personal-sort aria-label="Were these personal?" style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)", display: "flex", alignItems: "center", gap: 8 }}><Icon name="card" size={18} style={{ color: "var(--sc-gold)" }} />{PERSONAL_SORT_COPY.title(items.length)}</div>
      <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 4, lineHeight: 1.5 }}>{PERSONAL_SORT_COPY.sub}</div>
      <div style={{ marginTop: 10 }}>
        {items.map((it) => {
          const on = !unticked.has(it.entryId);
          return (
            <label key={it.entryId} data-personal-item={it.entryId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderTop: "1px solid var(--sc-surface-2)", cursor: "pointer" }}>
              <input type="checkbox" checked={on} onChange={() => toggle(it.entryId)} disabled={busy} style={{ width: 18, height: 18, accentColor: "var(--sc-gold)", flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--sc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.vendor} · {fmtMoney(it.amount)}</div>
                <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>{fmtDate(it.date)} · {on ? "personal" : "business"}</div>
              </div>
            </label>
          );
        })}
      </div>
      <button data-personal-save onClick={save} disabled={busy}
        style={{ marginTop: 10, padding: "9px 16px", borderRadius: 9, fontSize: 13.5, fontWeight: 600, border: "none", background: busy ? "var(--sc-border)" : "var(--sc-gold)", color: busy ? "var(--sc-text-mut)" : "var(--sc-on-accent)", cursor: busy ? "default" : "pointer" }}>
        {busy ? "Saving…" : PERSONAL_SORT_COPY.save(personalIds.size)}
      </button>
      <div style={{ fontSize: 12, color: "var(--sc-text-mut)", marginTop: 10, lineHeight: 1.5 }}>{PERSONAL_SORT_COPY.separate}</div>
    </section>
  );
}
