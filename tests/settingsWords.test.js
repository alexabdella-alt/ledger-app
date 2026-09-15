// U3 / C378 — Settings speaks the client's words. Every client screen has said "Category"
// since C330; Settings still said "Chart of Accounts", "Rules", "Recurring". The rows and the
// screens they open now agree, and every Settings row label passes the jargon bar.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { NAV_SECTION_SETTINGS } from "../src/lib/nav.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

describe("Settings rows", () => {
  it("every label passes the jargon bar, and the four renamed ones read as the client says them", () => {
    const labels = Object.fromEntries(NAV_SECTION_SETTINGS.items);
    for (const l of Object.values(labels)) expect([l, containsOwnerJargon(l)]).toEqual([l, false]);
    expect(labels.coa).toBe("Categories");
    expect(labels.rules).toBe("Supplier rules");
    expect(labels.recurring).toBe("Recurring charges");
    expect(labels["opening-balances"]).toBe("Bank accounts & starting balances");
    expect(labels.tax1099).toBe("Tax forms (1099s)");
  });
  it("the screen headings match their rows", () => {
    expect(read("src/components/views/CoaView.jsx")).toContain(">Categories</h1>");
    expect(read("src/components/views/RulesView.jsx")).toContain(">Supplier rules</h1>");
    expect(read("src/components/views/RecurringView.jsx")).toContain(">Recurring charges</h1>");
    expect(read("src/components/views/OpeningBalancesView.jsx")).toContain(">Bank accounts &amp; starting balances</h1>");
    for (const f of ["CoaView", "RulesView", "RecurringView"]) expect(read(`src/components/views/${f}.jsx`)).not.toMatch(/<h1[^>]*>(Chart of Accounts|Vendor Rules|Recurring Transactions)<\/h1>/);
  });
});
