import { describe, it, expect } from "vitest";
import { renderViewHtml } from "./helpers/renderView.jsx";
import BooksView from "../src/components/views/BooksView.jsx";

const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const OWNER = { isReviewerSeat: false, seat: "client" };
const CPA = { isReviewerSeat: true, seat: "reviewer" };

// C574 — the owner ease-of-use sweep: no screen an owner can reach is blank or a dead end.
describe("C574 — Transactions never strands an owner on the contracts filter", () => {
  it("an owner has no Contracts filter to click", () => {
    const t = text(renderViewHtml(BooksView, { navSeat: OWNER, invoices: [], booksFilter: "all", companyDataLoaded: true }));
    expect(t).toMatch(/Needs Review/);
    expect(t).not.toMatch(/\bContracts\b/);
  });
  it("an owner sent to that filter anyway (the chat, a stale setting) sees their transactions, not a blank page", () => {
    const t = text(renderViewHtml(BooksView, { navSeat: OWNER, invoices: [], booksFilter: "contracts", companyDataLoaded: true }));
    expect(t).toMatch(/Upload a document →/);
    expect(t).not.toMatch(/No contracts yet/);
  });
  it("the accountant keeps the contracts workbench", () => {
    const t = text(renderViewHtml(BooksView, { navSeat: CPA, invoices: [], booksFilter: "contracts", companyDataLoaded: true, contracts: [] }));
    expect(t).toMatch(/No contracts yet/);
  });
});

import { homeWaitingList } from "../src/lib/homeWaiting.js";
import { ownerAnomalyLine, ownerSignOffBlockers } from "../src/lib/ownerTrust.js";
import { dropZoneOutcomeCopy } from "../src/lib/statementLifecycle.js";
import { readFileSync } from "fs";

describe("C574 — an owner with no accountant is never told 'your accountant will…'", () => {
  const queue = [
    { status: "done", type: "contract" },
    { status: "done", type: "unknown" },
    { status: "done", type: "bank_statement", result: { needsReview: 2 } },
  ];
  it("each accountant-shaped item on Home offers the way to get one, instead of a promise", () => {
    const items = homeWaitingList({ uploadQueue: queue, hasAccountant: false });
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it.text, it.id).not.toMatch(/your accountant (will|is on)/);
      expect(it.actions.some((a) => a.view === "team" && a.label === "Invite your accountant"), it.id).toBe(true);
    }
    expect(items.find((i) => i.id === "unknown_doc").actions.some((a) => a.view === "docs")).toBe(true);
  });
  it("with an accountant, the wording and the (empty) actions are unchanged", () => {
    const items = homeWaitingList({ uploadQueue: queue, hasAccountant: true });
    expect(items.find((i) => i.id === "contract_ready").text).toBe("We've read your agreement — your accountant will record it.");
    for (const it of items) expect(it.actions).toEqual([]);
  });
  it("the default (not yet known) is 'has one' — we never claim they have none on a failed read", () => {
    expect(homeWaitingList({ uploadQueue: queue }).find((i) => i.id === "contract_ready").actions).toEqual([]);
  });
  it("the reviewer seat keeps its own actions either way", () => {
    expect(homeWaitingList({ uploadQueue: queue, cockpit: true, hasAccountant: false }).find((i) => i.id === "contract_ready").actions[0].view).toBe("contracts");
  });
  it("unusual activity, the statement outcome and the solo sign-off say what to do", () => {
    expect(ownerAnomalyLine([{ severity: "medium" }], { hasAccountant: false })).toMatch(/ask the assistant about it, or invite your accountant/);
    expect(ownerAnomalyLine([{ severity: "medium" }])).toMatch(/your accountant will look it over/);
    expect(dropZoneOutcomeCopy({ total: 5, booked: 3, exceptions: 2, hasAccountant: false })).toMatch(/Invite yours from Settings → Team/);
    expect(dropZoneOutcomeCopy({ total: 0, hasAccountant: false })).toMatch(/as a CSV/);
    const solo = ownerSignOffBlockers([{ net: "accuracy" }, { net: "mystery" }], { hasAccountant: false });
    for (const s of solo) expect(s).not.toMatch(/your accountant can see/);
    expect(ownerSignOffBlockers([{ net: "accuracy" }])[0]).toMatch(/your accountant can see which/);
  });
  it("the screens pass it through", () => {
    const dash = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(dash).toMatch(/hasAccountant: hasAttester !== false/);
    expect(dash).toMatch(/ownerAnomalyLine\(anomalies, \{ hasAccountant \}\)/);
    expect(dash).toMatch(/alreadyReconciled:!!item\.result\.alreadyReconciled, hasAccountant \}\)/);
    const trust = readFileSync("src/components/views/TrustPanel.jsx", "utf8");
    expect((trust.match(/hasAccountant: false/g) || []).length).toBe(2);
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/hasAccountant: hasAttester !== false \}\)\);/);
  });
});

import { reminderEmail, reminderMailto, customerEmail } from "../src/lib/invoiceReminder.js";
import ArView from "../src/components/views/ArView.jsx";

describe("C574 — every door marked 'chase' chases", () => {
  it("the reminder says who, how much and how late, signed by the business", () => {
    const e = reminderEmail({ customer: "Bright Co", amount: 1250, daysOverdue: 12, companyName: "Ana Design" });
    expect(e.subject).toBe("Payment reminder from Ana Design");
    expect(e.body).toBe("Hi Bright Co,\n\nA friendly reminder that $1,250.00 is now 12 days past due. Could you let us know when we can expect payment?\n\nThank you,\nAna Design");
    expect(reminderEmail({ customer: "X", amount: 5, daysOverdue: 0 }).body).toMatch(/\$5\.00 is due\./);
  });
  it("the link opens the owner's mail app addressed to the customer when we know their email", () => {
    const m = reminderMailto({ email: "pay@bright.co", customer: "Bright Co", amount: 10, daysOverdue: 1, companyName: "A" });
    expect(m.startsWith("mailto:pay@bright.co?subject=")).toBe(true);
    expect(decodeURIComponent(m)).toMatch(/1 day past due/);
    expect(customerEmail([{ name: "Bright Co", email: "pay@bright.co" }], " bright co ")).toBe("pay@bright.co");
    expect(customerEmail([{ name: "Bright Co" }], "Bright Co")).toBe("");
  });
  it("Money owed to you offers it on every unpaid invoice — 'Follow Up →' no longer just switches tabs", () => {
    const inv = { id: "i1", vendor: "Bright Co", amount: 1250, date: "2026-08-01", due_date: "2026-08-31", gl_code: "4000", gl_name: "Sales", type: "revenue", payment_status: "unpaid" };
    const src = readFileSync("src/components/views/ArView.jsx", "utf8");
    expect(src).not.toMatch(/>Follow Up →</);
    expect((src.match(/>Send reminder →</g) || []).length).toBe(2);   // the invoice card and the overdue table
    expect(src).toMatch(/reminderMailto\(\{ email: customerEmail\(contacts, inv\.vendor\)/);
    void inv;
  });
  it("Home's 'Chase overdue invoices' opens the overdue list on Money owed to you, not a bare list", () => {
    const dash = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(dash).toMatch(/if \(c\.key === "ar"\) \{ navTo\("ar", \(\) => setArView && setArView\("collections"\)\); return; \}/);
    expect(dash).not.toMatch(/Open accounts (payable|receivable)/);
    expect(readFileSync("src/components/views/ReportsView.jsx", "utf8")).toMatch(/href=\{reminderMailto\(/);
  });
});

import ApView from "../src/components/views/ApView.jsx";
import VendorsView from "../src/components/views/VendorsView.jsx";
import CustomersView from "../src/components/views/CustomersView.jsx";
import DocsView from "../src/components/views/DocsView.jsx";

describe("C577 — every empty owner screen says what it's for and where to go next", () => {
  const base = { navSeat: OWNER, companyDataLoaded: true, invoices: [], contacts: [], docLibrary: [], loadFailures: {}, arView: "inbox", apView: "unpaid", vendorsSelectedContact: null, vendorSummary: [], vendorFilter: "" };
  const cases = [
    ["Bills to pay", ApView, /Bills to pay/, /Upload a bill on Home →/],
    ["Money owed to you", ArView, /No unpaid invoices/, /Send an invoice →/],
    ["Vendors", VendorsView, /Everyone you pay/, /Upload a bill on Home/],
    ["Customers", CustomersView, /Everyone who pays you/, /Send an invoice →/],
    ["Documents", DocsView, /No documents yet/, /Upload on Home →/],
  ];
  for (const [name, View, purpose, next] of cases) {
    it(`${name}: purpose and a next-step button`, () => {
      const html = renderViewHtml(View, base);
      expect(text(html), name).toMatch(purpose);
      expect(text(html), name).toMatch(next);
      expect(html, name).toContain("data-next-step");
    });
  }
  it("Money owed to you's empty page has its own two buttons (the header's 'Send an invoice' doesn't count)", () => {
    const html = renderViewHtml(ArView, base);
    expect((html.match(/data-next-step/g) || []).length).toBe(2);
  });
  it("no owner screen still says 'tell the AI chat' or 'AI controller'", () => {
    for (const f of ["VendorsView", "CustomersView", "DashboardView"]) {
      const src = readFileSync(`src/components/views/${f}.jsx`, "utf8");
      expect(src, f).not.toMatch(/tell the AI chat|AI controller/);
    }
  });
});
