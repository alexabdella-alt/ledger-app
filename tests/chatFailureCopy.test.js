import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { chatFailureCopy, classifyAIFailure, AI_FAILURE } from "../src/lib/aiFailure.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C414 — THE CHAT BUBBLE ON A FAILED ANSWER READS THE CLASSIFIER, NOT THE RAW ERROR.
// It printed `⚠ I couldn't complete that request.` + the raw message (`AI service error
// (429 Too Many Requests): {"error":…}`) + hints about "the ai-proxy edge function".
// ═════════════════════════════════════════════════════════════════════════════
const errWith = (status, body = {}, message = "x") => { const e = new Error(message); e.status = status; e.aiFailure = undefined; return e; };

describe("chatFailureCopy", () => {
  it("our limit: names the wait, says the question is kept", () => {
    const e = new Error("AI service error (429 Too Many Requests)"); e.status = 429;
    e.aiFailure = { kind: AI_FAILURE.OUR_LIMIT, resetsInMinutes: 12, retryable: true, operator: "Rate limit: ai bucket" };
    const c = chatFailureCopy(e);
    expect(c.owner).toBe("I've hit my hourly limit for answering — it clears in about 12 minutes. Your question is still in the box; ask again then.");
    expect(c.operator).toBe("Rate limit: ai bucket");
  });
  it("classifies from status when the error carries no classification", () => {
    expect(chatFailureCopy(errWith(503)).kind).toBe(AI_FAILURE.PROVIDER_BUSY);
    expect(chatFailureCopy(new Error("Failed to fetch")).kind).toBe(AI_FAILURE.PROVIDER_BUSY);
    // ★ the browser's own wording ("Failed to fetch") was not matched — an upload dropped by a
    // network blip was held as PERMANENT instead of retried. Pinned on the upload path's classifier.
    expect(classifyAIFailure({ message: "TypeError: Failed to fetch" }).retryable).toBe(true);
    expect(chatFailureCopy(errWith(401)).kind).toBe(AI_FAILURE.NOT_CONFIGURED);
    expect(chatFailureCopy(new Error("model not_found")).kind).toBe(AI_FAILURE.UNKNOWN);
  });
  it("every sentence passes the owner bar and never quotes the raw message or a proxy", () => {
    for (const e of [errWith(429, {}, 'AI service error (429): {"error":"rate_limited"}'), errWith(503), errWith(401), new Error("model not_found"), errWith(402, {}, "credit balance too low")]) {
      const c = chatFailureCopy(e);
      expect(containsOwnerJargon(c.owner), c.owner).toBe(false);
      expect(c.owner).not.toMatch(/proxy|edge function|429|401|model|rate_limited|\{/);
    }
  });
});

describe("the wiring", () => {
  const app = fs.readFileSync("src/App.jsx", "utf8");
  it("the chat's catch renders the owner sentence, audits the operator detail, clears loading, and declines the send so the box keeps the text", () => {
    const i = app.indexOf('console.error("Chat error:", e);');
    expect(i).toBeGreaterThan(-1);
    const blk = app.slice(i, i + 900);
    expect(blk).toMatch(/const fail = chatFailureCopy\(e\);/);
    expect(blk).toMatch(/content: fail\.owner/);
    expect(blk).toMatch(/logAudit\("ai_chat_failed"[^\n]*operator: fail\.operator/);
    expect(blk).toMatch(/setChatLoading\(false\);\s*return false;/);
  });
  it("the operator hints are gone from the bubble", () => {
    expect(app).not.toMatch(/Couldn't reach the ai-proxy edge function/);
    expect(app).not.toMatch(/verify the ai-proxy model configuration/);
    expect(app).not.toMatch(/I couldn't complete that request/);
  });
});
