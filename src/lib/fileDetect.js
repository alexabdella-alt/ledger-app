// ─────────────────────────────────────────────────────────────────────────────
// Deterministic file-type detection (O37 — misroute protection). Sniffs a CSV /
// spreadsheet's HEADER COLUMNS to classify what a file likely IS before any
// importer processes it, so a payroll register dropped on the bank importer (which
// silently booked 9 wrong entries) is caught and offered the right destination.
//
// Pure header/keyword scoring — no AI, no IO in the core (`detectFromText`), so it's
// fast, free, and fully unit-testable. `detectFileType(file)` is the thin async
// wrapper that reads the first chunk of a File and delegates. PDFs/images and binary
// .xlsx return `unknown` (the AI-classifier extension for those is a noted
// fast-follow) — `unknown` NEVER triggers a mismatch warning, so we don't false-flag.
//
// Returns { type, confidence, signals } where:
//   type       : "bank_statement" | "payroll" | "invoice" | "qbo" | "unknown"
//   confidence : "high" | "medium" | "low" | "none"
//   signals    : { <type>: [matched column names] }  (why it decided)
// Only a HIGH-confidence type that disagrees with the importer should warn.
// ─────────────────────────────────────────────────────────────────────────────

import { detectHeaderRow, mapColumns } from "./qboParser.js";

// Discriminating column keywords (substring match, lowercased). Deliberately NOT
// generic words (date/amount/description/name) — those appear in every type and
// don't discriminate. QBO is detected separately (distinctive split/account columns).
const SIGNALS = {
  payroll: [
    "employee", "gross pay", "gross wages", "gross earnings", "net pay", "net wages",
    "take home", "take-home", "withhold", "pay period", "pay date", "pay rate",
    "hours worked", "hours", "overtime", "employer tax", "employer contribution",
    "fica", "medicare", "social security", "ytd", "paycheck", "payroll",
    "taxable wages", "federal income", "state income", "futa", "suta", "deduction",
  ],
  bank_statement: [
    "balance", "running balance", "debit", "credit", "withdrawal", "deposit",
    "check number", "check no", "check #", "posted", "posting date",
    "transaction date", "statement", "memo",
  ],
  invoice: [
    "invoice", "invoice no", "invoice number", "invoice #", "bill to", "ship to",
    "qty", "quantity", "unit price", "line item", "line total", "sku", "subtotal",
    "item description", "po number", "purchase order",
  ],
};
const SCORED_TYPES = ["payroll", "bank_statement", "invoice"];

// Minimal CSV → cells (split on comma/semicolon/tab, strip surrounding quotes).
// Headers rarely contain quoted delimiters, so this is sufficient for sniffing.
const splitLine = line => String(line).split(/[,;\t]/).map(c => c.replace(/^["']+|["']+$/g, "").trim());
const toRows = text => String(text || "")
  .split(/\r?\n/).filter(l => l.trim() !== "").slice(0, 30).map(splitLine);

// First row that looks like a header (≥2 non-empty cells).
const pickHeaderRow = rows => rows.find(r => r.filter(c => c !== "").length >= 2) || rows[0] || [];

// QBO (QuickBooks GL export) has distinctive Split and/or Account+Type columns —
// neither bank nor payroll files carry those. Reuses parseQbo's own header logic
// (which also skips QuickBooks' title/junk rows above the header).
function looksLikeQbo(rows) {
  const idx = detectHeaderRow(rows);
  if (idx < 0) return null;
  const m = mapColumns(rows[idx]);
  const sig = [];
  if (m.split != null) sig.push("split");
  if (m.account != null && m.type != null) sig.push("account+type");
  return sig.length ? sig : null;
}

// THE pure core — classify from raw text (CSV header). Unit-tested directly.
export function detectFromText(text, fileName = "") {
  const rows = toRows(text);
  if (!rows.length) return { type: "unknown", confidence: "none", signals: {} };

  // QBO first — distinctive columns, so a QuickBooks export never scores as bank.
  const qbo = looksLikeQbo(rows);
  if (qbo) return { type: "qbo", confidence: "high", signals: { qbo } };

  // Score bank / payroll / invoice by discriminating header columns. Each column is
  // attributed to at most ONE type (first match), so generic columns don't inflate.
  const header = pickHeaderRow(rows).map(c => c.toLowerCase()).filter(Boolean);
  const score = { payroll: 0, bank_statement: 0, invoice: 0 };
  const signals = { payroll: [], bank_statement: [], invoice: [] };
  for (const col of header) {
    for (const type of SCORED_TYPES) {
      if (SIGNALS[type].some(kw => col.includes(kw))) { score[type]++; signals[type].push(col); break; }
    }
  }

  const ranked = SCORED_TYPES.map(t => [t, score[t]]).sort((a, b) => b[1] - a[1]);
  const [topType, topScore] = ranked[0];
  const secondScore = ranked[1][1];
  if (topScore === 0) return { type: "unknown", confidence: "none", signals: {} };

  const margin = topScore - secondScore;
  let confidence = "low";
  if (topScore >= 2 && margin >= 2) confidence = "high";
  else if (topScore >= 2 && margin >= 1) confidence = "medium";
  return { type: topType, confidence, signals: { [topType]: signals[topType] } };
}

// Async wrapper over a File/Blob. Deterministic for text/CSV AND binary .xlsx/.xls
// (O55 — sniff the first sheet's header rows via the xlsx lib). PDFs/images can't be
// sniffed deterministically → unknown (the AI classifier handles those). Reads only a
// small prefix.
export async function detectFileType(file) {
  const name = file && file.name ? file.name : "";
  const ext = name.split(".").pop().toLowerCase();
  const isTextual = ["csv", "txt"].includes(ext) || String(file && file.type || "").includes("text");
  if (isTextual) {
    try {
      const blob = file.slice ? file.slice(0, 16384) : file;
      const text = await blob.text();
      return detectFromText(text, name);
    } catch {
      return { type: "unknown", confidence: "none", signals: {} };
    }
  }
  // O55: binary spreadsheet — read the first sheet's top rows and column-score them the
  // same way as a CSV header (so an .xlsx payroll register / bank export classifies
  // instead of falling to unknown). Lazy xlsx import keeps it out of the main bundle.
  if (["xlsx", "xls"].includes(ext)) {
    try {
      const XLSX = await import("xlsx");
      const buf = file.arrayBuffer ? await file.arrayBuffer() : file;
      const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }).slice(0, 30);
      const text = rows.map(r => (Array.isArray(r) ? r.join(",") : "")).join("\n");
      return detectFromText(text, name);
    } catch {
      return { type: "unknown", confidence: "none", signals: {}, reason: "xlsx parse failed" };
    }
  }
  return { type: "unknown", confidence: "none", signals: {}, reason: "non-text file (pdf/image) — handled by the AI classifier" };
}

// Given a deterministic detection result for a SPREADSHEET dropped on the universal
// "drop anything" zone, decide where it goes. Payroll/QBO route to their dedicated
// importers only on HIGH confidence (so we never false-route a real bank file).
// Everything else — a recognized bank/card statement OR an unrecognized transaction
// CSV (the generic Date/Description/Amount case) — routes to the Bank Import screen,
// because the offset account (Cash 1000 vs Credit Card 2200) can't be known from the
// file's content and must be chosen via the account-picker (C63/O57). The universal
// path therefore NEVER books these inline (no account binding → would crash on the
// undefined offset, or silently default to Cash and re-break O57 for cards).
// Returns { to } — the importer/view key to route to.
export function planUniversalSpreadsheetRoute(det) {
  if (det && det.confidence === "high" && (det.type === "payroll" || det.type === "qbo")) {
    return { to: det.type };
  }
  return { to: "bank_statement" };
}

// Map the AI document-type classifier's free-text reply → a docType. Conservative by
// design (O44 / O60): only a POSITIVELY recognized type routes to a processing pipeline;
// anything unrecognized or explicitly unsure → "unknown" (held for review), NEVER a
// forced "invoice" guess that could book the wrong thing. Pure → unit-tested.
export function classifyDocReply(text) {
  const t = String(text || "").trim().toLowerCase();
  // Payroll & QuickBooks first — a payroll register or QBO export must NOT be mistaken
  // for a bank statement or invoice (O55: the AI classifier now knows these too).
  if (t.includes("payroll") || t.includes("paystub") || t.includes("pay stub") || t.includes("paycheck")) return "payroll";
  if (t.includes("quickbooks") || t.includes("qbo") || t.includes("general ledger export")) return "qbo";
  // bank OR credit-card statements (the classifier may phrase it either way).
  if (t.includes("bank") || t.includes("card") || t.includes("statement")) return "bank_statement";
  if (t.includes("contract")) return "contract";
  if (t.includes("invoice") || t.includes("receipt") || t.includes("bill")) return "invoice";
  return "unknown";   // unsure / unrecognized → hold for review, don't guess
}

// Human label for a detected type (for the mismatch dialog copy).
export const TYPE_LABEL = {
  bank_statement: "bank statement",
  payroll: "payroll register",
  invoice: "invoice / receipt",
  qbo: "QuickBooks export",
  unknown: "file",
};
