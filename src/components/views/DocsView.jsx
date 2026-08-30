import React from "react";
import { useERP } from "../ERPContext";
import { filterDocuments, documentDate, documentDateLabel } from "../../lib/docLibrary";
import { fmtDate } from "../../lib/format";
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
  if (!url) return <div style={{ ...style, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--sc-text-mut)", fontSize: 22 }}>🖼</div>;
  return <img src={url} style={style} alt={alt || ""} loading="lazy" />;
}

export default function DocsView() {
  const { docLibrary, docsFilterType, docsPreview, setDocsFilterType, setDocsPreview, supabase, invoices } = useERP();
  const [query, setQuery] = React.useState("");
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const preview = docsPreview; const setPreview = setDocsPreview;
  const filterType = docsFilterType; const setFilterType = setDocsFilterType;
  const types = ["all", ...new Set(docLibrary.map(d => d.type))];
  // ★ THE HEADER SAID "stored and searchable" AND THERE WAS NO SEARCH INPUT.
  // Filename + type + date range — deliberately NOT content search, because we do not hold
  // the extracted text and a box that silently only looks at filenames while implying
  // otherwise would be one more claim this screen does not keep.
  const filtered = filterDocuments(docLibrary, { query, type: filterType, from: from || null, to: to || null }, invoices);

  const isImage = m => (m || "").startsWith("image");
  const isPdf = m => m === "application/pdf";
  const iconFor = t => t === "invoice" ? "🧾" : t === "contract" ? "📄" : t === "bank_statement" ? "🏦" : t === "payroll" ? "💼" : "📋";
  const hasFile = d => !!(d && (d.base64 || d.storage_path));

  return (
    <div>
      <div style={{ marginBottom: 24, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: 3, color: "var(--sc-text-2)", marginBottom: 8 }}>DOCUMENT LIBRARY</div>
          <h1 style={{ fontSize: 28, fontWeight: 600, margin: 0, letterSpacing: -0.5 }}>Documents</h1>
          <div style={{ fontSize: 13, color: "var(--sc-text-2)", marginTop: 6 }}>Every uploaded file — invoices, contracts, bank statements, payroll — stored and searchable. {docLibrary.length} document{docLibrary.length !== 1 ? "s" : ""} stored.</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {types.map(t => (
            <button key={t} onClick={() => setFilterType(t)} style={{ padding: "6px 14px", borderRadius: 20, fontSize: 12, background: filterType === t ? "var(--sc-gold)" : "var(--sc-border)", border: "none", color: filterType === t ? "var(--sc-surface)" : "var(--sc-text-2)", cursor: "pointer", textTransform: "capitalize" }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by name or type…"
          style={{ flex: "1 1 240px", minWidth: 0, height: 36, borderRadius: 9, border: "1px solid var(--sc-border-2)", background: "var(--sc-surface)", color: "var(--sc-text)", padding: "0 12px", fontSize: 13 }} />
        <label style={{ fontSize: 12, color: "var(--sc-text-2)", display: "flex", alignItems: "center", gap: 6 }}>From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            style={{ height: 36, borderRadius: 9, border: "1px solid var(--sc-border-2)", background: "var(--sc-surface)", color: "var(--sc-text)", padding: "0 10px", fontSize: 13 }} /></label>
        <label style={{ fontSize: 12, color: "var(--sc-text-2)", display: "flex", alignItems: "center", gap: 6 }}>To
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            style={{ height: 36, borderRadius: 9, border: "1px solid var(--sc-border-2)", background: "var(--sc-surface)", color: "var(--sc-text)", padding: "0 10px", fontSize: 13 }} /></label>
        {(query || from || to) && (
          <button onClick={() => { setQuery(""); setFrom(""); setTo(""); }}
            style={{ height: 36, padding: "0 12px", borderRadius: 9, background: "transparent", border: "1px solid var(--sc-border-2)", color: "var(--sc-text-2)", fontSize: 12, cursor: "pointer" }}>Clear</button>
        )}
        <span style={{ fontSize: 12, color: "var(--sc-text-mut)" }}>{filtered.length} of {docLibrary.length}</span>
      </div>

      {preview && <DocumentPreviewModal doc={preview} onClose={() => setPreview(null)} />}

      {filtered.length === 0 ? (
        <div style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 14, padding: 48, textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📁</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 8 }}>No documents yet</div>
          <div style={{ fontSize: 13, color: "var(--sc-text-2)" }}>Documents are stored automatically when you upload invoices, contracts, bank statements, and payroll files.</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(240px,1fr))", gap: 12 }}>
          {filtered.map(doc => {
            const legacy = !hasFile(doc);
            return (
              <div key={doc.id} style={{ background: "var(--sc-surface)", border: "1px solid var(--sc-border)", borderRadius: 12, overflow: "hidden", cursor: "pointer", transition: "border-color 0.15s" }}
                onMouseEnter={e => e.currentTarget.style.borderColor = "var(--sc-gold)"}
                onMouseLeave={e => e.currentTarget.style.borderColor = "var(--sc-border)"}
                onClick={() => setPreview(doc)}>
                {/* Thumbnail: image preview for images, icon otherwise */}
                <div style={{ height: 120, background: "var(--sc-surface-2)", display: "flex", alignItems: "center", justifyContent: "center", borderBottom: "1px solid var(--sc-border)", overflow: "hidden" }}>
                  {isImage(doc.mediaType) && hasFile(doc)
                    ? <StoredImage supabase={supabase} path={doc.storage_path} base64={doc.base64} mediaType={doc.mediaType} alt={doc.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ fontSize: 40 }}>{isPdf(doc.mediaType) ? "📄" : iconFor(doc.type)}</div>}
                </div>
                <div style={{ padding: 14 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4, wordBreak: "break-word" }}>{doc.name}</div>
                  {/* ★ THE DOCUMENT'S OWN DATE WHEN WE CAN DERIVE IT — a February statement
                      uploaded in August used to read "Aug 25", so "find the January
                      statement" meant "remember which day you uploaded it". A linked entry's
                      date IS the economic date. **And it says which one it is showing**:
                      "Feb 3" and "uploaded Aug 25" are different facts, and silently mixing
                      them is worse than only ever showing the upload date. */}
                  {(() => {
                    const d = documentDate(doc, invoices);
                    if (!d.date) return null;
                    const suffix = documentDateLabel(d);
                    return <div style={{ fontSize: 11, color: "var(--sc-text-2)", marginBottom: 8 }}>{suffix ? `${suffix} ${fmtDate(d.date)}` : fmtDate(d.date)}</div>;
                  })()}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 10, background: "var(--sc-border)", color: "var(--sc-text-2)", borderRadius: 20, padding: "2px 8px", textTransform: "capitalize" }}>{doc.type}</span>
                    {(doc.tags || []).map(t => <span key={t} style={{ fontSize: 10, background: "var(--sc-surface-2)", color: "var(--sc-gold)", borderRadius: 20, padding: "2px 8px" }}>{t}</span>)}
                    {legacy && <span title="Uploaded before file storage was enabled" style={{ fontSize: 10, color: "var(--sc-text-mut)" }}>metadata only</span>}
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
