import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { splitCsvForParse, batches, mergeParsedPieces, CSV_CHUNK_CHARS, CATEGORIZE_BATCH } from "../src/lib/statementChunks";

// ═════════════════════════════════════════════════════════════════════════════
// C562 — A BANK STATEMENT IS READ WHOLE. Both statement parsers truncated in silence: a CSV
// was cut at 8,000 characters (~100 lines) before the AI read it, and only the first 80 parsed
// lines were categorised — the rest were never recorded, with no message.
// ═════════════════════════════════════════════════════════════════════════════

const PREAMBLE = ["Account: Business Checking ****4417", "Statement period: 08/01/2026 - 08/31/2026", "Opening balance: 25,000.00"];
const HEADER = "Date,Description,Amount,Balance";
const row = (i) => `08/${String((i % 28) + 1).padStart(2, "0")}/2026,VENDOR NUMBER ${String(i).padStart(3, "0")} PURCHASE AUSTIN TX,-${(i + 1).toFixed(2)},${(25000 - i).toFixed(2)}`;
const csv = (n) => [...PREAMBLE, HEADER, ...Array.from({ length: n }, (_, i) => row(i))].join("\n");

describe("C562 — splitting a long CSV for the parser", () => {
  it("a short statement is one piece, unchanged", () => {
    const t = csv(10);
    expect(splitCsvForParse(t)).toEqual([t]);
  });

  const LONG = csv(300);
  const pieces = splitCsvForParse(LONG);

  it("★★★ a 300-line statement is read in several pieces, each small enough for one reply", () => {
    expect(LONG.length).toBeGreaterThan(8000);   // the old cut-off would have lost most of it
    expect(pieces.length).toBeGreaterThan(1);
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(CSV_CHUNK_CHARS);
  });
  it("★★★ every transaction line appears exactly once, in order — nothing lost, nothing doubled", () => {
    const body = pieces.flatMap((p) => p.split("\n").filter((l) => /VENDOR NUMBER/.test(l)));
    expect(body).toEqual(Array.from({ length: 300 }, (_, i) => row(i)));
  });
  it("★★ every piece carries the column header, so each is readable on its own", () => {
    for (const p of pieces) expect(p.split("\n")).toContain(HEADER);
  });
  it("★★ the statement's preamble (opening balance, period) rides with the FIRST piece only", () => {
    expect(pieces[0]).toMatch(/Opening balance: 25,000\.00/);
    for (const p of pieces.slice(1)) expect(p).not.toMatch(/Opening balance/);
  });
});

describe("C562 — categorising in batches", () => {
  it("★★★ 205 lines → 80 + 80 + 45, every line in exactly one batch, in order", () => {
    const lines = Array.from({ length: 205 }, (_, i) => i);
    const b = batches(lines);
    expect(b.map((x) => x.length)).toEqual([CATEGORIZE_BATCH, CATEGORIZE_BATCH, 45]);
    expect(b.flat()).toEqual(lines);
  });
});

describe("C562 — merging the pieces back", () => {
  it("transactions concatenate in order; opening from the first that states it; period end from the last", () => {
    const m = mergeParsedPieces([
      { opening_balance: 25000, period_start: "2026-08-01", transactions: [{ n: 1 }, { n: 2 }] },
      { transactions: [{ n: 3 }] },
      { period_end: "2026-08-31", transactions: [{ n: 4 }] },
    ]);
    expect(m.transactions.map((t) => t.n)).toEqual([1, 2, 3, 4]);
    expect(m).toMatchObject({ statedOpening: 25000, statedPeriodStart: "2026-08-01", statedPeriodEnd: "2026-08-31" });
  });
  it("★★ when EVERY piece states a period and opening, the statement's own are the first opening and the LAST end", () => {
    // Added after a mutation taking the FIRST period end survived: only one piece stated it, so
    // first and last were the same. A parser reading pieces may infer a period from each piece's
    // own dates — only the last piece's end is the statement's, only the first piece's opening.
    const m = mergeParsedPieces([
      { opening_balance: 25000, period_start: "2026-08-01", period_end: "2026-08-15", transactions: [] },
      { opening_balance: 23100, period_start: "2026-08-16", period_end: "2026-08-31", transactions: [] },
    ]);
    expect(m).toMatchObject({ statedOpening: 25000, statedPeriodStart: "2026-08-01", statedPeriodEnd: "2026-08-31" });
  });
  it("a bare-array reply (the legacy shape) still merges", () => {
    expect(mergeParsedPieces([[{ n: 1 }], [{ n: 2 }]]).transactions.map((t) => t.n)).toEqual([1, 2]);
  });
});

describe("C562 — both statement paths read through the one reader", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  it("★★★ neither truncation survives anywhere in the app", () => {
    expect(app).not.toMatch(/rawTxns\.slice\(0,\s*80\)/);
    expect(app).not.toMatch(/\.slice\(0,\s*8000\)/);
  });
  it("★★ Bank Import and the drop-zone backstop both call readBankStatement", () => {
    expect((app.match(/await readBankStatement\(file/g) || []).length).toBe(2);
    expect(app).toMatch(/for \(const batch of batches\(rawTxns\)\)/);
    expect(app).toMatch(/const chunks = splitCsvForParse\(text\);/);
  });
});
