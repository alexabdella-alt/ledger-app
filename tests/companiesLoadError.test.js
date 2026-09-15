import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C420 — A FAILED MEMBERSHIP READ OPENED "CREATE YOUR COMPANY".
// `loadCompanies` dropped `error`; `[]` from a failed read and `[]` from a new signup are
// the same value, and the second opens setup — so a returning owner on a bad connection was
// one click from creating a second company. The root now records the failure and renders
// a retry screen; setup opens only on a read that RAN and found nothing.
// ═════════════════════════════════════════════════════════════════════════════
const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const body = src.slice(src.indexOf("const loadCompanies = async (sess) => {"), src.indexOf("const handleSignOut = async () => {"));

describe("C420", () => {
  it("the read's error is consulted before the empty list is interpreted", () => {
    expect(body).toMatch(/const \{ data, error \} = await supabase\s*\.from\("company_users"\)/);
    const err = body.indexOf("if (error) {");
    const setup = body.indexOf("setShowCompanySetup(true)");
    expect(err).toBeGreaterThan(-1);
    expect(err).toBeLessThan(setup);
    expect(body.slice(err, err + 250)).toMatch(/setCompaniesLoadError\([^)]*\);\s*return;/);
  });
  it("the retry screen precedes setup in the router, offers Try again, and says it is not proof of no company", () => {
    const i = src.indexOf("if (companiesLoadError) {");
    expect(i).toBeGreaterThan(-1);
    expect(i).toBeLessThan(src.indexOf("if (showCompanySetup) {"));
    const blk = src.slice(i, i + 1200);
    expect(blk).toMatch(/data-companies-load-failed/);
    expect(blk).toMatch(/isn't a sign that you don't have one/);
    expect(blk).toMatch(/onClick=\{\(\)=>loadCompanies\(session\)\}/);
    expect(containsOwnerJargon("We couldn't load your companies just now — this isn't a sign that you don't have one. Check your connection and try again.")).toBe(false);
  });
  it("the post-invite re-read records its failure too, instead of a blank page", () => {
    const i = src.indexOf('rpc("accept_invite"');
    const blk = src.slice(i, i + 900);
    expect(blk).toMatch(/const \{ data, error: le \} = await supabase\.from\("company_users"\)/);
    expect(blk).toMatch(/if \(le\) \{[^\n]*setCompaniesLoadError\([^\n]*return; \}/);
  });
  it("a retry clears the recorded failure first", () => {
    expect(body).toMatch(/setAppLoading\(true\);\s*setCompaniesLoadError\(null\);/);
  });
});
