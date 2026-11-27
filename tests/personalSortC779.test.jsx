// ★ C779 — "Were these personal?" (sorting a mixed account in one tap a week) and
// ★ C780 — "Put about $X of it aside for taxes" when money comes in.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { personalKind, personalCandidates, personalSortDue, personalSortPlan, PERSONAL_SORT_COPY, PERSONAL_BATCH_MIN } from "../src/lib/personalSort.js";
import { paymentSetAsideLine } from "../src/lib/taxSetAside.js";
import { taxEstimate } from "../src/lib/tax.js";

const TODAY = "2026-11-27";
const e = (id, vendor, amount, date, gl = "6400", extra = {}) => ({ id, db_entry_id: id, vendor, amount, date, gl_code: gl, gl_name: "Travel & Entertainment", debit_credit: "debit", type: "expense", status: "booked", ...extra });

describe("C779 — what looks personal", () => {
  it("★★ the everyday personal kinds, by what a statement prints", () => {
    expect(personalKind("NETFLIX.COM 866-579")).toBe("streaming");
    expect(personalKind("KROGER #512")).toBe("groceries");
    expect(personalKind("H-E-B #044 AUSTIN")).toBe("groceries");
    expect(personalKind("UBER EATS")).toBe("food delivery");
    expect(personalKind("STARBUCKS STORE 1234")).toBe("coffee and fast food");
    expect(personalKind("PLANET FITNESS")).toBe("gym and personal care");
    expect(personalKind("ADOBE CREATIVE CLOUD")).toBeNull();
    expect(personalKind("UBER TRIP")).toBeNull();   // a ride can be business travel — not asked
    expect(personalKind("")).toBeNull();
  });
});

describe("C779 — which charges are asked about", () => {
  const ledger = [
    e(1, "NETFLIX.COM", 15.49, "2026-11-20"),
    e(2, "KROGER #512", 84.10, "2026-11-22"),
    e(3, "UBER EATS", 31.00, "2026-11-25"),
    e(4, "ADOBE", 59.99, "2026-11-21", "6500"),                                   // not personal-looking
    e(5, "STARBUCKS", 6.25, "2026-05-01"),                                        // older than 90 days
    e(6, "SPOTIFY", 11.99, "2026-11-18", "3300"),                                 // already a draw
    e(7, "DOORDASH", 22.00, "2026-11-19", "6400", { status: "voided" }),         // undone
    e(8, "WHOLE FOODS", 120.00, "2026-11-23", "6400", { debit_credit: "credit" }),// a refund
  ];
  it("★★★ live personal-looking SPENDING in the last 90 days, newest first", () => {
    const got = personalCandidates({ invoices: ledger, rules: [], today: TODAY });
    expect(got.map((g) => g.vendor)).toEqual(["UBER EATS", "KROGER #512", "NETFLIX.COM"]);
    expect(got[0]).toMatchObject({ entryId: "3", amount: 31, kind: "food delivery" });
  });
  it("★★★ a vendor with a rule has been answered — never asked again", () => {
    const got = personalCandidates({ invoices: ledger, rules: [{ vendor: "Kroger #512", gl_code: "3300" }], today: TODAY });
    expect(got.map((g) => g.vendor)).not.toContain("KROGER #512");
  });
  it("★★ a batch, not a drip: a few waiting, or the oldest has waited a week", () => {
    expect(personalSortDue([])).toBe(false);
    expect(personalSortDue([{ age: 2 }, { age: 1 }])).toBe(false);
    expect(personalSortDue(Array.from({ length: PERSONAL_BATCH_MIN }, () => ({ age: 0 })))).toBe(true);
    expect(personalSortDue([{ age: 7 }])).toBe(true);
  });
});

describe("C779 — what the answer writes", () => {
  const items = personalCandidates({ invoices: [e(1, "NETFLIX.COM", 15.49, "2026-11-20"), e(2, "KROGER #512", 84.10, "2026-11-22"), e(3, "Kroger #512", 40, "2026-11-24")], rules: [], today: TODAY });
  const DRAW = { code: "3300", name: "Owner's Draw / Distributions" };
  it("★★★ ticked → moved to Owner's Draw with a rule to it; unticked → stays, with a rule to its category", () => {
    const p = personalSortPlan(items, new Set(["2", "3"]), DRAW);
    expect(p.move.map((x) => x.id).sort()).toEqual([2, 3]);
    expect(p.rules).toEqual([
      { vendor: "Kroger #512", gl_code: "3300", gl_name: "Owner's Draw / Distributions" },
      { vendor: "NETFLIX.COM", gl_code: "6400", gl_name: "Travel & Entertainment" },
    ]);
    expect([p.personalCount, p.businessCount]).toEqual([2, 1]);
  });
  it("★★ one vendor answered both ways in a batch → its rule says business (the expense stays)", () => {
    const p = personalSortPlan(items, new Set(["2"]), DRAW);
    expect(p.rules.filter((r) => /kroger/i.test(r.vendor))).toEqual([{ vendor: "Kroger #512", gl_code: "6400", gl_name: "Travel & Entertainment" }]);
    expect(p.move.map((x) => x.id)).toEqual([2]);
  });
  it("★ no Owner's Draw account → nothing moves", () => {
    expect(personalSortPlan(items, new Set(["2"]), null).move).toEqual([]);
  });
  it("★★ the copy", () => {
    expect(PERSONAL_SORT_COPY.title(3)).toBe("Were these personal?");
    expect(PERSONAL_SORT_COPY.save(2)).toBe("Save — 2 personal");
    expect(PERSONAL_SORT_COPY.save(0)).toBe("Save — all business");
    expect(PERSONAL_SORT_COPY.done(2, 1)).toBe("Saved: 2 personal (counted as money you took out), 1 kept as business. We'll remember these.");
  });
});

describe("C779 — wired in", () => {
  it("★★★ Home shows the card; the app recodes to Owner's Draw through persistRecode and saves a rule per vendor", () => {
    const home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(home).toContain("<PersonalSort />");
    const a = readFileSync("src/App.jsx", "utf8");
    const i = a.indexOf("const sortPersonalCharges = async");
    const block = a.slice(i, a.indexOf("};", a.indexOf("return true;", i)));
    expect(block).toContain('getAccountByRole?.("owners_draw")');
    expect(block).toContain("await persistRecode(plan.move, String(draw.code), draw.name)");
    expect(block).toContain("await persistChatRule(r)");
    expect(a).toContain("const erpCtx = { sortPersonalCharges,");
  });
});

describe("C780 — what to keep back from a payment", () => {
  it("★★★ the difference the payment makes to the year's estimate", () => {
    expect(paymentSetAsideLine({ before: { total: 1000 }, after: { total: 1150 }, amount: 500 }))
      .toEqual({ amount: 150, text: "Put about $150 of it aside for taxes — roughly what it adds to this year's tax bill (about 30%)." });
  });
  it("★★ nothing added → says so, honestly", () => {
    expect(paymentSetAsideLine({ before: { total: 0 }, after: { total: 0 }, amount: 500 }).text).toBe("No tax to set aside from this one yet, going by this year's books so far.");
    expect(paymentSetAsideLine({ before: null, after: { total: 1 }, amount: 500 })).toBeNull();
  });
  it("★★★ on a real ledger: $500 of income on top of a profitable year adds real tax", () => {
    const year = [{ id: 1, vendor: "Brand", amount: 40000, date: "2026-03-01", gl_code: "4100", type: "revenue", debit_credit: "credit", status: "booked" }];
    const inv = { id: 2, vendor: "AllDay Pizza", amount: 500, date: "2026-11-27", gl_code: "4100", type: "revenue", debit_credit: "credit", status: "booked" };
    const line = paymentSetAsideLine({ before: taxEstimate(year, 2026), after: taxEstimate([inv, ...year], 2026), amount: 500 });
    expect(line.amount).toBeGreaterThan(50);    // self-employment tax alone is ~14%
    expect(line.amount).toBeLessThan(250);
  });
  it("★★ the assistant's 'Recorded' message is followed by it", () => {
    const a = readFileSync("src/App.jsx", "utf8");
    const i = a.indexOf('if (action.type === "record_income")');
    const block = a.slice(i, a.indexOf('if (action.type === "reverse_entry")', i));
    expect(block).toContain("const keep = jeId ? setAsideFor(inv, ledgerBefore) : null;");
    expect(block.indexOf("summary.push(`Recorded ${fmtMoney(inv.amount)}")).toBeLessThan(block.indexOf("summary.push(keep.text)"));
  });
});

import { renderViewHtml } from "./helpers/renderView.jsx";
import PersonalSort from "../src/components/PersonalSort.jsx";
describe("C779 — the card on Home", () => {
  const today = new Date().toISOString().slice(0, 10);
  const ctx = { invoices: [e(1, "NETFLIX.COM", 15.49, today), e(2, "KROGER #512", 84.10, today), e(3, "UBER EATS", 31, today)], rules: [], sortPersonalCharges: () => {}, isViewer: false };
  it("★★★ lists each charge ticked as personal, one Save, and the separate-account tip", () => {
    const h = renderViewHtml(PersonalSort, ctx).replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
    expect(h).toContain("Were these personal?");
    expect((h.match(/data-personal-item=/g) || []).length).toBe(3);
    expect((h.match(/checked=""/g) || []).length).toBe(3);
    expect(h).toContain("Save — 3 personal");
    expect(h).toContain("a separate free checking account just for the business");
  });
  it("★★ nothing for a view-only teammate, or when fewer than a batch are waiting", () => {
    expect(renderViewHtml(PersonalSort, { ...ctx, isViewer: true })).toBe("");
    expect(renderViewHtml(PersonalSort, { ...ctx, invoices: ctx.invoices.slice(0, 1) })).toBe("");
  });
});
