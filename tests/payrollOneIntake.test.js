import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C625 — review finding U10: a held payroll register could never be re-read, and a payroll file
// dropped on Home logged two arrivals.
const app = readFileSync("src/App.jsx", "utf8");
const fn = app.slice(app.indexOf("const handlePayrollFile = async (file, "), app.indexOf("const routeFileToType"));

describe("one payroll file, one intake row, one stored copy", () => {
  it("★ a file Home already logged is NOT logged again", () => {
    expect(fn).toMatch(/const pIntakeId = givenIntakeId \|\| /);
    expect(fn).toMatch(/if \(!givenIntakeId\) logIntake && logIntake\(pIntakeId, file, "payroll"\);/);
  });

  it("★ Home hands over its intake row and stored file, and leaves the row for payroll to settle", () => {
    expect(app.match(/routeFileToType\([^,]+, file, [^)]*\? \{ intakeId: item\.intake_id, documentId: durableDocId \} : \{\}\)/g)).toHaveLength(2);
    expect(app).toMatch(/if \(route\.to !== "payroll"\) markIntake\(item\.intake_id, INTAKE_STATUS\.HELD/);
    expect(app).toMatch(/if \(docType !== "payroll"\) markIntake\(item\.intake_id, INTAKE_STATUS\.HELD/);
  });

  it("★ the file is stored once, and a hold carries the stored file so it can be re-read", () => {
    expect(fn).toMatch(/const payrollDocId = givenDocId \|\| await storeDocument\(/);
    expect(fn).toMatch(/markIntake\(pIntakeId, INTAKE_STATUS\.HELD, \{ detail: payrollHoldDetail\(gate\.reasons\), \.\.\.\(isDurableDocId\(payrollDocId\) \? \{ documentId: payrollDocId \} : \{\}\) \}\);/);
  });

  it("the re-read refuses only a row with no file", () => {
    expect(app).toMatch(/if \(!row\.document_id\) return \{ ok: false, error: "no stored file for this document/);
  });
});
