// ════════════════════════════════════════════════════════════════════════════
// C197 — IA COLLAPSE (★ NORTH STAR Phase 2). WHO SEES WHICH WALLS.
//
// Shadow's client persona has no bookkeeper role, so the workbench surfaces
// (Bank Import, Reconcile, Matching, Payables, Payroll, Vendors, Documents…)
// are the CPA's cockpit — not tabs a business owner operates. This module is
// the single pure source of truth for that boundary: which top-level tabs a
// seat gets, which Books sub-tabs exist at all, and whether a given view id
// may be opened. The chrome renders from it and the route guard enforces it,
// so a stale link can never land a client on a surface that isn't theirs.
//
// The SEAT is derived from the SAME predicate as attestation (`canAttestPeriod`
// = the DB's `is_company_reviewer`, migration 051). That is deliberate: the
// separation-of-duties boundary and the IA-simplification boundary are ONE
// boundary — every surface gated to a reviewer disappears from the client's
// view for free, and the two can never drift apart into different answers.
//
// This module moves WALLS, not machinery: nothing here books, matches,
// reconciles, or attests. It only decides what is on screen.
// ════════════════════════════════════════════════════════════════════════════

import { canAttestPeriod } from "./signoff";

// Every view id that lives BEHIND the "Books" tab (the workbench group). Kept
// as one list so the tab's active-state, the sub-nav and the guard agree.
export const BOOKS_GROUP = [
  "books", "invoices", "ledger", "ap", "ar", "money-in", "money-out", "matching",
  "bank", "recon", "send-invoice", "vendors", "customers", "payroll", "docs",
  "detail", "contracts",
];

// The Books sub-nav, in render order. Reviewer-only by construction: the client
// seat gets an empty list, so these rows have no client-facing existence.
export const BOOKS_SUBTABS = [
  ["books", "Transactions"], ["books:contracts", "Contracts"], ["ap", "Payables"],
  ["vendors", "Vendors"], ["customers", "Customers"], ["send-invoice", "Send Invoice"],
  ["bank", "Bank Import"], ["recon", "Reconcile"], ["payroll", "Payroll"], ["docs", "Documents"],
];

// Settings lives behind the header gear, not the nav bar, and is NOT part of the
// IA collapse — a client still owns their company profile, team, taxes and audit
// trail. Listed here so the guard never bounces a client out of their own setup.
export const SETTINGS_VIEW_IDS = [
  "settings", "team", "coa", "opening-balances", "onboard", "rules", "recurring",
  "tax1099", "tax", "audit", "legal",
];

// What the CLIENT seat may open. Home + Reports are the nav; `detail` is the
// drill target BOTH client surfaces already push into (Home's activity feed and
// a Reports drill open a single transaction), so gating it would leave dead rows
// on screens the client is meant to use. Everything else is the cockpit.
export const CLIENT_VIEW_IDS = ["home", "dashboard", "reports", "detail", ...SETTINGS_VIEW_IDS];

// Every top-level view id the ERP router can render — the truth-table domain.
export const ALL_VIEW_IDS = [
  ...new Set([
    "home", "dashboard", "add", "reports", "review", "admin",
    ...BOOKS_GROUP, ...SETTINGS_VIEW_IDS,
  ]),
];

const CLIENT_TABS = [
  { id: "home",    label: "Home",    group: ["home", "dashboard"] },
  { id: "reports", label: "Reports", group: ["reports"] },
];

const REVIEWER_TABS = [
  { id: "home",    label: "Home",    group: ["home", "dashboard", "add"] },
  { id: "books",   label: "Books",   group: BOOKS_GROUP },
  { id: "reports", label: "Reports", group: ["reports"] },
  { id: "review",  label: "Review",  group: ["review"] },   // O50 — the CPA's trust-layer cockpit
];

// Is this session sitting in the REVIEWER seat (the cockpit) or the CLIENT seat?
// - reviewer roles (admin / accountant) → cockpit, exactly as `canAttestPeriod`.
// - platform admins → cockpit, so Support Mode can still reach every surface
//   (mirrors the `is_company_member` platform-admin bypass, Option A).
// - `previewAsOwner` → the client seat REGARDLESS of role: the demo toggle. It
//   changes only what is rendered, never the role and never write permission.
export function isReviewerSeat({ role = "owner", isPlatformAdmin = false, previewAsOwner = false } = {}) {
  if (previewAsOwner) return false;
  return canAttestPeriod(role) || !!isPlatformAdmin;
}

// THE nav description for a seat. Pure — the chrome renders straight from it.
//   seat          "reviewer" | "client"
//   tabs          the top-level tabs, in order (admin tab appended for platform admins)
//   booksSubtabs  the Books sub-nav rows ([] for a client — the row must not render)
//   viewIds       every view id this seat may open
export function visibleNav({ role = "owner", isPlatformAdmin = false, previewAsOwner = false } = {}) {
  const reviewer = isReviewerSeat({ role, isPlatformAdmin, previewAsOwner });
  const tabs = reviewer
    ? [...REVIEWER_TABS, ...(isPlatformAdmin ? [{ id: "admin", label: "⚙ Admin", group: ["admin"], admin: true }] : [])]
    : CLIENT_TABS;
  return {
    seat: reviewer ? "reviewer" : "client",
    isReviewerSeat: reviewer,
    tabs,
    booksSubtabs: reviewer ? BOOKS_SUBTABS : [],
    viewIds: reviewer ? ALL_VIEW_IDS : CLIENT_VIEW_IDS,
  };
}

// May this seat open this view? Unknown ids are treated as gated (fail closed).
export function canSeeView(viewId, opts = {}) {
  const v = String(viewId || "");
  if (!v) return false;
  if (v === "admin") return !!opts.isPlatformAdmin && isReviewerSeat(opts);
  return visibleNav(opts).viewIds.includes(v);
}

// Where a seat must be sent if it is sitting on a view it may not see. `null`
// means "stay put". Home is always the destination — never an error screen.
export function navRedirect(viewId, opts = {}) {
  return canSeeView(viewId, opts) ? null : "home";
}

// Plain language for the bounce. Cardinal Principle: no accounting concepts,
// no jargon, no blame — it says who has it and where you are, and nothing else.
export const GATED_VIEW_REDIRECT_COPY = "Your accountant looks after that part — here's your home page.";

// The demo toggle's own labels, so the copy tests can pin them.
export const PREVIEW_AS_OWNER_ENTER_LABEL = "Preview as owner";
export const PREVIEW_AS_OWNER_EXIT_LABEL = "Viewing as owner — switch back";
