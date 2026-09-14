import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import RecurringView from "../src/components/views/RecurringView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C360 — THE RECURRING SCREEN'S "POST NOW" NEVER WROTE THE ENTRY. It put the entry in React
// state, advanced next_date in React state, wrote an audit row saying it had posted, and said
// "Posted ✓" — the C288 voidBook shape (the audit trail recording what never happened), on a
// screen a client reaches through Settings. "+ Add" was a setState too. A source-structure
// guard, stated as weaker than a run: the writes are in App.jsx and the harness cannot click.
// ═════════════════════════════════════════════════════════════════════════════
const src = fs.readFileSync(path.join(process.cwd(), "src/components/views/RecurringView.jsx"), "utf8");
const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("★★ C360 — posting a recurring transaction WRITES it, and says so only afterwards", () => {
  it("books through bookToDb, awaits it, and refuses to claim a post that did not land", () => {
    const run = code.slice(code.indexOf("const runRecurring = async (r) => {"), code.indexOf("const newRec = recurringNewRec"));
    expect(run.length).toBeGreaterThan(200);
    expect(run).toMatch(/const jeId = await bookToDb\(inv\);\s*if \(!jeId\) \{/);
    expect(run).toMatch(/was NOT posted/);
    // the optimistic row is removed on failure — the screen follows the database
    expect(run).toMatch(/if \(!jeId\) \{\s*setInvoices\(prev => prev\.filter\(i => i\.id !== inv\.id\)\)/);
  });
  it("★ the run is RECORDED on the rule before 'Posted ✓', so a reload cannot offer the month again", () => {
    const run = code.slice(code.indexOf("const runRecurring = async (r) => {"), code.indexOf("const newRec = recurringNewRec"));
    const rec = run.indexOf("await recordRecurringRun(r.id, { last_run: today, next_date: nextDate })");
    const ok = run.indexOf("if (rec?.ok) showNotification(`Posted:");
    expect(rec).toBeGreaterThan(0);
    expect(ok).toBeGreaterThan(rec);
    expect(run).toMatch(/Don't post it twice/);
  });
  it("★ '+ Add' goes through the verified insert the chat uses, and a refused insert creates nothing", () => {
    const add = code.slice(code.indexOf("const addRecurring = async () => {"), code.indexOf("return (", code.indexOf("const addRecurring")));
    expect(add).toMatch(/const res = await createRecurring\(\{/);
    expect(add).toMatch(/if \(!res\?\.ok\) \{[\s\S]{0,200}Nothing was created[\s\S]{0,40}return; \}/);
    expect(add).not.toMatch(/setRecurring\(prev => \[r, \.\.\.prev\]\)/);
  });
  it("App exposes both writers, and createRecurring IS the chat's persistChatRecurring", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    expect(app).toMatch(/const createRecurring = \(args\) => persistChatRecurring\(args\);/);
    expect(app).toMatch(/updateVerified\(supabase, "recurring_transactions", id, \{ last_run, next_date \}\)/);
  });
  it("renders the due banner for a rule that is due", () => {
    const html = renderViewHtml(RecurringView, { ...POPULATED, recurring: [{ id: "r1", name: "Rent", vendor: "Franklin Ave", amount: 2400, frequency: "monthly", next_date: "2020-01-01", active: true, gl_code: "6100", gl_name: "Rent" }] });
    expect(html).toContain("due today");
  });
});
