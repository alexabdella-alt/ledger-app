import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { canAttestPeriod, companyHasAttester } from "../src/lib/signoff";
import { ownerTrustState } from "../src/lib/ownerTrust";

const OWNER = { role: "owner", accepted_at: "2026-01-01" };
const ACCOUNTANT = { role: "accountant", accepted_at: "2026-01-01" };
const ADMIN = { role: "admin", accepted_at: "2026-01-01" };
const VIEWER = { role: "viewer", accepted_at: "2026-01-01" };

describe("O131 — who can actually sign a month off", () => {
  it("★ a solo owner's company has nobody who can — which is the whole finding", () => {
    expect(companyHasAttester([OWNER])).toBe(false);
    expect(canAttestPeriod("owner")).toBe(false);
  });

  it("an admin or an accountant counts; a viewer does not", () => {
    expect(companyHasAttester([OWNER, ACCOUNTANT])).toBe(true);
    expect(companyHasAttester([OWNER, ADMIN])).toBe(true);
    expect(companyHasAttester([OWNER, VIEWER])).toBe(false);
  });

  it("★ an UNACCEPTED invite is not a person — otherwise the promise returns with an extra step", () => {
    expect(companyHasAttester([OWNER, { role: "accountant", accepted_at: null }])).toBe(false);
  });

  it("an empty or malformed list is not an attester", () => {
    expect(companyHasAttester([])).toBe(false);
    expect(companyHasAttester([null, undefined, {}])).toBe(false);
    expect(companyHasAttester()).toBe(false);
  });
});

describe("O131 — the panel stops promising a review that cannot arrive", () => {
  const base = { controlTotals: { failed: [], allTie: true }, hasBooks: true, setupComplete: true };
  const lineFor = (over) => {
    const st = ownerTrustState({ ...base, ...over });
    return (st.lines.reviewed && (st.lines.reviewed.text || st.lines.reviewed)) || "";
  };

  it("★ a solo owner is told the position and the one thing that changes it", () => {
    const text = String(lineFor({ hasAttester: false, reviewedThrough: null }));
    expect(text).toMatch(/add your accountant/i);
    expect(text).not.toMatch(/awaiting your accountant/i);
  });

  it("★★ and it does NOT imply the books are wrong — nobody has reviewed them is a different fact", () => {
    const text = String(lineFor({ hasAttester: false, reviewedThrough: null }));
    expect(text).not.toMatch(/wrong|error|problem|incorrect|unreviewed risk/i);
  });

  it("★ an accountant-led company is untouched — without this, the fix is just deleting a sentence", () => {
    expect(String(lineFor({ hasAttester: true, reviewedThrough: null }))).toMatch(/awaiting your accountant/i);
  });

  it("★ the default is the OLD sentence, so a caller that has not checked cannot accidentally claim you have no accountant", () => {
    expect(String(lineFor({ reviewedThrough: null }))).toMatch(/awaiting your accountant/i);
  });

  it("what IS signed stays a fact even with no attester left", () => {
    // A company whose accountant has gone still genuinely had those months reviewed.
    expect(String(lineFor({ hasAttester: false, reviewedThrough: "2026-03" }))).toMatch(/signed off through/i);
  });
});

describe("the failure direction is pinned in the caller", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const code = app.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("★★ a FAILED membership query must not be read as 'you have no accountant'", () => {
    const at = code.indexOf("companyHasAttester(mem.data)");
    expect(at).toBeGreaterThan(-1);
    const around = code.slice(at - 200, at + 120);
    expect(around).toContain("!mem.error");                 // the error is checked…
    expect(code.slice(at, at + 160)).toContain("setHasAttester(true)");  // …and doubt keeps the old sentence
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C272 — the operator's decision: a solo owner MAY sign, with an acknowledgement.
// ─────────────────────────────────────────────────────────────────────────────
import { canSelfAttest, selfAttestAcknowledgement } from "../src/lib/signoff";
import { isReviewerSeat } from "../src/lib/nav";

describe("O131 — the solo exception is conditional, and it is not a promotion", () => {
  it("★ a solo owner may self-attest", () => {
    expect(canSelfAttest({ role: "owner", hasAttester: false })).toBe(true);
  });

  it("★★ and the SEPARATION STILL HOLDS the moment anyone else can sign — the product's whole point", () => {
    expect(canSelfAttest({ role: "owner", hasAttester: true })).toBe(false);
  });

  it("nobody else gains anything from it", () => {
    expect(canSelfAttest({ role: "viewer", hasAttester: false })).toBe(false);
    expect(canSelfAttest({ role: "accountant", hasAttester: false })).toBe(false);
    expect(canSelfAttest({})).toBe(false);            // defaults must not grant
  });

  it("★★★ THE OWNER GETS THE ACTION, NOT THE CPA COCKPIT — canAttestPeriod is deliberately unchanged", () => {
    // Widening canAttestPeriod would have been the one-line fix and would have dropped a
    // client into the ten-tab reviewer workbench, which is the IA the product keeps them out of.
    expect(canAttestPeriod("owner")).toBe(false);
    expect(isReviewerSeat({ role: "owner" })).toBe(false);
  });

  it("the acknowledgement states BOTH non-obvious facts: nobody checked, and the month locks", () => {
    const text = selfAttestAcknowledgement("March 2026");
    expect(text).toMatch(/March 2026/);
    expect(text).toMatch(/no accountant/i);
    expect(text).toMatch(/can't be changed|cannot be changed/i);
    expect(text).toMatch(/reopen/i);
  });

  it("the acknowledgement survives a missing month label rather than saying 'undefined'", () => {
    expect(selfAttestAcknowledgement(null)).not.toMatch(/undefined|null/);
  });
});

describe("O131 — a self-signed month is not reported as an accountant's review", () => {
  const base = { controlTotals: { failed: [], allTie: true }, hasBooks: true, setupComplete: true };
  const lineFor = (over) => String(ownerTrustState({ ...base, ...over }).lines.reviewed.text || "");

  it("★★ says WHO signed it — the whole value of a sign-off is who stood behind it", () => {
    const t = lineFor({ reviewedThrough: "2026-03", selfSigned: true, hasAttester: false });
    expect(t).toMatch(/yourself/i);
    expect(t).toMatch(/no accountant has reviewed/i);
  });

  it("★ and a real review still reads as one — without this, the fix is just relabelling everything", () => {
    const t = lineFor({ reviewedThrough: "2026-03", selfSigned: false, hasAttester: true });
    expect(t).toMatch(/Reviewed and signed off through/i);
    expect(t).not.toMatch(/yourself/i);
  });

  it("the unsigned solo line now offers BOTH routes, since signing is one of them", () => {
    const t = lineFor({ reviewedThrough: null, hasAttester: false });
    expect(t).toMatch(/sign them off yourself/i);
    expect(t).toMatch(/add your accountant/i);
  });
});

describe("the write path enforces it rather than trusting the screen", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const code = app.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const start = code.indexOf("const signOffPeriod = async");
  const fn = code.slice(start, code.indexOf("const reopenPeriod", start));

  it("★ signOffPeriod refuses a self-attestation without the acknowledgement", () => {
    expect(start).toBeGreaterThan(-1);
    expect(fn.length).toBeGreaterThan(200);
    expect(fn).toMatch(/selfAttesting && !acknowledged/);
  });

  it("★ and it records WHICH path was taken on the row, not alongside it", () => {
    expect(fn).toMatch(/selfAttested: selfAttesting/);
    expect(fn).toMatch(/self_attested: selfAttesting/);   // the audit row too
  });

  it("★★ the migration makes the flag un-lieable — the policy decides, not the client", () => {
    const sql = readFileSync("supabase/migrations/085_solo_owner_self_attestation.sql", "utf8");
    // A row marked self_attested is only accepted from a solo owner; one not marked, only
    // from a reviewer. Without the CASE an owner could record an accountant's review.
    expect(sql).toMatch(/when self_attested then public\.is_company_solo_owner\(company_id\)/);
    expect(sql).toMatch(/else public\.is_company_reviewer\(company_id\)/);
    // and an unaccepted invite must not count as a person who could review
    expect(sql).toMatch(/accepted_at is not null[\s\S]{0,200}role in \('admin', 'accountant'\)/);
  });
});
