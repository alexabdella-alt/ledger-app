import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ═════════════════════════════════════════════════════════════════════════════
// C413 — THE MID-SWITCH GUARD COMPARED A VALUE TO ITSELF, SO IT COULD NEVER FIRE.
//
// `loadAllData` reads `const cid = currentCompany.id` and later asks
// `if (currentCompany.id !== cid) return;` — but `currentCompany` is a PROP captured when the
// closure was created, and a prop does not change inside one closure. Three guards written
// against CR-19 (the ledger, the settled reads, the `finally` that marks data loaded — the
// last one added by C277 with a note that it was "now conditional on still being on that
// company") were tautologically false, and a slow load for the previous company could land
// its ledger over the next one. C195(7): a guard whose condition cannot be true is
// indistinguishable from one that is holding.
//
// The fix is a ref assigned every render (`currentCompanyIdRef`) read through `stillOn(cid)`,
// and every per-company loader that sets state after its own await asks it too.
// ═════════════════════════════════════════════════════════════════════════════
const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("★★ the stale-company guard reads a ref, never the captured prop", () => {
  it("the ref is assigned on every render, and stillOn reads it", () => {
    expect(src).toMatch(/const currentCompanyIdRef = useRef\(null\);\s*currentCompanyIdRef\.current = currentCompany\?\.id \|\| null;/);
    expect(src).toMatch(/const stillOn = \(cid\) => currentCompanyIdRef\.current === cid;/);
  });
  it("no guard compares the captured prop to its own cid (the tautology)", () => {
    expect(src).not.toMatch(/currentCompany\??\.id !== cid/);
    expect(src).not.toMatch(/currentCompany\??\.id === cid/);
  });
  it("loadAllData asks before applying the ledger, before the settled reads, and before marking loaded", () => {
    const i = src.indexOf("const loadAllData = async () => {");
    const body = src.slice(i, src.indexOf("\n  };", i));
    expect((body.match(/if \(!stillOn\(cid\)\) return;/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(body).toMatch(/finally \{ if \(stillOn\(cid\)\) setCompanyDataLoaded\(true\); \}/);
  });
  it("★ every per-company loader that sets state after an await asks stillOn first", () => {
    const names = ["loadAnomalies", "loadNotifications", "loadFiledDeadlines", "loadAnomalyComments", "loadContractsFromDB", "loadStatementExceptions", "refreshMailState"];
    for (const name of names) {
      const m = src.match(new RegExp(`const ${name} = async \\([^)]*\\) => \\{`));
      expect(m, name).toBeTruthy();
      let k = m.index + m[0].length, depth = 1, p = k;
      while (depth && p < src.length) { depth += (src[p] === "{") - (src[p] === "}"); p++; }
      const body = src.slice(k, p);
      const guard = body.indexOf("stillOn(cid)");
      const firstSet = body.search(/\bset[A-Z]\w*\(|applyAnomalyRows\(/);
      expect(guard, `${name}: no stillOn`).toBeGreaterThan(-1);
      // the guard precedes the first state write that follows an await
      const firstAwait = body.indexOf("await ");
      const firstSetAfterAwait = body.slice(firstAwait).search(/\bset[A-Z]\w*\(|applyAnomalyRows\(/) + firstAwait;
      expect(guard, `${name}: guard after a state write`).toBeLessThan(firstSetAfterAwait);
      expect(firstSet).toBeGreaterThan(-1);
    }
  });
});
