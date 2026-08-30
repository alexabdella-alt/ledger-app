import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { aiJson, aiTextOf, extractFirstJson } from "../src/lib/aiJson";

// ═════════════════════════════════════════════════════════════════════════════
// O99 — THE SAME FRAGILE PARSE, WRITTEN OUT NINETEEN TIMES, NOW WRITTEN ONCE.
//
// `JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(...).trim())`
// appeared verbatim across upload, payroll, contracts, QBO, onboarding, screening and
// reconcile. It breaks the moment the model adds a sentence after the JSON — which is what
// killed the payroll parse mid-drive (C188) — and every copy had to be fixed separately.
// C188 fixed ONE of them and listed the other nineteen for "deliberate migration".
// ═════════════════════════════════════════════════════════════════════════════

const msg = (text) => ({ content: [{ type: "text", text }] });

describe("★★ the migration preserves BOTH old behaviours and changes only the bug", () => {
  it("★ no text at all → the caller's fallback, exactly as `||\"{}\"` did", () => {
    // An absent reply is not a parse failure. Turning it into one would convert benign
    // no-ops into user-visible errors across a dozen flows at once.
    expect(aiJson({ content: [] }, {})).toEqual({});
    expect(aiJson(msg("   "), [])).toEqual([]);
    expect(aiJson(null, [])).toEqual([]);
  });

  it("★★ text that will not parse → THROWS, exactly as JSON.parse did", () => {
    // Returning the fallback here would be the silent-failure trade this codebase spends
    // most of its time undoing: garbage would read as "nothing found".
    expect(() => aiJson(msg("I'm sorry, I can't help with that."), [])).toThrow(/readable data/);
  });

  it("★★★ AND THE ACTUAL FIX: trailing prose now parses instead of exploding", () => {
    const reply = '```json\n{"vendor":"Roma","amount":551.2}\n```\nLet me know if you need anything else.';
    expect(() => JSON.parse(reply.replace(/```json|```/g, "").trim())).toThrow();  // the old way
    expect(aiJson(msg(reply), {})).toEqual({ vendor: "Roma", amount: 551.2 });     // the new way
  });

  it("leading prose too — the shape the payroll drive actually died on", () => {
    expect(aiJson(msg('Here is the register:\n[{"gross":4000}]'), [])).toEqual([{ gross: 4000 }]);
  });

  it("aiTextOf is the one place that knows the response shape", () => {
    expect(aiTextOf(msg("x"))).toBe("x");
    expect(aiTextOf({ content: [{ type: "tool_use" }, { type: "text", text: "y" }] })).toBe("y");
    expect(aiTextOf({})).toBe("");
    expect(aiTextOf({ content: "not an array" })).toBe("");
  });
});

describe("★★ two real defects the sweep exposed, which were not in the item", () => {
  it("★ the greedy brace regex spanned FROM the first { TO the last }", () => {
    // ClarificationFlow matched /\{[\s\S]*\}/ — greedy. Given a reply with two objects that
    // produces a string that is not JSON at all, so the account lookup failed on exactly
    // the replies that contained an answer.
    const two = '{"gl_code":"6100","gl_name":"Rent"} and an alternative {"gl_code":"7100"}';
    const greedy = two.match(/\{[\s\S]*\}/)[0];
    expect(() => JSON.parse(greedy)).toThrow();
    expect(extractFirstJson(two)).toEqual({ gl_code: "6100", gl_name: "Rent" });
  });

  it("★★ the 'recovery' catch re-ran the identical call and could never recover anything", () => {
    // `try { JSON.parse(raw) } catch { try { JSON.parse(raw) } catch { [] } }` — the second
    // attempt is the same call on the same string, so it was two ways of writing
    // `catch { [] }` while reading like a fallback strategy.
    const raw = "not json";
    let first = null, second = null;
    try { JSON.parse(raw); } catch (e) { first = e.message; }
    try { JSON.parse(raw); } catch (e) { second = e.message; }
    expect(second).toBe(first);
  });
});

describe("★★ nothing parses an AI reply by hand any more", () => {
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, f.name);
      if (f.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(f.name)) files.push(full);
    }
  })(path.join(process.cwd(), "src"));

  it("★★★ zero raw `JSON.parse` on a model reply remains in src/", () => {
    const offenders = [];
    for (const f of files) {
      const rel = path.relative(process.cwd(), f);
      // `aiJson.js` IS the parser and `ai.js` holds the specialised action-object scanner
      // that must read many objects out of one reply — both are the intended homes.
      if (rel.endsWith("lib/aiJson.js") || rel.endsWith("lib/ai.js")) continue;
      const text = fs.readFileSync(f, "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
      for (const m of text.matchAll(/JSON\.parse\(([^)]{0,160})/g)) {
        // Local/browser state is not a model reply.
        if (/localStorage|sessionStorage/.test(m[1])) continue;
        offenders.push(`${rel}: JSON.parse(${m[1].slice(0, 60)}…`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("★ and the response-shape boilerplate is gone with it", () => {
    // `d.content?.find(b=>b.type==="text")?.text` was repeated at every call site, so a
    // change to the API's shape meant nineteen edits. It now lives in `aiTextOf`.
    const offenders = [];
    for (const f of files) {
      const rel = path.relative(process.cwd(), f);
      if (rel.endsWith("lib/aiJson.js") || rel.endsWith("lib/ai.js")) continue;
      const text = fs.readFileSync(f, "utf8");
      const hits = (text.match(/content\?\.find\(b\s*=>\s*b\.type\s*===\s*"text"\)/g) || []).length;
      if (hits) offenders.push(`${rel} (${hits})`);
    }
    expect(offenders).toEqual([]);
  });
});
