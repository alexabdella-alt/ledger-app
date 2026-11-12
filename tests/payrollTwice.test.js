import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  payrollAutoPostGate, payrollAlreadyRecorded, payrollHistoryFromLedger, payrollRunsFromImports,
  payrollImportMetadata, gateSaysDuplicate, PAYROLL_GATE,
} from "../src/lib/payroll";

// ═════════════════════════════════════════════════════════════════════════════
// C592 — THE SAME PAYROLL REGISTER, DROPPED TWICE. Review finding F6/U2 (two reviewers).
// ═════════════════════════════════════════════════════════════════════════════
const june = { periodStart: "2026-06-01", periodEnd: "2026-06-15", payDate: "2026-06-17", gross: 4133.33, net: 3211.07, withholdings: 922.26, employerTax: 316.21 };
const imp = (r, extra = {}) => ({ id: 1, total_gross: r.gross, total_net: r.net, pay_date: r.payDate, period_start: r.periodStart, period_end: r.periodEnd, ...extra });
// A posted run as the ledger holds it: rows stamped by `payrollImportMetadata`.
const ledgerRun = (id, r) => [{ id, db_entry_id: id, date: r.payDate, gl_code: "6000", debit_credit: "debit", amount: r.gross, status: "booked", import_metadata: payrollImportMetadata(imp(r)) }];
const may = { ...june, periodStart: "2026-05-16", periodEnd: "2026-05-31", payDate: "2026-06-02" };

describe("the gate", () => {
  const prior = payrollHistoryFromLedger([...ledgerRun("m", may)], { salariesCode: "6000" });

  it("the first drop of a clean register still posts itself", () => {
    expect(payrollAutoPostGate(june, prior).pass).toBe(true);
  });

  it("★★ the second drop — after the first is in the books — does NOT", () => {
    const after = payrollHistoryFromLedger([...ledgerRun("m", may), ...ledgerRun("j", june)], { salariesCode: "6000" });
    const g = payrollAutoPostGate(june, after);
    expect(g.pass).toBe(false);
    expect(g.reasons.map((r) => r.code)).toEqual([PAYROLL_GATE.DUPLICATE]);
    expect(g.reasons[0].text).toBe("A payroll for 2026-06-01 to 2026-06-15 with the same gross pay ($4,133.33) is already in the books — adding this one would count that pay run twice.");
    expect(gateSaysDuplicate(g)).toBe(true);
  });

  it("★★ nor when both were dropped together and the first is not in the ledger yet", () => {
    const g = payrollAutoPostGate(june, prior, { session: payrollRunsFromImports([imp(june, { posted: false })]) });
    expect(g.pass).toBe(false);
    expect(g.reasons[0].text).toMatch(/is already waiting here — this looks like the same file dropped twice\./);
    const posted = payrollAutoPostGate(june, prior, { session: payrollRunsFromImports([imp(june, { posted: true })]) });
    expect(posted.reasons[0].text).toMatch(/is already in the books/);
  });

  it("★ the next period with the SAME gross is not a duplicate — every salaried company", () => {
    const after = payrollHistoryFromLedger([...ledgerRun("m", may), ...ledgerRun("j", june)], { salariesCode: "6000" });
    const july = { ...june, periodStart: "2026-06-16", periodEnd: "2026-06-30", payDate: "2026-07-02" };
    expect(payrollAutoPostGate(july, after).pass).toBe(true);
  });

  it("the same period with a different gross is not a duplicate (a correction run)", () => {
    const after = payrollHistoryFromLedger(ledgerRun("j", june), { salariesCode: "6000" });
    expect(payrollAlreadyRecorded({ ...june, gross: 4200 }, after)).toBeNull();
  });

  it("★ a run recorded before periods were stamped is matched on its pay date", () => {
    const legacy = [{ id: "L", date: "2026-06-17", gl_code: "6000", debit_credit: "debit", amount: 4133.33, status: "booked", import_metadata: { kind: "payroll" } }];
    const h = payrollHistoryFromLedger(legacy, { salariesCode: "6000" });
    expect(payrollAlreadyRecorded(june, h)?.where).toBe("books");
    expect(payrollAlreadyRecorded({ ...june, payDate: "2026-07-01" }, h)).toBeNull();
  });

  it("a voided run does not block its replacement", () => {
    const voided = ledgerRun("j", june).map((r) => ({ ...r, status: "voided" }));
    expect(payrollAutoPostGate(june, payrollHistoryFromLedger([...ledgerRun("m", may), ...voided], { salariesCode: "6000" })).pass).toBe(true);
  });

  it("the history carries the period it reads", () => {
    expect(payrollHistoryFromLedger(ledgerRun("j", june), { salariesCode: "6000" })[0])
      .toMatchObject({ gross: 4133.33, payDate: "2026-06-17", periodStart: "2026-06-01", periodEnd: "2026-06-15" });
  });
});

describe("the wiring", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const view = readFileSync("src/components/views/PayrollView.jsx", "utf8");

  it("★ the check reads the ledger as it is NOW and this sitting's registers", () => {
    expect(app).toMatch(/payrollHistoryFromLedger\(invoicesRef\.current \|\| invoices, \{ salariesCode: payrollCodes\(\)\.salariesCode \}\)/);
    expect(app).toMatch(/payrollAutoPostGate\(register, history, \{ session: payrollRunsFromImports\(payrollSeenRef\.current\) \}\)/);
  });

  it("★ a register is added to this sitting's list AFTER it is judged, and before it posts", () => {
    const judged = app.indexOf("payrollAutoPostGate(register, history, { session:");
    const seen = app.indexOf("payrollSeenRef.current = [importRecord, ...payrollSeenRef.current];");
    const posts = app.indexOf("await postPayroll(importRecord, { auto: true });");
    expect(judged).toBeGreaterThan(-1);
    expect(seen).toBeGreaterThan(judged);     // else every register would match itself
    expect(posts).toBeGreaterThan(seen);
  });

  it("the list is cleared with the company", () => {
    const reset = app.slice(app.indexOf("const resetCompanyState = "), app.indexOf("const resetCompanyState = ") + 2500);
    expect(reset).toMatch(/payrollSeenRef\.current = \[\];/);
  });

  it("★ the card does not post a matching register on one click", () => {
    expect(view).toMatch(/if \(gateSaysDuplicate\(imp\._gate\) && setDeleteConfirm\) \{\s*\n\s*setDeleteConfirm\(\{ title: "Post this payroll a second time\?"/);
    expect(view).toMatch(/confirmLabel: "Post it anyway", onConfirm: async \(\) => \{ await postPayroll\(imp\); \} \}\);\s*\n\s*return;/);
  });
});
