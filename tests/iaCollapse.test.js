import { describe, it, expect } from "vitest";
import fs from "fs";
import {
  visibleNav, isReviewerSeat, canSeeView, navRedirect,
  ALL_VIEW_IDS, CLIENT_VIEW_IDS, BOOKS_GROUP, BOOKS_SUBTABS, SETTINGS_VIEW_IDS,
  GATED_VIEW_REDIRECT_COPY, PREVIEW_AS_OWNER_ENTER_LABEL, PREVIEW_AS_OWNER_EXIT_LABEL,
} from "../src/lib/nav.js";
import { canAttestPeriod } from "../src/lib/signoff.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C197 — IA COLLAPSE (★ NORTH STAR Phase 2). The client sees Home and Reports.
// Everything workbench-shaped is the CPA's cockpit. These tests pin the WALL:
// who sees which tabs, what happens to a stale link, and that the demo toggle
// renders the client seat without touching the role.
// ════════════════════════════════════════════════════════════════════════════

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

  it("the client seat's nav is Home and Reports, in that order — nothing else", () => {
    expect(visibleNav(client).tabs.map(t => t.id)).toEqual(["home", "reports"]);
    expect(visibleNav(client).seat).toBe("client");
  });

  it("the reviewer seat keeps the whole cockpit", () => {
    expect(visibleNav(reviewer).tabs.map(t => t.id)).toEqual(["home", "books", "reports", "review"]);
    expect(visibleNav({ ...reviewer, isPlatformAdmin: true }).tabs.map(t => t.id))
      .toEqual(["home", "books", "reports", "review", "admin"]);
  });

  it("EVERY view id resolves the same way for both seats — the full table", () => {
    const table = ALL_VIEW_IDS.map(v => [v, canSeeView(v, client), canSeeView(v, reviewer)]);
    // A reviewer can open everything except the platform-admin panel.
    for (const [v, , rev] of table) expect([v, rev]).toEqual([v, v !== "admin"]);
    // A client can open exactly the declared client set — no more, no less.
    const clientOk = table.filter(([, cli]) => cli).map(([v]) => v).sort();
    expect(clientOk).toEqual([...new Set(CLIENT_VIEW_IDS)].sort());
  });

  it("every workbench sub-tab surface is gated for a client (the named ten)", () => {
    const workbench = ["books", "contracts", "ap", "vendors", "customers", "send-invoice", "bank", "recon", "payroll", "docs"];
    for (const v of workbench) {
      expect([v, canSeeView(v, client)]).toEqual([v, false]);
      expect([v, canSeeView(v, reviewer)]).toEqual([v, true]);
    }
    // …and the Books sub-nav itself has no client-facing existence (not "disabled" — absent).
    expect(visibleNav(client).booksSubtabs).toEqual([]);
    expect(visibleNav(reviewer).booksSubtabs).toEqual(BOOKS_SUBTABS);
    expect(BOOKS_SUBTABS.map(([id]) => id)).toContain("bank");
    expect(BOOKS_SUBTABS.map(([id]) => id)).toContain("recon");
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
    expect(previewing.tabs).toEqual(visibleNav({ role: "owner" }).tabs);
    expect(previewing.booksSubtabs).toEqual([]);
    expect(previewing.viewIds).toEqual(visibleNav({ role: "owner" }).viewIds);
  });
  it("a platform admin previewing loses the Admin tab too (it's a preview, not a costume)", () => {
    const previewing = visibleNav({ role: "accountant", isPlatformAdmin: true, previewAsOwner: true });
    expect(previewing.tabs.map(t => t.id)).toEqual(["home", "reports"]);
  });
  it("switching back restores the cockpit — the role never moved", () => {
    expect(visibleNav({ ...reviewer, previewAsOwner: true }).seat).toBe("client");
    expect(visibleNav({ ...reviewer, previewAsOwner: false }).seat).toBe("reviewer");
    // The attestation predicate is untouched by the toggle — preview is a lens, not a demotion.
    expect(canAttestPeriod(reviewer.role)).toBe(true);
  });
  it("preview does NOT let a client seat see more (it can only ever subtract)", () => {
    expect(visibleNav({ role: "owner", previewAsOwner: true }).tabs.map(t => t.id)).toEqual(["home", "reports"]);
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

  it("App.jsx derives the seat and renders the tab row from visibleNav", () => {
    expect(app).toMatch(/from ["']\.\/lib\/nav["']/);
    expect(app).toMatch(/const navSeat = useMemo\(\s*\(\) => visibleNav\(/);
    expect(app).toMatch(/const tabs = navSeat\.tabs;/);
    expect(app).toMatch(/navSeat\.booksSubtabs/);
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
  // structural: Home reaches the cockpit ONLY through goCockpit, which returns early
  // for a client seat. (Same shape as the C192 `lineDbId` rule: grep-enforceable.)
  it("Home has no direct link into a gated surface — every one goes through goCockpit", () => {
    const GATED = /setView\("(bank|matching|review|contracts|books|recon|payroll|docs|ap|ar|send-invoice|vendors|customers)"\)/g;
    const lines = dash.split("\n");
    const direct = lines
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => GATED.test(line) && !line.trim().startsWith("//"))
      .map(([n, line]) => `${n}: ${line.trim().slice(0, 80)}`);
    expect(direct).toEqual([]);
    expect(dash).toMatch(/const goCockpit = \(viewId, before\) => \{ if \(!cockpit\) return;/);
    // …and the door is actually used for the surfaces the client must not reach.
    for (const v of ["bank", "matching", "review", "contracts", "books"]) {
      expect([v, dash.includes(`goCockpit("${v}"`)]).toEqual([v, true]);
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
