import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "./ERPContext";

export const isImageDoc = m => (m || "").startsWith("image");
export const isPdfDoc = m => m === "application/pdf";
export const docIcon = t => t === "invoice" ? "🧾" : t === "contract" ? "📄" : t === "bank_statement" ? "🏦" : t === "payroll" ? "💼" : "📋";
export const docHasFile = d => !!(d && (d.base64 || d.storage_path));

// Full-screen document preview modal, shared by the Documents tab and the
// invoice detail view. Portaled to <body> so position:fixed is viewport-relative.
export default function DocumentPreviewModal({ doc, onClose }) {
  const { supabase } = useERP();
  const [previewUrl, setPreviewUrl] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);

  React.useEffect(() => {
    if (!doc) { setPreviewUrl(null); return; }
    if (doc.base64) { setPreviewUrl(`data:${doc.mediaType};base64,${doc.base64}`); return; }
    if (!doc.storage_path) { setPreviewUrl(null); return; } // legacy: metadata only
    let active = true; setPreviewLoading(true); setPreviewUrl(null);
    supabase.storage.from("documents").createSignedUrl(doc.storage_path, 3600).then(({ data }) => {
      if (!active) return;
      setPreviewLoading(false);
      setPreviewUrl(data?.signedUrl || null);
    }).catch(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [doc]);

  if (!doc || typeof document === "undefined") return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5vh 2.5vw", boxSizing: "border-box" }} onClick={onClose}>
      <div style={{ background: "#FFFFFF", borderRadius: 14, width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
        {/* Sticky dark header bar — always visible above the document */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 18px", background: "#1E1E2E", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#F8F9FB", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{doc.name}</div>
            <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{doc.uploaded_at?.slice(0, 10)} · {doc.type}{doc.mediaType ? ` · ${doc.mediaType}` : ""}</div>
          </div>
          {previewUrl && docHasFile(doc) && (
            <a href={previewUrl} download={doc.name} target="_blank" rel="noreferrer"
              style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 9, background: "#4F46E5", border: "1px solid #6366F1", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>↓ Download</a>
          )}
          <button onClick={onClose} aria-label="Close preview" title="Close"
            onMouseEnter={e => { e.currentTarget.style.background = "#DC2626"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#DC2626"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#F8F9FB"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; }}
            style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", color: "#F8F9FB", fontSize: 24, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s" }}>×</button>
        </div>

        {/* Content area fills the rest; scrolls independently */}
        <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#F9FAFB" }}>
          {previewUrl && isPdfDoc(doc.mediaType) && (
            <iframe src={previewUrl} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#FFFFFF" }} title={doc.name} />
          )}
          {previewUrl && isImageDoc(doc.mediaType) && (
            <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <img src={previewUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }} alt={doc.name} />
            </div>
          )}
          {previewUrl && !isImageDoc(doc.mediaType) && !isPdfDoc(doc.mediaType) && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <a href={previewUrl} target="_blank" rel="noreferrer" style={{ padding: "12px 22px", borderRadius: 10, background: "#EEF2FF", border: "1px solid #4F46E533", color: "#4F46E5", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Open file ↗</a>
            </div>
          )}
          {previewLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7280", fontSize: 13 }}>Loading file…</div>
          )}
          {!docHasFile(doc) && !previewLoading && (
            <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
              <div style={{ fontSize: 52, opacity: 0.45 }}>{docIcon(doc.type)}</div>
              <div style={{ fontSize: 13, color: "#6B7280", textAlign: "center", maxWidth: 460, lineHeight: 1.55, background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 18px" }}>
                This document was uploaded before file storage was enabled. Re-upload to enable full preview.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
