// ─────────────────────────────────────────────────────────────────────────────
// C193 — SHA-256 content hashing for upload dedup (§11 O84 finding (d)).
//
// Identical bytes must resolve to the SAME document row instead of stacking copies
// (the live library held 3× March + 3× Feb of the same statement). Uses the platform
// WebCrypto (`crypto.subtle.digest`) — no new dependency. The `subtle` seam is
// injectable so the hashing is unit-testable without a browser.
//
// Hashing is CONTENT-only: it says "these bytes are the same file", nothing about
// where they belong. Scoping (per company; per bank account for statements) is the
// caller's job — the same file uploaded to the WRONG account must stay visible as
// its own problem, never silently merged.
// ─────────────────────────────────────────────────────────────────────────────

const defaultSubtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

// SHA-256 of a BufferSource (ArrayBuffer or typed-array view) → lowercase hex.
// Returns null when there is nothing to hash or WebCrypto is unavailable — a null hash
// simply means "not deduped" (the partial unique index exempts NULL), never an error.
export async function sha256Hex(bytes, { subtle = defaultSubtle() } = {}) {
  if (!subtle || bytes == null) return null;
  try {
    const digest = await subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

// SHA-256 of a File/Blob (reads its bytes first). Null-safe: any failure → null.
export async function fileSha256Hex(file, { subtle = defaultSubtle() } = {}) {
  if (!file || typeof file.arrayBuffer !== "function") return null;
  try {
    return await sha256Hex(await file.arrayBuffer(), { subtle });
  } catch {
    return null;
  }
}
