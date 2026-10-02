import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ruleForVendor } from "../src/lib/vendorRules";
import { buildAliasIndex } from "../src/lib/vendorAlias";
import { buildTeachInTable, planTeachIn, cadenceOf, DECISION } from "../src/lib/vendorTeachIn";
import { renderViewHtml } from "./helpers/renderView.jsx";
import VendorTeachIn from "../src/components/VendorTeachIn.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C563 — VENDOR TEACH-IN. Read two or three old statements, list every vendor with the
// category we'd use, the owner (or their accountant) confirms once, each confirmed vendor
// becomes a rule. LEARN ONLY — nothing on those statements is recorded.
// ═════════════════════════════════════════════════════════════════════════════

const BOOKABLE = [
  { code: "1000", name: "Cash", category: "Assets" },
  { code: "3300", name: "Owner's Draw / Distributions", category: "Equity" },
  { code: "5010", name: "Food Cost", category: "Expenses" },
  { code: "6260", name: "Linen & Laundry", category: "Expenses" },
  { code: "6600", name: "Office Supplies", category: "Expenses" },
  { code: "6100", name: "Rent & Occupancy", category: "Expenses" },
];
const OWNERS_DRAW = BOOKABLE[1];
const out = (date, vendor, amount, gl_code, gl_name) => ({ date, vendor, amount, type: "expense", gl_code, gl_name });

const LINES = [
  out("2026-05-04", "Sysco", 1004.10, "5010", "Food Cost"),
  out("2026-05-11", "SYSCO #4417 TX", 987.55, "5010", "Food Cost"),
  out("2026-05-18", "Sysco Inc.", 1022.00, "5010", "Food Cost"),
  out("2026-05-25", "Sysco", 995.40, "5010", "Food Cost"),
  out("2026-05-03", "SQ *BLUEBONNET LINEN", 145, "6260", "Linen & Laundry"),
  out("2026-05-10", "Bluebonnet Linen", 145, "6260", "Linen & Laundry"),
  out("2026-05-17", "Bluebonnet Linen", 145, "6260", "Linen & Laundry"),
  out("2026-05-01", "Franklin Ave Properties", 4200, "6100", "Rent & Occupancy"),
  out("2026-06-01", "Franklin Ave Properties", 4200, "6100", "Rent & Occupancy"),
  out("2026-05-08", "Corner Market #221", 62.10, "5010", "Food Cost"),
  out("2026-05-15", "Corner Market #221", 58.40, "6600", "Office Supplies"),
  out("2026-05-22", "Corner Market #221", 66.90, "5010", "Food Cost"),
  out("2026-05-29", "Corner Market #221", 61.20, "6600", "Office Supplies"),
  { date: "2026-05-05", vendor: "Toast Payout", amount: 8120.55, type: "revenue", gl_code: "4000", gl_name: "Sales" },   // money IN
  out("2026-05-19", "Mystery Vendor", 50, "9999", "An account this company doesn't have"),
];
const table = (opts = {}) => buildTeachInTable(LINES, { bookable: BOOKABLE, ...opts });
const row = (t, name) => t.rows.find((r) => r.name === name);

describe("C563 — one rule matcher for the whole app", () => {
  const rules = [{ vendor: "Sysco", gl_code: "5010" }, { vendor: "Bluebonnet Linen Service", gl_code: "6260" }];
  it("exact name, any case", () => {
    expect(ruleForVendor(rules, "SYSCO").gl_code).toBe("5010");
  });
  it("★★ the same vendor under the processor's prefix, a store number or a legal suffix", () => {
    expect(ruleForVendor(rules, "SYSCO #4417 TX")?.vendor).toBe("Sysco");
    expect(ruleForVendor(rules, "Sysco Inc.")?.vendor).toBe("Sysco");
  });
  it("★★★ never fuzzy: a longer name is a different vendor unless a person links them", () => {
    expect(ruleForVendor(rules, "Sysco Central Texas")).toBeNull();
    expect(ruleForVendor(rules, "Bluebonnet Linen")).toBeNull();
    const aliasIndex = buildAliasIndex([{ id: "c1", name: "Bluebonnet Linen Service", aliases: ["Bluebonnet Linen"] }]);
    expect(ruleForVendor(rules, "SQ *BLUEBONNET LINEN", { aliasIndex })?.vendor).toBe("Bluebonnet Linen Service");
  });
  it("★★ every place the app looks up a rule uses it", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    expect(app).not.toMatch(/rules\.find\(r => r\.vendor/);
    expect((app.match(/ruleForVendor\(rules, (extracted|t)\.vendor, \{ aliasIndex \}\)/g) || []).length).toBe(4);
    const clarify = fs.readFileSync(path.join(process.cwd(), "src/lib/clarify.js"), "utf8");
    expect(clarify).toMatch(/const rule = ruleForVendor\(rules, vendor\);/);
  });
});

describe("C563 — the vendor table", () => {
  const t = table();
  it("★★★ one row per vendor, the processor's prefix and store numbers folded in", () => {
    expect(row(t, "Sysco").count).toBe(4);
    expect(row(t, "Sysco").otherNames).toEqual(expect.arrayContaining(["SYSCO #4417 TX", "Sysco Inc."]));
    expect(row(t, "Bluebonnet Linen").count).toBe(3);
  });
  it("★★ money coming IN is not a vendor", () => {
    expect(t.rows.map((r) => r.name)).not.toContain("Toast Payout");
  });
  it("how often, and what they usually charge", () => {
    expect(row(t, "Sysco").cadence).toBe("weekly");
    expect(row(t, "Franklin Ave Properties").cadence).toBe("monthly");
    expect(row(t, "Sysco").typical).toBe(999.75);              // median of four
    expect(row(t, "Bluebonnet Linen").typical).toBe(145);
  });
  it("★★ the suggestion is the category most of its payments got", () => {
    expect(row(t, "Sysco").suggested.gl_code).toBe("5010");
    expect(row(t, "Sysco").decision).toEqual({ kind: DECISION.CATEGORY, gl_code: "5010" });
  });
  it("★★★ a vendor whose purchases vary is set to ASK, not forced into one category", () => {
    const c = row(t, "Corner Market #221");
    expect(c.mixed).toBe(true);
    expect(c.decision).toEqual({ kind: DECISION.ASK });
  });
  it("★ a suggested category the company doesn't have is never offered as the default", () => {
    expect(row(t, "Mystery Vendor").suggested).toBeNull();
    expect(row(t, "Mystery Vendor").decision).toEqual({ kind: DECISION.ASK });
  });
  it("biggest spend first — the rows worth checking most are at the top", () => {
    expect(t.rows[0].name).toBe("Franklin Ave Properties");
  });
  it("★★ a vendor that already has a rule is left alone, and counted", () => {
    const t2 = table({ rules: [{ vendor: "Sysco Inc.", gl_code: "5010" }] });
    expect(t2.rows.map((r) => r.name)).not.toContain("Sysco");
    expect(t2.alreadyRuled).toBe(1);
  });
  it("cadence edge cases", () => {
    expect(cadenceOf(["2026-05-01"])).toBe("once");
    expect(cadenceOf(["2026-05-01", "2026-05-15", "2026-05-29"])).toBe("every two weeks");
    expect(cadenceOf(["2026-01-01", "2026-04-01"])).toBe("now and then");
  });
});

describe("C563 — decisions become rules", () => {
  const t = table();
  it("★★★ the defaults: confirmed vendors become rules, mixed ones are asked, nothing else", () => {
    const p = planTeachIn(t.rows, {}, { bookable: BOOKABLE, ownersDraw: OWNERS_DRAW });
    expect(p.rules.map((r) => r.vendor).sort()).toEqual(["Bluebonnet Linen", "Franklin Ave Properties", "Sysco"]);
    expect(p.asked.sort()).toEqual(["Corner Market #221", "Mystery Vendor"]);
  });
  it("the owner can override a suggestion, or choose ask-each-time", () => {
    const p = planTeachIn(t.rows, {
      [row(t, "Sysco").key]: { kind: DECISION.ASK },
      [row(t, "Corner Market #221").key]: { kind: DECISION.CATEGORY, gl_code: "6600" },
    }, { bookable: BOOKABLE, ownersDraw: OWNERS_DRAW });
    expect(p.rules.find((r) => r.vendor === "Corner Market #221").gl_code).toBe("6600");
    expect(p.rules.map((r) => r.vendor)).not.toContain("Sysco");
  });
  it("★★ 'personal' files to the owner's draw — and is skipped, not guessed, without one", () => {
    const decide = { [row(t, "Mystery Vendor").key]: { kind: DECISION.PERSONAL } };
    expect(planTeachIn(t.rows, decide, { bookable: BOOKABLE, ownersDraw: OWNERS_DRAW }).rules.find((r) => r.vendor === "Mystery Vendor"))
      .toMatchObject({ gl_code: "3300", personal: true });
    expect(planTeachIn(t.rows, decide, { bookable: BOOKABLE, ownersDraw: null }).skipped.map((s) => s.vendor)).toContain("Mystery Vendor");
  });
  it("★ a category that isn't on the company's chart is skipped with a reason", () => {
    const p = planTeachIn(t.rows, { [row(t, "Sysco").key]: { kind: DECISION.CATEGORY, gl_code: "9999" } }, { bookable: BOOKABLE });
    expect(p.skipped).toContainEqual({ vendor: "Sysco", why: "that category isn't available" });
  });
});

describe("C563 — learn only, and who may use it", () => {
  const ui = fs.readFileSync(path.join(process.cwd(), "src/components/VendorTeachIn.jsx"), "utf8");
  it("★★★ the screen records nothing from the statements — it reads them and writes rules, nothing else", () => {
    for (const writer of ["bookToDb", "persistJournalEntry", "persistMultiLineEntry", "storeDocument", "handleBankFile", "post_journal_entry"]) {
      expect(ui, writer).not.toMatch(new RegExp(`\\b${writer}\\b`));
    }
    expect(ui).toMatch(/await readBankStatement\(files\[i\]\)/);
    expect(ui).toMatch(/await saveVendorRule\(\{ vendor: r\.vendor, gl_code: r\.gl_code, gl_name: r\.gl_name \}\)/);
  });
  it("★★ one audit row names who confirmed it — owner or accountant", () => {
    expect(ui).toMatch(/logAudit\?\.\("vendor_teach_in"/);
    expect(ui).toMatch(/confirmed_by_role: userRole/);
  });
  it("★ a viewer, who cannot write rules, is not offered it", () => {
    const rules = fs.readFileSync(path.join(process.cwd(), "src/components/views/RulesView.jsx"), "utf8");
    const dash = fs.readFileSync(path.join(process.cwd(), "src/components/views/DashboardView.jsx"), "utf8");
    expect(rules).toMatch(/\{!teachViewer && \(/);
    expect(dash).toMatch(/\{!isViewer && \(\s*\n\s*<div onClick=\{\(\)=>setTeachOpen\(true\)\}/);
  });
  it("the app hands the screen the shared statement reader and the rule writer", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    expect(app).toMatch(/readBankStatement, saveVendorRule: persistChatRule,/);
  });
  it("it renders, and says up front that nothing is recorded", () => {
    const html = renderViewHtml(VendorTeachIn, { BOOKABLE_ACCOUNTS: BOOKABLE }).replace(/<!-- -->/g, "");
    expect(html).toMatch(/Teach us your vendors/);
    expect(html).toMatch(/Nothing on these statements is recorded/);
  });
});
