import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { AI_REPLY_CUT_OFF } from "../src/lib/aiJson.js";
import { mergeParsedPieces } from "../src/lib/statementChunks.js";
import {
  readPdfStatementPieces, openPdfPages, pdfPieceHint, scrubLaterPiece, statementReadFailureCopy,
  PDF_LOCKED, PDF_LOCKED_MESSAGE, PDF_PAGES_PER_PIECE,
} from "../src/lib/pdfStatement.js";

const cutOff = () => Object.assign(new Error("cut off"), { code: AI_REPLY_CUT_OFF });
const txn = (p, i) => ({ date: "2026-07-01", description: `p${p} row${i}`, amount: -10, type: "debit", balance: null });

// A fake document of `count` pages; each piece is just its page list, so readPiece can see it.
const fakeDoc = (count, extra = {}) => ({ count, encrypted: false, piece: async (idx) => idx.join(","), ...extra });
// A parser that can answer at most `room` pages in one reply, and says what each page holds.
const parserWithRoom = (room) => vi.fn(async (b64) => {
  const pages = String(b64).split(",").map(Number);
  if (pages.length > room) throw cutOff();
  return {
    opening_balance: 9999, period_start: "2026-07-01", period_end: "2026-07-31",
    transactions: pages.flatMap((p) => [txn(p, 0), txn(p, 1)]),
  };
});

describe("C571 — a long PDF statement is read in pages, not refused", () => {
  it("a statement that fits is read whole, exactly as before — nothing is split", async () => {
    const openPages = vi.fn();
    const pieces = await readPdfStatementPieces({ readWhole: async () => ({ transactions: [txn(0, 0)] }), openPages, readPiece: vi.fn() });
    expect(pieces).toEqual([{ transactions: [txn(0, 0)] }]);
    expect(openPages).not.toHaveBeenCalled();
  });

  it("a statement too long for one reply is read in pieces of a few pages, every row kept, in page order", async () => {
    const readPiece = parserWithRoom(PDF_PAGES_PER_PIECE);
    const pieces = await readPdfStatementPieces({ readWhole: async () => { throw cutOff(); }, openPages: async () => fakeDoc(5), readPiece });
    const merged = mergeParsedPieces(pieces);
    expect(merged.transactions.map((t) => t.description)).toEqual(
      [0, 1, 2, 3, 4].flatMap((p) => [`p${p} row0`, `p${p} row1`]));
    expect(readPiece.mock.calls.map((c) => c[0])).toEqual(["0,1", "2,3", "4"]);
  });

  it("a piece that still overflows is halved down to single pages", async () => {
    const readPiece = parserWithRoom(1);
    const pieces = await readPdfStatementPieces({ readWhole: async () => { throw cutOff(); }, openPages: async () => fakeDoc(4), readPiece });
    expect(mergeParsedPieces(pieces).transactions).toHaveLength(8);
    expect(readPiece.mock.calls.map((c) => c[0])).toEqual(["0,1", "0", "1", "2,3", "2", "3"]);
  });

  it("the opening balance and period start come from the first page only — a later 'balance forward' never resets them", async () => {
    let n = 0;
    const readPiece = vi.fn(async () => ({ opening_balance: n++ === 0 ? 1000 : 4321, period_start: n === 1 ? "2026-07-01" : "2026-07-15", period_end: "2026-07-31", transactions: [] }));
    const pieces = await readPdfStatementPieces({ readWhole: async () => { throw cutOff(); }, openPages: async () => fakeDoc(6), readPiece });
    const merged = mergeParsedPieces(pieces);
    expect(merged.statedOpening).toBe(1000);
    expect(merged.statedPeriodStart).toBe("2026-07-01");
    expect(merged.statedPeriodEnd).toBe("2026-07-31");
  });
  it("and when the first page states no opening, a later page still cannot supply one", async () => {
    const readPiece = vi.fn(async () => ({ opening_balance: 4321, period_start: null, transactions: [] }));
    const first = { opening_balance: null, transactions: [] };
    readPiece.mockImplementationOnce(async () => first);
    const merged = mergeParsedPieces(await readPdfStatementPieces({ readWhole: async () => { throw cutOff(); }, openPages: async () => fakeDoc(4), readPiece }));
    expect(merged.statedOpening).toBeNull();
  });

  it("each piece is told which pages it is, and a later piece is told it is not the first", () => {
    expect(pdfPieceHint([0, 1], 5)).toBe("This is pages 1–2 of a 5-page bank statement. Extract EVERY transaction row on these pages.");
    expect(pdfPieceHint([4], 5)).toMatch(/^This is page 5 of a 5-page bank statement\. Extract EVERY transaction row on this page\. This is not the first page/);
  });
  it("scrubbing leaves the first piece and every transaction alone", () => {
    const p = { opening_balance: 5, period_start: "x", period_end: "y", transactions: [1] };
    expect(scrubLaterPiece(p, true)).toBe(p);
    expect(scrubLaterPiece(p, false)).toEqual({ opening_balance: null, period_start: null, period_end: "y", transactions: [1] });
  });

  it("a locked PDF is refused in words, never split into pieces that read as empty", async () => {
    const readPiece = vi.fn();
    const err = await readPdfStatementPieces({ readWhole: async () => { throw cutOff(); }, openPages: async () => fakeDoc(5, { encrypted: true }), readPiece }).catch((e) => e);
    expect(err.code).toBe(PDF_LOCKED);
    expect(readPiece).not.toHaveBeenCalled();
    expect(statementReadFailureCopy(err)).toBe(PDF_LOCKED_MESSAGE);
  });
  it("a one-page statement that will not fit fails loudly — there is nothing smaller to try", async () => {
    const err = await readPdfStatementPieces({ readWhole: async () => { throw cutOff(); }, openPages: async () => fakeDoc(1), readPiece: vi.fn() }).catch((e) => e);
    expect(err.code).toBe(AI_REPLY_CUT_OFF);
    expect(statementReadFailureCopy(err)).toMatch(/as a CSV/);
  });
  it("any other failure is passed through untouched, with no page split attempted", async () => {
    const openPages = vi.fn();
    const err = await readPdfStatementPieces({ readWhole: async () => { throw new Error("network"); }, openPages, readPiece: vi.fn() }).catch((e) => e);
    expect(err.message).toBe("network");
    expect(openPages).not.toHaveBeenCalled();
    expect(statementReadFailureCopy(err)).toBeNull();
  });
});

describe("C571 — the real page splitter", () => {
  const makePdf = async (n) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < n; i++) doc.addPage([300, 300]).drawText(`page ${i + 1}`, { x: 20, y: 150, size: 12, font });
    return doc.saveAsBase64();
  };
  it("counts the pages and cuts out exactly the ones asked for", async () => {
    const doc = await openPdfPages(await makePdf(5));
    expect(doc.count).toBe(5);
    expect(doc.encrypted).toBe(false);
    const piece = await PDFDocument.load(await doc.piece([2, 3]));
    expect(piece.getPageCount()).toBe(2);
  });
});

describe("C571 — both statement readers use it", () => {
  it("Bank Import / the drop zone and Reconcile read a PDF through readPdfStatementPieces", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    const recon = readFileSync("src/components/views/ReconView.jsx", "utf8");
    for (const src of [app, recon]) {
      expect(src).toMatch(/await readPdfStatementPieces\(\{/);
      expect(src).toMatch(/openPages: \(\) => openPdfPages\(base64\)/);
      expect(src).toMatch(/statementReadFailureCopy\(e\) \|\|/);
    }
    expect(recon).toMatch(/mergeParsedPieces\(pieces\)/);
  });
  it("pdf-lib is loaded only when a statement needs splitting", () => {
    const src = readFileSync("src/lib/pdfStatement.js", "utf8");
    expect(src).toMatch(/await import\("pdf-lib"\)/);
    expect(src).not.toMatch(/^import .*pdf-lib/m);
  });
});
