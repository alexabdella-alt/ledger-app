// ════════════════════════════════════════════════════════════════════════════
// C197 / C312 / C320 — IA COLLAPSE (★ NORTH STAR Phase 2). WHO SEES WHICH WALLS,
// AND HOW THE ONES THEY DO SEE ARE ARRANGED — one sidebar, plus a review layer.
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

// ── ONE SIDEBAR (C320) ────────────────────────────────────────────────────────
//
// ★★★ THE TWO SEATS ARE NOT TWO PRODUCTS. Operator, 2026-09-11: *"I don't think the
// two views should really be too different. The owner needs to see all the info they
// need — we're pretty much there. We don't need all these tabs in the other view. The
// full view for the CPA is more just an over-the-top review."*
//
// C312 gave the CPA a fourteen-row grouped cockpit (Ledger · Money in · Money out ·
// Bank · Records) and C313/C314 gave the owner eight plain rows. That was two navs
// for one company's books. The owner's eight rows ARE the product; the CPA's extra
// is a REVIEW LAYER — the queue, the sign-off, the exception tools — not a parallel
// set of destinations.
//
// ★★ SO: EVERYONE GETS THE SAME EIGHT ROWS, AND A REVIEWER GETS ONE MORE — Review.
// The workbench screens (Bank Import, Reconcile, Matching, Payroll) keep existing and
// stay openable by a reviewer, but they are reached FROM the review layer — Review's
// tool strip, the exception cards, Home's routing — not from the sidebar. A tab that
// exists so a CPA can wander to it is exactly the QBO-bookkeeper IA the North Star
// names; a tool you reach from the card that needs it is the review layer working.
//
// ★ ONE VOCABULARY, TOO. With one nav there is one set of labels, and it is the plain
// one: a CPA reading "Bills to pay" loses nothing, an owner reading "Payables" is
// being asked to know something. §9 EXEMPTS reviewer copy from the jargon bar; it
// never required jargon.
//
// Rows are [viewId, label]. `books:contracts` was a filter row in the old cockpit and
// is now reached from the Transactions screen itself.
export const NAV_SECTIONS = [
  { id: "main", label: null, items: [
    ["home", "Home"], ["books", "Transactions"],
    ["ap", "Bills to pay"], ["ar", "Money owed to you"],
    ["customers", "Customers"], ["vendors", "Vendors"],
    ["docs", "Documents"], ["reports", "Reports"],
  ] },
];

// The review layer — the ONE row a reviewer has that an owner does not. Everything
// CPA-shaped hangs off this screen rather than off the sidebar.
export const NAV_SECTION_REVIEW = { id: "review", label: null, items: [["review", "Review"]] };

// ★ THE WORKBENCH SCREENS A REVIEWER CAN STILL OPEN, LISTED SO THE TOOL STRIP ON
// THE REVIEW SCREEN AND THE ACTIVE-ROW LOGIC READ ONE LIST. None of these is a nav
// row; each is a tool the review layer reaches for.
export const REVIEW_TOOLS = [
  ["bank", "Bank Import"], ["recon", "Reconcile"], ["matching", "Matching"], ["payroll", "Payroll"],
];

// The Settings section. It is entered through the header gear rather than the
// sidebar, and appended to the sidebar only while you are inside it — so you can
// see where you are and leave by any route, without nine rows of setup sitting
// over the nav every other minute.
export const NAV_SECTION_SETTINGS = { id: "settings", label: "Settings", items: [
  ["settings", "Company"], ["team", "Team"], ["coa", "Chart of Accounts"],
  ["opening-balances", "Bank & Balances"], ["rules", "Rules"], ["recurring", "Recurring"],
  ["tax", "Taxes"], ["tax1099", "1099s"], ["audit", "Audit Trail"],
  ["onboard", "Import from QuickBooks"],
] };

// Flatten a section list to its view ids — for the guard, and so a test can ask
// "what is on screen" without walking the shape.
export const sectionViewIds = (sections) =>
  sections.flatMap((s) => s.items.map(([id]) => id.split(":")[0]));

// Settings lives behind the header gear, not the nav bar, and is NOT part of the
// IA collapse — a client still owns their company profile, team, taxes and audit
// trail. Listed here so the guard never bounces a client out of their own setup.
export const SETTINGS_VIEW_IDS = [
  "settings", "team", "coa", "opening-balances", "onboard", "rules", "recurring",
  "tax1099", "tax", "audit", "legal",
];

// What the CLIENT seat may open: their own nav (see NAV_SECTIONS), plus
// `detail` — the drill target every client surface pushes into (Home's activity
// feed, a Reports drill, a row in Transactions all open one transaction), so
// gating it would leave dead rows on screens the client is meant to use.
// Everything absent from here is a job rather than a record.
export const CLIENT_VIEW_IDS = [
  "home", "dashboard", "reports", "detail",
  "books", "ap", "ar", "customers", "vendors", "docs",
  ...SETTINGS_VIEW_IDS,
];

// Every top-level view id the ERP router can render — the truth-table domain.
export const ALL_VIEW_IDS = [
  ...new Set([
    "home", "dashboard", "add", "reports", "review", "admin",
    ...BOOKS_GROUP, ...SETTINGS_VIEW_IDS,
  ]),
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
//   sections      the sidebar, in render order: [{ id, label|null, items:[[viewId,label]] }]
//   viewIds       every view id this seat may open
//
// `inSettings` appends the Settings section (see NAV_SECTION_SETTINGS) — passed by
// the chrome from the CURRENT view, so setup rows are present exactly while you are
// standing in them. Settings itself is NOT part of the seat boundary: a client owns
// their own company profile, taxes and audit trail, and always has.
export function visibleNav({ role = "owner", isPlatformAdmin = false, previewAsOwner = false, inSettings = false } = {}) {
  const reviewer = isReviewerSeat({ role, isPlatformAdmin, previewAsOwner });
  // Same rows for everyone; a reviewer gets the review layer on top (C320).
  const sections = [...NAV_SECTIONS];
  if (reviewer) sections.push(NAV_SECTION_REVIEW);
  // The Admin panel is its own unlabelled section at the foot — a platform-admin
  // tool, deliberately not filed under any of the bookkeeping headings.
  if (reviewer && isPlatformAdmin) sections.push({ id: "admin", label: null, items: [["admin", "⚙ Admin"]] });
  if (inSettings) {
    const items = NAV_SECTION_SETTINGS.items.filter(([id]) => {
      if (id === "team") return role === "owner";                                   // owner-only, as before
      return true;
    });
    sections.push({ ...NAV_SECTION_SETTINGS, items });
  }
  return {
    seat: reviewer ? "reviewer" : "client",
    isReviewerSeat: reviewer,
    sections,
    viewIds: reviewer ? ALL_VIEW_IDS : CLIENT_VIEW_IDS,
  };
}

// Which section a view belongs to, for the sidebar's active row. `books:contracts`
// is a filter, so the caller supplies `booksFilter` to tell the two apart; anything
// unknown returns null and simply highlights nothing (never an error).
export function activeNavItem(view, { booksFilter = "all" } = {}) {
  const v = String(view || "");
  if (v === "dashboard") return "home";
  if (v === "detail" || v === "add" || v === "contracts" || v === "books") return "books";   // all live under Transactions
  if (v === "send-invoice") return "ar";                     // billing a customer belongs to Money owed to you
  // A workbench tool is the review layer at work: the sidebar highlights Review, so a
  // CPA on Reconcile can see where they are even though Reconcile has no row of its own.
  if (REVIEW_TOOLS.some(([id]) => id === v)) return "review";
  return v;
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
