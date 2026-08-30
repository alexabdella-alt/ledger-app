import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

// ═════════════════════════════════════════════════════════════════════════════
// ★★ O76 — "SCREENS THAT DON'T REFRESH AFTER A CHANGE", FROM THE WRITING END.
//
// The item is one line with no detail, so the class had to be found rather than looked up.
// It is this: **a view writes directly to the database, does not check the write landed,
// and then paints the new value from local state.** The screen is then right and the
// database never agreed — and the "it didn't refresh" complaint arrives on the NEXT load,
// when the value silently reverts.
//
// PostgREST reports NO error for an update that matched zero rows (C192), so `if (error)`
// alone is not a check. `.select()` is what makes the outcome observable.
//
// TWO LIVE INSTANCES FOUND:
//   · SettingsView — company settings reported saved without checking, and painted the new
//     name into the header optimistically.
//   · TaxView — the figures a PERSON TYPED (estimated payments, filed deadlines) failed to
//     a `console.warn` and nothing else. A silent failure of the user's own typing is the
//     worst kind: no reason to suspect it, no way to notice.
// ═════════════════════════════════════════════════════════════════════════════

const componentFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const full = path.join(d, f.name);
    if (f.isDirectory()) walk(full);
    else if (/\.jsx$/.test(f.name)) componentFiles.push(full);
  }
})(path.join(process.cwd(), "src/components"));

const strip = (t) => t.split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*")).join("\n");

describe("★★ a view that writes must be able to tell whether the write landed", () => {
  it("★★★ every row-targeted update/upsert from a view calls .select()", () => {
    const offenders = [];
    for (const f of componentFiles) {
      const rel = path.relative(process.cwd(), f);
      const src = strip(fs.readFileSync(f, "utf8"));
      // `supabase.from("x").update(...)` / `.upsert(...)` — look ahead for a `.select(`
      // before the statement ends.
      for (const m of src.matchAll(/supabase\s*\.?\s*\n?\s*\.from\("([a-z_]+)"\)\s*\n?\s*\.(update|upsert)\(/g)) {
        const tail = src.slice(m.index, m.index + 700);
        const stmtEnd = tail.indexOf(";");
        const stmt = stmtEnd === -1 ? tail : tail.slice(0, stmtEnd);
        if (!/\.select\(/.test(stmt)) offenders.push(`${rel} → ${m[1]}.${m[2]}()`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("★ the two known instances are fixed, and say what is still true", () => {
    const settings = fs.readFileSync(path.join(process.cwd(), "src/components/views/SettingsView.jsx"), "utf8");
    expect(settings).toMatch(/\.update\(companyPatch\)\.eq\("id", currentCompany\.id\)\.select\("id"\)/);
    expect(settings).toMatch(/nothing was changed/);

    const tax = fs.readFileSync(path.join(process.cwd(), "src/components/views/TaxView.jsx"), "utf8");
    expect(tax).toMatch(/\.select\("company_id"\)/);
    // Not "an error occurred" — what happened to their figures.
    expect(tax).toMatch(/they haven't been kept/);
  });

  it("★★ and the settings failure returns BEFORE the optimistic repaint", () => {
    // Painting first is what turns a failed save into "the screen doesn't refresh": the
    // header shows the new name, the database holds the old one, and the next load reverts.
    const src = strip(fs.readFileSync(path.join(process.cwd(), "src/components/views/SettingsView.jsx"), "utf8"));
    const check = src.indexOf("nothing was changed");
    const paint = src.indexOf("setCurrentCompany && setCurrentCompany(");
    expect(check).toBeGreaterThan(-1);
    expect(paint).toBeGreaterThan(check);
  });

  it("★ a view's tax save cannot fail to the console alone", () => {
    const tax = strip(fs.readFileSync(path.join(process.cwd(), "src/components/views/TaxView.jsx"), "utf8"));
    const save = tax.slice(tax.indexOf("tax_settings"), tax.indexOf("const estPaid"));
    // every catch/failure arm reaches the user
    expect((save.match(/showNotification/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(save).not.toMatch(/console\.warn\("\[tax_settings\] save/);
  });
});
