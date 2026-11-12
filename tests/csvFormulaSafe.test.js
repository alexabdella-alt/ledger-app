import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { csvSafe, toCSV } from "../src/lib/insights";
import { auditCsv } from "../src/lib/auditTrail";

// C632 — review finding S10: CSV exports did not neutralise formula cells.
describe("formula cells are shown as text", () => {
  it.each([["=HYPERLINK(\"http://x\",\"Invoice\")", "'=HYPERLINK(\"http://x\",\"Invoice\")"], ["+1+1", "'+1+1"], ["@SUM(A1)", "'@SUM(A1)"], ["-2+3", "'-2+3"], ["\tcmd", "'\tcmd"]])("%s", (v, want) => {
    expect(csvSafe(v)).toBe(want);
  });
  it("★ numbers — including negative ones — stay numbers", () => {
    expect(["-54.99", "1200", "+3", "0.5"].map(csvSafe)).toEqual(["-54.99", "1200", "+3", "0.5"]);
  });
  it("ordinary text is untouched", () => {
    expect(csvSafe("Ace Plumbing")).toBe("Ace Plumbing");
  });
  it("★ the shared writer and the audit export both use it", () => {
    expect(toCSV(["Vendor"], [["=cmd|' /C calc'!A0"]]).split("\n")[1]).toBe("'=cmd|' /C calc'!A0");
    expect(auditCsv([{ ts: "2026-01-01T00:00:00", action: "x", detail: "=1+1", user: "me" }]).split("\n")[1]).toMatch(/"'=1\+1"/);
  });
});

describe("no screen builds its own CSV", () => {
  it("★ nothing in the views joins cells with commas by hand", () => {
    const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    const offenders = walk("src/components").filter((f) => /\.jsx?$/.test(f)).filter((f) => /\.map\([^)]*\)\.join\(","\)\)\.join\("\\n"\)|r\.join\(","\)\)\.join/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
