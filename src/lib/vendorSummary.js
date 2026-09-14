// ─────────────────────────────────────────────────────────────────────────────
// THE VENDORS TAB'S POPULATION — who you actually spend money with.
//
// ★★ THIS WAS KEYED OVER **EVERY** FLATTENED LEDGER ROW WITH NO FILTER AT ALL, so three
// different kinds of non-vendor turned into vendors on the screen where the vendor list IS
// the navigation:
//   (1) the system OPENING-BALANCE entry appeared as a vendor literally named
//       "Opening balances as of 2026-01-01", Edit button and all;
//   (2) a revenue DEPOSIT spawned a "Toast POS" vendor — a deposit is money coming IN, and
//       is not a vendor payment however the description reads;
//   (3) every bill's PAYMENT was counted as a second piece of spend, so a paid $824.60
//       bill showed as $1,649.20 with that vendor.
//
// (3) is the one that makes the numbers wrong rather than merely untidy, and it is the
// reason this is a filter on ACCOUNT rather than on source: the payment leg of a bill is a
// perfectly legitimate entry with a real vendor name on it. What makes it not-spend is
// where the money landed — Accounts Payable, not an expense account.
//
// ★ SO THE RULE IS: SPEND IS AN EXPENSE-ACCOUNT MOVEMENT. Everything the tab exists to
// show is `5xxx`–`8xxx`; everything it must not show falls out for free —
//   · revenue deposits are `4xxx`
//   · bill payments land on Accounts Payable (`2xxx`)
//   · opening balances are equity/asset
//   · transfers are asset-to-asset
// One rule, no list of special cases to keep in sync with the rest of the product.
//
// Pure. Grouping is by `vendor_key` (O125) so `Hill Country Milling Co` and `…Co.` are one
// vendor, while the NAME shown is a real string the user has seen.
// ─────────────────────────────────────────────────────────────────────────────

import { applyAlias } from "./vendorAlias.js";
import { glIsExpense } from "./gl";

// Does this row represent money spent WITH a vendor?
export function isVendorSpend(inv) {
  if (!inv) return false;
  // A voided or deleted row is not spend. (Its correcting entry, if any, groups with it
  // under the same key and nets it out — O125.)
  if (inv.status === "voided" || inv.deleted_at) return false;
  // The system's own bookkeeping is not a vendor, whatever its description says.
  if (inv.source === "opening_balance") return false;
  return glIsExpense(inv.gl_code);
}

// The tab's rows. `total` is what you SPENT — never spend plus its own settlement.
// `aliasIndex` (O111) is optional: without it this behaves exactly as before. With it, a
// supplier a person has told us goes by two names groups under ONE row — which is the whole
// of what they asked for by adding the alias.
export function buildVendorSummary(invoices = [], aliasIndex = null) {
  const map = new Map();
  for (const inv of invoices || []) {
    if (!isVendorSpend(inv)) continue;
    const raw = inv.vendor_key || inv.vendor || "Unknown";
    const key = aliasIndex ? applyAlias(raw, aliasIndex) : raw;
    if (!map.has(key)) {
      map.set(key, { key, name: inv.vendor || "Unknown", nameDate: "", total: 0, count: 0, lastDate: "", glAccounts: new Set(), projects: new Set() });
    }
    const m = map.get(key);
    // A correcting entry is a credit to the same expense account, so subtracting it here is
    // what makes a removed bill stop counting as spend.
    const signed = inv.debit_credit === "credit" ? -(inv.amount || 0) : (inv.amount || 0);
    m.total += signed;
    m.count += 1;
    if (!m.lastDate || inv.date > m.lastDate) m.lastDate = inv.date;
    // Label with the most RECENT spelling — a real string the user has seen, not a
    // normalised key and not a vote nobody can predict.
    if (inv.vendor && (!m.nameDate || String(inv.date || "") >= m.nameDate)) { m.name = inv.vendor; m.nameDate = String(inv.date || ""); }
    if (inv.gl_name) m.glAccounts.add(inv.gl_name);
    m.projects.add(inv.project || "General");
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

// ── SCOPING THE TRANSACTIONS LIST TO ONE SUPPLIER (C347) ─────────────────────
// DetailView's "View all transactions for X" sets the filter to the ROW's spelling — it has
// nothing else — and that may not be the summary's label, which is the group's most RECENT
// spelling (C210). So the group is resolved from a row carrying that spelling, by the same
// key (under the alias index) the Vendors tab groups by — "view all for X" then shows exactly
// the rows that tab counts for X, whatever spelling each carries.
// A filter naming a vendor no row carries scopes to NOTHING rather than to everything —
// an empty list says "nothing matches"; a full one would silently drop the scope.
// (A first draft also looked the label up in `vendorSummary`; a surviving mutation showed
// that clause could never matter — a label IS a row's spelling, so the row lookup already
// covers it. Removed rather than left reading like a check.)
export function scopeInvoicesToVendor(invoices = [], vendorFilter = "all", aliasIndex = null) {
  if (!vendorFilter || vendorFilter === "all") return invoices || [];
  const keyOf = (inv) => { const raw = inv.vendor_key || inv.vendor; return aliasIndex ? applyAlias(raw, aliasIndex) : raw; };
  const sample = (invoices || []).find((inv) => inv && inv.vendor === vendorFilter);
  if (!sample) return [];
  const key = keyOf(sample);
  return (invoices || []).filter((inv) => inv && keyOf(inv) === key);
}
