import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "./ERPContext";
import { initials, vendorColor, fmtDate, fmtMoney, todayLocal } from "../lib/format";
import { validateUpload } from "../lib/uploadGuard";
import { glIsRevenue, glIsExpense } from "../lib/gl";
import { classifyTxn, settlementKind } from "../lib/txnPresent";
import { badge } from "../lib/ui";
import { classifyBankReason } from "../lib/bankMatch";
import { clearedOriginal, clearingSettlement } from "../lib/settlementLink";
import { reversalIndex, reversalFor } from "../lib/ledger";
import DocumentPreviewModal, { docIcon, isImageDoc } from "./DocumentPreviewModal";

// Older bank/QBO entries stored the PROVENANCE ("Imported from bank statement") in the
// reasoning field instead of the GL-choice rationale. classifyBankReason now treats a
// provenance placeholder as absent and derives a real classification sentence from the
// entry's own vendor/account — so existing entries show a proper reason with no re-upload.
// We still gate on sel.reasoning so an entry with NO stored reasoning shows no block.
const displayReasoning = (sel) => (sel && sel.reasoning ? classifyBankReason(sel) : null);

// Shared transaction detail slide-in. Used by Books and every Reports drill-down so
// the panel lives in exactly one place. Pass the invoice id + an onClose handler.

const METHOD_OPTS = [["ach", "ACH / Bank Transfer"], ["check", "Check"], ["wire", "Wire Transfer"], ["card", "Credit Card"], ["zelle", "Zelle"], ["venmo", "Venmo"], ["paypal", "PayPal"], ["other", "Other"]];
const methodLabel = m => (METHOD_OPTS.find(([v]) => v === m)?.[1]) || (m ? String(m).toUpperCase() : "—");
const needsReview = i => i.approval_status === "pending_approval" || i.approval_status === "flagged" || i.approval_status === "info_requested" || (i.confidence != null && i.confidence < 70);
const fmtM = fmtMoney;
// GL-truth (CLAUDE.md §9): the account decides. `type` is a fallback ONLY for legacy rows
// with no gl_code — it LIES on settlements (a collection flattens to gl_code=Cash+type="expense").
// Money direction / open-ness come from classifyTxn (settlement-aware), never these predicates.
const isRevenue = i => (i.gl_code ? glIsRevenue(i.gl_code) : i.type === "revenue");
const isExpense = i => (i.gl_code ? glIsExpense(i.gl_code) : i.type === "expense");

// Shared status badge — also used by the Reports drill-down tables. Canonical badge()
// tones (lib/ui) so the tint + border are token-driven, not hand-mixed hex+alpha.
export function txnStatusBadge(i) {
  if (i.status === "voided") return <span style={badge("neutral")}>Voided</span>;
  if (i.payment_status === "paid") return <span style={badge("info")}>Paid · {methodLabel(i.payment_method_used).split(" ")[0]}</span>;
  if (i.payment_status === "collected") return <span style={badge("success")}>Collected</span>;
  if (needsReview(i)) return <span style={badge("warning")}>Needs Review</span>;
  return <span style={badge("success")}>Booked</span>;
}

// Inline source-document preview. Resolves a viewable URL — a data: URL for files
// uploaded in the current session (base64), or a short-lived signed Storage URL for
// documents loaded from Supabase (storage_path) — and renders the PDF/image inline.
function SourceDocPreview({ doc, onExpand }) {
  const { supabase } = useERP();
  const [url, setUrl] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!doc) { setUrl(null); return; }
    if (doc.base64) { setUrl(`data:${doc.mediaType};base64,${doc.base64}`); return; } // current session
    if (!doc.storage_path) { setUrl(null); return; }                                    // legacy: metadata only
    let active = true; setLoading(true); setUrl(null);
    supabase.storage.from("documents").createSignedUrl(doc.storage_path, 3600).then(({ data }) => {
      if (!active) return; setLoading(false); setUrl(data?.signedUrl || null);
    }).catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [doc, supabase]);

  const isPdf = doc.mediaType === "application/pdf";
  const isImg = isImageDoc(doc.mediaType);
  const canPreview = url && (isPdf || isImg);

  return (
    <div style={{ border: "1px solid var(--sc-border)", borderRadius: 10, overflow: "hidden", background: "var(--sc-surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderBottom: "1px solid var(--sc-surface-2)" }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{isPdf ? "📄" : isImg ? "🖼" : docIcon(doc.type)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
          <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginTop: 1 }}>{doc.uploaded_at ? fmtDate(doc.uploaded_at) : ""}{doc.mediaType ? ` · ${doc.mediaType}` : ""}</div>
        </div>
        <button onClick={onExpand} style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", color: "var(--sc-gold)", cursor: "pointer", whiteSpace: "nowrap" }}>View full ↗</button>
      </div>
      <div style={{ position: "relative", height: 360, background: "var(--sc-bg)" }}>
        {loading && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sc-text-2)", fontSize: 13 }}>Loading document…</div>
        )}
        {!loading && canPreview && isPdf && (
          <iframe src={url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "var(--sc-surface)" }} title={doc.name} />
        )}
        {!loading && canPreview && isImg && (
          <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 12 }}>
            <img src={url} alt={doc.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }} />
          </div>
        )}
        {!loading && !canPreview && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: 16, textAlign: "center" }}>
            <div style={{ fontSize: 40, opacity: 0.4 }}>{docIcon(doc.type)}</div>
            <div style={{ fontSize: 12, color: "var(--sc-text-2)", maxWidth: 320, lineHeight: 1.5 }}>
              {url ? "Inline preview isn't available for this file type." : "This document was uploaded before file storage was enabled. Re-upload to enable preview."}
            </div>
            {url && <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12, fontWeight: 600, color: "var(--sc-gold)", textDecoration: "none" }}>Open file ↗</a>}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TransactionDetailPanel({ invoiceId, onClose, returnContext, onNavigate }) {
  const {
    invoices, CHART_OF_ACCOUNTS, markPaid, persistRecode, logAudit, getAccountByRole,
    setInvoices, setSelectedInvoice, setView, setReturnTo, voidInvoiceWithUndo, setDeleteConfirm, docLibrary, storeDocument, fileToBase64, showNotification, isMember,
  } = useERP();

  const [recodeOpen, setRecodeOpen] = React.useState(false);
  const [srcDocPreview, setSrcDocPreview] = React.useState(null);
  const [srcUploading, setSrcUploading] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [payMethod, setPayMethod] = React.useState("ach");
  const [payDate, setPayDate] = React.useState(todayLocal());
  const srcFileRef = React.useRef(null);

  React.useEffect(() => { setRecodeOpen(false); setPayOpen(false); }, [invoiceId]);

  const sel = invoices.find(i => i.id === invoiceId) || null;
  if (!sel) return null;
  // Settlement-aware GL truth for money direction + open-ness (same source as the Books list):
  // a bank-matched collection is money IN and has no "Mark Paid" action, no matter what the
  // stale `type` flag says.
  const apCode = getAccountByRole?.("accounts_payable")?.code;
  const arCode = getAccountByRole?.("accounts_receivable")?.code;
  const cls = classifyTxn(sel, { apCode, arCode });
  const settle = settlementKind(sel);

  const close = () => { setRecodeOpen(false); setPayOpen(false); onClose(); };

  const findSourceDoc = (inv) => {
    const match = (docLibrary || []).find(d =>
      d.linked_invoice_id && (String(d.linked_invoice_id) === String(inv?.id) || String(d.linked_invoice_id) === String(inv?.db_entry_id))
    );
    // Diagnostic: surfaces the linked_invoice_id values present vs. what we're matching
    // against, making any id mismatch obvious in the console.
    if (!match) {
      console.log("[SourceDoc] no match for invoice", { id: inv?.id, db_entry_id: inv?.db_entry_id },
        "· docLibrary linked_invoice_ids:", (docLibrary || []).map(d => d.linked_invoice_id),
        `· docLibrary size: ${(docLibrary || []).length}`);
    }
    return match;
  };
  const handleSourceUpload = async (file, inv) => {
    if (!file || !inv) return;
    const v = validateUpload(file, "document");   // size + type guard (CR-34)
    if (!v.ok) { showNotification(v.error, "error"); return; }
    setSrcUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await storeDocument(file.name, base64, file.type, inv.type || "invoice", inv.db_entry_id || inv.id, ["source"], null, file);
      showNotification("Source document attached ✓");
    } catch (e) { console.error(e); showNotification("Couldn't attach document.", "error"); }
    setSrcUploading(false);
  };
  const doRecode = async (inv, code) => {
    const acct = (CHART_OF_ACCOUNTS || []).find(a => a.code === code);
    if (!acct) return;
    const before = { gl_code: inv.gl_code, gl_name: inv.gl_name };
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, gl_code: acct.code, gl_name: acct.name } : i));
    setRecodeOpen(false);
    // Verify the DB write committed before treating it as done — on failure, revert the
    // optimistic change and tell the user (no silent false success).
    const ok = persistRecode ? await persistRecode([{ ...inv, gl_code: acct.code }], acct.code, acct.name) : false;
    if (ok) {
      logAudit && logAudit("recode", `Recoded ${inv.vendor} → ${acct.name}`, { gl_code: inv.gl_code }, { gl_code: acct.code, gl_name: acct.name });
      showNotification && showNotification(`Recoded to ${acct.name} ✓`);
    } else {
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, ...before } : i));
      showNotification && showNotification("Couldn't save the recode — please try again.", "error");
    }
  };
  // Confirm before voiding a journal entry (destructive, even with Undo) — consistent with
  // the Books-list void. setDeleteConfirm opens the app's confirm modal.
  // ── O123/O124 — IS THIS ENTRY ALREADY REVERSED? ──────────────────────────────
  // A reversal is a SEPARATE offsetting entry carrying `import_metadata.reverses`; the
  // original correctly stays live (§12 #14 — reverse, never delete). What was missing is
  // that nothing SAID so, so the original looked identical to a live entry and the Void
  // button stayed enabled — three reversals against one invoice, −937.00, because the
  // only feedback the user had was that nothing changed.
  const reversedInfo = reversalFor(reversalIndex(invoices), sel);

  const doVoid = (inv) => {
    setDeleteConfirm({
      label: `Void the entry for ${inv.vendor || "this transaction"}${inv.amount!=null ? ` · ${fmtMoney(inv.amount)}` : ""}? It stays in the audit trail and posts a reversing entry. You'll have a moment to undo.`,
      onConfirm: () => { voidInvoiceWithUndo(inv, "Voided from detail panel"); onClose(); },
    });
  };

  return createPortal((
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(17,24,39,0.35)", display: "flex", justifyContent: "flex-end" }}>
        <style>{`@keyframes txnPanelIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
        <div onClick={e => e.stopPropagation()} style={{ width: 880, maxWidth: "94vw", height: "100%", background: "var(--sc-surface)", borderLeft: "1px solid var(--sc-border)", boxShadow: "-20px 0 60px rgba(16,24,40,0.18)", display: "flex", flexDirection: "column", animation: "txnPanelIn .25s cubic-bezier(.22,1,.36,1)" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--sc-surface-2)", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span style={{ width: 42, height: 42, borderRadius: 11, background: vendorColor(sel.vendor), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "var(--sc-on-accent)", flexShrink: 0 }}>{initials(sel.vendor)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.vendor || "—"}</div>
                <div style={{ fontSize: 12, color: "var(--sc-text-2)" }}>{fmtDate(sel.date)}</div>
              </div>
            </div>
            <button onClick={close} style={{ background: "none", border: "none", color: "var(--sc-text-2)", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: cls.inflow ? "var(--sc-success)" : "var(--sc-error)", marginBottom: 6 }}>{cls.inflow ? "+" : "-"}{fmtM(sel.amount)}</div>
            <div style={{ marginBottom: 18, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              {txnStatusBadge(sel)}
              {/* O124 — name the pixel. The effect of a void must be visible on the thing
                  that was voided, or the action reads as having done nothing. */}
              {reversedInfo && <span style={badge("neutral")}>Reversed{reversedInfo.date ? ` · ${fmtDate(reversedInfo.date)}` : ""}</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 28, alignItems: "start" }}>
              <div>
                {[
                  ["Description", sel.description || "—"],
                  ["GL account", `${sel.gl_code || ""} ${sel.gl_name || ""}`],
                  ["Offset account", sel.secondary_gl_code ? `${sel.secondary_gl_code} ${sel.secondary_gl_name || ""}` : "—"],
                  ["Type", settle === "ar_collection" ? "Collection (money in)" : settle === "ap_payment" ? "Payment (money out)" : isRevenue(sel) ? "Revenue" : "Expense"],
                  ["AI confidence", sel.confidence != null ? `${sel.confidence}%` : "—"],
                  sel.payment_status === "paid" ? ["Payment", `${methodLabel(sel.payment_method_used)}${sel.paid_at ? ` · ${fmtDate(sel.paid_at)}` : ""}${sel.payment_reference ? ` · ${sel.payment_reference}` : ""}`] : null,
                  (sel.payment_status === "paid" || sel.payment_status === "collected") ? ["How paid", (sel.auto_matched || sel.payment_method_used === "bank_transfer") ? `Auto-matched from bank statement${sel.matched_bank_date ? ` (${sel.matched_bank_date})` : ""}` : "Manually marked paid"] : null,
                ].filter(Boolean).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--sc-surface-2)", fontSize: 13 }}>
                    <span style={{ color: "var(--sc-text-2)", flexShrink: 0 }}>{k}</span>
                    <span style={{ color: "var(--sc-text)", textAlign: "right", wordBreak: "break-word" }}>{v}</span>
                  </div>
                ))}
                {displayReasoning(sel) && (
                  <div style={{ marginTop: 16, background: "var(--sc-gold-soft)", borderLeft: "3px solid var(--sc-gold)", borderRadius: "0 10px 10px 0", padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--sc-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, color: "var(--sc-gold)", fontWeight: 600 }}>AI REASONING</div>
                    </div>
                    <div style={{ fontSize: 13, color: "var(--sc-text-2)", lineHeight: 1.6 }}>{displayReasoning(sel)}</div>
                  </div>
                )}
                {/* Matched settlement ↔ original linkage (both directions, clickable). */}
                {(() => {
                  const orig = clearedOriginal(sel, invoices);
                  const settledBy = clearingSettlement(sel, invoices);
                  const link = orig || settledBy;
                  if (!link) return null;
                  const text = orig
                    ? `Cleared the ${orig.vendor} ${orig.docNoun} (${fmtM(orig.amount)})`
                    : `Settled by ${settledBy.actionNoun}${settledBy.date ? ` on ${fmtDate(settledBy.date)}` : ""} (${fmtM(settledBy.amount)})`;
                  return (
                    <div style={{ marginTop: 12, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border)", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 10, letterSpacing: 1, color: "var(--sc-text-2)", fontWeight: 600, marginBottom: 7, display: "flex", alignItems: "center", gap: 6 }}><span style={{ color: "var(--sc-gold)" }}>↔</span> MATCHED SETTLEMENT</div>
                      <div style={{ fontSize: 13, color: "var(--sc-text)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                        <span style={{ wordBreak: "break-word" }}>{text}</span>
                        {onNavigate && <button onClick={() => onNavigate(link.id)} style={{ flexShrink: 0, padding: "5px 12px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>View →</button>}
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div>
                {(() => {
                  const srcDoc = findSourceDoc(sel);
                  return (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 10, letterSpacing: 1, color: "var(--sc-gold)", marginBottom: 8, fontWeight: 600 }}>SOURCE DOCUMENT</div>
                      {srcDoc ? (
                        <SourceDocPreview doc={srcDoc} onExpand={() => setSrcDocPreview(srcDoc)} />
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--sc-bg)", border: "1px dashed var(--sc-border-2)", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 12, color: "var(--sc-text-mut)" }}>No source document attached.</div>
                          <button onClick={() => srcFileRef.current?.click()} disabled={srcUploading} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: srcUploading ? "var(--sc-border)" : "var(--sc-gold)", border: "none", color: srcUploading ? "var(--sc-text-mut)" : "var(--sc-surface)", cursor: srcUploading ? "default" : "pointer", whiteSpace: "nowrap" }}>{srcUploading ? "Uploading…" : "↑ Upload"}</button>
                          <input ref={srcFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleSourceUpload(f, sel); }} />
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Recode is a data change — hidden for member-role users (Item 20). */}
            {!isMember && (
            <div style={{ marginTop: 18 }}>
              {recodeOpen ? (
                <div>
                  <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 6, letterSpacing: 0.5 }}>RECODE GL ACCOUNT</div>
                  <select defaultValue={sel.gl_code} onChange={e => doRecode(sel, e.target.value)} style={{ width: "100%", background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "var(--sc-text)", outline: "none" }}>
                    {(CHART_OF_ACCOUNTS || []).filter(a => a.code >= "4000").map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <button onClick={() => setRecodeOpen(false)} style={{ marginTop: 8, background: "none", border: "none", color: "var(--sc-text-2)", fontSize: 12, cursor: "pointer", padding: 0 }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setRecodeOpen(true)} style={{ fontSize: 12, color: "var(--sc-gold)", background: "var(--sc-gold-soft)", border: "1px solid var(--sc-gold-soft)", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600 }}>Recode GL account</button>
              )}
            </div>
            )}
          </div>

          {/* Actions footer */}
          <div style={{ padding: "16px 24px", borderTop: "1px solid var(--sc-surface-2)", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {payOpen ? (
              <>
                <span style={{ fontSize: 12, color: "var(--sc-text-2)" }}>Pay {sel.vendor} · {fmtM(sel.amount)}:</span>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--sc-text)", outline: "none" }} />
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "var(--sc-text)", outline: "none" }}>
                  {METHOD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button onClick={() => { markPaid(sel.id, payMethod, { date: payDate }); setPayOpen(false); }} style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "var(--sc-success)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Confirm</button>
                <button onClick={() => setPayOpen(false)} style={{ padding: "9px 12px", borderRadius: 8, fontSize: 13, background: "var(--sc-surface)", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", cursor: "pointer" }}>Cancel</button>
              </>
            ) : (
              <>
                {cls.settleAction === "pay" && (
                  <button onClick={() => setPayOpen(true)} style={{ flex: 1, padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "var(--sc-success)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Mark as Paid</button>
                )}
                <button onClick={() => { setReturnTo && setReturnTo(returnContext || null); setSelectedInvoice(sel); setView("detail"); }} style={{ flex: 1, padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "var(--sc-gold)", border: "none", color: "var(--sc-on-accent)", cursor: "pointer" }}>Full entry →</button>
                {sel.status !== "voided" && !isMember && (
                  // ★ DISABLED, NOT REFUSED-ON-CLICK. Refusing on click is strictly worse
                  // than not offering: it teaches that clicking is how you find out.
                  reversedInfo
                    ? <button disabled title={`Already reversed${reversedInfo.date ? ` on ${fmtDate(reversedInfo.date)}` : ""}`} style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, background: "var(--sc-surface-2)", border: "1px solid var(--sc-border)", color: "var(--sc-text-2)", cursor: "not-allowed" }}>Already reversed</button>
                    : <button onClick={() => doVoid(sel)} style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, background: "var(--sc-surface)", border: "1px solid var(--sc-error-soft)", color: "var(--sc-error)", cursor: "pointer" }}>Void</button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      {srcDocPreview && <DocumentPreviewModal doc={srcDocPreview} onClose={() => setSrcDocPreview(null)} />}
    </>
  ), document.body);
}
