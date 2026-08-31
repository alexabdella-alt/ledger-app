// ─────────────────────────────────────────────────────────────────────────────
// HOW MUCH READING WE CAN STILL DO THIS HOUR — IN DOCUMENTS, WHICH IS WHAT A PERSON HAS.
//
// `O113a` made the proxy return the remaining budget on every SUCCESSFUL call
// (`x-ratelimit-remaining-ai` / `-upload`), and deliberately exposed both through CORS so the
// browser could read them. **Nothing in `src/` ever did.** The value has been computed,
// exposed and sent faithfully ever since, with no reader — the §9 defect committed by the
// commit that fixed the limiter.
//
// ★★ AND THE READER IS THE POINT OF `O113b`, NOT A NICETY. The recorded finding is that the
// limit is not "20 documents" but **"20 documents minus whatever else you did this hour"**,
// which no user can compute — so *"the same action succeeds or fails depending on invisible
// prior spend from a different feature."* **The fix for that is not a bigger number; it is a
// number you can see.** Today you discover the ceiling by hitting it.
//
// ★★★ SO THIS REPORTS DOCUMENTS, NEVER API CALLS. A person has a stack of invoices, not a
// quota of HTTP requests, and the two buckets bind at different rates (an invoice costs three
// AI calls and one upload). **The honest figure is the smaller of the two** — which also means
// `O113b`'s "both walls sit at 20 files" stops being something the user has to know.
//
// Pure. The last-seen values live in a module-level cell, the same shape `checkedWrite.js`
// uses for write failures, so a lib function deep in the fetch path can record without every
// caller having to thread it back.
// ─────────────────────────────────────────────────────────────────────────────

// What one document costs, on the invoice path: classify → extract → code, plus one upload.
// ★ THE CONSERVATIVE ASSUMPTION ON PURPOSE. A bank statement costs two AI calls, so quoting
// the cheaper path would promise more documents than we can actually read — and a budget
// display that overstates is worse than none, because it is trusted right up to the moment
// it is wrong.
export const AI_CALLS_PER_DOCUMENT = 3;
export const UPLOAD_CALLS_PER_DOCUMENT = 1;

let last = null;   // { ai, upload } — the most recent successful call's headers

// Header values are strings and may be absent (an older proxy, a cached response, a
// non-upload call which sends no upload header). Absent ⇒ null ⇒ "we don't know", never 0:
// **zero is a claim that you are out, and we must not make it because a header was missing.**
function num(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function readBudgetHeaders(headers) {
  if (!headers || typeof headers.get !== "function") return null;
  const ai = num(headers.get("x-ratelimit-remaining-ai"));
  const upload = num(headers.get("x-ratelimit-remaining-upload"));
  if (ai == null && upload == null) return null;
  return { ai, upload };
}

// Called from the fetch path. Merges rather than replaces: a non-upload call carries no
// upload header, and dropping the last known upload figure on every AI call would make the
// number flicker between known and unknown for no reason the user could understand.
export function recordBudget(next) {
  if (!next) return;
  last = {
    ai: next.ai != null ? next.ai : last?.ai ?? null,
    upload: next.upload != null ? next.upload : last?.upload ?? null,
  };
}

export function getBudget() { return last; }
export function resetBudget() { last = null; }

// ★ THE TRANSLATION THAT MATTERS: buckets → documents. The binding constraint is whichever
// bucket runs out first, so the answer is the MINIMUM. Unknown buckets are skipped rather
// than assumed generous.
export function documentsRemaining(budget = last) {
  if (!budget) return null;
  const candidates = [];
  if (budget.ai != null) candidates.push(Math.floor(budget.ai / AI_CALLS_PER_DOCUMENT));
  if (budget.upload != null) candidates.push(Math.floor(budget.upload / UPLOAD_CALLS_PER_DOCUMENT));
  if (!candidates.length) return null;
  return Math.max(0, Math.min(...candidates));
}

// When it is worth saying anything at all. Showing "57 documents left" to someone dropping
// one receipt is noise, and noise is how a warning stops being read.
export const BUDGET_QUIET_ABOVE = 12;

// The sentence, or null. Plain language, no mention of buckets, calls or limits-per-hour.
export function budgetCopy(budget = last, { pending = 0 } = {}) {
  const left = documentsRemaining(budget);
  if (left == null) return null;                       // we genuinely do not know — say nothing
  const n = Math.max(0, Number(pending) || 0);

  // ★ OUT: this is the one case worth saying loudly, and it is said BEFORE the wall rather
  // than after. Nothing is lost — the queue keeps the files and picks them up when the hour
  // turns — so the sentence has to carry that or it reads as failure.
  if (left === 0) {
    return n > 0
      ? `We've read as much as we can this hour. Your remaining ${n === 1 ? "document is" : `${n} documents are`} saved and will carry on automatically.`
      : "We've read as much as we can this hour. Anything you add now will be picked up automatically.";
  }
  // ★ THE CASE THIS EXISTS FOR: more work queued than budget. Said in advance, so the person
  // can decide, rather than discovered when files start failing.
  if (n > left) {
    return `We can read about ${left} more document${left === 1 ? "" : "s"} this hour — the other ${n - left} will carry on automatically after that.`;
  }
  if (left <= BUDGET_QUIET_ABOVE) {
    return `About ${left} more document${left === 1 ? "" : "s"} can be read this hour.`;
  }
  return null;                                          // plenty — nothing worth saying
}
