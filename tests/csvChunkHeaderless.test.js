import { describe, it, expect } from "vitest";
import { splitCsvForParse } from "../src/lib/statementChunks";

// C608 — review finding K6 (my own C562 code): a long CSV with no "date" header repeated its
// first transaction in every piece.
const rows = (n) => Array.from({ length: n }, (_, i) => `03/${String((i % 28) + 1).padStart(2, "0")}/2026,PAYEE NUMBER ${i},-${(i + 1).toFixed(2)},${(10000 - i).toFixed(2)}`);
const count = (chunks, needle) => chunks.reduce((s, c) => s + c.split("\n").filter((l) => l === needle).length, 0);

describe("a headerless export", () => {
  const lines = rows(400);
  const chunks = splitCsvForParse(lines.join("\n"), { maxChars: 3000 });

  it("is split into several pieces (otherwise this tests nothing)", () => {
    expect(chunks.length).toBeGreaterThan(3);
  });

  it("★ its first transaction appears exactly once across all pieces", () => {
    expect(count(chunks, lines[0])).toBe(1);
  });

  it("★ every transaction appears exactly once", () => {
    expect(chunks.flatMap((c) => c.split("\n"))).toEqual(lines);
  });
});

describe("headers still repeat — they are not data", () => {
  it("a header naming a date column", () => {
    const head = "Date,Description,Amount,Balance";
    const chunks = splitCsvForParse([head, ...rows(400)].join("\n"), { maxChars: 3000 });
    expect(count(chunks, head)).toBe(chunks.length);
  });

  it("★ a header worded without 'date' is still a header", () => {
    const head = "Posted,Payee,Amount,Balance";
    const chunks = splitCsvForParse([head, ...rows(400)].join("\n"), { maxChars: 3000 });
    expect(count(chunks, head)).toBe(chunks.length);
    expect(count(chunks, rows(1)[0])).toBe(1);
  });
});
