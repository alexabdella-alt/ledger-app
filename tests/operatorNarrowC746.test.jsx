// ★ C746 — two things found on the live app (2026-11-18, signed in as the operator):
//  (1) the "⚠ 7 clients need you" badge was in the DOM but hidden at phone width (674px) — so on a
//      phone the operator never saw it. Now a short "⚠ 7" shows there.
//  (2) a company with books but no upload (starting balances, typed in, imported) read "Nothing
//      uploaded yet" — empty, when its books exist and nothing checks them against the bank.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { completenessReport } from "../src/lib/completeness.js";

const css = readFileSync("src/styles.css", "utf8");
const phone = css.slice(css.indexOf("@media (max-width: 760px)"), css.indexOf("@media (max-width: 420px)"));
const NOW = new Date(2026, 10, 18, 12);

describe("C746 — the badge on a phone", () => {
  it("★★ the short form shows at 760px and under, and only there", () => {
    expect(css.slice(0, css.indexOf("@media (max-width: 760px)"))).toMatch(/\.sc-show-narrow \{ display: none; \}/);
    expect(phone).toMatch(/\.sc-show-narrow \{ display: inline !important; \}/);
    expect(phone).toMatch(/\.sc-hide-narrow \{ display: none !important; \}/);
  });
  it("★★ the badge carries both forms, and isn't wrapped in something hidden on a phone", () => {
    const src = readFileSync("src/components/OperatorAlertBadge.jsx", "utf8");
    expect(src).toContain('<span className="sc-hide-narrow">{badge.text}</span><span className="sc-show-narrow">{badge.short}</span>');
    expect(readFileSync("src/App.jsx", "utf8")).not.toMatch(/sc-hide-narrow"><OperatorAlertBadge/);
  });
});

const co = { id: "c1", name: "Books Only LLC" };
describe("C746 — books without an upload are books", () => {
  it("★★★ entries but no upload and no statement: 'No bank statement yet', not empty", () => {
    const r = completenessReport({ companies: [co], entries: [{ company_id: "c1", entry_date: "2026-06-19" }], now: NOW })[0];
    expect(r.status).toBe("problem");
    expect(r.items.map((i) => i.kind)).toEqual(["no_statements"]);
  });
  it("★★ the books start at the first entry, so months before it aren't counted", () => {
    const r = completenessReport({ companies: [co], entries: [{ company_id: "c1", entry_date: "2026-09-02" }, { company_id: "c1", entry_date: "2026-10-01" }], now: NOW })[0];
    expect(r.months.filter((m) => m.status === "before").map((m) => m.period)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });
  it("★★ a statement starting after the first entry flags the unchecked months", () => {
    const r = completenessReport({ companies: [co], entries: [{ company_id: "c1", entry_date: "2026-08-10" }],
      accounts: [{ id: "a1", company_id: "c1", name: "Chase", active: true, institution: "Chase" }],
      statements: [{ id: "s1", company_id: "c1", bank_account_id: "a1", period_start: "2026-10-01", period_end: "2026-10-31", status: "complete" }], now: NOW })[0];
    expect(r.items.some((i) => i.kind === "pre_statement" && i.period === "2026-08")).toBe(true);
  });
  it("★ nothing at all is still empty; another company's entries don't count", () => {
    const r = completenessReport({ companies: [co], entries: [{ company_id: "c2", entry_date: "2026-06-19" }], now: NOW })[0];
    expect(r.status).toBe("empty");
  });
});
