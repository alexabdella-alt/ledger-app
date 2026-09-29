// ═════════════════════════════════════════════════════════════════════════════
// C548 — `092` re-makes every tenant→tenant reference as a COMPOSITE key. The migration is the
// operator's to apply; what a test CAN hold is that the file is complete and faithful:
//   · every same-shape reference in the live schema is covered — none quietly left out;
//   · each one's DELETE BEHAVIOUR is preserved verbatim (changing what happens on delete while
//     claiming to add a guard would be a second, silent change riding on the first);
//   · every target carries the `(id, company_id)` key the reference needs;
//   · nothing is covered that does not exist live (`089`/`090` were never applied).
// ═════════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const MIG = "supabase/migrations";
const mig = fs.readFileSync(path.join(MIG, "092_composite_tenant_keys.sql"), "utf8");
const base = fs.readFileSync(path.join(MIG, "000_baseline_schema.sql"), "utf8");
const strip = (s) => s.replace(/^\s*--.*$/gm, "");
const body = strip(mig);

// Every table in the live schema that carries company_id (the baseline, minus what was dropped,
// plus what later APPLIED migrations created).
const baseTables = Object.fromEntries([...base.matchAll(/CREATE TABLE public\.([a-z_0-9]+) \(([\s\S]*?)\n\);/g)].map((m) => [m[1], m[2]]));
const DROPPED = new Set(["ap_invoices"]);
const UNAPPLIED = new Set(["inbound_messages", "outbound_messages"]);   // 089/090 — no mail domain yet

describe("C548 — 092 covers every reference, faithfully", () => {
  const declared = [...body.matchAll(/add constraint ([a-z_0-9]+) foreign key \(([a-z_0-9]+), company_id\)\s*\n?\s*references public\.([a-z_0-9]+) \(id, company_id\)([^;]*);/g)]
    .map((m) => ({ name: m[1], col: m[2], target: m[3], onDelete: m[4].trim() }));

  it("declares 34 composite references, every one keyed on (col, company_id)", () => {
    expect(declared).toHaveLength(34);
    for (const d of declared) expect(d.name.endsWith("_company_fkey"), d.name).toBe(true);
  });

  it("★★ EVERY baseline reference of this shape is covered — none silently left out", () => {
    const tenant = new Set(Object.entries(baseTables).filter(([, b]) => /^\s{4}company_id\s/m.test(b)).map(([t]) => t));
    const wanted = [...base.matchAll(/ALTER TABLE ONLY public\.([a-z_0-9]+)\s*\n?\s*ADD CONSTRAINT [a-z_0-9]+ FOREIGN KEY \(([a-z_0-9]+)\) REFERENCES public\.([a-z_0-9]+)\(id\)/g)]
      .filter((m) => tenant.has(m[1]) && tenant.has(m[3]) && m[2] !== "company_id" && !DROPPED.has(m[1]) && !DROPPED.has(m[3]))
      .map((m) => `${m[1]}.${m[2]}`);
    expect(wanted.length).toBeGreaterThan(20);                       // anti-vacuity: the scan found them
    const covered = new Set(declared.map((d) => `${d.name.replace(/_[a-z_0-9]+_company_fkey$/, "")}.${d.col}`));
    const got = new Set(body.match(/alter table public\.([a-z_0-9]+)\n  add constraint/g) || []);
    for (const w of wanted) {
      const [tab, col] = w.split(".");
      expect(body, w).toContain(`add constraint ${tab}_${col}_company_fkey foreign key (${col}, company_id)`);
    }
  });

  it("★★★ EACH ONE'S DELETE BEHAVIOUR IS PRESERVED VERBATIM", () => {
    const original = new Map([...base.matchAll(/ALTER TABLE ONLY public\.([a-z_0-9]+)\s*\n?\s*ADD CONSTRAINT [a-z_0-9]+ FOREIGN KEY \(([a-z_0-9]+)\) REFERENCES public\.[a-z_0-9]+\(id\)([^;]*);/g)]
      .map((m) => [`${m[1]}.${m[2]}`, m[3].trim().toLowerCase()]));
    expect([...original.values()].filter(Boolean).length).toBeGreaterThan(3);   // anti-vacuity: some DO have one
    for (const d of declared) {
      const tab = d.name.replace(new RegExp(`_${d.col}_company_fkey$`), "");
      const was = original.get(`${tab}.${d.col}`);
      if (was === undefined) continue;                                // added by a later migration
      expect(d.onDelete.toLowerCase(), `${tab}.${d.col}`).toBe(was);
    }
  });

  it("every target of a composite reference gets its (id, company_id) key first", () => {
    const targets = new Set(declared.map((d) => d.target));
    expect(targets.size).toBeGreaterThan(5);
    for (const t of targets) {
      const idx = body.indexOf(`create unique index if not exists ${t}_id_company_idx on public.${t} (id, company_id);`);
      expect(idx, `index for ${t}`).toBeGreaterThan(-1);
      expect(idx, `${t}'s index must precede the references pointing at it`).toBeLessThan(body.indexOf(`references public.${t} (id, company_id)`));
    }
  });

  it("does NOT touch tables that were never applied, and drops each old key before re-adding", () => {
    for (const t of UNAPPLIED) expect(body, t).not.toContain(`alter table public.${t}`);
    for (const d of declared) expect(body, d.name).toContain(`drop constraint if exists ${d.name};`);
    expect(body.startsWith("\nbegin;") || body.includes("begin;")).toBe(true);
    expect(body.trim().endsWith("commit;")).toBe(true);              // all or nothing
  });

  it("the probe demonstrates BEFORE, refuses AFTER, and checks the blocks-too-much direction", () => {
    const v = fs.readFileSync("supabase/verify/092_composite_tenant_keys.sql", "utf8");
    expect(v).toContain("FAIL - a contact in this company now defaults to another company''s category");   // '' = SQL's escaped apostrophe
    expect(v).toContain("PASS - refused by the database");
    expect(v).toContain("FAIL - an ordinary reference was refused");   // the 079 direction
    expect(v).toContain("ran as: %");                                  // never an artifact of the editor's superuser
    expect(v).toMatch(/= 34\b/);                                       // and counts what landed
  });
});
