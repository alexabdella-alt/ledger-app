import { describe, it, expect } from "vitest";
import { reportNavBack, reportBreadcrumb } from "../src/lib/reportNav.js";

// The bug: a single returnTo pointer stored only ONE place to return to (the report top),
// so Back from a drilled transaction skipped the intermediate line-item list. reportNavBack
// pops EXACTLY ONE level. These replay the real drill paths and assert each Back lands on
// the immediately-previous level, never jumping to the top.

describe("reportNavBack — Income Statement → revenue account → transaction (the repro)", () => {
  const pl = "pl";
  // Drill DOWN:
  const L0 = { view: "reports", reportType: pl, plDrill: null, drill: null };        // Income Statement
  const L1 = { view: "reports", reportType: pl, plDrill: { type: "rev-acct", code: "4100", name: "Service Revenue" }, drill: null }; // line-item list
  const L2 = { view: "detail",  reportType: pl, plDrill: L1.plDrill, drill: null };   // single transaction detail

  it("Back from the transaction → the Service Revenue LINE-ITEM LIST (one level up, NOT the report)", () => {
    const back1 = reportNavBack(L2);
    expect(back1).toEqual(L1);                 // ← was skipping straight to L0; now lands on the list
    expect(back1.view).toBe("reports");
    expect(back1.plDrill).toEqual(L1.plDrill); // the list is preserved
  });

  it("Back again → the Income Statement (report top)", () => {
    const back2 = reportNavBack(L1);
    expect(back2).toEqual(L0);
  });

  it("Back at the report top → null (nothing to pop; caller falls back to returnTo/tab)", () => {
    expect(reportNavBack(L0)).toBe(null);
  });

  it("full path retraces one level per Back: detail → list → report", () => {
    const trail = [];
    let s = L2;
    while (s) { trail.push(s); s = reportNavBack(s); }
    expect(trail.map(x => x.view + (x.plDrill ? ":" + x.plDrill.type : ""))).toEqual([
      "detail:rev-acct", "reports:rev-acct", "reports",
    ]);
  });
});

describe("reportNavBack — 3-level expense path (account → vendor → transaction)", () => {
  const code = "6800", name = "Professional Services", vendor = "Pixel";
  const acct = { view: "reports", reportType: "pl", plDrill: { type: "exp-acct", code, name }, drill: null };       // vendor list
  const ven  = { view: "reports", reportType: "pl", plDrill: { type: "exp-vendor", code, name, vendor }, drill: null }; // txn list
  const txn  = { view: "detail",  reportType: "pl", plDrill: ven.plDrill, drill: null };                            // detail

  it("detail → vendor's txn list → account's vendor list → report (one level each)", () => {
    const b1 = reportNavBack(txn); expect(b1).toEqual(ven);   // detail → vendor txn list
    const b2 = reportNavBack(b1);  expect(b2).toEqual(acct);  // vendor txn list → vendor list
    const b3 = reportNavBack(b2);  expect(b3).toEqual({ view: "reports", reportType: "pl", plDrill: null, drill: null }); // → report
    expect(reportNavBack(b3)).toBe(null);
  });
});

describe("reportNavBack — other reports (Balance Sheet account drill)", () => {
  const drill = { scope: "bsacct", value: "1100", label: "Accounts Receivable" };
  it("BS account txn list → detail → back to the txn list → report", () => {
    const list = { view: "reports", reportType: "balance", plDrill: null, drill };
    const det  = { view: "detail",  reportType: "balance", plDrill: null, drill };
    expect(reportNavBack(det)).toEqual(list);   // detail → list (one level, not the report)
    expect(reportNavBack(list)).toEqual({ view: "reports", reportType: "balance", plDrill: null, drill: null });
  });
});

describe("reportBreadcrumb", () => {
  it("builds the trail root → current", () => {
    expect(reportBreadcrumb({ plDrill: { type: "rev-acct", name: "Service Revenue" } }, "Income Statement"))
      .toEqual(["Income Statement", "Revenue", "Service Revenue"]);
    expect(reportBreadcrumb({ plDrill: { type: "exp-vendor", name: "Professional Services", vendor: "Pixel" }, view: "detail" }, "Income Statement"))
      .toEqual(["Income Statement", "Professional Services", "Pixel", "Transaction"]);
  });
});
