// ★ C748 — seen on the live app as the owner: the transactions view, reached any way other than the
// Money tab, was the accountant's screen ("BOOKS · All transactions · … AI reasoning, and actions"),
// with the Money tab lit above it. An owner on that view now gets their Money page.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { MONEY_GROUP } from "../src/lib/nav.js";

describe("C748 — the owner's transactions view is Money", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("★★ the 'books' view mounts Money for an owner and the full list for the accountant", () => {
    expect(app).toContain('{view==="books" && (navSeat.isReviewerSeat ? <BooksView /> : <MoneyView />)}');
    expect(app).not.toMatch(/\{view==="books" && <BooksView \/>\}/);
  });
  it("and Money stays the lit tab there, as before", () => {
    expect(MONEY_GROUP).toContain("books");
  });
});
