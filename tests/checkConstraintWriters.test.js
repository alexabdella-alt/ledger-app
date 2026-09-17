// C525/C535/C536 — writers held to the schema: every column exists, and every CHECK-constrained value lands in its set. Started as: every column the app WRITES to recurring_transactions exists in the table, and the run
// record uses the table's own name. `recordRecurringRun` (C360) wrote `last_run`; the column is
// `last_run_date`, so PostgREST refused the update on every "Post now" since it shipped. The C360
// test pinned the writer's literal against itself (·3a) and never asked the schema.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { buildRecurringRow, recurringRunPatch } from "../src/lib/chatActions.js";

const ddl = fs.readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8");
const columnsOf = (table) => {
  const at = ddl.indexOf(`CREATE TABLE public.${table} (`);
  expect(at).toBeGreaterThan(-1);
  const body = ddl.slice(at, ddl.indexOf("\n);", at));
  const cols = [...body.matchAll(/^\s{4}([a-z_]+)\s/gm)].map(m => m[1]).filter(c => !["CONSTRAINT", "PRIMARY", "UNIQUE", "CHECK"].includes(c));
  expect(cols.length).toBeGreaterThan(5);   // the parse must have found the table
  return new Set(cols);
};
const cols = columnsOf("recurring_transactions");

describe("C525 — recurring_transactions writers match the table", () => {
  it("THE REPRO — `last_run` is not a column; `last_run_date` is", () => {
    expect(cols.has("last_run")).toBe(false);
    expect(cols.has("last_run_date")).toBe(true);
  });
  it("the run patch writes the table's column, and carries the next date", () => {
    const p = recurringRunPatch({ last_run: "2026-09-15", next_date: "2026-10-15" });
    expect(p).toEqual({ last_run_date: "2026-09-15", next_date: "2026-10-15" });
    for (const k of Object.keys(p)) expect(cols.has(k), `column ${k}`).toBe(true);
  });
  it("every key the insert writes is a column — including project, which the load now reads back", () => {
    const row = buildRecurringRow({ companyId: "c", name: "Rent", amount: 2400, debitAccountId: "a", creditAccountId: "b", frequency: "monthly", nextDate: "2026-10-01", project: "Main" });
    for (const k of Object.keys(row)) expect(cols.has(k), `column ${k}`).toBe(true);
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/last_run: r\.last_run_date,\s*\n\s*project: r\.project \|\| "General"/);
  });
});

// C535 — contacts.type is CHECK-constrained; the chat's add_contact maps the model's word onto it.
import { CONTACT_TYPES, normalizeContactType } from "../src/lib/chatActions.js";
describe("C535 — contact type lands in the CHECK set", () => {
  const set = fs.readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8").match(/contacts_type_check CHECK \(\(type = ANY \(ARRAY\[(.*?)\]\)\)\)/)[1].match(/'([a-z]+)'/g).map(s => s.replace(/'/g, "")).sort();
  it("the app's list is the column's, and every mapped word lands in it", () => {
    expect(CONTACT_TYPES.slice().sort()).toEqual(set);
    for (const w of ["vendor", "customer", "both", "supplier", "client", "Supplier ", "", null, "nonsense"]) expect(set.includes(normalizeContactType(w)), String(w)).toBe(true);
    expect(normalizeContactType("supplier")).toBe("vendor");
    expect(normalizeContactType("client")).toBe("customer");
  });
  it("persistChatContact writes through it on both branches", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(app).toContain("type: normalizeContactType(contact_type)");
    expect(app).toContain('k === "type" ? normalizeContactType(v) : v');
  });
});

// C536 — accounts.category is CHECK-constrained to five capitalised plurals; the AI's add_account
// wrote its own word. §4's numbering decides the category from the code; a stated word is only
// normalised, never written raw.
import { ACCOUNT_CATEGORIES, categoryForCode } from "../src/lib/gl.js";
import { buildAccountInsert } from "../src/lib/writeShapes.js";
describe("C536 — account category lands in the CHECK set", () => {
  const set = fs.readFileSync("supabase/migrations/000_baseline_schema.sql", "utf8").match(/accounts_category_check CHECK \(\(category = ANY \(ARRAY\[(.*?)\]\)\)\)/)[1].match(/'([A-Za-z]+)'/g).map(s => s.replace(/'/g, "")).sort();
  it("the app's list is the column's; the code decides; a stated word is normalised", () => {
    expect(ACCOUNT_CATEGORIES.slice().sort()).toEqual(set);
    expect(categoryForCode("6250", "Expense")).toBe("Expenses");
    expect(categoryForCode("6250", "asset")).toBe("Expenses");      // the code wins over a wrong word
    expect(categoryForCode("1500", "Asset")).toBe("Assets");
    expect(categoryForCode("2100", "liability")).toBe("Liabilities");
    expect(categoryForCode("", "revenue")).toBe("Revenue");         // no code: the word, normalised
    expect(categoryForCode("", "nonsense")).toBe("Expenses");
    for (const [code, word] of [["6250", "Expense"], ["1500", "asset"], ["", "Liability"], ["9999", "x"]]) expect(set.includes(buildAccountInsert({ companyId: "c", code, name: "n", category: word }).category)).toBe(true);
  });
  it("addCustomAccount — the AI's add_account door — writes through it", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8").replace(/\/\/.*$/gm, "");
    expect(app).toContain("code, name, category: categoryForCode(code, category),");
    expect(app).not.toMatch(/category: category \|\| "Expenses"/);
  });
});
