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

describe("★★ setting it actually writes, and says so when it doesn't", () => {
  const body = app.slice(app.indexOf("const setVendor1099"), app.indexOf("const persistContact"));

  it("finds the setter", () => expect(body.length).toBeGreaterThan(400));

  it("★ writes through a CHECKED update — a zero-row write must not read as success", () => {
    expect(body).toMatch(/checkedRowUpdate\(/);
    expect(body).toMatch(/table: "contacts"/);
    expect(body).toMatch(/patch: \{ is_1099: want \}/);
  });

  it("★★ REVERTS THE BADGE when the write fails, rather than showing a state the books lack", () => {
    // The optimistic flip is what made the old bug invisible. Leaving it up on failure
    // would reproduce exactly that — C194's false-success class, on a filing decision.
    expect(body).toMatch(/1099_flag_write_failed/);
    expect(body).toMatch(/is1099: before/);
    expect(body).toMatch(/showNotification\(/);
  });

  it("★ NEITHER toggle mutates local state on its own any more", () => {
    // Both call sites must go through the setter. A `setContacts` that flips the flag
    // directly is the session-only write coming back.
    const code = vendors.split("\n").filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n");
    expect(code).not.toMatch(/setContacts\([^)]*is1099/);
    expect(code.match(/setVendor1099\(/g) || []).toHaveLength(2);
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
