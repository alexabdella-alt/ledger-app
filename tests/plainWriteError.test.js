import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { plainWriteError } from "../src/lib/plainWriteError.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C415 — A FAILED WRITE'S REASON IS SAID IN WORDS A PERSON CAN ACT ON, NEVER AS THE
// DATABASE'S OWN SENTENCE. Twenty-four toasts ended with `${r?.error}`.
// ═════════════════════════════════════════════════════════════════════════════
describe("plainWriteError", () => {
  it("maps the messages a checked write actually returns to the one thing the person can do", () => {
    expect(plainWriteError('new row violates row-level security policy for table "contacts"')).toMatch(/don't have permission/);
    expect(plainWriteError('duplicate key value violates unique constraint "contacts_company_id_name_key"')).toBe("There's already one with that name.");
    expect(plainWriteError("update matched 0 rows")).toMatch(/couldn't find that record any more/);
    expect(plainWriteError("TypeError: Failed to fetch")).toMatch(/connection dropped/);
    expect(plainWriteError("JWT expired")).toMatch(/sign-in has expired/);
    expect(plainWriteError('column "created_at" does not exist')).toMatch(/Something on our side needs fixing/);
  });
  it("★ the signed-month trigger's sentence is already the owner's and passes through", () => {
    const t = "January 2026 has been signed off by your accountant, so its figures cannot be changed. Reopen that month first if a correction is genuinely needed.";
    expect(plainWriteError(t)).toBe(t);
  });
  it("★★ an unrecognised, code-shaped message is OMITTED, not quoted", () => {
    expect(plainWriteError('PGRST116: JSON object requested, multiple (or no) rows returned {"code":"PGRST116"}')).toBe("");
    expect(plainWriteError("PGRST116: something", "Please try again.")).toBe("Please try again.");
    // …while a plain sentence a caller wrote for a person passes through
    expect(plainWriteError("The register doesn't foot")).toBe("The register doesn't foot");
  });
  it("every mapped sentence passes the owner bar", () => {
    for (const raw of ["row-level security", "duplicate key", "0 rows", "network", "JWT", "violates check constraint", 'column "x" does not exist']) {
      const t = plainWriteError(raw);
      expect(containsOwnerJargon(t), t).toBe(false);
    }
  });
});

describe("★ no toast quotes a write's raw error any more", () => {
  const walk = (d) => fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : /\.jsx?$/.test(f) ? [p] : []; });
  it("the cost-spread rollback toast routes its raw `reason` too (C448)", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/nothing is in your books\.\$\{plainWriteError\(reason\)/);
    expect(app).not.toMatch(/\$\{reason \? ` \(\$\{reason\}\)` : ""\}/);
  });
  it("every `${r.error}` / `${res.error}` inside a showNotification goes through plainWriteError (Admin excepted: platform-admin only)", () => {
    const bad = []; let seen = 0;
    for (const f of walk("src")) {
      if (f.endsWith("AdminView.jsx")) continue;
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/showNotification\([^;]{0,400}/g)) {
        for (const e of m[0].matchAll(/\$\{[^}]*\b(?:r|res)\??\.error[^}]*\}/g)) { seen++; if (!/plainWriteError\(/.test(e[0])) bad.push(`${f}: ${e[0]}`); }
      }
    }
    expect(seen).toBeGreaterThan(20);   // anti-vacuity: the tails are still there, routed
    expect(bad).toEqual([]);
  });
});

// C480 — the census above keyed on `r.error`/`res.error`; eight toasts appended a bare
// `error.message` / `rpcErr.message` / `e.message` off a Supabase call or a catch — the
// booking path's own "Couldn't save the entry: <postgres sentence>" among them. Any
// `.message` reaching a toast goes through the map (or is dropped, for a parser error the
// person cannot act on); Admin excepted (platform-admin only).
describe("★ no toast quotes a bare `.message` either (C480)", () => {
  const fs = require("node:fs");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`]);
  it("every showNotification that mentions a `.message` routes it through plainWriteError", () => {
    const offenders = [];
    for (const f of walk("src").filter((f) => /\.(js|jsx)$/.test(f) && !f.endsWith("AdminView.jsx"))) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/showNotification\s*\(([^;]*?)\)\s*;/g)) {
        const arg = m[1];
        // Only ERROR objects: a planner's `plan.message` / `check.message` is our own sentence.
        if (/\b(error|err|rpcErr|e)\??\.message\b/.test(arg) && !/plainWriteError\(/.test(arg)) offenders.push(`${f}: ${arg.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
    // Anti-vacuity: the routed sites exist.
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect((app.match(/plainWriteError\((rpcErr|error)\.message, "Please try again\."\)/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});
