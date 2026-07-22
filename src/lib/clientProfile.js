// ─────────────────────────────────────────────────────────────────────────────
// Client AI profile — a per-company business profile the AI grows over time so it
// gets smarter for each specific client (table: client_ai_profile, migration 022).
//
// All Supabase calls here are defensive: if the table doesn't exist yet (migration
// not applied) or a query fails, we degrade gracefully and the app keeps working.
// ─────────────────────────────────────────────────────────────────────────────

import { fmtSignedMoney, todayLocal } from "./format";

const MAX_MONTHS = 18;    // bound JSON growth per spending category
const MAX_VENDORS = 200;  // bound common_vendors size

export function emptyProfile() {
  return {
    business_type: null,
    // vendorLower -> { name, gl_code, gl_name, count, last_seen, source }
    // source: 'human_correction' (a recode/CPA override — authoritative, trusted immediately,
    // never overwritten by AI) | 'ai_booking' (learned from an AI booking — needs repetition).
    // Absent source on legacy entries is treated as 'ai_booking'.
    common_vendors: {},
    spending_patterns: {},  // category   -> { total, count, months: { "YYYY-MM": amount } }
    custom_rules: [],       // ["learned fact", ...]
    ai_notes: null,
  };
}

// Load (or lazily return an empty) profile for a company. Never throws.
export async function loadClientProfile(supabase, companyId) {
  if (!supabase || !companyId) return emptyProfile();
  try {
    const { data, error } = await supabase
      .from("client_ai_profile")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error || !data) return emptyProfile();
    return {
      business_type: data.business_type ?? null,
      common_vendors: data.common_vendors && typeof data.common_vendors === "object" ? data.common_vendors : {},
      spending_patterns: data.spending_patterns && typeof data.spending_patterns === "object" ? data.spending_patterns : {},
      custom_rules: Array.isArray(data.custom_rules) ? data.custom_rules : [],
      ai_notes: data.ai_notes ?? null,
    };
  } catch {
    return emptyProfile();
  }
}

// Fold a confirmed booking into the profile (pure — returns a NEW profile object).
// Tracks the vendor→GL mapping and the month-by-month spend for its category.
export function learnFromBooking(profile, invoice) {
  const p = profile || emptyProfile();
  const vendor = (invoice?.vendor || "").trim();
  const code = String(invoice?.gl_code || "");
  const name = invoice?.gl_name || code;
  const amount = Number(invoice?.amount) || 0;
  if (!vendor || !code) return p;

  const next = {
    ...p,
    common_vendors: { ...(p.common_vendors || {}) },
    spending_patterns: { ...(p.spending_patterns || {}) },
    custom_rules: Array.isArray(p.custom_rules) ? [...p.custom_rules] : [],
  };

  // ── Vendor → GL mapping ──
  const vKey = vendor.toLowerCase();
  const prevV = next.common_vendors[vKey] || { name: vendor, count: 0 };
  if (prevV.source === "human_correction") {
    // A human correction OUTRANKS an AI booking — keep the taught account; only record that
    // the vendor was seen again. The AI can never silently overwrite a human-taught mapping.
    next.common_vendors[vKey] = { ...prevV, name: vendor, count: (prevV.count || 0) + 1, last_seen: (invoice?.date || todayLocal()) };
  } else {
    next.common_vendors[vKey] = {
      name: vendor,
      gl_code: code,
      gl_name: name,
      count: (prevV.count || 0) + 1,
      last_seen: (invoice?.date || todayLocal()),
      source: "ai_booking",
    };
  }
  // Bound size: keep the most-seen vendors if we ever exceed the cap.
  const vEntries = Object.entries(next.common_vendors);
  if (vEntries.length > MAX_VENDORS) {
    next.common_vendors = Object.fromEntries(
      vEntries.sort((a, b) => (b[1].count || 0) - (a[1].count || 0)).slice(0, MAX_VENDORS)
    );
  }

  // ── Spending pattern by category (month buckets) ──
  const cat = name;
  const month = String(invoice?.date || todayLocal()).slice(0, 7);   // spending-month bucket — local default
  const prevC = next.spending_patterns[cat] || { total: 0, count: 0, months: {} };
  const months = { ...(prevC.months || {}) };
  months[month] = (months[month] || 0) + amount;
  // Keep only the most recent MAX_MONTHS buckets.
  const keptMonths = Object.keys(months).sort().slice(-MAX_MONTHS);
  const trimmed = {};
  for (const m of keptMonths) trimmed[m] = months[m];
  next.spending_patterns[cat] = {
    total: (prevC.total || 0) + amount,
    count: (prevC.count || 0) + 1,
    months: trimmed,
  };

  return next;
}

// Fold a HUMAN CORRECTION (a recode / CPA override) into the profile — the highest-quality
// categorization signal there is (O67). OVERWRITES the vendor→GL mapping to the corrected
// account and marks it source:'human_correction', which (a) OUTRANKS any AI booking —
// learnFromBooking will not overwrite it — and (b) is trusted IMMEDIATELY by recallVendor
// (no minCount wait; one human correction should apply to the very next invoice). Pure —
// returns a NEW profile. This is what stops a corrected vendor from re-applying the mistake.
export function learnFromCorrection(profile, correction) {
  const p = profile || emptyProfile();
  const vendor = (correction?.vendor || "").trim();
  const code = String(correction?.gl_code || "");
  const name = correction?.gl_name || code;
  if (!vendor || !code) return p;
  const next = { ...p, common_vendors: { ...(p.common_vendors || {}) } };
  const vKey = vendor.toLowerCase();
  const prevV = next.common_vendors[vKey] || { name: vendor, count: 0 };
  next.common_vendors[vKey] = {
    name: vendor,
    gl_code: code,
    gl_name: name,
    count: Math.max(Number(prevV.count) || 0, 1),   // preserve the seen-count; ≥1
    last_seen: (correction?.date || todayLocal()),
    source: "human_correction",
  };
  return next;
}

// ── Learned-vendor recall (O64 decay) ──
// The bookkeeper who has seen "Bella Vita Catering → a client meal" twice stops asking about
// it. Given a vendor, return the learned GL mapping. An AI-learned mapping is trusted only
// after `minCount` bookings (so a single early AI mistake never hardens into an auto-book);
// a HUMAN correction is trusted immediately (it doesn't need repetition to be authoritative).
// Returns { gl_code, gl_name, count, source } or null.
export function recallVendor(profile, vendor, { minCount = 2 } = {}) {
  const p = profile || emptyProfile();
  const v = String(vendor || "").trim().toLowerCase();
  if (!v) return null;
  const hit = (p.common_vendors || {})[v];
  if (!hit || !hit.gl_code) return null;
  const source = hit.source || "ai_booking";
  if (source !== "human_correction" && (hit.count || 0) < minCount) return null;
  return { gl_code: hit.gl_code, gl_name: hit.gl_name || hit.gl_code, count: hit.count || 0, source };
}

// Add a free-form learned fact (deduped, capped). Returns a NEW profile.
export function addCustomRule(profile, fact) {
  const p = profile || emptyProfile();
  const f = String(fact || "").trim();
  if (!f) return p;
  const existing = Array.isArray(p.custom_rules) ? p.custom_rules : [];
  if (existing.includes(f)) return p;
  return { ...p, custom_rules: [...existing, f].slice(-40) };
}

// Persist the profile (upsert one row per company). Never throws.
export async function persistClientProfile(supabase, companyId, profile) {
  if (!supabase || !companyId || !profile) return false;
  try {
    const { error } = await supabase
      .from("client_ai_profile")
      .upsert(
        {
          company_id: companyId,
          business_type: profile.business_type ?? null,
          common_vendors: profile.common_vendors || {},
          spending_patterns: profile.spending_patterns || {},
          custom_rules: profile.custom_rules || [],
          ai_notes: profile.ai_notes ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id" }
      );
    return !error;
  } catch {
    return false;
  }
}

// Average monthly spend for a category from its month buckets.
function monthlyAverage(patternEntry) {
  const months = patternEntry?.months || {};
  const keys = Object.keys(months);
  if (!keys.length) return 0;
  const sum = keys.reduce((s, k) => s + (Number(months[k]) || 0), 0);
  return sum / keys.length;
}

// Build the "BUSINESS PROFILE FOR THIS CLIENT" block injected into the prompt.
// Returns "" when the profile is effectively empty (nothing learned yet).
export function formatProfileForPrompt(profile) {
  const p = profile || emptyProfile();
  const vendors = Object.values(p.common_vendors || {})
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 15);
  const patterns = Object.entries(p.spending_patterns || {})
    .map(([cat, v]) => ({ cat, avg: monthlyAverage(v) }))
    .filter(x => x.avg > 0)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 8);
  const rules = (p.custom_rules || []).slice(-10);

  const hasAnything = p.business_type || vendors.length || patterns.length || rules.length || p.ai_notes;
  if (!hasAnything) return "";

  const money = n => fmtSignedMoney(n);   // canonical cents (was ad-hoc whole-dollar)
  const lines = [];
  lines.push("BUSINESS PROFILE FOR THIS CLIENT (learned from their own history — use it to code smarter and personalize answers):");
  lines.push(`Business type: ${p.business_type || "not yet identified"}`);
  lines.push(
    "Known vendors and their typical accounts: " +
    (vendors.length
      ? vendors.map(v => `${v.name} → ${v.gl_name || v.gl_code}${v.count > 1 ? ` (seen ${v.count}×)` : ""}`).join("; ")
      : "none learned yet")
  );
  lines.push(
    "Monthly spending patterns (avg/month): " +
    (patterns.length
      ? patterns.map(x => `${x.cat} ≈ ${money(x.avg)}`).join("; ")
      : "not enough history yet")
  );
  if (rules.length) lines.push("Special notes learned about this business: " + rules.join("; "));
  if (p.ai_notes) lines.push(`Additional notes: ${p.ai_notes}`);
  return lines.join("\n");
}
