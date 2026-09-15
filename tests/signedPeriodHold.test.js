// ─────────────────────────────────────────────────────────────────────────────
// C373 — AN UPLOAD HELD OUT OF A SIGNED MONTH AND SENT TO THE ACCOUNTANT SURVIVES A RELOAD.
//
// The decision modal is React state; "send to my accountant" wrote a notification and left
// the invoice in the tab, with the intake row reading "0 of 1 saved". The row now says why
// it is held, Review lists it with a way back, and the two decisions that DO book it move
// the row to RECORDED once every transaction on the document has landed.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { signedPeriodHoldCards, signedPeriodHoldDetail, SIGNED_PERIOD_HOLD_PREFIX, waitingOnYou, waitingCopy } from "../src/lib/waitingOnYou.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const row = (over = {}) => ({ id: "r1", status: "held_for_review", detail: signedPeriodHoldDetail("July 2026"), filename: "late-july-bill.pdf", document_id: "d1", ...over });

describe("the card", () => {
  it("reads the prefix, carries the month, and rides waitingOnYou", () => {
    const [c] = signedPeriodHoldCards([row()]);
    expect(c).toMatchObject({ kind: "signed_period_held", period: "July 2026", action: "reload", reloadable: true });
    expect(waitingCopy(c)).toBe("late-july-bill.pdf is dated inside July 2026, which is signed off — the owner sent it to you. Nothing is booked until you reopen that month or move it.");
    expect(waitingOnYou({ intakeRows: [row()] }).map((x) => x.kind)).toContain("signed_period_held");
    expect(signedPeriodHoldCards([row({ detail: "0 of 1 transaction(s) saved — 1 did not" })])).toHaveLength(0);
    expect(waitingCopy(signedPeriodHoldCards([row({ document_id: null })])[0])).toMatch(/no longer have the file/);
  });
});

describe("the wiring (source)", () => {
  const app = read("src/App.jsx");
  it("every built upload invoice carries its upload item, and the partial hold is recorded with what landed and what was expected", () => {
    expect(app).toMatch(/invoice\._queueItemId = item\.id;/);
    expect(app).toMatch(/partialHoldsRef\.current\[String\(item\.id\)\] = \{ intakeId: item\.intake_id, ids: \[\.\.\.\(entryLinks\.ids \|\| \[\]\)\], expected: entryLinks\.expected \}/);
  });
  it("send-to-accountant writes the signed-month sentence on the row, keeping the ids that landed", () => {
    const i = app.indexOf("const sendHeldToCPA = async () => {");
    const body = app.slice(i, i + 1200);
    expect(body).toMatch(/markIntake\(hold\.intakeId, INTAKE_STATUS\.HELD, \{ journalEntryIds: hold\.ids, detail: signedPeriodHoldDetail\(/);
  });
  it("both booking decisions settle the row, RECORDED only when every expected transaction has landed", () => {
    const i = app.indexOf("const settlePartialHold = (invoice, jeId) => {");
    const body = app.slice(i, i + 1200);
    expect(body).toMatch(/if \(hold\.ids\.length >= hold\.expected\) \{\s*markIntake\(hold\.intakeId, INTAKE_STATUS\.RECORDED/);
    expect(body).toMatch(/markIntake\(hold\.intakeId, INTAKE_STATUS\.HELD, \{ journalEntryIds: hold\.ids, detail: partialHoldDetail\(hold\.ids\.length, hold\.expected\)/);   // C390 — the shared sentence
    for (const fn of ["const reopenSignedPeriodAndBook = async () => {", "const rebookHeldIntoOpenMonth = async () => {"]) {
      const j = app.indexOf(fn);
      const b = app.slice(j, j + 1000);
      expect(b, fn).toMatch(/if \(jeId\) \{ settlePartialHold\(held\.invoice, jeId\);/);
    }
  });
  it("the owner's completeness line counts it as held for the accountant", () => {
    expect(app).toMatch(/\+ signedPeriodHoldCards\(intakeRows\)\.length,/);
  });
});
