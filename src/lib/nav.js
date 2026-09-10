// ════════════════════════════════════════════════════════════════════════════
// C197 / C312 — IA COLLAPSE (★ NORTH STAR Phase 2). WHO SEES WHICH WALLS,
// AND — since C312 — HOW THE ONES THEY DO SEE ARE ARRANGED.
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

// ── THE COCKPIT SIDEBAR (C312) ───────────────────────────────────────────────
//
// ★★★ THE TEN BOOKS SUB-TABS WERE NOT TOO MANY DESTINATIONS. THEY WERE TEN
// DESTINATIONS YOU COULD ONLY SEE AFTER CLICKING A TAB THAT DID NOT NAME THEM,
// IN A ROW THAT SCROLLED SIDEWAYS. §11 records the cost twice on one drive: the
// operator — who wrote the fixture — repeatedly could not find the Matching
// Engine, and stalled on Bank Import. **Matching had no row at all**: it was
// reachable only from a post-booking redirect and one conditional link on Home,
// so on a day it had nothing to say there was no door to it.
//
// A horizontal strip is the wrong shape for a workbench: it has no room for
// grouping, so hierarchy has to be spent on hiding things. A column has room, so
// EVERY destination is on screen at once, under a heading that says what it is
// for. Nothing was removed to achieve that — this moves walls, not machinery.
//
// ★★ THE GROUPS ARE THE DOMAIN'S OWN DIVISIONS, NOT A TIDYING. Money in and
// money out are the two halves a bookkeeper actually thinks in, and putting them
// side by side is what makes it obvious that Receivables had no row while
// Payables did — an asymmetry that survived because nothing ever displayed the
// pair together. (`ArView` is a real 315-line aging screen with AI narration and
// it was unreachable; so was `MatchingView`. Both are listed here now.)
//
// Rows are [viewId, label]. `books:contracts` is a FILTER on the Transactions
// view rather than a view of its own — kept in this list because the chrome's
// go/active handlers already speak that dialect and a second convention would be
// a second thing to keep in step.
export const NAV_SECTIONS_REVIEWER = [
  { id: "top", label: null, items: [
    ["home", "Home"], ["review", "Review"], ["reports", "Reports"],
  ] },
  { id: "ledger", label: "Ledger", items: [
    ["books", "Transactions"], ["books:contracts", "Contracts"],
  ] },
  { id: "money-in", label: "Money in", items: [
    ["ar", "Receivables"], ["customers", "Customers"], ["send-invoice", "Send Invoice"],
  ] },
  { id: "money-out", label: "Money out", items: [
    ["ap", "Payables"], ["vendors", "Vendors"],
  ] },
  { id: "bank", label: "Bank", items: [
    ["bank", "Bank Import"], ["recon", "Reconcile"], ["matching", "Matching"],
  ] },
  { id: "records", label: "Records", items: [
    ["payroll", "Payroll"], ["docs", "Documents"],
  ] },
];

// ── THE CLIENT'S SIDEBAR (C313 widened it from two rows to six) ──────────────
//
// ★★★ C197 CUT THE CLIENT TO HOME + REPORTS ON EVIDENCE THAT DID NOT SUPPORT
// THAT MUCH OF A CUT. The O83 finding was that a business owner cannot OPERATE a
// workbench — the operator himself stalled on Bank Import's checkbox states and
// could not find the Matching Engine — and every one of those failures was about
// DOING a bookkeeping job. None of them was about LOOKING AT YOUR OWN RECORDS.
//
// ★★ "WHAT DID I SPEND", "WHO DO I BUY FROM", "WHERE DID MY RECEIPT GO" ARE OWNER
// QUESTIONS, NOT BOOKKEEPER QUESTIONS — and answering them with a locked door was
// the collapse over-applied. A client who can only see two screens has to ask
// their accountant to look something up for them, which is precisely the
// dependency this product exists to remove.
//
// ★★★ AND THE CLIENT'S LABELS ARE NOT THE CPA'S (C314). "Payables" and
// "Receivables" are the two words §11's standing directive exists for — every
// owner-facing surface assumes ZERO accounting knowledge — and `OWNER_JARGON_RE`
// names both explicitly. The screens are the same screens; only the words differ,
// which costs nothing because this list was always separate from the cockpit's.
// A test holds every client label to the jargon bar; the CPA's labels are exempt
// by §9, which lets reviewer-facing copy stay technical.
//
// So the line is not seat-shaped, it is VERB-shaped: **records you READ are
// yours; workflows you OPERATE are the CPA's.** Transactions, Customers, Vendors
// and Documents are records. Bank Import, Reconcile, Matching, Payroll and the
// Review queue are jobs, and they stay in the cockpit.
//
// Flat, no headings: six rows do not need to be sorted into piles, and the whole
// point of this seat is that it is simple.
export const NAV_SECTIONS_CLIENT = [
  { id: "top", label: null, items: [
    ["home", "Home"], ["books", "Transactions"],
    ["ap", "Bills to pay"], ["ar", "Money owed to you"],
    ["customers", "Customers"], ["vendors", "Vendors"],
    ["docs", "Documents"], ["reports", "Reports"],
  ] },
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

// What the CLIENT seat may open: their own nav (see NAV_SECTIONS_CLIENT), plus
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
  const sections = [...(reviewer ? NAV_SECTIONS_REVIEWER : NAV_SECTIONS_CLIENT)];
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
  if (v === "detail") return "books";                       // the drill target belongs to Transactions
  if (v === "books") return booksFilter === "contracts" ? "books:contracts" : "books";
  if (v === "contracts") return "books:contracts";
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
