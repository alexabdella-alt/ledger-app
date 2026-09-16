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
    expect(labels["opening-balances"]).toBe("Starting balances");   // C482 — the screen has no bank-account form; that lives on Company
    expect(labels.tax1099).toBe("Tax forms (1099s)");
  });
  it("the screen headings match their rows", () => {
    expect(read("src/components/views/CoaView.jsx")).toContain(">Categories</h1>");
    expect(read("src/components/views/RulesView.jsx")).toContain(">Supplier rules</h1>");
    expect(read("src/components/views/RecurringView.jsx")).toContain(">Recurring charges</h1>");
    expect(read("src/components/views/OpeningBalancesView.jsx")).toContain(">Starting balances</h1>");
    for (const f of ["CoaView", "RulesView", "RecurringView"]) expect(read(`src/components/views/${f}.jsx`)).not.toMatch(/<h1[^>]*>(Chart of Accounts|Vendor Rules|Recurring Transactions)<\/h1>/);
  });
});

// C482 — a Settings row must be named for what its screen holds. "Bank accounts & starting
// balances" opened a screen with NO bank-account form (that lives on the Company page), so a
// person adding their bank clicked the obvious row and found a grid. And the onboarding hint
// for "Add your bank account" must point at the screen the button actually opens.
describe("C482 · the row name and the door agree", () => {
  it("the starting-balances screen carries no bank-account form, so its row does not promise one", () => {
    const ob = read("src/components/views/OpeningBalancesView.jsx");
    expect(ob).not.toMatch(/institution|last4|Add bank account/i);
    const labels = Object.fromEntries(NAV_SECTION_SETTINGS.items);
    expect(labels["opening-balances"]).not.toMatch(/bank account/i);
  });
  it("the onboarding bank step's hint names the page its button opens", () => {
    const home = read("src/components/views/DashboardView.jsx");
    const step = home.slice(home.indexOf('bank:    { key:"bank"'), home.indexOf("}", home.indexOf('bank:    { key:"bank"')) + 1);
    expect(step).toMatch(/goToSection\("settings","bank-accounts-section"\)/);
    expect(step).toMatch(/hint:"Settings → Company → Bank accounts"/);
    expect(read("src/components/views/SettingsView.jsx")).toContain('id="bank-accounts-section"');
  });
});

// C485 — the Supplier-rules screen's example rule named a category that does not exist
// ("Shipping & Freight"); the assistant would have refused it (C260), so the one example on
// the empty screen was a rule nobody could make. The example names a category in the chart.
describe("C485 · the example rule names a real category", () => {
  it("the category in the example exists in the default chart", () => {
    const src = read("src/components/views/RulesView.jsx");
    const m = /things like "Always put [^"]* under ([^"]+)"/.exec(src);
    expect(m).toBeTruthy();
    const chart = read("src/lib/constants.js");
    expect(chart).toContain(`name: "${m[1]}"`);
  });
});
