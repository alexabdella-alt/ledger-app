import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import {
  QUEUE_TONE, queueCensus, queueIsSettled, queueItemChip, queueItemIcon, queueItemTone,
} from "../src/lib/uploadQueueTile";

// The shape the upload catch actually writes (App.jsx): a transient AI failure marks the
// item `error` and stamps `transient: true` from `classifyAIFailure().retryable`.
const rateLimited = {
  id: "q1", status: "error", transient: true,
  error: "We've hit our own hourly limit for reading documents, which clears in about 40 minutes. Everything you sent is saved and will carry on automatically — there's nothing to re-send.",
};
const unreadable = { id: "q2", status: "error", transient: false, error: "We couldn't read this one" };

describe("O97 — a file that is waiting must not be dressed as a file that is broken", () => {
  it("★ the rate-limited file is WAITING, not ERROR", () => {
    expect(queueItemTone(rateLimited)).toBe(QUEUE_TONE.WAITING);
  });

  it("★ and the genuinely broken one still is ERROR — without this, the fix is indistinguishable from switching red off", () => {
    expect(queueItemTone(unreadable)).toBe(QUEUE_TONE.ERROR);
  });

  it("no signal on a waiting tile carries the error vocabulary", () => {
    const tone = queueItemTone(rateLimited);
    expect(queueItemIcon(tone, "🧾")).toBe("⏳");        // not ⚠
    expect(queueItemChip(tone, rateLimited)).toBe("Waiting its turn");
    expect(queueItemChip(tone, rateLimited)).not.toMatch(/error|fail|problem/i);
  });

  it("the waiting chip does not promise a retry that is not happening now", () => {
    expect(queueItemChip(QUEUE_TONE.WAITING, rateLimited)).not.toMatch(/retry|retrying/i);
  });

  it("the broken tile keeps ⚠ and its specific pipeline wording", () => {
    expect(queueItemIcon(QUEUE_TONE.ERROR)).toBe("⚠");
    expect(queueItemChip(QUEUE_TONE.ERROR, { result: { failed: true, to: "pipeline" } })).toBe("Needs a look");
    expect(queueItemChip(QUEUE_TONE.ERROR, unreadable)).toBe("Error");
  });

  it("done / review / running are unchanged", () => {
    expect(queueItemTone({ status: "done" })).toBe(QUEUE_TONE.SUCCESS);
    expect(queueItemTone({ status: "done" }, { pendingReview: true })).toBe(QUEUE_TONE.REVIEW);
    expect(queueItemTone({ status: "processing" })).toBe(QUEUE_TONE.PROGRESS);
    expect(queueItemTone({ status: "classifying" })).toBe(QUEUE_TONE.PROGRESS);
    expect(queueItemTone({ status: "pending" })).toBe(QUEUE_TONE.NEUTRAL);
    expect(queueItemChip(QUEUE_TONE.PROGRESS, {})).toBe(null);   // no chip beside its own progress line
  });

  it("a missing transient flag is treated as broken, not as waiting", () => {
    // The conservative direction: an unclassified failure shown as 'waiting' would sit
    // there forever looking fine while nothing ever picked it up.
    expect(queueItemTone({ status: "error" })).toBe(QUEUE_TONE.ERROR);
  });

  it("the census counts waiting separately from failed", () => {
    const c = queueCensus([rateLimited, unreadable, { id: "q3", status: "done" }, { id: "q4", status: "processing" }]);
    expect(c).toEqual({ done: 1, waiting: 1, error: 1, review: 0, running: 1, queued: 0 });
  });

  it("Clear appears only once nothing is running in this tab", () => {
    expect(queueIsSettled([rateLimited, unreadable])).toBe(true);
    expect(queueIsSettled([rateLimited, { status: "processing" }])).toBe(false);
    expect(queueIsSettled([])).toBe(false);
  });
});

describe("the view reads the tone rather than re-deciding it", () => {
  const view = readFileSync("src/components/views/DashboardView.jsx", "utf8");
  // Strip comments first — this guard has tripped on its own explanation five times in
  // this codebase, and a test that fails for a reason it does not mean is one nobody trusts.
  const code = view.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

  it("★ no style expression in the queue tile branches on status==='error' any more", () => {
    const start = code.indexOf("UPLOAD QUEUE");
    const end = code.indexOf("U1 (C375)", start);   // the list that replaced the in-queue banners follows the tiles
    const tile = code.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);          // the slice is real, not an empty window
    expect(tile).not.toMatch(/item\.status\s*===\s*"error"\s*\?/);
    expect(tile).toContain("queueItemTone(item");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U2 / C376 — when the batch has settled, the tiles fold behind ONE sentence read off the
// same census as the tiles. `queueCensus` had been exported and read by nothing.
// ─────────────────────────────────────────────────────────────────────────────
import { queueSummaryCopy } from "../src/lib/uploadQueueTile.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
describe("C376 — the batch in one sentence", () => {
  it("every clause reads a census field, in the owner's words", () => {
    expect(queueSummaryCopy({ done: 10, review: 2, error: 1, waiting: 3 })).toBe("12 documents handled · 2 have questions for you · 1 we couldn't read · 3 waiting their turn");
    expect(queueSummaryCopy({ done: 1 })).toBe("1 document handled");
    expect(queueSummaryCopy({ done: 1, review: 1 })).toBe("2 documents handled · 1 has a question for you");
    expect(queueSummaryCopy({ running: 2, queued: 1 })).toBe("3 still being read");
    expect(queueSummaryCopy({})).toBe("");
  });
  it("the summary is the census the tiles are drawn from — never a second count", () => {
    const items = [{ id: 1, status: "done" }, { id: 2, status: "done" }, { id: 3, status: "error" }, { id: 4, status: "error", transient: true }];
    expect(queueSummaryCopy(queueCensus(items, { pendingReviewIds: [2] }))).toBe("2 documents handled · 1 has a question for you · 1 we couldn't read · 1 waiting its turn");
  });
  it("Home folds a settled batch behind the sentence and a Show details toggle; an unsettled one keeps the tiles", () => {
    const strip = (h) => h.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
    const base = { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"] };
    const settled = strip(renderViewHtml(DashboardView, { ...base, uploadQueue: [{ id: 1, name: "a.pdf", status: "done", type: "invoice", result: { invoiceCount: 1, total: 10 } }, { id: 2, name: "b.pdf", status: "error", error: "bad", transient: false }] }));
    expect(settled).toContain("1 document handled · 1 we couldn't read");
    expect(settled).toContain("Show details");
    expect(settled).not.toContain("b.pdf");                 // the tile is folded
    const running = strip(renderViewHtml(DashboardView, { ...base, uploadQueue: [{ id: 1, name: "a.pdf", status: "processing", type: "invoice" }] }));
    expect(running).toContain("PROCESSING QUEUE");
    expect(running).toContain("a.pdf");                     // the tile is on screen while it runs
    expect(running).not.toContain("Show details");
  });
});
