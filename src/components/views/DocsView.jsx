import React from "react";
import { createPortal } from "react-dom";
import { useERP } from "../ERPContext";

// Renders an image from Supabase Storage via a short-lived signed URL (or the
// in-session base64 when the file was just uploaded this session).
function StoredImage({ supabase, path, base64, mediaType, style, alt }) {
  const [url, setUrl] = React.useState(base64 ? `data:${mediaType};base64,${base64}` : null);
  React.useEffect(() => {
    if (base64) { setUrl(`data:${mediaType};base64,${base64}`); return; }
    if (!path) { setUrl(null); return; }
    let active = true;
    supabase.storage.from("documents").createSignedUrl(path, 3600).then(({ data }) => {
      if (active && data?.signedUrl) setUrl(data.signedUrl);
    }).catch(() => {});
    return () => { active = false; };
  }, [path, base64, mediaType]);
  if (!url) return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: 22 }}>🖼</div>;
  return <img src={url} style={style} alt={alt || ""} loading="lazy" />;
}

export default function DocsView() {
  const { docLibrary, docsFilterType, docsPreview, setDocsFilterType, setDocsPreview, supabase } = useERP();
  const preview = docsPreview; const setPreview = setDocsPreview;
  const filterType = docsFilterType; const setFilterType = setDocsFilterType;
  const types = ["all", ...new Set(docLibrary.map(d => d.type))];
  const filtered = filterType === "all" ? docLibrary : docLibrary.filter(d => d.type === filterType);

  const isImage = m => (m || "").startsWith("image");
  const isPdf = m => m === "application/pdf";
  const iconFor = t => t === "invoice" ? "🧾" : t === "contract" ? "📄" : t === "bank_statement" ? "🏦" : t === "payroll" ? "💼" : "📋";
  const hasFile = d => !!(d && (d.base64 || d.storage_path));

  // Signed URL for the open preview — regenerated on every open (expires in 1h).
  const [previewUrl, setPreviewUrl] = React.useState(null);
  const [previewLoading, setPreviewLoading] = React.useState(false);
  React.useEffect(() => {
    if (!preview) { setPreviewUrl(null); return; }
    if (preview.base64) { setPreviewUrl(`data:${preview.mediaType};base64,${preview.base64}`); return; }
    if (!preview.storage_path) { setPreviewUrl(null); return; } // legacy: metadata only
    let active = true; setPreviewLoading(true); setPreviewUrl(null);
    supabase.storage.from("documents").createSignedUrl(preview.storage_path, 3600).then(({ data }) => {
      if (!active) return;
      setPreviewLoading(false);
      setPreviewUrl(data?.signedUrl || null);
    }).catch(() => { if (active) setPreviewLoading(false); });
    return () => { active = false; };
  }, [preview]);

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#6B7280", marginBottom: 8 }}>DOCUMENT LIBRARY</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Documents</h1>
          <div style={{ fontSize: 13, color: "#6B7280", marginTop: 6 }}>Every uploaded file — invoices, contracts, bank statements, payroll — stored and searchable. {docLibrary.length} document{docLibrary.length !== 1 ? "s" : ""} stored.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {types.map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, background: filterType === t ? "#4F46E5" : "#E5E7EB", border: "none", color: filterType === t ? "#fff" : "#6B7280", cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>
      </div>

      {preview && typeof document !== "undefined" && createPortal(
        // Rendered into <body> so position:fixed is always relative to the viewport
        // (not trapped by the scrolling main-content container).
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "2.5vh 2.5vw", boxSizing: "border-box" }} onClick={() => setPreview(null)}>
          <div style={{ background: "#FFFFFF", borderRadius: 14, width: "100%", height: "100%", maxWidth: "100%", maxHeight: "100%", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }} onClick={e => e.stopPropagation()}>
            {/* Sticky dark header bar — always visible above the document */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px 10px 18px", background: "#1E1E2E", flexShrink: 0 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#F8F9FB", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{preview.name}</div>
                <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 1 }}>{preview.uploaded_at?.slice(0, 10)} · {preview.type}{preview.mediaType ? ` · ${preview.mediaType}` : ""}</div>
              </div>
              {previewUrl && hasFile(preview) && (
                <a href={previewUrl} download={preview.name} target="_blank" rel="noreferrer"
                  style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 9, background: "#4F46E5", border: "1px solid #6366F1", color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>↓ Download</a>
              )}
              <button onClick={() => setPreview(null)} aria-label="Close preview" title="Close"
                onMouseEnter={e => { e.currentTarget.style.background = "#DC2626"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#DC2626"; }}
                onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "#F8F9FB"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.25)"; }}
                style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.25)", color: "#F8F9FB", fontSize: 24, lineHeight: 1, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.12s" }}>×</button>
            </div>

            {/* Content area fills the rest; scrolls independently */}
            <div style={{ flex: 1, minHeight: 0, position: "relative", background: "#F9FAFB" }}>
              {previewUrl && isPdf(preview.mediaType) && (
                <iframe src={previewUrl} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none", background: "#FFFFFF" }} title={preview.name} />
              )}
              {previewUrl && isImage(preview.mediaType) && (
                <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
                  <img src={previewUrl} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 6 }} alt={preview.name} />
                </div>
              )}
              {previewUrl && !isImage(preview.mediaType) && !isPdf(preview.mediaType) && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <a href={previewUrl} target="_blank" rel="noreferrer" style={{ padding: "12px 22px", borderRadius: 10, background: "#EEF2FF", border: "1px solid #4F46E533", color: "#4F46E5", fontSize: 14, fontWeight: 600, textDecoration: "none" }}>Open file ↗</a>
                </div>
              )}
              {previewLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7280", fontSize: 13 }}>Loading file…</div>
              )}
              {!hasFile(preview) && !previewLoading && (
                <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24 }}>
                  <div style={{ fontSize: 52, opacity: 0.45 }}>{iconFor(preview.type)}</div>
                  <div style={{ fontSize: 13, color: "#6B7280", textAlign: "center", maxWidth: 460, lineHeight: 1.55, background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 10, padding: "14px 18px" }}>
                    This document was uploaded before file storage was enabled. Re-upload to enable full preview.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {filtered.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 14, padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>No documents yet</div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>Documents are stored automatically when you upload invoices, contracts, bank statements, and payroll files.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {filtered.map(doc => {
            const legacy = !hasFile(doc);
            return (
              <div key={doc.id} style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#4F46E5"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#E5E7EB"}
                onClick={() => setPreview(doc)}>
                {/* Thumbnail: image preview for images, icon otherwise */}
                <div style={{ height: 120, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid #E5E7EB", overflow: "hidden" }}>
                  {isImage(doc.mediaType) && hasFile(doc)
                    ? <StoredImage supabase={supabase} path={doc.storage_path} base64={doc.base64} mediaType={doc.mediaType} alt={doc.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ fontSize: 40 }}>{isPdf(doc.mediaType) ? "📄" : iconFor(doc.type)}</div>}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, wordBreak: "break-word" }}>{doc.name}</div>
                  <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 8 }}>{doc.uploaded_at?.slice(0, 10)}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, background: "#E5E7EB", color: "#6B7280", borderRadius: 20, padding: "2px 8px", textTransform: "capitalize" }}>{doc.type}</span>
                    {(doc.tags || []).map(t => <span key={t} style={{ fontSize: 10, background: "#F3F4F6", color: "#4F46E5", borderRadius: 20, padding: "2px 8px" }}>{t}</span>)}
                    {legacy && <span title="Uploaded before file storage was enabled" style={{ fontSize: 10, color: "#9CA3AF" }}>metadata only</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
