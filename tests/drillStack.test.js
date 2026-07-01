import { describe, it, expect } from "vitest";
import { emptyDrill, push, back, forward, jumpTo, reset, current, depth, canBack, canForward, breadcrumb } from "../src/lib/drillStack.js";

const L1 = { type: "cash" };
const L2 = { type: "month", month: "2026-02" };
const L3 = { type: "txn", id: "t1" };

// Build a 3-deep stack.
const three = () => push(push(push(emptyDrill(), L1), L2), L3);

describe("drillStack — onion-layer nav (push / back / forward / jump / breadcrumb)", () => {
  it("push drills IN one layer at a time", () => {
    const s = three();
    expect(depth(s)).toBe(3);
    expect(current(s)).toEqual(L3);
    expect(s.stack).toEqual([L1, L2, L3]);
  });

  it("BACK pops exactly ONE layer each time — 3 → 2 → 1 → top, NEVER skipping to top", () => {
    let s = three();
    s = back(s); expect(depth(s)).toBe(2); expect(current(s)).toEqual(L2);   // level 2 (where we just were)
    s = back(s); expect(depth(s)).toBe(1); expect(current(s)).toEqual(L1);   // level 1
    s = back(s); expect(depth(s)).toBe(0); expect(current(s)).toBeNull();    // the top / screen (one more step out)
    s = back(s); expect(depth(s)).toBe(0);                                    // no-op past the top
  });

  it("FORWARD re-advances a popped layer (browser-style), one at a time", () => {
    let s = back(back(three()));   // popped L3 then L2 → at L1, forward = [L2, L3]
    expect(current(s)).toEqual(L1);
    expect(canForward(s)).toBe(true);
    s = forward(s); expect(current(s)).toEqual(L2); expect(depth(s)).toBe(2);
    s = forward(s); expect(current(s)).toEqual(L3); expect(depth(s)).toBe(3);
    expect(canForward(s)).toBe(false);
  });

  it("pushing a NEW layer after going back abandons forward history (new branch)", () => {
    let s = back(three());          // at L2, forward = [L3]
    expect(canForward(s)).toBe(true);
    const NEW = { type: "vendor", vendor: "Acme" };
    s = push(s, NEW);
    expect(current(s)).toEqual(NEW);
    expect(canForward(s)).toBe(false);   // L3 is no longer re-advanceable
    expect(s.stack).toEqual([L1, L2, NEW]);
  });

  it("breadcrumb reflects the full path (root + each layer), jumpTo lands on any level", () => {
    const s = three();
    const crumbs = breadcrumb(s, (l) => l.type, "Dashboard");
    expect(crumbs.map(c => c.label)).toEqual(["Dashboard", "cash", "month", "txn"]);
    expect(crumbs.map(c => c.index)).toEqual([-1, 0, 1, 2]);
    // jump to the first drill level (index 0) → truncates to L1, clears forward
    const j = jumpTo(s, 0);
    expect(depth(j)).toBe(1); expect(current(j)).toEqual(L1); expect(canForward(j)).toBe(false);
    // jump to root (index -1) → exits the drill entirely
    expect(depth(jumpTo(s, -1))).toBe(0);
  });

  it("canBack is true whenever there's a drill layer (back is always one step, never a jump-to-top)", () => {
    expect(canBack(emptyDrill())).toBe(false);          // at the top → no back (use the main nav tabs)
    expect(canBack(push(emptyDrill(), L1))).toBe(true); // one level deep → back exits to the screen
    expect(canBack(three())).toBe(true);
  });

  it("reset / defensive: handles empty + out-of-range safely", () => {
    expect(reset()).toEqual({ stack: [], forward: [] });
    expect(depth(jumpTo(three(), 99))).toBe(3);   // out of range → unchanged
    expect(current(emptyDrill())).toBeNull();
    expect(canForward(emptyDrill())).toBe(false);
  });
});
