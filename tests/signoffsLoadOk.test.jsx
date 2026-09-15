import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ownerTrustState } from "../src/lib/ownerTrust.js";
import { reportAttestationLine } from "../src/lib/signoff.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import ReportsView from "../src/components/views/ReportsView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C410 — THE SIGN-OFF READ IS RECORDED AS RUN-OR-NOT, AND A COMPANY SWITCH CLEARS THE
// PREVIOUS COMPANY'S SIGN-OFFS, INTAKE ROWS AND ATTESTER.
//
// The sign-off/intake effect loads per company with `if (so.ok) setSignoffs(...)` and
// nothing recorded whether it ran, so a failed read left `signoffs` at `[]` — and Reports
// said "No month has been signed off yet — these figures haven't been reviewed by anyone",
// a claim about the books made on the evidence of a query (O98). Worse: `resetCompanyState`
// never cleared `signoffs`, `intakeRows` or `hasAttester`, so between a switch and the new
// company's read resolving — or forever, if it failed — the screen showed the LAST
// company's signed months, held questions and attester. §3's UI-layer isolation was true
// for the tables `loadAllData` reads in 2026-06 and false for every load added after it.
//
// C411 — and `ownerTrust.selfSigned`, which Reports reads for its attestation line, was
// never returned by `ownerTrustState`: a solo owner's Reports said "Reviewed and signed
// off" — the accountant's sentence — over months they signed themselves. C343's test pinned
// the caller's expression and never asked whether the field existed (·3a).
// ═════════════════════════════════════════════════════════════════════════════
const base = { controlTotals: { failed: [], allTie: true }, hasBooks: true, setupComplete: true };

describe("C410 — a sign-off read that did not run", () => {
  it("the trust panel says it could not check, and cannot reach all_clear", () => {
    const t = ownerTrustState({ ...base, signoffsChecked: false, reviewedThrough: null, hasAttester: true });
    expect(t.lines.reviewed.text).toMatch(/couldn't check which months have been signed off/);
    expect(t.lines.reviewed.signed).toBe(false);
    expect(t.overall).not.toBe("all_clear");
    // and a read that RAN with nothing signed keeps the honest "awaiting" sentence
    expect(ownerTrustState({ ...base, signoffsChecked: true, reviewedThrough: null, hasAttester: true }).lines.reviewed.text).toMatch(/Awaiting your accountant/);
  });
  it("the Reports line says it could not check rather than 'nobody has reviewed'", () => {
    expect(reportAttestationLine({ checked: false })).toMatch(/couldn't check which months have been signed off/);
    expect(reportAttestationLine({ checked: false })).not.toMatch(/haven't been reviewed by anyone/);
    expect(reportAttestationLine({ checked: true })).toMatch(/haven't been reviewed by anyone/);
  });
  it("is wired: the effect records the verdict, the memo passes it, the context exports it", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    const i = app.indexOf("setSignoffsLoadOk(!!so.ok);");
    expect(i).toBeGreaterThan(-1);
    expect(app.slice(i, i + 260)).toMatch(/if \(so\.ok\) setSignoffs\(so\.signoffs\);/);
    expect(app).toMatch(/signoffsChecked: signoffsLoadOk,/);
    expect(app).toMatch(/reviewedThrough, signoffsLoadOk, ownerTrust,/);
  });
});

describe("C410 — a company switch clears every per-company load, not only loadAllData's", () => {
  const src = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  const body = (name) => {
    const m = src.match(new RegExp(`const ${name} = (?:async )?\\([^)]*\\) => \\{`)); if (!m) return "";
    let k = m.index + m[0].length, depth = 1, p = k;
    while (depth && p < src.length) { depth += (src[p] === "{") - (src[p] === "}"); p++; }
    return src.slice(k, p);
  };
  const reset = body("resetCompanyState");
  const resetSetters = new Set([...reset.matchAll(/\b(set[A-Z]\w*)\(/g)].map((m) => m[1]));
  it("★ every setter written by a per-company loader is reset on switch", () => {
    expect(reset.length).toBeGreaterThan(500);
    const loaders = [...src.matchAll(/const ((?:load|fetch|refresh)\w+) = (?:async )?\(/g)].map((m) => m[1]);
    const missing = [];
    for (const name of loaders) {
      const b = body(name);
      if (!b.includes('.eq("company_id"')) continue;
      for (const st of new Set([...b.matchAll(/\b(set[A-Z]\w*)\(/g)].map((m) => m[1]))) if (!resetSetters.has(st)) missing.push(`${name}: ${st}`);
    }
    expect(missing).toEqual([]);
  });
  it("★ and the sign-off/intake effect's setters, which are not a named loader", () => {
    const i = src.indexOf("fetchSignoffs(supabase, currentCompany.id)");
    expect(i).toBeGreaterThan(-1);
    const blk = src.slice(src.lastIndexOf("useEffect(", i), src.indexOf("[currentCompany?.id]", i));
    const setters = new Set([...blk.matchAll(/\b(set[A-Z]\w*)\(/g)].map((m) => m[1]));
    expect([...setters]).toEqual(expect.arrayContaining(["setSignoffs", "setIntakeRows", "setHasAttester", "setIntakeLoadOk", "setSignoffsLoadOk"]));
    for (const st of setters) expect(resetSetters.has(st), st).toBe(true);
  });
});

describe("C411 — Reports tells a self-signed month from an accountant's review", () => {
  it("ownerTrustState returns selfSigned for the month it reports", () => {
    expect(ownerTrustState({ ...base, reviewedThrough: "2026-07", selfSigned: true, hasAttester: false }).selfSigned).toBe(true);
    expect(ownerTrustState({ ...base, reviewedThrough: "2026-07", selfSigned: false, hasAttester: true }).selfSigned).toBe(false);
    expect(ownerTrustState({ ...base, reviewedThrough: null, selfSigned: true }).selfSigned).toBe(false);   // nothing signed → nothing self-signed
  });
  it("rendered: a solo owner's Reports line says 'by you', an accountant's says 'Reviewed'", () => {
    const ctx = (over) => ({ ...POPULATED, reviewedThrough: "2026-07", signoffsLoadOk: true, ownerTrust: ownerTrustState({ ...base, reviewedThrough: "2026-07", ...over }) });
    expect(renderViewHtml(ReportsView, ctx({ selfSigned: true, hasAttester: false }))).toMatch(/Signed off through July 2026 by you/);
    expect(renderViewHtml(ReportsView, ctx({ selfSigned: false, hasAttester: true }))).toMatch(/Reviewed and signed off through July 2026\./);
    const failed = renderViewHtml(ReportsView, { ...POPULATED, reviewedThrough: null, signoffsLoadOk: false, ownerTrust: ownerTrustState({ ...base, signoffsChecked: false }) });
    expect(failed).toMatch(/couldn(&#x27;|')t check which months have been signed off/);
  });
});
