import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import RecurringView from "../src/components/views/RecurringView.jsx";

const src = (f) => readFileSync(`src/components/views/${f}.jsx`, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n");

describe("C579 — every small control does what it says", () => {
  it("Recurring: a due cost is 'Add to bills' — the word the owner can act on, and what actually happens", () => {
    const rule = { id: "r1", name: "Rent", vendor: "Franklin Ave", amount: 2400, frequency: "monthly", next_date: "2020-01-01", active: true, gl_code: "6100", gl_name: "Rent" };
    const html = renderViewHtml(RecurringView, { recurring: [rule], companyDataLoaded: true, BOOKABLE_ACCOUNTS: [] }).replace(/<!-- -->/g, "");
    expect(html).toMatch(/>Add to bills</);
    expect(html).toMatch(/>Add all to bills</);
    expect(html).not.toMatch(/>Post</);
    expect(html).not.toMatch(/repeat automatically/);
  });
  it("Taxes: no 'Remind me' that sets no reminder", () => {
    expect(src("TaxView")).not.toMatch(/Remind me/);
  });
  it("Vendors: one 1099 answer, never a second pill that could contradict it", () => {
    expect(src("VendorsView")).not.toMatch(/status1099/);
  });
  it("1099s: after the download, the owner is told what to do with the file; a missing EIN links to where to add it", () => {
    const s = src("Tax1099View");
    expect(s).toMatch(/1099 file downloaded ✓ Next: send it to your accountant, or upload it to your filing service/);
    expect(s).toMatch(/onClick=\{\(\)=>setView && setView\("settings"\)\}[^>]*>Add it in Settings → Company</);
  });
});
