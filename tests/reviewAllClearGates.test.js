import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C442 — Review's "All clear — nothing needs review" gates on every read it depends on.
describe("C442", () => {
  it("the all-clear branch is behind the three read verdicts, and the context exports them", () => {
    const rv = fs.readFileSync("src/components/views/ReviewView.jsx", "utf8");
    expect(rv).toMatch(/\(droppedCheckFailed \|\| statementExceptionsLoadFailed \|\| anomaliesLoadOk === false \|\| signoffsLoadOk === false \|\| intakeLoadOk === false\) \? \(/);
    const app = fs.readFileSync("src/App.jsx", "utf8");
    for (const k of ["anomaliesLoadOk", "intakeLoadOk", "signoffsLoadOk"]) expect(app).toMatch(new RegExp(`erpCtx = \\{[^\\n]*\\b${k}\\b`));
  });
});
