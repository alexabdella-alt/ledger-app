import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planVendorBackfill, graduationPreview, attestationStrengthFor, rawDescriptorOf, ATTESTATION_STRENGTH, NON_ATTESTING_EXCEPTIONS } from "../src/lib/vendorBackfill.js";
import { MATCH_EXCEPTION_KIND, matchResolutionFacts } from "../src/lib/invoicePayment.js";
import { VENDOR_TIER } from "../src/lib/vendorTier.js";

// ═════════════════════════════════════════════════════════════════════════════
// C201 — the historical backfill planner.
//
// THE ATTESTATION RULE (decided 2026-08-23): a month's sign-off attests every line as
// it stood at signing. So an observation counts toward Q1 iff its line sits in a SIGNED
// month, and the mapping it counts toward is the account the line held at sign-off.
// Strength (explicit = a human touched this line; implicit = auto-booked inside a month
// a human later signed) is RECORDED but does not gate — both count toward the clock.
//
// The load-bearing exclusion: lines in UNSIGNED months do not count at all. Seeding the
// state machine from unattested bookings would be the machine graduating vendors on its
// own say-so — ·3a in a backfill's clothes.
// ═════════════════════════════════════════════════════════════════════════════

const ln = (over = {}) => ({
  line_id: "L1", descriptor: "Sysco Foods – ACH DEBIT SYSCO FOODS", date: "2026-01-15", account_id: "acct-cogs",
  amount: 1200, deleted: false, exception_resolved: false, recoded: false, source: "bank_import", ...over,
});
const SIGNED = ["2026-01", "2026-02", "2026-03"];

describe("what counts, and what does not", () => {
  it("★ a line in an UNSIGNED month does not count at all", () => {
    const p = planVendorBackfill({ lines: [ln({ date: "2026-09-01" })], signedMonths: SIGNED });
    expect(p.counts.entities).toBe(0);
    expect(p.skipped.unsigned_month).toBe(1);
  });

  it("a deleted line does not count, and is reported", () => {
    const p = planVendorBackfill({ lines: [ln({ deleted: true })], signedMonths: SIGNED });
    expect(p.skipped.deleted).toBe(1);
  });

  it("a descriptor carrying no identity does not become a vendor", () => {
    // "884213" is a trace number, not a vendor. C200's letters-required guard.
    const p = planVendorBackfill({ lines: [ln({ descriptor: "Unknown – 884213" })], signedMonths: SIGNED });
    expect(p.skipped.no_identity).toBe(1);
    expect(p.counts.entities).toBe(0);
  });

  it("strength is classified but BOTH kinds count toward the clock", () => {
    expect(attestationStrengthFor({ exception_resolved: true })).toBe(ATTESTATION_STRENGTH.EXPLICIT);
    expect(attestationStrengthFor({ recoded: true })).toBe(ATTESTATION_STRENGTH.EXPLICIT);
    expect(attestationStrengthFor({})).toBe(ATTESTATION_STRENGTH.IMPLICIT);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ★★ AN ATTESTATION IS SCOPED TO THE QUESTION THAT WAS ASKED (CLAUDE.md §9).
  //
  // Pinned HERE, in the attestation suite, and NOT in `tests/invoicePayment.test.js`
  // — because this is where someone doubting the ATTESTATION rule will come looking,
  // and a proof filed by the commit that created it is a proof nobody finds. That is
  // the ·3c review bounce, verbatim: the null-net pin existed, passed under mutation,
  // and lived where no falsifier of the matcher would ever run it.
  // ═══════════════════════════════════════════════════════════════════════════
  it("★★ resolving an INVOICE-PAYMENT MATCH does NOT mint an explicit attestation", () => {
    // The hazard, concretely: an ambiguity card IS an exception, so `exception_resolved`
    // is set when a human answers it. Amendment B's backfill bar is ">= 1 explicit", so
    // without this exclusion a vendor would graduate to KNOWN on PAPERWORK VOLUME — the
    // machine attesting to its own guess through a human's click on a question that was
    // never about the account. Amendment B was signed to prevent exactly that.
    expect(attestationStrengthFor({ exception_resolved: true, exception_kind: MATCH_EXCEPTION_KIND }))
      .toBe(ATTESTATION_STRENGTH.IMPLICIT);
  });

  it("★ but a RECODE alongside the match DOES attest — a human looked at the account", () => {
    // Two events, two facts. The attestation attaches to the recode, never to the match,
    // and only one of them touches the familiarity clock.
    expect(attestationStrengthFor({ exception_resolved: true, exception_kind: MATCH_EXCEPTION_KIND, recoded: true }))
      .toBe(ATTESTATION_STRENGTH.EXPLICIT);
    const f = matchResolutionFacts({ entryId: "e", invoiceId: "i", answer: "same", recodedAccountId: "a" });
    expect(f.match.attests_mapping).toBe(false);
    expect(f.recode.attests_mapping).toBe(true);
  });

  it("★ every OTHER exception kind still attests — the exclusion is narrow, not a hole", () => {
    // Widening this set is how the bar quietly disappears, so the guard asserts the
    // set's exact contents rather than merely that the one case works.
    expect([...NON_ATTESTING_EXCEPTIONS]).toEqual([MATCH_EXCEPTION_KIND]);
    for (const kind of ["low_confidence", "unmatched_bank_line", "balance_discrepancy", undefined]) {
      expect(attestationStrengthFor({ exception_resolved: true, exception_kind: kind }), String(kind))
        .toBe(ATTESTATION_STRENGTH.EXPLICIT);
    }
    // Both kinds count toward the CLOCK — observation_count and distinct_months are
    // seeded either way. Amendment B (2026-08-25) then withholds the TIER separately
    // when none was explicit; that is a different gate, tested in its own block below.
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", date: "2026-01-10" }), ln({ line_id: "b", date: "2026-02-10" })],
      signedMonths: SIGNED,
    });
    expect(p.rows[0].observation_count).toBe(2);
    expect(p.rows[0].distinct_months).toEqual(["2026-01", "2026-02"]);
    expect(p.withheldByAmendmentB).toBe(1);
  });
});

describe("identity grouping uses the app's ONE implementation", () => {
  it("★ many rails, one vendor — the reason this is not a SQL migration", () => {
    // If the backfill grouped differently from the way the app resolves identity, it
    // would seed keys the app cannot look up: inert on arrival, and green.
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "a", descriptor: "Bluebonnet Linen – SQ *BLUEBONNET LINEN", date: "2026-01-05", account_id: "acct-linen", amount: 145, exception_resolved: true }),
        ln({ line_id: "b", descriptor: "Bluebonnet Linen – ACH DEBIT BLUEBONNET LINEN", date: "2026-02-05", account_id: "acct-linen", amount: 150 }),
        ln({ line_id: "c", descriptor: "Bluebonnet Linen – BLUEBONNET LINEN #12", date: "2026-03-05", account_id: "acct-linen", amount: 148 }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);
    expect(p.counts.graduating).toBe(1);
  });

  it("two genuinely different vendors stay two entities", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", descriptor: "Sysco Foods – SYSCO FOODS" }), ln({ line_id: "b", descriptor: "Sysco Fuel – SYSCO FUEL", date: "2026-02-01" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(2);
  });
});

describe("★ the two live specimens, as the deploy would see them", () => {
  it("BLUEBONNET LINEN graduates KNOWN on two signed months", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "b1", descriptor: "Bluebonnet Linen – BLUEBONNET LINEN", date: "2026-01-08", account_id: "acct-linen", amount: 145, exception_resolved: true }),
        ln({ line_id: "b2", descriptor: "Bluebonnet Linen – BLUEBONNET LINEN", date: "2026-02-08", account_id: "acct-linen", amount: 150 }),
      ],
      signedMonths: SIGNED, companyId: "co1",
    });
    const [row] = p.rows;
    expect(row).toMatchObject({ tier: VENDOR_TIER.KNOWN, attested_account_id: "acct-linen", observation_count: 2 });
    expect(row.distinct_months).toEqual(["2026-01", "2026-02"]);
  });

  it("LONE STAR graduates once its descriptor variants collapse to one entity", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "l1", descriptor: "Lone Star Restaurant Supply – TST* LONE STAR RESTAURANT SUPPLY", date: "2026-01-20", account_id: "acct-cogs", amount: 240, exception_resolved: true }),
        ln({ line_id: "l2", descriptor: "Lone Star Restaurant Supply – ACH DEBIT LONE STAR RESTAURANT SUPPLY", date: "2026-02-20", account_id: "acct-cogs", amount: 240 }),
      ],
      signedMonths: SIGNED, companyId: "co1",
    });
    expect(p.counts.entities).toBe(1);
    expect(p.rows[0].tier).toBe(VENDOR_TIER.KNOWN);
  });

  it("★ a vendor attested to TWO accounts does NOT graduate — and says why", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "x", descriptor: "Ambiguous Co – AMBIGUOUS CO", date: "2026-01-02", account_id: "acct-a" }),
        ln({ line_id: "y", descriptor: "Ambiguous Co – AMBIGUOUS CO", date: "2026-02-02", account_id: "acct-b" }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.graduating).toBe(0);
    expect(graduationPreview(p)[0].blocked_by).toMatch(/attested to 2 different accounts/);
  });

  it("a weekly vendor billing four times in ONE signed month does not graduate", () => {
    const lines = [5, 12, 19, 26].map((d) => ln({ line_id: `w${d}`, descriptor: "Weekly Co – WEEKLY CO", date: `2026-01-${d}` }));
    const p = planVendorBackfill({ lines, signedMonths: SIGNED });
    expect(p.counts.graduating).toBe(0);
    expect(graduationPreview(p)[0].blocked_by).toMatch(/all 4 observations fall in 2026-01/);
  });
});

describe("(Q3) dormancy applies on arrival", () => {
  it("a historically-graduated vendor silent for 6 months decays to DECLARED", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", date: "2026-01-05" }), ln({ line_id: "b", date: "2026-02-05" })],
      signedMonths: SIGNED, asOfMonth: "2026-08",
    });
    expect(p.rows[0].tier).toBe(VENDOR_TIER.DECLARED);
    expect(p.rows[0].demotion_reason).toBe("dormancy");
    expect(graduationPreview(p)[0].blocked_by).toMatch(/decayed on arrival/);
  });

  it("a recently-seen vendor is seeded KNOWN", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", date: "2026-02-05", exception_resolved: true }), ln({ line_id: "b", date: "2026-03-05" })],
      signedMonths: SIGNED, asOfMonth: "2026-04",
    });
    expect(p.rows[0].tier).toBe(VENDOR_TIER.KNOWN);
  });
});

describe("the preview is checkable by a human before anything is written", () => {
  const p = planVendorBackfill({
    lines: [
      ln({ line_id: "a", descriptor: "Bluebonnet Linen – BLUEBONNET LINEN", date: "2026-01-08", account_id: "acct-linen", amount: 145, exception_resolved: true }),
      ln({ line_id: "b", descriptor: "Bluebonnet Linen – BLUEBONNET LINEN", date: "2026-02-08", account_id: "acct-linen", amount: 150 }),
      ln({ line_id: "c", descriptor: "One Hit Wonder – ONE HIT WONDER", date: "2026-01-09", account_id: "acct-x", amount: 50 }),
    ],
    signedMonths: SIGNED, companyId: "co1",
  });

  it("graduating vendors sort first, with their months and both strengths shown", () => {
    const rows = graduationPreview(p);
    expect(rows[0]).toMatchObject({ tier: VENDOR_TIER.KNOWN, observations: 2, explicit: 1, implicit: 1 });
    expect(rows[0].distinct_months).toEqual(["2026-01", "2026-02"]);
    expect(rows[0].descriptors).toContain("BLUEBONNET LINEN");
  });

  it("★ non-graduating vendors show WHY — the useful half of a preview", () => {
    const wonder = graduationPreview(p).find((r) => r.entity_key.includes("one hit wonder"));
    expect(wonder.tier).not.toBe(VENDOR_TIER.KNOWN);
    expect(wonder.blocked_by).toMatch(/only 1 attested observation/);
  });
});

describe("the planner cannot write, and does not reimplement identity", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/vendorBackfill.js"), "utf8");

  it("no I/O", () => {
    expect(src).not.toMatch(/supabase|fetch\(|logAudit/);
  });

  it("★ identity comes from the ONE implementation, not a copy", () => {
    // The whole reason this is not a SQL migration. A second normalizer would drift —
    // ·3b(f3) re-keyed fingerprints while (f1) read the old shape, in one commit.
    expect(src).toMatch(/import \{ identityForEntry, IDENTITY_STRATEGY \} from "\.\/vendorIdentity\.js"/);
    expect(src).not.toMatch(/replace\(\/\^sq|normalizeName\s*=/);   // no local re-implementation
  });

  it("graduation comes from the REAL state machine, not a backfill-only rule", () => {
    expect(src).toMatch(/import \{ recordObservation, vendorStateRow, applyDormancy/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ THE OPEN-BOOK PROBLEM (operator finding, 2026-08-23).
//
// `je.description` is "Resolved Vendor Name – RAW BANK TEXT". Resolving identity from
// the FULL string grades the resolver against a string containing its own answer:
// every variant resolves perfectly because the resolved name is right there, and the
// backfill reports flawless grouping while proving nothing. Closed-book, or it is not
// a test.
// ─────────────────────────────────────────────────────────────────────────────
describe("★ identity is resolved from the RAW half only", () => {
  it("splits on the en-dash and takes the right half", () => {
    expect(rawDescriptorOf("Lone Star Restaurant Supply – ACH DEBIT - LONE STAR RESTAURANT SUPPLY"))
      .toBe("ACH DEBIT - LONE STAR RESTAURANT SUPPLY");
    // A HYPHEN inside the raw text must not be mistaken for the separator.
    expect(rawDescriptorOf("X – ACH DEBIT - Y")).toBe("ACH DEBIT - Y");
  });

  it("★ a row with NO separator is EXCLUDED, not scored on the whole string", () => {
    // Falling back to the full string is the contaminated case in disguise.
    expect(rawDescriptorOf("JUST ONE PART")).toBe(null);
    const p = planVendorBackfill({ lines: [ln({ descriptor: "JUST ONE PART" })], signedMonths: SIGNED });
    expect(p.skipped.no_raw_half).toBe(1);
    expect(p.counts.entities).toBe(0);
  });

  it("★ the resolved name in the LEFT half cannot influence grouping", () => {
    // Same raw text, deliberately DIFFERENT resolved names. If the left half leaked in,
    // these would split into two entities. They must be one.
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "a", descriptor: "Sysco Foods – ACH DEBIT SYSCO", date: "2026-01-04" }),
        ln({ line_id: "b", descriptor: "Totally Different Name – ACH DEBIT SYSCO", date: "2026-02-04" }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);
  });

  it("★ and conversely: one resolved name over two DIFFERENT raw texts still splits", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "a", descriptor: "Sysco – ACH DEBIT SYSCO FOODS", date: "2026-01-04" }),
        ln({ line_id: "b", descriptor: "Sysco – ACH DEBIT SYSCO FUEL", date: "2026-02-04" }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(2);   // Foods and Fuel are not one vendor
  });
});

describe("★ corpus variance — a clean preview must not imply a tested resolver", () => {
  it("flags data where every vendor arrives under ONE raw string", () => {
    // The Franklin Ave fixture shape: Lone Star's raw text is byte-identical across all
    // four months, so normalisation has no work to do and a perfect grouping result is
    // an artefact of the fixture, not evidence about the function.
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "a", descriptor: "Lone Star – ACH DEBIT - LONE STAR RESTAURANT SUPPLY", date: "2026-01-20", exception_resolved: true }),
        ln({ line_id: "b", descriptor: "Lone Star – ACH DEBIT - LONE STAR RESTAURANT SUPPLY", date: "2026-02-20" }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.graduating).toBe(1);                       // it graduates…
    expect(p.variance.identityResolutionUnexercised).toBe(true);  // …and proves nothing about identity
    expect(p.variance.vendorsWithMultipleRawDescriptors).toBe(0);
  });

  it("does NOT flag data that genuinely exercises normalisation", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "a", descriptor: "Bluebonnet – SQ *BLUEBONNET LINEN", date: "2026-01-05" }),
        ln({ line_id: "b", descriptor: "Bluebonnet – ACH DEBIT BLUEBONNET LINEN #4", date: "2026-02-05" }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.variance.identityResolutionUnexercised).toBe(false);
    expect(p.variance.vendorsWithMultipleRawDescriptors).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PER-SOURCE IDENTITY STRATEGY (approved 2026-08-25).
// One rule for all four sources was wrong on two of them, silently. Only bank_import
// has a descriptor problem; the rest carry a vendor as structured data.
// ─────────────────────────────────────────────────────────────────────────────
describe("per-source identity strategy", () => {
  it("bank_import RESOLVES from the noisy right half", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "bank_import", descriptor: "Roma – ACH DEBIT - ROMA CHEESE & DAIRY CO", date: "2026-01-04" }),
              ln({ line_id: "b", source: "bank_import", descriptor: "Roma – ACH DEBIT - ROMA CHEESE & DAIRY CO", date: "2026-02-04" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);
    expect(p.identityMix).toEqual({ resolved: 2, read: 0 });
  });

  it("universal_upload and manual READ the clean left half", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "universal_upload", descriptor: "Roma Cheese & Dairy Co. – 40LB MOZZARELLA", date: "2026-01-04" }),
              ln({ line_id: "b", source: "manual", descriptor: "Roma Cheese & Dairy Co – Payment – Roma Cheese & Dairy Co", date: "2026-02-04" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);              // the product line never becomes the vendor
    expect(p.identityMix).toEqual({ resolved: 0, read: 2 });
  });

  it("★ payroll is EXCLUDED, not parsed — it carries no vendor→account judgement", () => {
    const p = planVendorBackfill({
      lines: [ln({ source: "payroll", descriptor: "Gusto Payroll — 2026-02-28 – 2026-03-13", date: "2026-03-13" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(0);
    expect(p.skipped.source_payroll).toBe(1);
    // And specifically NOT mis-parsed to the date, which is what the old rule did.
    expect(p.skipped.no_identity).toBeUndefined();
  });

  it("opening_balance, ar_invoice and api are excluded, each counted by name", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "opening_balance" }), ln({ line_id: "b", source: "ar_invoice" }), ln({ line_id: "c", source: "api" })],
      signedMonths: SIGNED,
    });
    expect(p.skipped).toMatchObject({ source_opening_balance: 1, source_ar_invoice: 1, source_api: 1 });
  });

  it("★ an UNRECOGNISED source is excluded and counted, never guessed at", () => {
    // A wrong entity key merges two vendors and launders one's mapping onto the
    // other's charges. A missing one books to suspense and flags. Not symmetric.
    const p = planVendorBackfill({ lines: [ln({ source: "something_new" })], signedMonths: SIGNED });
    expect(p.counts.entities).toBe(0);
    expect(p.skipped.source_something_new).toBe(1);
  });

  it("★ identity_source is carried per observation and reported, not footnoted", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "bank_import", descriptor: "Roma – ACH DEBIT - ROMA CHEESE & DAIRY CO", date: "2026-01-04" }),
              ln({ line_id: "b", source: "universal_upload", descriptor: "Roma Cheese & Dairy Co. – 40LB MOZZARELLA", date: "2026-02-04" })],
      signedMonths: SIGNED,
    });
    expect(p.identityMix).toEqual({ resolved: 1, read: 1 });
    expect(p.counts.entities).toBe(1);              // the two doors merge
  });
});

describe("★ payroll on the BANK rail is excluded too", () => {
  it("a Gusto net-pay bank line does not become a vendor", () => {
    // source='payroll' catches the register; this catches the net-pay debit that
    // arrives as an ordinary bank_import line. Without it, a `gusto payroll` entity
    // survives at 3,150 NET while the register books 4,000 GROSS — one entity, two
    // paths measuring different quantities, and a spurious 1.27x band event.
    const p = planVendorBackfill({
      lines: [ln({ line_id: "g1", source: "bank_import", descriptor: "Gusto Payroll – GUSTO PAYROLL 011526", date: "2026-01-15", amount: 3150 }),
              ln({ line_id: "g2", source: "bank_import", descriptor: "Gusto Payroll – GUSTO PAYROLL 013026", date: "2026-01-30", amount: 3150 })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(0);
    expect(p.skipped.payroll_bank_line).toBe(2);
  });

  it("and it does NOT swallow ordinary vendors", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "bank_import", descriptor: "Roma – ACH DEBIT - ROMA CHEESE & DAIRY CO", date: "2026-01-04" }),
              ln({ line_id: "b", source: "bank_import", descriptor: "Bank – MONTHLY SERVICE FEE", date: "2026-02-04" })],
      signedMonths: SIGNED,
    });
    expect(p.skipped.payroll_bank_line).toBeUndefined();
    expect(p.counts.entities).toBe(2);
  });
});

describe("★ the merge test, on REAL strings from the re-pull", () => {
  const cases = [
    ["roma cheese and dairy", "R – ACH DEBIT - ROMA CHEESE & DAIRY CO", "Roma Cheese & Dairy Co. – Wholesale cheese and dairy products plus refrigerated delivery", "Roma Cheese & Dairy Co. – Payment – Roma Cheese & Dairy Co."],
    ["lone star restaurant supply", "L – ACH DEBIT - LONE STAR RESTAURANT SUPPLY", "Lone Star Restaurant Supply – Foodservice supplies: crushed tomatoes, high-gluten flour, olive oil blend", null],
    ["austin municipal utilities", "A – ACH DEBIT - AUSTIN MUNICIPAL UTILITIES", "Austin Municipal Utilities – Utility bill — electric service, water & wastewater, fees for service period 12/05/2025–01/05/2026", null],
    ["hill country milling", "H – ACH DEBIT - HILL COUNTRY MILLING CO", "Hill Country Milling Co. – Specialty flour and freight — bread flour, 00-style pizza flour", null],
  ];

  it("★ bank, invoice and manual all land on ONE key", () => {
    for (const [expected, bank, invoice, manual] of cases) {
      const lines = [ln({ line_id: "b", source: "bank_import", descriptor: bank, date: "2026-01-04" }),
                     ln({ line_id: "i", source: "universal_upload", descriptor: invoice, date: "2026-02-04" })];
      if (manual) lines.push(ln({ line_id: "m", source: "manual", descriptor: manual, date: "2026-03-04" }));
      const p = planVendorBackfill({ lines, signedMonths: SIGNED });
      expect(p.counts.entities, expected).toBe(1);
      expect(p.rows[0].entity_key).toBe(expected);
    }
  });

  it("a trailing \"Co.\" on the invoice side normalises away", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "universal_upload", descriptor: "Roma Cheese & Dairy Co. – Cheese", date: "2026-01-04" }),
              ln({ line_id: "b", source: "bank_import", descriptor: "R – ACH DEBIT - ROMA CHEESE & DAIRY CO", date: "2026-02-04" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);
  });

  it("★ em-dashes and unspaced en-dashes INSIDE the right half never become the split point", () => {
    // "…freight — bread flour" and "12/05/2025–01/05/2026" must not be mistaken for
    // the separator; only " – " (spaced en-dash) is.
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", source: "universal_upload", descriptor: "Austin Municipal Utilities – Utility bill — electric, water 12/05/2025–01/05/2026", date: "2026-01-04" }),
              ln({ line_id: "b", source: "universal_upload", descriptor: "Austin Municipal Utilities – Something else entirely — with an em-dash", date: "2026-02-04" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);
    expect(p.rows[0].entity_key).toBe("austin municipal utilities");
  });

  it("★ FRANKLIN AVE STILL SPLITS — knowingly accepted, pending the alias feature", () => {
    // The bank string carries a PURPOSE SUFFIX ("…LP RENT") that the vendor name does
    // not. Invoice and manual agree with each other; the bank alone dissents. This is
    // pinned as a KNOWN split so the alias feature has a failing case to fix, and so
    // nobody "fixes" it by widening the strip — which would also eat "Restaurant Supply".
    const p = planVendorBackfill({
      lines: [ln({ line_id: "b", source: "bank_import", descriptor: "F – ACH DEBIT - FRANKLIN AVE PROPERTIES LP RENT", date: "2026-01-04" }),
              ln({ line_id: "i", source: "universal_upload", descriptor: "Franklin Ave Properties LP – Monthly base rent — 1214 Franklin Ave Suite B — January 2026", date: "2026-02-04" }),
              ln({ line_id: "m", source: "manual", descriptor: "Franklin Ave Properties LP – Payment – Franklin Ave Properties LP", date: "2026-03-04" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(2);
    const keys = p.rows.map((r) => r.entity_key).sort();
    expect(keys).toEqual(["franklin ave properties", "franklin ave properties rent"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ★ AMENDMENT B — THE BACKFILL GRADUATION BAR (signed 2026-08-25).
//
// Graduation from HISTORY requires at least one EXPLICITLY attested observation.
// Signing a month is not examining a vendor, and in historical data the two are
// indistinguishable — so the backfill must assume the second.
//
// On today's data this withholds EVERYTHING (zero explicit observations exist), and
// the amendment says so in its own §0. These tests hold both halves: that the bar
// works when the distinction IS available, and that it withholds when it is not.
// ─────────────────────────────────────────────────────────────────────────────
describe("★ (Amendment B) backfill graduation requires an explicit attestation", () => {
  const two = (over = {}) => [
    ln({ line_id: "a", date: "2026-01-10", ...over }),
    ln({ line_id: "b", date: "2026-02-10" }),
  ];

  it("★ two IMPLICIT observations meet every Q1 condition and STILL do not graduate", () => {
    // This is Culinary Edge: two auto-bookings, two signed months, agreeing mapping.
    const p = planVendorBackfill({ lines: two(), signedMonths: SIGNED });
    expect(p.counts.graduating).toBe(0);
    expect(p.rows[0].tier).toBe("STRANGER");
    expect(p.withheldByAmendmentB).toBe(1);
  });

  it("★ and the preview says WHY — not 'too few observations', which would be false", () => {
    const p = planVendorBackfill({ lines: two(), signedMonths: SIGNED });
    const [row] = graduationPreview(p);
    expect(row.blocked_by).toMatch(/met every Q1 condition/);
    expect(row.blocked_by).toMatch(/no observation was explicitly attested/);
    expect(row.blocked_by).not.toMatch(/only \d+ attested observation/);
  });

  it("ONE explicit observation is enough to release the bar", () => {
    const p = planVendorBackfill({ lines: two({ exception_resolved: true }), signedMonths: SIGNED });
    expect(p.counts.graduating).toBe(1);
    expect(p.rows[0].tier).toBe("KNOWN");
    expect(p.withheldByAmendmentB).toBe(0);
  });

  it("a recode counts as explicit too", () => {
    const p = planVendorBackfill({ lines: two({ recoded: true }), signedMonths: SIGNED });
    expect(p.counts.graduating).toBe(1);
  });

  it("★ ONLY THE TIER IS WITHHELD — history is still seeded (§5)", () => {
    const p = planVendorBackfill({ lines: two(), signedMonths: SIGNED });
    const [row] = p.rows;
    expect(row.tier).toBe("STRANGER");
    expect(row.observation_count).toBe(2);
    expect(row.distinct_months).toEqual(["2026-01", "2026-02"]);
    expect(row.amount_mean).toBe(1200);
    expect(row.first_seen).toBe("2026-01");
  });

  it("★ LIVE Q1 IS NOT RAISED — the bar lives in the backfill, not the state machine", () => {
    // Amendment B §3. Putting it in vendorTier would silently raise the live rule too.
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/vendorTier.js"), "utf8");
    // Names the MECHANISM, not the word: an earlier version of this guard matched the
    // word "explicit" and tripped on the phrase "explicit transitions" in a comment —
    // a test that fails for a reason it does not mean is a test nobody will trust.
    expect(src, "the state machine must not read attestation strength").not.toMatch(/ATTESTATION_STRENGTH|\.strength\b|tier_withheld/);
  });

  it("the effect is REPORTED, so a run of STRANGERs is never mistaken for a data problem", () => {
    const p = planVendorBackfill({ lines: two(), signedMonths: SIGNED });
    expect(p.attestationMix).toEqual({ explicit: 0, implicit: 2 });
    expect(p.withheldByAmendmentB).toBe(1);
  });

  it("a vendor that fails Q1 anyway is NOT reported as an Amendment-B withholding", () => {
    const p = planVendorBackfill({ lines: [ln({ line_id: "a", date: "2026-01-10" })], signedMonths: SIGNED });
    expect(p.withheldByAmendmentB).toBe(0);
    expect(graduationPreview(p)[0].blocked_by).toMatch(/only 1 attested observation/);
  });
});
