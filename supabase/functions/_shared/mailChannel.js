// ─────────────────────────────────────────────────────────────────────────────
// THE EMAIL CHANNEL'S DECISIONS — one implementation, imported by the edge functions AND
// the client. docs/EMAIL_CHANNEL_SPEC_O82.md.
//
// ★ WHY THIS LIVES UNDER supabase/functions/_shared AND NOT src/lib: a Supabase edge
// function may import only from its own directory tree, and the client may import from
// anywhere in the repo. Putting the rules here is the only placement where the receiver
// and the Settings screen run the SAME sender wall and the SAME receipt sentence. Two
// copies is the ·3a shape — each half tested against its own fixture, agreeing with
// nothing — and this repo has paid for it three times.
//
// Pure. No I/O, no clock (callers pass `now`), no randomness (callers pass tokens).
// ─────────────────────────────────────────────────────────────────────────────

export const INBOUND_LOCAL_PREFIX = "docs-";
export const INBOUND_SUBDOMAIN = "in";

// Spec §2.6 — what the pipeline can read. Anything else is KEPT (stored as `other`) and
// not processed; the receipt says so.
export const READABLE_TYPES = new Set([
  "application/pdf",
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/gif",
  "text/csv", "application/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

// Spec §2.6 — per company. The receiver has no user to lean on, so the company is the actor.
export const INBOUND_LIMITS = { perHour: 50, perDay: 200 };

export const INBOUND_STATUS = {
  ACCEPTED: "accepted",
  UNKNOWN_SENDER: "unknown_sender",
  RATE_LIMITED: "rate_limited",
  NO_ATTACHMENTS: "no_attachments",
  REPLY: "reply",
  UNREADABLE: "unreadable",
};

export const normalizeEmail = (s) => String(s == null ? "" : s).trim().toLowerCase()
  // "Alex <alex@x.com>" → alex@x.com
  .replace(/^.*<([^>]+)>.*$/, "$1").trim();

export const isInboundToken = (t) => typeof t === "string" && /^[a-z0-9]{10,32}$/.test(t);

export function inboundAddress(token, domain) {
  if (!isInboundToken(token) || !domain) return null;
  return `${INBOUND_LOCAL_PREFIX}${token}@${INBOUND_SUBDOMAIN}.${domain}`;
}

// The token out of a To: address, or null. Case-insensitive on the local part because
// mail servers lowercase freely; the token itself is minted lowercase.
export function inboundTokenOf(toAddress) {
  const m = normalizeEmail(toAddress).match(/^docs-([a-z0-9]{10,32})@/);
  return m ? m[1] : null;
}

// ── THE SENDER WALL (spec §2.2) ──────────────────────────────────────────────
// Accepted when From: is a member of the company or an address the company allowed.
// Both lists are compared normalised. An empty From: is never allowed.
export function senderAllowed({ from, memberEmails = [], allowedSenders = [] } = {}) {
  const f = normalizeEmail(from);
  if (!f || !f.includes("@")) return false;
  const ok = new Set([...(memberEmails || []), ...(allowedSenders || [])].map(normalizeEmail).filter(Boolean));
  return ok.has(f);
}

// ── PER-COMPANY INBOUND COUNTERS (spec §2.6) ────────────────────────────────
// Reads, decides, and returns the charged counters ONLY when allowed — a refused message
// is not charged for (O113a's rule, one actor over). Windows are fixed from the first
// message in them; a rolling window would need a log, and 50/hour is a wall against a
// runaway forwarder, not a fairness mechanism.
export function bumpInboundCounters(counters = {}, now, limits = INBOUND_LIMITS) {
  const t = new Date(now).getTime();
  const hourAt = counters.inbound_hour_at ? new Date(counters.inbound_hour_at).getTime() : 0;
  const dayAt = counters.inbound_day_at ? new Date(counters.inbound_day_at).getTime() : 0;
  const hourFresh = t - hourAt < 3600e3;
  const dayFresh = t - dayAt < 86400e3;
  const hour = hourFresh ? Number(counters.inbound_hour_count || 0) : 0;
  const day = dayFresh ? Number(counters.inbound_day_count || 0) : 0;
  if (hour >= limits.perHour || day >= limits.perDay) {
    return { allowed: false, counters: { ...counters }, reason: hour >= limits.perHour ? "hour" : "day" };
  }
  return {
    allowed: true,
    counters: {
      inbound_hour_count: hour + 1, inbound_hour_at: hourFresh ? counters.inbound_hour_at : new Date(t).toISOString(),
      inbound_day_count: day + 1, inbound_day_at: dayFresh ? counters.inbound_day_at : new Date(t).toISOString(),
    },
  };
}

// ── WHAT A MESSAGE BECOMES (spec §2.3) ──────────────────────────────────────
// The receiver stores bytes and rows; THIS decides what rows. It never sees the bytes.
//   attachments: [{ filename, contentType, size }]
// Returns { status, intake: [{ filename, contentType, process, reason }], replyToken }.
export function planInboundMessage({
  from, to, subject = "", attachments = [], memberEmails = [], allowedSenders = [],
  counters = {}, now, limits = INBOUND_LIMITS,
} = {}) {
  const replyToken = replyTokenIn(subject);
  if (!senderAllowed({ from, memberEmails, allowedSenders })) {
    return { status: INBOUND_STATUS.UNKNOWN_SENDER, intake: [], replyToken, counters };
  }
  const bump = bumpInboundCounters(counters, now, limits);
  if (!bump.allowed) {
    return { status: INBOUND_STATUS.RATE_LIMITED, intake: [], replyToken, counters: bump.counters, limitHit: bump.reason };
  }
  if (replyToken) {
    // A reply to something we sent is evidence for its subject, never a document drop —
    // even if the person attached something. Phase A stores the reply text; a person acts.
    return { status: INBOUND_STATUS.REPLY, intake: [], replyToken, counters: bump.counters };
  }
  const intake = (attachments || []).map((a) => {
    const type = String(a.contentType || "").toLowerCase().split(";")[0].trim();
    const size = Number(a.size || 0);
    if (size > MAX_ATTACHMENT_BYTES) return { filename: a.filename, contentType: type, process: false, reason: "too_large" };
    if (!READABLE_TYPES.has(type)) return { filename: a.filename, contentType: type, process: false, reason: "unreadable_type" };
    return { filename: a.filename, contentType: type, process: true, reason: null };
  });
  if (!intake.length) return { status: INBOUND_STATUS.NO_ATTACHMENTS, intake, replyToken: null, counters: bump.counters };
  return { status: INBOUND_STATUS.ACCEPTED, intake, replyToken: null, counters: bump.counters };
}

// ── REPLY TOKENS ─────────────────────────────────────────────────────────────
// Carried in the subject as [SC-<token>] so it survives every mail client's reply chain;
// also set as a header when the provider allows it. A token is 16–40 lowercase
// alphanumerics — the DB CHECK in 090 says the same thing.
export const isReplyToken = (t) => typeof t === "string" && /^[a-z0-9]{16,40}$/.test(t);
export const replyTokenTag = (token) => (isReplyToken(token) ? `[SC-${token}]` : "");
export function replyTokenIn(subject) {
  const m = String(subject || "").match(/\[SC-([a-z0-9]{16,40})\]/i);
  return m ? m[1].toLowerCase() : null;
}

// The reply's own text: everything above the first quoted-original marker. Best effort —
// a client that quotes differently leaves the whole body, which is stored as-is; nothing
// downstream parses it as an instruction (spec §4.5).
export function replyBodyOf(text) {
  const s = String(text || "");
  const cut = s.search(/^(On .+ wrote:|-----Original Message-----|From: .+|>)/m);
  return (cut >= 0 ? s.slice(0, cut) : s).trim();
}

// ── COPY — derived from the plan, never composed alongside it (§9) ──────────
// The receipt reads the intake rows the receiver CREATED (`saved`) and the ones it kept
// but will not process (`kept`). It never says "booked": at the moment it is sent, saved
// is what is true. Phase A: the drain books when the company is next opened.
export function receiptCopy({ saved = 0, kept = 0, companyName = "" } = {}) {
  const docs = (n) => `${n} document${n === 1 ? "" : "s"}`;
  const files = (n) => `${n} file${n === 1 ? "" : "s"}`;
  if (saved === 0 && kept === 0) {
    return {
      subject: "We didn't find anything to save",
      body: `Your email arrived, but it had no attachments we could keep. Forward the invoice, receipt or statement as an attachment and we'll save it.`,
    };
  }
  let body = saved > 0
    ? `Got it — ${docs(saved)} saved${companyName ? ` for ${companyName}` : ""}. ${saved === 1 ? "It" : "They"}'ll be added to your books the next time your books are opened.`
    : `Your email arrived.`;
  if (kept > 0) body += ` We kept ${files(kept)} we can't read (only PDFs, photos and spreadsheets are read).`;
  return { subject: saved > 0 ? `Saved: ${docs(saved)}` : "Received, but we couldn't read the attachments", body };
}

// A message from an address we do not know. Shown on Home; the sender is NAMED so
// "allow" is a decision about a person, not a button.
export function unknownSenderCopy({ from, subject }) {
  const s = subject ? ` ("${subject}")` : "";
  return `An email from ${normalizeEmail(from)}${s} arrived at your documents address and we didn't recognise the sender. Allow them, or ignore it.`;
}

// Words the channel never uses on an owner-facing surface. The receipt and the question
// bodies are checked against the app's own jargon guard in tests; this is the short list
// the copy above is written against so the guard has nothing to find.
export const CHANNEL_KINDS = ["receipt", "question", "invoice", "report", "digest"];
