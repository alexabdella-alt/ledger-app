import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

// C581 — an entry and its amounts are written together, or not at all. The ordering and
// "no line insert outside the importer" guards are in ledgerWritesAreChecked.test.js; these
// are the parts that file does not pin, plus migration 095.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
const app = strip(readFileSync("src/App.jsx", "utf8"));
const qbo = strip(readFileSync("src/components/views/QBOImportView.jsx", "utf8"));
const m095 = readFileSync("supabase/migrations/095_journal_entry_balance_trigger.sql", "utf8");

describe("C581 — one writer of entries in the app, and it is the atomic one", () => {
  it("App.jsx never inserts an entry header or its lines directly — the fallback is gone", () => {
    expect(app).not.toMatch(/from\("journal_entries"\)\s*\.insert\(/);
    expect(app).not.toMatch(/from\("journal_entry_lines"\)\s*\.insert\(/);
  });
  it("a failed post says nothing was recorded and returns no id", () => {
    const i = app.indexOf('console.error("post_journal_entry failed:"');
    expect(i).toBeGreaterThan(0);
    const tail = app.slice(i, i + 420);
    expect(tail).toMatch(/nothing was recorded/);
    expect(tail).toMatch(/return null;/);
  });
});

describe("C581 — the QuickBooks import counts an entry only when its amounts landed", () => {
  const ins = qbo.indexOf('from("journal_entry_lines").insert(lines).select("id")');
  const check = qbo.indexOf("lineErr || !lineRows || lineRows.length !== lines.length");
  const thrown = qbo.indexOf("throw new Error(lineErr?.message", check);
  const counted = qbo.indexOf("imported += (created || []).length");
  it("the lines insert is read back, and checked before anything is counted", () => {
    expect(ins).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(ins);
    expect(counted).toBeGreaterThan(thrown);
  });
  it("a withdrawal that itself fails is audited by name, with the entry ids", () => {
    expect(qbo).toMatch(/withdrawn\.length !== ids\.length\) \{\s*logAudit && logAudit\("qbo_import_orphan_headers"/);
    expect(qbo).toMatch(/entry_ids: ids\.map\(String\)/);
  });
});

describe("C581 — migration 095: the database refuses an entry that does not balance", () => {
  it("is a constraint trigger deferred to commit — an entry is unbalanced between its first line and its last", () => {
    expect(m095).toMatch(/create constraint trigger journal_entry_lines_balance[\s\S]*deferrable initially deferred/);
  });
  it("fires on money and on moving a line — never on a tag", () => {
    expect(m095).toMatch(/after insert or delete or update of debit, credit, journal_entry_id\s+on public\.journal_entry_lines/);
  });
  it("has no exemption for any caller, and raises the class a CHECK would", () => {
    const body = m095.slice(m095.indexOf("begin;"));
    expect(body).not.toMatch(/auth\.uid\(\)|service_role|is_platform_admin/);
    expect(body).toMatch(/errcode = '23514'/);
    expect(body).toMatch(/if v_debit <> v_credit then/);
  });
  it("is still marked HOLD until it has been applied and recorded", () => {
    const applied = /`095`/.test(readFileSync("CLAUDE.md", "utf8").split("\n").find((l) => l.includes("APPLIED & VERIFIED LIVE — THE LEDGER")) || "");
    if (!applied) expect(m095).toMatch(/▶ HOLD/);
  });
});
