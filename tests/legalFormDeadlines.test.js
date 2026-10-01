import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { getTaxDeadlines, nextUrgentDeadline, LEGAL_FORMS } from "../src/lib/tax";
import { mapCompanyRow, buildCompanyUpdate } from "../src/lib/writeShapes";

// ═════════════════════════════════════════════════════════════════════════════
// O140 / C559 — THE TAX CALENDAR KNOWS HOW THE BUSINESS FILES.
// It showed every company every deadline: the S-Corp/Partnership return to a sole owner, the
// personal return to a corporation. Plus two date defects found on the way: June 16 was
// hard-coded for the Q2 estimate (right only when the 15th fell on a weekend), and nothing
// moved a weekend deadline — "January 31, 2027" is a Sunday; the IRS rule makes it February 1.
// ═════════════════════════════════════════════════════════════════════════════

const NOW = new Date(2026, 9, 1);   // 1 Oct 2026 — a full year of deadlines ahead
const keysOf = (form) => getTaxDeadlines(NOW, { legalForm: form }).map((d) => d.key).sort();
const byKey = (form, key) => getTaxDeadlines(NOW, { legalForm: form }).find((d) => d.key === key);
const ALL_BEFORE = ["0-15", "0-31", "1-28", "2-15", "2-31", "3-15", "5-15", "8-15", "9-15"];

describe("★★★ unanswered means the full calendar — never a shorter wrong one", () => {
  it("not answered → every deadline shown before, in the old words", () => {
    expect(keysOf(null)).toEqual(ALL_BEFORE);
    expect(byKey(null, "2-15").plain).toBe("File your S-Corp (1120-S) or Partnership (1065) tax return");
  });
  it("an unrecognised value is treated as unanswered, not as a form", () => {
    expect(keysOf("llc")).toEqual(ALL_BEFORE);
  });
});

describe("★★ each form sees its own deadlines", () => {
  it("sole proprietor: no partnership or S-corp return; personal estimates; Q3 without the business-return clause", () => {
    const k = keysOf("sole_prop");
    expect(k).not.toContain("2-15");
    expect(k).toContain("0-15");
    expect(byKey("sole_prop", "8-15").plain).toBe("Pay your 3rd-quarter estimated taxes");
    expect(byKey("sole_prop", "3-15").form).toBe("Form 1040 / 1040-ES");
  });
  it("partnership: its own return on March 15, named as the partnership's", () => {
    expect(byKey("partnership", "2-15")).toMatchObject({ plain: "File your partnership's tax return", form: "Form 1065" });
  });
  it("S corporation: its own return on March 15", () => {
    expect(byKey("s_corp", "2-15")).toMatchObject({ plain: "File your S corporation's tax return", form: "Form 1120-S" });
  });
  it("★★ C corporation: no personal estimates, the corporate return in April, a December estimate", () => {
    const k = keysOf("c_corp");
    expect(k).not.toContain("0-15");      // the January 1040-ES estimate is a person's, not a corporation's
    expect(k).not.toContain("2-15");
    expect(k).toContain("11-15");
    expect(byKey("c_corp", "3-15")).toMatchObject({ form: "Form 1120 / 1120-W" });
    expect(byKey("c_corp", "9-15").label).toBe("Extended corporate return");
  });
  it("★ 1099 deadlines apply to every form — anyone can pay a contractor", () => {
    for (const f of [null, ...LEGAL_FORMS.map((x) => x.value)]) {
      expect(getTaxDeadlines(NOW, { legalForm: f }).filter((d) => d.kind === "1099").length, String(f)).toBe(3);
    }
  });
  it("Home's next-deadline reading uses the same filter", () => {
    // 20 Feb 2027: the S corporation's NEXT deadline is the paper 1099s (Feb 28 is a Sunday → Mar 1),
    // and its own March 15 return is inside the 30-day window behind it…
    const s = nextUrgentDeadline(new Date(2027, 1, 20), 30, { legalForm: "s_corp" });
    expect(s.key).toBe("1-28");
    const sWindow = getTaxDeadlines(new Date(2027, 1, 20), { legalForm: "s_corp" }).filter((d) => d.days <= 30).map((d) => d.key);
    expect(sWindow).toContain("2-15");
    const sole = getTaxDeadlines(new Date(2027, 2, 2), { legalForm: "sole_prop" }).filter((d) => d.days <= 30).map((d) => d.key);
    expect(sole).not.toContain("2-15");    // …and a sole owner's never is
  });
});

describe("★★ the dates themselves", () => {
  it("★★★ a weekend deadline moves to Monday — the 1099 deadline in 2027", () => {
    const d = getTaxDeadlines(new Date(2027, 0, 5)).find((x) => x.key === "0-31");
    expect(d.date.getFullYear()).toBe(2027);
    expect(d.date.getMonth()).toBe(1);   // February
    expect(d.date.getDate()).toBe(1);
    expect(d.key).toBe("0-31");          // the key a 'filed' mark is stored under does not move
  });
  it("★★ the Q2 estimate is June 15, not 16 — and still moves when the 15th is a weekend", () => {
    const y2027 = getTaxDeadlines(new Date(2027, 4, 1)).find((x) => x.key === "5-15");
    expect(y2027.date.getDate()).toBe(15);              // Tuesday 15 June 2027
    const y2025 = getTaxDeadlines(new Date(2025, 4, 1)).find((x) => x.key === "5-15");
    expect(y2025.date.getDate()).toBe(16);              // Sunday 15 June 2025 → Monday 16
  });
  it("a weekday deadline does not move", () => {
    const d = getTaxDeadlines(new Date(2027, 2, 1)).find((x) => x.key === "3-15");
    expect(d.date.getDate()).toBe(15);                   // Thursday 15 April 2027
  });
});

describe("★ the stored value", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/093_companies_legal_form.sql"), "utf8");
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  it("the migration's allowed values ARE the app's four — read from the file, not restated", () => {
    const m = sql.match(/legal_form in \(([^)]+)\)/);
    const allowed = m[1].split(",").map((x) => x.trim().replace(/'/g, ""));
    expect(allowed).toEqual(LEGAL_FORMS.map((f) => f.value));
  });
  it("it is read back with the company", () => {
    expect(mapCompanyRow({ legal_form: "s_corp" }).legalForm).toBe("s_corp");
    expect(mapCompanyRow({}).legalForm).toBe("");
  });
  it("★★★ it is written ON ITS OWN — a database without the column must not lose the business type", () => {
    expect(app).toMatch(/updateCompanyRow\(cid, \{ legal_form: value \}, "legal-form"\)/);
    expect(app).toMatch(/updateCompanyRow\(cid, \{ business_type: businessType, fiscal_year_end: fiscalYearEnd \}, "onboarding-profile"\)/);
    expect(buildCompanyUpdate({ legalForm: "s_corp" })).not.toHaveProperty("legal_form");   // nor through Settings' save
  });
  it("the AI's tax tool and the Taxes screen use it", () => {
    const tools = fs.readFileSync(path.join(process.cwd(), "src/lib/aiTools.js"), "utf8");
    const taxView = fs.readFileSync(path.join(process.cwd(), "src/components/views/TaxView.jsx"), "utf8");
    expect(tools).toMatch(/getTaxDeadlines\(new Date\(\), \{ legalForm: ctx\.legalForm \}\)/);
    expect(taxView).toMatch(/getTaxDeadlines\(new Date\(\), \{ legalForm: legalForm \|\| null \}\)/);
  });
});
