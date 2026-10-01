import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants";
import { planCoaTemplate, BUSINESS_TYPES } from "../src/lib/coaTemplates";
import { answerToAccount } from "../src/lib/clarify";

// ═════════════════════════════════════════════════════════════════════════════
// THE FIVE NICHE MONTHS (tools/niches/*.json) — run OFFLINE through the app's own logic.
//
// A live drive tests what only a live drive can: reading the image. Everything the app
// decides AFTER it has read a document can be checked here, now, for all five niches:
//   (1) COVERAGE — does a brand-new company of this type have somewhere CORRECT to put each
//       document? "The categoriser picked second because there was no first" (Tier 1 #6).
//   (2) ANSWERS — where does the owner's natural answer on a question card file it? The answer
//       path books immediately with no confirm step, so a wrong mapping is a wrong booking.
//
// ★★ THE FINDINGS ARE PINNED EXACTLY. A fix must SHRINK these lists in the same commit; a new
// entry means something got worse. "Asks the AI" is NOT a finding — it goes to the model with
// the company's own categories, which is the right door for an answer the keyword map can't place.
// ═════════════════════════════════════════════════════════════════════════════

const DIR = path.join(process.cwd(), "tools/niches");
const NICHES = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));
const slots = (doc) => doc.expect.map((s) => (Array.isArray(s) ? s : [s]));
const num = (i) => String(i + 1).padStart(2, "0");

function chartFor(businessType) {
  const plan = planCoaTemplate(businessType, DEFAULT_CHART_OF_ACCOUNTS);
  return [...DEFAULT_CHART_OF_ACCOUNTS.filter((a) => !plan.hide.includes(String(a.code))), ...plan.add];
}
function findings(spec) {
  const chart = chartFor(spec.company.business_type);
  const roles = new Set(chart.map((a) => a.system_role));
  const byRole = (r) => chart.find((a) => a.system_role === r) || null;
  const gaps = [], wrong = [];
  spec.documents.forEach((d, i) => {
    for (const alts of slots(d)) if (!alts.some((r) => roles.has(r))) gaps.push(`${num(i)} ${alts.join("/")}`);
    if (d.answer) {
      const m = answerToAccount(d.answer, { getAccountByRole: byRole });
      const got = m ? (m.role || chart.find((a) => String(a.code) === String(m.gl_code))?.system_role) : null;
      if (got && !slots(d)[0].includes(got)) wrong.push(`${num(i)} "${d.answer}" → ${got}`);
    }
  });
  return { gaps, wrong };
}

// ── THE PINNED FINDINGS (2026-10-01) ─────────────────────────────────────────
const KNOWN = {
  coach: {
    gaps: ["05 product_revenue", "06 product_revenue", "16 education_training"],
    wrong: [],
  },
  consultant: {
    gaps: ["15 taxes_licenses"],
    wrong: [],   // C555 — was: "city business license" → technology_software
  },
  landlord: {
    gaps: ["11 security_deposits_held"],
    wrong: [],   // C555 — was: listing → rent_occupancy; paint/fix up → office_supplies
  },
  therapist: {
    gaps: ["12 education_training", "15 dues_subscriptions"],
    wrong: [],   // C555 — was: malpractice → insurance; license renewal → technology_software
  },
  trades: {
    gaps: ["04 car_truck_expenses", "05 car_truck_expenses", "06 car_truck_expenses"],
    wrong: [],   // C555 — was: electrician → utilities; contractor license → technology_software
  },
};

describe("the five niche months are well-formed", () => {
  it("five niches, each a real onboarding business type", () => {
    expect(NICHES.map((n) => n.niche)).toEqual(["coach", "consultant", "landlord", "therapist", "trades"]);
    for (const n of NICHES) expect(BUSINESS_TYPES, n.niche).toContain(n.company.business_type);
  });
  it("every document has a layout, a dated August line, numeric items and an expectation", () => {
    const LAYOUTS = ["invoice", "our_invoice", "statement", "receipt", "card_statement"];
    for (const n of NICHES) n.documents.forEach((d, i) => {
      const at = `${n.niche} ${num(i)}`;
      expect(LAYOUTS, at).toContain(d.layout);
      expect(d.date, at).toMatch(/^08\/\d{2}\/2026$/);
      expect(d.items.length, at).toBeGreaterThan(0);
      for (const [desc, q, r] of d.items) { expect(typeof desc, at).toBe("string"); expect(Number.isFinite(q * r), at).toBe(true); }
      expect(slots(d).length, at).toBeGreaterThan(0);
      expect(d.treatment, at).toBeTruthy();
    });
  });
  it("★ every expected role is a real role somewhere — or a named gap — never a typo", () => {
    // A misspelt role would read as a GAP and be pinned as a finding. The only roles allowed
    // to exist nowhere are the ones the findings name.
    const known = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.system_role));
    for (const t of BUSINESS_TYPES) for (const a of planCoaTemplate(t, DEFAULT_CHART_OF_ACCOUNTS).add) known.add(a.system_role);
    const named = new Set(Object.values(KNOWN).flatMap((k) => k.gaps.map((g) => g.split(" ")[1].split("/")).flat()));
    for (const n of NICHES) for (const d of n.documents) for (const alts of slots(d)) for (const r of alts) {
      if (!known.has(r)) expect(named.has(r) || alts.some((x) => known.has(x)), `${n.niche}: unknown role "${r}"`).toBe(true);
    }
  });
  it("the generator is reproducible — no salted hash (the C552 defect)", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "tools/makeNicheMonths.py"), "utf8");
    // The module docstring EXPLAINS why there is no hash() — strip it, or the guard matches its own explanation.
    const code = src.replace(/"""[\s\S]*?"""/, "").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
    expect(code).not.toMatch(/(?<![.\w])hash\(/);
    expect(code).toMatch(/random\.Random\(stable\(niche, i\)\)/);
  });
});

describe("★★ what each niche's month finds in the app today — pinned exactly", () => {
  for (const n of NICHES) {
    it(`${n.label} (${n.company.business_type})`, () => {
      const f = findings(n);
      expect({ gaps: f.gaps, wrong: f.wrong }).toEqual(KNOWN[n.niche]);
    });
  }
});
