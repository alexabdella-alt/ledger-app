import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { buildAliasIndex, applyAlias, aliasConflicts, validateAlias, aliasExplainer, ALIAS_REJECT } from "../src/lib/vendorAlias";
import { buildVendorSummary } from "../src/lib/vendorSummary";
import { planInvoiceArrival, ARRIVAL } from "../src/lib/invoicePayment";

// ═════════════════════════════════════════════════════════════════════════════
// O111 — TELLING US THAT TWO NAMES ARE ONE SUPPLIER.
//
// Franklin Ave Properties: the bank line reads `ACH DEBIT - FRANKLIN AVE PROPERTIES LP
// RENT`, the invoice reads `Franklin Ave Properties`. Rail-stripping removes transport
// noise and legal suffixes, but the descriptor also carries a PURPOSE word — RENT — saying
// what the payment was FOR, not who it was TO. One landlord, two vendors.
//
// ★★ THE ANTI-MERGE CASES ARE THE REASON TO TRUST THIS, AND THEY COME FIRST. A wrong merge
// is a ONE-WAY DOOR: it launders one vendor's attested mapping onto another's charges,
// silently. So aliases are asserted by a person, applied by a Map lookup, and nothing here
// infers, scores or suggests anything.
// ═════════════════════════════════════════════════════════════════════════════

const contact = (id, name, aliases = []) => ({ id, name, aliases });

describe("★★ what an alias must never do", () => {
  const idx = buildAliasIndex([contact("c1", "Franklin Ave Properties", ["FRANKLIN AVE PROPERTIES LP RENT"])]);

  it("★★★ leaves every other vendor exactly as it found them", () => {
    // The pairs `vendorIdentity.test.js` pins as must-never-merge, run through the alias
    // path: an index that contains one entry must not perturb anything else.
    for (const k of ["sysco", "sysco fuel", "lone star", "lone star restaurant supply", "bluebonnet linen service"]) {
      expect(applyAlias(k, idx)).toBe(k);
    }
  });

  it("★ an empty index is a no-op, so the feature is off until someone uses it", () => {
    const none = buildAliasIndex([]);
    expect(applyAlias("franklin ave properties rent", none)).toBe("franklin ave properties rent");
    expect(applyAlias("anything", null)).toBe("anything");
  });

  it("★★ two contacts claiming one alias resolves to NEITHER, and is reported", () => {
    // Picking a winner silently is how a vendor's charges start landing on someone else's
    // account. The conflicted alias stays split — visible — and `aliasConflicts` names it.
    const both = [contact("a", "Alpha Supply", ["SHARED NAME"]), contact("b", "Beta Supply", ["SHARED NAME"])];
    const i2 = buildAliasIndex(both);
    expect(applyAlias("shared name", i2)).toBe("shared name");
    expect(aliasConflicts(both)).toEqual([{ key: "shared name", names: ["Alpha Supply", "Beta Supply"] }]);
  });
});

describe("★★★ the Franklin Ave case, end to end", () => {
  const contacts = [contact("c1", "Franklin Ave Properties", ["FRANKLIN AVE PROPERTIES LP RENT"])];
  const idx = buildAliasIndex(contacts);

  it("the two doors resolve to one identity", () => {
    expect(applyAlias("franklin ave properties rent", idx)).toBe("franklin ave properties");
  });

  it("★★ the vendor list shows ONE landlord, not two", () => {
    const rows = [
      { id: "1", vendor: "Franklin Ave Properties", vendor_key: "franklin ave properties", gl_code: "6100", amount: 2400, date: "2026-07-01", debit_credit: "debit" },
      { id: "2", vendor: "Franklin Ave Properties LP Rent", vendor_key: "franklin ave properties rent", gl_code: "6100", amount: 2400, date: "2026-08-01", debit_credit: "debit" },
    ];
    expect(buildVendorSummary(rows).length).toBe(2);            // before
    const after = buildVendorSummary(rows, idx);
    expect(after.length).toBe(1);                                // after
    expect(after[0].total).toBe(4800);                           // and the totals join up
  });

  it("★★★ the invoice attaches to the bank payment — the O114 last mile", () => {
    // The pre-registered test used a descriptor WITHOUT the purpose word, so it passed on
    // the string rules alone. This is the real one: `RENT` is present, no string rule can
    // safely remove it, and only the asserted alias closes it.
    const payment = {
      id: "p1", date: "2026-08-03", amount: 2400, source: "bank_import", status: "posted",
      description: "Franklin Ave Properties LP Rent – ACH DEBIT - FRANKLIN AVE PROPERTIES LP RENT",
      gl_code: "1000", debit_credit: "credit", payment_status: "paid",
    };
    const inv = { id: "i1", vendor: "Franklin Ave Properties", amount: 2400, date: "2026-08-01" };
    const ctx = { cashCodes: ["1000"] };

    expect(planInvoiceArrival(inv, [payment], ctx).action).not.toBe(ARRIVAL.ATTACH);        // without
    expect(planInvoiceArrival(inv, [payment], { ...ctx, aliasIndex: idx }).action).toBe(ARRIVAL.ATTACH);  // with
  });
});

describe("★ what a person is allowed to assert", () => {
  const c = contact("c1", "Franklin Ave Properties", ["OLD NAME"]);
  const others = [c, contact("c2", "Lone Star Restaurant Supply", [])];

  it("refuses a name with no letters — the phantom-vendor door (C209)", () => {
    expect(validateAlias("123456", c, others).reason).toBe(ALIAS_REJECT.UNKEYABLE);
    expect(validateAlias("&&&", c, others).reason).toBe(ALIAS_REJECT.UNKEYABLE);
  });

  it("refuses the contact's own name, and says why in their words", () => {
    const r = validateAlias("Franklin Ave Properties", c, others);
    expect(r.reason).toBe(ALIAS_REJECT.SELF);
    expect(r.message).toContain("Franklin Ave Properties");
  });

  it("★★ refuses a name another supplier already answers to, and NAMES them", () => {
    // Without this, one supplier's charges would start landing on another's account and the
    // only clue would be a total that moved.
    const r = validateAlias("Lone Star Restaurant Supply", c, others);
    expect(r.reason).toBe(ALIAS_REJECT.TAKEN);
    expect(r.message).toContain("Lone Star Restaurant Supply");
  });

  it("refuses one it already has, and accepts a genuine new one", () => {
    expect(validateAlias("old name", c, others).reason).toBe(ALIAS_REJECT.DUPLICATE);
    expect(validateAlias("FRANKLIN AVE PROPERTIES LP RENT", c, others).ok).toBe(true);
  });

  it("★ the explainer reads the contact, so it cannot describe a merge that isn't happening", () => {
    expect(aliasExplainer({ name: "Roma", aliases: [] })).toContain("Roma");
    expect(aliasExplainer({ name: "Roma", aliases: ["a", "b"] })).toContain("2 other names");
  });
});

describe("★ the module cannot infer, score or suggest", () => {
  it("holds no fuzzy matching of any kind", () => {
    // O106 (suggesting matches) is a separate feature with a different risk profile. This
    // one applies only a merge a human has already asserted — a test says so because the
    // difference is invisible from the outside once both exist.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/vendorAlias.js"), "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(src).not.toMatch(/levenshtein|distance|similar|fuzzy|score|suggest|includes\(/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★ THE INDEX HAS TO REACH THE PLACES THAT DECIDE — "name the reader" (§9). An alias a
// person asserted that no consumer consults is a field written for nothing, which is the
// exact shape of O95's six defects.
// ═════════════════════════════════════════════════════════════════════════════
describe("★ the asserted alias reaches every decision it should", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");

  it("the vendor list groups with it", () => {
    expect(app).toMatch(/buildVendorSummary\(invoices, aliasIndex\)/);
  });

  it("★★ and the invoice/payment matcher is given it", () => {
    const call = app.slice(app.indexOf("planInvoiceArrival(invoice, invoices, {"), app.indexOf("planInvoiceArrival(invoice, invoices, {") + 400);
    expect(call).toMatch(/aliasIndex,/);
  });

  it("★ it is rebuilt from contacts, so it changes only when a person changes one", () => {
    expect(app).toMatch(/const aliasIndex = useMemo\(\(\) => buildAliasIndex\(contacts\), \[contacts\]\)/);
  });

  it("★ and the alias survives a save — it is carried into the persisted row", () => {
    // Without this the person adds an alias, sees it applied, and loses it on reload: the
    // O76 shape (the screen right, the database never agreeing).
    const fn = app.slice(app.indexOf("const persistContact"), app.indexOf("const persistContact") + 900);
    expect(fn).toMatch(/aliases: Array\.isArray\(contact\.aliases\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE ANTI-VACUITY CLAUSE THE RE-DRIVE CRITERIA NOW REQUIRE.
//
// "The alias made Franklin Ave attach" and "the matcher started merging everything" produce
// the SAME observation on that one vendor. The criteria were amended to require that, with
// the alias set, every OTHER specimen behaves exactly as it does without it — otherwise the
// alias index is not scoped to the vendor it names and the merge is a coincidence.
//
// ★ Asserted here as well as in the drive doc, because a criterion nobody can run before the
// drive is a criterion that gets discovered failing on the day.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ an alias changes ONE vendor and nothing else", () => {
  const contacts = [contact("c1", "Franklin Ave Properties", ["FRANKLIN AVE PROPERTIES LP RENT"])];
  const idx = buildAliasIndex(contacts);
  const ctx = { cashCodes: ["1000"] };

  const payment = (id, vendorDesc, amount, date) => ({
    id, date, amount, source: "bank_import", status: "posted",
    description: vendorDesc, gl_code: "1000", debit_credit: "credit", payment_status: "paid",
  });

  // The other four August specimens, each with its own real descriptor.
  const others = [
    ["Roma Cheese & Dairy Co.", "Roma Cheese & Dairy Co. – ACH DEBIT - ROMA CHEESE & DAIRY CO", 551.2],
    ["Toast", "Toast – TOAST MERCHANT FEES AUGUST", 462.85],
    ["Alamo Fire & Safety LLC", "Alamo Fire & Safety LLC – ACH DEBIT - ALAMO FIRE & SAFETY LLC", 425],
    ["Bluebonnet Linen Service", "Bluebonnet Linen Service – ACH DEBIT - BLUEBONNET LINEN SERVICE", 145],
  ];

  it("★★★ every other specimen behaves identically with and without the alias", () => {
    for (const [vendor, desc, amount] of others) {
      const p = payment("p", desc, amount, "2026-08-03");
      const inv = { id: "i", vendor, amount, date: "2026-08-01" };
      const without = planInvoiceArrival(inv, [p], ctx);
      const wit = planInvoiceArrival(inv, [p], { ...ctx, aliasIndex: idx });
      expect([vendor, wit.action]).toEqual([vendor, without.action]);
      expect([vendor, wit.reason || null]).toEqual([vendor, without.reason || null]);
    }
  });

  it("★ and the index contains exactly the one merge a person asserted", () => {
    expect([...idx.keys()]).toEqual(["franklin ave properties rent"]);
  });
});
