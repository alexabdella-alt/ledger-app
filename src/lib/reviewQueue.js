// ─────────────────────────────────────────────────────────────────────────────
// CPA Review queue assembly (O50) — the trust-layer capstone's data model.
//
// Pure: combines what O60 and O49 already produce into ONE review surface +
// a summary, so the screen and its tests share one source of truth.
//   • completeness  ← O60 reconcileDroppedDocs / fetchDroppedIntake (dropped/stuck/errored docs)
//   • needsReview   ← O49 flaggedForReview (low-confidence-AND-material transactions)
//   • unknown       ← the legacy unclassified-document queue (kept; folded into the surface)
//
// "allClear" (nothing across all three) is the reassuring signal that the books are
// trustworthy — the empty state the screen renders.
// ─────────────────────────────────────────────────────────────────────────────

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export function buildReviewQueue({ droppedDocs = [], flaggedTxns = [], unknownDocs = [] } = {}) {
  const completeness = droppedDocs || [];
  const needsReview = flaggedTxns || [];
  const unknown = (unknownDocs || []).filter((d) => !d.posted);   // posted ones are resolved

  const totalExposure = r2(needsReview.reduce((s, f) => s + Math.abs(Number(f.amount) || 0), 0));
  const highCount = needsReview.filter((f) => f.severity === "high").length;

  const summary = {
    incompleteCount: completeness.length,
    flaggedCount: needsReview.length,
    unknownCount: unknown.length,
    highCount,
    totalExposure,
    totalItems: completeness.length + needsReview.length + unknown.length,
    allClear: completeness.length === 0 && needsReview.length === 0 && unknown.length === 0,
  };

  return { completeness, needsReview, unknown, summary };
}
