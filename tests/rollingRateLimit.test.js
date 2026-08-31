import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync("supabase/migrations/086_rolling_rate_limit_window.sql", "utf8");
// ★★ TWO VIEWS OF THE SAME TEXT, AND THE DISTINCTION IS THE POINT. A "must NOT contain"
// assertion needs comments stripped — the header explains the OLD `date_trunc('hour', …)`
// behaviour, and a guard that matches its own explanation is the eighth comment false
// positive in this repo. But LOCATING a section legitimately uses the comments that label it.
const raw = sql.slice(0, sql.indexOf("-- VERIFY"));
const body = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const proxy = readFileSync("supabase/functions/ai-proxy/index.ts", "utf8");

describe("★★★ O113c — the window is rolling, and the reset time is real", () => {
  it("★★ counts a trailing hour, with no clock-hour truncation left", () => {
    // The whole defect: `date_trunc('hour', now())` made the penalty 55 minutes at :05 and
    // five at :55 — the same mistake at eleven times the cost, for no visible reason.
    expect(body).toMatch(/at > now\(\) - v_window/);
    expect(body).not.toMatch(/date_trunc\('hour'/);
  });

  it("★★★ it returns when capacity ACTUALLY returns — the oldest call ageing out", () => {
    expect(body).toMatch(/offset greatest\(0, v_bcount - v_blimit\)/);
    expect(body).toMatch(/resets_in_minutes/);
  });

  it("★★★ decide-then-charge is preserved — a refusal must never consume budget (O113a)", () => {
    // ai = 81 against a ceiling of 60 is that bug visible in production data, and it made
    // retrying actively harmful. The decision pass must contain no INSERT.
    const decide = raw.slice(raw.indexOf("PASS 1 — DECIDE"), raw.indexOf("PASS 2 — ALLOWED"));
    expect(decide.length).toBeGreaterThan(200);
    expect(decide).not.toMatch(/insert into public\.rate_limit_events/);
    expect(raw).toMatch(/NOTHING was charged/);   // the comment that states the guarantee
  });

  it("★★ all-or-nothing across buckets is preserved — the charge pass is one loop after the decision", () => {
    const charge = raw.slice(raw.indexOf("PASS 2 — ALLOWED"));
    expect((charge.match(/insert into public\.rate_limit_events/g) || []).length).toBe(1);
  });

  it("★★ concurrent calls for one user serialise — two cannot both see 59 and both pass", () => {
    // The counter version held `for update` on a row; with events there is no row to lock.
    expect(body).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_user::text, 0\)\)/);
  });

  it("★★ the table is service-role only — RLS on with NO policies", () => {
    // A user who could insert here could hand themselves unlimited budget.
    expect(body).toMatch(/alter table public\.rate_limit_events enable row level security/);
    expect(body).not.toMatch(/create policy[\s\S]*rate_limit_events/);
    expect(body).toMatch(/grant execute on function public\.consume_rate_limit[\s\S]{0,80}to service_role/);
    for (const role of ["anon", "authenticated"]) {
      expect(body).toMatch(new RegExp(`revoke all on function public\\.consume_rate_limit[^;]*from ${role}`));
    }
  });

  it("★ old rows are cleaned up, so the table cannot grow without limit", () => {
    expect(body).toMatch(/delete from public\.rate_limit_events\s+where user_id = p_user and at <= now\(\) - v_window/);
  });

  it("★★ the old counter table and function are KEPT — a rollback must not hit a missing table", () => {
    expect(body).not.toMatch(/drop table[\s\S]*rate_limit\b/);
    expect(body).not.toMatch(/drop function[\s\S]*bump_rate_limit/);
  });
});

describe("★★ the deploy order is not load-bearing this time", () => {
  it("★★★ the proxy falls back to clock-hour maths when the migration is not applied", () => {
    // 074 had to be applied BEFORE its deploy, because the reverse called a function that did
    // not exist and failed every AI request. This one is safe in either order.
    expect(proxy).toMatch(/const rolling = Number\(gate\.resets_in_minutes\);/);
    expect(proxy).toMatch(/: 60 - new Date\(\)\.getUTCMinutes\(\);/);
  });

  it("★ and it prefers the real number when it is there", () => {
    expect(proxy).toMatch(/Number\.isFinite\(rolling\) && rolling >= 0\s*\n?\s*\? rolling/);
  });
});

describe("★★ the verification watches the limiter refuse, and refuse WITHOUT charging", () => {
  it("★ every check computes its verdict in SQL and rolls back", () => {
    const verify = sql.slice(sql.indexOf("-- VERIFY"));
    for (const k of ["VERIFY (a)", "VERIFY (b)", "VERIFY (c)", "VERIFY (d)", "VERIFY (e)"]) {
      expect(verify).toContain(k);
    }
    expect(verify).toMatch(/PASS - refused at the limit, and the refusal was NOT charged/);
    expect(verify).toMatch(/PASS - capacity returns in/);
    expect(verify).toMatch(/PASS - refused by upload, and NO ai charge was left behind/);
  });
});
