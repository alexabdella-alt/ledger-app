import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { canCompleteReconciliation, reconcileReadinessCopy, reconcileDifference } from "../src/lib/reconcile";

// C594 — review finding K1: Reconcile could be completed with bank lines not in the books.
describe("a reconciliation completes only when every bank line is in the books", () => {
  // Statement says $1,000. Books say $1,045. Three bank fees of $15 are not in the books.
  const difference = reconcileDifference({ statementBalance: 1000, booksBalance: 1045, outstandingSigned: 0, unmatchedBankSigned: -45 });

  it("★ the difference alone reads $0.00 — which is why it could not be the only test", () => {
    expect(difference).toBe(0);
    expect(canCompleteReconciliation({ statementBalance: "1000", difference })).toBe(true);   // the old call
  });

  it("★ with the unbooked lines counted, it cannot complete", () => {
    expect(canCompleteReconciliation({ statementBalance: "1000", difference, unbookedBankLines: 3 })).toBe(false);
    expect(canCompleteReconciliation({ statementBalance: "1000", difference, unbookedBankLines: 0 })).toBe(true);
  });

  it("the bar says why, in the order a person would fix it", () => {
    expect(reconcileReadinessCopy({ statementBalance: "1000", difference, unbookedBankLines: 3 })).toBe("3 bank lines aren't in your books yet — add or match them above to finish.");
    expect(reconcileReadinessCopy({ statementBalance: "1000", difference, unbookedBankLines: 1 })).toBe("1 bank line isn't in your books yet — add or match it above to finish.");
    expect(reconcileReadinessCopy({ statementBalance: "1000", difference: 12 })).toBe("Difference must be $0.00 to complete.");
    expect(reconcileReadinessCopy({ statementBalance: "", difference: 0 })).toBe("Enter your bank statement's ending balance to finish.");
    expect(reconcileReadinessCopy({ statementBalance: "0", difference: 0 })).toBe("Confirm the account is empty or closed to finish.");
    expect(reconcileReadinessCopy({ statementBalance: "1000", difference: 0 })).toBe("Balanced — ready to complete.");
  });

  it("★ the screen passes the count of lines not matched or added, and shows the same reason", () => {
    const v = readFileSync("src/components/views/ReconView.jsx", "utf8");
    expect(v).toMatch(/const unmatchedBank = bankTxns\.filter\(t=>!t\._matchBook && !t\._ignored\);/);
    expect(v).toMatch(/const gate = \{ statementBalance, difference: diff, emptyConfirmed, unbookedBankLines: unmatchedBank\.length \};/);
    expect(v).toMatch(/const ready = canCompleteReconciliation\(gate\); const why = reconcileReadinessCopy\(gate\);/);
    expect(v).not.toMatch(/"Balanced — ready to complete\."/);
    const done = v.slice(v.indexOf("const completeMatch = async"), v.indexOf("const payload = { ...serialize(\"complete\")"));
    expect(done).toMatch(/const finalGate = \{ statementBalance, difference: diff, emptyConfirmed, unbookedBankLines: unmatchedBank\.length \};\s*\n\s*if \(!canCompleteReconciliation\(finalGate\)\) \{ showNotification && showNotification\(reconcileReadinessCopy\(finalGate\), "error"\); return; \}/);
  });
});
