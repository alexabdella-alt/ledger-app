import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import {
  AI_CALLS_PER_DOCUMENT, budgetCopy, documentsRemaining, getBudget, readBudgetHeaders, recordBudget, resetBudget,
} from "../src/lib/aiBudget";

const headers = (o) => ({ get: (k) => (k in o ? o[k] : null) });
beforeEach(() => resetBudget());

describe("O113b — the ceiling is now something you can see, in documents", () => {
  it("★ reports DOCUMENTS, not API calls — a person has a stack of invoices, not a request quota", () => {
    expect(documentsRemaining({ ai: 60, upload: 20 })).toBe(20);
    expect(documentsRemaining({ ai: 30, upload: 20 })).toBe(10);
  });

  it("★★ the binding constraint is whichever bucket runs out FIRST", () => {
    // O113b's finding: both walls sit at 20 files, so quoting either alone would mislead.
    expect(documentsRemaining({ ai: 60, upload: 3 })).toBe(3);
    expect(documentsRemaining({ ai: 6, upload: 20 })).toBe(2);
  });

  it("★★ an unknown bucket is SKIPPED, never assumed generous", () => {
    expect(documentsRemaining({ ai: 30, upload: null })).toBe(10);
    expect(documentsRemaining({ ai: null, upload: 4 })).toBe(4);
    expect(documentsRemaining({ ai: null, upload: null })).toBe(null);
    expect(documentsRemaining(null)).toBe(null);
  });

  it("★★★ a MISSING header means 'we don't know', never zero — zero is a claim that you are out", () => {
    expect(readBudgetHeaders(headers({}))).toBe(null);
    expect(readBudgetHeaders(headers({ "x-ratelimit-remaining-ai": "" }))).toBe(null);
    expect(readBudgetHeaders(headers({ "x-ratelimit-remaining-ai": "nonsense" }))).toBe(null);
    expect(readBudgetHeaders(null)).toBe(null);
    expect(readBudgetHeaders(headers({ "x-ratelimit-remaining-ai": "0" }))).toEqual({ ai: 0, upload: null });
  });

  it("★ a non-upload call carries no upload header, and must not erase what we knew", () => {
    recordBudget({ ai: 60, upload: 20 });
    recordBudget({ ai: 57, upload: null });      // an AI-only call
    expect(getBudget()).toEqual({ ai: 57, upload: 20 });
  });
});

describe("the sentence is said in advance, and only when worth saying", () => {
  it("★ says nothing when there is plenty — noise is how a warning stops being read", () => {
    expect(budgetCopy({ ai: 60, upload: 20 })).toBe(null);
  });

  it("★ and says nothing when we genuinely do not know", () => {
    expect(budgetCopy(null)).toBe(null);
    expect(budgetCopy({ ai: null, upload: null })).toBe(null);
  });

  it("warns when the budget is getting low", () => {
    const t = budgetCopy({ ai: 15, upload: 20 });
    expect(t).toMatch(/About 5 more documents/);
  });

  it("★★★ THE CASE IT EXISTS FOR: more queued than budget, said BEFORE the wall", () => {
    // Today you discover the ceiling by hitting it — 200 files in, 20 succeed, the rest fail.
    const t = budgetCopy({ ai: 30, upload: 20 }, { pending: 50 });
    expect(t).toMatch(/about 10 more/);
    expect(t).toMatch(/other 40 will carry on automatically/);
  });

  it("★★ and being out is not reported as failure — nothing is lost, the queue picks it up", () => {
    const t = budgetCopy({ ai: 0, upload: 20 }, { pending: 7 });
    expect(t).toMatch(/read as much as we can this hour/);
    expect(t).toMatch(/saved and will carry on automatically/);
    expect(t).not.toMatch(/error|fail|problem|try again/i);
  });

  it("singular reads properly", () => {
    expect(budgetCopy({ ai: 3, upload: 20 })).toMatch(/About 1 more document\b/);
    expect(budgetCopy({ ai: 0, upload: 20 }, { pending: 1 })).toMatch(/document is/);
  });

  it("uses no jargon — no buckets, no calls, no limits-per-hour", () => {
    for (const b of [{ ai: 15, upload: 20 }, { ai: 0, upload: 20 }, { ai: 30, upload: 20 }]) {
      const t = budgetCopy(b, { pending: 50 }) || "";
      expect(t).not.toMatch(/bucket|api|rate.?limit|quota|token|request/i);
    }
  });
});

describe("★★ the reader exists — this is the field O113a wrote and nobody read", () => {
  it("the AI fetch path records the headers on success", () => {
    const ai = readFileSync("src/lib/ai.js", "utf8");
    expect(ai).toMatch(/recordBudget\(readBudgetHeaders\(res\.headers\)\)/);
  });

  it("★ and a 429 records the blocked bucket as zero, so the count does not stay stale-healthy", () => {
    const ai = readFileSync("src/lib/ai.js", "utf8");
    expect(ai).toMatch(/res\.status === 429 && body\?\.blocked_bucket/);
  });

  it("★★ and it reaches a SURFACE — a value with no reader is the defect this closes", () => {
    const dash = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(dash).toMatch(/budgetCopy\(aiBudget/);
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/setAiBudget\(getBudget\(\)\)/);
  });

  it("the per-document cost is the conservative path", () => {
    // A bank statement costs two AI calls; quoting that would promise more documents than we
    // can read, and a budget display that overstates is worse than none.
    expect(AI_CALLS_PER_DOCUMENT).toBe(3);
  });
});
