import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { ownerTrustState } from "../src/lib/ownerTrust.js";

// ═════════════════════════════════════════════════════════════════════════════
// C418 — "NOTHING NEEDS YOUR ATTENTION" WAS SAID OVER A FAILED ANOMALY READ.
// The anomaly loader dropped `error`; a failed read left the rows empty, the scan (correctly)
// did not run over an unloaded set, and the trust header reached all-clear on `[]`.
// ═════════════════════════════════════════════════════════════════════════════
const base = { controlTotals: { failed: [], allTie: true }, hasBooks: true, setupComplete: true, reviewedThrough: "2026-07", hasAttester: true };

describe("C418", () => {
  it("a read that did not run: the line says so, the net is not green, all_clear is unreachable", () => {
    const t = ownerTrustState({ ...base, anomaliesChecked: false, openHighAnomalies: 0 });
    expect(t.lines.correct.text).toMatch(/couldn't check for unusual activity/);
    expect(t.lines.correct.ok).toBe(false);
    expect(t.nets.noAnomalies).toBe(false);
    expect(t.overall).not.toBe("all_clear");
  });
  it("a read that ran clean keeps the honest green", () => {
    const t = ownerTrustState({ ...base, anomaliesChecked: true, openHighAnomalies: 0 });
    expect(t.lines.correct.text).toMatch(/Nothing needs your attention/);
    expect(t.nets.noAnomalies).toBe(true);
  });
  it("an open question still comes first — the unrun check does not hide an owner task", () => {
    const t = ownerTrustState({ ...base, anomaliesChecked: false, openClarifications: 2 });
    expect(t.lines.correct.text).toMatch(/asked you about 2 transactions/);
  });
  it("is wired: the loader records both directions, the memo passes it, the reset restores it", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/if \(error\) \{ console\.warn\("\[anomalies\] load failed:", error\.message\); setAnomaliesLoadOk\(false\); return; \}/);
    expect(app).toMatch(/applyAnomalyRows\(data\); anomaliesLoadedRef\.current = true; setAnomaliesLoadOk\(true\);/);
    expect(app).toMatch(/anomaliesChecked: anomaliesLoadOk,/);
    const i = app.indexOf("const resetCompanyState = () => {");
    expect(app.slice(i, app.indexOf("\n  };", i))).toMatch(/setAnomaliesLoadOk\(true\)/);
  });
});
