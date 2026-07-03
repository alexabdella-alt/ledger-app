// ─────────────────────────────────────────────────────────────────────────────
// QuickBooks Online export parser (Item 43). Pure functions over a 2D array of
// cells (the UI turns .csv/.xlsx into that array via the xlsx package), so this
// is fully unit-testable without any file/IO or the xlsx dependency.
//
// Handles QuickBooks' junk rows above the real header (company name, report
// title, date range), and both the single-Amount and separate Debit/Credit
// column formats. Robust date + amount parsing; invalid rows are collected, not
// thrown. Fuzzy account matching maps QB account names to our chart by role.
// ─────────────────────────────────────────────────────────────────────────────

import { ymdLocal } from "./format.js";

const HEADER_ALIASES = {
  date:    ["date", "transaction date"],
  type:    ["transaction type", "type"],
  num:     ["num", "no.", "number", "ref no", "ref number", "doc num"],
  name:    ["name", "vendor", "customer", "payee", "received from"],
  account: ["account", "account name"],
  split:   ["split", "splits"],
  amount:  ["amount"],
  debit:   ["debit"],
  credit:  ["credit"],
  memo:    ["memo/description", "memo / description", "memo", "description", "desc"],
};

const norm = s => String(s == null ? "" : s).trim().toLowerCase();

// .qbo files are Web Connect BANK STATEMENTS, not QuickBooks company data.
export const isQboBankFile = (filename) => /\.qbo$/i.test(String(filename || ""));

function headerScore(row) {
  const cells = (row || []).map(norm);
  let score = 0;
  for (const aliases of Object.values(HEADER_ALIASES)) {
    if (cells.some(c => aliases.includes(c))) score++;
  }
  return score;
}

// Find the real header row beneath QuickBooks' title/junk rows.
export function detectHeaderRow(rows) {
  let best = -1, bestScore = 0;
  const limit = Math.min((rows || []).length, 25);
  for (let i = 0; i < limit; i++) {
    const sc = headerScore(rows[i] || []);
    if (sc > bestScore) { bestScore = sc; best = i; }
  }
  return bestScore >= 2 ? best : -1; // need at least two recognizable columns
}

export function mapColumns(headerRow) {
  const cells = (headerRow || []).map(norm);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = cells.findIndex(c => aliases.includes(c));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}

export function parseDate(v) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);                       // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/.exec(s);        // MM/DD/YYYY (QB default)
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    if (Number(mo) >= 1 && Number(mo) <= 12 && Number(d) >= 1 && Number(d) <= 31) {
      return `${y}-${String(Number(mo)).padStart(2, "0")}-${String(Number(d)).padStart(2, "0")}`;
    }
    return null;
  }
  const dt = new Date(s);                                          // "January 5, 2026"
  return isNaN(dt.getTime()) ? null : ymdLocal(dt);   // preserve the parsed calendar day (no UTC shift)
}

export function parseAmount(v) {
  if (v == null || v === "") return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }       // (123.45) = negative
  s = s.replace(/[$,\s]/g, "");
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s === "" || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? (neg ? -n : n) : null;
}

function rawRow(columns, r) {
  const o = {};
  columns.forEach((c, i) => { if (c) o[c] = r[i] == null ? "" : String(r[i]); });
  return o;
}

// Normalize the data rows below `headerIndex` using a (possibly user-corrected)
// column map. Returns { rows, failed }. Exported so the column-mapping UI can
// recompute live when the user changes a mapping.
export function normalizeQbo(grid, headerIndex, colMap, columns) {
  const cols = columns || (grid[headerIndex] || []).map(c => String(c == null ? "" : c).trim());
  const out = [], failed = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const r = grid[i] || [];
    const at = idx => (idx == null ? "" : String(r[idx] == null ? "" : r[idx]).trim());
    if (r.map(c => String(c == null ? "" : c).trim()).join("") === "") continue;   // blank
    const acctCell = at(colMap.account), nameCell = at(colMap.name);
    if (/^total\b/i.test(acctCell) || /^total\b/i.test(nameCell)) continue;          // subtotal/total

    const date = parseDate(at(colMap.date));
    let amount = null;
    if (colMap.amount != null) amount = parseAmount(at(colMap.amount));
    else if (colMap.debit != null || colMap.credit != null) {
      amount = (parseAmount(at(colMap.debit)) || 0) - (parseAmount(at(colMap.credit)) || 0);
    }
    const row = {
      date, amount, type: at(colMap.type), num: at(colMap.num), name: nameCell,
      account: acctCell, split: at(colMap.split), memo: at(colMap.memo), _raw: rawRow(cols, r),
    };
    if (!date)          { failed.push({ row: i + 1, reason: "unreadable date", values: row._raw }); continue; }
    if (amount == null) { failed.push({ row: i + 1, reason: "non-numeric amount", values: row._raw }); continue; }
    if (!acctCell)      { failed.push({ row: i + 1, reason: "missing account", values: row._raw }); continue; }
    if (amount === 0) continue;
    out.push(row);
  }
  return { rows: out, failed };
}

// Parse a 2D array into normalized rows + a list of rows that failed validation.
// Returns { headerIndex, colMap, columns, rows, failed, error? }.
export function parseQbo(grid) {
  const headerIndex = detectHeaderRow(grid);
  if (headerIndex < 0) {
    return { headerIndex: -1, colMap: {}, columns: [], rows: [], failed: [], error: "Couldn't find a recognizable header row (looking for Date, Account, Amount, …)." };
  }
  const columns = (grid[headerIndex] || []).map(c => String(c == null ? "" : c).trim());
  const colMap = mapColumns(grid[headerIndex] || []);
  const { rows, failed } = normalizeQbo(grid, headerIndex, colMap, columns);
  return { headerIndex, colMap, columns, rows, failed };
}

// Keyword rules per system_role — used to fuzzy-match a QB account name to ours.
const ROLE_KEYWORDS = {
  cogs: ["cost of goods", "cogs", "materials", "inventory"],
  salaries_wages: ["salary", "salaries", "wage", "payroll", "compensation"],
  rent_occupancy: ["rent", "lease", "occupancy", "office space"],
  utilities: ["utilit", "electric", "gas", "water", "internet", "phone", "telecom"],
  marketing_advertising: ["marketing", "advertis", " ads", "promo", "seo", "social media"],
  travel_entertainment: ["meal", "travel", "entertain", "dining", "restaurant", "lodging", "hotel", "airfare", "flight", "mileage", "auto"],
  technology_software: ["software", "saas", "subscription", "apps", "hosting", "domain", "cloud", "technology", "tech "],
  office_supplies: ["office", "supplies", "supply", "postage", "printing", "equipment"],
  insurance: ["insurance", "premium"],
  professional_services: ["legal", "account", "consult", "professional", "attorney", "cpa", "bookkeep"],
  depreciation_amortization: ["depreciat", "amortiz"],
  interest_expense: ["interest expense", "interest"],
  miscellaneous_expense: ["miscellaneous", "misc", "uncategor", "other expense"],
  product_revenue: ["product revenue", "product income", "product sales"],
  service_revenue: ["service", "consulting income", "fees earned", "service revenue"],
  subscription_revenue: ["subscription revenue", "mrr", "recurring revenue"],
  cash: ["cash", "checking", "bank account", "operating account"],
  accounts_receivable: ["accounts receivable", "a/r", "receivable"],
  accounts_payable: ["accounts payable", "a/p", "payable"],
};

// Map a QuickBooks account name to one of our GL codes.
// exact name → exact code → keyword/role fuzzy → null (caller defaults to Misc).
export function matchAccount(qbName, chartOfAccounts, getAccountByRole) {
  const n = norm(qbName);
  if (!n) return null;
  const exact = (chartOfAccounts || []).find(a => norm(a.name) === n);
  if (exact) return exact.code;
  const byCode = (chartOfAccounts || []).find(a => String(a.code) === String(qbName).trim());
  if (byCode) return byCode.code;
  for (const [role, kws] of Object.entries(ROLE_KEYWORDS)) {
    if (kws.some(k => n.includes(k.trim()))) {
      const acct = getAccountByRole ? getAccountByRole(role) : null;
      if (acct?.code) return acct.code;
    }
  }
  return null;
}
