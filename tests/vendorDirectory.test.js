import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { matchDirectory, directoryConflicts, DIRECTORY_SEED, DIRECTORY_EXCLUSIONS, MATCH_TYPE } from "../src/lib/vendorDirectory.js";
import { resolveVendorIdentity, MATCH_SOURCE } from "../src/lib/vendorIdentity.js";
import { DEFAULT_CHART_OF_ACCOUNTS } from "../src/lib/constants.js";

// Source-scanning guards must read CODE, not prose. Twice today a guard tripped on its
// own explanatory comment — the "explicit transitions" case in vendorTier, and the
// spec line "no fuzzy-match scores" quoted in vendorDirectory's own header. A guard
// that fails for a reason it does not mean is a guard nobody will trust, so strip
// comments first rather than writing a third cleverer regex.
const codeOnly = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|--)/.test(l)).join("\n");

// ═════════════════════════════════════════════════════════════════════════════
// C202 — the curated global directory.
//
// The directory is the ONE place in this design where a mapping is asserted without
// anybody at the company having attested it. That makes over-matching the failure
// that matters: a wrong hit books a stranger's charge to a curated account and flags
// it as a known vendor. So most of this file is anti-merge.
//
// The seed's first draft shipped TWO over-matches, both found by the probe below and
// neither by reading it. They are kept as named regression cases.
// ═════════════════════════════════════════════════════════════════════════════

describe("★ TOAST — the case that motivated the directory", () => {
  it("all three REAL descriptors resolve to one entity, across the month-name split", () => {
    // Identity resolution cannot merge these (`…FEES JAN` / `FEB` / `APRIL` normalise
    // to three keys) and must not learn to, because word-stripping would also eat
    // "Lone Star Restaurant SUPPLY". The directory resolves it by RECOGNITION instead.
    for (const d of ["ACH DEBIT - TOAST INC MERCHANT FEES JAN",
                     "ACH DEBIT - TOAST INC MERCHANT FEES FEB",
                     "TOAST MERCHANT FEES APRIL"]) {
      const hit = matchDirectory(d, DIRECTORY_SEED);
      expect(hit?.entity_key, d).toBe("toast");
      expect(hit?.default_account_role).toBe("merchant_processing_fees");
    }
  });

  it("Toast is the ONLY prefix entry — the looser rule is opt-in, not the default", () => {
    const prefix = DIRECTORY_SEED.filter((e) => e.match_type === MATCH_TYPE.PREFIX);
    expect(prefix.map((e) => e.entity_key)).toEqual(["toast"]);
  });
});

describe("★ CULINARY EDGE — the counter-case that must still park", () => {
  it("does not match, so it stays a STRANGER and books to Uncategorized", () => {
    expect(matchDirectory("ACH DEBIT - CULINARY EDGE CONSULTING LLC", DIRECTORY_SEED)).toBe(null);
  });

  it("the directory never invents a mapping for a vendor it does not carry", () => {
    for (const d of ["ACME WIDGET CO", "BLUEBONNET LINEN SERVICE", "FRANKLIN AVE PROPERTIES LP RENT"]) {
      expect(matchDirectory(d, DIRECTORY_SEED), d).toBe(null);
    }
  });
});

describe("★ ANTI-MERGE — the two defects the first seed draft shipped", () => {
  it("REGRESSION: `square inc` must not swallow SQUARE DANCE HALL", () => {
    // Cause: normalising a PATTERN strips legal suffixes, so a PREFIX pattern
    // `square inc` degraded to `square` and prefix-matched anything starting "square".
    expect(matchDirectory("SQUARE DANCE HALL", DIRECTORY_SEED)).toBe(null);
    expect(matchDirectory("SQUAREUP INC", DIRECTORY_SEED)?.entity_key).toBe("square");
  });

  it("REGRESSION: `sysco` must not swallow SYSCO FUEL", () => {
    // `tests/vendorIdentity.test.js` already asserts Sysco Foods and Sysco Fuel must
    // never merge. A PREFIX seed entry re-opened that door through the directory.
    expect(matchDirectory("SYSCO FUEL", DIRECTORY_SEED)).toBe(null);
    expect(matchDirectory("ACH DEBIT - SYSCO FOODS #4417", DIRECTORY_SEED)?.entity_key).toBe("sysco");
  });

  it("prefix matching is TOKEN-BOUNDARY safe — `toast` never matches `toaster`", () => {
    expect(matchDirectory("TOASTER SUPPLY CO", DIRECTORY_SEED)).toBe(null);
    expect(matchDirectory("AWSOME BAKERY", DIRECTORY_SEED)).toBe(null);
  });

  it("★ the seed contains NO ambiguous descriptor — two entries may not claim one string", () => {
    // A directory that answers "who is this?" two ways is worse than one that cannot
    // answer: the second parks and flags, the first books to whichever row came first.
    expect(directoryConflicts(DIRECTORY_SEED)).toEqual([]);
  });

  it("conflict detection actually detects — the check is not vacuous", () => {
    const rigged = [...DIRECTORY_SEED, { entity_key: "impostor", canonical_name: "Impostor",
      match_type: MATCH_TYPE.EXACT, match_patterns: ["stripe"], default_account_role: "cogs" }];
    expect(directoryConflicts(rigged).length).toBeGreaterThan(0);
  });
});

describe("the directory is BINARY — there is no score, and there must never be one", () => {
  it("returns an entry or null, never a ranking or a confidence", () => {
    const hit = matchDirectory("STRIPE", DIRECTORY_SEED);
    expect(hit).toBeTruthy();
    expect(Object.keys(hit)).not.toContain("score");
    expect(Object.keys(hit)).not.toContain("confidence");
    expect(matchDirectory("STRIPEY CO", DIRECTORY_SEED)).toBe(null);   // not 76% Stripe. Not Stripe.
  });

  it("the module contains no scoring vocabulary at all", () => {
    const src = codeOnly(fs.readFileSync(path.join(process.cwd(), "src/lib/vendorDirectory.js"), "utf8"));
    expect(src).not.toMatch(/similarity|levenshtein|fuzzy|\bscore\b|confidence/i);
  });

  it("an inactive entry is not matched", () => {
    const off = DIRECTORY_SEED.map((e) => (e.entity_key === "stripe" ? { ...e, active: false } : e));
    expect(matchDirectory("STRIPE", off)).toBe(null);
  });
});

describe("every curated mapping points at a role that exists", () => {
  it("★ no directory entry maps to a role the chart does not have", () => {
    // A mapping to a nonexistent role would resolve through the DEFAULT_BY_ROLE
    // fallback (O108 finding 4) and materialise an account — the directory quietly
    // creating chart entries on eleven companies at once.
    const roles = new Set(DEFAULT_CHART_OF_ACCOUNTS.map((a) => a.system_role));
    for (const e of DIRECTORY_SEED) {
      expect(roles.has(e.default_account_role), `${e.entity_key} → ${e.default_account_role}`).toBe(true);
    }
  });

  it("merchant_processing_fees exists — it was blessed by 068, and three entries need it", () => {
    expect(DEFAULT_CHART_OF_ACCOUNTS.some((a) => a.system_role === "merchant_processing_fees")).toBe(true);
    expect(DIRECTORY_SEED.filter((e) => e.default_account_role === "merchant_processing_fees")).toHaveLength(3);
  });
});

describe("the seed in code and the seed in migration 066 agree", () => {
  const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/066_universal_vendor_directory.sql"), "utf8");

  it("★ every entity_key and match_type matches — a drifted seed is the ·3b(f3) failure", () => {
    for (const e of DIRECTORY_SEED) {
      expect(sql, e.entity_key).toMatch(new RegExp(`'${e.entity_key}'`));
      const row = sql.split("\n").find((l) => l.includes(`'${e.entity_key}'`) && l.includes("array["));
      expect(row, `no seed row for ${e.entity_key}`).toBeTruthy();
      expect(row, `${e.entity_key} match_type`).toMatch(new RegExp(`'${e.match_type}'`));
      expect(row, `${e.entity_key} role`).toMatch(new RegExp(`'${e.default_account_role}'`));
    }
  });

  it("the migration seeds exactly as many rows as the code lists", () => {
    const rows = sql.split("\n").filter((l) => /^\s*\('[a-z ]+',\s*'/.test(l));
    expect(rows).toHaveLength(DIRECTORY_SEED.length);
  });

  it("the table is GLOBAL and its writes are platform-admin only", () => {
    // The DDL must carry no company_id — the header comment explains WHY it doesn't,
    // and the VERIFY block joins accounts on one, so both must be excluded from the scan.
    const ddl = codeOnly(sql);
    expect(ddl).not.toMatch(/company_id/);                       // deliberately not tenant-scoped
    expect(ddl).toMatch(/for select using \(auth\.uid\(\) is not null\)/);
    for (const cmd of ["insert", "update", "delete"]) {
      expect(ddl, cmd).toMatch(new RegExp(`for ${cmd}[\\s\\S]{0,80}is_platform_admin\\(\\)`));
    }
  });
});

describe("what the directory deliberately does NOT carry", () => {
  it("utilities and delivery platforms are excluded, each with a stated reason", () => {
    expect(matchDirectory("AUSTIN MUNICIPAL UTILITIES", DIRECTORY_SEED)).toBe(null);
    expect(matchDirectory("DOORDASH", DIRECTORY_SEED)).toBe(null);
    expect(DIRECTORY_EXCLUSIONS.utilities).toMatch(/no national utility/i);
    expect(DIRECTORY_EXCLUSIONS.delivery_platforms).toMatch(/contested/i);
  });
});

describe("resolveVendorIdentity uses the ONE matcher", () => {
  it("a directory hit reports matchedVia DIRECTORY", () => {
    const r = resolveVendorIdentity("ACH DEBIT - TOAST INC MERCHANT FEES JAN", { directory: DIRECTORY_SEED });
    expect(r.matchedVia).toBe(MATCH_SOURCE.DIRECTORY);
    expect(r.entityKey).toBe("toast");
  });

  it("company attestation still outranks the directory", () => {
    const r = resolveVendorIdentity("ACH DEBIT - TOAST INC MERCHANT FEES JAN", {
      aliases: [{ entityKey: "our toast account", descriptor: "ACH DEBIT - TOAST INC MERCHANT FEES JAN" }],
      directory: DIRECTORY_SEED,
    });
    expect(r.matchedVia).toBe(MATCH_SOURCE.ALIAS);
  });

  it("the legacy inline shape still works — no caller is broken by the rewire", () => {
    const r = resolveVendorIdentity("STRIPE PAYMENTS", { directory: [{ entityKey: "stripe", patterns: ["Stripe", "STRIPE PAYMENTS"] }] });
    expect(r.matchedVia).toBe(MATCH_SOURCE.DIRECTORY);
    expect(r.entityKey).toBe("stripe");
  });
});
