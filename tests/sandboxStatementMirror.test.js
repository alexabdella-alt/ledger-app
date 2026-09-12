import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { AI_ALLOWED_ACTIONS } from "../src/lib/aiCapabilities.js";

// The model is TOLD what it may do (the sandbox statement, server-owned in aiProfiles.js)
// and the action loop ENFORCES what it may do (AI_ALLOWED_ACTIONS, client-owned). Two
// copies of one contract — the ·3a shape — and the client's copy of the statement is now
// documentation only (C331's sweep: exported, imported by nothing). If the two lists drift,
// the model is either promised an action the loop refuses (a visible "I couldn't do that"
// on something it was told it could) or allowed an action it was never told about (dead
// capability). Pinned in both directions, parsed from the prompt text rather than retyped.
const server = fs.readFileSync(new URL("../supabase/functions/ai-proxy/aiProfiles.js", import.meta.url), "utf8");
const client = fs.readFileSync(new URL("../src/lib/aiCapabilities.js", import.meta.url), "utf8");

const listed = (src) => {
  const m = /exact list: ([^.]*?)\. Any other action/.exec(src);
  if (!m) return null;
  // "delete_invoice (soft-delete, recoverable)" carries a parenthetical with a comma in it.
  return m[1].replace(/\([^)]*\)/g, "").split(",").map((s) => s.trim()).filter(Boolean).sort();
};

describe("the sandbox statement and the enforced whitelist name the same actions", () => {
  it("the server prompt's list is exactly AI_ALLOWED_ACTIONS", () => {
    const s = listed(server);
    expect(s).not.toBeNull();
    expect(s).toEqual([...AI_ALLOWED_ACTIONS].sort());
  });
  it("the client's documentation copy has not drifted from the server's", () => {
    expect(listed(client)).toEqual(listed(server));
  });
});
