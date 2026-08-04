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
