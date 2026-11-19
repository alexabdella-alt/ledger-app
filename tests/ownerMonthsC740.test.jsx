// ★ C740 — a month shows ✓ Complete by itself; the owner never signs anything off. The owner's line
// reads the SAME completeness report as the operator's page, so the two ✓s cannot disagree; it asks
// the owner only for what they can do (a statement); everything else is "our team".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { completenessReport, ownerMonthLine } from "../src/lib/completeness.js";
import { loadCompleteness } from "../src/lib/completenessLoad.js";
import { MonthStatusView } from "../src/components/views/MonthStatus.jsx";

const NOW = new Date(2026, 10, 18, 12);
const co = { id: "c1", name: "Red River Pizza Co.", cutoff_date: "2026-09-01" };
const acct = { id: "a1", company_id: "c1", name: "Chase Checking", active: true, institution: "Chase" };
const stmt = (id, s, e) => ({ id, company_id: "c1", bank_account_id: "a1", period_start: s, period_end: e, status: "complete" });
const base = { companies: [co], accounts: [acct], intake: [{ company_id: "c1", status: "recorded", received_at: "2026-09-03T10:00:00Z" }],
  statements: [stmt("s9", "2026-09-01", "2026-09-30"), stmt("s10", "2026-10-01", "2026-10-31")],
  recons: [{ company_id: "c1", account_id: "a1", status: "complete", statement_balance: 9, period_start: "2026-09-01", period_end: "2026-10-31" }], openLines: [], now: NOW };
const lines = (over = {}) => {
  const r = completenessReport({ ...base, ...over })[0];
  return Object.fromEntries(r.months.map((m) => [m.period, ownerMonthLine(m)?.text || null]));
};

describe("the owner's months", () => {
  it("★ complete months say so, and say what complete means; this month is in progress", () => {
    const l = lines();
    expect(l["2026-10"]).toBe("October 2026 — complete. Every upload is in and it matches your bank.");
    expect(l["2026-09"]).toBe("September 2026 — complete. Every upload is in and it matches your bank.");
    expect(l["2026-11"]).toBe("November 2026 — in progress.");
    expect(l["2026-08"]).toBe(null);   // before the books start
  });
  it("★ a month the operator closed reads 'closed' (and a closed month with a hole is NOT shown closed)", () => {
    expect(lines({ signoffs: [{ company_id: "c1", period: "2026-10" }] })["2026-10"]).toBe("October 2026 — closed. Every upload is in and it matches your bank.");
    expect(lines({ signoffs: [{ company_id: "c1", period: "2026-10", revoked_at: "2026-11-01" }] })["2026-10"]).toMatch(/— complete\./);
    // closed, but an upload from that month failed afterwards: not "closed" — our team has it
    const holed = lines({ signoffs: [{ company_id: "c1", period: "2026-10" }], intake: [...base.intake, { company_id: "c1", status: "failed", received_at: "2026-10-20T00:00:00Z", filename: "late.pdf" }] });
    expect(holed["2026-10"]).toBe("October 2026 — our team is finishing this month.");
  });
  it("★ asks the owner only for what they can do — a missing statement", () => {
    expect(lines({ statements: [base.statements[0]] })["2026-10"]).toBe("October 2026 — waiting for your Chase Checking statement. Drop it on Home.");
  });
  it("★ everything else is our team's: a stuck upload, open bank lines, not matched yet", () => {
    const stuck = lines({ intake: [...base.intake, { company_id: "c1", status: "failed", received_at: "2026-10-04T00:00:00Z", filename: "x" }] });
    expect(stuck["2026-10"]).toBe("October 2026 — our team is finishing this month.");
    const open = lines({ openLines: [{ company_id: "c1", statement_id: "s10", line_date: "2026-10-09", status: "pending" }] });
    expect(open["2026-10"]).toBe("October 2026 — our team is finishing this month.");
  });
  it("the owner's words carry no operator jargon and no 'accountant'", () => {
    for (const t of Object.values(lines({ statements: [base.statements[0]] }))) if (t) expect(t).not.toMatch(/accountant|upload.*never reached|reconcil|sign.off/i);
  });
});

describe("the month list on Reports", () => {
  it("★ a read that fails is never shown as matched (C761: the line is simply absent)", async () => {
    const fake = { from: () => { const q = { select: () => q, in: () => q, order: () => q, is: () => q, neq: () => q, eq: () => q, range: async () => ({ data: null, error: { message: "boom" } }) }; return q; } };
    const st = await loadCompleteness(fake, NOW, { companyId: "c1" });
    const h = renderToStaticMarkup(<MonthStatusView state={st} />);
    expect(st.failed && st.failed.length).toBeTruthy();
    expect(h).toBe("");   // C761 — one quiet line on Reports: on a failed read it says NOTHING, never "match your bank"
  });
  it("one company only: every table is scoped to it", async () => {
    const calls = [];
    const fake = { from: (t) => { const q = { select: () => q, in: () => q, order: () => q, is: () => q, neq: () => q, eq: (c, v) => { calls.push([t, c, v]); return q; }, range: async () => ({ data: [], error: null }) }; return q; } };
    await loadCompleteness(fake, NOW, { companyId: "c1" });
    expect(calls.map(([t, c]) => `${t}.${c}`).sort()).toEqual(["bank_accounts.company_id", "bank_statement_lines.company_id", "bank_statements.company_id", "companies.id", "document_intake.company_id", "journal_entries.company_id", "period_signoffs.company_id", "reconciliations.company_id"]);
  });
  it("renders one line on Reports (C761: how far the books match the bank)", () => {
    const st = { report: completenessReport(base) };
    const h = renderToStaticMarkup(<MonthStatusView state={st} now={NOW} />).replace(/&#x27;/g, "'");
    expect(h).toMatch(/Your books (match your bank through|aren't matched to your bank yet)/);
    expect(h).not.toContain("Your months");
  });
  it("★ the owner's Reports shows the months, not the sign-off panel", () => {
    const rv = readFileSync("src/components/views/ReportsView.jsx", "utf8");
    expect(rv).toMatch(/\{ownerSeat && !drill && !plDrill && <MonthStatus \/>\}/);
    expect(rv).not.toMatch(/<TrustPanel/);
  });
});
