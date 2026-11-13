import { describe, it, expect } from "vitest";
// C679 — fixtures moved one year back (2026→2025, 2025→2024): their amounts are about classification,
// and 2026 payments are judged at the new $2,000 floor (thresholdFor), 2025 at $600.
import { readFileSync } from "node:fs";
import { reportablePayments, entityStatus, tracker1099Rows, plan1099ForYear, verdictFor, ENTITY, VERDICT } from "../src/lib/form1099";
import { flattenJournalEntries } from "../src/lib/ledger";
import { toCSV } from "../src/lib/insights";
import { renderViewHtml } from "./helpers/renderView.jsx";
import Tax1099View from "../src/components/views/Tax1099View.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C589 — THE 1099 COUNT READS WHAT WAS BOUGHT, AND THE 1099 SCREEN READS THE SAME COUNT.
// Two defects from the whole-code review, both on the surface that produces the filing file:
//  R1  the PAYMENT of a bill was counted as a second purchase "we can't classify";
//  R2  the 1099 screen had its own arithmetic (unsigned, keyed on spelling, no goods rule).
// ═════════════════════════════════════════════════════════════════════════════
const chart = [
  { code: "1000", system_role: "cash" }, { code: "1100", system_role: "accounts_receivable" }, { code: "1500", system_role: "fixed_assets" },
  { code: "2000", system_role: "accounts_payable" }, { code: "4000", system_role: "revenue" },
  { code: "5000", system_role: "cogs" }, { code: "6250", system_role: "repairs_maintenance" }, { code: "6800", system_role: "professional_services" },
];
const role = (c) => chart.find((a) => a.code === String(c))?.system_role || null;
const row = (vendor, amount, gl_code, extra = {}) => ({ vendor, amount, gl_code, date: "2025-03-10", debit_credit: "debit", status: "posted", ...extra });

describe("R1 — paying a bill is not buying something twice", () => {
  const bill = row("Ace Plumbing", 1000, "6250", { id: "b1", offset_gl_code: "2000" });
  const payment = row("Ace Plumbing", 1000, "2000", { id: "p1", offset_gl_code: "1000", import_metadata: { payment_for: "b1" } });

  it("a bill and its payment count once, as the service it was", () => {
    const p = reportablePayments([bill, payment], role);
    expect(p.total).toBe(1000);
    expect(p.byKind).toEqual({ services: 1000 });
  });

  it("★ and the verdict is about $1,000 of services, not $2,000 'we can't classify'", () => {
    const v = verdictFor({ name: "Ace Plumbing", business_type: "individual" }, reportablePayments([bill, payment], role), { year: 2025 });
    expect(v.verdict).toBe(VERDICT.ELIGIBLE);
    expect(v.amount).toBe(1000);
  });

  it("a payment row is skipped by its ACCOUNT even when the link to its bill is missing", () => {
    const unlinked = { ...payment, import_metadata: {} };
    expect(reportablePayments([bill, unlinked], role).total).toBe(1000);
  });

  it("a row linked as a settlement is skipped whatever account it shows", () => {
    expect(reportablePayments([row("Ace Plumbing", 1000, "1500", { import_metadata: { payment_for: "b1" } })], role).total).toBe(0);
  });

  it("a sale to the same party, and money moving through cash, are not purchases", () => {
    const p = reportablePayments([row("Ace Plumbing", 400, "4000"), row("Ace Plumbing", 250, "1000"), row("Ace Plumbing", 90, "1100")], role);
    expect(p.total).toBe(0);
  });

  it("★ but something bought and put on the balance sheet still counts — and still asks", () => {
    // A contractor's installation capitalised as equipment is reportable; dropping every
    // non-expense row would have hidden it.
    const p = reportablePayments([row("Ace Plumbing", 3000, "1500")], role);
    expect(p.total).toBe(3000);
    expect(p.byKind).toEqual({ unknown: 3000 });
  });

  it("the real flatten produces exactly these shapes for a bill and its payment", () => {
    // Not a fixture agreeing with itself: the rows come from the function the app loads with.
    const acct = { e: { id: "e", code: "6250", name: "Repairs" }, ap: { id: "ap", code: "2000", name: "A/P" }, cash: { id: "cash", code: "1000", name: "Cash" } };
    const je = (id, lines, meta) => ({ id, entry_date: "2025-03-10", description: "Ace Plumbing", vendor: "Ace Plumbing", status: "posted", source: "manual", import_metadata: meta || null,
      journal_entry_lines: lines.map(([a, debit, credit], i) => ({ id: `${id}-${i}`, account_id: acct[a].id, debit, credit, accounts: acct[a] })) });
    const flat = flattenJournalEntries([je("b1", [["e", 1000, 0], ["ap", 0, 1000]]), je("p1", [["ap", 1000, 0], ["cash", 0, 1000]], { payment_for: "b1" })]);
    expect(flat.map((r) => [r.id, r.gl_code, r.vendor_key])).toEqual([["b1", "6250", "ace plumbing"], ["p1", "2000", "ace plumbing"]]);
    expect(reportablePayments(flat, role).total).toBe(1000);
  });
});

describe("the types the app itself saves are understood", () => {
  it.each([["individual", ENTITY.REPORTABLE], ["sole_prop", ENTITY.REPORTABLE], ["smllc", ENTITY.REPORTABLE], ["partnership", ENTITY.REPORTABLE],
    ["corp", ENTITY.EXEMPT], ["scorp", ENTITY.EXEMPT], ["nonprofit", ENTITY.EXEMPT]])("%s → %s", (t, want) => {
    expect(entityStatus({ name: "Ace Plumbing", business_type: t })).toBe(want);
  });

  it("★ every type the 1099 screen offers has an answer — none falls through to 'unknown'", () => {
    const src = readFileSync("src/components/views/Tax1099View.jsx", "utf8");
    const offered = [...src.matchAll(/\{ v:"([a-z_]+)",\s+label:/g)].map((m) => m[1]);
    expect(offered.length).toBeGreaterThanOrEqual(6);
    for (const t of offered) expect([t, entityStatus({ name: "X", business_type: t })]).not.toEqual([t, ENTITY.UNKNOWN]);
  });
});

describe("R2 — the 1099 screen's rows", () => {
  const contacts = [
    { id: 1, name: "Ace Plumbing", type: "vendor", business_type: "individual" },
    { id: 2, name: "Roma Cheese", type: "vendor", business_type: "individual" },
    { id: 3, name: "Smith Law Corp", type: "vendor", business_type: "corp" },
    { id: 4, name: "Bright Signs", type: "vendor" },
    { id: 5, name: "Plumbing Supply House", type: "vendor", business_type: "individual" },
  ];
  const invoices = [
    row("Ace Plumbing", 400, "6250"), row("ACE PLUMBING", 350, "6250"),                 // two spellings, one contractor
    row("Roma Cheese", 9000, "5000"),                                                   // goods
    row("Smith Law Corp", 2000, "6800"),                                                // legal, to a corporation
    row("Bright Signs", 900, "6250"),                                                   // services, type unknown
    row("Plumbing Supply House", 80, "6250"),                                           // under the floor
    row("Ace Plumbing", 5000, "6250", { status: "voided" }),                            // voided: not paid
    row("Ace Plumbing", 100, "6250", { debit_credit: "credit" }),                       // a correction reduces
    row("Ace Plumbing", 700, "6250", { date: "2024-12-30" }),                           // another year
  ];
  const rows = tracker1099Rows({ invoices, contacts, chart, year: 2025 });
  const by = (name) => rows.find((r) => r.name === name);

  it("★ two spellings of one contractor are ONE row, and together they cross the floor", () => {
    expect(rows.filter((r) => /ace plumbing/i.test(r.name))).toHaveLength(1);
    expect(by("Ace Plumbing").paid).toBe(650);                 // 400 + 350 − 100; voided and 2024 excluded
    expect(by("Ace Plumbing").status.key).toBe("needs");
  });

  it("★ a goods supplier is 'Not required', whatever was paid", () => {
    expect(by("Roma Cheese").status.key).toBe("none");
    expect(by("Roma Cheese").reportable).toBe(0);
  });

  it("legal fees to a corporation still need one", () => {
    expect(by("Smith Law Corp").status.key).toBe("needs");
  });

  it("an unknown type is a question, with the reason carried on the row", () => {
    expect(by("Bright Signs").status.key).toBe("unknown");
    expect(by("Bright Signs").why).toMatch(/don't know whether they're incorporated/);
  });

  it("★ an unknown row says WHICH question it is asking, so the screen offers the step that answers it", () => {
    expect(by("Bright Signs").ask).toBe("type");
    const r = tracker1099Rows({ invoices: [row("Ace Plumbing", 3000, "1500")], contacts: [contacts[0]], chart, year: 2025 });
    expect(r[0].status.key).toBe("unknown");
    expect(r[0].ask).toBe("category");
    expect(by("Ace Plumbing").ask).toBeNull();
    const src = readFileSync("src/components/views/Tax1099View.jsx", "utf8");
    expect(src).toMatch(/r\.ask==="category" && <button data-1099-ask="category" onClick=\{\(\)=>\{ setVendorFilter && setVendorFilter\(r\.ledgerName\)/);
    expect(src).toMatch(/r\.ask!=="category" && <button onClick=\{\(\)=>setEditing/);
  });

  it("★ a contact is matched by its exact vendor key, never by one name containing another", () => {
    // "Plumbing Supply House" contains "plumbing"; the old fuzzy match could hand it Ace's contact.
    expect(by("Plumbing Supply House").contact.id).toBe(5);
    expect(by("Plumbing Supply House").status.key).toBe("tracking");
    expect(by("Ace Plumbing").contact.id).toBe(1);
  });

  it("★ a vendor never borrows another vendor's details because their names overlap", () => {
    // The old screen matched "name contains name" in either direction: "Ace Plumbing Supply"
    // took the corporation answer saved for "Ace Plumbing" and was waved through as exempt.
    const r = tracker1099Rows({ invoices: [row("Ace Plumbing Supply", 900, "6250")],
      contacts: [{ id: 9, name: "Ace Plumbing", type: "vendor", business_type: "corp" }], chart, year: 2025 });
    expect(r).toHaveLength(1);
    expect(r[0].contact).toBeNull();
    expect(r[0].status.key).toBe("unknown");
  });

  it("★ it agrees with the plan the Taxes card and Home read, vendor for vendor", () => {
    const plan = plan1099ForYear({ invoices, contacts, chart, year: 2025 });
    const planNeeds = plan.eligible.map((r) => r.name).sort();
    expect(rows.filter((r) => r.status.key === "needs").map((r) => r.name).sort()).toEqual(planNeeds);
    expect(rows.filter((r) => r.status.key === "unknown").map((r) => r.name).sort()).toEqual(plan.needsInfo.map((r) => r.name).sort());
  });

  it("★ a name the person has said is the same vendor joins that vendor — here AND in the plan", () => {
    const cs = [{ id: 1, name: "Ace Plumbing", type: "vendor", business_type: "individual", aliases: ["A.P. Services"] }];
    const inv = [row("Ace Plumbing", 400, "6250"), row("A.P. Services", 350, "6250")];
    const r = tracker1099Rows({ invoices: inv, contacts: cs, chart, year: 2025 });
    expect(r).toHaveLength(1);
    expect(r[0].paid).toBe(750);
    expect(r[0].status.key).toBe("needs");
    expect(plan1099ForYear({ invoices: inv, contacts: cs, chart, year: 2025 }).eligible.map((x) => x.name)).toEqual(["Ace Plumbing"]);
  });

  it("a vendor with no contact yet is still listed, judged on the name alone", () => {
    const r = tracker1099Rows({ invoices: [row("New Handyman", 800, "6250")], contacts: [], chart, year: 2025 });
    expect(r).toHaveLength(1);
    expect(r[0].contact).toBeNull();
    expect(r[0].status.key).toBe("unknown");
  });

  it("a sent mark for the year reads 'Sent'", () => {
    const r = tracker1099Rows({ invoices: [row("Ace Plumbing", 800, "6250")], contacts: [{ ...contacts[0], sent_1099_years: [2025] }], chart, year: 2025 });
    expect(r[0].status.key).toBe("sent");
    const last = tracker1099Rows({ invoices: [row("Ace Plumbing", 800, "6250")], contacts: [{ ...contacts[0], sent_1099_years: [2024] }], chart, year: 2025 });
    expect(last[0].status.key).toBe("needs");
  });
});

describe("the screen itself", () => {
  const src = readFileSync("src/components/views/Tax1099View.jsx", "utf8");

  it("has no arithmetic of its own left", () => {
    expect(src).not.toMatch(/paidByVendor/);
    expect(src).not.toMatch(/Math\.abs\(/);
    expect(src).not.toMatch(/\.includes\(norm|norm\([^)]*\)\.includes/);
    expect(src).toMatch(/tracker1099Rows\(\{ invoices, contacts, chart: CHART_OF_ACCOUNTS, year: taxYear, aliasIndex \}\)/);
  });

  it("★ the download is quoted by the shared helper and carries the REPORTABLE amount", () => {
    expect(src).toMatch(/toCSV\(head, body\)/);
    expect(src).toMatch(/r\.reportable\.toFixed\(2\)/);
    expect(src).not.toMatch(/l\.join\(","\)/);
    // What the helper does with the cells this file hands it: a comma or a quote in a name
    // stays inside one cell rather than shifting every column after it.
    const out = toCSV(["Recipient Name", "Amount"], [['Smith, Jones & "Co"', "650.00"]]);
    expect(out.split("\n")[1]).toBe('"Smith, Jones & ""Co""",650.00');
  });

  it("renders a vendor who needs a 1099 and says why another needs an answer", () => {
    const y = new Date().getFullYear();
    const yr = new Date().getMonth() <= 2 ? y - 1 : y;   // the year the screen is about; see taxYearFor1099
    const mk = (vendor, amount) => ({ vendor, amount, gl_code: "6250", date: `${yr}-03-10`, debit_credit: "debit", status: "posted" });
    const html = renderViewHtml(Tax1099View, {
      invoices: [mk("Ace Plumbing", 2500), mk("Bright Signs", 2500)],   // C679 — over the floor in any year ($600 to 2025, $2,000 from 2026)
      contacts: [{ id: 1, name: "Ace Plumbing", type: "vendor", business_type: "individual" }],
      CHART_OF_ACCOUNTS: chart, aliasIndex: new Map(), companySettings: {},
    });
    expect(html).toMatch(/Ace Plumbing/);
    expect(html).toMatch(/Needs 1099/);
    expect(html).toMatch(/data-1099-why/);
  });
});
