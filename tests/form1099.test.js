import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  plan1099, plan1099Copy, verdictFor, reportablePayments, entityStatus,
  paymentKindForRole, PAYMENT_KIND, ENTITY, VERDICT, IRS_1099_THRESHOLD,
} from "../src/lib/form1099";
import { vendorGroupKey } from "../src/lib/vendorIdentity";

// ═════════════════════════════════════════════════════════════════════════════
// FULL 1099 ELIGIBILITY — derived, not ticked.
//
// ★★★ THE STAKE IS NOT TIDINESS. A 1099 is filed with the IRS under the accountant's name.
// The live finding that opened this: on one company nearly every supplier carried the flag —
// food, equipment, a utility — none of them 1099-NEC reportable, because the badge was
// effectively defaulted on. Wrong flags become wrong filings.
// ═════════════════════════════════════════════════════════════════════════════

const role = (c) => ({
  5000: "cogs", 6100: "rent_occupancy", 6250: "repairs_maintenance",
  6800: "professional_services", 6200: "utilities", 6600: "office_supplies",
}[c]);
const paid = (amount, gl_code) => ({ amount, gl_code, debit_credit: "debit" });
const v = (contact, rows) => verdictFor(contact, reportablePayments(rows, role));

describe("★★★ an unknown entity type is NOT 'not a corporation'", () => {
  it("★★★ a supplier we can't classify becomes a QUESTION, not a filing", () => {
    // Treating unknown as not-exempt files 1099s for corporations; treating it as exempt
    // misses real ones. Neither is defensible, so it is neither.
    const r = v({ name: "Ace Plumbing", type: "vendor" }, [paid(5000, 6250)]);
    expect(r.verdict).toBe(VERDICT.NEEDS_INFO);
    expect(r.why).toMatch(/we don't know whether they're incorporated/);
  });

  it("a corporation is exempt from ordinary services", () => {
    expect(v({ name: "Ace Plumbing Inc" }, [paid(5000, 6250)]).verdict).toBe(VERDICT.CORP_EXEMPT);
  });

  it("★★ but a LAW firm is reportable even as a corporation — the rule most often missed", () => {
    const r = v({ name: "Smith Law Corp" }, [paid(5000, 6800)]);
    expect(r.verdict).toBe(VERDICT.ELIGIBLE);
    expect(r.why).toMatch(/reported even to a corporation/);
  });

  it("★ a stated business_type beats the name", () => {
    expect(entityStatus({ name: "Ace Inc", business_type: "sole proprietor" })).toBe(ENTITY.REPORTABLE);
    expect(entityStatus({ name: "Ace Plumbing", business_type: "S-Corporation" })).toBe(ENTITY.EXEMPT);
    expect(entityStatus({ name: "Ace Plumbing" })).toBe(ENTITY.UNKNOWN);
  });
});

describe("★★ goods are never reportable, at any amount", () => {
  it("★★★ the live failure: food, equipment and supplies must not be flagged", () => {
    // This is what was actually on screen — Roma (food), Lone Star (equipment), a utility.
    for (const [name, code] of [["Roma Cheese", 5000], ["Kitchen Supply Co", 6600]]) {
      const r = v({ name }, [paid(9000, code)]);
      expect([name, r.verdict]).toEqual([name, VERDICT.GOODS_ONLY]);
    }
  });

  it("★ and it says GOODS rather than 'under the floor' — the two mean different things", () => {
    // One changes next year when they're paid more; the other never does.
    const r = v({ name: "Roma Cheese" }, [paid(9000, 5000)]);
    expect(r.why).toMatch(/aren't reported on a 1099 at any amount/);
  });

  it("a utility is not classified as a service — we decline rather than guess", () => {
    // `utilities` is deliberately absent from the role map. Guessing it is how the badge
    // ended up on a utility company in the first place.
    expect(paymentKindForRole("utilities")).toBe(PAYMENT_KIND.UNKNOWN);
  });
});

describe("★★ an unclassifiable payment cannot be ruled in OR out", () => {
  it("★★★ 'below the floor' is never claimed while holding payments we couldn't classify", () => {
    // That would be a claim about a query rather than about the books.
    const r = v({ name: "Mystery Co" }, [paid(4000, 6200)]);   // utilities → unknown kind
    expect(r.verdict).toBe(VERDICT.NEEDS_INFO);
    expect(r.why).toMatch(/can't classify as goods or services/);
  });
});

describe("★ the amount comes from the ledger, not a flag", () => {
  it("★★ a correcting credit REDUCES what they were paid", () => {
    const rows = [paid(5000, 6250), { amount: 4600, gl_code: 6250, debit_credit: "credit" }];
    const r = v({ name: "Ace Plumbing", business_type: "LLC" }, rows);
    expect(r.verdict).toBe(VERDICT.BELOW_THRESHOLD);   // 400 net, under 600
  });

  it("voided and deleted rows are not payments", () => {
    const rows = [{ ...paid(5000, 6250), status: "voided" }, { ...paid(5000, 6250), deleted_at: "2026-01-01" }];
    expect(reportablePayments(rows, role).total).toBe(0);
  });

  it("the floor is the IRS one, not an invented number", () => {
    expect(IRS_1099_THRESHOLD).toBe(600);
    const r = v({ name: "Ace", business_type: "LLC" }, [paid(599.99, 6250)]);
    expect(r.verdict).toBe(VERDICT.BELOW_THRESHOLD);
    expect(v({ name: "Ace", business_type: "LLC" }, [paid(600, 6250)]).verdict).toBe(VERDICT.ELIGIBLE);
  });
});

describe("★★ the proposal counts what a person must act on", () => {
  const contacts = [
    { id: 1, type: "vendor", name: "Ace Plumbing", business_type: "LLC" },
    { id: 2, type: "vendor", name: "Roma Cheese" },
    { id: 3, type: "vendor", name: "Unknown Services Co" },
    { id: 4, type: "customer", name: "A Customer" },
  ];
  const rowsFor = (c) => ({ 1: [paid(5000, 6250)], 2: [paid(9000, 5000)], 3: [paid(5000, 6250)] }[c.id] || []);
  const plan = plan1099({ contacts, vendorRowsFor: rowsFor, roleOfCode: role });

  it("customers are not considered at all", () => {
    expect(plan.rows.map((r) => r.name)).not.toContain("A Customer");
  });

  it("★★★ the headline counts the UNSURE ones too", () => {
    // A proposal that reports only what it is sure of understates the work — and the unsure
    // ones are precisely the ones a person has to act on.
    expect(plan.eligible).toHaveLength(1);
    expect(plan.needsInfo).toHaveLength(1);
    expect(plan.outstanding).toBe(2);
  });

  it("★ and says so in the sentence", () => {
    expect(plan1099Copy(plan)).toMatch(/1 supplier looks like it needs a 1099 · 1 we can't decide/);
  });

  it("an empty year says so plainly", () => {
    expect(plan1099Copy(plan1099({ contacts: [], vendorRowsFor: () => [], roleOfCode: role }))).toMatch(/No suppliers look like/);
  });
});

describe("★ already handled is not the same as not eligible", () => {
  it("a sent 1099 and a marked exemption each say which they are", () => {
    expect(v({ name: "Ace", sent_1099_2025: true }, [paid(5000, 6250)]).verdict).toBe(VERDICT.ALREADY_SENT);
    expect(v({ name: "Ace", is_1099_exempt: true }, [paid(5000, 6250)]).verdict).toBe(VERDICT.MARKED_EXEMPT);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ AND IT HAS A READER — otherwise it would be exactly the O95 shape this codebase keeps
// finding: a careful derivation that nothing consults, indistinguishable from not having
// built it.
// ═════════════════════════════════════════════════════════════════════════════
import fs from "fs";
import path from "path";

describe("★★ the derivation reaches the screen", () => {
  const tax = fs.readFileSync(path.join(process.cwd(), "src/components/views/TaxView.jsx"), "utf8");

  it("★★★ the tax page counts from the plan, not from the flag", () => {
    expect(tax).toMatch(/plan1099\(\{/);
    expect(tax).toMatch(/const need1099 = plan\.outstanding/);
    // the old flag count must be gone, not merely unused
    expect(tax).not.toMatch(/c\.is1099 && !c\.is_1099_exempt/);
  });

  it("★★ and the sentence is the plan's own, so it cannot describe a different count", () => {
    expect(tax).toMatch(/\{plan1099Copy\(plan\)\}/);
    expect(tax).not.toMatch(/vendors? need 1099s this year/);
  });

  // ★★★ THIS USED TO ASSERT THE EXPRESSION `r.vendor_key || r.vendor` — WHICH IS THE ROW
  // HALF OF A TWO-SIDED LOOKUP, AND THE HALF THAT WAS ALREADY RIGHT. The CONTACT side read
  // `c.name.toLowerCase()`, so the two never met and the test could not see it: it pinned
  // the mechanism on one side of a boundary and called the contract proved. Rewritten to
  // run the real `plan1099` over names that actually differ between the two normalisations.
  it("★★ BOTH sides of the payment lookup normalise the same way — the real specimens", () => {
    const roleOfCode = () => "professional_services";
    // Every one of these is a live vendor name whose grouping key is NOT its lower-cased
    // self: a legal suffix, a trailing period, an ampersand.
    for (const name of ["Hill Country Milling Co.", "Roma Cheese & Dairy Co.", "Sabine Kitchen Equipment LLC"]) {
      const rows = [{ vendor: name, vendor_key: vendorGroupKey(name), amount: 5000, gl_code: "6800", date: "2026-03-01" }];
      const byKey = new Map([[rows[0].vendor_key, rows]]);
      const plan = plan1099({
        contacts: [{ id: "c1", name, type: "vendor", business_type: "sole_proprietor" }],
        vendorRowsFor: (c) => byKey.get(vendorGroupKey(c.name)) || [],
        roleOfCode,
      });
      // $5,000 of services to a sole proprietor is squarely reportable. If the lookup
      // misses, payments read as $0, it falls under the $600 floor, and the vendor is
      // SILENTLY never reported — which is the failure this test exists to prevent.
      expect([name, plan.outstanding]).toEqual([name, 1]);
      expect([name, plan.eligible.map((r) => r.verdict)]).toEqual([name, [VERDICT.ELIGIBLE]]);
      expect([name, plan.eligible[0].payments.total]).toEqual([name, 5000]);
    }
  });

  // ★★★ A COMPARISON AGAINST A CONSTANT THAT DOES NOT EXIST FAILS SILENTLY. Writing
  // `VERDICT.REPORTABLE` (there is no such key) makes the test `undefined === "eligible"`,
  // which is simply false — so the branch never runs, the badge never appears, the build
  // is clean and the suite is green. I did exactly that in VendorsView while writing this
  // commit, and only a test that RAN the badge caught it. This is the cheap general catch.
  it("★★ every VERDICT.* referenced anywhere in src/ is a real key", () => {
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p); else if (/\.jsx?$/.test(p)) files.push(p);
    });
    walk("src");
    const bad = [];
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      for (const m of src.matchAll(/\bVERDICT\.([A-Z_]+)/g))
        if (!(m[1] in VERDICT)) bad.push(`${f}: VERDICT.${m[1]}`);
    }
    expect(bad).toEqual([]);
    // …and the check must have something to look at, or it passes by finding nothing.
    const seen = files.flatMap((f) => [...fs.readFileSync(f, "utf8").matchAll(/\bVERDICT\.([A-Z_]+)/g)].map((m) => m[1]));
    expect(seen.length).toBeGreaterThan(3);
  });

  it("★ and the Tax page wires it that way — both sides through the same helper", () => {
    // The grep is the second line of defence, not the first: it pins that the screen uses
    // one normaliser for the map key AND the lookup, which is what the case above proves
    // matters. `r.vendor_key || r.vendor` passing was exactly the false comfort before.
    expect(tax).toMatch(/const keyOf = React\.useCallback\(\(s\) => vendorGroupKey\(s\)/);
    expect(tax).toMatch(/r\.vendor_key \|\| keyOf\(r\.vendor\)/);
    expect(tax).toMatch(/byName\.get\(keyOf\(c\.name\)\)/);
    expect(tax).not.toMatch(/String\(c\.name \|\| ""\)\.toLowerCase\(\)/);
  });

  it("★ and only this year's rows are considered", () => {
    expect(tax).toMatch(/startsWith\(String\(year\)\)/);
  });
});
