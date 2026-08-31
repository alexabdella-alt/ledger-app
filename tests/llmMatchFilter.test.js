import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { DROP_REASON, planLlmMatches } from "../src/lib/llmMatchFilter";

const open = [
  { id: "i1", vendor: "Roma Cheese", amount: 551.2, gl_code: "2000", date: "2026-08-01" },
  { id: "i2", vendor: "Hill Country", amount: 388.75, gl_code: "2000", date: "2026-08-02" },
];
const txns = [{ id: "b1", amount: -551.2, vendor: "ROMA CHEESE" }, { id: "b2", amount: -388.75, vendor: "HILL COUNTRY" }];
const plan = (matches, deterministic = []) => planLlmMatches({
  matches, deterministic, openUniverse: open, bankTxns: txns,
  id: (n) => `m${n}`, createdAt: "2026-08-30T00:00:00.000Z",
});
const M = (o) => ({ bank_txn_id: "b1", invoice_ids: ["i1"], match_type: "ap_clear", confidence: 90, auto_clear: true, ...o });

describe("what the model proposes, and what we accept", () => {
  it("a good proposal is accepted", () => {
    const r = plan([M({})]);
    expect(r.autoCleared.length).toBe(1);
    expect(r.autoCleared[0].matched_invoices.length).toBe(1);
    expect(r.dropped).toEqual([]);
  });

  it("auto_clear false goes to the queue for a person, not to booking", () => {
    const r = plan([M({ auto_clear: false })]);
    expect(r.autoCleared.length).toBe(0);
    expect(r.queue.length).toBe(1);
  });

  it("★ deterministic matches always stand, and are never re-proposed", () => {
    const det = [{ bank_txn_id: "b1", invoice_ids: ["i1"], match_type: "ap_clear" }];
    const r = plan([M({})], det);
    expect(r.autoCleared.length).toBe(1);             // the deterministic one only
    expect(r.dropped[0].reason).toBe(DROP_REASON.BANK_LINE_TAKEN);
    expect(r.deterministicCount).toBe(1);
    expect(r.llmCount).toBe(0);
  });

  it("★ an open item already claimed cannot be claimed again", () => {
    const det = [{ bank_txn_id: "bX", invoice_ids: ["i1"], match_type: "ap_clear" }];
    const r = plan([M({ bank_txn_id: "b2", invoice_ids: ["i1"] })], det);
    expect(r.dropped[0].reason).toBe(DROP_REASON.ITEMS_TAKEN);
  });

  it("★★ a proposal whose counterpart cannot be shown is REFUSED — O83's empty 'matching against' panel", () => {
    // A 99%-confidence exact-amount proposal once rendered an empty panel, asking a person to
    // confirm a match against an entity they could not see. A proposal nobody can look at is
    // not a proposal.
    const r = plan([M({ invoice_ids: ["ghost"] })]);
    expect(r.autoCleared.length).toBe(0);
    expect(r.dropped[0].reason).toBe(DROP_REASON.COUNTERPART_UNRENDERABLE);
  });

  it("the model saying no_match is recorded, not silently skipped", () => {
    const r = plan([M({ match_type: "no_match" })]);
    expect(r.dropped[0].reason).toBe(DROP_REASON.NO_MATCH);
  });
});

describe("★★★ the deliberate behaviour change: one bank line, one clearing", () => {
  it("two proposals naming the SAME bank line — the second is refused", () => {
    // The old loop never added an accepted line to the handled set, so both were accepted —
    // and autoCleared feeds planBankImport, so that clears the same money twice. Splitting a
    // line across proposals is not how partials are modelled here (amount_remaining lives
    // INSIDE a match), so a second proposal for a taken line is a model error.
    const r = plan([M({ invoice_ids: ["i1"] }), M({ invoice_ids: ["i2"] })]);
    expect(r.autoCleared.length).toBe(1);
    expect(r.dropped.length).toBe(1);
    expect(r.dropped[0].reason).toBe(DROP_REASON.BANK_LINE_TAKEN);
  });

  it("and two proposals naming the same OPEN ITEM — the second is refused too", () => {
    const r = plan([M({ bank_txn_id: "b1", invoice_ids: ["i1"] }), M({ bank_txn_id: "b2", invoice_ids: ["i1"] })]);
    expect(r.autoCleared.length).toBe(1);
    expect(r.dropped[0].reason).toBe(DROP_REASON.ITEMS_TAKEN);
  });

  it("★ but two proposals on DIFFERENT lines and items both stand — the guard must not block real work", () => {
    const r = plan([M({ bank_txn_id: "b1", invoice_ids: ["i1"] }), M({ bank_txn_id: "b2", invoice_ids: ["i2"] })]);
    expect(r.autoCleared.length).toBe(2);
    expect(r.dropped).toEqual([]);
  });
});

describe("it decides and does nothing else", () => {
  it("★ pure — same proposals, same records", () => {
    expect(JSON.stringify(plan([M({})]))).toBe(JSON.stringify(plan([M({})])));
  });

  it("★★ no clock, no randomness, no client, no booking", () => {
    const src = readFileSync("src/lib/llmMatchFilter.js", "utf8")
      .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    for (const f of ["Date.now", "Math.random", "new Date()", "supabase", "post_journal_entry", "persistJournalEntry", "bookToDb"]) {
      expect(src).not.toContain(f);
    }
  });

  it("empty input is an empty result, not a throw", () => {
    expect(planLlmMatches({}).autoCleared).toEqual([]);
    expect(planLlmMatches({ matches: [null, undefined] }).autoCleared).toEqual([]);
  });
});
