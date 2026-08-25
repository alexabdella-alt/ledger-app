import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { planShadowRun, shadowRecordForLine, proposeAccount } from "../src/lib/shadowRun.js";
import { VENDOR_TIER } from "../src/lib/vendorTier.js";
import { DIRECTORY_SEED } from "../src/lib/vendorDirectory.js";

// ═════════════════════════════════════════════════════════════════════════════
// C201 — the shadow executor.
//
// Amendment A §0 requires shadow mode to BOOK NOTHING. "We were careful" is not a
// mechanism, so the mechanism is that the booking vocabulary is not reachable from
// this module — asserted below by name, the way calibrationShadow.js asserts it by
// having no imports at all.
//
// The rest of the file is the ladder's actual behaviour on the Franklin Ave shapes:
// Toast now recognised, Culinary Edge still parked, and every park explained.
// ═════════════════════════════════════════════════════════════════════════════

const SIGNED = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"];
const ACCT_ROLE = { "acct-cogs": "cogs", "acct-mpf": "merchant_processing_fees", "acct-linen": "office_supplies" };
const BY_ROLE = { cogs: "acct-cogs", merchant_processing_fees: "acct-mpf" };

const line = (over = {}) => ({
  line_id: "L1", descriptor: "Roma Cheese & Dairy Co – ACH DEBIT - ROMA CHEESE & DAIRY CO",
  date: "2026-03-03", account_id: "acct-cogs", amount: 534.8,
  deleted: false, source: "bank_import", ...over,
});
const ctx = (over = {}) => ({
  companyId: "co1", runId: "run1", directory: DIRECTORY_SEED,
  companyAccountsByRole: BY_ROLE, accountRoleById: ACCT_ROLE, vendorStates: {}, ...over,
});

describe("★★ the executor is structurally incapable of booking", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/shadowRun.js"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("performs NO I/O — no client, no fetch, no audit", () => {
    expect(code).not.toMatch(/supabase|fetch\(|logAudit|createClient/);
  });

  it("★ no booking primitive is reachable by name", () => {
    for (const forbidden of ["persistJournalEntry", "persistMultiLineEntry", "post_journal_entry",
                             "bookToDb", "buildJournalEntry", "buildAccountInsert", "ensureAccount",
                             "markBillPaid", "checkedRowUpdate"]) {
      expect(code, forbidden).not.toMatch(new RegExp(forbidden));
    }
  });

  it("imports ONLY the pure calibration modules", () => {
    const imports = (src.match(/^import .* from "([^"]+)";$/gm) || []).map((l) => l.match(/from "([^"]+)"/)[1]);
    expect(imports.sort()).toEqual([
      "./calibrationShadow.js", "./payroll.js", "./vendorDirectory.js", "./vendorIdentity.js", "./vendorTier.js",
    ]);
  });

  it("returns rows and counts — never an instruction", () => {
    const out = planShadowRun({ lines: [line()], signedMonths: SIGNED, ...ctx() });
    expect(Object.keys(out).sort()).toEqual(
      ["counts", "excluded", "excludedBy", "identityMix", "parkBasis", "rows", "scored", "tierMix"],
    );
  });
});

describe("proposeAccount — Rule 2, mapping comes from knowledge or not at all", () => {
  it("KNOWN and DECLARED propose the ATTESTED account", () => {
    for (const tier of [VENDOR_TIER.KNOWN, VENDOR_TIER.DECLARED]) {
      expect(proposeAccount({ tier, state: { attested_account_id: "acct-cogs" } }))
        .toEqual({ proposed_account_id: "acct-cogs", basis: "attested" });
    }
  });

  it("UNIVERSAL proposes the directory default, resolved in THIS company's chart", () => {
    expect(proposeAccount({ tier: VENDOR_TIER.UNIVERSAL,
      directoryHit: { default_account_role: "merchant_processing_fees" }, companyAccountsByRole: BY_ROLE }))
      .toEqual({ proposed_account_id: "acct-mpf", basis: "directory_default" });
  });

  it("★ a directory role the company's chart LACKS parks — it does not fall back", () => {
    // The `useAccounts` DEFAULT_BY_ROLE fallback (O108 finding 4) would return a
    // plausible account for a role the company does not have, and `ensureAccount` would
    // then MATERIALISE it. A shadow run reaching that path would create accounts on
    // eleven companies while claiming to book nothing.
    expect(proposeAccount({ tier: VENDOR_TIER.UNIVERSAL,
      directoryHit: { default_account_role: "some_role_nobody_has" }, companyAccountsByRole: BY_ROLE }))
      .toEqual({ proposed_account_id: null, basis: "directory_role_absent_from_chart" });
  });

  it("★ STRANGER never proposes an account, at any amount", () => {
    expect(proposeAccount({ tier: VENDOR_TIER.STRANGER, companyAccountsByRole: BY_ROLE }))
      .toEqual({ proposed_account_id: null, basis: "stranger" });
  });

  it("KNOWN with no attested mapping parks rather than guessing", () => {
    expect(proposeAccount({ tier: VENDOR_TIER.KNOWN, state: {} }).basis).toBe("no_attested_mapping");
  });
});

describe("★ the Franklin Ave shapes, end to end", () => {
  it("★ TOAST is recognised by the directory and proposes merchant processing fees", () => {
    const r = shadowRecordForLine(
      line({ line_id: "T1", descriptor: "Toast Inc – ACH DEBIT - TOAST INC MERCHANT FEES JAN",
             date: "2026-01-28", account_id: "acct-mpf", month_attested: true, bank_sourced: true }),
      ctx(),
    );
    expect(r.tier).toBe(VENDOR_TIER.UNIVERSAL);
    expect(r.entity_key).toBe("toast merchant fees jan");   // identity still splits…
    expect(r.proposed_account_id).toBe("acct-mpf");          // …and the DIRECTORY still recognises it
    expect(r.verdict).toBe("agree");
  });

  it("★ CULINARY EDGE is a STRANGER, parks, and is scored as a park — not a failure", () => {
    const r = shadowRecordForLine(
      line({ line_id: "C1", descriptor: "Culinary Edge Consulting LLC – ACH DEBIT - CULINARY EDGE CONSULTING LLC",
             date: "2026-04-14", account_id: "acct-cogs", month_attested: true, bank_sourced: true }),
      ctx(),
    );
    expect(r.tier).toBe(VENDOR_TIER.STRANGER);
    expect(r.proposed_account_id).toBe(null);
    expect(r.verdict).toBe("park");
  });

  it("★ a KNOWN vendor whose attested account differs is a DISAGREE, itemisable", () => {
    const r = shadowRecordForLine(
      line({ line_id: "D1", account_id: "acct-linen", month_attested: true, bank_sourced: true }),
      ctx({ vendorStates: { "roma cheese and dairy": { tier: VENDOR_TIER.KNOWN, attested_account_id: "acct-cogs" } } }),
    );
    expect(r.verdict).toBe("disagree");
    expect(r.proposed_account_id).toBe("acct-cogs");
    expect(r.attested_account_id).toBe("acct-linen");
  });

  it("★ NO PHANTOM IS POSSIBLE FROM THIS EXECUTOR — a STRANGER cannot name an account", () => {
    // §4.1(1) makes one phantom an automatic fail. The executor cannot produce one,
    // because proposeAccount returns null for STRANGER unconditionally.
    const rows = ["ACME WIDGET CO", "TOTALLY UNKNOWN LLC", "SOMEBODY ELSE INC"].map((d, i) =>
      shadowRecordForLine(line({ line_id: `S${i}`, descriptor: `X – ${d}`, month_attested: true, bank_sourced: true }), ctx()));
    expect(rows.every((r) => r.tier === VENDOR_TIER.STRANGER)).toBe(true);
    expect(rows.every((r) => r.verdict === "park")).toBe(true);
    expect(rows.some((r) => r.verdict === "phantom")).toBe(false);
  });
});

describe("exclusions are recorded, and a row is SCORED xor EXCLUDED", () => {
  it("every row has exactly one of verdict / excluded_reason — the 072 invariant", () => {
    const out = planShadowRun({
      lines: [line(), line({ line_id: "d", deleted: true }), line({ line_id: "u", date: "2026-09-01" }),
              line({ line_id: "p", source: "payroll", descriptor: "Gusto Payroll — 2026-02-28 – 2026-03-13" })],
      signedMonths: SIGNED, ...ctx(),
    });
    for (const r of out.rows) {
      expect(Boolean(r.verdict) !== Boolean(r.excluded_reason), JSON.stringify(r.excluded_reason)).toBe(true);
    }
  });

  it("names each exclusion and counts it", () => {
    const out = planShadowRun({
      lines: [line({ line_id: "d", deleted: true }), line({ line_id: "u", date: "2026-09-01" }),
              line({ line_id: "g", descriptor: "Gusto Payroll – GUSTO PAYROLL 011526" })],
      signedMonths: SIGNED, ...ctx(),
    });
    expect(out.excludedBy).toMatchObject({ entry_deleted: 1, unattested_month: 1, payroll_bank_line: 1 });
    expect(out.scored).toBe(0);
  });

  it("★ a line booked to a role-less account is excluded — the answer key is questionable", () => {
    const r = shadowRecordForLine(
      line({ line_id: "R1", account_id: "acct-orphan", month_attested: true, bank_sourced: true }), ctx());
    expect(r.excluded_reason).toBe("runtime_account");
  });
});

describe("the report explains itself", () => {
  it("★ every park is attributed to a BASIS — a park rate without reasons is unactionable", () => {
    const out = planShadowRun({
      lines: [line({ line_id: "s1", descriptor: "X – ACME WIDGET CO" }),
              line({ line_id: "s2", descriptor: "Y – ANOTHER UNKNOWN CO" })],
      signedMonths: SIGNED, ...ctx(),
    });
    expect(out.counts.park).toBe(2);
    expect(out.parkBasis).toEqual({ stranger: 2 });
  });

  it("reports the identity and tier mix, so a run resting on READ identities shows it", () => {
    const out = planShadowRun({
      lines: [line({ line_id: "b" }), line({ line_id: "i", source: "universal_upload", descriptor: "Roma Cheese & Dairy Co. – Cheese" })],
      signedMonths: SIGNED, ...ctx(),
    });
    expect(out.identityMix).toEqual({ resolved: 1, read: 1 });
    expect(out.tierMix).toBeTruthy();
  });

  it("resolver_input is stored beside the display string, and they DIFFER", () => {
    const out = planShadowRun({ lines: [line()], signedMonths: SIGNED, ...ctx() });
    const [r] = out.rows;
    expect(r.descriptor_display).toMatch(/^Roma Cheese & Dairy Co – /);
    expect(r.resolver_input).toBe("ACH DEBIT - ROMA CHEESE & DAIRY CO");
    expect(r.resolver_input).not.toBe(r.descriptor_display);
  });
});
