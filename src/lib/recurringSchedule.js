// ═════════════════════════════════════════════════════════════════════════════
// C492 — THE NEXT DUE DATE OF A RECURRING CHARGE, WITHOUT SKIPPING A MONTH.
// The Recurring screen advanced `next_date` with `setMonth(+1)`, which OVERFLOWS: a rent
// due on the 31st went Jan 31 → "Feb 31" → Mar 3, so February was never posted and the
// rule drifted onto the 3rd. `addMonthsClampedYMD` fixes the overflow but clamps
// CUMULATIVELY — Jan 31 → Feb 28 → Mar 28 → … — which parks every month-end rule on the
// 28th forever (C290's note). The rule stores no anchor day, so the migration-free answer
// is the conventional one: a date that IS the last day of its month advances to the last
// day of the next month (Jan 31 → Feb 28 → Mar 31 → Apr 30); any other day clamps.
// RESIDUE, STATED: a rule dated the 29th or 30th lands on Feb 28 (a last day), so from
// March it follows month-ends. A stored anchor day would remove that; it needs a column.
// ═════════════════════════════════════════════════════════════════════════════
import { addDaysYMD, addMonthsClampedYMD } from "./format.js";

export const MONTHS_PER_PERIOD = { monthly: 1, quarterly: 3, annual: 12 };

const parse = (ymd) => { const m = String(ymd || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? { y: +m[1], mo: +m[2], d: +m[3] } : null; };
const lastDayOf = (y, mo) => new Date(y, mo, 0).getDate();   // mo is 1-based; day 0 of next month
const pad = (n) => String(n).padStart(2, "0");

// Is this YYYY-MM-DD the last day of its calendar month?
export const isMonthEnd = (ymd) => { const p = parse(ymd); return !!p && p.d === lastDayOf(p.y, p.mo); };

// The next due date after `ymd` for `frequency`; null for an unknown frequency or an
// unparseable date, so a caller cannot advance onto a guess.
export function nextRecurringDate(ymd, frequency) {
  const p = parse(ymd);
  if (!p) return null;
  if (frequency === "weekly") return addDaysYMD(ymd, 7);
  const k = MONTHS_PER_PERIOD[frequency];
  if (!k) return null;
  if (!isMonthEnd(ymd)) return addMonthsClampedYMD(ymd, k);
  const total = p.mo - 1 + k, y = p.y + Math.floor(total / 12), mo = (total % 12) + 1;
  return `${y}-${pad(mo)}-${pad(lastDayOf(y, mo))}`;
}
