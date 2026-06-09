// ─────────────────────────────────────────────────────────────────────────────
// Lightweight, client-side financial insights — duplicate detection, recurring
// pattern detection, and CSV export. All run against the already-loaded invoices
// array (no extra DB calls) so they're cheap to call after every booking.
// ─────────────────────────────────────────────────────────────────────────────

// Normalize a vendor/contact name for fuzzy matching (lowercase, drop legal
// suffixes and punctuation). Same spirit as the contacts unique-name handling.
export function normVendor(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\b(inc|llc|l\.l\.c|ltd|corp|co|company|the|plc|gmbh)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const isLive = i => i && i.status !== "voided" && i.status !== "deleted" && !i.deleted_at;
const isExpenseCode = c => { const s = String(c || ""); return s[0] === "5" || s[0] === "6" || s[0] === "7" || s[0] === "8"; };

// Find an existing entry that looks like a duplicate of `invoice`:
//   • exact same amount + same vendor (any date) — catches re-uploads, OR
//   • same vendor + amount within 1% + entry date within 7 days.
// Returns the matched existing invoice, or null. Skips the invoice itself by id.
export function findDuplicate(invoice, invoices) {
  const v = normVendor(invoice?.vendor);
  const amt = Number(invoice?.amount) || 0;
  if (!v || !amt) return null;
  const d = invoice?.date ? new Date(invoice.date) : null;
  for (const ex of invoices || []) {
    if (!isLive(ex)) continue;
    if (String(ex.id) === String(invoice?.id)) continue;
    if (normVendor(ex.vendor) !== v) continue;
    const exAmt = Number(ex.amount) || 0;
    if (!exAmt) continue;
    const exact = Math.abs(exAmt - amt) < 0.005;
    if (exact) return ex;                                   // re-upload (any date)
    const within1pct = Math.abs(exAmt - amt) <= Math.max(0.01, amt * 0.01);
    if (within1pct && d && ex.date) {
      const days = Math.abs((d - new Date(ex.date)) / 86400000);
      if (days <= 7) return ex;                             // same charge, near in time
    }
  }
  return null;
}

// Detect vendors that look like undeclared monthly recurring charges:
// in the last 90 days, appearing 2+ times, amounts within 10% of each other,
// and ~monthly cadence (25–35 days between consecutive charges). Skips vendors
// that already have a recurring rule. Returns an array of suggestion objects.
export function detectRecurringPatterns(invoices, recurring, now = new Date()) {
  const cutoff = new Date(now.getTime() - 90 * 86400000);
  const existing = new Set((recurring || []).map(r => normVendor(r.vendor || r.name)).filter(Boolean));

  const byVendor = {};
  for (const i of invoices || []) {
    if (!isLive(i) || !i.vendor || !i.date || !isExpenseCode(i.gl_code)) continue;
    const d = new Date(i.date);
    if (isNaN(d) || d < cutoff || d > now) continue;
    const key = normVendor(i.vendor);
    if (!key) continue;
    (byVendor[key] = byVendor[key] || []).push({ vendor: i.vendor, amount: Number(i.amount) || 0, date: d, gl_code: i.gl_code, gl_name: i.gl_name });
  }

  const suggestions = [];
  for (const [key, list] of Object.entries(byVendor)) {
    if (list.length < 2 || existing.has(key)) continue;
    list.sort((a, b) => a.date - b.date);
    const amounts = list.map(x => x.amount).filter(a => a > 0);
    if (amounts.length < 2) continue;
    const avg = amounts.reduce((s, a) => s + a, 0) / amounts.length;
    if (avg <= 0) continue;
    if (!amounts.every(a => Math.abs(a - avg) <= avg * 0.10)) continue;     // amounts within 10%
    const gaps = [];
    for (let k = 1; k < list.length; k++) gaps.push((list[k].date - list[k - 1].date) / 86400000);
    if (!(gaps.length && gaps.every(g => g >= 25 && g <= 35))) continue;     // ~monthly cadence
    const last = list[list.length - 1];
    suggestions.push({
      id: "recsug_" + key,
      vendorKey: key,
      vendor: last.vendor,
      count: list.length,
      avgAmount: Math.round(avg * 100) / 100,
      minAmount: Math.min(...amounts),
      maxAmount: Math.max(...amounts),
      gl_code: last.gl_code,
      gl_name: last.gl_name,
      lastDate: last.date.toISOString().slice(0, 10),
    });
  }
  return suggestions;
}

// ── CSV ──
export function toCSV(headers, rows) {
  const esc = v => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = (headers || []).map(esc).join(",");
  const body = (rows || []).map(r => (Array.isArray(r) ? r : [r]).map(esc).join(",")).join("\n");
  return head + (body ? "\n" + body : "");
}

// Trigger a browser-native CSV download (blob + temporary anchor click).
export function downloadCSV(filename, headers, rows) {
  try {
    const blob = new Blob([toCSV(headers, rows)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "export.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (e) {
    console.warn("[csv] download failed:", e);
    return false;
  }
}
