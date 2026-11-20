// ★ C766 — THE RECURRING LIST FAILED TO LOAD FOR EVERY COMPANY SINCE MIGRATION 092 (2026-09-28). It
// embedded accounts by COLUMN (`debit_account_id(code,name)`); 092 made each key a (column, company_id)
// pair, and PostgREST answered PGRST200 ("could not find a relationship"). Found on the live app by the
// operator ("We couldn't load your recurring charges"), confirmed against the live API with the public
// key. Now the embed names the CONSTRAINT 092 created — and this test pins those names to the migration,
// so renaming a key in a migration breaks a test, not the screen.
// Also: on a phone, no page may scroll sideways, and form fields stay inside their cards.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const app = readFileSync("src/App.jsx", "utf8");
import fs from "node:fs";
const file092 = fs.readdirSync("supabase/migrations").find((f) => f.startsWith("092_"));
const m092 = readFileSync(`supabase/migrations/${file092}`, "utf8");

describe("C766 — the recurring read", () => {
  it("★★★ embeds accounts by the constraint names migration 092 created", () => {
    for (const k of ["recurring_transactions_debit_account_id_company_fkey", "recurring_transactions_credit_account_id_company_fkey"]) {
      expect(m092).toContain(`add constraint ${k} foreign key`);
      expect(app).toContain(`accounts!${k}(code,name)`);
    }
  });
  it("★★ no read anywhere embeds by a bare `_id(` column hint (the shape 092 broke)", () => {
    const src = [app, ...fs.readdirSync("src/lib").map((f) => readFileSync(`src/lib/${f}`, "utf8"))].join("\n");
    expect(src.match(/[a-z_]+:[a-z_]+_id\([a-z_, ]+\)/g) || []).toEqual([]);
  });
});

describe("C766 — the phone layout", () => {
  const css = readFileSync("src/styles.css", "utf8");
  it("★★ nothing scrolls the page sideways; fields stay inside their cards; the start-date row wraps", () => {
    expect(css).toMatch(/#main-content \{ overflow-x: hidden !important; \}/);
    expect(css).toMatch(/\.sc-page input, \.sc-page select, \.sc-page textarea \{ box-sizing: border-box; min-width: 0; \}/);
    expect(css).toMatch(/\.sc-cutoff-row \{ flex-wrap: wrap !important;/);
    expect(readFileSync("src/components/views/OpeningBalancesView.jsx", "utf8")).toContain('className="sc-cutoff-row"');
  });
});
