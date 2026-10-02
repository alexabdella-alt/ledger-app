// ─────────────────────────────────────────────────────────────────────────────
// C567 — A TOOL RESULT THAT IS TOO LONG IS SHORTENED BY WHOLE ROWS, AND SAYS SO.
//
// The chat's tool loop used to send `JSON.stringify(out).slice(0, 50000)`. Past that
// length the JSON was cut mid-row — no closing brackets, no `truncated` flag, no note —
// and the model was left to answer from whatever it could make of the fragment. A
// 200-row transaction search with line items crosses that line, and the question it was
// answering ("everything we paid Sysco this year") is exactly the one where a partial
// list read as complete is a wrong answer delivered with confidence.
//
// So: when the result does not fit, the LARGEST LIST in it is cut back by whole rows
// until it does, and the result carries `_truncated` naming the list, how many rows are
// shown and how many there were. The JSON is always well-formed, the totals the tool
// computed over every row are left untouched, and the note tells the model to say the
// list is partial. A result with no list to shorten is refused in words, never cut.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const TOOL_RESULT_MAX_CHARS = 50000;

// The largest array at the top level, or one level down (`{ data: { rows: [...] } }`).
function largestList(out) {
  let best = null;
  const consider = (holder, key) => {
    const v = holder[key];
    if (!Array.isArray(v) || !v.length) return;
    const size = JSON.stringify(v).length;
    if (!best || size > best.size) best = { holder, key, size };
  };
  for (const k of Object.keys(out)) {
    consider(out, k);
    const v = out[k];
    if (v && typeof v === "object" && !Array.isArray(v)) for (const k2 of Object.keys(v)) consider(v, k2);
  }
  return best;
}

// Returns the string to send. Always parses as JSON.
export function capToolResult(out, max = TOOL_RESULT_MAX_CHARS) {
  const whole = JSON.stringify(out === undefined ? null : out);
  if (whole.length <= max) return whole;

  if (out && typeof out === "object" && !Array.isArray(out)) {
    // A copy, so the tool's own object is never changed. Tool results are plain data.
    const copy = structuredClone(out);
    const hit = largestList(copy);
    if (hit) {
      const full = hit.holder[hit.key];
      const of = full.length;
      const countDescribesList = hit.holder.count === of;
      const render = (n) => {
        hit.holder[hit.key] = full.slice(0, n);
        // A `count` that described the list it sits beside must describe the shortened one.
        if (countDescribesList) hit.holder.count = n;
        copy._truncated = {
          list: hit.key, shown: n, of,
          note: `Only the first ${n} of ${of} ${hit.key} fit in this reply. Any totals here still cover all ${of}. Tell the user the list is partial — never present it as complete.`,
        };
        return JSON.stringify(copy);
      };
      // Largest n that fits — the rows are ordered by the tool, so keep the first ones.
      let lo = 0, hi = of - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (render(mid).length <= max) lo = mid; else hi = mid - 1;
      }
      const s = render(lo);
      if (s.length <= max) return s;
    }
  }
  return JSON.stringify({
    error: "This result was too large to send in full, so none of it was sent. Ask a narrower question (a shorter period, one vendor, one category).",
    _truncated: { list: null, shown: 0, of: null },
  });
}
