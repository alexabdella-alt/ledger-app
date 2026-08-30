import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { canAttestPeriod } from "../src/lib/signoff.js";

// ═════════════════════════════════════════════════════════════════════════════
// TIER 1 #8 — TEAM INVITES, AND THE ROLE NAMES.
//
// ★★ THE INVITE FLOW WAS BUILT AND COULD NOT COMPLETE. `company_users_role_check` allows
// exactly `owner | admin | accountant | viewer`. The invite form offered **"Member"**, and
// it was the DEFAULT option — so `accept_invite` inserted a role the check rejects and the
// person could not join at all. Everything else (the table, the token, the signup banner,
// the acceptance RPC) already worked.
//
// ★ AND THE SAME MISMATCH DISABLED THE READ-ONLY ROLE. `isMember = userRole === "member"`
// was permanently FALSE, so every protection built on it — the delete/void controls, the
// AI's mutating actions, the settings sub-tabs — **never once applied.** The database still
// refused a viewer's writes (RLS role gates, C199), so nothing was corrupted; what a viewer
// saw was a screen of buttons that would fail.
//
// THE GUARD BELOW READS THE ALLOWED SET OUT OF THE SCHEMA rather than restating it, so the
// UI and the database cannot drift apart again silently.
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const schema = fs.readFileSync(path.join(ROOT, "supabase/migrations/000_baseline_schema.sql"), "utf8");
const team = fs.readFileSync(path.join(ROOT, "src/components/views/TeamView.jsx"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");

// The single source of truth: the CHECK constraint itself.
const ALLOWED = (() => {
  const m = schema.match(/company_users_role_check CHECK \(\(role = ANY \(ARRAY\[([^\]]+)\]\)\)\)/);
  if (!m) throw new Error("could not read company_users_role_check from the baseline schema");
  return m[1].split(",").map((s) => s.trim().replace(/'([^']+)'::text/, "$1"));
})();

describe("★★ the roles the UI offers are roles the database accepts", () => {
  it("reads the allowed set from the schema, not from a copy of it", () => {
    expect(ALLOWED).toEqual(["owner", "admin", "accountant", "viewer"]);
  });

  it("★★ EVERY invitable role is in that set — 'member' was not, and it was the default", () => {
    const offered = [...team.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(offered.length).toBeGreaterThan(0);
    for (const r of offered) {
      expect(ALLOWED, `TeamView offers "${r}", which company_users_role_check rejects`).toContain(r);
    }
  });

  it("★ owner is NOT invitable — a company has one, created with it", () => {
    const offered = [...team.matchAll(/<option value="([^"]+)"/g)].map((m) => m[1]);
    expect(offered).not.toContain("owner");
  });

  it("★ the default is the least-privileged role", () => {
    expect(team).toMatch(/useState\("viewer"\)/);
  });

  it("each option says what the role can DO, in plain language", () => {
    // A dropdown of bare role names asks the inviter to already know what "accountant"
    // means in this product. It is the difference between a permission and a promise.
    for (const m of team.matchAll(/<option value="[^"]+">([^<]+)<\/option>/g)) {
      expect(m[1], `"${m[1]}" has no description`).toMatch(/—/);
    }
  });
});

describe("★★ the read-only role is actually read-only", () => {
  it("`isViewer` reads the role that exists", () => {
    // Comments stripped first: the source QUOTES the old expression to explain why it was
    // wrong, and a guard that matches its own explanation is the C202 false positive —
    // which this one duly was, on its first run. Sixth time in this repo.
    const code = app.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).toMatch(/const isViewer = userRole === "viewer"/);
    expect(code).not.toMatch(/userRole === "member"/);
  });

  it("★ the transaction panel hides its destructive controls from a viewer", () => {
    const panel = fs.readFileSync(path.join(ROOT, "src/components/TransactionDetailPanel.jsx"), "utf8");
    const code = panel.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    expect(code).toMatch(/isViewer/);
    expect(code).not.toMatch(/isMember/);
  });

  it("`isMember` survives as an alias so existing callers keep working", () => {
    expect(app).toMatch(/const isMember = isViewer/);
  });
});

describe("★ a viewer cannot sign off, and an accountant can", () => {
  it("matches the roles the invite form now offers", () => {
    expect(canAttestPeriod("viewer")).toBe(false);
    expect(canAttestPeriod("accountant")).toBe(true);
    expect(canAttestPeriod("admin")).toBe(true);
    // ★ The separation-of-duties boundary the whole reviewer seat is built on: the person
    // whose books they are does not attest to them alone.
    expect(canAttestPeriod("member")).toBe(false);   // and a role that cannot exist never could
  });
});
