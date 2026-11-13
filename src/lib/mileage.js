// ═════════════════════════════════════════════════════════════════════════════
// ★ C692 — THE CAR, BY THE IRS STANDARD MILEAGE RATE (Schedule C line 9).
//
// Most solo owners deduct their car by the standard mileage rate: business miles × the IRS rate,
// which REPLACES gas, repairs, insurance, registration and depreciation for that car. Parking and
// tolls on business trips are still deducted on top (Rev. Proc. 2019-46; IRS Pub. 463).
// Rates: 2024 67¢ (IR-2023-239), 2025 70¢ (IR-2024-312), 2026 72.5¢ (IR-2025-128, Notice 2026-10)
// raised to 76¢ for miles driven from July 1, 2026 (Announcement 2026-11). Where a year changes
// mid-way, the owner may say how many miles were driven from the change; otherwise the miles are
// assumed spread evenly, and the screen says so.
// The other method — actual costs — is the preparer's call: it can be larger, and a car first
// deducted by actual costs can't switch to the mileage rate later. We show both figures.
// Pure.
// ═════════════════════════════════════════════════════════════════════════════
export const MILEAGE_RATES = {
  2024: [{ from: "2024-01-01", rate: 0.67 }],
  2025: [{ from: "2025-01-01", rate: 0.70 }],
  2026: [{ from: "2026-01-01", rate: 0.725 }, { from: "2026-07-01", rate: 0.76 }],
};
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const years = () => Object.keys(MILEAGE_RATES).map(Number);
export function mileageRatesFor(year) {
  const y = Number(year);
  if (MILEAGE_RATES[y]) return MILEAGE_RATES[y];
  const nearest = y < Math.min(...years()) ? Math.min(...years()) : Math.max(...years());
  const last = MILEAGE_RATES[nearest];
  return [{ from: `${y}-01-01`, rate: last[last.length - 1].rate }];
}
// miles: the year's business miles. milesAfterChange: of those, how many from the mid-year change
// (only asked where the year has one; null → spread evenly by days).
export function mileageDeduction({ year, miles = 0, milesAfterChange = null } = {}) {
  const total = Math.max(0, Math.floor(Number(miles) || 0));
  const rates = mileageRatesFor(year);
  if (!total) return { amount: 0, miles: 0, rates, assumedSplit: false };
  if (rates.length === 1) return { amount: r2(total * rates[0].rate), miles: total, rates, assumedSplit: false };
  const change = rates[1].from;
  const given = milesAfterChange != null && milesAfterChange !== "" && Number.isFinite(Number(milesAfterChange));
  const yearStart = new Date(`${year}-01-01T00:00:00Z`), yearEnd = new Date(`${Number(year) + 1}-01-01T00:00:00Z`), at = new Date(`${change}T00:00:00Z`);
  const after = given ? Math.min(total, Math.max(0, Math.floor(Number(milesAfterChange))))
    : Math.round(total * (yearEnd - at) / (yearEnd - yearStart));
  const before = total - after;
  return { amount: r2(before * rates[0].rate + after * rates[1].rate), miles: total, rates, assumedSplit: !given, before, after };
}
// Parking and tolls on business trips are deducted in addition to the mileage rate.
const PARKING_TOLLS = /\b(parking|park ?mobile|parkwhiz|spothero|laz parking|garage fee|tolls?|toll ?road|toll ?tag|e-?z ?pass|fastrak|sunpass|txtag|i-?pass|peach ?pass)\b/i;
export function isParkingOrToll(row = {}, accountName = "") {
  return PARKING_TOLLS.test(`${row.vendor || ""} ${row.description || ""} ${accountName || ""}`);
}
// A year's mileage setting from the saved tax settings (filed_deadlines.business_miles / _after_change).
export function mileageProfileFrom(filed = {}) {
  const f = filed || {};
  const miles = Math.max(0, Math.floor(Number(f.business_miles) || 0));
  const after = f.business_miles_after_change;
  return { miles, milesAfterChange: after == null || after === "" ? null : Math.max(0, Math.floor(Number(after) || 0)) };
}
