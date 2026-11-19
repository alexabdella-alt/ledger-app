import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { intakeAlertKind } from "../src/lib/documentIntake";

// ═════════════════════════════════════════════════════════════════════════════
// C743 — THE DATABASE CHECKS FOR LOST UPLOADS EVERY 15 MINUTES (migration 101). Behaviour was
// tested against a real Postgres 16 with stubbed pg_net/pg_cron (alert once per upload and kind;
// re-send what Sentry refused or never answered; app roles refused). What a vitest CAN guard is
// the agreement with the browser's alert (C742): ONE Sentry alert rule covers both only while
// the message, tag, fingerprint shape and kinds stay the same in the SQL and in App.jsx.
// ═════════════════════════════════════════════════════════════════════════════
const ROOT = process.cwd();
const sql = fs.readFileSync(path.join(ROOT, "supabase/migrations/101_scheduled_intake_check.sql"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const code = sql.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

describe("C743 — the scheduled check sends the same alert the browser sends", () => {
  it("★★ same message, tag and fingerprint shape as the browser (C742)", () => {
    expect(app).toMatch(/captureMessage\("upload_not_recorded"[^\n]*fingerprint: \["upload_not_recorded", kind, String\(companyId/);
    expect(app).toMatch(/alert: "upload_not_recorded"/);
    expect(code).toMatch(/'message',\s*'upload_not_recorded'/);
    expect(code).toMatch(/jsonb_build_array\('upload_not_recorded', r\.kind, r\.company_id::text\)/);
    expect(code).toMatch(/'alert', 'upload_not_recorded'/);
  });

  it("★★ the held/failed kinds are exactly the browser's intakeAlertKind", () => {
    expect(intakeAlertKind("failed", "")).toBe("upload_failed");
    expect(intakeAlertKind("held_for_review", "Still not processed 26 hours after it arrived")).toBe("upload_stale");
    expect(intakeAlertKind("held_for_review", "We couldn't extract anything")).toBe("upload_unreadable");
    expect(code).toMatch(/d\.status = 'failed'\s+then 'upload_failed'/);
    expect(code).toMatch(/like 'Still not processed%'\s+then 'upload_stale'/);
    expect(code).toMatch(/ilike '%couldn''t extract%'\s+then 'upload_unreadable'/);
    expect(code).toMatch(/in \('received', 'processing'\)\s*\n\s*and d\.received_at < now\(\) - interval '60 minutes'\s+then 'upload_stuck'/);
  });

  it("★★ only what Sentry confirmed counts as alerted; a refusal or silence is re-sent", () => {
    expect(code).toMatch(/h\.status_code between 200 and 299/);
    expect(code).toMatch(/delete from ops\.intake_alerts a\s+where not a\.delivered\s+and a\.alerted_at < now\(\) - interval '10 minutes'/);
  });

  it("★★ ids only — no filename, detail or amount leaves for Sentry", () => {
    const body = code.slice(code.indexOf("body    :="), code.indexOf(") into v_req"));
    expect(body).toMatch(/intake_ids/);
    expect(body).not.toMatch(/filename|detail|amount|name/);
    const extra = body.slice(body.indexOf("'extra'"));
    expect([...extra.matchAll(/'([a-z_]+)',\s/g)].map((m) => m[1])).toEqual(["extra", "company_id", "uploads", "intake_ids"]);
  });

  it("★★ unreachable from the app's API, and read-only toward business data", () => {
    expect(code).toMatch(/revoke all on schema ops from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on function ops\.check_intake_holes\(boolean\) from public, anon, authenticated/);
    expect(code).not.toMatch(/update public\.|delete from public\.|insert into public\./);
  });

  it("★ scheduled every 15 minutes under one name (re-applying replaces, never duplicates)", () => {
    expect(code).toMatch(/cron\.schedule\('shadow-intake-check', '\*\/15 \* \* \* \*'/);
  });

  it("★ the verify companion lives in supabase/verify, never beside the migrations", () => {
    expect(fs.existsSync(path.join(ROOT, "supabase/verify/101_scheduled_intake_check.sql"))).toBe(true);
    expect(fs.readdirSync(path.join(ROOT, "supabase/migrations")).filter((f) => f.startsWith("101_"))).toEqual(["101_scheduled_intake_check.sql"]);
  });
});
