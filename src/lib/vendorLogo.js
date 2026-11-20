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
  if (/\.(test|example|invalid|localhost|local)$/.test(host)) return null;   // C765 — reserved names never belong to a real company
  return host;
}

export function logoUrlFor(domain, { size = 64 } = {}) {
  const d = domainFromWebsite(domain);
  if (!d) return null;
  return `${FAVICON_ENDPOINT}?domain=${encodeURIComponent(d)}&sz=${size}`;
}

// ★ C765 — WIDER, STILL NO GUESSING. Two more sources we can stand behind:
//   3. the domain of an EMAIL a person saved on the contact (billing@sysco.com → sysco.com) — not a
//      free mailbox (gmail.com is not the vendor);
//   4. a LOGO-ONLY list of well-known national brands (Home Depot, Staples, Apple…). Kept apart from
//      the directory on purpose: the directory also decides a vendor's CATEGORY, and a brand appearing
//      here must never change how anything is booked. Matching is strict — a one-word brand must be the
//      whole name ("Apple Inc." yes, "Apple Bee Farms" no), a longer one must lead it ("THE HOME DEPOT
//      #4512" yes). A local supplier keeps its initials, as before.
const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "comcast.net", "att.net", "sbcglobal.net", "verizon.net", "zoho.com", "yandex.com"]);
export function domainFromEmail(email) {
  const m = /@([a-z0-9.-]+\.[a-z]{2,})\s*$/i.exec(String(email || "").trim());
  if (!m) return null;
  const d = m[1].toLowerCase().replace(/^(mail|email|billing|invoices?|accounts?|ar|noreply|no-reply)\./, "");
  return FREE_MAIL.has(d) ? null : domainFromWebsite(d);
}

export const KNOWN_BRAND_DOMAINS = {
  "amazon": "amazon.com", "amazon com": "amazon.com", "amzn mktp": "amazon.com", "amazon marketplace": "amazon.com", "amazon prime": "amazon.com",
  "home depot": "homedepot.com", "lowes": "lowes.com", "staples": "staples.com", "office depot": "officedepot.com", "officemax": "officedepot.com",
  "costco": "costco.com", "costco wholesale": "costco.com", "walmart": "walmart.com", "sams club": "samsclub.com", "target": "target.com",
  "best buy": "bestbuy.com", "ikea": "ikea.com", "wayfair": "wayfair.com", "etsy": "etsy.com", "ebay": "ebay.com", "uline": "uline.com",
  "grainger": "grainger.com", "harbor freight": "harborfreight.com", "tractor supply": "tractorsupply.com", "sherwin williams": "sherwin-williams.com",
  "autozone": "autozone.com", "oreilly auto parts": "oreillyauto.com", "vistaprint": "vistaprint.com",
  "apple": "apple.com", "google": "google.com", "microsoft": "microsoft.com", "adobe": "adobe.com", "dropbox": "dropbox.com", "zoom": "zoom.us",
  "zoom video communications": "zoom.us", "slack": "slack.com", "notion": "notion.so", "canva": "canva.com", "figma": "figma.com", "github": "github.com",
  "shopify": "shopify.com", "squarespace": "squarespace.com", "wix": "wix.com", "godaddy": "godaddy.com", "mailchimp": "mailchimp.com",
  "intuit": "intuit.com", "quickbooks": "quickbooks.intuit.com", "xero": "xero.com", "gusto": "gusto.com", "adp": "adp.com", "paychex": "paychex.com",
  "paypal": "paypal.com", "venmo": "venmo.com", "netflix": "netflix.com", "spotify": "spotify.com", "linkedin": "linkedin.com", "facebook": "facebook.com",
  "meta": "meta.com", "meta platforms": "meta.com", "instagram": "instagram.com", "youtube": "youtube.com", "tiktok": "tiktok.com",
  "openai": "openai.com", "anthropic": "anthropic.com", "atlassian": "atlassian.com", "hubspot": "hubspot.com", "salesforce": "salesforce.com",
  "docusign": "docusign.com", "calendly": "calendly.com", "zapier": "zapier.com", "asana": "asana.com", "trello": "trello.com", "grammarly": "grammarly.com",
  "loom": "loom.com", "vimeo": "vimeo.com", "distrokid": "distrokid.com", "plugin boutique": "pluginboutique.com", "splice": "splice.com",
  "sweetwater": "sweetwater.com", "guitar center": "guitarcenter.com", "bh photo": "bhphotovideo.com", "b and h photo": "bhphotovideo.com",
  "adorama": "adorama.com", "rogue fitness": "roguefitness.com", "nike": "nike.com", "dell": "dell.com", "hp": "hp.com", "lenovo": "lenovo.com",
  "samsung": "samsung.com", "uber": "uber.com", "uber eats": "ubereats.com", "lyft": "lyft.com", "doordash": "doordash.com", "grubhub": "grubhub.com",
  "instacart": "instacart.com", "starbucks": "starbucks.com", "dunkin": "dunkindonuts.com", "mcdonalds": "mcdonalds.com", "chipotle": "chipotle.com",
  "dominos": "dominos.com", "dominos pizza": "dominos.com", "fedex": "fedex.com", "ups": "ups.com", "usps": "usps.com", "dhl": "dhl.com",
  "delta air lines": "delta.com", "united airlines": "united.com", "american airlines": "aa.com", "southwest airlines": "southwest.com", "jetblue": "jetblue.com",
  "marriott": "marriott.com", "hilton": "hilton.com", "hyatt": "hyatt.com", "airbnb": "airbnb.com", "expedia": "expedia.com",
  "att": "att.com", "verizon": "verizon.com", "verizon wireless": "verizon.com", "t mobile": "t-mobile.com", "comcast": "xfinity.com", "xfinity": "xfinity.com",
  "spectrum": "spectrum.com", "chevron": "chevron.com", "exxon": "exxon.com", "exxonmobil": "exxon.com", "cvs": "cvs.com", "cvs pharmacy": "cvs.com",
  "walgreens": "walgreens.com", "whole foods": "wholefoodsmarket.com", "whole foods market": "wholefoodsmarket.com", "trader joes": "traderjoes.com",
  "kroger": "kroger.com", "heb": "heb.com", "publix": "publix.com", "enterprise rent a car": "enterprise.com", "hertz": "hertz.com",
  "geico": "geico.com", "state farm": "statefarm.com", "progressive": "progressive.com", "allstate": "allstate.com",
  "chase": "chase.com", "bank of america": "bankofamerica.com", "wells fargo": "wellsfargo.com", "american express": "americanexpress.com",
  "amex": "americanexpress.com", "capital one": "capitalone.com", "legalzoom": "legalzoom.com", "wework": "wework.com",
};
const SUFFIX = new Set(["inc", "llc", "ltd", "corp", "corporation", "co", "company", "incorporated", "store", "stores", "com", "us", "usa"]);
export function brandKey(name) {
  let t = String(name || "").toLowerCase().replace(/&/g, " and ").replace(/['’.]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  t = t.replace(/^the /, "");
  const words = t.split(" ").filter(Boolean);
  while (words.length > 1 && (SUFFIX.has(words[words.length - 1]) || /^\d+$/.test(words[words.length - 1]))) words.pop();
  return words.join(" ");
}
export function brandDomain(name) {
  const k = brandKey(name);
  if (!k) return null;
  if (KNOWN_BRAND_DOMAINS[k]) return KNOWN_BRAND_DOMAINS[k];
  // a multi-word brand may lead a longer bank/receipt name ("home depot 4512 austin tx")
  for (const [b, d] of Object.entries(KNOWN_BRAND_DOMAINS)) if (b.includes(" ") && k.startsWith(`${b} `)) return d;
  return null;
}

// The domain we can stand behind for this vendor, and where it came from — or null.
//   vendor:    { name, website?, email? }
//   directory: the directory rows (defaults to the curated seed)
export function vendorDomain(vendor = {}, { directory = DIRECTORY_SEED } = {}) {
  const fromContact = domainFromWebsite(vendor?.website);
  if (fromContact) return { domain: fromContact, source: "contact" };
  const fromEmail = domainFromEmail(vendor?.email);   // C765
  if (fromEmail) return { domain: fromEmail, source: "email" };
  const hit = vendor?.name ? matchDirectory(vendor.name, directory) : null;
  if (hit?.domain) return { domain: domainFromWebsite(hit.domain), source: "directory" };
  const brand = vendor?.name ? brandDomain(vendor.name) : null;   // C765
  if (brand) return { domain: brand, source: "brand" };
  return null;
}

export function vendorLogo(vendor = {}, opts = {}) {
  const d = vendorDomain(vendor, opts);
  if (!d?.domain) return null;
  return { url: logoUrlFor(d.domain, opts), domain: d.domain, source: d.source };
}
