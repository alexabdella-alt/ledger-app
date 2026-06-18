// ─────────────────────────────────────────────────────────────────────────────
// Pure builders for DB write payloads, extracted so their column shape and types
// can be unit-tested against the authoritative live schema (tests/schemaContract
// .test.js). Two real bugs motivated this: (1) approval writes put an EMAIL into
// journal_entries.approved_by, a UUID column → Postgres rejects it → 0 rows →
// approval state silently never persisted (the same failure class as the paid_at
// bug); (2) account auto-creation wrote a non-existent `account_type` column and
// omitted the NOT-NULL `category`. Both now flow through these builders, so a
// regression that reintroduces the wrong column/type fails a test instead of
// silently failing in production.
//
// RULE: actor columns on journal_entries / reconciliations (approved_by,
// created_by, deleted_by, voided_by, completed_by) are UUID — always the user's
// id, never their email.
// ─────────────────────────────────────────────────────────────────────────────

// Approval-workflow field set written to journal_entries via persistApStatus.
// `actorUserId` MUST be the auth user's uuid (journal_entries.approved_by is uuid;
// there is no rejected_by column — the rejecter is recorded in approved_by).
export function buildApprovalUpdate({ decision, at = null, actorUserId = null, reason = null }) {
  switch (decision) {
    case "approved":
      return { approval_status: "approved", approved_at: at, approved_by: actorUserId };
    case "rejected":
      return {
        approval_status: "rejected", rejected_at: at, rejection_reason: reason,
        approved_by: actorUserId, payment_status: "rejected",
      };
    case "info_requested":
      return { approval_status: "info_requested" };
    default:
      return {};
  }
}

// accounts insert payload. Mirrors the correct shape used by addCustomAccount:
// the real column is `category` (NOT NULL), not `account_type`.
export function buildAccountInsert({ companyId, code, name, category = null }) {
  return {
    company_id: companyId, code, name,
    category: category || "Expenses",
    active: true, is_system: false, system_role: null,
  };
}
