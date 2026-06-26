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

// Company identity/accounting settings ↔ the `companies` table (O13). save() must
// persist ALL these fields, not just sales_tax_rate, or they're lost on refresh.
// All columns exist (000 baseline + 042 sales_tax_rate) — no migration. The logo (O62)
// persists as a base64 data URL stored directly in the existing `logo_path` text column
// (no Storage bucket / signed-URL plumbing, no new column, no user setup). The column was
// named for a Storage path but is plain text; storing the data URL there round-trips and
// renders inline (incl. invoice print). A Storage-bucket migration is a clean future
// optimization if logos get large — the UI caps upload size to keep the row sane.
// onboarding_complete is owned by completeOnboarding, so it's NOT written here.
export function buildCompanyUpdate(s = {}) {
  return {
    name: (s.name && String(s.name).trim()) || "Company",   // name is NOT NULL
    tax_id: s.taxId || null,
    address: s.address || null,
    city: s.city || null,
    state: s.state || null,
    zip: s.zip || null,
    country: s.country || "US",
    fiscal_year_end: s.fiscalYearEnd || "12-31",
    currency: s.currency || "USD",
    default_cash_account: s.defaultCashAccount || "1000",
    default_ap_account: s.defaultAPAccount || "2000",
    default_ar_account: s.defaultARAccount || "1100",
    business_type: s.businessType || null,
    sales_tax_rate: Number(s.salesTaxRate) || 0,
    logo_path: s.logoBase64 || null,   // O62: base64 data URL persisted here
  };
}

// The inverse: a `companies` row → the companySettings shape (used by loadAllData).
// Pairing it with buildCompanyUpdate makes the persist↔reload round-trip unit-testable.
export function mapCompanyRow(co = {}) {
  return {
    name: co.name || "",
    taxId: co.tax_id || "",
    address: co.address || "",
    city: co.city || "",
    state: co.state || "",
    zip: co.zip || "",
    country: co.country || "US",
    fiscalYearEnd: co.fiscal_year_end || "12-31",
    defaultCashAccount: co.default_cash_account || "1000",
    defaultAPAccount: co.default_ap_account || "2000",
    defaultARAccount: co.default_ar_account || "1100",
    currency: co.currency || "USD",
    logoBase64: co.logo_path || null,   // O62: read the persisted logo back
    businessType: co.business_type || "",
    salesTaxRate: Number(co.sales_tax_rate) || 0,
    onboardingComplete: !!co.onboarding_complete,
  };
}
