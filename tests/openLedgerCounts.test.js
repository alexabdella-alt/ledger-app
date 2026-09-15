import { describe, it, expect } from "vitest";
import fs from "node:fs";
// The OPEN LEDGER's printed counts must equal the rows beneath them. ROADMAP.md says the counts
// are derived; they were typed, and two headers drifted (After launch 10 vs 9, unproven 5 vs 6).
describe("OPEN LEDGER counts", () => {
  const md = fs.readFileSync("ROADMAP.md", "utf8");
  const ledger = md.slice(md.indexOf("## OPEN LEDGER"), md.indexOf("## SECTION 0"));
  const sections = [...ledger.matchAll(/^### (.+?) — (\d+) open/gm)].map((m) => ({ title: m[1], printed: Number(m[2]), at: m.index }));
  it("every section header's count equals its open rows", () => {
    const out = sections.map((s, i) => {
      const end = i + 1 < sections.length ? sections[i + 1].at : ledger.indexOf("### RECENTLY SHIPPED");
      const rows = (ledger.slice(s.at, end).match(/^- \[ \]/gm) || []).length;
      return `${s.title}: printed ${s.printed}, rows ${rows}`;
    });
    expect(out.filter((l) => !/printed (\d+), rows \1$/.test(l))).toEqual([]);
    expect(sections.length).toBeGreaterThanOrEqual(5);
  });
  it("the TOTAL equals the sum of the sections", () => {
    const total = Number((ledger.match(/\*\*TOTAL OPEN: (\d+)\*\*/) || [])[1]);
    const sum = sections.reduce((n, s) => n + s.printed, 0);
    expect(total).toBe(sum);
  });
});
