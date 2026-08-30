import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ O116 — PAYROLL IS HANDLED, NOT HANDED OVER.
//
// The home screen promises "drop anything here — your AI controller handles the rest".
// Payroll was the one thing that answered "go to this other page", and on the CLIENT seat
// it was worse: the file was stashed UNPARSED with "we've saved that for your accountant",
// so dropping a register **did nothing at all** until somebody else opened a different
// screen, possibly days later.
//
// ★ THE PIPELINE WAS MOVED, NOT COPIED. That is the whole reason this was a refactor and
// not a feature: two implementations of one contract is the ·3a failure, where both halves
// look tested and drift apart. The drop zone, the Home queue and the manual Post button now
// run the same code and cannot disagree about what a register does.
// ═════════════════════════════════════════════════════════════════════════════

const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/PayrollView.jsx"), "utf8");
const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

describe("★★★ a payroll file dropped on Home is processed where it lands", () => {
  it("★★ routing runs the pipeline instead of navigating", () => {
    const route = strip(app.slice(app.indexOf("const routeFileToType"), app.indexOf("const persistBankStatement")));
    expect(route).toMatch(/if \(type === "payroll"\) \{ handlePayrollFile\(file\); return; \}/);
    expect(route).not.toMatch(/setView\("payroll"\)/);
  });

  it("★★★ and the client seat no longer stashes it unparsed", () => {
    // This is the half that mattered: a client dropping payroll used to get "saved for your
    // accountant" and NOTHING happened. The seat check now covers bank and QBO only.
    const route = strip(app.slice(app.indexOf("const routeFileToType"), app.indexOf("const persistBankStatement")));
    const seatCheck = route.slice(route.indexOf("!navSeat.isReviewerSeat"), route.indexOf("!navSeat.isReviewerSeat") + 160);
    expect(seatCheck).toContain("bank_statement");
    expect(seatCheck).toContain("qbo");
    expect(seatCheck).not.toContain("payroll");
    // the payroll branch must come FIRST, or the seat check would swallow it again
    expect(route.indexOf('type === "payroll"')).toBeLessThan(route.indexOf("!navSeat.isReviewerSeat"));
  });

  it("★★ the OTHER three still route, deliberately", () => {
    // Not an oversight: a bank statement opens a reconciliation a person drives, a contract
    // needs terms confirmed, QuickBooks is a mapping exercise. Payroll is the one whose
    // clean path is fully decided by a gate we already trust.
    const route = strip(app.slice(app.indexOf("const routeFileToType"), app.indexOf("const persistBankStatement")));
    expect(route).toMatch(/setView\("bank"\)/);
    expect(route).toMatch(/setView\("contracts"\)/);
    expect(route).toMatch(/setView\("onboard"\)/);
  });
});

describe("★★ one implementation, two callers", () => {
  it("★★★ the view holds no pipeline of its own", () => {
    // A second copy is the ·3a failure. If this ever fails, someone has re-implemented
    // posting inside the view and the two will drift while both look tested.
    expect(view).not.toMatch(/persistMultiLineEntry\(/);
    expect(view).not.toMatch(/payrollAutoPostGate\(/);
    expect(view).not.toMatch(/payrollRequestBody\(/);
  });

  it("the view consumes them from context", () => {
    expect(view).toMatch(/handlePayrollFile, postPayroll, payrollCodes,/);
  });

  it("★ and the pipeline is exposed exactly once", () => {
    expect((app.match(/const handlePayrollFile = async/g) || []).length).toBe(1);
    expect((app.match(/const postPayroll = async/g) || []).length).toBe(1);
  });
});

describe("★★ a held register is an outcome, not a silence", () => {
  it("★★★ the client is told, in their own terms, what happened to it", () => {
    // The gate refusing is the CORRECT result for a register that doesn't foot. But without
    // a word here a client would see the file accepted and then nothing, forever — which is
    // exactly what "handled" must not mean.
    expect(app).toMatch(/We've read your payroll and set it aside for your accountant to post\./);
  });

  it("★ the reviewer gets the version that says where it is waiting", () => {
    expect(app).toMatch(/It's waiting in Payroll\./);
  });

  it("★★ and the REASON comes from the gate, not from a guess (§9)", () => {
    // A hold described in parallel with the decision can describe a hold that did not
    // happen. This reads `gate.reasons`, so it cannot.
    const held = app.slice(app.indexOf("const why = (gate.reasons"), app.indexOf("const why = (gate.reasons") + 500);
    expect(held).toMatch(/gate\.reasons \|\| \[\]/);
    expect(held).toMatch(/showNotification\(navSeat\.isReviewerSeat/);
  });
});
