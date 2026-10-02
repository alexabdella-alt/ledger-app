import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { auditCoverage, auditCsv, slimAuditState, readFullAuditLog, auditRowsForDownload, AUDIT_LIST_KEEP, AUDIT_SCREEN_ROWS } from "../src/lib/auditTrail.js";
import { readAllRows } from "../src/lib/pagedRead.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import AuditView from "../src/components/views/AuditView.jsx";

// A fake query builder over `rows`, honouring .range() the way PostgREST does.
function fakeTable(rows, { failAt = null } = {}) {
  const calls = [];
  const build = () => {
    const q = { range: (from, to) => { calls.push([from, to]); if (failAt != null && from >= failAt) return Promise.resolve({ data: null, error: { message: "boom" } }); return Promise.resolve({ data: rows.slice(from, to + 1), error: null }); } };
    for (const m of ["select", "eq", "order", "is"]) q[m] = () => q;
    return q;
  };
  return { build, calls };
}
const rowsOf = (n) => Array.from({ length: n }, (_, i) => ({ id: i, created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}`, action: "invoice_booked", detail: `row ${i}`, performed_by: "owner" }));

describe("C569 — readAllRows reads every row, or says the read failed", () => {
  it("reads past the 1,000-row page", async () => {
    const t = fakeTable(rowsOf(2345));
    const { data, error } = await readAllRows(t.build);
    expect(error).toBeNull();
    expect(data).toHaveLength(2345);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("an exact multiple of the page size still ends", async () => {
    const t = fakeTable(rowsOf(2000));
    const { data } = await readAllRows(t.build);
    expect(data).toHaveLength(2000);
    expect(t.calls).toHaveLength(3);
  });
  it("a page that fails fails the whole read — no partial list", async () => {
    const t = fakeTable(rowsOf(2345), { failAt: 1000 });
    const { data, error } = await readAllRows(t.build);
    expect(data).toBeUndefined();
    expect(error).toBeTruthy();
  });
  it("running out of pages is an error, never a short list that looks complete", async () => {
    const t = fakeTable(rowsOf(50));
    const { data, error } = await readAllRows(t.build, { pageSize: 10, maxPages: 3 });
    expect(data).toBeUndefined();
    expect(String(error.message)).toMatch(/More than 30 rows/);
  });
  it("the company load pages every list it used to read bare", () => {
    const src = readFileSync("src/App.jsx", "utf8");
    for (const t of ["contacts", "ar_invoices", "documents", "unknown_documents"]) {
      expect(src).toMatch(new RegExp(`readAllRows\\(\\(\\) => supabase\\.from\\("${t}"\\)[^\\n]*\\.order\\("id"`));
    }
  });
});

describe("C568 — the audit trail says how much of it you are looking at", () => {
  it("no claim of a total when the database did not give one", () => {
    expect(auditCoverage(1000, null)).toEqual({ partial: false, total: null, line: null });
    expect(auditCoverage(1000, undefined).total).toBeNull();
    expect(auditCoverage(1000, []).total).toBeNull();
    expect(auditCoverage(1000, NaN).total).toBeNull();
  });
  it("all of it on screen — nothing to say", () => {
    expect(auditCoverage(40, 40).partial).toBe(false);
    expect(auditCoverage(40, 40).line).toBeNull();
  });
  it("part of it on screen — says newest N of M, and that the download has all M", () => {
    const c = auditCoverage(1000, 4210);
    expect(c.partial).toBe(true);
    expect(c.line).toBe("Showing the newest 1,000 of 4,210 events. The counts below cover these 1,000; the download has all 4,210.");
  });

  it("the full read pages the whole table, newest first, in the screen's shape", async () => {
    const t = fakeTable(rowsOf(1500));
    const sb = { from: vi.fn(() => t.build()) };
    const { data, error } = await readFullAuditLog(sb, "co1");
    expect(error).toBeNull();
    expect(data).toHaveLength(1500);
    expect(data[0]).toEqual({ id: 0, ts: rowsOf(1)[0].created_at, action: "invoice_booked", detail: "row 0", before: undefined, after: undefined, user: "owner" });
  });

  it("a full read whose page fails returns the error, not a short list", async () => {
    const t = fakeTable(rowsOf(1500), { failAt: 1000 });
    const { data, error } = await readFullAuditLog({ from: () => t.build() }, "co1");
    expect(data).toBeUndefined();
    expect(error).toBeTruthy();
  });

  it("the download writes what is loaded when that is everything", async () => {
    const readFull = vi.fn();
    const r = await auditRowsForDownload({ loaded: [1, 2, 3], total: 3, readFull });
    expect(r.rows).toEqual([1, 2, 3]);
    expect(readFull).not.toHaveBeenCalled();
  });
  it("the download reads the whole trail when the screen holds part of it", async () => {
    const r = await auditRowsForDownload({ loaded: [1, 2], total: 5, readFull: async () => ({ data: [1, 2, 3, 4, 5], error: null }) });
    expect(r.rows).toEqual([1, 2, 3, 4, 5]);
  });
  it("and downloads nothing when that read fails — never the window under the trail's name", async () => {
    const r = await auditRowsForDownload({ loaded: [1, 2], total: 5, readFull: async () => ({ data: undefined, error: new Error("x") }) });
    expect(r.rows).toBeNull();
    expect(r.error).toBeTruthy();
    const none = await auditRowsForDownload({ loaded: [1, 2], total: 5, readFull: null });
    expect(none.rows).toBeNull();
  });
  it("the screen's download goes through it", () => {
    const src = readFileSync("src/components/views/AuditView.jsx", "utf8");
    expect(src).toMatch(/await auditRowsForDownload\(\{ loaded: auditLog, total: auditTotal, readFull: readFullAuditLog \}\)/);
  });

  it("the CSV quotes every field", () => {
    const csv = auditCsv([{ ts: "2026-01-02T03:04:05.000Z", action: "x", detail: 'say "hi", ok', user: "a,b" }]);
    expect(csv.split("\n")[1]).toBe('"2026-01-02 03:04:05","x","say ""hi"", ok","a,b"'.replace('"a,b"', '"a,b"'));
  });

  it("the screen's total and download count come from the database count, not the window", () => {
    const rows = rowsOf(3).map(a => ({ id: a.id, ts: a.created_at, action: a.action, detail: a.detail, user: "owner" }));
    const html = renderViewHtml(AuditView, { auditLog: rows, auditTotal: 4210, companyDataLoaded: true, auditActionFilter: "all", auditSearch: "", loadFailures: {} });
    expect(html).toContain("Download CSV (4,210 events)");
    expect(html).toMatch(/Showing the newest 3 of 4,210 events/);
    expect(html).toContain("older events are in the download");
    expect(html).toMatch(/TOTAL EVENTS<\/div><div[^>]*>4210</);
  });
  it("with everything on screen it reads as before", () => {
    const rows = rowsOf(3).map(a => ({ id: a.id, ts: a.created_at, action: a.action, detail: a.detail, user: "owner" }));
    const html = renderViewHtml(AuditView, { auditLog: rows, auditTotal: 3, companyDataLoaded: true, auditActionFilter: "all", auditSearch: "", loadFailures: {} });
    expect(html).not.toContain("data-audit-coverage");
    expect(html).toContain("scroll to see all");
  });

  it("the load asks for the exact count and keeps the screen window", () => {
    const src = readFileSync("src/App.jsx", "utf8");
    expect(src).toMatch(/from\("audit_log"\)\.select\("\*", \{ count: "exact" \}\)[^\n]*\.limit\(AUDIT_SCREEN_ROWS\)/);
    expect(AUDIT_SCREEN_ROWS).toBe(1000);
  });
});

describe("C568 — an event's snapshot says when a list in it was trimmed", () => {
  it("a short list is kept whole, with no marker", () => {
    expect(slimAuditState([{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });
  it("a long list keeps its first rows and names how many more there were", () => {
    const out = slimAuditState(Array.from({ length: 40 }, (_, i) => ({ id: i })));
    expect(out).toHaveLength(AUDIT_LIST_KEEP + 1);
    expect(out[AUDIT_LIST_KEEP - 1]).toEqual({ id: AUDIT_LIST_KEEP - 1 });
    expect(out[AUDIT_LIST_KEEP]).toEqual({ _omitted: 40 - AUDIT_LIST_KEEP, _of: 40 });
  });
  it("file contents are still dropped by name", () => {
    expect(slimAuditState({ id: 1, base64: "AAA", raw_text: "t", notes_for_reviewer: "n", vendor: "Sysco" })).toEqual({ id: 1, vendor: "Sysco" });
  });
  it("logAudit stores through it", () => {
    const src = readFileSync("src/App.jsx", "utf8");
    expect(src).toMatch(/const slim = slimAuditState;/);
    expect(src).not.toMatch(/obj\.slice\(0, 5\)/);
  });
});

describe("C569 — the other lists that grow without bound are read whole", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const shadow = readFileSync("src/lib/shadowIo.js", "utf8");
  it("anomalies — dismissed history is what stops a dismissed finding re-firing", () => {
    expect(app).toMatch(/await readAllRows\(\(\) => supabase\.from\("anomalies"\)/);
  });
  it("contact lookups by name — a miss past row 1,000 minted a duplicate", () => {
    expect(app).toMatch(/readAllRows\(\(\) => supabase\.from\("contacts"\)\.select\("id, name"\)/);
    expect(app).toMatch(/readAllRows\(\(\) => supabase\.from\("contacts"\)\.select\("\*"\)\.eq\("company_id", currentCompany\.id\)\.order\("id"\)\)/);
  });
  it("shadow calibration — every journal line in the period, not the first thousand", () => {
    for (const t of ["vendor_state", "universal_vendor_directory", "journal_entry_lines"]) {
      expect(shadow).toMatch(new RegExp(`readAllRows\\(\\(\\) => supabase\\.from\\("${t}"\\)`));
    }
  });
});
