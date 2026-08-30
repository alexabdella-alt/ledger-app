import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prefillEndingBalance } from "../src/lib/statementLifecycle.js";

// ═════════════════════════════════════════════════════════════════════════════
// "PREFILL THE ENDING BALANCE ON THE EXCEPTION PATH TOO" — checked, and already true.
//
// ★ THE ITEM WAS STALE, LIKE `O96`'s DEAD BUTTON. The prefill shipped (O86 (l)) and the
// exception card's target was repointed at Reconcile (O86 (k)) — separately, so nobody had
// traced the two together. The value survives all five hops.
//
// ★★ THE POINT OF PINNING IT AS A CHAIN RATHER THAN CLOSING THE ITEM ON A ONE-OFF READ:
// this is a value passing through five places, and **any one of them dropping it fails
// silently** — the field just renders empty and a CPA hand-types a number the system
// already holds, which is how a transposition error reaches a verified-balance check. The
// original defect was never "the prefill doesn't work"; it was "nobody can tell whether it
// does".
// ═════════════════════════════════════════════════════════════════════════════

const ROOT = process.cwd();
const app = fs.readFileSync(path.join(ROOT, "src/App.jsx"), "utf8");
const review = fs.readFileSync(path.join(ROOT, "src/components/views/ReviewView.jsx"), "utf8");
const recon = fs.readFileSync(path.join(ROOT, "src/components/views/ReconView.jsx"), "utf8");

describe("★★ the stated ending balance survives every hop to the field", () => {
  it("1 — the exceptions query asks for it", () => {
    expect(app).toMatch(/select\("id, source_filename, bank_account_id, period_start, period_end, stated_ending_balance"\)/);
  });

  it("2 — the exception object carries it", () => {
    expect(app).toMatch(/stated_ending_balance: s\.stated_ending_balance/);
  });

  it("3 — the Review card hands it to offerReconciliation", () => {
    expect(review).toMatch(/stated_ending_balance: x\.stated_ending_balance/);
  });

  it("4 — offerReconciliation puts it on the offer", () => {
    expect(app).toMatch(/statedEnding: statement\.stated_ending_balance != null/);
  });

  it("5 — ReconView prefills from the offer", () => {
    expect(recon).toMatch(/prefillEndingBalance\(\{ statement: \{ stated_ending_balance: reconcileOffer\.statedEnding \}/);
  });
});

describe("★ and the prefill itself behaves", () => {
  it("fills an empty field from the statement", () => {
    expect(prefillEndingBalance({ statement: { stated_ending_balance: 27762.31 }, current: "" })).toBe("27762.31");
  });

  it("★★ NEVER overwrites a number the CPA typed — it is their independent check", () => {
    // The field is prefilled so nobody transcribes a figure we already hold, NOT so the
    // reconciliation rubber-stamps itself. A typed value always wins.
    expect(prefillEndingBalance({ statement: { stated_ending_balance: 27762.31 }, current: "999.00" })).toBe(null);
  });

  it("says nothing rather than something wrong when there is no statement", () => {
    expect(prefillEndingBalance({ statement: null, current: "" })).toBe(null);
    expect(prefillEndingBalance({ statement: { stated_ending_balance: null }, current: "" })).toBe(null);
    expect(prefillEndingBalance({ statement: { stated_ending_balance: "not a number" }, current: "" })).toBe(null);
  });

  it("a zero balance is a real balance, not an absent one", () => {
    // `0` is falsy; a truthiness check here would silently refuse to prefill a genuinely
    // empty account.
    expect(prefillEndingBalance({ statement: { stated_ending_balance: 0 }, current: "" })).toBe("0");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// "RECONCILE READS SAVED STATEMENT LINES INSTEAD OF RE-READING THE FILE."
//
// ★ NARROWER THAN THE ITEM READS, once traced: the OFFERED route — from the pipeline or a
// Review card — has read saved lines since C185. **Only a MANUAL start still demanded the
// file**, and the saved statement was already being looked up on that very screen to
// prefill the balance. So at the exact moment it asked for an upload, it knew it was
// holding the statement and its parsed transactions.
//
// Live cost (O83): the operator uploaded the same statement THREE TIMES and hand-typed a
// closing balance the database already held.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ a manual reconcile offers the statement we already hold", () => {
  const view = fs.readFileSync(path.join(ROOT, "src/components/views/ReconView.jsx"), "utf8");

  it("the upload screen looks for a saved statement for the chosen account and month", () => {
    const block = view.slice(view.indexOf("We already have this statement") - 1200,
                             view.indexOf("We already have this statement") + 900);
    expect(block).toMatch(/statementForPeriod\(periodStatements, \{ accountId, periodStart, periodEnd \}\)/);
  });

  it("★★ and REUSES the offered route rather than growing a second one", () => {
    // `offerReconciliation` is the same call the Review card makes. A separate
    // "load a saved statement" path here would be a second implementation of loading,
    // prefilling and jumping to the match step — three places to drift.
    expect(view).toMatch(/offerReconciliation\(saved\)/);
  });

  it("★ it clears `offerTaken` first, or the second offer of a session is ignored", () => {
    // The offered-path effect guards on `offerTaken` so a single offer runs once. Without
    // resetting it, a CPA who has already taken one offer this session would click "Use it"
    // and watch nothing happen — the invisible-action defect, in the one place a user has
    // just been told we have their file.
    expect(view).toMatch(/setOfferTaken\(false\); offerReconciliation\(saved\)/);
  });

  it("shows nothing when there is no saved statement — it never implies one exists", () => {
    expect(view).toMatch(/if \(!saved \|\| !offerReconciliation\) return null;/);
  });
});
