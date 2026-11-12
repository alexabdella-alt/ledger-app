// A journal entry is its lines. Two client paths wrote a header and then its lines as
// separate, unchecked steps — found in the 2026-11-12 design review:
//   · the QuickBooks importer never read the line insert's error, so a refused chunk left
//     headers with no legs, counted as imported;
//   · `persistJournalEntry` fell back to a non-atomic header-then-lines insert whenever
//     the RPC's error TEXT looked like "function missing" (which a transient schema-cache
//     error also matches), and returned the entry's id even when the lines were refused.
// These pin the SHAPE in source because both are network-bound; the database-side guard
// (migration 095, a deferred balance trigger) is the half that does not depend on a caller.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

describe("★ the QuickBooks importer does not count an entry whose lines did not land", () => {
  const code = strip(read("src/components/views/QBOImportView.jsx"));
  it("★★ every insert into journal_entry_lines reads its error", () => {
    const inserts = code.match(/[^\n]*from\("journal_entry_lines"\)\.insert\([^\n]*/g) || [];
    expect(inserts.length).toBeGreaterThan(0);
    for (const line of inserts) expect(line, "an unchecked line insert").toMatch(/const \{[^}]*error[^}]*\}\s*=\s*await/);
  });
  it("★★ a failed line insert withdraws the headers BEFORE the chunk can be counted", () => {
    const ins = code.indexOf('from("journal_entry_lines").insert(');
    const withdraw = code.indexOf("deleted_at", ins), thrown = code.indexOf("throw new Error", ins), counted = code.indexOf("imported += ", ins);
    expect(withdraw).toBeGreaterThan(ins);
    expect(thrown).toBeGreaterThan(withdraw);
    expect(counted).toBeGreaterThan(thrown);          // counting is only reachable past the throw
  });
  it("★ a header that could not be withdrawn is audited by name, not left quiet", () => {
    expect(code).toMatch(/qbo_import_orphan_headers/);
  });
});

describe("★ persistJournalEntry has one writer, and it is the atomic one", () => {
  const code = strip(read("src/App.jsx"));
  it("★★ no client file inserts journal lines outside the importer", () => {
    const offenders = [];
    const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(f.name) && !p.endsWith("QBOImportView.jsx") && /from\("journal_entry_lines"\)\s*\.insert\(/.test(strip(fs.readFileSync(p, "utf8")))) offenders.push(p);
    } };
    walk(path.join(process.cwd(), "src"));
    expect(offenders, "a direct line insert bypasses post_journal_entry's balance check").toEqual([]);
  });
  it("★★ the text-matched 'RPC missing' fallback is gone", () => {
    expect(code).not.toMatch(/rpcMissing/);
    expect(code).not.toMatch(/legacyLines/);
  });
});
