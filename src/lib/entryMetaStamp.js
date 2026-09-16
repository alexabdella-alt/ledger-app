// ─────────────────────────────────────────────────────────────────────────────
// C524 — WHAT A MULTI-LINE ENTRY STAMPS AFTER THE RPC. `post_journal_entry` keeps six named
// scalars of `p_meta` and discards the rest (O95), so anything a reader needs off
// `import_metadata` — or off `reference_number` — has to be written by a follow-up checked
// update (the C241/C478 pattern). This is that patch, computed purely so a test can carry a
// real builder's meta across the seam: build → stamp → the row as the database returns it →
// flatten → the control totals. Returns null when there is nothing to write.
// ─────────────────────────────────────────────────────────────────────────────
export function multiLineMetaPatch(meta = {}) {
  const m = meta || {};
  const taxAmt = Number(m.tax_amount != null ? m.tax_amount : m.tax) || 0;
  const stamp = { ...(taxAmt > 0 ? { tax_amount: taxAmt } : {}), ...(m.kind ? { kind: m.kind } : {}) };
  const refNum = m.invoice_number ? String(m.invoice_number).trim().slice(0, 120) : "";
  if (!Object.keys(stamp).length && !refNum) return null;
  return { ...(Object.keys(stamp).length ? { import_metadata: stamp } : {}), ...(refNum ? { reference_number: refNum } : {}), taxAmt, fields: Object.keys(stamp), refNum };
}
