import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { isDepreciableEntry, hasSchedule, repairOfferCopy, validateRepair, DEFAULT_LIFE_YEARS } from "../src/lib/depreciationRepair";

// ═════════════════════════════════════════════════════════════════════════════
// O129 — THE REPAIR TOOL THAT HAD NO BUTTON.
//
// `attachDepreciationToExistingAsset` builds a schedule for equipment already in the books.
// Real, idempotent, owner/admin-gated — and called by nothing, because the control it used
// to sit behind was removed for good reason: it asked you to type a raw journal-entry id,
// on the page where you read your financial statements.
//
// ★★ NEITHER "DELETE IT" NOR "PUT THE BOX BACK". The capability is legitimate — equipment
// reaches the books through paths that never create a schedule (a QuickBooks import, a
// hand-entered correction, anything predating the feature) and without one it sits on the
// balance sheet at full cost forever. What was wrong was WHERE it lived.
// ═════════════════════════════════════════════════════════════════════════════

const ASSET = ["1500"];

describe("★★ it offers itself only where it could possibly apply", () => {
  it("a debit to the fixed-asset account qualifies", () => {
    expect(isDepreciableEntry({ gl_code: "1500", amount: 5000, debit_credit: "debit" }, ASSET)).toBe(true);
  });

  it("★★ a CREDIT does not — that is a disposal, and scheduling it would depreciate a removal", () => {
    expect(isDepreciableEntry({ gl_code: "1500", amount: 5000, debit_credit: "credit" }, ASSET)).toBe(false);
  });

  it("an expense does not, however large", () => {
    expect(isDepreciableEntry({ gl_code: "6100", amount: 50000, debit_credit: "debit" }, ASSET)).toBe(false);
  });

  it("a voided or removed entry does not", () => {
    expect(isDepreciableEntry({ gl_code: "1500", amount: 5000, status: "voided" }, ASSET)).toBe(false);
    expect(isDepreciableEntry({ gl_code: "1500", amount: 5000, deleted_at: "2026-08-01" }, ASSET)).toBe(false);
  });

  it("★ and nothing does when the company has no fixed-asset account resolved", () => {
    // The codes come from the ROLE upstream, never a hardcoded "1500" (§9). An empty list
    // means we could not resolve one — offering the control anyway would be acting on a
    // lookup that failed.
    //
    // ★★ THE BEHAVIOUR IS RIGHT AND IT NEEDED NO GUARD OF ITS OWN. A mutation deleting the
    // explicit `if (!codes.size) return false;` SURVIVED — because an empty set matches
    // nothing and the membership test already returns false. The code was redundant, not
    // the test weak, and the guard is gone. **A surviving mutation is a question, not a
    // verdict: sometimes the answer is that the line could never have mattered.**
    expect(isDepreciableEntry({ gl_code: "1500", amount: 5000, debit_credit: "debit" }, [])).toBe(false);
    expect(isDepreciableEntry({ gl_code: "1500", amount: 5000, debit_credit: "debit" }, [null, ""])).toBe(false);
  });

  it("already-scheduled equipment is recognised", () => {
    const e = { db_entry_id: "je1" };
    expect(hasSchedule(e, [{ source_journal_entry_id: "je1" }])).toBe(true);
    expect(hasSchedule(e, [{ source_journal_entry_id: "je2" }])).toBe(false);
  });
});

describe("★ what a person may enter", () => {
  it("★★ leftover value above the cost is refused — it would depreciate UPWARDS", () => {
    // Caught here rather than by the schedule builder, so the message is about the number
    // they typed rather than about an internal total they never see.
    const r = validateRepair({ lifeYears: 5, salvage: 9000, cost: 5000 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/less than what you paid/);
  });

  it("refuses a life of zero, and anything beyond 50 years", () => {
    expect(validateRepair({ lifeYears: 0, cost: 100 }).ok).toBe(false);
    expect(validateRepair({ lifeYears: 51, cost: 100 }).ok).toBe(false);
  });

  it("converts years to the months the schedule builder wants", () => {
    expect(validateRepair({ lifeYears: 5, salvage: 0, cost: 5000 })).toMatchObject({ ok: true, usefulLifeMonths: 60, salvageValue: 0 });
  });

  it("★ the copy reads the ENTRY, so it cannot describe something else (§9)", () => {
    expect(repairOfferCopy({ vendor: "Dell" })).toContain("Dell");
    expect(repairOfferCopy({})).toContain("this purchase");
  });
});

describe("★★ it is reachable from the entry that needs it", () => {
  const panel = fs.readFileSync(path.join(process.cwd(), "src/components/TransactionDetailPanel.jsx"), "utf8");
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");

  it("★★★ the tool has a caller again", () => {
    // O96's lesson was that dead plumbing which LOOKS wired is what gets punished. This was
    // the opposite — a live capability with no way in — and both end in the same place:
    // nobody can tell what the system can actually do.
    expect(panel).toMatch(/attachDepreciationToExistingAsset\(\{ journalEntryId: sel\.db_entry_id/);
    expect(app).toMatch(/attachDepreciationToExistingAsset,/);   // exposed on the context
  });

  it("★★ nobody types a database id — the entry supplies it", () => {
    // This is the whole reason the old control was removed. If an input for an id ever
    // reappears, this fails.
    const offer = panel.slice(panel.indexOf("O129 — EQUIPMENT WITH NO SCHEDULE"), panel.indexOf("O129 — EQUIPMENT WITH NO SCHEDULE") + 3500);
    // ★ THE FIRST VERSION OF THIS LINE COULD NOT FAIL — a ternary on `.source` that always
    // chose a regex matching nothing. It read like a check and asserted the empty set, which
    // is the `if (error)` shape in a test. Replaced with two that can: the offer contains NO
    // text input bound to an id, and the id comes from the entry.
    expect(offer).not.toMatch(/placeholder="[^"]*\bid\b/i);
    expect(offer).not.toMatch(/setJournalEntryId|journalEntryIdInput/);
    expect(offer).toMatch(/journalEntryId: sel\.db_entry_id/);
  });

  it("★ it is gated to owner/admin, matching the tool's own check", () => {
    const offer = panel.slice(panel.indexOf("O129 — EQUIPMENT WITH NO SCHEDULE"), panel.indexOf("O129 — EQUIPMENT WITH NO SCHEDULE") + 800);
    expect(offer).toMatch(/\(isOwner \|\| isAdmin\)/);
  });

  it("★★ and it reports the tool's OUTCOME, including 'already linked'", () => {
    // The tool is idempotent and says so; the panel must not claim a schedule it did not
    // create. `skipped` is the already-linked case and is deliberately not an error.
    const offer = panel.slice(panel.indexOf("O129 — EQUIPMENT WITH NO SCHEDULE"), panel.indexOf("O129 — EQUIPMENT WITH NO SCHEDULE") + 4000);
    expect(offer).toMatch(/if \(r && r\.ok\)/);
    expect(offer).toMatch(/!r\.skipped/);
  });
});
