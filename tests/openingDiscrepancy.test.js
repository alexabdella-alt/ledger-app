import { describe, it, expect } from "vitest";
import { glAccountBalance } from "../src/lib/reports.js";
import { openingDiscrepancy, shouldProposeOpening } from "../src/lib/openingBalanceProposal.js";
import { addDaysYMD } from "../src/lib/format.js";

// ════════════════════════════════════════════════════════════════════════════
// O83 Feb drive — the opening-discrepancy check compared the statement's stated
// opening against the recorded opening-balance ROW ($12,483.27), not GL CASH AT
// PERIOD START. From month 2 on, books cash at period start = opening + all prior
// activity, so the check false-fired by EXACTLY the prior period's net income
// ($3,174.33 = January's net). Fix: comparand = glAccountBalance as of the day
// before the statement's period start (the balance the books carry INTO the period).
// ════════════════════════════════════════════════════════════════════════════

// Franklin Ave fixture (flattened ledger rows):
//   • Opening entry Dr Cash 1000 / Cr OBE 3400 = $12,483.27, dated the cutoff (2026-01-01).
//   • January net income +$3,174.33 via a revenue deposit Dr Cash / Cr Revenue (P&L-primary
//     flatten → primary gl_code=4000, cash on the offset leg), dated 2026-01-15.
//   ⇒ GL cash at 2026-01-31 = 12,483.27 + 3,174.33 = 15,657.60 = Jan ending = Feb opening.
const OPENING = 12483.27;
const JAN_NET = 3174.33;
const FEB_OPENING = 15657.60;
const ledger = [
  { id: "open1", gl_code: "1000", secondary_gl_code: "3400", amount: OPENING, debit_credit: "debit", date: "2026-01-01", source: "opening_balance", status: "posted" },
  { id: "dep1",  gl_code: "4000", secondary_gl_code: "1000", amount: JAN_NET, debit_credit: "credit", date: "2026-01-15", source: "bank_import", status: "posted" },
];
const glCashAt = (asOf) => glAccountBalance("1000", ledger, { asOf });

describe("comparand = GL cash carried INTO the period (day before period start)", () => {
  it("GL cash at 2026-01-31 equals the Feb stated opening (opening + Jan activity)", () => {
    expect(glCashAt(addDaysYMD("2026-02-01", -1))).toBe(FEB_OPENING);   // 2026-01-31
  });

  it("MONTH-2: statement opening == GL cash at period start → NO discrepancy (the exact Feb scenario)", () => {
    const glCash = glCashAt(addDaysYMD("2026-02-01", -1));
    const disc = openingDiscrepancy({ statedOpening: FEB_OPENING, recordedOpening: glCash });
    expect(disc.mismatch).toBe(false);
    expect(disc.diff).toBe(0);
  });

  it("REGRESSION LOCK: the OLD comparand (opening ROW only) would have false-fired by January's net income", () => {
    const bad = openingDiscrepancy({ statedOpening: FEB_OPENING, recordedOpening: OPENING });
    expect(bad.mismatch).toBe(true);
    expect(bad.diff).toBe(JAN_NET);     // the $3,174.33 phantom = exactly January's net income
  });

  it("GENUINE mismatch: statement opening ≠ GL cash at start → flagged, with the real difference", () => {
    const glCash = glCashAt(addDaysYMD("2026-02-01", -1));   // 15,657.60
    const disc = openingDiscrepancy({ statedOpening: 20000, recordedOpening: glCash });
    expect(disc.mismatch).toBe(true);
    expect(disc.diff).toBe(4342.40);
  });

  it("day-before helper handles month/year boundaries (DST-safe)", () => {
    expect(addDaysYMD("2026-02-01", -1)).toBe("2026-01-31");
    expect(addDaysYMD("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDaysYMD("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("first-statement-ever path (proposal flow) is unaffected by the comparand change", () => {
  it("no opening yet + no earlier activity → still PROPOSE (not a discrepancy)", () => {
    // The discrepancy branch only runs when an opening already exists; the first statement
    // routes through shouldProposeOpening, which the fix does not touch.
    expect(shouldProposeOpening({ hasOpeningForAccount: false, earliestBookedDate: null, periodStart: "2026-01-01" })).toBe(true);
  });
  it("opening already exists → never proposes (the discrepancy branch is the one that runs)", () => {
    expect(shouldProposeOpening({ hasOpeningForAccount: true, earliestBookedDate: null, periodStart: "2026-02-01" })).toBe(false);
  });
});
