import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planVendorBackfill, graduationPreview, attestationStrengthFor, rawDescriptorOf, ATTESTATION_STRENGTH } from "../src/lib/vendorBackfill.js";
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
  amount: 1200, deleted: false, exception_resolved: false, recoded: false, ...over,
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
    // Two IMPLICIT observations in two signed months still graduate — strength informs, never gates.
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", date: "2026-01-10" }), ln({ line_id: "b", date: "2026-02-10" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.graduating).toBe(1);
  });
});

describe("identity grouping uses the app's ONE implementation", () => {
  it("★ many rails, one vendor — the reason this is not a SQL migration", () => {
    // If the backfill grouped differently from the way the app resolves identity, it
    // would seed keys the app cannot look up: inert on arrival, and green.
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "a", descriptor: "Bluebonnet Linen – SQ *BLUEBONNET LINEN", date: "2026-01-05", account_id: "acct-linen", amount: 145 }),
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
        ln({ line_id: "b1", descriptor: "Bluebonnet Linen – BLUEBONNET LINEN", date: "2026-01-08", account_id: "acct-linen", amount: 145 }),
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
        ln({ line_id: "l1", descriptor: "Lone Star Restaurant Supply – TST* LONE STAR RESTAURANT SUPPLY", date: "2026-01-20", account_id: "acct-cogs", amount: 240 }),
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
      lines: [ln({ line_id: "a", date: "2026-02-05" }), ln({ line_id: "b", date: "2026-03-05" })],
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
    expect(src).toMatch(/import \{ entityKeyFor \} from "\.\/vendorIdentity\.js"/);
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
    expect(p.skipped.ambiguous_descriptor).toBe(1);
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
        ln({ line_id: "a", descriptor: "Lone Star – ACH DEBIT - LONE STAR RESTAURANT SUPPLY", date: "2026-01-20" }),
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
