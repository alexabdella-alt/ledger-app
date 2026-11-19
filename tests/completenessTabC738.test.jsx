// ★ C738 — the Completeness tab: it reads every table in pages, a failed read shows NO verdicts
// (never a false green), and the table draws one row per client with its months and findings.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadCompleteness, CompletenessTab } from "../src/components/views/AdminView.jsx";

// A fake supabase: from(table).select().in().order().range(a,b) → { data, error }
const fake = (tables, { failOn = null, pageSize = 1000 } = {}) => ({
  from: (t) => {
    const q = { select: () => q, in: () => q, order: () => q, is: () => q, neq: () => q,
      range: async (a, b) => (t === failOn ? { data: null, error: { message: "permission denied" } } : { data: (tables[t] || []).slice(a, b + 1), error: null }) };
    return q;
  },
});
const NOW = new Date(2026, 10, 18, 12);
const tables = {
  companies: [{ id: "c1", name: "Red River Pizza Co.", cutoff_date: "2026-10-01" }, { id: "c2", name: "Leaky Co" }],
  document_intake: [{ company_id: "c2", status: "failed", received_at: "2026-11-02T10:00:00Z", filename: "bad.jpg" }, { company_id: "c1", status: "recorded", received_at: "2026-10-03T10:00:00Z" }],
  bank_accounts: [{ id: "a1", company_id: "c1", name: "Chase", active: true, institution: "Chase" }],
  bank_statements: [{ id: "s1", company_id: "c1", bank_account_id: "a1", period_start: "2026-10-01", period_end: "2026-10-31", status: "complete" }],
  bank_statement_lines: [],
  reconciliations: [{ company_id: "c1", account_id: "a1", status: "complete", statement_balance: 5, period_start: "2026-10-01", period_end: "2026-10-31" }],
};

describe("the Completeness tab", () => {
  it("★ reads every table and builds the report", async () => {
    const st = await loadCompleteness(fake(tables), NOW);
    expect(st.failed).toBeUndefined();
    expect(st.report.map((r) => [r.name, r.status])).toEqual([["Leaky Co", "problem"], ["Red River Pizza Co.", "complete"]]);
  });
  it("★ pages past 1,000 rows (PostgREST's cap) — a client on row 1,001 is not dropped", async () => {
    const many = Array.from({ length: 1205 }, (_, i) => ({ id: `x${i}`, name: `Co ${String(i).padStart(4, "0")}` }));
    const st = await loadCompleteness(fake({ ...tables, companies: many }), NOW);
    expect(st.report).toHaveLength(1205);
  });
  it("★ a table that can't be read shows NO verdicts — it says it can't vouch, and names what failed", async () => {
    const st = await loadCompleteness(fake(tables, { failOn: "bank_statement_lines" }), NOW);
    expect(st.report).toBeUndefined();
    expect(st.failed).toEqual(["statement lines (permission denied)"]);
    const h = renderToStaticMarkup(<CompletenessTab supabase={fake(tables)} enterSupport={() => {}} initial={st} />);
    expect(h).toContain("data-completeness-failed");
    expect(h).toContain("this is <strong>not</strong> a clean bill");
    expect(h).not.toContain("data-completeness-row");
  });
  it("draws a row per client, problems first, with the first finding in words", async () => {
    const st = await loadCompleteness(fake(tables), NOW);
    const h = renderToStaticMarkup(<CompletenessTab supabase={fake(tables)} enterSupport={() => {}} initial={st} />);
    const rows = [...h.matchAll(/data-completeness-row="([a-z]+)"/g)].map((m) => m[1]);
    expect(rows).toEqual(["problem", "complete"]);
    expect(h).toContain("1 with something missing");
    expect(h).toContain("1 upload from November 2026 failed (bad.jpg).");
    expect(h).toContain("Cash, and any card or account we have no statements for, are outside every check.");
  });
  it("it's the first tab on Operations", () => {
    const src = readFileSync("src/components/views/AdminView.jsx", "utf8");
    expect(src).toMatch(/const \[tab, setTab\] = React\.useState\("completeness"\);/);
    expect(src).toMatch(/const TABS = \[\["completeness", "Completeness"\],/);
  });
});
