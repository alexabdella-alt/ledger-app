// ─────────────────────────────────────────────────────────────────────────────
// ★ C738 — COMPLETENESS, ACROSS EVERY CLIENT (the operator's Operations page).
//
// Operator, 2026-11-18: "The worst case scenario would be someone uploads something and it just
// disappears … I don't know that anyone would notice that unless it was a large item." Every check
// below already existed INSIDE one company (the intake ledger, the statement lines, the
// reconciliations), visible only when someone opened that company. This reads the same rows for
// every company at once and says, per client and per month, what is missing — in sentences.
//
// Two different holes, two different nets:
//   1. SOMETHING ARRIVED AND WENT NOWHERE. Every upload is logged on arrival (047) and must reach a
//      resting place — recorded, held with a question, or rejected on purpose. Still "received" /
//      "processing" after a while, or "failed", is a hole.
//   2. SOMETHING NEVER ARRIVED. The backstop is the bank: every month of every account needs a
//      statement, every line on it must be in the books, and the month must match to the penny.
//      (Cash and a card we never see are outside any check — said in the UI, not hidden.)
//
// Severity: "problem" (red — a hole), "attention" (amber — work in progress), and a month with
// neither is "complete" — but ONLY when something was actually checked for it (a month with no
// statement coverage is never green: no vacuous pass, O90). Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const STUCK_MINUTES = 15;
export const STATEMENT_GRACE_DAY = 15;   // last month's statement is "not in yet" until the 15th, then missing
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const ym = (d) => String(d || "").slice(0, 7);
const isYm = (p) => /^\d{4}-\d{2}$/.test(String(p || ""));
export const monthName = (p) => (isYm(p) ? `${MONTHS[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : String(p || ""));
export const nextMonth = (p) => { const [y, m] = p.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; };
export const prevMonth = (p) => { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
const monthEnd = (p) => { const [y, m] = p.split("-").map(Number); return `${p}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const nextDay = (d) => { const t = new Date(`${d}T12:00:00`); t.setDate(t.getDate() + 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const localYmd = (now) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// How much of a month the spans cover: "full" | "partial" | "none".
export function monthCoverage(spans = [], period) {
  const first = `${period}-01`, last = monthEnd(period);
  const inMonth = spans.filter(([s, e]) => s <= last && e >= first).sort((a, b) => a[0].localeCompare(b[0]));
  if (!inMonth.length) return "none";
  let reach = first;
  for (const [s, e] of inMonth) { if (s > reach) break; if (e >= reach) reach = nextDay(e); if (reach > last) return "full"; }
  return reach > last ? "full" : "partial";
}

// The same "real, verified match" rule the sign-off gate uses (controlTotals.isVerifiedReconciliation).
const verifiedRecon = (r) => r && String(r.status) === "complete" && (Math.abs(Number(r.statement_balance) || 0) > 0 || r.statement_balance_verified === true);

// The default account a new company gets and never touched (onboarding.isPlaceholderBank's rule).
const placeholderAccount = (b) => {
  const edited = (() => { const c = Date.parse(b.created_at || ""), u = Date.parse(b.updated_at || ""); return Number.isFinite(c) && Number.isFinite(u) && u - c > 1000; })();
  return !edited && String(b.name || "").trim().toLowerCase() === "primary checking" && !String(b.institution || "").trim() && !String(b.last4 || "").trim() && !Number(b.current_balance);
};

export function completenessReport({
  companies = [], intake = [], accounts = [], statements = [], openLines = [], recons = [], signoffs = [], entries = [],
  now = new Date(), monthsBack = 6, stuckMinutes = STUCK_MINUTES,
} = {}) {
  const today = localYmd(now);
  const current = ym(today);
  const lastFinished = prevMonth(current);
  const window = []; { let p = current; for (let i = 0; i < monthsBack; i++) { window.unshift(p); p = prevMonth(p); } }
  const by = (rows, key) => { const m = new Map(); for (const r of rows || []) { if (!r) continue; const k = String(r[key]); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
  const intakeBy = by(intake, "company_id"), accountsBy = by((accounts || []).filter((a) => a && a.active !== false), "company_id");
  const liveStatements = (statements || []).filter((s) => s && s.status !== "superseded" && s.period_start && s.period_end);
  const stmtBy = by(liveStatements, "company_id"), linesBy = by(openLines, "company_id"), reconBy = by(recons, "company_id");
  const stmtById = new Map(liveStatements.map((s) => [String(s.id), s]));
  // ★ C746 — a company's books may have come in without an upload (starting balances, typed in,
  // imported). Each company's earliest entry month: books exist, and when they start.
  const firstEntryBy = new Map();
  for (const e of entries || []) {
    if (!e || !isYm(ym(e.entry_date))) continue;
    const k = String(e.company_id), m = ym(e.entry_date);
    if (!firstEntryBy.has(k) || m < firstEntryBy.get(k)) firstEntryBy.set(k, m);
  }

  return (companies || []).filter(Boolean).map((co) => {
    const cid = String(co.id);
    const items = [];   // { severity, period|null, text }
    const add = (severity, period, text, kind = null) => items.push({ severity, period: period || null, text, kind });

    // ── 1. Every arrival reached a resting place ──
    const arrivals = intakeBy.get(cid) || [];
    const ageMin = (r) => (now - new Date(r.received_at || r.updated_at || now)) / 60000;
    const stuck = arrivals.filter((r) => (r.status === "received" || r.status === "processing") && ageMin(r) > stuckMinutes);
    const failed = arrivals.filter((r) => r.status === "failed");
    const held = arrivals.filter((r) => r.status === "held_for_review");
    const groupByMonth = (rows) => { const m = new Map(); for (const r of rows) { const p = ym(r.received_at) || current; if (!m.has(p)) m.set(p, []); m.get(p).push(r); } return m; };
    for (const [p, rows] of groupByMonth(stuck)) add("problem", p, `${plural(rows.length, "upload", "uploads")} from ${monthName(p)} arrived and never reached the books or a question (${rows.slice(0, 3).map((r) => r.filename || "unnamed file").join(", ")}${rows.length > 3 ? "…" : ""}).`, "stuck");
    for (const [p, rows] of groupByMonth(failed)) add("problem", p, `${plural(rows.length, "upload", "uploads")} from ${monthName(p)} failed (${rows.slice(0, 3).map((r) => `${r.filename || "unnamed file"}${r.detail ? `: ${String(r.detail).slice(0, 80)}` : ""}`).join("; ")}${rows.length > 3 ? "…" : ""}).`, "failed");
    for (const [p, rows] of groupByMonth(held)) add("attention", p, `${plural(rows.length, "document", "documents")} from ${monthName(p)} waiting on an answer.`, "held");

    // ── 2. The bank backstop ──
    const stmts = stmtBy.get(cid) || [];
    const accts = (accountsBy.get(cid) || []).filter((a) => !placeholderAccount(a) || stmts.some((s) => String(s.bank_account_id) === String(a.id)));
    const firstEntry = firstEntryBy.get(cid) || null;
    const hasBooks = arrivals.length > 0 || !!firstEntry;
    const companyStart = isYm(ym(co.cutoff_date)) ? ym(co.cutoff_date) : [...arrivals.map((r) => ym(r.received_at)), ...stmts.map((s) => ym(s.period_start)), firstEntry].filter(isYm).sort()[0] || null;
    const checkedMonths = new Set();   // months where at least one account's statement fully covered the month
    if (!stmts.length) {
      if (hasBooks) add("problem", null, "No bank statement yet — nothing checks these books against the bank.", "no_statements");
    } else {
      const firstStmtMonth = stmts.map((s) => ym(s.period_start)).sort()[0];
      if (companyStart && companyStart < firstStmtMonth) {
        add("problem", companyStart, `The books start in ${monthName(companyStart)} but the first bank statement is from ${monthName(firstStmtMonth)} — ${companyStart === prevMonth(firstStmtMonth) ? monthName(companyStart) : `${monthName(companyStart)} to ${monthName(prevMonth(firstStmtMonth))}`} haven't been checked against the bank.`, "pre_statement");
      }
      const lineMonth = (l) => ym(l.line_date) || ym(stmtById.get(String(l.statement_id))?.period_end);
      for (const a of accts) {
        const mine = stmts.filter((s) => String(s.bank_account_id) === String(a.id));
        if (!mine.length) { add("attention", null, `${a.name || "An account"} has no statements yet — its spending isn't checked against the bank.`, "account_no_statements"); continue; }
        const spans = mine.map((s) => [String(s.period_start).slice(0, 10), String(s.period_end).slice(0, 10)]);
        const reconSpans = (reconBy.get(cid) || []).filter((r) => verifiedRecon(r) && String(r.account_id) === String(a.id)).map((r) => [String(r.period_start || "0000-01-01").slice(0, 10), String(r.period_end || "9999-12-31").slice(0, 10)]);
        const myLines = (linesBy.get(cid) || []).filter((l) => mine.some((s) => String(s.id) === String(l.statement_id)));
        const start = mine.map((s) => ym(s.period_start)).sort()[0];
        for (let p = start; p <= lastFinished; p = nextMonth(p)) {
          const cov = monthCoverage(spans, p);
          if (cov === "none" || cov === "partial") {
            const late = p === lastFinished && Number(today.slice(8, 10)) < STATEMENT_GRACE_DAY;
            add(late ? "attention" : "problem", p, cov === "partial"
              ? `${a.name || "An account"}'s statements cover only part of ${monthName(p)}.`
              : late ? `${a.name || "An account"}'s ${monthName(p)} statement isn't in yet.` : `No ${a.name || "account"} statement for ${monthName(p)}.`, cov === "partial" ? "partial_statement" : late ? "statement_late" : "no_statement");
            continue;
          }
          checkedMonths.add(p);
          const open = myLines.filter((l) => lineMonth(l) === p);
          if (open.length) { add("attention", p, `${plural(open.length, "line", "lines")} on the ${a.name || "account"} statement for ${monthName(p)} ${open.length === 1 ? "isn't" : "aren't"} in the books yet.`, "open_lines"); continue; }
          if (monthCoverage(reconSpans, p) !== "full") add("attention", p, `${a.name || "An account"} for ${monthName(p)} hasn't been matched to the penny yet.`, "not_matched");
        }
      }
    }

    // ── per month, and overall ──
    const lockedSet = new Set((signoffs || []).filter((x) => x && String(x.company_id) === cid && !x.revoked_at).map((x) => String(x.period)));
    const months = window.map((p) => {
      const mine = items.filter((it) => it.period === p);
      const sev = mine.some((i) => i.severity === "problem") ? "problem" : mine.some((i) => i.severity === "attention") ? "attention" : null;
      let status;
      if (companyStart && p < companyStart && !mine.length) status = "before";
      else if (sev) status = sev;
      else if (p === current) status = "in_progress";
      else status = checkedMonths.has(p) ? "complete" : "unchecked";   // never green on nothing checked
      return { period: p, status, locked: lockedSet.has(p), items: mine };
    });
    const status = items.some((i) => i.severity === "problem") ? "problem"
      : items.some((i) => i.severity === "attention") ? "attention"
      : (!hasBooks && !stmts.length) ? "empty" : "complete";
    items.sort((a, b) => (a.severity === b.severity ? String(b.period || "").localeCompare(String(a.period || "")) : a.severity === "problem" ? -1 : 1));
    return { companyId: cid, name: co.name || "Unnamed company", status, arrived: arrivals.length, items, months };
  }).sort((a, b) => ({ problem: 0, attention: 1, complete: 2, empty: 3 }[a.status] - { problem: 0, attention: 1, complete: 2, empty: 3 }[b.status]) || a.name.localeCompare(b.name));
}

export function completenessSummary(report = []) {
  const n = (s) => report.filter((r) => r.status === s).length;
  return { total: report.length, problem: n("problem"), attention: n("attention"), complete: n("complete"), empty: n("empty") };
}

// ★ C740 — A MONTH, IN THE OWNER'S WORDS. The owner never sees the operator's list ("2 uploads arrived
// and never reached the books…"); they see one line per month: done, waiting on them (only for what
// they can actually do — drop a statement), or our team finishing it. Reads the same report, so the
// owner's ✓ and the operator's ✓ cannot disagree. Pure.
const YOU_CAN_FIX = new Set(["no_statement", "partial_statement", "statement_late", "no_statements", "pre_statement"]);
export function ownerMonthLine(month = {}) {
  const items = month.items || [];
  const label = monthName(month.period);
  if (month.locked && month.status !== "problem") return { tone: "closed", text: `${label} — closed. Every upload is in and it matches your bank.` };
  if (month.status === "complete") return { tone: "done", text: `${label} — complete. Every upload is in and it matches your bank.` };
  if (month.status === "before") return null;
  const youFix = items.find((i) => YOU_CAN_FIX.has(i.kind));
  if (youFix) {
    const acct = /^No (.+?) statement for /.exec(youFix.text)?.[1] || /^(.+?)'s /.exec(youFix.text)?.[1] || "bank";
    return { tone: "you", text: youFix.kind === "statement_late"
      ? `${label} — waiting for your ${acct} statement. Drop it on Home when it arrives.`
      : youFix.kind === "partial_statement" ? `${label} — your ${acct} statement only covers part of the month. Drop the rest on Home.`
      : youFix.kind === "pre_statement" ? `${label} — not checked against your bank yet. Drop that month's bank statement on Home.`
      : `${label} — waiting for your ${acct} statement. Drop it on Home.` };
  }
  if (month.status === "in_progress") return { tone: "progress", text: `${label} — in progress.` };
  if (month.status === "unchecked") return { tone: "you", text: `${label} — not checked against your bank yet. Drop that month's bank statement on Home.` };
  return { tone: "team", text: `${label} — our team is finishing this month.` };
}

// ★ C749 — RUNS OF MONTHS SAY IT ONCE. Seen live: five lines in a row, "June 2026 — not checked against
// your bank yet. Drop that month's bank statement on Home." through October. Adjacent months that say
// the same thing become one line ("June – October 2026 — not checked … those months' bank statements").
// `months` in display order (newest first); the range always reads oldest – newest.
const PLURAL = [
  [/that month's bank statement/g, "those months' bank statements"],
  [/Drop it on Home/g, "Drop them on Home"],
  [/(your .+?) statement\./g, "$1 statements."],
  [/finishing this month/g, "finishing these months"],
];
export function ownerMonthLines(months = []) {
  const lines = [];
  for (const m of months || []) {
    const l = ownerMonthLine(m);
    if (!l) continue;
    const label = monthName(m.period);
    const rest = l.text.startsWith(label) ? l.text.slice(label.length) : null;
    const prev = lines[lines.length - 1];
    if (prev && rest != null && prev.tone === l.tone && prev.rest === rest && prev.oldest === nextMonth(m.period)) {
      prev.oldest = m.period; prev.count += 1;
    } else {
      lines.push({ tone: l.tone, rest, text: l.text, newest: m.period, oldest: m.period, count: 1 });
    }
  }
  return lines.map((g) => {
    if (g.count === 1 || g.rest == null) return { tone: g.tone, text: g.text };
    const [oy, ny] = [g.oldest.slice(0, 4), g.newest.slice(0, 4)];
    const range = oy === ny ? `${monthName(g.oldest).replace(/ \d{4}$/, "")} – ${monthName(g.newest)}` : `${monthName(g.oldest)} – ${monthName(g.newest)}`;
    let rest = g.rest;
    for (const [re, to] of PLURAL) rest = rest.replace(re, to);
    return { tone: g.tone, text: `${range}${rest}` };
  });
}
