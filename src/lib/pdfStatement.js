// ─────────────────────────────────────────────────────────────────────────────
// C571 — A LONG PDF STATEMENT IS READ IN PAGES, NOT REFUSED.
//
// A PDF statement went to the parser in ONE call whose reply holds about ninety
// transactions. Since C565 a reply that runs out of room is refused rather than half-used,
// so a busy month's PDF failed outright — honest, but it still failed. Raising the reply
// cap is not the answer: a reply that long takes minutes and runs into the edge function's
// time limit.
//
// So: read the PDF whole first, exactly as before — most statements fit, and nothing about
// them changes. Only when that reply runs out of room is the PDF split into pieces of a few
// pages, each read on its own and halved again if it still overflows (C565's readInHalves),
// then merged in page order. A single page that cannot fit fails loudly.
//
// ★ THE STATEMENT'S OPENING BALANCE AND PERIOD START ARE TAKEN FROM THE FIRST PIECE ONLY.
// A later page often opens with "Balance forward $X" — read as an opening balance it would
// silently reset the starting position the whole reconciliation hangs on. The period END may
// come from any piece (a statement repeats its period in each page header, and a later piece
// can only restate it).
//
// ★ A LOCKED (ENCRYPTED) PDF IS REFUSED RATHER THAN SPLIT: its pages cannot be copied
// readably, and pieces that read as empty would book a statement with lines missing.
// ─────────────────────────────────────────────────────────────────────────────

import { isCutOff } from "./aiJson.js";
import { readInHalves } from "./statementChunks.js";

export const PDF_PAGES_PER_PIECE = 2;

export const PDF_LOCKED = "PDF_LOCKED";
export const PDF_LOCKED_MESSAGE = "This statement is too long to read in one go, and the PDF is locked, so we can't split it into pages. Download it from your bank again without a password, or as a CSV, and upload that.";

// What the parser is told about the pages it is looking at.
export function pdfPieceHint(pages, of) {
  const a = pages[0] + 1, b = pages[pages.length - 1] + 1;
  const which = a === b ? `page ${a}` : `pages ${a}–${b}`;
  const first = pages[0] === 0;
  return `This is ${which} of a ${of}-page bank statement. Extract EVERY transaction row on ${a === b ? "this page" : "these pages"}.` +
    (first ? "" : ` This is not the first page: return "opening_balance": null and "period_start": null — a "balance forward" figure here is not the statement's opening balance.`);
}

// A later piece never supplies the opening balance or period start (see header).
export function scrubLaterPiece(piece, isFirst) {
  if (isFirst || !piece || typeof piece !== "object" || Array.isArray(piece)) return piece;
  return { ...piece, opening_balance: null, period_start: null };
}

// The orchestration, with the I/O injected so it can be tested:
//   readWhole()               → parsed reply for the whole file (throws a cut-off error when it overflows)
//   openPages()               → { count, encrypted, piece(indices) → base64 of those pages }
//   readPiece(base64, hint)   → parsed reply for one piece
// Returns the parsed pieces in page order, ready for mergeParsedPieces.
export async function readPdfStatementPieces({ readWhole, openPages, readPiece, pagesPerPiece = PDF_PAGES_PER_PIECE }) {
  let cutOff;
  try { return [await readWhole()]; }
  catch (e) { if (!isCutOff(e)) throw e; cutOff = e; }

  const doc = await openPages();
  if (doc.encrypted) throw Object.assign(new Error(PDF_LOCKED_MESSAGE), { code: PDF_LOCKED });
  if (!doc.count || doc.count < 2) throw cutOff;           // one page that will not fit — nothing smaller to try

  const pages = Array.from({ length: doc.count }, (_, i) => i);
  return readInHalves(pages, async (batch) => {
    const piece = await readPiece(await doc.piece(batch), pdfPieceHint(batch, doc.count));
    return [scrubLaterPiece(piece, batch[0] === 0)];   // wrapped: a reply is one piece, even if it is a bare array
  }, { size: pagesPerPiece });
}

// The real page splitter. pdf-lib is loaded only here, only when a statement needs splitting.
export async function openPdfPages(base64) {
  const { PDFDocument } = await import("pdf-lib");
  const src = await PDFDocument.load(base64, { ignoreEncryption: true });
  return {
    count: src.getPageCount(),
    encrypted: !!src.isEncrypted,
    piece: async (indices) => {
      const out = await PDFDocument.create();
      const copied = await out.copyPages(src, indices);
      copied.forEach((p) => out.addPage(p));
      return out.saveAsBase64();
    },
  };
}

// The sentence a failed statement read ends with, from the recorded error (§9). `null` means
// "nothing specific to say" and the caller keeps its own. "Try again" is wrong for both of the
// cases named here — the same file would fail the same way.
export function statementReadFailureCopy(err) {
  if (err && err.code === PDF_LOCKED) return PDF_LOCKED_MESSAGE;
  if (isCutOff(err)) return "One page of this statement has more transactions than we can read at once. Download the statement from your bank as a CSV and upload that instead.";
  return null;
}
