import { describe, it, expect } from "vitest";
import { addDaysYMD, addMonthsClampedYMD, deriveDueDate, todayLocal } from "../src/lib/format.js";
import { periodOf, signedPeriodForDate } from "../src/lib/signedPeriod.js";
import { fiscalYearStart } from "../src/lib/reports.js";

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ DATES, SWEPT — the axis this codebase has been bitten on most.
//
// The helpers carry the scars in their comments: never `toISOString()` (a user behind UTC
// rolls into the next day, and on a month boundary the next PERIOD); clamp Jan 31 + 1 month to
// Feb 28 rather than overflowing to Mar 3. Those lessons are applied by careful reasoning at a
// handful of call sites. **This is the same reasoning checked at every value.**
//
// ★★ IT MATTERS BECAUSE `signedPeriodForDate` GATES EVERY WRITE INTO A SIGNED MONTH. A date
// landing one day out at a month boundary is the difference between a booking being allowed
// and being refused — or worse, allowed into a month an accountant has put their name to.
// ─────────────────────────────────────────────────────────────────────────────

const YEARS = [2024, 2025, 2026, 2027, 2028];   // includes leap and non-leap
const days = (y, m) => new Date(y, m, 0).getDate();
const allDates = (() => {
  const out = [];
  for (const y of YEARS) for (let m = 1; m <= 12; m++) for (const d of [1, 2, 14, 15, 28, days(y, m) - 1, days(y, m)]) {
    if (d >= 1) out.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
  }
  return [...new Set(out)];
})();

describe("★★★ adding months never overflows and never loses a day", () => {
  it(`clamps correctly across ${allDates.length} dates × 0-36 months`, () => {
    let checked = 0;
    for (const start of allDates) {
      const [sy, sm, sd] = start.split("-").map(Number);
      for (let k = 0; k <= 36; k++) {
        const got = addMonthsClampedYMD(start, k);
        const [gy, gm, gd] = got.split("-").map(Number);
        // The month advanced by exactly k — never k±1, which is what an overflow looks like.
        const expectedMonthIndex = (sy * 12 + (sm - 1)) + k;
        if (gy * 12 + (gm - 1) !== expectedMonthIndex) throw new Error(`${start} +${k} → ${got}: landed in the wrong month`);
        // The day is the start day, or the target month's last day when the start day does not exist there.
        const last = days(gy, gm);
        if (gd !== Math.min(sd, last)) throw new Error(`${start} +${k} → ${got}: expected day ${Math.min(sd, last)}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(9000);
  });

  it("★ the classic: month-end into a shorter month, including February in a leap year", () => {
    expect(addMonthsClampedYMD("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsClampedYMD("2024-01-31", 1)).toBe("2024-02-29");   // leap
    expect(addMonthsClampedYMD("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonthsClampedYMD("2026-12-31", 1)).toBe("2027-01-31");   // year boundary
  });

  it("★ a month-end start does NOT become sticky — Jan 31 +2 is Mar 31, not Feb 28 carried forward", () => {
    // Clamping must be computed from the ORIGINAL day each time. A schedule that clamped
    // cumulatively would drift every asset and lease onto the 28th forever.
    expect(addMonthsClampedYMD("2026-01-31", 2)).toBe("2026-03-31");
    expect(addMonthsClampedYMD("2026-01-31", 3)).toBe("2026-04-30");
  });
});

describe("★★ adding days round-trips exactly", () => {
  it("forward then back returns the original date, across every sweep date", () => {
    let checked = 0;
    for (const d of allDates) {
      for (const n of [1, 7, 30, 31, 90, 365, 366]) {
        const there = addDaysYMD(d, n);
        const back = addDaysYMD(there, -n);
        if (back !== d) throw new Error(`${d} +${n} → ${there} → ${back} (lost a day)`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it("★ crosses month and year boundaries the obvious way", () => {
    expect(addDaysYMD("2026-02-01", -1)).toBe("2026-01-31");
    expect(addDaysYMD("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysYMD("2024-02-28", 1)).toBe("2024-02-29");            // leap
    expect(addDaysYMD("2025-02-28", 1)).toBe("2025-03-01");            // non-leap
  });

  it("bad input is null rather than a guessed date", () => {
    expect(addDaysYMD(null, 1)).toBe(null);
    expect(addDaysYMD("", 1)).toBe(null);
    expect(addDaysYMD("not-a-date", 1)).toBe(null);
  });
});

describe("★★★ a date never lands in a neighbouring period", () => {
  it("every date maps to its OWN month — the gate on signed months depends on it", () => {
    for (const d of allDates) {
      const [y, m] = d.split("-");
      if (periodOf(d) !== `${y}-${m}`) throw new Error(`${d} → ${periodOf(d)}`);
    }
    expect(allDates.length).toBeGreaterThan(300);
  });

  it("★★ the first and last day of a signed month are BOTH inside it", () => {
    // An off-by-one here either lets a booking into an attested month or refuses one that
    // belongs in the next — and both surface only when someone tries to do their job.
    for (const y of YEARS) for (let m = 1; m <= 12; m++) {
      const p = `${y}-${String(m).padStart(2, "0")}`;
      const signoffs = [{ period: p, revoked_at: null }];
      const first = `${p}-01`;
      const last = `${p}-${String(days(y, m)).padStart(2, "0")}`;
      expect(signedPeriodForDate(first, signoffs)).toBe(p);
      expect(signedPeriodForDate(last, signoffs)).toBe(p);
      // …and the days either side are NOT.
      expect(signedPeriodForDate(addDaysYMD(first, -1), signoffs)).toBe(null);
      expect(signedPeriodForDate(addDaysYMD(last, 1), signoffs)).toBe(null);
    }
    expect(YEARS.length).toBe(5);
  });

  it("★ a revoked sign-off does not gate anything", () => {
    expect(signedPeriodForDate("2026-03-15", [{ period: "2026-03", revoked_at: "2026-04-01" }])).toBe(null);
  });

  it("★ opening balances are exempt at every date — the cutoff may sit inside an attested month", () => {
    for (const d of allDates.slice(0, 60)) {
      expect(signedPeriodForDate(d, [{ period: periodOf(d), revoked_at: null }], { source: "opening_balance" })).toBe(null);
    }
    expect(allDates.length).toBeGreaterThan(300);
  });
});

describe("★★ the fiscal year starts where it should, for every year-end", () => {
  it("across 12 year-ends × every sweep date, the start is always on or before the as-of and within a year of it", () => {
    let checked = 0;
    for (const asOf of allDates) {
      for (let m = 1; m <= 12; m++) {
        const fye = `${String(m).padStart(2, "0")}-${String(days(2026, m)).padStart(2, "0")}`;
        const start = fiscalYearStart(asOf, fye);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(start))) throw new Error(`fye ${fye}, asOf ${asOf} → ${start}`);
        if (start > asOf) throw new Error(`fye ${fye}: start ${start} is AFTER as-of ${asOf}`);
        const daysApart = (new Date(asOf + "T00:00:00") - new Date(start + "T00:00:00")) / 86400000;
        if (daysApart > 366) throw new Error(`fye ${fye}, asOf ${asOf}: start ${start} is ${daysApart} days back — more than a year`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(4000);
  });
});

describe("payment terms produce a date on or after the invoice", () => {
  it("never lands before the invoice date, whatever the terms", () => {
    for (const d of allDates.slice(0, 120)) {
      for (const terms of ["Net 30", "Net 15", "Net 60", "Due on receipt", "", null, "nonsense"]) {
        const due = deriveDueDate(d, terms);
        if (due && due < d) throw new Error(`${d} + "${terms}" → ${due} (before the invoice)`);
      }
    }
    expect(deriveDueDate("2026-01-31", "Net 30")).toBe("2026-03-02");
  });
});

describe("today is read from local components, never UTC", () => {
  it("★ matches the local calendar date — a UTC read rolls a late-evening booking into the next month", () => {
    const d = new Date();
    expect(todayLocal()).toBe(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★★★ AND THE SWEEP ABOVE IS ONLY AS GOOD AS THE MACHINE'S TIMEZONE.
//
// Found by mutation: switching `ymdLocal` to `toISOString().slice(0,10)` — the EXACT mistake
// its comment warns against — leaves every test above GREEN on a UTC machine, and on any
// machine behind UTC. It fails only from a zone AHEAD of UTC, because a Date built from local
// components at midnight reads back as the PREVIOUS day in UTC.
//
// ★★ CI RUNS UTC. So the guard for the bug this file exists to catch would have been inert
// exactly where it matters — the "guard whose input is always empty" shape, in a test written
// to prevent it. These assertions force the timezone instead of hoping for one.
// ─────────────────────────────────────────────────────────────────────────────
describe("★★★ the date helpers hold from timezones AHEAD of UTC, not just the host's", () => {
  const AHEAD = ["Pacific/Auckland", "Pacific/Chatham", "Asia/Tokyo", "Europe/Berlin"];
  const original = process.env.TZ;

  it("★ a local-midnight date reads back as the same calendar day from every zone", () => {
    try {
      for (const tz of AHEAD) {
        process.env.TZ = tz;
        // Sanity: the change actually took, or this whole block proves nothing.
        expect(new Date(2026, 0, 31).getTimezoneOffset()).not.toBe(0);
        for (const start of ["2026-01-31", "2026-12-31", "2024-02-29", "2026-06-30"]) {
          for (const k of [0, 1, 2, 12]) {
            const got = addMonthsClampedYMD(start, k);
            const [, gm, gd] = got.split("-").map(Number);
            const [, sm, sd] = start.split("-").map(Number);
            const expectedMonth = ((sm - 1 + k) % 12) + 1;
            if (gm !== expectedMonth) throw new Error(`${tz}: ${start} +${k} → ${got} (month drifted)`);
            if (gd < 1 || gd > 31) throw new Error(`${tz}: ${start} +${k} → ${got} (impossible day)`);
            // The day may only shrink to fit the month — never move by a timezone.
            if (gd > sd) throw new Error(`${tz}: ${start} +${k} → ${got} (day grew — a UTC shift)`);
          }
        }
      }
    } finally { process.env.TZ = original; }
  });

  it("★★ adding days still round-trips from a zone ahead of UTC", () => {
    try {
      for (const tz of AHEAD) {
        process.env.TZ = tz;
        for (const d of ["2026-01-01", "2026-01-31", "2026-03-01", "2026-12-31", "2024-02-29"]) {
          for (const n of [1, 30, 365]) {
            const back = addDaysYMD(addDaysYMD(d, n), -n);
            if (back !== d) throw new Error(`${tz}: ${d} +${n} → back ${back}`);
          }
        }
      }
    } finally { process.env.TZ = original; }
  });

  it("★★★ a month-end booking does not fall into the neighbouring period from any zone", () => {
    // This is the one that costs money: the last day of a signed month reading as the first of
    // the next lets a booking into an attested period.
    try {
      for (const tz of [...AHEAD, "UTC", "America/Anchorage"]) {
        process.env.TZ = tz;
        for (const p of ["2026-01", "2026-02", "2026-12", "2024-02"]) {
          const last = `${p}-${String(days(+p.slice(0, 4), +p.slice(5))).padStart(2, "0")}`;
          const signoffs = [{ period: p, revoked_at: null }];
          if (signedPeriodForDate(last, signoffs) !== p) throw new Error(`${tz}: ${last} did not read as ${p}`);
          if (signedPeriodForDate(addDaysYMD(last, 1), signoffs) !== null) throw new Error(`${tz}: the day after ${last} read as inside ${p}`);
        }
      }
    } finally { process.env.TZ = original; }
  });
});
