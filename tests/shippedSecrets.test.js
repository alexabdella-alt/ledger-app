import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// TIER 1 #11b — NO SECRET KEY SHIPS TO THE BROWSER, AND DOCUMENT LINKS EXPIRE.
//
// ★★ THIS IS A TEST BECAUSE THE ITEM SAID "search the BUILT APP, not just the source",
// and a search is the memory of an afternoon. The security ladder's own `s4` rung records
// exactly this lesson about the cross-tenant probe: **a probe nobody re-runs and a wall
// that quietly fell look identical from the outside.** So the check runs on every suite.
//
// Verified by hand 2026-08-29 before this was written: the built bundle contains exactly
// ONE JWT, whose decoded payload is `{"iss":"supabase","role":"anon",…}` — public by
// design, because RLS is the boundary (§3). What must never appear is `service_role`.
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const readAll = (dir, ext) => {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith(ext)) out.push(p);
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
};

const decodeJwtPayload = (token) => {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  } catch { return null; }
};

describe("★★ no service-role key reaches the browser", () => {
  const distDir = path.join(ROOT, "dist", "assets");
  const bundles = readAll(distDir, ".js");

  it("the bundle exists to be checked (build first, or this proves nothing)", () => {
    // ★ A check that silently passes on a missing input is the C195(7) trap — a guard whose
    // input is always empty is indistinguishable from a clean result. Say so out loud.
    expect(bundles.length, "run `npm run build` before the suite for this check to mean anything").toBeGreaterThan(0);
  });

  it("★★ every JWT in the built bundle is the ANON key — never service_role", () => {
    // ★ DECODED, NOT GREPPED. A JWT's payload is base64, so `grep service_role` over the
    // bundle would miss a service-role key entirely — it would be sitting there encoded.
    // The role has to be read out of the token.
    const found = [];
    for (const f of bundles) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) {
        const payload = decodeJwtPayload(m[0]);
        if (payload) found.push(payload);
      }
    }
    expect(found.length).toBeGreaterThan(0);                     // the anon key IS expected
    for (const p of found) {
      expect(p.role, `a ${p.role} key is in the shipped bundle`).toBe("anon");
    }
  });

  it("no other secret-shaped literal ships", () => {
    for (const f of bundles) {
      const src = fs.readFileSync(f, "utf8");
      for (const pat of [/service_role/, /sk-ant-[A-Za-z0-9]/, /SUPABASE_SERVICE_ROLE/]) {
        expect(pat.test(src), `${pat} found in ${path.basename(f)}`).toBe(false);
      }
    }
  });
});

describe("★★ document links expire", () => {
  const sources = [...readAll(path.join(ROOT, "src"), ".js"), ...readAll(path.join(ROOT, "src"), ".jsx")];

  it("★ nothing calls getPublicUrl — a permanent URL on a private bucket is a public bucket", () => {
    // The `documents` bucket holds bank statements and receipts. A permanent link to one
    // is the bucket's privacy undone by a single call, and it would not show up as a
    // policy failure anywhere.
    for (const f of sources) {
      const src = fs.readFileSync(f, "utf8");
      expect(src.includes("getPublicUrl"), `${path.relative(ROOT, f)} builds a permanent document URL`).toBe(false);
    }
  });

  it("★ every signed URL is given an explicit expiry", () => {
    // `createSignedUrl(path)` with no second argument is a link whose lifetime is somebody
    // else's default. Ours is one hour, stated at each call site.
    let sites = 0;
    for (const f of sources) {
      const src = fs.readFileSync(f, "utf8");
      for (const m of src.matchAll(/createSignedUrl\(([^)]*)\)/g)) {
        sites++;
        const args = m[1].split(",").map((a) => a.trim()).filter(Boolean);
        expect(args.length, `createSignedUrl in ${path.relative(ROOT, f)} has no expiry`).toBeGreaterThanOrEqual(2);
        expect(Number(args[1]), `expiry in ${path.relative(ROOT, f)} is not a number of seconds`).toBeGreaterThan(0);
        expect(Number(args[1]), `expiry in ${path.relative(ROOT, f)} is longer than a day`).toBeLessThanOrEqual(86400);
      }
    }
    // Positive assertion: the mechanism has to actually be in use, or this passes on a
    // codebase that serves documents some other way entirely.
    expect(sites, "no signed-URL call sites found — has document serving moved?").toBeGreaterThan(0);
  });
});
