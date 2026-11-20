// ★ C763 — A PHOTO THAT ISN'T A BUSINESS DOCUMENT (a coffee cup): kept in Documents, nothing recorded,
// not held for our team, and the tile says so in words with a door to record it as a purchase.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { queueItemStatusCopy, NOT_DOCUMENT_ACTION } from "../src/lib/uploadQueueTile.js";

const item = { status: "done", type: "unknown", result: { not_document: true, what: "a cup of coffee" } };

describe("C763 — what the tile says", () => {
  it("★★★ the owner: what it looked like, that it's kept, and that nothing was added", () => {
    expect(queueItemStatusCopy(item)).toBe("This doesn't look like a receipt or bill — it looks like a cup of coffee. We kept the photo in Documents; nothing was added to your books.");
    expect(queueItemStatusCopy(item)).not.toMatch(/couldn't tell|our team/);
  });
  it("★★ the accountant: the short form", () => {
    expect(queueItemStatusCopy(item, { cockpit: true })).toBe("Not a business document (a cup of coffee) — kept in Documents, nothing recorded");
  });
  it("★ an ordinary unknown file is unchanged", () => {
    expect(queueItemStatusCopy({ status: "done", type: "unknown", result: { document_type: "W-9" } }, { hasAccountant: false })).toBe("We couldn't tell what this is — it's saved in Documents.");
  });
  it("★★ the door: tell the assistant it was a purchase (C755's record_purchase)", () => {
    expect(NOT_DOCUMENT_ACTION.label).toBe("It was a business purchase");
    expect(NOT_DOCUMENT_ACTION.prefill("a cup of coffee")).toBe("I bought a cup of coffee for the business. I paid $");
    const d = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(d).toContain('item.result?.not_document && !cockpit');
    expect(d).toContain("setChatPrefill({ at: Date.now(), text: NOT_DOCUMENT_ACTION.prefill(item.result.what) }); setChatOpen(true);");
  });
});

describe("C763 — what the app does with it", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const i = app.indexOf("if (notDocWhat) {");
  const body = app.slice(i, app.indexOf("} else {", i));
  it("★★★ closed as not-a-transaction (REJECTED) — never held for review, never a hole for the 15-minute check", () => {
    expect(body).toContain("markIntake(item.intake_id, INTAKE_STATUS.REJECTED,");
    expect(body).not.toContain("INTAKE_STATUS.HELD");
    expect(body).not.toContain("unknown_documents");   // not added to our review queue
  });
  it("★★ decided by the reader's own answer, not a guess", () => {
    expect(app).toContain('if (parsed.is_business_document === false) notDocWhat = String(parsed.what_it_shows || parsed.document_type || "a photo")');
    const prompt = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
    expect(prompt).toContain('"is_business_document": true or false');
    expect(prompt).toContain("never invent an amount or a vendor from a photo of an object");
  });
});
