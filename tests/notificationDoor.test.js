import { describe, it, expect } from "vitest";
import fs from "fs";
import { notificationTarget } from "../src/lib/notificationDoor.js";
import { ALL_VIEW_IDS, CLIENT_VIEW_IDS } from "../src/lib/nav.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C381 — THE BELL IS ONE SHARED LIST, AND ITS DOORS ARE RESOLVED FOR WHOEVER CLICKS.
// A row written for the accountant (`link_view: "recon"`) is read by the owner too. Until
// C381 the click was a bare setView, so the owner was bounced Home with "your accountant
// looks after that part" — by the alert that had just told them to do it.
// ═════════════════════════════════════════════════════════════════════════════
const owner = { role: "owner" };
const cpa = { role: "accountant" };

describe("★★ notificationTarget resolves the door for the seat", () => {
  it("a reviewer-only link lands the owner on Home, and the accountant on the screen", () => {
    for (const view of ["recon", "bank", "review", "matching"]) {
      expect(notificationTarget({ link_view: view }, owner)).toEqual({ kind: "view", view: "home" });
      expect(notificationTarget({ link_view: view }, cpa)).toEqual({ kind: "view", view });
    }
  });
  it("a link the owner may open is kept", () => {
    expect(notificationTarget({ link_view: "tax" }, owner)).toEqual({ kind: "view", view: "tax" });
    expect(notificationTarget({ link_view: "reports" }, owner)).toEqual({ kind: "view", view: "reports" });
  });
  it("txn: links open the entry for either seat; an empty or unknown link is Home", () => {
    expect(notificationTarget({ link_view: "txn:abc" }, owner)).toEqual({ kind: "txn", id: "abc" });
    expect(notificationTarget({ link_view: "txn:abc" }, cpa)).toEqual({ kind: "txn", id: "abc" });
    expect(notificationTarget({ link_view: null }, owner).view).toBe("home");
    expect(notificationTarget({ link_view: "no-such-view" }, cpa).view).toBe("home");
    expect(notificationTarget(undefined, owner).view).toBe("home");
  });
});

// The generators, read off the source: every literal link is a routable view (or Home, or a
// txn: template), every stored sentence passes the owner bar — the bell has no seat gate on
// its copy, so a sentence the accountant reads is a sentence the owner reads.
const app = fs.readFileSync("src/App.jsx", "utf8");
const calls = [...app.matchAll(/createNotification\??\.?\(\{([\s\S]*?)\}\)/g)].map((m) => m[1]);
describe("★ every generated notification is safe for whoever opens the bell", () => {
  it("finds the generators (anti-vacuity)", () => { expect(calls.length).toBeGreaterThanOrEqual(8); });
  it("every literal link_view is a routable view id, Home, or a txn: template", () => {
    for (const c of calls) {
      const m = c.match(/link_view:\s*("([^"]*)"|`txn:|[a-zA-Z]+)/);
      expect(m, c).toBeTruthy();
      if (m[2] !== undefined) expect([...ALL_VIEW_IDS, "home"], m[2]).toContain(m[2]);
    }
  });
  it("no stored sentence assumes accounting knowledge or tells the reader to open a screen they may not have", () => {
    const strings = calls.flatMap((c) => [...c.matchAll(/(?:title|description):\s*(?:"([^"]*)"|`([^`]*)`)/g)].map((m) => m[1] ?? m[2]));
    expect(strings.length).toBeGreaterThan(8);
    const bad = strings.filter((s) => containsOwnerJargon(s.replace(/\$\{[^}]*\}/g, "")) || /\b(Open|Run) (Review|Bank Import|Reconcile|Matching|a quick bank match)\b/i.test(s));
    expect(bad).toEqual([]);
  });
  it("the click handler consults the seat (no bare setView(n.link_view))", () => {
    expect(app).not.toMatch(/setView\(n\.link_view\)/);
    expect(app).toMatch(/const target = notificationTarget\(n, \{ role: userRole, isPlatformAdmin, previewAsOwner \}\)/);
  });
  it("the bell's empty state uses the owner's words", () => {
    expect(app).not.toContain("taxes, anomalies, and reviews");
    expect(app).toContain("taxes, unusual activity, and things to check");
  });
});

// The client seat's own view list is what the door reads — pinned so a future widening of
// the seat widens the door with it and no second list has to be kept in step.
describe("the door reads the seat's view list, not a copy", () => {
  it("every CLIENT_VIEW_IDS entry is kept for an owner; every non-client view is Home", () => {
    for (const v of CLIENT_VIEW_IDS) expect(notificationTarget({ link_view: v }, owner).view).toBe(v);
    for (const v of ALL_VIEW_IDS.filter((x) => !CLIENT_VIEW_IDS.includes(x))) expect(notificationTarget({ link_view: v }, owner).view).toBe("home");
  });
});

// C387 — the bell's "bank match overdue" reads the SAME definition as Home's list and the
// trust panel. It used to count from any reconciliation row's created_at (an abandoned
// session counted as a match) and fire on a company with no books at all.
import { bankMatchStatus } from "../src/lib/controlTotals.js";
describe("★ the bank-match notification is bankMatchStatus, not a second reading", () => {
  it("the generator calls bankMatchStatus on the live refs and no longer reads created_at", () => {
    const gen = app.slice(app.indexOf("const generateNotifications = () => {"), app.indexOf("// ── AUTOMATIC MONTHLY REPORTS"));
    expect(gen.length).toBeGreaterThan(400);
    expect(gen).toMatch(/bankMatchStatus\(\{ reconciliations: reconciliationsRef\.current \|\| \[\], invoices: invoicesRef\.current \|\| \[\], checked: !loadFailuresRef\.current\.reconciliations \}\)/);   // C455 appended the verdict
    expect(gen).not.toMatch(/created_at \|\| r\.statement_date/);
    expect(gen).toMatch(/if \(bm\.overdue\)/);
  });
  it("the shared definition: no books → not overdue; an unverified session is not a match", () => {
    expect(bankMatchStatus({ reconciliations: [], invoices: [] }).overdue).toBe(false);
    const books = [{ id: 1, status: "posted", amount: 10 }];
    expect(bankMatchStatus({ reconciliations: [{ status: "open", created_at: "2026-09-14T00:00:00Z" }], invoices: books, now: new Date("2026-09-15") }).overdue).toBe(true);
  });
});

