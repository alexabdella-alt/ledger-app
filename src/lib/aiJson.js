// ─────────────────────────────────────────────────────────────────────────────
// C188 — robust JSON extraction from AI responses.
//
// The naive `JSON.parse(text.replace(/```json|```/g,"").trim())` blows up the moment
// a model returns valid JSON followed by ANY trailing text ("…}\nNote: this is an
// estimate.") — JSON.parse throws "unexpected non-whitespace character after JSON" and
// the caller's upload dies (O84 Part 1: a Gusto-style payroll CSV killed the upload
// silently). This scans for the FIRST balanced JSON object/array and parses exactly that
// span — ignoring anything before the first `{`/`[` and anything after the balanced close.
// NEVER throws; returns the parsed value or null.
// ─────────────────────────────────────────────────────────────────────────────

// Extract and parse the first balanced JSON value from an AI text response.
// Pure. Returns the parsed value, or null (garbage / truncated / no JSON).
export function extractFirstJson(text) {
  if (text == null) return null;
  // Strip markdown code fences (```json … ``` or bare ```), leaving the raw content.
  const s = String(text).replace(/```json/gi, "").replace(/```/g, "");
  const n = s.length;

  // Try each opening bracket in order: extract its balanced span and parse it. Return the
  // first span that parses — so a stray "[" in leading prose that isn't valid JSON is skipped
  // in favor of the real object/array that follows (still "the first balanced JSON").
  for (let start = 0; start < n; start++) {
    const open = s[start];
    if (open !== "{" && open !== "[") continue;
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < n; i++) {
      const ch = s[i];
      if (inStr) {
        // Inside a string: consume escapes so a `"` or a `{`/`}` in the text can't fool us.
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      // Count ONLY the root bracket type — a nested other-type ([ ] inside { }, or vice-versa)
      // is balanced within, so it can't prematurely close the root; nested SAME-type increments.
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const span = s.slice(start, i + 1);
          try { return JSON.parse(span); } catch { break; }   // not valid JSON → try the next opener
        }
      }
    }
    // Ran off the end unbalanced, or the span didn't parse — keep scanning from the next char.
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// O99 — THE SAME FRAGILE PARSE, WRITTEN OUT NINETEEN TIMES.
//
// `JSON.parse((d.content?.find(b=>b.type==="text")?.text||"{}").replace(/```json|```/g,"").trim())`
// appears verbatim across the upload, payroll, contract, QBO, onboarding and screening
// paths. It breaks the moment the model adds a sentence after the JSON — which is what
// killed the payroll parse mid-drive (C188) — and each copy has to be fixed separately.
//
// ★ THE MIGRATION PRESERVES BOTH EXISTING BEHAVIOURS EXACTLY, and that is deliberate:
//   · **no text at all** → the caller's fallback, exactly as `||"{}"` did. An absent reply
//     is not a parse failure, and turning it into one would convert benign no-ops into
//     user-visible errors across a dozen flows at once.
//   · **text that will not parse** → THROWS, exactly as `JSON.parse` did, so the existing
//     try/catch still runs. Returning the fallback here would be the silent-failure trade
//     this codebase spends most of its time undoing: garbage would read as "nothing found".
// The ONLY change is that trailing prose now parses instead of exploding — the actual bug.
// ─────────────────────────────────────────────────────────────────────────────

// The text block of an Anthropic Messages response. One place that knows the shape.
export function aiTextOf(data) {
  const blocks = data && data.content;
  if (!Array.isArray(blocks)) return "";
  const block = blocks.find((b) => b && b.type === "text");
  return (block && block.text) || "";
}

export function aiJson(data, fallback) {
  const text = String(aiTextOf(data) || "").trim();
  if (!text) return fallback;
  const parsed = extractFirstJson(text);
  if (parsed == null) {
    // Named so a console line says WHICH call produced unreadable output, rather than the
    // generic "unexpected non-whitespace character after JSON" that told us nothing.
    throw new Error("The AI reply didn't contain readable data.");
  }
  return parsed;
}
