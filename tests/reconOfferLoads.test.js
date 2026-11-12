import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C628 — review finding K7: "use the statement we already have" never loaded; auto-match ran
// against the old month.
const v = readFileSync("src/components/views/ReconView.jsx", "utf8");
const eff = v.slice(v.indexOf("const offerTakenRef = React.useRef(false);"), v.indexOf("// (l) — the same prefill for a session started by hand"));

describe("the offered statement loads", () => {
  it("★ 'taken' is a ref, so marking it does not re-run (and cancel) the load", () => {
    expect(v).not.toMatch(/const \[offerTaken, setOfferTaken\]/);
    expect(eff).toMatch(/offerTakenRef\.current = true;/);
    expect(eff).toMatch(/\}, \[reconcileOffer, currentCompany\?\.id\]\);/);
    expect(eff).not.toMatch(/offerTaken\]/);
  });

  it("★ auto-match is given the offered month and account, not the closure's", () => {
    expect(v).toMatch(/const runAutoMatch = \(txns, \{ from = periodStart, to = periodEnd, cashCodes = reconCashCodes \} = \{\}\) => \{\s*\n\s*const books = reconBooksSet\(invoices, \{ cashCodes, from, to \}\);/);
    expect(eff).toMatch(/runAutoMatch\(rows, \{ from: reconcileOffer\.periodStart \|\| periodStart, to: reconcileOffer\.periodEnd \|\| periodEnd, cashCodes: offCodes \}\)/);
    expect(v).toMatch(/runAutoMatch\(rows, \{ from: offeredStatement\.period_start \|\| periodStart, to: offeredStatement\.period_end \|\| periodEnd \}\)/);
  });

  it("the re-offer button resets the ref", () => {
    expect(v).toMatch(/offerTakenRef\.current = false; offerReconciliation\(saved\);/);
  });
});
