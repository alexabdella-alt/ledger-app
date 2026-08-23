import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planVendorBackfill, graduationPreview, attestationStrengthFor, ATTESTATION_STRENGTH } from "../src/lib/vendorBackfill.js";
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
  line_id: "L1", descriptor: "SYSCO FOODS", date: "2026-01-15", account_id: "acct-cogs",
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
    const p = planVendorBackfill({ lines: [ln({ descriptor: "884213" })], signedMonths: SIGNED });
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
        ln({ line_id: "a", descriptor: "SQ *BLUEBONNET LINEN", date: "2026-01-05", account_id: "acct-linen", amount: 145 }),
        ln({ line_id: "b", descriptor: "ACH DEBIT BLUEBONNET LINEN", date: "2026-02-05", account_id: "acct-linen", amount: 150 }),
        ln({ line_id: "c", descriptor: "BLUEBONNET LINEN #12", date: "2026-03-05", account_id: "acct-linen", amount: 148 }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(1);
    expect(p.counts.graduating).toBe(1);
  });

  it("two genuinely different vendors stay two entities", () => {
    const p = planVendorBackfill({
      lines: [ln({ line_id: "a", descriptor: "SYSCO FOODS" }), ln({ line_id: "b", descriptor: "SYSCO FUEL", date: "2026-02-01" })],
      signedMonths: SIGNED,
    });
    expect(p.counts.entities).toBe(2);
  });
});

describe("★ the two live specimens, as the deploy would see them", () => {
  it("BLUEBONNET LINEN graduates KNOWN on two signed months", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "b1", descriptor: "BLUEBONNET LINEN", date: "2026-01-08", account_id: "acct-linen", amount: 145 }),
        ln({ line_id: "b2", descriptor: "BLUEBONNET LINEN", date: "2026-02-08", account_id: "acct-linen", amount: 150 }),
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
        ln({ line_id: "l1", descriptor: "TST* LONE STAR RESTAURANT SUPPLY", date: "2026-01-20", account_id: "acct-cogs", amount: 240 }),
        ln({ line_id: "l2", descriptor: "ACH DEBIT LONE STAR RESTAURANT SUPPLY", date: "2026-02-20", account_id: "acct-cogs", amount: 240 }),
      ],
      signedMonths: SIGNED, companyId: "co1",
    });
    expect(p.counts.entities).toBe(1);
    expect(p.rows[0].tier).toBe(VENDOR_TIER.KNOWN);
  });

  it("★ a vendor attested to TWO accounts does NOT graduate — and says why", () => {
    const p = planVendorBackfill({
      lines: [
        ln({ line_id: "x", descriptor: "AMBIGUOUS CO", date: "2026-01-02", account_id: "acct-a" }),
        ln({ line_id: "y", descriptor: "AMBIGUOUS CO", date: "2026-02-02", account_id: "acct-b" }),
      ],
      signedMonths: SIGNED,
    });
    expect(p.counts.graduating).toBe(0);
    expect(graduationPreview(p)[0].blocked_by).toMatch(/attested to 2 different accounts/);
  });

  it("a weekly vendor billing four times in ONE signed month does not graduate", () => {
    const lines = [5, 12, 19, 26].map((d) => ln({ line_id: `w${d}`, descriptor: "WEEKLY CO", date: `2026-01-${d}` }));
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
      ln({ line_id: "a", descriptor: "BLUEBONNET LINEN", date: "2026-01-08", account_id: "acct-linen", amount: 145, exception_resolved: true }),
      ln({ line_id: "b", descriptor: "BLUEBONNET LINEN", date: "2026-02-08", account_id: "acct-linen", amount: 150 }),
      ln({ line_id: "c", descriptor: "ONE HIT WONDER", date: "2026-01-09", account_id: "acct-x", amount: 50 }),
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
