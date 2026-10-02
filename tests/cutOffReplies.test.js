import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { aiJson, extractFirstJson, isCutOff, AI_REPLY_CUT_OFF } from "../src/lib/aiJson";
import { readInHalves } from "../src/lib/statementChunks";
import { isUnreadableHoldDetail, UNREADABLE_HOLD_PREFIX } from "../src/lib/waitingOnYou";

// ═════════════════════════════════════════════════════════════════════════════
// C565 — AN AI REPLY THAT RAN OUT OF ROOM IS REFUSED, NEVER HALF-USED.
// The model stops mid-list at its token limit and says so (stop_reason "max_tokens"); nothing
// read that. The JSON reader cannot close the cut-off list, so it skipped past it and returned
// the FIRST COMPLETE ITEM INSIDE — and the invoice extractor wrapped that as a list of one.
// A document with ten invoices booked one, and nothing on screen said so.
// ═════════════════════════════════════════════════════════════════════════════

const CUT_LIST = '[{"vendor":"Sysco","amount":1004.1},{"vendor":"Hill Country Milling","amount":697.5},{"vendor":"Rio Gra';
const reply = (text, stop = "end_turn") => ({ content: [{ type: "text", text }], stop_reason: stop });

describe("C565 — the hazard, as it was", () => {
  it("★★★ a cut-off list read without the flag yields its FIRST ITEM — which is how invoices vanished", () => {
    expect(extractFirstJson(CUT_LIST)).toEqual({ vendor: "Sysco", amount: 1004.1 });
  });
});

describe("C565 — the shared reader refuses a cut-off reply", () => {
  it("★★★ stop_reason max_tokens → a coded error, even though a fragment would parse", () => {
    let err = null;
    try { aiJson(reply(CUT_LIST, "max_tokens"), []); } catch (e) { err = e; }
    expect(err).not.toBeNull();
    expect(err.code).toBe(AI_REPLY_CUT_OFF);
    expect(isCutOff(err)).toBe(true);
  });
  it("★★ a complete reply reads exactly as before", () => {
    expect(aiJson(reply('[{"a":1},{"a":2}]'), [])).toEqual([{ a: 1 }, { a: 2 }]);
    expect(aiJson({ content: [] }, ["fallback"])).toEqual(["fallback"]);
  });
  it("an ordinary failure is not mistaken for a cut-off", () => {
    let err = null;
    try { aiJson(reply("no json here"), []); } catch (e) { err = e; }
    expect(isCutOff(err)).toBe(false);
  });
});

describe("C565 — a statement still goes through: halve and read again, in order", () => {
  const cutOff = () => Object.assign(new Error("cut off"), { code: AI_REPLY_CUT_OFF });
  it("★★★ batches too big for one reply are halved until they fit, and every line comes back once, in order", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => i);
    const calls = [];
    const fakeAI = async (batch) => { calls.push(batch.length); if (batch.length > 30) throw cutOff(); return batch.map((n) => ({ n })); };
    const got = await readInHalves(lines, fakeAI);
    expect(got.map((x) => x.n)).toEqual(lines);
    expect(Math.max(...calls)).toBeLessThanOrEqual(80);          // never more than one batch's worth at once
    expect(calls.some((n) => n <= 30)).toBe(true);
  });
  it("★★ a single line that still cannot fit fails LOUDLY — it is never dropped", async () => {
    const fakeAI = async () => { throw cutOff(); };
    await expect(readInHalves([1, 2, 3], fakeAI)).rejects.toThrow("cut off");
  });
  it("★ any other error is not retried — it surfaces as itself", async () => {
    let n = 0;
    const fakeAI = async () => { n++; throw new Error("AI service error (429)"); };
    await expect(readInHalves([1, 2, 3, 4], fakeAI)).rejects.toThrow("429");
    expect(n).toBe(1);
  });
});

describe("C565 — the invoice reader says why, and the trust panel sees it", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  it("★★ a cut-off reading tells the owner to split the file, not to rescan it", () => {
    expect(app).toMatch(/const why = isCutOff\(extractError\) \? EXTRACT_CUT_OFF_REASON : "Could not extract invoice data — try a clearer scan";/);
    expect(app).toMatch(/const EXTRACT_CUT_OFF_REASON = "This file has more invoices than we can read in one go — split it into smaller files and upload them again\. Nothing from it was recorded\.";/);
  });
  it("★★★ and the held file carries the unreadable mark, so it is never counted as 'accounted for'", () => {
    expect(app).toMatch(/if \(isCutOff\(extractError\)\) markIntake\(item\.intake_id, INTAKE_STATUS\.HELD, \{ detail: `\$\{UNREADABLE_HOLD_PREFIX\}\$\{EXTRACT_CUT_OFF_REASON\}` \}\);/);
    expect(isUnreadableHoldDetail(`${UNREADABLE_HOLD_PREFIX}This file has more invoices than we can read in one go`)).toBe(true);
  });
  it("the CSV pieces are halved too, a bounded number of times", () => {
    expect(app).toMatch(/const halves = isCutOff\(e\) && depth < 3 \? splitCsvForParse\(piece, \{ maxChars: Math\.ceil\(piece\.length \/ 2\) \}\) : null;/);
  });
});
