import React from "react";
import { useERP } from "./ERPContext";
import { fmtMoney, fmtDate, todayLocal } from "../lib/format";
import { receiptsToAdd, RECEIPTS_COPY } from "../lib/toldPurchase";

// ═════════════════════════════════════════════════════════════════════════════
// C755 — RECEIPTS TO ADD, ON HOME. Purchases the owner told the assistant about, and recent
// spending of $75 or more, with no receipt yet (lib/toldPurchase.js decides which). One tap opens
// the phone's camera / photo library / files, and the photo is filed with THAT purchase — no
// reading, no second entry. "I don't have one" clears it for good. Renders nothing when there is
// nothing to add, and nothing for a view-only teammate (they can't add one).
// ═════════════════════════════════════════════════════════════════════════════
const SHOW = 3;

export default function ReceiptsToAdd() {
  const { invoices, docLibrary, attachReceipt, waiveReceipt, isViewer } = useERP();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(null);
  const fileRef = React.useRef(null);
  const target = React.useRef(null);
  const items = React.useMemo(() => receiptsToAdd({ invoices: invoices || [], docs: docLibrary || [], today: todayLocal() }), [invoices, docLibrary]);
  if (isViewer || !items.length || !attachReceipt) return null;
  const shown = open ? items : items.slice(0, SHOW);

  const pick = (it) => { target.current = it; fileRef.current?.click(); };
  const onFile = async (e) => {
    const f = e.target.files?.[0]; e.target.value = "";
    const it = target.current; target.current = null;
    if (!f || !it) return;
    setBusy(it.entryId);
    try { await attachReceipt(f, it.entry); } finally { setBusy(null); }
  };
  const skip = async (it) => { setBusy(it.entryId); try { await waiveReceipt(it.entry); } finally { setBusy(null); } };

  return (
    <section data-receipts-to-add aria-label="Receipts to add" style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: "16px 18px", marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--sc-text)" }}>🧾 {RECEIPTS_COPY.title(items.length)}</div>
      <div style={{ fontSize: 12.5, color: "var(--sc-text-2)", marginTop: 4, lineHeight: 1.5 }}>{RECEIPTS_COPY.sub}</div>
      {/* No `capture`: on a phone this offers the camera AND the photo library (screenshots, emailed PDFs). */}
      <input ref={fileRef} type="file" accept="image/*,.pdf,.heic,.heif" style={{ display: "none" }} onChange={onFile} />
      <div style={{ marginTop: 10 }}>
        {shown.map((it) => (
          <div key={it.entryId} data-receipt-item={it.entryId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0", borderTop: "1px solid var(--sc-surface-2)" }}>
            <div style={{ minWidth: 0, flex: "1 1 180px" }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: "var(--sc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.vendor} · {fmtMoney(it.amount)}</div>
              <div style={{ fontSize: 12, color: "var(--sc-text-2)", marginTop: 2 }}>{fmtDate(it.date)}{it.told ? ` · ${RECEIPTS_COPY.told}` : ""}</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <button data-receipt-skip onClick={() => skip(it)} disabled={busy === it.entryId}
                style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, color: "var(--sc-text-2)", cursor: "pointer", textDecoration: "underline" }}>I don't have one</button>
              <button data-receipt-add onClick={() => pick(it)} disabled={busy === it.entryId}
                style={{ padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", background: busy === it.entryId ? "var(--sc-border)" : "var(--sc-gold)", color: busy === it.entryId ? "var(--sc-text-mut)" : "var(--sc-on-accent)", cursor: busy === it.entryId ? "default" : "pointer", whiteSpace: "nowrap" }}>
                {busy === it.entryId ? "Saving…" : <>📷 Add receipt</>}
              </button>
            </div>
          </div>
        ))}
      </div>
      {items.length > SHOW && (
        <button data-receipts-more onClick={() => setOpen((o) => !o)} style={{ marginTop: 6, background: "none", border: "none", padding: 0, fontSize: 13, fontWeight: 600, color: "var(--sc-gold)", cursor: "pointer" }}>
          {open ? RECEIPTS_COPY.less : RECEIPTS_COPY.more(items.length - SHOW)}
        </button>
      )}
    </section>
  );
}
