// ─────────────────────────────────────────────────────────────────────────────
// ★ C736 — PHONE PHOTOS AND SCREENSHOTS, MADE READABLE BEFORE THEY ARE SENT.
//
// A phone photo of a receipt is often 4032×3024 and 3–6 MB — past what the reading model accepts
// for one image once base64-encoded (~5 MB), and an iPhone may hand over HEIC, which the upload
// guard refuses. Nothing shrank images before: a photo could fail to read, or be turned away at
// the door. Now, at the one place uploads come in (`handleUniversalUpload`), an oversized or HEIC
// image is redrawn as a JPEG no longer than SHRINK_MAX_EDGE on its long side — plenty for a
// receipt to stay legible — BEFORE the size/type check. Anything else passes through untouched,
// and a browser that can't decode the image keeps the original (the guard then says why).
//
// `shrinkPlan` is the decision (pure, tested); `shrinkImageFile` does it in the browser.
// ─────────────────────────────────────────────────────────────────────────────

export const SHRINK_MAX_EDGE = 2400;                 // px on the long side
export const SHRINK_MAX_BYTES = 3 * 1024 * 1024;     // under this and within the edge: left alone
export const SHRINK_QUALITY = 0.86;

const HEIC = /^image\/hei[cf]$/i;
const HEIC_NAME = /\.(heic|heif)$/i;

export function isImageFile({ type = "", name = "" } = {}) {
  return /^image\//i.test(String(type)) || HEIC_NAME.test(String(name)) || /\.(jpe?g|png|webp)$/i.test(String(name));
}

// What to do with an image of this size: { shrink: false } or { shrink: true, width, height }.
export function shrinkPlan({ width = 0, height = 0, size = 0, type = "", name = "" } = {}) {
  const w = Math.max(0, Math.round(Number(width) || 0)), h = Math.max(0, Math.round(Number(height) || 0));
  const heic = HEIC.test(String(type)) || HEIC_NAME.test(String(name));
  const long = Math.max(w, h);
  if (!w || !h) return { shrink: false };
  const tooBig = long > SHRINK_MAX_EDGE || (Number(size) || 0) > SHRINK_MAX_BYTES;
  if (!tooBig && !heic) return { shrink: false };
  const scale = long > SHRINK_MAX_EDGE ? SHRINK_MAX_EDGE / long : 1;
  return { shrink: true, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function shrunkName(name = "photo") {
  const base = String(name || "photo").replace(/\.[^.]+$/, "");
  return `${base || "photo"}.jpg`;
}

// Browser only. Never throws: on any failure the original file comes back.
export async function shrinkImageFile(file) {
  try {
    if (!file || !isImageFile(file) || typeof globalThis.createImageBitmap !== "function" || typeof document === "undefined") return file;
    const bmp = await globalThis.createImageBitmap(file);   // called on globalThis: a detached reference throws "Illegal invocation"
    const plan = shrinkPlan({ width: bmp.width, height: bmp.height, size: file.size, type: file.type, name: file.name });
    if (!plan.shrink) { bmp.close && bmp.close(); return file; }
    const canvas = document.createElement("canvas");
    canvas.width = plan.width; canvas.height = plan.height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";                                 // a transparent screenshot stays readable as JPEG
    ctx.fillRect(0, 0, plan.width, plan.height);
    ctx.drawImage(bmp, 0, 0, plan.width, plan.height);
    bmp.close && bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", SHRINK_QUALITY));
    if (!blob) return file;
    return new File([blob], shrunkName(file.name), { type: "image/jpeg", lastModified: file.lastModified || Date.now() });
  } catch {
    return file;
  }
}

// What to say when an iPhone HEIC photo couldn't be converted in this browser.
export const HEIC_UNREADABLE_COPY = "That iPhone photo is in Apple's HEIC format, which this browser couldn't open. Take it again from the “Take a photo” button here, or share it as a JPEG (on the iPhone: Settings → Camera → Formats → Most Compatible).";
