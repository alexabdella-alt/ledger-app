import { describe, it, expect } from "vitest";
import { sha256Hex, fileSha256Hex } from "../src/lib/contentHash.js";
import { planStatementSupersede, filterLiveExceptions, buildStatementRow } from "../src/lib/bankStatements.js";

// ════════════════════════════════════════════════════════════════════════════
// C193 — content-hash dedup + statement supersede (§11 O84 finding (d)).
// Live: the doc library held 3× March + 3× Feb of one statement, and Review showed
// 7 ZOMBIE exception cards from older statement rows already resolved on re-upload.
// ════════════════════════════════════════════════════════════════════════════

const bytes = (s) => new TextEncoder().encode(s);

describe("sha256Hex — deterministic content identity", () => {
  it("same bytes → same hash (the dedup guarantee)", async () => {
    const a = await sha256Hex(bytes("statement-march-2026"));
    const b = await sha256Hex(bytes("statement-march-2026"));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);        // lowercase hex SHA-256
  });
  it("different bytes → different hash", async () => {
    expect(await sha256Hex(bytes("march"))).not.toBe(await sha256Hex(bytes("february")));
  });
  it("matches the known SHA-256 of 'abc'", async () => {
    expect(await sha256Hex(bytes("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("null-safe: no bytes / no WebCrypto → null (means 'not deduped', never an error)", async () => {
    expect(await sha256Hex(null)).toBe(null);
    expect(await sha256Hex(bytes("x"), { subtle: null })).toBe(null);
  });
  it("a throwing subtle seam is swallowed → null", async () => {
    const subtle = { digest: () => { throw new Error("no crypto"); } };
    expect(await sha256Hex(bytes("x"), { subtle })).toBe(null);
  });
  it("fileSha256Hex reads a Blob's bytes and hashes them identically", async () => {
    const blob = new Blob([bytes("statement-march-2026")]);
    expect(await fileSha256Hex(blob)).toBe(await sha256Hex(bytes("statement-march-2026")));
  });
  it("fileSha256Hex null-safe on a non-file", async () => {
    expect(await fileSha256Hex(null)).toBe(null);
    expect(await fileSha256Hex({})).toBe(null);
  });
});

describe("buildStatementRow carries content_hash (omitted when null)", () => {
  it("includes content_hash when present", () => {
    expect(buildStatementRow({ companyId: "co1", contentHash: "abc123" }).content_hash).toBe("abc123");
  });
  it("omits the key entirely when null (pre-059 safe)", () => {
    expect("content_hash" in buildStatementRow({ companyId: "co1" })).toBe(false);
  });
});

describe("planStatementSupersede — newest wins per company+account+period group", () => {
  const row = (over) => ({ company_id: "co1", bank_account_id: "acc1", period_start: "2026-03-01", period_end: "2026-03-31", source_filename: "march.pdf", status: "complete", ...over });

  it("keeps the NEWEST by created_at; supersedes the older ones pointing at it", () => {
    const rows = [
      row({ id: "s1", created_at: "2026-08-01T10:00:00Z" }),
      row({ id: "s3", created_at: "2026-08-03T10:00:00Z" }),   // newest
      row({ id: "s2", created_at: "2026-08-02T10:00:00Z" }),
    ];
    const { keep, supersede } = planStatementSupersede(rows);
    expect(keep).toEqual(["s3"]);
    expect(supersede).toEqual([
      { id: "s2", supersededBy: "s3" },
      { id: "s1", supersededBy: "s3" },
    ]);
  });

  it("the live shape: 3× March + 3× Feb → 2 superseded per group, 2 kept", () => {
    const mar = [1, 2, 3].map((i) => row({ id: `m${i}`, created_at: `2026-08-0${i}T00:00:00Z` }));
    const feb = [1, 2, 3].map((i) => row({ id: `f${i}`, period_start: "2026-02-01", period_end: "2026-02-28", source_filename: "feb.pdf", created_at: `2026-08-0${i}T00:00:00Z` }));
    const { keep, supersede } = planStatementSupersede([...mar, ...feb]);
    expect(keep.sort()).toEqual(["f3", "m3"]);
    expect(supersede).toHaveLength(4);
    expect(supersede.every((s) => ["m3", "f3"].includes(s.supersededBy))).toBe(true);
  });

  it("NEVER merges across accounts or periods (item 7 — a wrong-account upload stays visible)", () => {
    const rows = [
      row({ id: "a", created_at: "2026-08-01T00:00:00Z" }),
      row({ id: "b", bank_account_id: "acc2", created_at: "2026-08-02T00:00:00Z" }),  // different account
      row({ id: "c", period_start: "2026-04-01", period_end: "2026-04-30", created_at: "2026-08-03T00:00:00Z" }), // different period
    ];
    const { keep, supersede } = planStatementSupersede(rows);
    expect(keep.sort()).toEqual(["a", "b", "c"]);   // three separate groups
    expect(supersede).toEqual([]);
  });

  it("id is the deterministic tie-break when created_at ties", () => {
    const rows = [row({ id: "aaa", created_at: "2026-08-01T00:00:00Z" }), row({ id: "zzz", created_at: "2026-08-01T00:00:00Z" })];
    expect(planStatementSupersede(rows).keep).toEqual(["zzz"]);
  });

  it("already-superseded rows are left alone (idempotent re-run)", () => {
    const rows = [
      row({ id: "old", created_at: "2026-08-01T00:00:00Z", status: "superseded" }),
      row({ id: "new", created_at: "2026-08-02T00:00:00Z" }),
    ];
    expect(planStatementSupersede(rows).supersede).toEqual([]);
  });

  it("empty input → empty plan", () => {
    expect(planStatementSupersede([])).toEqual({ keep: [], supersede: [] });
  });
});

describe("filterLiveExceptions — zombie cards from superseded parents are hidden", () => {
  const lineItems = [
    { id: "sxl_1", statement_id: "old", title: "Roma" },
    { id: "sxl_2", statement_id: "new", title: "Hill Country" },
  ];
  const stmtItems = [
    { id: "sxs_old", statement_id: "old", title: "march.pdf" },
    { id: "sxs_new", statement_id: "new", title: "march.pdf" },
  ];

  it("drops exception cards whose parent statement is superseded", () => {
    const live = filterLiveExceptions({ lineItems, stmtItems, supersededIds: ["old"] });
    expect(live.lineItems.map((x) => x.id)).toEqual(["sxl_2"]);
    expect(live.stmtItems.map((x) => x.id)).toEqual(["sxs_new"]);
  });

  it("the 7-zombie live shape: all cards from retired uploads vanish, live ones remain", () => {
    const zombies = Array.from({ length: 7 }, (_, i) => ({ id: `z${i}`, statement_id: "old" }));
    const liveOne = { id: "keep", statement_id: "new" };
    const out = filterLiveExceptions({ lineItems: [...zombies, liveOne], supersededIds: ["old"] });
    expect(out.lineItems).toEqual([liveOne]);
  });

  it("no superseded ids → nothing filtered (regression guard)", () => {
    const live = filterLiveExceptions({ lineItems, stmtItems, supersededIds: [] });
    expect(live.lineItems).toHaveLength(2);
    expect(live.stmtItems).toHaveLength(2);
  });
});
