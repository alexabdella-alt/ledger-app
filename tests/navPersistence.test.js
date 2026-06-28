import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";

// The bug (C103 persistence silently never worked): the useState initializer correctly
// restored cfai_reportType from sessionStorage on mount, but resetCompanyState() — which
// runs on EVERY company-load (incl. refresh, via the [currentCompany?.id] effect) — then
// hard-set reportType back to "pl", and the persist effect wrote that default back, erasing
// the save. Fix: resetCompanyState restores the PERSISTED selections from sessionStorage.

// Minimal sessionStorage + the app's `ss` helper, to exercise the real read/reset/persist order.
let store;
const sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const ss = (k, fb) => sessionStorage.getItem(k) ?? fb;
beforeEach(() => { store = new Map(); });

describe("Reports sub-tab persists across refresh (the resetCompanyState clobber)", () => {
  // Replays mount → resetCompanyState → persist-effect, parameterized by how the reset behaves.
  const refreshSequence = (resetValueFn) => {
    let reportType = ss("cfai_reportType", "pl");        // 1) useState initializer on mount
    sessionStorage.setItem("cfai_reportType", reportType); // 2) persist effect after mount
    reportType = resetValueFn();                          // 3) resetCompanyState (the fix vs the bug)
    sessionStorage.setItem("cfai_reportType", reportType); // 4) persist effect after the reset
    return reportType;
  };

  it("user clicks Balance Sheet, refreshes → STAYS on Balance Sheet (fixed: reset reads from ss)", () => {
    sessionStorage.setItem("cfai_reportType", "balance");          // click Balance Sheet
    const after = refreshSequence(() => ss("cfai_reportType", "pl")); // THE FIX
    expect(after).toBe("balance");
    expect(sessionStorage.getItem("cfai_reportType")).toBe("balance");
  });

  it("the OLD behavior (reset hardcodes 'pl') would have snapped back to P&L — proving the bug", () => {
    sessionStorage.setItem("cfai_reportType", "balance");
    const after = refreshSequence(() => "pl");                     // the bug
    expect(after).toBe("pl");   // exactly the reported symptom
  });

  it("default when nothing saved → P&L", () => {
    expect(refreshSequence(() => ss("cfai_reportType", "pl"))).toBe("pl");
  });
});

describe("resetCompanyState restores persisted selections from sessionStorage (static guard)", () => {
  const src = fs.readFileSync("src/App.jsx", "utf8");
  const reset = src.match(/const resetCompanyState = \(\) => \{([\s\S]*?)\n  \};/);
  it("found resetCompanyState", () => expect(reset).toBeTruthy());
  it.each([
    ["reportType", "cfai_reportType"],
    ["apView", "cfai_apView"],
    ["booksFilter", "cfai_booksFilter"],
  ])("set%s restores from ss(%s) — not a hardcoded default", (setterKey, ssKey) => {
    const body = reset[1];
    // e.g. setReportType(ss("cfai_reportType", ...))  — NOT setReportType("pl")
    const setter = "set" + setterKey[0].toUpperCase() + setterKey.slice(1);
    const re = new RegExp(setter + "\\(\\s*ss\\(\\s*[\"']" + ssKey + "[\"']");
    expect(re.test(body), `${setter} must restore from ss("${ssKey}") so refresh keeps the selection`).toBe(true);
  });
});
