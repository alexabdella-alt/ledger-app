// ────────────────────────────────────────────────────────────────────────────
// O104 — "WHICH SUPPLIERS ARE CREEPING UP?" (C344), ANSWERED ONLY FROM SIGNED MONTHS.
//
// The question an owner asks is not "what did I spend by vendor" (a table already answers
// that) but "who is quietly charging me more than they used to". This names them, in a
// sentence, and it is built ONLY on months an accountant (or the owner, C272) has signed
// off — a report on unreviewed months can name a creep that turns out to be an unbooked
// credit or a duplicate, and O104's whole point is that a report never sounds surer than
// the books. So the LATEST signed month is compared with the signed months before it.
//
// Pure. Groups the way the Vendors tab groups (`vendor_key`, the O111 alias applied by the
// caller if it wants one), counts spend the way the Vendors tab counts it (`isVendorSpend`,
// credits subtract), and refuses to speak with fewer than three signed months to speak from.
// ────────────────────────────────────────────────────────────────────────────
import { isVendorSpend } from "./vendorSummary.js";
import { periodOf } from "./recurringVendor.js";

export const CREEP_MIN_SIGNED_MONTHS = 3;   // latest + at least two to compare against
export const CREEP_RATIO = 1.25;            // a quarter more than usual is "creeping up"
export const CREEP_FLOOR = 100;             // below this the sentence is noise, not news

export function vendorCreep({ rows = [], signedPeriods = [], ratio = CREEP_RATIO, floor = CREEP_FLOOR } = {}) {
  const signed = [...new Set((signedPeriods || []).filter((p) => /^\d{4}-\d{2}$/.test(String(p))))].sort();
  if (signed.length < CREEP_MIN_SIGNED_MONTHS) return { ok: false, reason: "too_few_signed_months", signedMonths: signed.length, latest: null, items: [] };
  const latest = signed[signed.length - 1];
  const priors = new Set(signed.slice(0, -1));
  const byVendor = new Map();   // key → { name, nameDate, latest, priorTotal, priorMonths:Set }
  for (const r of rows || []) {
    if (!isVendorSpend(r)) continue;
    const p = periodOf(r.date);
    if (p !== latest && !priors.has(p)) continue;
    const key = r.vendor_key || r.vendor || null;
    if (!key) continue;
    const amt = r.debit_credit === "credit" ? -(Number(r.amount) || 0) : (Number(r.amount) || 0);
    const v = byVendor.get(key) || { key, name: r.vendor || key, nameDate: "", latest: 0, priorTotal: 0, priorMonths: new Set() };
    if (p === latest) v.latest += amt; else { v.priorTotal += amt; v.priorMonths.add(p); }
    if (r.vendor && String(r.date || "") >= v.nameDate) { v.name = r.vendor; v.nameDate = String(r.date || ""); }
    byVendor.set(key, v);
  }
  const items = [];
  for (const v of byVendor.values()) {
    if (v.priorMonths.size < 2) continue;                   // one prior month is a coincidence, not a "usual"
    const usual = v.priorTotal / v.priorMonths.size;
    if (!(usual > 0) || v.latest < floor) continue;
    if (v.latest / usual >= ratio) items.push({ key: v.key, vendor: v.name, latest: r2(v.latest), usual: r2(usual), ratio: r2(v.latest / usual), priorMonths: v.priorMonths.size });
  }
  items.sort((a, b) => b.latest - b.usual - (a.latest - a.usual));
  return { ok: true, reason: null, signedMonths: signed.length, latest, items };
}

const r2 = (n) => Math.round(n * 100) / 100;

// The sentences. Reads the report (§9). Owner-plain: no "variance", no percentages
// dressed as certainty — the two amounts, and how much of a jump that is.
export function vendorCreepCopy(report, { monthLabel = (p) => p, money = (n) => `$${Number(n).toFixed(2)}` } = {}) {
  if (!report || !report.ok) return { headline: "We need three signed-off months before we can say who's charging more than usual.", lines: [] };
  const when = monthLabel(report.latest) || report.latest;
  if (!report.items.length) return { headline: `In ${when}, no supplier charged noticeably more than usual.`, lines: [] };
  return {
    headline: `In ${when}, ${report.items.length === 1 ? "one supplier" : `${report.items.length} suppliers`} charged more than usual:`,
    lines: report.items.map((i) => `${i.vendor}: ${money(i.latest)}, against about ${money(i.usual)} a month before — ${Math.round((i.ratio - 1) * 100)}% more.`),
  };
}
