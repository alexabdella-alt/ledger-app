// ─────────────────────────────────────────────────────────────────────────────
// C562 — A BANK STATEMENT IS READ WHOLE, NOT FIRST-80-LINES-AND-SILENCE.
//
// Two silent truncations sat in the statement path, in both places that parsed one:
//   · a CSV was cut at 8,000 characters before the AI read it (~100 lines), and
//   · only the first 80 parsed lines were sent to be categorised — and everything after
//     works from the categorised list, so lines 81+ were never recorded.
// Neither said so. A busy month's statement booked part of itself, and the only trace was a
// reconciliation that would not tie. These are the pure halves of reading it all: split a long
// CSV into pieces the parser can answer in one reply (repeating the column header, keeping the
// statement's own preamble — opening balance, period — with the first piece), batch lines for
// categorising, and merge the pieces back in order.
// ─────────────────────────────────────────────────────────────────────────────
import { normalizeBankParse } from "./openingBalanceProposal";

export const CSV_CHUNK_CHARS = 6000;    // ~70 lines; the parse reply is capped at 4,000 tokens
export const CATEGORIZE_BATCH = 80;     // the categoriser's proven batch size (6,000-token reply)

// The column-header line: the first line that names a date column. Lines above it are the
// statement's preamble (account, period, opening balance) and belong to the FIRST piece only.
function headerIndex(lines) {
  const i = lines.findIndex((l) => /\bdate\b/i.test(l));
  return i >= 0 ? i : 0;
}

export function splitCsvForParse(text, { maxChars = CSV_CHUNK_CHARS } = {}) {
  const lines = String(text || "").split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (String(text || "").length <= maxChars) return [lines.join("\n")];
  const h = headerIndex(lines);
  const preamble = lines.slice(0, h);
  const header = lines[h];
  const body = lines.slice(h + 1).filter((l) => l.trim());
  const chunks = [];
  let cur = [], size = 0;
  const open = () => (chunks.length === 0 ? [...preamble, header] : [header]);
  for (const line of body) {
    const base = open().join("\n").length;
    if (cur.length && base + size + line.length + 1 > maxChars) {
      chunks.push([...open(), ...cur].join("\n"));
      cur = []; size = 0;
    }
    cur.push(line); size += line.length + 1;
  }
  if (cur.length) chunks.push([...open(), ...cur].join("\n"));
  return chunks;
}

export function batches(list, size = CATEGORIZE_BATCH) {
  const out = [];
  for (let i = 0; i < (list || []).length; i += size) out.push(list.slice(i, i + size));
  return out;
}

// Merge the parse of each piece. Transactions concatenate in order; the statement's stated
// opening and period start come from the FIRST piece that states them, the period end from the
// LAST — the order a statement prints them in.
export function mergeParsedPieces(pieces = []) {
  const parts = pieces.map((p) => normalizeBankParse(p));
  return {
    transactions: parts.flatMap((p) => p.transactions || []),
    statedOpening: parts.map((p) => p.statedOpening).find((v) => v != null) ?? null,
    statedPeriodStart: parts.map((p) => p.statedPeriodStart).find(Boolean) || null,
    statedPeriodEnd: [...parts].reverse().map((p) => p.statedPeriodEnd).find(Boolean) || null,
  };
}
