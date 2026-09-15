import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C419 — COMPANY SETUP CHECKED ITS FIRST STEP AND FIRED THE OTHER THREE.
// `seed_company_accounts`, the bank account and the subscription were awaited and never
// read; a failed seed produced a company with no chart and an owner on Home looking at the
// built-in chart as theirs. Every step is checked, the seed is read back, and a retry
// resumes from the failed step instead of creating a second company.
// ═════════════════════════════════════════════════════════════════════════════
const src = fs.readFileSync("src/components/CompanySetup.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const body = src.slice(src.indexOf("const create = async () => {"), src.indexOf("const s = {"));

describe("C419", () => {
  it("no fire-and-forget call remains in the setup sequence", () => {
    expect(body).not.toMatch(/^\s*await supabase\.(rpc|from)\(/m);   // every await is read into a result
    expect(body).toMatch(/const \{ error: se \} = await supabase\.rpc\("seed_company_accounts"/);
    expect(body).toMatch(/if \(se\) throw new Error\(/);
    expect(body).toMatch(/const \{ error: be \} = await supabase\.from\("bank_accounts"\)\.insert\([\s\S]*?\)\.select\("id"\);\s*if \(be\) throw/);
    expect(body).toMatch(/const \{ error: sube \} = await supabase\.from\("subscriptions"\)\.insert\([\s\S]*?\)\.select\("id"\);\s*if \(sube\) throw/);
  });
  it("★ the seed is READ BACK — an RPC returning without an error and the chart existing are different facts", () => {
    const i = body.indexOf('rpc("seed_company_accounts"');
    const after = body.slice(i, i + 500);
    expect(after).toMatch(/const \{ count: seeded \} = await supabase\.from\("accounts"\)\.select\("id", \{ count: "exact", head: true \}\)/);
    expect(after).toMatch(/if \(!seeded\) throw new Error\(/);
  });
  it("★ a retry resumes: the created company is remembered, and each later step is skipped when its row already exists", () => {
    expect(src).toMatch(/const createdRef = React\.useRef\(null\);/);
    expect(body).toMatch(/let company = createdRef\.current;\s*if \(!company\) \{/);
    expect(body).toMatch(/createdRef\.current = data;/);
    expect(body).toMatch(/if \(!haveAccounts\) \{/);
    expect(body).toMatch(/if \(cashAcct && !haveBank\) \{/);
    expect(body).toMatch(/if \(!haveSub\) \{/);
  });
  it("every sentence a signup could read names the retry and passes the owner bar; the raw message is routed", () => {
    const msgs = [...body.matchAll(/throw new Error\(`([^`]*)`/g)].map((m) => m[1]);
    expect(msgs.length).toBeGreaterThanOrEqual(3);
    for (const m of msgs) {
      expect(m).toMatch(/press Create again|try again/);
      expect(containsOwnerJargon(m.replace(/\$\{[^}]*\}/g, ""))).toBe(false);
      expect(m).not.toMatch(/\$\{(se|be|sube)\.message\}/);
    }
  });
});
