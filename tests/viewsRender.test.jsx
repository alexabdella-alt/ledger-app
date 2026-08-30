import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { renderViewError, VIEW_CONTEXT } from "./helpers/renderView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ O14 — "A SCREEN CAN CRASH WITH A GREEN SUITE." NOT ANY MORE.
//
// Every other test here exercises LOGIC. Nothing had ever rendered a screen, so a view
// could throw on its first paint — a null read, a context key renamed under it, a `.map`
// on something that stopped being an array — and 2,400 passing tests would say nothing.
// That is not hypothetical: today alone, three of this session's commits renamed or moved
// context values that views consume.
//
// ★ WHAT THIS PROVES, EXACTLY: every screen PAINTS with an empty company. It does not run
// effects, does not click anything, and does not check that a screen is CORRECT. It is a
// smoke test and is written to be honest about that — the value is that the class of
// failure it catches (a crash on open) was previously invisible to every check we had.
//
// ★★ AND IT COSTS NO DEPENDENCY. `renderToString` ships with React and needs no DOM. A
// jsdom + testing-library setup would test more and was not worth the two packages and the
// config to a project that has deliberately stayed at six dependencies.
// ═════════════════════════════════════════════════════════════════════════════

const viewsDir = path.join(process.cwd(), "src/components/views");
const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith(".jsx")).sort();

// Top-level components that take no props and read the same context.
const TOP_LEVEL = ["ClarificationFlow.jsx", "CompanySwitcher.jsx", "LegalView.jsx"];

describe("★★★ every screen renders without throwing", () => {
  it("there are screens to test — a sweep over an empty list is a vacuous pass", () => {
    // The C195(7) lesson: a guard whose input is always empty is indistinguishable from a
    // clean queue. If a rename empties this list, the suite must fail rather than pass.
    expect(viewFiles.length).toBeGreaterThanOrEqual(30);
  });

  for (const f of viewFiles) {
    it(`renders ${f}`, async () => {
      const mod = await import(path.join(viewsDir, f));
      expect(typeof mod.default, `${f} has no default export`).toBe("function");
      const err = renderViewError(mod.default, VIEW_CONTEXT[f] || {});
      expect(err && `${f} threw on render: ${err.message}`).toBeNull();
    });
  }

  for (const f of TOP_LEVEL) {
    it(`renders ${f}`, async () => {
      const mod = await import(path.join(process.cwd(), "src/components", f));
      if (typeof mod.default !== "function") return;
      const err = renderViewError(mod.default, VIEW_CONTEXT[f] || {});
      expect(err && `${f} threw on render: ${err.message}`).toBeNull();
    });
  }
});

describe("★ the harness itself cannot pass vacuously", () => {
  it("a component that throws IS caught", () => {
    // Without this, a harness that swallowed errors would report 33 green screens forever.
    const Boom = () => { throw new Error("boom"); };
    const err = renderViewError(Boom);
    expect(err).toBeTruthy();
    expect(err.message).toBe("boom");
  });

  it("★ the verb lookahead is what keeps data from arriving as functions", () => {
    // `filteredInvoices` starts with "filter" and `openingBalances` with "open". Without
    // the `(?=[A-Z])` lookahead both came back as functions, producing seven failures that
    // looked exactly like real crashes.
    const src = fs.readFileSync(path.join(process.cwd(), "tests/helpers/renderView.jsx"), "utf8");
    expect(src).toMatch(/\(\?=\[A-Z\]\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE SECOND HALF, AND IT EXISTS BECAUSE A MUTATION ESCAPED THE FIRST.
//
// Renaming a context key a view depends on did NOT fail the render sweep — the fixture
// hands back an empty array for any key it does not know, so the screen paints, empty and
// wrong. That is the harness being permissive on purpose (a strict fixture would be a
// second copy of the app's 300-key state shape, stale within a week), but it means:
//
//   ★ THE RENDER SWEEP CATCHES A SCREEN THAT CRASHES. IT DOES NOT CATCH A SCREEN THAT
//     SILENTLY RENDERS EMPTY — which is the quieter and more likely failure.
//
// So this checks the CONTRACT instead: every name a view pulls out of `useERP()` must
// actually be provided by `erpCtx`. That is a real defect class — three commits in this
// session alone renamed or moved context values — and it needs no fixture at all.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ every key a screen destructures from useERP() is actually provided", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");

  // The single `const erpCtx = { … }` literal.
  const ctxStart = app.indexOf("const erpCtx = {");
  const ctxBody = app.slice(ctxStart, app.indexOf("\n", ctxStart));
  const provided = new Set(
    ctxBody
      .replace(/^const erpCtx = \{/, "")
      .replace(/\};?\s*$/, "")
      .split(",")
      .map((p) => p.split(":")[0].trim())
      .filter(Boolean)
  );

  it("the provided set was actually parsed — an empty set would pass everything", () => {
    expect(provided.size).toBeGreaterThan(200);
    expect(provided.has("invoices")).toBe(true);
    expect(provided.has("currentCompany")).toBe(true);
  });

  const componentFiles = [
    ...viewFiles.map((f) => path.join("src/components/views", f)),
    ...["ClarificationFlow.jsx", "CompanySwitcher.jsx", "TransactionDetailPanel.jsx", "DocumentPreviewModal.jsx", "ChatRichOutput.jsx"]
      .map((f) => path.join("src/components", f)),
  ];

  for (const rel of componentFiles) {
    const full = path.join(process.cwd(), rel);
    if (!fs.existsSync(full)) continue;
    it(`${path.basename(rel)} asks only for things that exist`, () => {
      const src = fs.readFileSync(full, "utf8");
      const missing = [];
      // `const { a, b, c } = useERP();` — possibly spanning many lines.
      // ★ THE INNER CLASS EXCLUDES `{}();` DELIBERATELY. A `[\s\S]*?` body matched from the
      // FIRST `const {` in the file all the way to a `useERP()` hundreds of lines later in
      // `ClarificationFlow.jsx`, so every local variable, style property and comment word in
      // between was reported as a missing context key — 173 "findings", five of them real.
      // A destructure of context is a plain identifier list; anything with a brace, a call
      // or a semicolon in it is not one.
      for (const m of src.matchAll(/const\s*\{([^{}();]*?)\}\s*=\s*useERP\(\)/g)) {
        for (const raw of m[1].split(",")) {
          // `a: b` renames on destructure; the KEY is what must exist.
          const key = raw.split(":")[0].replace(/[\s\n]/g, "").split("=")[0];
          if (!key || key.startsWith("...")) continue;
          if (!provided.has(key)) missing.push(key);
        }
      }
      expect(missing, `${rel} destructures keys erpCtx does not provide`).toEqual([]);
    });
  }
});
