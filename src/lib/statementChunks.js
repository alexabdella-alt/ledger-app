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
import { isCutOff } from "./aiJson.js";

export const CSV_CHUNK_CHARS = 6000;    // ~70 lines; the parse reply is capped at 4,000 tokens
export const CATEGORIZE_BATCH = 80;     // the categoriser's proven batch size (6,000-token reply)

// The column-header line: the first line that names a date column. Lines above it are the
// statement's preamble (account, period, opening balance) and belong to the FIRST piece only.
// ★ C608 — NO "date" HEADER IS NOT "THE FIRST LINE IS THE HEADER". This returned 0 when no line
// named a date column, so a headerless export's FIRST TRANSACTION was repeated at the top of
// every piece as its "header" — and read again in each one: a 600-line file sent in nine
// pieces booked its first line nine times. A first line that carries a date is data (no
// header at all, -1); one that doesn't is a header worded without "date" ("Posted,Amount").
const LOOKS_LIKE_DATE = /\b\d{1,4}[\/\-.]\d{1,2}[\/\-.]\d{1,4}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}\b/i;
function headerIndex(lines) {
  const i = lines.findIndex((l) => /\bdate\b/i.test(l));
  if (i >= 0) return i;
  const first = lines.findIndex((l) => l.trim());
  if (first < 0) return -1;
  return LOOKS_LIKE_DATE.test(lines[first]) ? -1 : first;
}

export function splitCsvForParse(text, { maxChars = CSV_CHUNK_CHARS } = {}) {
  const lines = String(text || "").split(/\r?\n/);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (String(text || "").length <= maxChars) return [lines.join("\n")];
  const h = headerIndex(lines);
  const preamble = h >= 0 ? lines.slice(0, h) : [];
  const header = h >= 0 ? lines[h] : null;
  const body = (h >= 0 ? lines.slice(h + 1) : lines).filter((l) => l.trim());
  const chunks = [];
  let cur = [], size = 0;
  const top = header == null ? [] : [header];
  const open = () => (chunks.length === 0 ? [...preamble, ...top] : [...top]);
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

// ★ C565 — READ A LIST IN BATCHES, HALVING ANY BATCH WHOSE REPLY RUNS OUT OF ROOM. A cut-off
// reply is now refused (aiJson) rather than half-used; this turns that refusal into a retry on
// smaller pieces, so a dense statement still goes through. Results come back IN INPUT ORDER —
// callers assign line ids by position — and a single item that still cannot fit fails loudly.
export async function readInHalves(items, readBatch, { size = CATEGORIZE_BATCH } = {}) {
  const out = [];
  const go = async (batch) => {
    try {
      const got = await readBatch(batch);
      out.push(...(Array.isArray(got) ? got : [got]));
    } catch (e) {
      if (!isCutOff(e) || batch.length < 2) throw e;
      const mid = Math.ceil(batch.length / 2);
      await go(batch.slice(0, mid));
      await go(batch.slice(mid));
    }
  };
  for (const b of batches(items, size)) await go(b);
  return out;
}
