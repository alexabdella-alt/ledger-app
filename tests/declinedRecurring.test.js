import { describe, it, expect } from "vitest";
import fs from "fs";
import { readDeclinedRecurring, writeDeclinedRecurring, declinedRecurringKey } from "../src/lib/declinedRecurring.js";

// C389 — "No thanks" on a recurring suggestion survives a reload (on this device).
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };

describe("★ the declined set round-trips through storage, per company", () => {
  it("write then read gives the same keys; another company reads nothing", () => {
    const st = mem();
    writeDeclinedRecurring(st, "c1", new Set(["bluebonnet linen", "sysco"]));
    expect([...readDeclinedRecurring(st, "c1")].sort()).toEqual(["bluebonnet linen", "sysco"]);
    expect(readDeclinedRecurring(st, "c2").size).toBe(0);
    expect(declinedRecurringKey("c1")).not.toBe(declinedRecurringKey("c2"));
  });
  it("a missing, throwing or corrupt storage degrades to nothing declined — never a throw", () => {
    expect(readDeclinedRecurring(null, "c1").size).toBe(0);
    expect(readDeclinedRecurring({ getItem: () => { throw new Error("private mode"); } }, "c1").size).toBe(0);
    expect(readDeclinedRecurring({ getItem: () => "{not json" }, "c1").size).toBe(0);
    expect(readDeclinedRecurring({ getItem: () => JSON.stringify([1, null, "ok"]) }, "c1").has("ok")).toBe(true);
    expect(writeDeclinedRecurring({ setItem: () => { throw new Error("quota"); } }, "c1", new Set(["x"]))).toBe(false);
  });
});

describe("★ App reads the set before every scan and writes it on 'No thanks' (source)", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  it("the scan folds the stored keys into the filter, and the dismiss writes them", () => {
    const scan = app.slice(app.indexOf("const runRecurringScan = () => {"), app.indexOf("const scheduleRecurringScan"));
    expect(scan.indexOf("readDeclinedRecurring(")).toBeGreaterThan(-1);
    expect(scan.indexOf("readDeclinedRecurring(")).toBeLessThan(scan.indexOf("detectRecurringPatterns("));
    // the stored keys must reach the filter: read → folded into the ref → the ref IS the filter
    expect(scan).toMatch(/const stored = readDeclinedRecurring\([\s\S]*?for \(const k of stored\) dismissedRecurringRef\.current\.add\(k\);[\s\S]*?const declined = dismissedRecurringRef\.current;[\s\S]*?\.filter\(s => !declined\.has\(s\.vendorKey\)\)/);
    const d0 = app.indexOf("const dismissRecurringSuggestion = ");
    const dismiss = app.slice(d0, app.indexOf("// ── BANK ACCOUNTS", d0));   // end anchor searched FROM the start (C238's lesson)
    expect(dismiss.length).toBeGreaterThan(100);
    expect(dismiss).toMatch(/if \(!remindLater\) \{[\s\S]*?writeDeclinedRecurring\(/);
  });
});
