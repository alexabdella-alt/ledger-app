// ─────────────────────────────────────────────────────────────────────────────
// C415 — A FAILED WRITE'S REASON, IN WORDS A PERSON CAN ACT ON.
//
// Twenty-seven toasts ended with `${r?.error}` — the database's own sentence. On a
// vendor's edit form that read: "We couldn't save Sysco's details — nothing was changed.
// new row violates row-level security policy for table "contacts"". True, and useless:
// the person has no move. The checked-write helpers return the raw message on purpose
// (the console and the audit trail need it); this maps it to the one thing the person
// can do about it, and OMITS anything it does not recognise rather than quoting it —
// a sentence that looks like code is worse than no reason, because it reads as broken.
//
// Pure. The raw message is never lost: every caller still has `r.error` for the console.
// ─────────────────────────────────────────────────────────────────────────────

const RULES = [
  [/row-level security|permission denied|insufficient_privilege|not allowed/i, "You don't have permission to change this — ask an admin on your company."],
  [/signed off by your accountant|has been signed off/i, null],   // the 078 trigger's own sentence is already the owner's
  [/duplicate key|already exists|unique constraint/i, "There's already one with that name."],
  [/0 rows|zero rows|no rows|matched nothing|not found|does not exist any more|no longer/i, "We couldn't find that record any more — reload the page and try again."],
  [/failed to fetch|fetch failed|networkerror|network|timeout|timed out/i, "The connection dropped — check your network and try again."],
  [/jwt|expired|401|403|not authenticated|auth session/i, "Your sign-in has expired — sign out and back in, then try again."],
  [/violates check constraint|invalid input|out of range|invalid_/i, "One of the values wasn't accepted — check what you typed."],
  [/column .* does not exist|relation .* does not exist|schema cache|function .* does not exist/i, "Something on our side needs fixing — nothing you typed is wrong. Your accountant can see the details in the activity log."],
];

// Does the message look like it was written for a person? Code-shaped text (quotes,
// underscores, brackets, table names) is not shown.
const looksTechnical = (m) => /["{}\[\]<>_]|\b(pgrst\d*|postgres|supabase|rpc|sql|null|undefined|row_count|constraint|error code)\b/i.test(m) || m.length > 160;

export function plainWriteError(raw, fallback = "") {
  const m = String(raw == null ? "" : raw).trim();
  if (!m) return fallback;
  for (const [re, plain] of RULES) if (re.test(m)) return plain === null ? m : plain;
  return looksTechnical(m) ? fallback : m;
}
