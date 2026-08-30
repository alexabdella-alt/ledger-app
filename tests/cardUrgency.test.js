import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { urgencyOf, sortByUrgency, countByUrgency, queueBannerCopy, URGENCY } from "../src/lib/cardUrgency";

// ═════════════════════════════════════════════════════════════════════════════
// O120 — WHICH QUESTIONS DESERVE TO STOP YOU.
//
// Ten cards sat unanswered through the August drive while the header said the books were
// correct. The obvious fix — a pop-up per card — fights the product: the promise is BOOK
// EVERYTHING AND BATCH THE JUDGEMENT TO CLOSE, and a modal per item turns a queue you can
// zip through into a gauntlet.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★★ the discriminator is whether you could TELL you got it wrong", () => {
  it("★★★ a lifecycle card stops you — one answer suppresses a real charge silently", () => {
    for (const k of ["lifecycle", "amount_differs", "identity_differs", "multiple_candidates", "duplicate"]) {
      expect([k, urgencyOf({ kind: k })]).toEqual([k, URGENCY.STOPS]);
    }
  });

  it("★★ a category question waits — wrong is visible in the account and a recode undoes it", () => {
    for (const k of ["gl", "gaap", "project", "vendor"]) {
      expect([k, urgencyOf({ kind: k })]).toEqual([k, URGENCY.WAITS]);
    }
  });

  it("★★ it is keyed on what a wrong answer DOES, not on severity or amount", () => {
    // A $40 lifecycle card still stops you; a $40,000 category question still waits. The
    // question is whether you could tell, not how much is at stake.
    expect(urgencyOf({ kind: "lifecycle", amount: 40 })).toBe(URGENCY.STOPS);
    expect(urgencyOf({ kind: "gl", amount: 40000, severity: "high" })).toBe(URGENCY.WAITS);
  });

  it("★★★ an unclassified card WAITS — drifting into 'stops' rebuilds the gauntlet", () => {
    // Adding a kind to the stopping set is a decision someone makes. An unknown card is far
    // more likely to be an ordinary category question than a silent-failure one.
    expect(urgencyOf({ kind: "something_new" })).toBe(URGENCY.WAITS);
    expect(urgencyOf({})).toBe(URGENCY.WAITS);
  });
});

describe("★★ ordering, not interrupting", () => {
  it("★★★ dangerous first, and stable within each group", () => {
    const cards = [{ id: 1, kind: "gl" }, { id: 2, kind: "lifecycle" }, { id: 3, kind: "gaap" }, { id: 4, kind: "duplicate" }];
    expect(sortByUrgency(cards).map((c) => c.id)).toEqual([2, 4, 1, 3]);
  });

  it("★ two cards of the same urgency keep the order their documents arrived", () => {
    const cards = [{ id: "a", kind: "gl" }, { id: "b", kind: "gaap" }, { id: "c", kind: "gl" }];
    expect(sortByUrgency(cards).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("★★★ nothing here opens a modal", () => {
    // The whole design decision. If a future edit adds one, the promise "batch the judgement
    // to close" is broken by the thing meant to protect it.
    // ★ COMMENTS STRIPPED FIRST — the file EXPLAINS why there is no modal, so a naive scan
    // matches its own justification. Fifth time this project has hit a guard tripping on its
    // own prose; the fix has been the same every time and is cheap to apply up front.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/cardUrgency.js"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/modal|dialog|confirm|alert\(/i);
  });
});

describe("★★ the banner says WHICH KIND, not just how many", () => {
  it("★★★ a count alone makes ten harmless questions look like ten problems", () => {
    const copy = queueBannerCopy([{ kind: "lifecycle" }, { kind: "gl" }, { kind: "gaap" }]);
    expect(copy).toMatch(/1 needs an answer before we can record it correctly/);
    expect(copy).toMatch(/2 that can wait/);
  });

  it("★ when nothing is dangerous it does not sound like an alarm", () => {
    const copy = queueBannerCopy([{ kind: "gl" }, { kind: "gaap" }]);
    expect(copy).toMatch(/they can wait until you're ready/);
    expect(copy).not.toMatch(/⚠|urgent|immediately/);
  });

  it("★ and it says nothing at all when there is nothing", () => {
    expect(queueBannerCopy([])).toBeNull();
  });

  it("counts are derived, not asserted", () => {
    expect(countByUrgency([{ kind: "lifecycle" }, { kind: "gl" }])).toEqual({ stops: 1, waits: 1, total: 2 });
  });
});

describe("★★ it reaches both surfaces", () => {
  it("★★★ the old 'scroll down to review' line is gone", () => {
    // A bare count plus an instruction to scroll is the O120 complaint in one sentence.
    const dash = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(dash).not.toMatch(/need your input before booking — scroll down to review/);
    expect(dash).toMatch(/queueBannerCopy\(open\)/);
  });

  it("★ and the cards themselves are ordered", () => {
    const flow = fs.readFileSync(path.join(process.cwd(), "src/components/ClarificationFlow.jsx"), "utf8");
    expect(flow).toMatch(/sortByUrgency\(clarificationQueue\)\.map/);
  });
});
