import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { categoryLabel, showCodesFor } from "../src/lib/categoryLabel.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import ApView from "../src/components/views/ApView.jsx";

const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("C575 — an owner sees a category's name, not its number", () => {
  it("owner: the name; reviewer: code and name; no name: the code, never a blank", () => {
    expect(categoryLabel("6100", "Rent & Occupancy")).toBe("Rent & Occupancy");
    expect(categoryLabel("6100", "Rent & Occupancy", { withCode: true })).toBe("6100 · Rent & Occupancy");
    expect(categoryLabel("6100", "", { withCode: false })).toBe("6100");
    expect(categoryLabel(null, null)).toBe("—");
  });
  it("the seat decides, and an unknown seat keeps the codes (the screen is built for both)", () => {
    expect(showCodesFor({ isReviewerSeat: true })).toBe(true);
    expect(showCodesFor({ isReviewerSeat: false })).toBe(false);
    expect(showCodesFor(null)).toBe(true);
  });
  it("Bills to pay shows an owner the category name only", () => {
    const bill = { id: "b1", vendor: "Sysco", amount: 412.5, date: "2026-09-01", due_date: "2026-10-01", gl_code: "5010", gl_name: "Food Cost", type: "expense", payment_status: "unpaid", offset_code: "2000", secondary_gl_code: "2000" };
    const owner = text(renderViewHtml(ApView, { navSeat: { isReviewerSeat: false }, invoices: [bill], companyDataLoaded: true }));
    const cpa = text(renderViewHtml(ApView, { navSeat: { isReviewerSeat: true }, invoices: [bill], companyDataLoaded: true }));
    expect(owner).toMatch(/Food Cost/);
    expect(owner).not.toMatch(/5010/);
    expect(cpa).toMatch(/5010 · Food Cost/);
  });
  it("every owner screen that shows a category goes through it — no bare code left", () => {
    const files = ["views/BooksView.jsx", "views/ApView.jsx", "views/VendorsView.jsx", "views/CustomersView.jsx", "views/RulesView.jsx",
      "views/RecurringView.jsx", "views/DashboardView.jsx", "views/SettingsView.jsx", "TransactionDetailPanel.jsx"];
    for (const f of files) {
      const src = readFileSync(`src/components/${f}`, "utf8");
      expect(src, f).not.toMatch(/\{(inv|i|r|rule)\.gl_code\} ?(·|—|–)? ?\{(inv|i|r|rule)\.gl_name\}/);
      expect(src, f).not.toMatch(/>\{a\.code\} ?(—|–|·)? ?\{a\.name\}</);
      expect(src, f).not.toMatch(/value=\{a\.code\}>\{a\.code\}</);
    }
  });
});
