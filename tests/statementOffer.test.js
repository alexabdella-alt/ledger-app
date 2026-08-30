import { describe, it, expect } from "vitest";
import { statementOfferCopy, statementToOffer } from "../src/lib/statementLifecycle";

const stmt = (o) => ({ id: "s1", bank_account_id: "acct1", status: "complete", period_start: "2026-01-01", period_end: "2026-01-31", created_at: "2026-02-01", ...o });

describe("Reconcile should not ask for a statement it already holds", () => {
  it("★ offers the account's statement", () => {
    expect(statementToOffer({ statements: [stmt({})], accountId: "acct1", reconciliations: [] })?.id).toBe("s1");
  });

  it("★★ but NOT one a completed reconciliation already covers — that would invite redoing a finished month", () => {
    const recs = [{ account_id: "acct1", status: "complete", period_start: "2026-01-01", period_end: "2026-01-31" }];
    expect(statementToOffer({ statements: [stmt({})], accountId: "acct1", reconciliations: recs })).toBe(null);
  });

  it("never offers another account's statement", () => {
    expect(statementToOffer({ statements: [stmt({ bank_account_id: "other" })], accountId: "acct1", reconciliations: [] })).toBe(null);
  });

  it("never offers a superseded statement — its lines were resolved on a newer upload", () => {
    expect(statementToOffer({ statements: [stmt({ status: "superseded" })], accountId: "acct1", reconciliations: [] })).toBe(null);
  });

  it("a manual session has no statement to offer", () => {
    expect(statementToOffer({ statements: [stmt({})], accountId: "manual", reconciliations: [] })).toBe(null);
    expect(statementToOffer({ statements: [stmt({})], accountId: null, reconciliations: [] })).toBe(null);
  });

  it("★ picks the latest PERIOD, not the latest upload — the month you mean to do next", () => {
    const older = stmt({ id: "old", period_start: "2025-12-01", period_end: "2025-12-31", created_at: "2026-09-09" });
    const newer = stmt({ id: "new", period_start: "2026-01-01", period_end: "2026-01-31", created_at: "2026-02-01" });
    expect(statementToOffer({ statements: [older, newer], accountId: "acct1", reconciliations: [] })?.id).toBe("new");
  });

  it("nothing to offer is a real answer — that is what the upload zone is for", () => {
    expect(statementToOffer({ statements: [], accountId: "acct1", reconciliations: [] })).toBe(null);
    expect(statementToOffer({})).toBe(null);
  });
});

describe("the offer copy names what it is offering", () => {
  it("★ says the month and the count, because 'use the one we have' without which one asks for blind trust", () => {
    const t = statementOfferCopy({ statement: stmt({}), lineCount: 21, monthLabelText: "January 2026" });
    expect(t).toMatch(/January 2026/);
    expect(t).toMatch(/21 transactions/);
  });

  it("★★ and NEVER invents a count — the number is the whole reason to trust the offer", () => {
    const t = statementOfferCopy({ statement: stmt({}), lineCount: null, monthLabelText: "January 2026" });
    expect(t).not.toMatch(/\d+ transaction/);
    expect(t).not.toMatch(/null|undefined|NaN/);
    expect(statementOfferCopy({ statement: stmt({}), lineCount: 0, monthLabelText: "January 2026" })).not.toMatch(/0 transaction/);
  });

  it("no statement, no sentence", () => {
    expect(statementOfferCopy({ statement: null })).toBe(null);
  });

  it("uses no accounting vocabulary — the standing zero-knowledge directive", () => {
    const t = statementOfferCopy({ statement: stmt({}), lineCount: 21, monthLabelText: "January 2026" });
    expect(t).not.toMatch(/reconcil|ledger|journal|debit|credit|GL/i);
  });
});
