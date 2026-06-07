import React from "react";
import { useERP } from "../ERPContext";
import DocumentPreviewModal from "../DocumentPreviewModal";

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
  if (!url) return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "#98A2B3", fontSize: 22 }}>🖼</div>;
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

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "#475467", marginBottom: 8 }}>DOCUMENT LIBRARY</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Documents</h1>
          <div style={{ fontSize: 13, color: "#475467", marginTop: 6 }}>Every uploaded file — invoices, contracts, bank statements, payroll — stored and searchable. {docLibrary.length} document{docLibrary.length !== 1 ? "s" : ""} stored.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {types.map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, background: filterType === t ? "#4F46E5" : "#E4E7EC", border: "none", color: filterType === t ? "#fff" : "#475467", cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>
      </div>

      {preview && <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />}

      {filtered.length === 0 ? (
        <div style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 14, padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>No documents yet</div>
          <div style={{ fontSize: 13, color: "#475467" }}>Documents are stored automatically when you upload invoices, contracts, bank statements, and payroll files.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {filtered.map(doc => {
            const legacy = !hasFile(doc);
            return (
              <div key={doc.id} style={{ background: "#FFFFFF", border: "1px solid #E4E7EC", borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "#4F46E5"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "#E4E7EC"}
                onClick={() => setPreview(doc)}>
                {/* Thumbnail: image preview for images, icon otherwise */}
                <div style={{ height: 120, background: "#F3F4F6", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid #E4E7EC", overflow: "hidden" }}>
                  {isImage(doc.mediaType) && hasFile(doc)
                    ? <StoredImage supabase={supabase} path={doc.storage_path} base64={doc.base64} mediaType={doc.mediaType} alt={doc.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ fontSize: 40 }}>{isPdf(doc.mediaType) ? "📄" : iconFor(doc.type)}</div>}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, wordBreak: "break-word" }}>{doc.name}</div>
                  <div style={{ fontSize: 11, color: "#475467", marginBottom: 8 }}>{doc.uploaded_at?.slice(0, 10)}</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, background: "#E4E7EC", color: "#475467", borderRadius: 20, padding: "2px 8px", textTransform: "capitalize" }}>{doc.type}</span>
                    {(doc.tags || []).map(t => <span key={t} style={{ fontSize: 10, background: "#F3F4F6", color: "#4F46E5", borderRadius: 20, padding: "2px 8px" }}>{t}</span>)}
                    {legacy && <span title="Uploaded before file storage was enabled" style={{ fontSize: 10, color: "#98A2B3" }}>metadata only</span>}
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
