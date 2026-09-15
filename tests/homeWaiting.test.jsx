// ─────────────────────────────────────────────────────────────────────────────
// U1 / C375 — HOME HAS ONE LIST OF THINGS WAITING ON YOU.
//
// Nine banners, each its own colour and button, became one ranked list built purely from
// the same inputs. Nothing that was on Home is gone: every old source is asserted to
// produce a row, the dangerous ones sort first, the informational ones last, and the seat
// decides whose action it is.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { homeWaitingList, waitingHeadline, WAIT } from "../src/lib/homeWaiting.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView, { HomeWaitingList } from "../src/components/views/DashboardView.jsx";

const inv = { id: "i1", vendor: "Hill Country", amount: 468.5, date: "2026-08-06", gl_code: "5010", gl_name: "Food Cost" };
const everything = {
  openCards: [{ id: "c1", invoice: inv, isLifecycle: true, arrival: { reason: "amount_differs" } }, { id: "c2", invoice: inv }],
  heldQuestions: [{ intake_id: "r1", filename: "a.pdf", reloadable: true, loading: false }],
  heldUnreadable: [{ intake_id: "r2", filename: "b.jpg", reloadable: true, loading: false }],
  heldInbound: [{ id: "m1", from_email: "asst@cpa.com", subject: "Sept", attachment_count: 2 }], canDecideMail: true,
  bankMatch: { overdue: true, days: 41 },
  taxDeadline: { plain: "Quarterly estimated tax", days: 20, url: "https://irs.gov", est: true }, taxEstimateText: " — estimated amount ~$1,200",
  overdueBills: [{ amount: 100, due_date: "2026-08-01" }, { amount: 50.5, due_date: "2026-08-02" }], overdueTotal: 150.5,
  recurringSuggestions: [{ id: "s1", vendorKey: "sysco", vendor: "Sysco", avgAmount: 2000, minAmount: 2000, maxAmount: 2000, count: 3 }],
  uploadQueue: [{ id: 1, status: "done", type: "contract" }, { id: 2, status: "done", type: "unknown" }, { id: 3, status: "done", type: "bank_statement", result: { needsReview: 2 } }],
};

describe("every old banner is a row, and the order is urgency", () => {
  it("owner seat: all sources present, dangerous first, informational last", () => {
    const items = homeWaitingList(everything);
    const ids = items.map((i) => i.id);
    for (const id of ["questions", "held_questions", "held_unreadable", "mail:m1", "bank_match", "tax_deadline", "overdue_bills", "recurring:sysco", "contract_ready", "unknown_doc", "bank_review"]) expect(ids, id).toContain(id);
    expect(ids[0]).toBe("questions");
    expect(items[0].urgency).toBe(WAIT.STOPS);
    const urg = items.map((i) => i.urgency);
    expect([...urg].sort((a, b) => a - b)).toEqual(urg);   // non-decreasing
    expect(items.at(-1).urgency).toBe(WAIT.INFO);
  });
  it("the owner is told, not sent, about the accountant's items; the reviewer gets the door", () => {
    const owner = homeWaitingList(everything);
    const cpa = homeWaitingList({ ...everything, cockpit: true });
    const get = (list, id) => list.find((i) => i.id === id);
    expect(get(owner, "contract_ready").actions).toEqual([]);
    expect(get(cpa, "contract_ready").actions[0]).toMatchObject({ kind: "nav", view: "contracts" });
    expect(get(cpa, "bank_review").urgency).toBe(WAIT.NOW);
    expect(get(owner, "bank_review").urgency).toBe(WAIT.INFO);
    // and the SORT is load-bearing: the reviewer's bank-review row is built last but is NOW,
    // so it must come before every SOON row (a mutation removing the sort leaves it last)
    const cpaIds = cpa.map((i) => i.id);
    expect(cpaIds.indexOf("bank_review")).toBeLessThan(cpaIds.indexOf("overdue_bills"));
    expect(cpaIds.indexOf("bank_review")).toBeLessThan(cpaIds.indexOf("tax_deadline"));
  });
  it("a member cannot decide held mail — no buttons, and it says who can", () => {
    const [m] = homeWaitingList({ heldInbound: everything.heldInbound, canDecideMail: false });
    expect(m.actions).toEqual([]);
    expect(m.note).toMatch(/owner or admin/);
  });
  it("every sentence passes the jargon bar", () => {
    for (const it of homeWaitingList(everything)) expect([it.text, containsOwnerJargon(it.text)]).toEqual([it.text, false]);
  });
  it("the headline reads the list", () => {
    expect(waitingHeadline(homeWaitingList(everything))).toMatch(/things need an answer from you/);
    expect(waitingHeadline(homeWaitingList({ overdueBills: [{ amount: 1 }], overdueTotal: 1 }))).toBe("1 thing worth a look");
    expect(waitingHeadline([])).toBeNull();
  });
  it("money goes through the canonical formatter", () => {
    const b = homeWaitingList({ overdueBills: [{ amount: 1 }, { amount: 2 }], overdueTotal: 1234.5 }).find((i) => i.id === "overdue_bills");
    expect(b.text).toContain("$1,234.50");
  });
});

describe("Home renders the list and none of the old banners", () => {
  const strip = (h) => h.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
  it("the list is on Home with the fixture's rows, and the nine banners are gone from the source", () => {
    const ctx = { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], heldQuestions: everything.heldQuestions, heldUnreadable: everything.heldUnreadable, heldInbound: everything.heldInbound, isOwner: true, bankMatch: { overdue: true, days: 41 } };
    const html = strip(renderViewHtml(DashboardView, ctx));
    expect(html).toContain('id="waiting-on-you"');
    expect(html).toContain("Bring the questions back");
    expect(html).toContain("Try again");
    expect(html).toContain("Allow this sender");
    expect(html).toContain("Upload statement");
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    for (const gone of ["RECURRING SUGGESTIONS", "TAX DEADLINE ALERT", "BANK MATCH REMINDER", "AP ACTIONABLE ALERTS", "Invoice clarification prompt", "<HeldMailLine", "Unknown docs review prompt"]) expect(src, gone).not.toContain(gone);
    expect(src).toMatch(/<HomeWaitingList navTo=\{navTo\} \/>/);
  });
  it("the list's doors all go through navTo — never a bare setView (C313)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    const body = src.slice(src.indexOf("export function HomeWaitingList("));
    expect(body).not.toMatch(/setView\(/);
    expect(body).toMatch(/const go = navTo \|\| \(\(\) => \{\}\);/);
  });
  it("the stepper opens from the list's button", () => {
    const flow = fs.readFileSync(path.join(process.cwd(), "src/components/ClarificationFlow.jsx"), "utf8");
    expect(flow).toMatch(/window\.addEventListener\("sc:open-stepper", onOpen\)/);
    const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(src).toMatch(/if \(a\.kind === "stepper"\) \{ window\.dispatchEvent\(new CustomEvent\("sc:open-stepper"\)\)/);
  });
});
