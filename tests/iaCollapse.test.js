import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  visibleNav, isReviewerSeat, canSeeView, navRedirect,
  ALL_VIEW_IDS, CLIENT_VIEW_IDS, BOOKS_GROUP, SETTINGS_VIEW_IDS,
  NAV_SECTIONS_REVIEWER, NAV_SECTIONS_CLIENT, NAV_SECTION_SETTINGS, sectionViewIds, activeNavItem,
  GATED_VIEW_REDIRECT_COPY, PREVIEW_AS_OWNER_ENTER_LABEL, PREVIEW_AS_OWNER_EXIT_LABEL,
} from "../src/lib/nav.js";
import { canAttestPeriod } from "../src/lib/signoff.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C197 / C312 — IA COLLAPSE (★ NORTH STAR Phase 2). The client sees Home and
// Reports. Everything workbench-shaped is the CPA's cockpit. These tests pin the
// WALL: who sees what, what happens to a stale link, and that the demo toggle
// renders the client seat without touching the role.
//
// ★ C312 MOVED THE NAV FROM TABS TO A GROUPED SIDEBAR, AND SEVEN OF THESE WENT
// RED — correctly, because their SUBJECT moved. They are repointed at the
// PROPERTY each one protects (what a seat can reach, and that the chrome reads
// the one helper), never at the shape that happened to carry it. A test quietly
// dropped along with the mechanism it named is how a guarantee is lost while the
// suite stays green.
// ════════════════════════════════════════════════════════════════════════════

// What a seat can actually click, flattened out of the sidebar sections.
const navItems = (nav) => nav.sections.flatMap(s => s.items.map(([id]) => id));

const CLIENT_ROLES = ["owner", "viewer", "member"];      // every non-reviewer role the DB allows (+ the app's dead "member")
const REVIEWER_ROLES = ["admin", "accountant"];          // exactly is_company_reviewer (migration 051)

describe("(1) the seat IS the attestation boundary — one gate, not two", () => {
  it("reviewer seat === canAttestPeriod for every role (no second, drifting definition)", () => {
    for (const role of [...CLIENT_ROLES, ...REVIEWER_ROLES]) {
      expect(isReviewerSeat({ role })).toBe(canAttestPeriod(role));
    }
  });
  it("a platform admin keeps the cockpit whatever their company role (Support Mode)", () => {
    for (const role of CLIENT_ROLES) {
      expect(isReviewerSeat({ role })).toBe(false);
      expect(isReviewerSeat({ role, isPlatformAdmin: true })).toBe(true);
    }
  });
});

describe("(2) visibleNav truth table — every view id, both seats", () => {
  const client = { role: "owner" };
  const reviewer = { role: "accountant" };

  it("★ the client seat sees their own RECORDS — six rows, flat, in order (C313)", () => {
    // ★★ C197 CUT THIS TO TWO AND THAT WAS MORE THAN THE EVIDENCE SUPPORTED. The O83
    // failures were all about OPERATING a workbench (bank checkboxes, matching); none
    // was about looking at your own records. "What did I spend", "who do I buy from",
    // "where did my receipt go" are owner questions, and answering them with a locked
    // door forces a client to ask their accountant to look things up for them.
    expect(navItems(visibleNav(client))).toEqual(["home", "books", "customers", "vendors", "docs", "reports"]);
    expect(visibleNav(client).seat).toBe("client");
    // …and still no headings: six rows do not need to be sorted into piles.
    expect(visibleNav(client).sections.map(s => s.label)).toEqual([null]);
  });

  it("★ the line is VERB-shaped: records are the client's, jobs are the CPA's", () => {
    const rows = navItems(visibleNav(client));
    // Records you READ — yours.
    for (const v of ["books", "customers", "vendors", "docs"]) expect([v, rows.includes(v)]).toEqual([v, true]);
    // Jobs you OPERATE — the cockpit's, and the reason the collapse exists at all.
    for (const v of ["bank", "recon", "matching", "payroll", "review", "send-invoice"]) {
      expect([v, rows.includes(v)]).toEqual([v, false]);
      expect([v, canSeeView(v, client)]).toEqual([v, false]);
    }
  });

  it("the reviewer seat keeps the whole cockpit — nothing was removed to group it", () => {
    const items = navItems(visibleNav(reviewer));
    // Every destination the flat ten-row sub-nav offered is still one click away…
    for (const v of ["books", "books:contracts", "ap", "vendors", "customers", "send-invoice", "bank", "recon", "payroll", "docs"])
      expect([v, items.includes(v)]).toEqual([v, true]);
    // …plus the two that RENDERED A REAL SCREEN AND HAD NO ROW AT ALL. Matching was
    // reachable only from a post-booking redirect (the O83 navigation failure) and
    // Receivables not at all, while Payables had a row the whole time.
    expect(items).toContain("matching");
    expect(items).toContain("ar");
    // …and the top-level tabs survive as the first, unlabelled section.
    expect(visibleNav(reviewer).sections[0].items.map(([id]) => id)).toEqual(["home", "review", "reports"]);
    expect(navItems(visibleNav({ ...reviewer, isPlatformAdmin: true }))).toContain("admin");
    expect(navItems(visibleNav(reviewer))).not.toContain("admin");
  });

  it("★ every sidebar row is a view this seat may actually open (no row leads to a bounce)", () => {
    // A nav row the guard then refuses is worse than no row: it teaches you that
    // clicking is how you find out. Both seats, every row.
    for (const opts of [client, reviewer, { ...reviewer, isPlatformAdmin: true }])
      for (const v of sectionViewIds(visibleNav(opts).sections))
        expect([opts.role, v, canSeeView(v, opts)]).toEqual([opts.role, v, true]);
  });

  it("★ the Settings rows appear only while you are standing in Settings", () => {
    expect(navItems(visibleNav(reviewer))).not.toContain("coa");
    const inSettings = visibleNav({ ...reviewer, inSettings: true });
    expect(navItems(inSettings)).toContain("coa");
    expect(inSettings.sections.at(-1).label).toBe("Settings");
    // A client owns their own setup — Settings was never part of the seat boundary.
    expect(navItems(visibleNav({ ...client, inSettings: true }))).toContain("tax");
    // Team stays owner-only, exactly as the old sub-nav had it.
    expect(navItems(visibleNav({ ...client, inSettings: true }))).toContain("team");
    expect(navItems(visibleNav({ ...reviewer, inSettings: true }))).not.toContain("team");
  });

  it("★ activeNavItem highlights one row, and knows Contracts is a filter not a view", () => {
    expect(activeNavItem("dashboard")).toBe("home");        // the legacy id is still Home
    expect(activeNavItem("detail")).toBe("books");          // the drill belongs to Transactions
    expect(activeNavItem("books", { booksFilter: "all" })).toBe("books");
    expect(activeNavItem("books", { booksFilter: "contracts" })).toBe("books:contracts");
    expect(activeNavItem("recon")).toBe("recon");
    expect(activeNavItem("nonsense")).toBe("nonsense");     // highlights nothing; never throws
  });

  it("EVERY view id resolves the same way for both seats — the full table", () => {
    const table = ALL_VIEW_IDS.map(v => [v, canSeeView(v, client), canSeeView(v, reviewer)]);
    // A reviewer can open everything except the platform-admin panel.
    for (const [v, , rev] of table) expect([v, rev]).toEqual([v, v !== "admin"]);
    // A client can open exactly the declared client set — no more, no less.
    const clientOk = table.filter(([, cli]) => cli).map(([v]) => v).sort();
    expect(clientOk).toEqual([...new Set(CLIENT_VIEW_IDS)].sort());
  });

  it("every surface that is a JOB rather than a record is gated for a client", () => {
    // Narrowed by C313: `books`, `vendors`, `customers` and `docs` moved to the client
    // side (records). What is left is the workbench — plus `ap`/`ar`/`contracts`, which
    // are NOT yet the client's and are deliberately listed so that becoming so is a
    // decision someone makes rather than something that quietly happens.
    const workbench = ["contracts", "ap", "ar", "send-invoice", "bank", "recon", "matching", "payroll"];
    for (const v of workbench) {
      expect([v, canSeeView(v, client)]).toEqual([v, false]);
      expect([v, canSeeView(v, reviewer)]).toEqual([v, true]);
    }
    // …and the workbench rows have no client-facing existence (not "disabled" — absent).
    const clientRows = navItems(visibleNav(client));
    for (const v of workbench) expect([v, clientRows.includes(v)]).toEqual([v, false]);
    const reviewerRows = navItems(visibleNav(reviewer));
    expect(reviewerRows).toContain("bank");
    expect(reviewerRows).toContain("recon");
  });

  it("Home, Reports, the transaction drill and Settings stay open to a client", () => {
    for (const v of ["home", "dashboard", "reports", "detail", ...SETTINGS_VIEW_IDS]) {
      expect([v, canSeeView(v, client)]).toEqual([v, true]);
    }
  });

  it("the CPA Review queue and the manual-entry screen are cockpit-only", () => {
    for (const v of ["review", "add", "matching"]) expect([v, canSeeView(v, client)]).toEqual([v, false]);
  });

  it("an unknown or empty view id fails CLOSED for a client", () => {
    for (const v of ["", null, undefined, "some-future-tab"]) expect(canSeeView(v, client)).toBe(false);
  });

  it("the admin panel needs BOTH a platform admin and a cockpit seat", () => {
    expect(canSeeView("admin", { role: "accountant" })).toBe(false);
    expect(canSeeView("admin", { role: "accountant", isPlatformAdmin: true })).toBe(true);
    expect(canSeeView("admin", { role: "accountant", isPlatformAdmin: true, previewAsOwner: true })).toBe(false);
  });
});

describe("(3) route guard — a stale link goes Home, never to an error", () => {
  const client = { role: "owner" };
  it("every gated view redirects a client to Home", () => {
    const gated = ALL_VIEW_IDS.filter(v => !CLIENT_VIEW_IDS.includes(v));
    expect(gated.length).toBeGreaterThan(5);              // the guard is actually guarding something
    for (const v of gated) expect([v, navRedirect(v, client)]).toEqual([v, "home"]);
  });
  it("an allowed view is left alone (null = stay put, no redirect loop)", () => {
    for (const v of CLIENT_VIEW_IDS) expect([v, navRedirect(v, client)]).toEqual([v, null]);
    expect(navRedirect("home", client)).toBeNull();       // and Home can never redirect to itself
  });
  it("a reviewer is never redirected off a workbench surface", () => {
    for (const v of BOOKS_GROUP) expect([v, navRedirect(v, { role: "admin" })]).toEqual([v, null]);
  });
  it("the bounce copy assumes zero accounting knowledge", () => {
    expect(containsOwnerJargon(GATED_VIEW_REDIRECT_COPY)).toBe(false);
    expect(GATED_VIEW_REDIRECT_COPY).toMatch(/accountant/i);
    expect(GATED_VIEW_REDIRECT_COPY).not.toMatch(/permission|denied|not allowed|error|unauthor/i);
  });
});

describe("(4) 'Preview as owner' renders the client seat without changing the role", () => {
  const reviewer = { role: "accountant" };
  it("a reviewer previewing gets the EXACT client nav", () => {
    const previewing = visibleNav({ ...reviewer, previewAsOwner: true });
    expect(previewing.seat).toBe("client");
    expect(previewing.sections).toEqual(visibleNav({ role: "owner" }).sections);
    expect(previewing.viewIds).toEqual(visibleNav({ role: "owner" }).viewIds);
  });
  it("a platform admin previewing loses the Admin tab too (it's a preview, not a costume)", () => {
    const previewing = visibleNav({ role: "accountant", isPlatformAdmin: true, previewAsOwner: true });
    expect(navItems(previewing)).toEqual(navItems(visibleNav({ role: "owner" })));
    expect(navItems(previewing)).not.toContain("admin");
  });
  it("switching back restores the cockpit — the role never moved", () => {
    expect(visibleNav({ ...reviewer, previewAsOwner: true }).seat).toBe("client");
    expect(visibleNav({ ...reviewer, previewAsOwner: false }).seat).toBe("reviewer");
    // The attestation predicate is untouched by the toggle — preview is a lens, not a demotion.
    expect(canAttestPeriod(reviewer.role)).toBe(true);
  });
  it("preview does NOT let a client seat see more (it can only ever subtract)", () => {
    expect(navItems(visibleNav({ role: "owner", previewAsOwner: true })))
      .toEqual(navItems(visibleNav({ role: "owner" })));
  });
  it("both toggle labels are plain language and say plainly that it's a preview", () => {
    expect(containsOwnerJargon(PREVIEW_AS_OWNER_ENTER_LABEL)).toBe(false);
    expect(containsOwnerJargon(PREVIEW_AS_OWNER_EXIT_LABEL)).toBe(false);
    expect(PREVIEW_AS_OWNER_EXIT_LABEL).toMatch(/switch back/i);
  });
});

// ── Source contracts. There is no DOM in this suite, so the WIRING is pinned by
// reading the source: the chrome must render FROM the helper (not a second, drifting
// tab list), and no client-facing surface may hold an unguarded link into the cockpit.
describe("(5) the chrome renders from the helper, and Home never links a client into the cockpit", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const dash = fs.readFileSync(new URL("../src/components/views/DashboardView.jsx", import.meta.url), "utf8");
  const trust = fs.readFileSync(new URL("../src/components/views/TrustPanel.jsx", import.meta.url), "utf8");

  it("App.jsx derives the seat and renders the SIDEBAR from visibleNav", () => {
    expect(app).toMatch(/from ["']\.\/lib\/nav["']/);
    expect(app).toMatch(/const navSeat = useMemo\(\s*\(\) => visibleNav\(/);
    expect(app).toMatch(/navSeat\.sections\.map\(/);
    // The old two-row chrome is gone, not merely unused — a second nav shape left in
    // place is a second thing that can drift.
    expect(app).not.toMatch(/navSeat\.tabs/);
    expect(app).not.toMatch(/navSeat\.booksSubtabs/);
  });

  it("★ the sidebar's rows come from the helper, not from a second list in the chrome", () => {
    // Every label a person reads must live in nav.js. A literal row assembled in JSX is
    // exactly how the guard and the screen come to disagree about what exists.
    //
    // ★ SCOPED TO THE SIDEBAR BLOCK, NOT THE FILE. The first draft banned these strings
    // anywhere in App.jsx and tripped on a misroute confirmation — "routed it to Bank
    // Import" — which is a sentence about a destination, not a nav row. A guard that
    // fails for a reason it does not mean is a guard nobody will trust.
    const sidebar = app.slice(app.indexOf('<nav aria-label="Main"'), app.indexOf("</nav>"));
    expect(sidebar.length).toBeGreaterThan(400);   // refuse to pass on a slice that found nothing
    for (const label of ["Receivables", "Matching", "Bank Import", "Reconcile", "Payables"])
      expect([label, sidebar.includes(`"${label}"`)]).toEqual([label, false]);
    const nav = fs.readFileSync(new URL("../src/lib/nav.js", import.meta.url), "utf8");
    for (const label of ["Receivables", "Matching", "Bank Import", "Reconcile", "Payables"])
      expect([label, nav.includes(`"${label}"`)]).toEqual([label, true]);
  });

  it("the old hardcoded tab array is GONE (one source of truth, not two)", () => {
    expect(app).not.toMatch(/id:"books", label:"Books"/);
    expect(app).not.toMatch(/id:"review", label:"Review"/);
  });

  it("the route guard is wired to navRedirect and lands on Home", () => {
    const guard = app.match(/const to = navRedirect\([\s\S]{0,320}?GATED_VIEW_REDIRECT_COPY\);/);
    expect(guard).not.toBeNull();
    expect(guard[0]).toContain("setViewRaw(to)");
  });

  // ONE DOOR, and the door itself refuses. Hiding the button is not enough — a hidden
  // button is one careless edit away from being visible again — so the invariant is
  // structural: Home reaches every destination ONLY through `navTo`, which returns early
  // for anything this seat's view list does not contain. (Same shape as the C192
  // `lineDbId` rule: grep-enforceable.)
  it("Home has no direct link out — every destination goes through the one door", () => {
    const GATED = /setView\("(bank|matching|review|contracts|books|recon|payroll|docs|ap|ar|send-invoice|vendors|customers)"\)/g;
    const lines = dash.split("\n");
    const direct = lines
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => GATED.test(line) && !line.trim().startsWith("//"))
      .map(([n, line]) => `${n}: ${line.trim().slice(0, 80)}`);
    expect(direct).toEqual([]);
    // ★★ THE DOOR ASKS THE SEAT'S VIEW LIST, NOT WHETHER THIS IS THE COCKPIT (C313).
    // A flat client refusal was right while a client had two screens and became wrong
    // the moment they had six: the anomaly cards fall back to `setView("books")`, so a
    // seat-shaped refusal would leave a client clicking a row on their own home page
    // and getting nothing. One list, consulted by both the sidebar and this door.
    expect(dash).toMatch(/const navTo = \(viewId, before\) => \{\s*\n\s*if \(navSeat && !navSeat\.viewIds\.includes\(viewId\)\) return;/);
    expect(dash).not.toMatch(/const goCockpit =/);
    // …and the door is actually used, for surfaces on both sides of the line.
    for (const v of ["bank", "matching", "review", "contracts", "books"]) {
      expect([v, dash.includes(`navTo("${v}"`)]).toEqual([v, true]);
    }
  });

  it("the trust panel's nudge is a BUTTON only in the cockpit — and the handler refuses too", () => {
    expect(trust).toMatch(/cockpit \? \(\s*<button onClick=\{goReview\}/);
    expect(trust).toMatch(/const cockpit = navSeat \? navSeat\.isReviewerSeat : true;/);
    expect(trust).toMatch(/const goReview = \(\) => \{ if \(!cockpit\) return;/);
  });

  it("the client-seat replacement copy passes the Cardinal-Principle bar", () => {
    const clientCopy = [
      "We've got your statement — your accountant will add these to your books.",
      "A few things from your statement need a second look — your accountant is on it.",
      "We've read your agreement — your accountant will record it.",
      "We couldn't tell what one of your files was — your accountant will take a look.",
      "Your accountant is taking a look at this.",
      "Got it — we've saved that for your accountant to add to your books.",
      "Got it — we've saved your statement for your accountant to add to your books.",
    ];
    for (const c of clientCopy) {
      expect([c, containsOwnerJargon(c)]).toEqual([c, false]);           // no accounting concepts
      expect([c, dash.includes(c) || app.includes(c)]).toEqual([c, true]); // and it's actually on screen
    }
  });

  it("★★ a client's file reaches intake and NEVER navigates them into the cockpit", () => {
    // ★ THE PROPERTY, NOT THE MECHANISM. This used to assert that all three of bank /
    // payroll / QBO were STASHED for the accountant — and O116 changed payroll to run in
    // place, so the assertion failed on a change that honours everything it was protecting.
    // Rewriting it to name the property instead: a client's drop must be ACCOUNTED FOR and
    // must not throw them onto a reviewer screen. Stashing was one way to achieve that;
    // processing it where it lands is a better one.
    const route = app.slice(app.indexOf("const routeFileToType"), app.indexOf("const persistBankStatement"));

    // Bank and QuickBooks still stash — both open a workbench a client has no business in.
    expect(route).toMatch(/if \(!navSeat\.isReviewerSeat && \(type === "bank_statement" \|\| type === "qbo"\)\) \{[\s\S]{0,200}setPendingImportFile\(\{ type, file \}\);/);

    // Payroll is HANDLED instead — and, critically, handled BEFORE the seat check, so the
    // client path cannot fall through to a `setView` that would move them.
    const payrollBranch = route.indexOf('if (type === "payroll") { handlePayrollFile(file); return; }');
    expect(payrollBranch).toBeGreaterThan(-1);
    expect(payrollBranch).toBeLessThan(route.indexOf("!navSeat.isReviewerSeat"));

    // And every `setView` in this function is unreachable from the client seat, because the
    // seat check returns above them.
    const afterSeatCheck = route.slice(route.indexOf("!navSeat.isReviewerSeat"));
    expect(afterSeatCheck).toMatch(/setView\("bank"\)/);          // they exist…
    expect(route.slice(0, payrollBranch)).not.toMatch(/setView\(/); // …and none precedes the guard
  });
});
