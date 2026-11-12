import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { visibleNav, activeNavItem, canSeeView, MONEY_GROUP, NAV_ACTIONS } from "../src/lib/nav.js";
import { moneyTiles, MONEY_PAGE_COPY } from "../src/lib/moneyPage";
import { renderViewHtml } from "./helpers/renderView.jsx";
import MoneyView from "../src/components/views/MoneyView.jsx";

// C636 — the owner's menu: Home · Money · Reports · Ask, plus Settings. Nothing removed.
const owner = { role: "owner" };
const rows = (nav) => nav.sections.flatMap((s) => s.items.map(([id]) => id));

describe("the owner's menu", () => {
  it("★ is four places and Settings", () => {
    expect(rows(visibleNav(owner))).toEqual(["home", "money", "reports", "ask", "settings"]);
  });
  it("★ every list the old menu had is still openable, and opening it highlights Money", () => {
    for (const v of ["books", "ap", "ar", "customers", "vendors", "docs", "send-invoice"]) {
      expect([v, canSeeView(v, owner)]).toEqual([v, true]);
      expect([v, activeNavItem(v, { seat: "client" })]).toEqual([v, "money"]);
    }
  });
  it("the accountant's menu is unchanged, and their lists highlight themselves", () => {
    expect(rows(visibleNav({ role: "accountant" }))).toEqual(["home", "books", "ap", "ar", "customers", "vendors", "docs", "reports", "review"]);
    expect(activeNavItem("ap", { seat: "reviewer" })).toBe("ap");
  });
  it("in Settings, the Settings row opens into its pages (and is not shown twice)", () => {
    const r = rows(visibleNav({ ...owner, inSettings: true }));
    expect(r).toContain("coa");
    expect(r).toContain("tax1099");
    expect(r.filter((x) => x === "settings")).toHaveLength(1);
  });
  it("★ Ask is an action that opens the assistant, not a page", () => {
    expect(NAV_ACTIONS).toEqual(["ask"]);
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const go = \(id\) => \{\s*\n\s*if \(id === "ask"\) \{ setChatOpen\(true\); return; \}/);
    expect(app).toMatch(/\{view==="money" && <MoneyView \/>\}/);
  });
});

describe("the Money page", () => {
  const tiles = moneyTiles({ owe: 4306, billsOpen: 2, owed: 1086.25, invoicesOpen: 1,
    invoices: [{ id: "a_1", db_entry_id: "a" }, { id: "a_2", db_entry_id: "a" }, { id: "b", db_entry_id: "b" }, { id: "o", db_entry_id: "o", source: "opening_balance" }],
    contacts: [{ type: "vendor" }, { type: "vendor" }, { type: "customer" }], docs: [{}, {}, {}] });
  const by = (v) => tiles.find((t) => t.view === v);

  it("★ one tile per list, in plain words, with the amounts Home's tiles use", () => {
    expect(tiles.map((t) => t.view)).toEqual(["ap", "ar", "send-invoice", "books", "customers", "vendors", "docs"]);
    expect(by("ap").figure).toBe("2 bills · $4,306.00");
    expect(by("ar").figure).toBe("1 invoice · $1,086.25");
    expect(by("books").figure).toBe("2 entries");   // entries, not lines; the starting balances not counted
    expect([by("customers").figure, by("vendors").figure, by("docs").figure]).toEqual(["1 customer", "2 vendors", "3 files"]);
  });
  it("an empty company reads as a place to start, not as zeros", () => {
    const empty = moneyTiles({});
    expect(empty.find((t) => t.view === "ap").figure).toBe("All paid up");
    expect(empty.find((t) => t.view === "books").figure).toBe("Nothing yet — drop a document on Home");
  });
  it("renders every tile and the way to ask", () => {
    const html = renderViewHtml(MoneyView, { invoices: [], contacts: [], docLibrary: [], getAccountByRole: () => null });
    for (const v of ["ap", "ar", "send-invoice", "books", "customers", "vendors", "docs"]) expect(html).toContain(`data-money-tile="${v}"`);
    expect(html).toContain(MONEY_PAGE_COPY.intro);
    expect(html).toContain("Ask →");
  });
  it("the Money page's lists are exactly the group Money highlights", () => {
    for (const t of tiles) expect([t.view, MONEY_GROUP.includes(t.view)]).toEqual([t.view, true]);
  });
});
