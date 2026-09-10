import { describe, it, expect } from "vitest";
import fs from "node:fs";

// ════════════════════════════════════════════════════════════════════════════
// C318 — THE BULK-REMOVAL CONTROL AND THE CHECKBOXES THAT FILL IT.
//
// ★★★ C227 BUILT THE BUTTON AND SHIPPED IT INTO THE WRONG BRANCH. The action bar
// lived inside `{filter==="contracts" && …}`; the checkboxes that populate the
// selection are in the MAIN transactions table. So you could tick transactions and
// there was no button, while the button rendered only where there are no
// checkboxes — and §11 records exactly why that matters: remediating the O83
// double-book took scripted database access because the app "could only do one at
// a time". The control to fix that has existed, in the wrong place, ever since.
//
// ★★ IT WAS INVISIBLE FOR THE C195(7) REASON: in the contracts view `picked` is
// always empty, so the bar never drew, so nothing ever looked broken. A control
// whose input is always empty is indistinguishable from one with nothing to do.
//
// A unit test cannot click. What it CAN do is assert the two halves are in the
// same branch — which is the whole of what was wrong.
// ════════════════════════════════════════════════════════════════════════════

const SRC = fs.readFileSync(new URL("../src/components/views/BooksView.jsx", import.meta.url), "utf8").split("\n");

// Brace-matched extent of a JSX branch, by the line that opens it.
const extent = (pred) => {
  const start = SRC.findIndex(pred);
  expect(start).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = start; i < SRC.length; i++) {
    depth += (SRC[i].match(/\{/g) || []).length - (SRC[i].match(/\}/g) || []).length;
    if (depth === 0 && i > start) return [start, i];
  }
  throw new Error("unterminated branch");
};
const lineOf = (needle) => SRC.findIndex((l) => l.includes(needle));

describe("a selection you can make is a selection you can act on", () => {
  const contracts = extent((l) => l.includes('cockpit && filter==="contracts"'));
  const main = extent((l) => l.trim() === '{filter!=="contracts" && (<>');

  it("★★ the bulk-removal bar sits in the SAME branch as the checkboxes", () => {
    const bar = lineOf("picked.size > 0 &&");
    const boxes = SRC.map((l, i) => (l.includes('type="checkbox"') ? i : -1)).filter((i) => i >= 0);
    expect(boxes.length).toBeGreaterThanOrEqual(2);          // header "select all" + per row
    const inMain = (i) => i > main[0] && i < main[1];
    expect([bar, inMain(bar)]).toEqual([bar, true]);
    for (const b of boxes) expect([b, inMain(b)]).toEqual([b, true]);
  });

  it("★ and NOT in the contracts branch, which has no checkboxes to fill it", () => {
    const bar = lineOf("picked.size > 0 &&");
    expect(bar > contracts[0] && bar < contracts[1]).toBe(false);
    const contractsSrc = SRC.slice(contracts[0], contracts[1]).join("\n");
    expect(contractsSrc).not.toMatch(/type="checkbox"/);
    expect(contractsSrc).not.toMatch(/softDeleteInvoices/);
  });

  it("★★ a selection does not outlive the list it was made in", () => {
    // `picked` is component state. Without this, ticking three rows and switching to
    // Contracts DREW the bar — "3 selected", over a table those rows are not in.
    expect(SRC.join("\n")).toMatch(/React\.useEffect\(\(\) => \{ setPicked\(new Set\(\)\); \}, \[filter\]\)/);
  });

  it("★ removal still goes through the planner and the confirm, not straight to the write", () => {
    // The bar moved; what it does must not have. `planBulkRemoval` is what refuses rows in a
    // signed month and names what will be LEFT BEHIND before anything happens.
    const src = SRC.join("\n");
    expect(src).toMatch(/const plan = planBulkRemoval\(chosen, signoffs \|\| \[\], \{ monthLabel: signedMonthLabel \}\)/);
    expect(src).toMatch(/if \(!plan\.removable\.length\)/);
    expect(src).toMatch(/setDeleteConfirm\(\{/);
    expect(src).toMatch(/onConfirm: async \(\) => \{ await softDeleteInvoices\(plan\.removable\)/);
  });
});
