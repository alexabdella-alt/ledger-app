import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ═════════════════════════════════════════════════════════════════════════════
// TIER 1 #10 — 1099s OFF BY DEFAULT, ON WHEN THE ACCOUNTANT SAYS SO.
//
// The item was written as "default it off". Reading the code found something worse: the
// flag was **non-functional in both directions**, so neither half of that sentence was
// happening.
//   · The database column is `is_1099`. Every reader in the UI asks for `is1099`. The load
//     spread the row as-is, so a flag genuinely SET in the database read back `undefined`
//     and rendered "Not flagged" — and the count of vendors needing a 1099 was
//     structurally zero, on a screen a CPA files from.
//   · The toggle called `setContacts` and `logAudit` and **never wrote to the database**,
//     so setting it LOOKED done — badge flipped, audit row written — and was gone on the
//     next reload.
//
// ★ THIS FLAG DECIDES WHO GETS A 1099 FILED UNDER THE ACCOUNTANT'S NAME. A silent revert
// means a vendor they deliberately marked comes back unmarked, and nobody is told.
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const vendors = fs.readFileSync(path.join(ROOT, "src/components/views/VendorsView.jsx"), "utf8");
const baseline = fs.readFileSync(path.join(ROOT, "supabase/migrations/000_baseline_schema.sql"), "utf8");

describe("★★ the flag round-trips", () => {
  it("the load maps the DB column to the name every reader uses", () => {
    expect(app).toMatch(/is1099:\s*!!c\.is_1099/);
  });

  it("★ and NO reader drifts back to the snake_case column name", () => {
    // The original defect: the column is `is_1099` and every reader asked for `is1099`, so
    // a flag genuinely set in the database read back undefined. The rule is that the
    // snake_case name appears ONLY at the two boundary points that talk to the database —
    // the load mapping and the save payload — and nowhere a component can reach.
    //
    // ★ THIS USED TO REQUIRE `is1099` IN TaxView. It no longer reads the flag AT ALL: the
    // 1099 count is now derived from what suppliers were actually paid and what they are
    // (C256), which is strictly stronger than reading the correctly-named flag. Requiring
    // the name would have blocked that — so the assertion names the PROPERTY (no component
    // touches the raw column) rather than a specific reader.
    const components = [];
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, f.name);
        if (f.isDirectory()) walk(full);
        else if (/\.jsx$/.test(f.name)) components.push(full);
      }
    })(path.join(ROOT, "src/components"));

    const offenders = [];
    for (const f of components) {
      const code = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n");
      if (/\bis_1099\b/.test(code)) offenders.push(path.relative(ROOT, f));
    }
    expect(offenders).toEqual([]);

    // The vendor list still shows the badge, so it still reads the mapped name.
    expect(vendors.split("\n").filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n")).toMatch(/is1099/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// ★★★ THE SETTER IS GONE (C316), AND THESE FOUR TESTS WENT WITH IT — SAY WHY.
//
// They pinned real properties of `setVendor1099`: that it wrote through a checked
// update, that it put the badge back when the write failed, that neither toggle
// mutated local state on its own. All correct, all now moot, because the FIELD it
// wrote is read by nothing. C256 replaced the flag with a derivation and left the
// writer behind; `contacts.is_1099` is consulted by neither the Tax page, nor
// `form1099.js`, nor the AI context — all three read `is_1099_exempt` and
// `business_type` instead.
//
// ★★ SO THE PROPERTY WORTH HOLDING CHANGED SHAPE: it is no longer "the write is
// checked", it is "NOTHING WRITES THIS FIELD AS A DECISION". A test deleted along
// with its subject is a guarantee lost quietly; this is the replacement, and it
// fails the moment a setter comes back.
// ════════════════════════════════════════════════════════════════════════════
describe("★★ the retired flag stays retired", () => {
  it("no component sets is_1099 — the badge is derived, not toggled", () => {
    const files = fs.readdirSync("src/components/views").filter((f) => f.endsWith(".jsx"));
    for (const f of ["../src/App.jsx", ...files.map((f) => `../src/components/views/${f}`)]) {
      const src = fs.readFileSync(new URL(f, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      expect([f, /setVendor1099\s*\(/.test(src)]).toEqual([f, false]);
      expect([f, /patch:\s*\{\s*is_1099:/.test(src)]).toEqual([f, false]);
    }
  });

  it("★ the Vendors badge reads the DERIVATION — the same function the Tax page uses", () => {
    const v = fs.readFileSync(new URL("../src/components/views/VendorsView.jsx", import.meta.url), "utf8");
    expect(v).toMatch(/import \{[^}]*verdictFor[^}]*\} from "\.\.\/\.\.\/lib\/form1099"/);
    expect(v).toMatch(/verdictFor\(vendor, reportablePayments\(rows, roleOfCode\)\)/);
    // …and it is not a button any more: a control that changes nothing is worse than none.
    expect(v).not.toMatch(/Flag for 1099|Unflag 1099/);
  });
});

describe("★ off by default, and NOT derived", () => {
  it("the database default is false and not-null — the 'off by default' half", () => {
    expect(baseline).toMatch(/is_1099 boolean DEFAULT false NOT NULL/);
  });

  it("★★ nothing sets the flag automatically — eligibility is NOT guessed", () => {
    // Services-vs-goods, the payee's entity type and the $600 threshold are TIER 3 and
    // deliberately not computed. An automatic guess here is wrong 1099s filed under the
    // accountant's name — the one thing worse than asking them.
    const setterCalls = [...app.matchAll(/is_1099:\s*([^,}]+)/g)].map((m) => m[1].trim());
    for (const v of setterCalls) {
      // Only ever a human's explicit intent (`want`), the persisted value, or false.
      expect(v).toMatch(/^(want|before|false|contact\.is1099\|\|false)$/);
    }
  });
});
