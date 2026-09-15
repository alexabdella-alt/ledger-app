import { describe, it, expect } from "vitest";
import fs from "fs";
import { makeOneInFlight } from "../src/lib/oneInFlight.js";

// ═════════════════════════════════════════════════════════════════════════════
// C401 — A SECOND CLICK WHILE THE FIRST BOOKING IS STILL WRITING RUNS NOTHING.
// The card's `done` state is set only after bookToDb returns; between the click and the
// ledger's answer a second click on the same pill called the writer again — two entries
// for one answer (the O123 shape, on the card an owner presses twice when it "does nothing").
// ═════════════════════════════════════════════════════════════════════════════
const later = (v, ms = 5) => new Promise((r) => setTimeout(() => r(v), ms));

describe("★★ makeOneInFlight", () => {
  it("two calls inside the window run the writer ONCE; the second returns false", async () => {
    let writes = 0;
    const busy = [];
    const { run } = makeOneInFlight({ onBusy: (b) => busy.push(b) });
    const p1 = run(async () => { writes++; return await later("je-1"); });
    const p2 = run(async () => { writes++; return await later("je-2"); });   // the double-click
    expect(await p2).toBe(false);
    expect(await p1).toBe("je-1");
    expect(writes).toBe(1);
    expect(busy).toEqual([true, false]);
  });
  it("after the first run settles — success OR failure — the next call runs again", async () => {
    let writes = 0;
    const { run, isInFlight } = makeOneInFlight();
    await run(async () => { writes++; throw new Error("refused"); }).catch(() => {});
    expect(isInFlight()).toBe(false);
    await run(async () => { writes++; });
    expect(writes).toBe(2);
  });
  it("a blocked() gate (the card is done) refuses without running", async () => {
    let writes = 0;
    const { run } = makeOneInFlight({ blocked: () => true });
    expect(await run(async () => { writes++; })).toBe(false);
    expect(writes).toBe(0);
  });
});

describe("★ the card routes every booking through it and disables the controls while busy", () => {
  const src = fs.readFileSync("src/components/ClarificationFlow.jsx", "utf8").replace(/^[ \t]*\/\/.*$/gm, "");
  it("bookAnswer IS a run under the gate; the pill and free-text entries check it; the buttons read busy", () => {
    expect(src).toMatch(/const bookAnswer = \(finalInv, successText, audit = null\) => withOneBooking\(async \(\) => \{/);
    expect(src).toMatch(/const withOneBooking = \(fn\) => gate\.current\.run\(fn\);/);
    expect(src).toMatch(/if \(done \|\| inFlight\.current\) return;/);
    expect(src).toMatch(/if \(!text \|\| interpreting \|\| done \|\| inFlight\.current\) return;/);
    expect((src.match(/disabled=\{[^}]*\bbusy\b[^}]*\}/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});

// C402 — the keyed variant, and the three money-moving handlers that run under it.
describe("★★ makeKeyedInFlight", () => {
  it("a second press on the SAME key runs nothing; a different key runs alongside", async () => {
    const { makeKeyedInFlight } = await import("../src/lib/oneInFlight.js");
    let a = 0, b = 0;
    const { run } = makeKeyedInFlight();
    const p1 = run("bill-1", async () => { a++; return await later("x"); });
    const p2 = run("bill-1", async () => { a++; return await later("y"); });
    const p3 = run("bill-2", async () => { b++; return await later("z"); });
    expect(await p2).toBe(false);
    expect(await p1).toBe("x"); expect(await p3).toBe("z");
    expect([a, b]).toEqual([1, 1]);
    await run("bill-1", async () => { a++; });   // settled → admitted again
    expect(a).toBe(2);
  });
  it("markBillPaid, postPayroll and the Recurring screen's Post now are keyed runs (source)", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const markBillPaid = \(entryId, opts = \{\}\) => paymentsInFlight\.current\.run\(entryId, \(\) => markBillPaidOnce\(entryId, opts\)\);/);
    expect(app).toMatch(/const postPayroll = \(imp, opts = \{\}\) => payrollPostsInFlight\.current\.run\(/);
    const rec = fs.readFileSync("src/components/views/RecurringView.jsx", "utf8");
    expect(rec).toMatch(/const runRecurring = \(r\) => postsInFlight\.current\.run\(r\.id, \(\) => runRecurringOnce\(r\)\);/);
    // nothing calls the *Once bodies directly
    expect((app.match(/markBillPaidOnce\(/g) || []).length).toBe(1);
    expect((app.match(/postPayrollOnce\(/g) || []).length).toBe(1);
    expect((rec.match(/runRecurringOnce\(/g) || []).length).toBe(1);
  });
});

// C403 — the remaining handlers that move money or attest a month run under the same guard.
describe("★ every money-moving or attesting handler in ERP is a keyed run (source)", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  const GUARDED = [
    ["postContractEntry", "contract:"], ["postAllContractEntries", "contract:"], ["dismissMatch", "match:"], ["applyMatch", "match:"],
    ["confirmOpeningFromStatement", '"opening"'], ["postOpeningBalances", '"opening"'], ["signOffPeriod", "signoff:"],
    ["acceptRecurringSuggestion", "recurring-suggestion:"], ["reopenSignedPeriodAndBook", '"signed-hold"'], ["rebookHeldIntoOpenMonth", '"signed-hold"'], ["sendHeldToCPA", '"signed-hold"'],
  ];
  it("each wrapper runs its Once body under moneyMoves with its key, and nothing else calls the body", () => {
    for (const [fn, key] of GUARDED) {
      const wrapper = new RegExp(`const ${fn} = \\([^)]*\\) => moneyMoves\\.current\\.run\\(([^,]+), \\(\\) => ${fn}Once\\(`);
      const m = app.match(wrapper);
      expect(m, fn).toBeTruthy();
      expect(m[1], fn).toContain(key);
      expect((app.match(new RegExp(`${fn}Once\\(`, "g")) || []).length, fn).toBe(1);
    }
    expect(app).toMatch(/const moneyMoves = useRef\(makeKeyedInFlight\(\)\);/);
  });
  it("the three signed-month decisions share one key, so two different buttons cannot both act on one held entry", () => {
    for (const fn of ["reopenSignedPeriodAndBook", "rebookHeldIntoOpenMonth", "sendHeldToCPA"]) expect(app).toMatch(new RegExp(`const ${fn} = \\(\\) => moneyMoves\\.current\\.run\\("signed-hold"`));
  });
});
