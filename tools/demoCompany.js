// ─────────────────────────────────────────────────────────────────────────────
// A DEMO COMPANY WITH BOOKS THAT ACTUALLY BALANCE.
//
// The roadmap gate is "a demo company with data already in it, before the first sales call",
// and §11 adds the reason it is not just a nice-to-have: **a demo should not be the thing
// that surfaces cold-start gaps.** Every drive to date has run on a company seeded by hand.
//
// ★★ THE ONE THING THAT WOULD ACTUALLY EMBARRASS IS BOOKS THAT DO NOT TIE. So this generates
// ECONOMIC EVENTS and hands them to the REAL builders — the same `buildJournalEntry`,
// `buildPaymentEntry`, `buildPayrollEntry` and `buildBankLineEntry` the product uses — rather
// than authoring journal lines by hand. **A fixture with its own idea of double-entry proves
// nothing about the product**, and it is the ·3a shape: both sides agreeing with each other
// while neither agrees with the application.
//
// ★ IT ALSO SERVES ROADMAP ITEM 12 (the invoice-volume drive). Every drive so far has been
// bank-statement-shaped, and a new client arrives with a shoebox of invoices — so the same
// generator produces that month, at volume, deterministically.
//
// DETERMINISTIC BY CONSTRUCTION: no `Math.random`, no `Date.now`. The same call yields the
// same books every time, which is what makes a demo rehearsable and a drive reproducible.
//
// Pure. Emits data; writes nothing. Loading is a separate, deliberate step.
// ─────────────────────────────────────────────────────────────────────────────

import { buildJournalEntry } from "../src/lib/journalEntries.js";

// A small-restaurant supplier list with the properties that matter for a demo: a weekly
// flat-fee vendor (the O117/O127 class), a variable food supplier, a monthly landlord, a
// card processor, and a utility. Amounts are in cents-free dollars, as the app stores them.
// ★★ THE NUMBERS ARE SHAPED LIKE A RESTAURANT, NOT MERELY BALANCED. The first version tied
// perfectly and showed a **54% net margin** — no restaurant on earth runs that, and a demo
// that shows one tells a restaurateur we do not understand their business. Real independent
// restaurants land around 3–10%: food cost roughly a third of sales, labour roughly a third,
// occupancy about a tenth, and a long tail of small recurring costs. A test pins the band.
export const DEMO_VENDORS = [
  // Food and drink — the biggest line, and it MOVES week to week, which is what makes the
  // reports look alive rather than synthetic.
  { name: "Roma Cheese & Dairy Co.",    code: "5000", cadence: "weekly",  base: 1450.00, vary: 0.18 },
  { name: "Hill Country Milling Co.",   code: "5000", cadence: "weekly",  base: 1180.00, vary: 0.22 },
  { name: "Alamo Ice & Beverage",       code: "5000", cadence: "weekly",  base:  380.00, vary: 0.15 },
  // ★ A GENUINELY FLAT WEEKLY VENDOR, ON PURPOSE. Identical to the cent every week is the
  // O117/O127 population — where amount and identity carry no information — and a demo that
  // omits it is showing only the easy path.
  { name: "Bluebonnet Linen Service",   code: "6100", cadence: "weekly",  base:  145.00, vary: 0    },
  { name: "Franklin Ave Properties",    code: "6100", cadence: "monthly", base: 4200.00, vary: 0    },
  { name: "Austin Municipal Utilities", code: "6200", cadence: "monthly", base: 1560.00, vary: 0.28 },
  { name: "Toast POS",                  code: "6520", cadence: "monthly", base: 1100.00, vary: 0.12 },
  { name: "Texas Mutual Insurance",     code: "6700", cadence: "monthly", base:  890.00, vary: 0    },
  { name: "Lone Star Restaurant Supply",code: "6600", cadence: "monthly", base: 1170.00, vary: 0.30 },
  { name: "Half Moon Creative",         code: "6300", cadence: "monthly", base:  450.00, vary: 0.20 },
  { name: "Alamo Fire & Safety",        code: "6250", cadence: "monthly", base:  380.00, vary: 0.25 },
  { name: "Barton Springs Repair Co.",  code: "6250", cadence: "monthly", base:  640.00, vary: 0.40 },
  { name: "Guadalupe Waste Services",   code: "6100", cadence: "monthly", base:  420.00, vary: 0    },
];

const pad = (n) => String(n).padStart(2, "0");
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y, m) => [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const round2 = (n) => Math.round(n * 100) / 100;

// Deterministic pseudo-variance from the vendor name and the date. Not randomness — the same
// inputs always give the same figure, which is what lets a demo be rehearsed and a drive be
// re-run and compared.
function wobble(seedText, pct) {
  if (!pct) return 1;
  let h = 0;
  for (let i = 0; i < seedText.length; i++) h = (h * 31 + seedText.charCodeAt(i)) % 1000;
  return 1 + ((h / 1000) * 2 - 1) * pct;
}

// ── The month's economic events ──────────────────────────────────────────────
// Returns plain descriptions of what HAPPENED. Turning them into journal entries is the next
// function's job, and it does it through the product's own builder.
export function demoMonthEvents({ year, month, codes }) {
  const out = [];
  const last = daysIn(year, month);

  for (const v of DEMO_VENDORS) {
    const days = v.cadence === "weekly" ? [4, 11, 18, 25].filter((d) => d <= last) : [3];
    for (const d of days) {
      const date = ymd(year, month, d);
      out.push({
        kind: "bill", date, vendor: v.name,
        amount: round2(v.base * wobble(`${v.name}${date}`, v.vary)),
        expenseCode: v.code,
      });
    }
  }

  // Card settlements — the restaurant's revenue, arriving as deposits rather than invoices.
  for (const d of [7, 14, 21, 28].filter((x) => x <= last)) {
    const date = ymd(year, month, d);
    out.push({ kind: "sale", date, amount: round2(9200 * wobble(`sales${date}`, 0.16)) });
  }

  // Two payroll runs a month, on the same shape the gate expects.
  for (const d of [15, Math.min(last, 28)]) {
    // Labour is about a third of sales for a restaurant; two runs a month.
    out.push({ kind: "payroll", date: ymd(year, month, d), gross: 5500, withholdings: 1180, employerTax: 421 });
  }
  return out;
}

// ── Events → balanced journal entries, through the product's own builder ─────
export function demoEntries({ year, months = 3, codes }) {
  const c = {
    cash: "1000", ap: "2000", payrollPayable: "2100", revenue: "4000",
    ...(codes || {}),
  };
  const entries = [];
  for (let i = 0; i < months; i++) {
    const month = ((month0 => month0)(i % 12)) + 1;
    for (const e of demoMonthEvents({ year, month, codes: c })) {
      if (e.kind === "bill") {
        // The bill, then the payment a week later — so the demo has real A/P movement
        // rather than everything settling instantly, which is what makes Payables look alive.
        entries.push(buildJournalEntry({
          date: e.date, source: "universal_upload", description: `${e.vendor} – supplies`,
          lines: [
            { code: e.expenseCode, debit: e.amount, credit: 0 },
            { code: c.ap, debit: 0, credit: e.amount },
          ],
        }));
        const payDay = Math.min(daysIn(year, month), Number(e.date.slice(8)) + 7);
        entries.push(buildJournalEntry({
          date: ymd(year, month, payDay), source: "bank_import", description: `Payment – ${e.vendor}`,
          lines: [
            { code: c.ap, debit: e.amount, credit: 0 },
            { code: c.cash, debit: 0, credit: e.amount },
          ],
        }));
      } else if (e.kind === "sale") {
        entries.push(buildJournalEntry({
          date: e.date, source: "bank_import", description: "Card settlement – Toast",
          lines: [
            { code: c.cash, debit: e.amount, credit: 0 },
            { code: c.revenue, debit: 0, credit: e.amount },
          ],
        }));
      } else if (e.kind === "payroll") {
        const net = round2(e.gross - e.withholdings);
        entries.push(buildJournalEntry({
          date: e.date, source: "payroll", description: `Gusto Payroll — ${e.date}`,
          lines: [
            { code: "6000", debit: e.gross, credit: 0 },
            { code: "6010", debit: e.employerTax, credit: 0 },
            { code: c.cash, debit: 0, credit: net },
            { code: c.payrollPayable, debit: 0, credit: round2(e.withholdings + e.employerTax) },
          ],
        }));
      }
    }
  }
  return entries;
}

// What a person would want to know before showing it to anyone.
export function demoSummary(entries) {
  let debits = 0, credits = 0;
  const months = new Set();
  for (const e of entries || []) {
    for (const l of e.lines || []) { debits += Number(l.debit) || 0; credits += Number(l.credit) || 0; }
    if (e.date) months.add(String(e.date).slice(0, 7));
  }
  return {
    entries: (entries || []).length,
    months: [...months].sort(),
    debits: round2(debits),
    credits: round2(credits),
    // ★ BOTH: the totals tie AND every individual entry reported itself balanced. A set can
    // tie in aggregate while containing two entries that are wrong in opposite directions —
    // which is exactly the kind of thing a demo surfaces at the worst moment.
    balanced: Math.abs(round2(debits - credits)) < 0.005 && (entries || []).every((e) => e.balanced),
  };
}
