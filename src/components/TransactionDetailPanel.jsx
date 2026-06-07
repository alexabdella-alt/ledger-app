import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "./ERPContext";
import { initials, vendorColor, fmtDate } from "../lib/format";
import { glIsRevenue, glIsExpense } from "../lib/gl";
import DocumentPreviewModal, { docIcon, isImageDoc } from "./DocumentPreviewModal";

// Shared transaction detail slide-in. Used by Books and every Reports drill-down so
// the panel lives in exactly one place. Pass the invoice id + an onClose handler.

const METHOD_OPTS = [["ach", "ACH / Bank Transfer"], ["check", "Check"], ["wire", "Wire Transfer"], ["card", "Credit Card"], ["zelle", "Zelle"], ["venmo", "Venmo"], ["paypal", "PayPal"], ["other", "Other"]];
const methodLabel = m => (METHOD_OPTS.find(([v]) => v === m)?.[1]) || (m ? String(m).toUpperCase() : "—");
const needsReview = i => i.approval_status === "pending_approval" || i.approval_status === "flagged" || i.approval_status === "info_requested" || (i.confidence != null && i.confidence < 70);
const fmtM = n => "$" + Math.abs(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
const isRevenue = i => glIsRevenue(i.gl_code) || i.type === "revenue";
const isExpense = i => glIsExpense(i.gl_code) || i.type === "expense";

function pill(c) { return { display: "inline-flex", alignItems: "center", fontSize: 11, fontWeight: 600, color: c, background: c + "14", border: `1px solid ${c}29`, borderRadius: 6, padding: "3px 9px", whiteSpace: "nowrap", lineHeight: 1.2 }; }

// Shared status badge — also used by the Reports drill-down tables.
export function txnStatusBadge(i) {
  if (i.status === "voided") return <span style={pill("#667085")}>Voided</span>;
  if (i.payment_status === "paid") return <span style={pill("#1570EF")}>Paid · {methodLabel(i.payment_method_used).split(" ")[0]}</span>;
  if (i.payment_status === "collected") return <span style={pill("#039855")}>Collected</span>;
  if (needsReview(i)) return <span style={pill("#DC6803")}>Needs Review</span>;
  return <span style={pill("#039855")}>Booked</span>;
}

export default function TransactionDetailPanel({ invoiceId, onClose, returnContext }) {
  const {
    invoices, CHART_OF_ACCOUNTS, markPaid, persistRecode, logAudit,
    setInvoices, setSelectedInvoice, setView, setReturnTo, voidInvoiceWithUndo, docLibrary, storeDocument, fileToBase64, showNotification,
  } = useERP();

  const [recodeOpen, setRecodeOpen] = React.useState(false);
  const [srcDocPreview, setSrcDocPreview] = React.useState(null);
  const [srcUploading, setSrcUploading] = React.useState(false);
  const [payOpen, setPayOpen] = React.useState(false);
  const [payMethod, setPayMethod] = React.useState("ach");
  const [payDate, setPayDate] = React.useState(new Date().toISOString().slice(0, 10));
  const srcFileRef = React.useRef(null);

  React.useEffect(() => { setRecodeOpen(false); setPayOpen(false); }, [invoiceId]);

  const sel = invoices.find(i => i.id === invoiceId) || null;
  if (!sel) return null;

  const close = () => { setRecodeOpen(false); setPayOpen(false); onClose(); };

  const findSourceDoc = (inv) => (docLibrary || []).find(d =>
    d.linked_invoice_id && (String(d.linked_invoice_id) === String(inv?.id) || String(d.linked_invoice_id) === String(inv?.db_entry_id))
  );
  const handleSourceUpload = async (file, inv) => {
    if (!file || !inv) return;
    setSrcUploading(true);
    try {
      const base64 = await fileToBase64(file);
      await storeDocument(file.name, base64, file.type, inv.type || "invoice", inv.db_entry_id || inv.id, ["source"], null, file);
      showNotification("Source document attached ✓");
    } catch (e) { console.error(e); showNotification("Couldn't attach document.", "error"); }
    setSrcUploading(false);
  };
  const doRecode = (inv, code) => {
    const acct = (CHART_OF_ACCOUNTS || []).find(a => a.code === code);
    if (!acct) return;
    setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, gl_code: acct.code, gl_name: acct.name } : i));
    logAudit && logAudit("recode", `Recoded ${inv.vendor} → ${acct.name}`, { gl_code: inv.gl_code }, { gl_code: acct.code, gl_name: acct.name });
    persistRecode && persistRecode([{ ...inv, gl_code: acct.code }], acct.code, acct.name);
    setRecodeOpen(false);
  };
  const doVoid = (inv) => { voidInvoiceWithUndo(inv, "Voided from detail panel"); onClose(); };

  return createPortal((
    <>
      <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 10001, background: "rgba(17,24,39,0.35)", display: "flex", justifyContent: "flex-end" }}>
        <style>{`@keyframes txnPanelIn{from{transform:translateX(100%)}to{transform:translateX(0)}}`}</style>
        <div onClick={e => e.stopPropagation()} style={{ width: 880, maxWidth: "94vw", height: "100%", background: "#FFFFFF", borderLeft: "1px solid #E4E7EC", boxShadow: "-20px 0 60px rgba(16,24,40,0.18)", display: "flex", flexDirection: "column", animation: "txnPanelIn .25s cubic-bezier(.22,1,.36,1)" }}>
          <div style={{ padding: "20px 24px", borderBottom: "1px solid #F3F4F6", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
              <span style={{ width: 42, height: 42, borderRadius: 11, background: vendorColor(sel.vendor), display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, color: "#fff", flexShrink: 0 }}>{initials(sel.vendor)}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sel.vendor || "—"}</div>
                <div style={{ fontSize: 12, color: "#475467" }}>{fmtDate(sel.date)}</div>
              </div>
            </div>
            <button onClick={close} style={{ background: "none", border: "none", color: "#475467", fontSize: 24, cursor: "pointer", lineHeight: 1 }}>×</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
            <div style={{ fontSize: 30, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: isRevenue(sel) ? "#039855" : "#D92D20", marginBottom: 6 }}>{isRevenue(sel) ? "+" : "-"}{fmtM(sel.amount)}</div>
            <div style={{ marginBottom: 18 }}>{txnStatusBadge(sel)}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 28, alignItems: "start" }}>
              <div>
                {[
                  ["Description", sel.description || "—"],
                  ["GL account", `${sel.gl_code || ""} ${sel.gl_name || ""}`],
                  ["Offset account", sel.secondary_gl_code ? `${sel.secondary_gl_code} ${sel.secondary_gl_name || ""}` : "—"],
                  ["Type", isRevenue(sel) ? "Revenue" : "Expense"],
                  ["AI confidence", sel.confidence != null ? `${sel.confidence}%` : "—"],
                  sel.payment_status === "paid" ? ["Payment", `${methodLabel(sel.payment_method_used)}${sel.paid_at ? ` · ${fmtDate(sel.paid_at)}` : ""}${sel.payment_reference ? ` · ${sel.payment_reference}` : ""}`] : null,
                  (sel.payment_status === "paid" || sel.payment_status === "collected") ? ["How paid", (sel.auto_matched || sel.payment_method_used === "bank_transfer") ? `Auto-matched from bank statement${sel.matched_bank_date ? ` (${sel.matched_bank_date})` : ""}` : "Manually marked paid"] : null,
                ].filter(Boolean).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "11px 0", borderBottom: "1px solid #F3F4F6", fontSize: 13 }}>
                    <span style={{ color: "#475467", flexShrink: 0 }}>{k}</span>
                    <span style={{ color: "#101828", textAlign: "right", wordBreak: "break-word" }}>{v}</span>
                  </div>
                ))}
                {sel.reasoning && (
                  <div style={{ marginTop: 16, background: "#F5F3FF", borderLeft: "3px solid #4F46E5", borderRadius: "0 10px 10px 0", padding: "14px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4F46E5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /></svg>
                      <div style={{ fontSize: 11, letterSpacing: 1.5, color: "#4F46E5", fontWeight: 600 }}>AI REASONING</div>
                    </div>
                    <div style={{ fontSize: 13, color: "#475467", lineHeight: 1.6 }}>{sel.reasoning}</div>
                  </div>
                )}
              </div>
              <div>
                {(() => {
                  const srcDoc = findSourceDoc(sel);
                  return (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ fontSize: 10, letterSpacing: 1, color: "#4F46E5", marginBottom: 8, fontWeight: 600 }}>SOURCE DOCUMENT</div>
                      {srcDoc ? (
                        <div onClick={() => setSrcDocPreview(srcDoc)} style={{ display: "flex", alignItems: "center", gap: 12, background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 10, padding: "12px 14px", cursor: "pointer", transition: "border-color 0.15s" }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = "#4F46E5"} onMouseLeave={e => e.currentTarget.style.borderColor = "#E4E7EC"}>
                          <div style={{ width: 42, height: 42, borderRadius: 8, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <span style={{ fontSize: 22 }}>{srcDoc.mediaType === "application/pdf" ? "📄" : isImageDoc(srcDoc.mediaType) ? "🖼" : docIcon(srcDoc.type)}</span>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 500, wordBreak: "break-word" }}>{srcDoc.name}</div>
                            <div style={{ fontSize: 11, color: "#475467", marginTop: 2 }}>{srcDoc.uploaded_at ? fmtDate(srcDoc.uploaded_at) : ""}{srcDoc.mediaType ? ` · ${srcDoc.mediaType}` : ""}</div>
                          </div>
                          <button onClick={(e) => { e.stopPropagation(); setSrcDocPreview(srcDoc); }} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "#EEF2FF", border: "1px solid #4F46E533", color: "#4F46E5", cursor: "pointer", whiteSpace: "nowrap" }}>View Document</button>
                        </div>
                      ) : (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "#F9FAFB", border: "1px dashed #D0D5DD", borderRadius: 10, padding: "12px 14px" }}>
                          <div style={{ fontSize: 12, color: "#98A2B3" }}>No source document attached.</div>
                          <button onClick={() => srcFileRef.current?.click()} disabled={srcUploading} style={{ flexShrink: 0, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: srcUploading ? "#E4E7EC" : "#4F46E5", border: "none", color: srcUploading ? "#98A2B3" : "#fff", cursor: srcUploading ? "default" : "pointer", whiteSpace: "nowrap" }}>{srcUploading ? "Uploading…" : "↑ Upload"}</button>
                          <input ref={srcFileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: "none" }} onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; handleSourceUpload(f, sel); }} />
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>

            <div style={{ marginTop: 18 }}>
              {recodeOpen ? (
                <div>
                  <div style={{ fontSize: 11, color: "#475467", marginBottom: 6, letterSpacing: 0.5 }}>RECODE GL ACCOUNT</div>
                  <select defaultValue={sel.gl_code} onChange={e => doRecode(sel, e.target.value)} style={{ width: "100%", background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 9, padding: "10px 12px", fontSize: 13, color: "#101828", outline: "none" }}>
                    {(CHART_OF_ACCOUNTS || []).filter(a => a.code >= "4000").map(a => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <button onClick={() => setRecodeOpen(false)} style={{ marginTop: 8, background: "none", border: "none", color: "#475467", fontSize: 12, cursor: "pointer", padding: 0 }}>Cancel</button>
                </div>
              ) : (
                <button onClick={() => setRecodeOpen(true)} style={{ fontSize: 12, color: "#4F46E5", background: "#EEF2FF", border: "1px solid #4F46E533", borderRadius: 8, padding: "8px 14px", cursor: "pointer", fontWeight: 600 }}>Recode GL account</button>
              )}
            </div>
          </div>

          {/* Actions footer */}
          <div style={{ padding: "16px 24px", borderTop: "1px solid #F3F4F6", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {payOpen ? (
              <>
                <span style={{ fontSize: 12, color: "#475467" }}>Pay {sel.vendor} · {fmtM(sel.amount)}:</span>
                <input type="date" value={payDate} onChange={e => setPayDate(e.target.value)} style={{ background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#101828", outline: "none" }} />
                <select value={payMethod} onChange={e => setPayMethod(e.target.value)} style={{ background: "#FFFFFF", border: "1px solid #D0D5DD", borderRadius: 8, padding: "8px 10px", fontSize: 12, color: "#101828", outline: "none" }}>
                  {METHOD_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <button onClick={() => { markPaid(sel.id, payMethod, { date: payDate }); setPayOpen(false); }} style={{ padding: "9px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600, background: "#039855", border: "none", color: "#fff", cursor: "pointer" }}>Confirm</button>
                <button onClick={() => setPayOpen(false)} style={{ padding: "9px 12px", borderRadius: 8, fontSize: 13, background: "#FFFFFF", border: "1px solid #D0D5DD", color: "#374151", cursor: "pointer" }}>Cancel</button>
              </>
            ) : (
              <>
                {isExpense(sel) && sel.payment_status !== "paid" && sel.status !== "voided" && (
                  <button onClick={() => setPayOpen(true)} style={{ flex: 1, padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "#039855", border: "none", color: "#fff", cursor: "pointer" }}>Mark as Paid</button>
                )}
                <button onClick={() => { setReturnTo && setReturnTo(returnContext || null); setSelectedInvoice(sel); setView("detail"); }} style={{ flex: 1, padding: "11px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "#4F46E5", border: "none", color: "#fff", cursor: "pointer" }}>Full entry →</button>
                {sel.status !== "voided" && <button onClick={() => doVoid(sel)} style={{ padding: "11px 16px", borderRadius: 10, fontSize: 13, background: "#FFFFFF", border: "1px solid #D92D2044", color: "#D92D20", cursor: "pointer" }}>Void</button>}
              </>
            )}
          </div>
        </div>
      </div>
      {srcDocPreview && <DocumentPreviewModal doc={srcDocPreview} onClose={() => setSrcDocPreview(null)} />}
    </>
  ), document.body);
}
