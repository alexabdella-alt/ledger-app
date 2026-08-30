// ─────────────────────────────────────────────────────────────────────────────
// Lightweight, client-side financial insights — duplicate detection, recurring
// pattern detection, and CSV export. All run against the already-loaded invoices
// array (no extra DB calls) so they're cheap to call after every booking.
// ─────────────────────────────────────────────────────────────────────────────

import { fmtSignedMoney, ymdLocal } from "./format";
import { classifyCadence, typicalIntervalDays, isOffRhythm, offRhythmCopy, FLAT_SD_RATIO } from "./recurringVendor.js";

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
//   • same vendor + exact amount, OR same vendor + amount within 1%, AND within a date window.
// Returns the matched existing invoice, or null. Skips the invoice itself by id.
//
// `windowDays` controls the date gate and DIFFERS BY CALLER (O83 Feb):
//   • null (default — booking / QBO-import re-upload guard): an EXACT amount is a duplicate at
//     ANY date (re-uploading the same bill months later must still warn); a NEAR amount needs
//     the 7-day window.
//   • a number (the anomaly detector passes 7): BOTH exact and near matches must be within that
//     tight window. This is the fix for the O83 false positives — the old exact branch returned
//     "any date", so a legitimate same-amount RECURRING charge (Gusto payroll every 2 weeks,
//     weekly linen) flagged as a "duplicate within a week" even 14–29 days apart. A true double-
//     pay is a same-day-to-a-few-days event; the window (and the "within a week" copy) now agree.
export function findDuplicate(invoice, invoices, { windowDays = null } = {}) {
  const v = normVendor(invoice?.vendor);
  const amt = Number(invoice?.amount) || 0;
  if (!v || !amt) return null;
  const d = invoice?.date ? new Date(invoice.date) : null;
  const gapDays = (ex) => (d && ex.date) ? Math.abs((d - new Date(ex.date)) / 86400000) : Infinity;
  for (const ex of invoices || []) {
    if (!isLive(ex)) continue;
    if (String(ex.id) === String(invoice?.id)) continue;
    if (normVendor(ex.vendor) !== v) continue;
    const exAmt = Number(ex.amount) || 0;
    if (!exAmt) continue;
    const diff = Math.abs(exAmt - amt);
    const exact = diff < 0.005;
    const within1pct = diff <= Math.max(0.01, amt * 0.01);
    if (!exact && !within1pct) continue;
    if (windowDays == null) {
      // Re-upload guard: exact = duplicate at any date; near = within a week.
      if (exact) return ex;
      if (gapDays(ex) <= 7) return ex;
    } else {
      // Anomaly detector: BOTH exact and near must be within the tight window.
      if (gapDays(ex) <= windowDays) return ex;
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
    (byVendor[key] = byVendor[key] || []).push({ vendor: i.vendor, amount: Number(i.amount) || 0, date: d, ymd: String(i.date), gl_code: i.gl_code, gl_name: i.gl_name });
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
      lastDate: last.ymd,   // the stored YYYY-MM-DD (local), not a UTC toISOString round-trip
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

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly detection — proactively surface unusual financial activity. Pure: runs
// against the loaded invoices array (no DB). Returns anomalies with DETERMINISTIC
// ids so a dismissed one (stored in localStorage) doesn't keep reappearing.
//   { id, type, severity: "high"|"medium"|"low", title, description, invoice_ids, detected_at }
// ─────────────────────────────────────────────────────────────────────────────
// C196(4) — NOISE-DETECTOR EXEMPTION. The large-charge and round-amount detectors are
// heuristics about DISCRETIONARY SPEND — "is this equipment you should capitalize?", "is this
// a round estimate rather than an actual?". Neither question is meaningful for a machine-posted
// payroll/system entry: a $4,000 payroll GROSS was flagged "may need to be capitalized" (O85),
// which is nonsense and trains the reviewer to ignore the queue. Detection must not opine on
// entries whose shape it doesn't own. Exported for tests.
export function isSystemPostedEntry(i) {
  const src = String((i && i.source) || "").toLowerCase();
  if (["payroll", "opening_balance", "reconciliation", "depreciation", "qbo_import"].includes(src)) return true;
  const kind = String((i && i.import_metadata && i.import_metadata.kind) || "").toLowerCase();
  return ["payroll", "ap_payment", "ar_collection", "depreciation"].includes(kind);
}

// ── C198·3b (f2) — THE BOOKS' OWN CLOCK ──────────────────────────────────────
// The frontier is the latest date the BOOKS know about: the newest live entry,
// never later than wall-clock (a future-dated entry must not drag the frontier
// forward). Bookkeeping always trails real time — that is the normal state of
// every real client, not an exception — so "how long has it been?" has to be
// asked of the ledger, not of the calendar. Returns YYYY-MM-DD, or null for
// empty books. Pure.
export function booksFrontier(invoices = [], now = new Date()) {
  const nowKey = ymdLocal(now);
  let max = null;
  for (const i of invoices || []) {
    if (!isLive(i) || !i.date) continue;
    const d = String(i.date).slice(0, 10);
    if (d > nowKey) continue;
    if (!max || d > max) max = d;
  }
  return max;
}

const dayDiffYMD = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

export function runAnomalyDetection(invoices, recurring = [], now = new Date(), { frontier = null } = {}) {
  const money = n => fmtSignedMoney(n);   // canonical cents (was ad-hoc whole-dollar)
  const daysAgo = d => (now - new Date(d)) / 86400000;
  const within = (d, days) => { const x = daysAgo(d); return x >= 0 && x <= days; };
  // The period under review wins when the caller supplies one; otherwise the books'
  // own high-water mark. Staleness (detector 4) is measured against THIS, never `now`.
  const asOf = frontier || booksFrontier(invoices, now) || ymdLocal(now);
  const agedFromBooks = d => dayDiffYMD(String(d).slice(0, 10), asOf);
  const out = [];
  // `fingerprint` is a STABLE content key (O83 persistence): re-detecting the same
  // condition yields the same fingerprint, so it dedups to one persisted row and
  // auto-resolves cleanly when the condition disappears. The deterministic `id` each
  // rule already builds IS that key — fingerprint mirrors it (kept as a named field so
  // the persistence layer never has to know each rule's id recipe).
  const push = a => out.push({ detected_at: now.toISOString(), invoice_ids: [], ...a, fingerprint: a.id });

  // ── C198·3b (f3) — EMISSION IS KEYED ON CONTENT, NOT ON ROW IDENTITY ───────
  // Live O86: a statement re-upload took the queue from 5 cards to 10. C193 dedupes
  // LINES; this is the emission layer above it. Half these rules keyed their
  // fingerprint on a journal-entry id, so the same economic fact re-derived from the
  // same statement produced a DIFFERENT key and opened a second card for it — the
  // dedup was keyed on the identity of the row rather than on what the row says.
  //
  // The content key is what the anomaly is ABOUT: type + vendor + the subject's own
  // date and amount. Same charge, same key, whatever the ledger renumbered it to.
  // (category_spike already keyed on GL code + month and keeps its `:YYYY-MM` tail —
  // anomalyTouchesPeriod parses that tail for the aggregate anomalies that carry no
  // entity_refs, so it must stay in that shape.)
  //
  // ONE-TIME TRANSITION: anomalies persisted under the old id-keyed fingerprints no
  // longer match, so on the first scan after this ships they auto-resolve and re-open
  // under their content key — the same reconcile pass does both, so the queue count
  // stays right rather than doubling. A previously DISMISSED anomaly can come back
  // once, because its suppression was recorded against the old key.
  const cents = n => Math.round(Math.abs(Number(n) || 0) * 100);
  const ymd = d => String(d || "").slice(0, 10);
  const subjectKey = i => `${ymd(i && i.date)}:${cents(i && i.amount)}`;

  const expenses = (invoices || []).filter(i => isLive(i) && i.date && isExpenseCode(i.gl_code) && (Number(i.amount) > 0));

  // Group recent expenses by normalized vendor (used by spike / rapid / missing).
  const byVendor = {};
  for (const i of expenses.filter(x => within(x.date, 95))) {
    const k = normVendor(i.vendor);
    if (k) (byVendor[k] = byVendor[k] || []).push(i);
  }
  const sortByDate = list => [...list].sort((a, b) => new Date(a.date) - new Date(b.date));

  // 1. Vendor spike — latest charge ≥ 2× the vendor's recent average.
  for (const [k, list] of Object.entries(byVendor)) {
    if (list.length < 2) continue;
    const s = sortByDate(list);
    const latest = s[s.length - 1];
    const others = s.slice(0, -1);
    const baseline = others.reduce((t, i) => t + (Number(i.amount) || 0), 0) / others.length;
    const amt = Number(latest.amount) || 0;
    if (baseline > 0 && amt >= 2 * baseline && within(latest.date, 40)) {
      const x = (amt / baseline).toFixed(1);
      push({ id: `vendor_spike:${k}:${subjectKey(latest)}`, type: "vendor_spike", severity: "high",
        title: `${latest.vendor} charged ${money(amt)} — ${x}× usual`,
        description: `${latest.vendor} normally runs about ${money(baseline)}; this charge is ${x}× that. Worth a look.`,
        invoice_ids: [latest.id] });
    }
  }

  // 2. Duplicate payment — same vendor + amount within a TIGHT 7-day window (matches the
  // "within a week" copy). The window is applied to exact matches too, so a legitimate
  // same-amount recurring charge (biweekly payroll, monthly insurance) is NOT flagged (O83 Feb).
  // No signed-off-period special-casing: pairs must be within the window regardless of period,
  // which naturally excludes cross-month noise while still catching a real duplicate that
  // straddles a month boundary (e.g. Jan 30 + Feb 2).
  // ── O117 — THE VENDOR'S OWN RHYTHM REPLACES THE FIXED WINDOW FOR THE FLAT-FEE CLASS ──
  // Same-vendor + same-amount inside 7 days is true EVERY WEEK for a weekly flat-fee
  // vendor, by construction — four Bluebonnet cards in August alone, and by O122 a card
  // you see every period is a bug wearing a question mark.
  //
  // ★★ SUPPRESSION IS NOT BLANKET. A genuine double-charge must survive, so the window is
  // measured in the VENDOR'S RHYTHM rather than in days: seven days apart is Bluebonnet's
  // rhythm; three days apart is not. That adds information (their observed cadence) rather
  // than tuning a threshold.
  const flatFee = new Map();
  {
    const byVendor = {};
    for (const i of expenses) {
      const v = normVendor(i.vendor);
      if (!v || !i.date) continue;
      (byVendor[v] = byVendor[v] || []).push(i);
    }
    for (const [v, rows] of Object.entries(byVendor)) {
      const cadence = classifyCadence(rows.map(r => ({ date: r.date, amount: r.amount })));
      if (!cadence.flatFee) continue;
      flatFee.set(v, { cadence, interval: typicalIntervalDays(rows.map(r => r.date)) });
    }
  }
  // Is this charge the vendor's USUAL amount? A flat-fee vendor billing something else is
  // not the expected pattern and keeps the ordinary rule.
  const atUsualAmount = (inv, ff) => {
    // The vendor's TYPICAL charge (median), not the mean — the mean is dragged by exactly
    // the odd charges this test exists to exclude.
    const center = ff && ff.cadence && ff.cadence.center;
    if (!(center > 0)) return false;
    return Math.abs(Math.abs(Number(inv.amount) || 0) - center) / center <= FLAT_SD_RATIO;
  };

  const seen = new Set();
  for (const i of expenses) {
    const dup = findDuplicate(i, expenses.filter(x => String(x.id) !== String(i.id)), { windowDays: 7 });
    if (!dup) continue;

    const ff = flatFee.get(normVendor(i.vendor));
    if (ff && atUsualAmount(i, ff) && atUsualAmount(dup, ff)) {
      const gap = Math.abs((new Date(i.date) - new Date(dup.date)) / 86400000);
      const off = isOffRhythm(gap, ff.interval);
      // On rhythm → this is what the vendor DOES. Say nothing.
      if (off === false) continue;
      // Off rhythm → still a card, but one that names the rhythm instead of restating
      // that two identical charges exist, which for this vendor is not news.
      if (off === true) {
        const key = `${normVendor(i.vendor)}:${cents(i.amount)}:${[ymd(i.date), ymd(dup.date)].sort().join("+")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        push({ id: `rhythm:${key}`, type: "duplicate_payment", severity: "high",
          title: `${i.vendor} charged twice out of their usual rhythm`,
          description: offRhythmCopy({ vendor: i.vendor, gapDays: gap, intervalDays: ff.interval, amount: i.amount }),
          vendor: i.vendor, amount: Math.abs(Number(i.amount) || 0),
          invoice_ids: [i.id, dup.id] });
        continue;
      }
      // `off === null` — no usable interval, so no opinion. Falls through to the ordinary
      // rule below rather than being silently treated as fine.
    }
    // Content key: the vendor, the amount, and the two dates it happened on —
    // NOT the pair of row ids, which a re-run renumbers (C198·3b f3).
    const key = `${normVendor(i.vendor)}:${cents(i.amount)}:${[ymd(i.date), ymd(dup.date)].sort().join("+")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    push({ id: `dup:${key}`, type: "duplicate_payment", severity: "high",
      title: `Possible duplicate payment to ${i.vendor}`,
      description: `Two charges to ${i.vendor} for ${money(i.amount)} within a week — could be a double payment.`,
      // C195 — structured vendor/amount so pattern suppression can match a prior dismissal
      // without re-parsing prose. Not persisted (anomalyInsertRow maps only real columns).
      vendor: i.vendor, amount: Math.abs(Number(i.amount) || 0),
      invoice_ids: [i.id, dup.id] });
  }

  // 3. Unusual category — this month ≥ 50% above the prior-months average.
  // Bucket by GL CODE (stable) not gl_name (renameable) — the fingerprint keys on the
  // code so a renamed account doesn't spawn a duplicate anomaly. `catName` keeps the
  // human label for display copy.
  const catMonth = {};
  const catName = {};
  for (const i of expenses.filter(x => within(x.date, 130))) {
    const code = String(i.gl_code || i.gl_name || "");
    catName[code] = i.gl_name || code;
    const m = String(i.date).slice(0, 7);
    catMonth[code] = catMonth[code] || {};
    catMonth[code][m] = (catMonth[code][m] || 0) + (Number(i.amount) || 0);
  }
  const thisMonth = ymdLocal(now).slice(0, 7);   // local month key — matches the String(i.date) buckets above (CR-5)
  for (const [code, months] of Object.entries(catMonth)) {
    const cat = catName[code] || code;
    const cur = months[thisMonth] || 0;
    const priors = Object.entries(months).filter(([m]) => m < thisMonth).map(([, v]) => v);
    if (cur <= 0 || priors.length < 1) continue;
    const avg = priors.reduce((t, v) => t + v, 0) / priors.length;
    if (avg > 0 && cur >= 1.5 * avg) {
      push({ id: `category_spike:${code}:${thisMonth}`, type: "category_spike", severity: "medium",
        title: `${cat} is running high this month`,
        description: `${cat} is ${money(cur)} this month vs a ${money(avg)} monthly average — about ${Math.round((cur / avg - 1) * 100)}% higher.`,
        invoice_ids: [] });
    }
  }

  // 4. Missing recurring — a roughly-monthly vendor that's gone quiet 35+ days.
  //
  // C198·3b (f2) — MEASURED AGAINST THE BOOKS, NOT THE CALENDAR. Live O86: "Lone Star
  // hasn't charged you in 59 days" rendered fifty pixels from that vendor's June 8
  // charge, because the age was wall-clock and the books only ran to June. Every real
  // client's books trail real time, so a wall-clock detector reports every one of them
  // as having lost half their vendors. The vendor grouping is anchored to the frontier
  // too — a now()-relative input window would put the trailing-books case (the exact
  // case this fixes) outside the detector's reach entirely.
  //
  // The other detectors below still window on `now`; that is recorded, not fixed here
  // (they ask "is this recent activity unusual?", not "how long has it been?").
  const byVendorAsOf = {};
  for (const i of expenses) {
    const a = agedFromBooks(i.date);
    if (a < 0 || a > 95) continue;
    const k = normVendor(i.vendor);
    if (k) (byVendorAsOf[k] = byVendorAsOf[k] || []).push(i);
  }
  for (const [k, list] of Object.entries(byVendorAsOf)) {
    if (list.length < 2) continue;
    const s = sortByDate(list);
    const gaps = [];
    for (let j = 1; j < s.length; j++) gaps.push((new Date(s[j].date) - new Date(s[j - 1].date)) / 86400000);
    const monthly = gaps.length && gaps.every(g => g >= 25 && g <= 40);
    const last = s[s.length - 1];
    const age = agedFromBooks(last.date);
    if (monthly && age >= 35) {
      push({ id: `missing_recurring:${k}`, type: "missing_recurring", severity: "medium",
        title: `${last.vendor} hasn't charged you in ${Math.round(age)} days`,
        description: `${last.vendor} usually bills about monthly, but the last charge was ${Math.round(age)} days ago — a missed bill or a cancelled service?`,
        invoice_ids: [last.id] });
    }
  }

  // 5. Large single transaction (> $2,500, not capitalized).
  const isCapitalized = i => String(i.gl_code || "")[0] === "1" || i.needs_depreciation || i.capitalized;
  for (const i of expenses.filter(x => within(x.date, 95) && !isSystemPostedEntry(x))) {   // C196(4)
    const amt = Number(i.amount) || 0;
    if (amt > 2500 && !isCapitalized(i)) {
      push({ id: `large_txn:${normVendor(i.vendor)}:${subjectKey(i)}`, type: "large_transaction", severity: "medium",
        title: `Large charge: ${money(amt)} to ${i.vendor}`,
        description: `${money(amt)} to ${i.vendor} on ${String(i.date)}. If it's equipment or software lasting over a year, it may need to be capitalized rather than expensed.`,
        invoice_ids: [i.id] });
    }
  }

  // 6. Round number — exact multiple of $1,000 (possible estimate, not an actual).
  for (const i of expenses.filter(x => within(x.date, 95) && !isSystemPostedEntry(x))) {   // C196(4)
    const amt = Number(i.amount) || 0;
    if (amt >= 1000 && amt % 1000 === 0) {
      push({ id: `round:${normVendor(i.vendor)}:${subjectKey(i)}`, type: "round_number", severity: "low",
        title: `Round amount: ${money(amt)} to ${i.vendor}`,
        description: `${money(amt)} is an exact round number — sometimes that means an estimate was booked instead of the actual amount.`,
        invoice_ids: [i.id] });
    }
  }

  // 7. Rapid sequential — 3+ charges from the same vendor within 48 hours.
  for (const [k, list] of Object.entries(byVendor)) {
    if (list.length < 3) continue;
    const s = sortByDate(list);
    for (let a = 0; a < s.length; a++) {
      const windowItems = s.filter(x => { const h = (new Date(x.date) - new Date(s[a].date)) / 3600000; return h >= 0 && h <= 48; });
      if (windowItems.length >= 3) {
        const tot = windowItems.reduce((t, x) => t + (Number(x.amount) || 0), 0);
        push({ id: `rapid:${k}:${ymd(s[a].date)}:${windowItems.length}`, type: "rapid_sequential", severity: "medium",
          title: `${windowItems.length} charges from ${s[a].vendor} in 48 hours`,
          description: `${windowItems.length} separate charges from ${s[a].vendor} within two days, totaling ${money(tot)}.`,
          invoice_ids: windowItems.map(x => x.id) });
        break;
      }
    }
  }

  const rank = { high: 0, medium: 1, low: 2 };
  out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return out.slice(0, 25);
}
