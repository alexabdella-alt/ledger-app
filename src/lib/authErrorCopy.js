// ─────────────────────────────────────────────────────────────────────────────
// C421 — THE SIGN-IN SCREEN'S ERROR, IN THE PERSON'S WORDS.
//
// The auth screen showed `e.message` verbatim. Supabase's are mostly readable ("Invalid
// login credentials") and some are not what a person needs ("Email not confirmed" says what
// is wrong and not what to do; "Failed to fetch" is the browser talking). The first screen
// a client sees is held to the same bar as the rest. Unrecognised messages pass through
// when they read like a sentence, and are replaced when they read like code.
// ─────────────────────────────────────────────────────────────────────────────
const RULES = [
  [/invalid login credentials|invalid_credentials|invalid email or password/i, "That email and password don't match. Check both and try again."],
  [/email not confirmed|not confirmed/i, "Confirm your email first — there's a link in the message we sent you. Check spam if it isn't in your inbox."],
  [/already registered|already exists|user already/i, "There's already an account with that email — log in instead, or reset your password."],
  [/rate limit|too many requests|over_email_send_rate_limit/i, "Too many attempts just now — wait a few minutes and try again."],
  [/failed to fetch|fetch failed|networkerror|network|timeout/i, "We couldn't reach the server — check your connection and try again."],
  [/password should be|weak password|password is too short/i, "Choose a longer password — at least 6 characters."],
  [/invalid email|unable to validate email/i, "That doesn't look like an email address — check it and try again."],
];
const looksTechnical = (m) => /["{}\[\]<>_]|\b(pgrst\d*|postgres|supabase|jwt|rpc|sql|null|undefined|status code)\b/i.test(m) || m.length > 160;

export function authErrorCopy(raw) {
  const m = String(raw == null ? "" : raw).trim();
  if (!m) return "Something went wrong — please try again.";
  for (const [re, plain] of RULES) if (re.test(m)) return plain;
  return looksTechnical(m) ? "Something went wrong on our side — please try again in a moment." : m;
}
