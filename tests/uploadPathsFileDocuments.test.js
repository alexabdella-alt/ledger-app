import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// EVERY INTAKE PATH FILES ITS SOURCE DOCUMENT — the last part of the library item.
//
// The library's header promises "every uploaded file — invoices, contracts, bank
// statements, payroll — stored and searchable". The QuickBooks import stored **nothing**:
// it produced journal entries with no retrievable source.
//
// ★ IT MATTERS MOST FOR THE THING THIS PRODUCT SELLS. A signed-off period is an
// attestation, and the primary document behind a batch of entries has to exist in the
// system for that attestation to mean anything. A whole QuickBooks history arriving with
// no source file is the largest version of that gap available.
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const stripComments = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l)).join("\n");

// The surfaces that accept a file from a person. Each must file it.
const INTAKE_SURFACES = [
  ["universal upload + contracts", "src/App.jsx"],
  ["payroll register", "src/components/views/PayrollView.jsx"],
  ["QuickBooks import", "src/components/views/QBOImportView.jsx"],
];

describe("★★ every path that accepts a file stores it", () => {
  for (const [label, rel] of INTAKE_SURFACES) {
    it(`${label} calls storeDocument`, () => {
      expect(stripComments(read(rel))).toMatch(/storeDocument\(/);
    });
  }

  it("★★ and passes the actual FILE, not just its name", () => {
    // `storeDocument` uploads `file || b64ToBlob(base64)`. With both null it writes a
    // metadata row and NO bytes — a library entry pointing at nothing, which is worse than
    // no entry because it looks like the file is there.
    const qbo = stripComments(read("src/components/views/QBOImportView.jsx"));
    expect(qbo).toMatch(/sourceFile/);
    expect(qbo).toMatch(/storeDocument\([^)]*sourceFile\)/s);

    const payroll = stripComments(read("src/components/views/PayrollView.jsx"));
    // Payroll already did this correctly — pinned so it stays that way.
    // ★ THE REGEX WAS `[^)]*` AND MY OWN LATER CHANGE BROKE IT: adding `(isPdf ? … : …)`
    // to the call put a `)` inside the argument list, which a negated-paren class cannot
    // cross. It failed against CORRECT code. Matching to the call's END is the property
    // actually being asserted — that the last argument is the File.
    expect(payroll).toMatch(/storeDocument\([\s\S]*?null, file\);/);
  });

  it("★ QBO keeps the File object, which is why it could not store one before", () => {
    // Everything downstream had only `fileName`. There was nothing left to store by the
    // time the import ran — the defect was upstream of the missing call.
    const qbo = read("src/components/views/QBOImportView.jsx");
    expect(qbo).toMatch(/setSourceFile\(file\)/);
  });

  it("★ it is typed within the column's CHECK, not by widening it", () => {
    // `documents_document_type_check` has no QuickBooks value. Widening a constraint to
    // file one document is the wrong trade; the tag carries the detail.
    const qbo = stripComments(read("src/components/views/QBOImportView.jsx"));
    expect(qbo).toMatch(/"other"/);
    expect(qbo).toMatch(/qbo_import/);
    const schema = read("supabase/migrations/000_baseline_schema.sql");
    const allowed = schema.match(/documents_document_type_check CHECK \(\(document_type = ANY \(ARRAY\[([^\]]+)\]\)\)\)/);
    expect(allowed, "could not read the document_type CHECK").toBeTruthy();
    expect(allowed[1]).toContain("'other'");
    expect(allowed[1]).not.toContain("qbo");
  });

  it("★ a failed store never takes the import down with it", () => {
    // The entries are the valuable thing; the source file is evidence about them. Losing
    // the evidence must not lose the work — but it is warned, not swallowed silently.
    const qbo = read("src/components/views/QBOImportView.jsx");
    const block = qbo.slice(qbo.indexOf("FILE THE SOURCE DOCUMENT"), qbo.indexOf("let imported = 0"));
    expect(block).toMatch(/try \{/);
    expect(block).toMatch(/console\.warn/);
  });
});
