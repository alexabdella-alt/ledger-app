import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { DEMO_VENDORS, demoEntries, demoMonthEvents, demoSummary } from "../tools/demoCompany.js";
import { computeNetIncome, computeRevenue, computeExpenses } from "../src/lib/reports.js";
import { flattenJournalEntries } from "../src/lib/ledger.js";

const entries = demoEntries({ year: 2026, months: 3 });

describe("the demo company's books tie", () => {
  it("★★ every entry balances, and so does the whole set — the one thing that would actually embarrass", () => {
    // Each entry on its own…
    for (const e of entries) {
      const d = e.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
      const c = e.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
      expect(Math.abs(d - c)).toBeLessThan(0.005);
      expect(e.balanced).toBe(true);
    }
    // …and the whole set. A set can tie in aggregate while holding two entries wrong in
    // opposite directions, so the per-entry check above is not redundant with this one.
    const s = demoSummary(entries);
    expect(s.balanced).toBe(true);
    expect(s.debits).toBeCloseTo(s.credits, 2);
  });

  it("covers three consecutive months with real volume", () => {
    const s = demoSummary(entries);
    expect(s.months.length).toBe(3);
    expect(s.entries).toBeGreaterThan(100);
  });

  it("★ deterministic — the same call twice gives byte-identical books", () => {
    // A demo you cannot rehearse, and a drive you cannot re-run and compare, are both
    // worth much less. No Math.random, no Date.now.
    expect(JSON.stringify(demoEntries({ year: 2026, months: 3 }))).toBe(JSON.stringify(entries));
  });

  it("★★ and it is deterministic BY CONSTRUCTION, not by luck", () => {
    const src = readFileSync("tools/demoCompany.js", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/Math\.random|Date\.now|new Date\(\)/);
  });

  it("★★ the entries come from the PRODUCT's builder, not from hand-written lines", () => {
    // A fixture with its own idea of double-entry proves nothing about the product — the
    // ·3a shape, where both sides agree with each other and neither agrees with the app.
    const src = readFileSync("tools/demoCompany.js", "utf8");
    expect(src).toMatch(/import \{ buildJournalEntry \} from "\.\.\/src\/lib\/journalEntries\.js"/);
  });
});

describe("the demo reads like a real restaurant", () => {
  it("it is profitable — a demo that shows a failing business is a strange sales asset", () => {
    const invoices = flattenJournalEntries(entries.map((e, i) => ({
      id: `d${i}`, company_id: "demo", entry_date: e.date, description: e.description,
      source: e.source, status: "posted", deleted_at: null,
      journal_entry_lines: e.lines.map((l, j) => ({
        id: `d${i}l${j}`, account_id: `a_${l.code}`, debit: l.debit, credit: l.credit,
        accounts: { code: l.code, name: `Account ${l.code}` },
      })),
    })));
    expect(computeRevenue(invoices)).toBeGreaterThan(0);
    expect(computeExpenses(invoices)).toBeGreaterThan(0);
    expect(computeNetIncome(invoices)).toBeGreaterThan(0);
  });

  it("★ carries a genuinely flat weekly vendor — the hard case the product is built around", () => {
    // Bluebonnet at exactly £145 every week is the O117/O127 population: amount and identity
    // carry no information, so any demo that omits it is showing the easy path only.
    const flat = DEMO_VENDORS.find((v) => v.vary === 0 && v.cadence === "weekly");
    expect(flat).toBeTruthy();
    const events = demoMonthEvents({ year: 2026, month: 1, codes: {} })
      .filter((e) => e.vendor === flat.name);
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(new Set(events.map((e) => e.amount)).size).toBe(1);   // identical to the cent
  });

  it("bills are paid LATER, so Payables is not permanently empty", () => {
    const bills = entries.filter((e) => /– supplies/.test(e.description));
    const pays = entries.filter((e) => /^Payment – /.test(e.description));
    expect(bills.length).toBe(pays.length);
    expect(bills.length).toBeGreaterThan(20);
  });

  it("payroll runs twice a month at the shape the auto-post gate expects", () => {
    const runs = entries.filter((e) => /^Gusto Payroll/.test(e.description));
    expect(runs.length).toBe(6);
    for (const r of runs) expect(r.lines.length).toBe(4);
  });
});

describe("★★ the numbers are shaped like a restaurant, not merely balanced", () => {
  const inv = flattenJournalEntries(entries.map((x, i) => ({
    id: `d${i}`, company_id: "demo", entry_date: x.date, description: x.description, source: x.source,
    status: "posted", deleted_at: null,
    journal_entry_lines: x.lines.map((l, j) => ({
      id: `d${i}l${j}`, account_id: `a_${l.code}`, debit: l.debit, credit: l.credit,
      accounts: { code: l.code, name: l.code },
    })),
  })));
  const revenue = computeRevenue(inv);
  const net = computeNetIncome(inv);
  const margin = net / revenue;

  it("★★★ net margin is believable for an independent restaurant", () => {
    // The first version of this generator tied perfectly and showed a 54% margin. Balanced
    // books are necessary and NOT sufficient for a demo: a figure no restaurateur recognises
    // says we do not understand their business, which is worse than showing nothing.
    // Real independents run roughly 3-12%; the band is generous, the old 54% is nowhere near.
    expect(margin).toBeGreaterThan(0.02);
    expect(margin).toBeLessThan(0.16);
  });

  const share = (codePrefix) => {
    let total = 0;
    for (const e of entries) for (const l of e.lines) {
      if (String(l.code).startsWith(codePrefix)) total += Number(l.debit) || 0;
    }
    return total / revenue;
  };

  it("★ food cost is about a third of sales", () => {
    const cogs = share("5000");
    expect(cogs).toBeGreaterThan(0.25);
    expect(cogs).toBeLessThan(0.38);
  });

  it("★ labour is about a third of sales", () => {
    const labour = share("6000") + share("6010");
    expect(labour).toBeGreaterThan(0.24);
    expect(labour).toBeLessThan(0.38);
  });

  it("★ and the costs are spread across many accounts, not two", () => {
    // A P&L with three lines on it looks like a fixture. A demo has to survive being read.
    const codes = new Set();
    for (const e of entries) for (const l of e.lines) if (/^[5-8]/.test(String(l.code))) codes.add(l.code);
    expect(codes.size).toBeGreaterThanOrEqual(8);
  });
});

describe("tools/ is not part of the app", () => {
  it("★ nothing in src/ imports the demo generator — it must never reach the bundle", () => {
    const walk = (d) => require("fs").readdirSync(d, { withFileTypes: true }).flatMap((f) =>
      f.isDirectory() ? walk(`${d}/${f.name}`) : [`${d}/${f.name}`]);
    const offenders = walk("src")
      .filter((f) => /\.(js|jsx)$/.test(f))
      .filter((f) => /from\s+["'][^"']*tools\//.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
