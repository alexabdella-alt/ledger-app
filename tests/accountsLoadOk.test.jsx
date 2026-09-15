import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import CoaView from "../src/components/views/CoaView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C416 — THE CHART OF ACCOUNTS HAD NO STALE GUARD, NO RESET ON SWITCH, AND NO VERDICT.
//
// `useAccounts` kept the previous company's accounts until the next company's read
// resolved — and forever if it failed — so a booking in that window resolved every role
// against the LAST company's chart and would have posted lines referencing another
// tenant's account ids (the lines table checks its own company_id, not the account's). A
// failed read on first load left the chart empty, every role fell through to the built-in
// fallback, and `ensureAccount` would have MATERIALISED the built-in chart onto the company
// (O108 finding 4, reached through a network blip). And `CHART_OF_ACCOUNTS` falls back to
// the built-in chart for DISPLAY, so the Categories screen showed it as the company's own,
// editable. The hook now resets on switch, drops late results (C413's ref), records
// `loadOk`, both write paths refuse while it is false, and the screen says so.
// ═════════════════════════════════════════════════════════════════════════════
const hook = fs.readFileSync("src/hooks/useAccounts.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("useAccounts", () => {
  it("clears the previous company's chart before the read, and drops a late result", () => {
    const i = hook.indexOf("const load = useCallback(async () => {");
    const body = hook.slice(i, hook.indexOf("}, [companyId]);", i));
    // the reset sits between "loading" and the await — the `!companyId` early return also
    // clears, and a check that only asked "before the await" passed with the real reset gone
    const afterLoading = body.indexOf("setLoading(true);");
    const reset = body.indexOf("setAccounts([]);", afterLoading);
    expect(reset).toBeGreaterThan(afterLoading);
    expect(reset).toBeLessThan(body.indexOf("await supabase"));
    expect(body).toMatch(/if \(latestCid\.current !== companyId\) return;/);
    expect(hook).toMatch(/const latestCid = useRef\(companyId\);\s*latestCid\.current = companyId;/);
  });
  it("records the verdict both ways and returns it", () => {
    expect(hook).toMatch(/if \(error\) \{[^}]*setLoadOk\(false\); \}/);
    expect(hook).toMatch(/else if \(data\) \{\s*setLoadOk\(true\);/);
    expect(hook).toMatch(/return \{ accounts, loading, loadOk, reload: load,/);
  });
});

describe("★★ nothing books against a chart that did not load", () => {
  it("both write paths refuse first, and say so", () => {
    for (const fn of ["const persistJournalEntry = async (invoice) => {", "const persistMultiLineEntry = async (entry, { background = false } = {}) => {"]) {
      const i = app.indexOf(fn);
      expect(i, fn).toBeGreaterThan(-1);
      const head = app.slice(i, i + 700);
      expect(head, fn).toMatch(/if \(accountsLoadOk === false\) \{[^\n]*CHART_NOT_LOADED[^\n]*return null; \}/);
      // before the cutoff guard, which is the first business rule
      expect(head.indexOf("accountsLoadOk === false"), fn).toBeLessThan(head.indexOf("isBeforeCutoff"));
    }
    expect(app).toMatch(/loadOk: accountsLoadOk, reload: reloadAccounts/);
  });
});

describe("the Categories screen", () => {
  it("shows the notice over a failed read, and the chart over a good one", () => {
    const failed = renderViewHtml(CoaView, { accountsLoadOk: false, CHART_OF_ACCOUNTS: [{ code: "6100", name: "Rent", category: "Expenses" }] });
    expect(failed).toContain('data-load-failed="accounts"');
    expect(failed).not.toContain("6100");
    const ok = renderViewHtml(CoaView, { accountsLoadOk: true, CHART_OF_ACCOUNTS: [{ code: "6100", name: "Rent", category: "Expenses" }] });
    expect(ok).not.toContain("data-load-failed");
    expect(ok).toContain("6100");
  });
});
