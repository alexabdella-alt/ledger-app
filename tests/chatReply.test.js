import { describe, it, expect } from "vitest";
import { composeAssistantReply } from "../src/lib/chatReply.js";

// The chatbot false-success bug: it replied "✓ reclassed" while the DB write hadn't
// committed. The displayed message must derive from the VERIFIED action result — never a
// bare success when a mutating write failed.
describe("composeAssistantReply — never claim success on a failed write", () => {
  it("no failures → the AI's reply stands", () => {
    expect(composeAssistantReply({ reply: "✓ Reclassed to Professional Services.", actionFailures: [], actionSummary: ["Recoded 1 invoice"] }))
      .toBe("✓ Reclassed to Professional Services.");
  });

  it("a failed action → surfaces the failure, NOT the optimistic success", () => {
    const out = composeAssistantReply({ reply: "✓ Reclassed to Professional Services.", actionFailures: ["recode (Professional Services)"] });
    expect(out).toMatch(/didn't go through/i);
    expect(out).toMatch(/recode/);
    expect(out).not.toMatch(/✓/);                 // the false "done" is gone
  });

  it("partial: some applied, some failed → reports both honestly", () => {
    const out = composeAssistantReply({ reply: "Done!", actionFailures: ["recode (Rent)"], actionSummary: ["Voided 1 entry"] });
    expect(out).toMatch(/didn't go through/i);
    expect(out).toMatch(/Voided 1 entry/);         // what did apply is still acknowledged
  });

  it("empty reply with no failures → safe default", () => {
    expect(composeAssistantReply({ reply: "", actionFailures: [] })).toBe("Done!");
    expect(composeAssistantReply({})).toBe("Done!");
  });
});
