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
