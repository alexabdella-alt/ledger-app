import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { deferDuplicateAsk, filesStillArriving } from "../src/lib/recurringVendor";

// C597 — review finding U6: a re-uploaded invoice was not asked about, and booked twice,
// whenever any earlier tile was still on Home — even on an exact invoice-number match.
describe("what counts as a batch", () => {
  it("★ finished tiles on Home are not files still arriving", () => {
    const queue = [{ status: "done" }, { status: "done" }, { status: "error" }, { status: "processing" }];
    expect(filesStillArriving(queue)).toBe(1);
    expect(deferDuplicateAsk({ batchSize: filesStillArriving(queue), sameVendorSoFar: 0 })).toBe(false);
  });

  it("files waiting or being read do count", () => {
    expect(filesStillArriving([{ status: "pending" }, { status: "processing" }, { status: "pending" }, { status: "done" }])).toBe(3);
  });

  it("never less than one — the file being read is itself arriving", () => {
    expect(filesStillArriving([])).toBe(1);
    expect(filesStillArriving(null)).toBe(1);
  });
});

describe("the same invoice number", () => {
  it("★ is asked about even in a real bulk drop", () => {
    expect(deferDuplicateAsk({ batchSize: 12, sameVendorSoFar: 0 })).toBe(true);           // fuzzy: still deferred
    expect(deferDuplicateAsk({ batchSize: 12, sameVendorSoFar: 0, exactNumber: true })).toBe(false);
  });

  it("★ the upload reads only files still arriving, and an invoice-number match skips both the rhythm and the deferral", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const batchSize = filesStillArriving\(uploadQueueRef\.current\);/);
    expect(app).not.toMatch(/const batchSize = \(uploadQueueRef\.current \|\| \[\]\)\.length \|\| 1;/);
    expect(app).toMatch(/const dupExisting = !rawDup \? null\s*\n\s*: dupByNumber \? rawDup\s*\n\s*: duplicateIsExpectedRhythm\(/);
  });
});
