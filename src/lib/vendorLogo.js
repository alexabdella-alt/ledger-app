// ─────────────────────────────────────────────────────────────────────────────
// C395 — A LOGO FOR A VENDOR WE ACTUALLY KNOW, INITIALS FOR EVERYONE ELSE.
//
// Operator: "can we pull in vendor logos for the vendors, or is that too much? Known
// vendors." The honest version is exactly that scope. A logo is fetched by DOMAIN, and
// we know a vendor's domain in two cases only:
//   1. the curated universal directory (C202) — national vendors, each row now carries
//      the company's own domain, curated alongside the mapping it already asserts;
//   2. a contact whose record carries a `website` — typed by a person on the vendor
//      form, so the domain is theirs, not our guess.
// Everything else keeps the initials avatar. NO name-to-domain guessing: "Hill Country
// Milling" → hillcountrymilling.com is exactly the confident-looking wrong answer this
// codebase spends its time removing, and a wrong logo beside a supplier's name is a
// claim about who they are.
//
// The image itself comes from Google's favicon service (a public, unauthenticated
// endpoint; the site's own icon at 64px). ★ STATED AS A TRADE: the browser requests
// `…?domain=sysco.com`, so the vendor's DOMAIN reaches Google — for the directory rows
// that is a national brand's public domain and says only that a company uses it; for a
// contact it is a domain a person chose to record. Nothing about amounts, dates or the
// company leaves the page. If that trade is ever the wrong one, `logoUrlFor` is the one
// function to change. A failed load falls back to initials (the <img onError> path).
//
// Pure — no fetch, no client.
// ─────────────────────────────────────────────────────────────────────────────
import { matchDirectory, DIRECTORY_SEED } from "./vendorDirectory";

const FAVICON_ENDPOINT = "https://www.google.com/s2/favicons";

// A bare host out of whatever a person typed into "Website": "https://www.sysco.com/x",
// "sysco.com", "www.sysco.com/" → "sysco.com". Null for anything that is not a host.
export function domainFromWebsite(website) {
  const raw = String(website || "").trim();
  if (!raw) return null;
  let host = raw;
  try { host = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/^www\./, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) return null;
  return host;
}

export function logoUrlFor(domain, { size = 64 } = {}) {
  const d = domainFromWebsite(domain);
  if (!d) return null;
  return `${FAVICON_ENDPOINT}?domain=${encodeURIComponent(d)}&sz=${size}`;
}

// The domain we can stand behind for this vendor, and where it came from — or null.
//   vendor:    { name, website? }
//   directory: the directory rows (defaults to the curated seed)
export function vendorDomain(vendor = {}, { directory = DIRECTORY_SEED } = {}) {
  const fromContact = domainFromWebsite(vendor?.website);
  if (fromContact) return { domain: fromContact, source: "contact" };
  const hit = vendor?.name ? matchDirectory(vendor.name, directory) : null;
  if (hit?.domain) return { domain: domainFromWebsite(hit.domain), source: "directory" };
  return null;
}

export function vendorLogo(vendor = {}, opts = {}) {
  const d = vendorDomain(vendor, opts);
  if (!d?.domain) return null;
  return { url: logoUrlFor(d.domain, opts), domain: d.domain, source: d.source };
}
