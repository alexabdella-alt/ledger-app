// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD GUARD (CR-34) — a max file-size + type allowlist enforced BEFORE any
// upload path processes a file. The `accept="…"` attribute on a file input is a
// client HINT only (trivially bypassed) and there was NO size cap on the document/
// bank/contract/payroll/QBO intake paths — a hostile authed user could push huge
// blobs into Storage and huge base64 payloads through the AI proxy. This is the
// first-line, deterministic guard (pure → testable).
//
// ⚠ This is UX / first-line only — the AUTHORITATIVE enforcement must be set on the
//   Supabase Storage bucket (file-size-limit + allowed-mime-types) since the client
//   check is bypassable. See the deploy note in the commit / VERIFICATION.md.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;   // 15 MB — generous for a scanned PDF, caps abuse

// Per-intake-kind allowlist: file extensions + the MIME types a browser reports for
// them. Some browsers report "" for .csv/.xlsx — an empty type is allowed as long as
// the extension is on the list (we still reject a wrong extension).
const KINDS = {
  // invoices / receipts / contracts — PDF + images
  document:    { exts: ["pdf", "jpg", "jpeg", "png", "webp"],
                 mimes: ["application/pdf", "image/jpeg", "image/png", "image/webp"] },
  // bank / card statements — spreadsheets + PDF + plain text
  bank:        { exts: ["csv", "xls", "xlsx", "pdf", "txt"],
                 mimes: ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/pdf", "text/plain"] },
  // payroll / QBO exports — spreadsheets + IIF + text
  spreadsheet: { exts: ["csv", "xls", "xlsx", "iif", "txt"],
                 mimes: ["text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain"] },
  // universal drop zone — everything above (image or data)
  universal:   { exts: ["pdf", "jpg", "jpeg", "png", "webp", "csv", "xls", "xlsx"],
                 mimes: ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/csv", "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/plain"] },
  // company logo — images only
  image:       { exts: ["png", "jpg", "jpeg", "webp", "gif", "svg"],
                 mimes: ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"] },
};

const mb = (n) => (Number(n) / 1048576);

// Returns { ok:true } or { ok:false, error:"…plain-English reason" }. `file` is a
// File (or a { name, type, size } shape in tests).
export function validateUpload(file, kind = "universal", { maxBytes = MAX_UPLOAD_BYTES } = {}) {
  if (!file) return { ok: false, error: "No file selected." };
  const size = Number(file.size) || 0;
  if (size > maxBytes) {
    return { ok: false, error: `That file is ${mb(size).toFixed(1)} MB — the limit is ${Math.round(mb(maxBytes))} MB. Please upload a smaller file.` };
  }
  const spec = KINDS[kind] || KINDS.universal;
  const ext = String(file.name || "").split(".").pop().toLowerCase();
  const type = String(file.type || "").toLowerCase();
  if (!spec.exts.includes(ext)) {
    return { ok: false, error: `That file type (.${ext || "?"}) isn't supported here — allowed: ${spec.exts.join(", ")}.` };
  }
  // Real MIME check: if the browser reported a content type, it must be in the
  // allowlist (a .pdf that reports image/gif, or an executable renamed to .pdf that
  // still reports its real type, is rejected). An empty type is tolerated (some
  // browsers omit it for csv/xlsx) since the extension already passed.
  if (type && !spec.mimes.includes(type)) {
    return { ok: false, error: `That file's content type (${type}) doesn't match a supported ${kind} file — please upload a valid ${spec.exts.join("/")}.` };
  }
  return { ok: true };
}
