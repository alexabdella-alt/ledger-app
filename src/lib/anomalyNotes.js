// ─────────────────────────────────────────────────────────────────────────────
// ANOMALY NOTES + EVIDENCE — the last two of the review-card trio.
//
// The first (linking to the transactions being judged) shipped 2026-08-29. These two share
// its finding: **dismissing an anomaly is a judgement, and the screen was set up so the
// judgement had to be made alone and recorded as a bare sentence.**
//
//   (1) COMMENT WITHOUT DISMISSING. The owner is often the only person who knows why a
//       charge is fine — *"that Sysco double-charge was a deposit and a bill"* — and the
//       only verb on the card is one they are permanently not allowed to use. So the
//       knowledge either reaches the reviewer through some other channel or evaporates.
//       ★ A COMMENT IS NOT A CLEAR ACTION. It never touches `status`, which is what keeps
//       separation of duties intact: the owner informs the judgement, the reviewer makes
//       it. Client-side dismissal would be self-attestation, one anomaly at a time.
//
//   (2) EVIDENCE ATTACHED TO A DISMISSAL. A reason says what someone concluded; a document
//       shows why. A future auditor reading *"vendor agreement covers this"* has to take it
//       on trust; one reading it beside the agreement does not.
//       ★★ EVIDENCE IS OPTIONAL AND MUST STAY OPTIONAL. Legitimate dismissals often have
//       none — a verbal confirmation, an obvious re-read — and a hard requirement would
//       push reviewers to attach whatever is nearest, which is worse than nothing because
//       it LOOKS like support. The reason stays required (the floor); evidence is the
//       ceiling, and above a threshold we SUGGEST rather than block.
//
// Pure. No client, no I/O — so a test can assert the prompt cannot reach anything but the
// record it is handed.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_COMMENT_CHARS = 2000;

// ★ A WORKING NUMBER, NAMED AS ONE. Above this, clearing a flag without support is the
// higher-risk call, so the card suggests attaching something. It is a PROMPT, never a gate
// — see the header. If it ever becomes a gate, the reason it must not is written above it.
export const EVIDENCE_SUGGESTED_ABOVE = 1000;

export function validateComment(text) {
  const t = String(text == null ? "" : text).trim();
  if (!t) return { ok: false, text: "", error: "Write something first." };
  if (t.length > MAX_COMMENT_CHARS) {
    return { ok: false, text: t, error: `That's longer than we can store — keep it under ${MAX_COMMENT_CHARS} characters.` };
  }
  return { ok: true, text: t, error: null };
}

// Newest last, so a thread reads top-to-bottom like a conversation. Rows with no timestamp
// sort to the end rather than being dropped — a note we cannot place is still a note.
export function commentsFor(rows = [], anomalyId) {
  const key = String(anomalyId == null ? "" : anomalyId);
  return (rows || [])
    .filter((r) => r && String(r.anomaly_id) === key)
    .slice()
    .sort((a, b) => String(a.created_at || "9999").localeCompare(String(b.created_at || "9999")));
}

// ── THE SOFT PROMPT ──────────────────────────────────────────────────────────
// Reads the AMOUNTS OF THE LINKED ENTRIES, not the anomaly's title or detail text. §9: a
// sentence about what the system did must be derived from the record. A prompt keyed on
// the words "large" or "duplicate" would fire on a $12 charge whose title happened to say
// so, and stay silent on a $40,000 one whose title did not.
export function evidencePrompt({ amounts = [], attachedCount = 0, threshold = EVIDENCE_SUGGESTED_ABOVE } = {}) {
  if (attachedCount > 0) return { suggest: false, sentence: null, largest: null };
  const nums = (amounts || []).map((a) => Math.abs(Number(a) || 0)).filter((n) => n > 0);
  const largest = nums.length ? Math.max(...nums) : 0;
  if (!(largest > threshold)) return { suggest: false, sentence: null, largest };
  return {
    suggest: true,
    largest,
    // No jargon, no instruction to do it — it says why it is asking and leaves the choice.
    sentence: "This one's large enough that a future reader may want to see what convinced you. Attaching something is optional.",
  };
}

// ── WHAT THE HISTORY SAYS ────────────────────────────────────────────────────
// Built from the STORED row — the reason as recorded and the count of documents actually
// linked — never from what the person was about to submit. §9: every clause names a field
// of the outcome. `docs` is the resolved document list, so a reference that no longer
// resolves reduces the count rather than being asserted.
export function dismissalSummary(anomaly = {}, docs = []) {
  const reason = String(anomaly.dismissed_reason || "").trim();
  if (!reason) return null;
  const ids = Array.isArray(anomaly.evidence_doc_ids) ? anomaly.evidence_doc_ids.map(String) : [];
  const found = (docs || []).filter((d) => d && ids.includes(String(d.id)));
  const missing = ids.length - found.length;
  const parts = [reason];
  if (found.length) parts.push(`${found.length} document${found.length === 1 ? "" : "s"} attached`);
  // A vanished attachment is REPORTED, not quietly uncounted — the same rule the card's
  // entry links follow (O87(v)): silence made three cards unplaceable.
  if (missing > 0) parts.push(`${missing} attached document${missing === 1 ? "" : "s"} can no longer be found`);
  return parts.join(" · ");
}
