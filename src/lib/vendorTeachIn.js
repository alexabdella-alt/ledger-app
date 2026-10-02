// ─────────────────────────────────────────────────────────────────────────────
// C563 — VENDOR TEACH-IN: learn a new client's vendors from paperwork they already have.
//
// The app learned a business's vendors only as bills arrived, so the first real month — the
// client's first impression — was all guesses and questions. Teach-in front-loads it: read the
// last two or three bank statements, build ONE table of every vendor (how often, how much, the
// category we'd use), and let the owner or their accountant confirm it once. Each confirmed row
// becomes a vendor rule, so from the first live bill those vendors file themselves.
//
// ★★ LEARN ONLY. Nothing on these statements is recorded: they predate Day One, and anything
// before it belongs in the starting balances (§12, the cutoff rule). The table is the product.
//
// ★★ WHY A CONFIRMED ROW MAY BECOME A RULE (§9, attestation scoped to the question asked):
// the person is shown the vendor AND the category and asked "is this where it goes?" — they
// are choosing the category, not describing a bill for us to map. That is the strongest
// signal the app has, which is why it writes a rule rather than a learned guess.
//
// ★ MIXED VENDORS ARE NOT FORCED INTO ONE CATEGORY. A corner store sells groceries one week
// and printer ink the next; a rule would file every visit the same way. Where the suggested
// categories disagree, the default is "ask each time" and no rule is written.
// ─────────────────────────────────────────────────────────────────────────────
import { vendorKey } from "./vendorRules.js";

export const DECISION = { CATEGORY: "category", ASK: "ask", PERSONAL: "personal" };
export const MIXED_SHARE = 0.75;   // below this, the vendor's lines disagree: ask each time

const isOut = (l) => {
  const t = String(l?.type || "").toLowerCase();
  if (t === "revenue" || t === "income" || t === "deposit" || t === "credit") return false;
  if (t === "expense" || t === "debit" || t === "withdrawal") return true;
  return Number(l?.amount) < 0;
};
const amt = (l) => Math.abs(Number(l?.amount) || 0);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (n) => Math.round(n * 100) / 100;

// How often a vendor bills, from the gaps between its charges. Plain words, for an owner.
export function cadenceOf(dates = []) {
  const ds = [...new Set(dates.filter(Boolean))].sort();
  if (ds.length <= 1) return "once";
  const gaps = [];
  for (let i = 1; i < ds.length; i++) gaps.push((new Date(ds[i]) - new Date(ds[i - 1])) / 86400000);
  const g = median(gaps);
  if (g <= 9) return "weekly";
  if (g <= 20) return "every two weeks";
  if (g <= 40) return "monthly";
  return "now and then";
}

// lines: categorised statement lines { date, vendor, amount, type, gl_code, gl_name }.
// rules: existing vendor rules — a vendor that already has one is left alone and counted.
export function buildTeachInTable(lines = [], { rules = [], aliasIndex = null, bookable = [] } = {}) {
  const live = new Set((bookable || []).map((a) => String(a.code)));
  const ruled = new Set((rules || []).map((r) => vendorKey(r.vendor, aliasIndex)).filter(Boolean));
  const groups = new Map();
  for (const l of lines || []) {
    if (!l || !isOut(l)) continue;
    const key = vendorKey(l.vendor, aliasIndex);
    if (!key) continue;
    const g = groups.get(key) || groups.set(key, { key, names: new Map(), lines: [] }).get(key);
    g.names.set(l.vendor, (g.names.get(l.vendor) || 0) + 1);
    g.lines.push(l);
  }
  const rows = [];
  let alreadyRuled = 0;
  for (const g of groups.values()) {
    if (ruled.has(g.key)) { alreadyRuled++; continue; }
    const names = [...g.names.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
    const codes = new Map();
    for (const l of g.lines) {
      const c = String(l.gl_code || "");
      if (!c || (live.size && !live.has(c))) continue;
      const cur = codes.get(c) || { gl_code: c, gl_name: l.gl_name || c, n: 0 };
      cur.n++; codes.set(c, cur);
    }
    const ranked = [...codes.values()].sort((a, b) => b.n - a.n || a.gl_code.localeCompare(b.gl_code));
    const top = ranked[0] || null;
    const share = top ? top.n / g.lines.length : 0;
    const mixed = ranked.length > 1 && share < MIXED_SHARE;
    rows.push({
      key: g.key,
      name: names[0][0],
      otherNames: names.slice(1).map((n) => n[0]),
      count: g.lines.length,
      cadence: cadenceOf(g.lines.map((l) => l.date)),
      typical: r2(median(g.lines.map(amt))),
      total: r2(g.lines.reduce((t, l) => t + amt(l), 0)),
      suggested: top ? { gl_code: top.gl_code, gl_name: top.gl_name } : null,
      share: r2(share),
      mixed,
      decision: !top || mixed ? { kind: DECISION.ASK } : { kind: DECISION.CATEGORY, gl_code: top.gl_code },
    });
  }
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { rows, alreadyRuled };
}

// The owner's decisions → the rules to write. A category must be on the company's bookable
// chart; "personal" files to the owner's draw (how a bookkeeper treats a personal charge on a
// business account), if the company has one; "ask" writes nothing.
export function planTeachIn(rows = [], decisions = {}, { bookable = [], ownersDraw = null } = {}) {
  const byCode = new Map((bookable || []).map((a) => [String(a.code), a]));
  const rules = [], asked = [], skipped = [];
  for (const row of rows || []) {
    const d = decisions[row.key] || row.decision || { kind: DECISION.ASK };
    if (d.kind === DECISION.PERSONAL) {
      if (ownersDraw && ownersDraw.code) rules.push({ vendor: row.name, gl_code: String(ownersDraw.code), gl_name: ownersDraw.name, personal: true });
      else skipped.push({ vendor: row.name, why: "no owner's draw category" });
      continue;
    }
    if (d.kind === DECISION.CATEGORY) {
      const acct = byCode.get(String(d.gl_code));
      if (acct) rules.push({ vendor: row.name, gl_code: String(acct.code), gl_name: acct.name });
      else skipped.push({ vendor: row.name, why: "that category isn't available" });
      continue;
    }
    asked.push(row.name);
  }
  return { rules, asked, skipped };
}
