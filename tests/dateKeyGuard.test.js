import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ymdLocal, todayLocal } from "../src/lib/format.js";

// ════════════════════════════════════════════════════════════════════════════
// DATE-KEY GUARD (O86/CR-5) — keeps the toISOString/UTC period-bug class CLOSED.
//
// The bug class: a date KEY that determines a PERIOD or bucket (a month "YYYY-MM",
// a day "YYYY-MM-DD" used for filtering/grouping/comparison/booking) derived from
// `x.toISOString().slice(...)` is UTC — for a non-UTC user it day-shifts near
// midnight and, on a month boundary, lands in the WRONG PERIOD. The fix is the
// local-date helpers (todayLocal / ymdLocal / addMonthsClampedYMD).
//
// This is the same audit-plus-guard fence used for the flag-lies and money-format
// classes: after the one-time audit + fix, a SOURCE SCAN makes a NEW offender fail
// CI. It flags `toISOString().slice(...)` / `.split(...)` / `.substring(...)` (the
// date-KEY producers) anywhere in src/ outside a small, documented allowlist. A bare
// `toISOString()` (a full TIMESTAMP — created_at, generated_at, audit logs) is left
// alone: those are genuinely UTC-appropriate and are NOT matched.
// ════════════════════════════════════════════════════════════════════════════

// ── ALLOWLIST: genuinely-correct sliced uses, each with a reason. Keyed by file →
// substring(s) that must appear on the offending line for it to be excused. ──
const ALLOW = {
  // normDate() normalizes an ARBITRARY externally-supplied date string (bank/QBO import).
  // It only reaches the toISOString fallback after the explicit MDY/YMD parses fail; a
  // date-only input is UTC-anchored so the round-trip is stable. Not a "today"/period key.
  "src/components/views/ReconView.jsx": ["const normDate"],
};

// The edge function (supabase/functions/ai-proxy/aiProfiles.js) also reads UTC in
// applyTrustedSubs, but CORRECTLY: `now` there is the client's local date anchored at
// UTC-noon (resolveNow), so UTC reads reproduce the local day. It's out of this scan's
// scope (src/ only, matching the sibling guards) and documented at the call site.

const KEY_PATTERN = /\.toISOString\(\)\s*\.\s*(?:slice|split|substring|substr)\s*\(/;

function srcFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) srcFiles(p, out);
    else if (/\.(jsx?|mjs)$/.test(e.name) && !p.includes(".backup")) out.push(p);
  }
  return out;
}

function offendersIn(file) {
  const rel = file.split(path.sep).join("/");
  const allowed = ALLOW[rel] || [];
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    if (!KEY_PATTERN.test(line)) return;
    if (allowed.some((marker) => line.includes(marker))) return;   // excused, with a documented reason
    hits.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
  });
  return hits;
}

describe("date-key guard — no UTC period/bucket keys in src/ (O86/CR-5 stays closed)", () => {
  const files = srcFiles("src");

  it("finds source files to scan", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no period-determining toISOString().slice()/.split() outside the allowlist", () => {
    const offenders = files.flatMap(offendersIn);
    expect(
      offenders,
      offenders.length
        ? `\nUTC date-key(s) that determine a period/bucket found — use todayLocal()/ymdLocal()/addMonthsClampedYMD() instead, or (if genuinely a timestamp/normalizer) add to ALLOW with a reason:\n  ${offenders.join("\n  ")}\n`
        : "",
    ).toEqual([]);
  });

  it("the allowlist stays tiny and every entry still exists (no stale excuses)", () => {
    expect(Object.keys(ALLOW).length).toBeLessThanOrEqual(3);
    for (const [rel, markers] of Object.entries(ALLOW)) {
      const src = fs.readFileSync(rel, "utf8");
      for (const m of markers) expect(src, `stale allowlist entry: ${rel} no longer contains "${m}"`).toContain(m);
    }
  });
});

// ── Behavioral lock: the helpers the fix moved TO actually keep the period local. ──
describe("date-key guard — local helpers keep the period on the user's calendar day", () => {
  it("ymdLocal reads LOCAL components (a UTC-next-month Date stays in the local month)", () => {
    // Construct a Date whose LOCAL day differs from its UTC day by picking a real instant:
    // 2026-05-31 20:00 in UTC-6 == 2026-06-01 02:00 UTC. We emulate via a fake Date-like.
    const localMayEve = { getFullYear: () => 2026, getMonth: () => 4, getDate: () => 31 };
    expect(ymdLocal(localMayEve)).toBe("2026-05-31");            // local month key, not UTC June
    expect(ymdLocal(localMayEve).slice(0, 7)).toBe("2026-05");   // the month BUCKET is local (CR-5)
  });

  it("todayLocal returns a YYYY-MM-DD shape", () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
