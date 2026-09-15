import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// C445 — the privacy page names the processors that actually process, and no others.
// It listed Stripe (not integrated) and omitted Sentry (receives the account email),
// Vercel (hosting) and Google (the supplier-logo request).
describe("C445", () => {
  const legal = fs.readFileSync("src/components/LegalView.jsx", "utf8");
  it("names Supabase, Anthropic, Vercel, Sentry and Google, and does not claim a payment processor", () => {
    for (const p of ["Supabase", "Anthropic", "Vercel", "Sentry", "Google"]) expect(legal).toMatch(new RegExp(`<strong>${p}</strong>`));
    expect(legal).not.toMatch(/<strong>Stripe<\/strong>/);
    expect(legal).toMatch(/there are no paid plans yet/);
  });
  it("what it says about Sentry matches what the code sends", () => {
    const sentry = fs.readFileSync("src/lib/sentry.js", "utf8");
    expect(sentry).toMatch(/Sentry\.setUser\(user \? \{ id: user\.id, email: user\.email \} : null\)/);
    expect(sentry).toMatch(/sendDefaultPii: false/);
    expect(legal).toMatch(/receives the signed-in account's email address/);
  });
  it("what it says about Google matches the logo fetch", () => {
    expect(fs.readFileSync("src/lib/vendorLogo.js", "utf8")).toMatch(/google\.com\/s2\/favicons/);
    expect(legal).toMatch(/asks Google for the logo of a supplier's public website/);
  });
});

// C446 — the retention paragraph promises no purge the code does not perform.
describe("C446", () => {
  it("no 'permanent removal' claim while nothing in the codebase purges", () => {
    const legal = fs.readFileSync("src/components/LegalView.jsx", "utf8");
    const path = require("node:path");
    const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d).flatMap((f) => { const p = path.join(d, f); return fs.statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
    const purges = [...walk("src"), ...walk("supabase/functions")].filter((f) => /\.(jsx?|ts|sql)$/.test(f)).filter((f) => /\bpurge(Soft)?Deleted\b|hard_delete|permanently_delete/.test(fs.readFileSync(f, "utf8")));
    if (purges.length === 0) expect(legal).not.toMatch(/before permanent removal|permanently removed after|purged after/);
    expect(legal).toMatch(/We do not currently purge soft-deleted entries automatically/);
  });
});
