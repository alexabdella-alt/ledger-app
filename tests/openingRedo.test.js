import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { planOpeningRedo, redoAuditDetail, REDO_REFUSED } from "../src/lib/openingRedo";

// ═════════════════════════════════════════════════════════════════════════════
// "REDO OPENING SETUP" — §12's deferred escape hatch.
//
// The cutoff LOCKS once opening balances are posted, and that is right: the whole starting
// position is one balanced entry dated at the cutoff, and moving it afterwards would
// silently re-date every pre-cutoff assumption. But a lock with no way out turns a week-one
// mistake — wrong date, wrong figures — into a permanent one.
//
// ★★★ THE DESIGN DECISION: IT UNLOCKS, IT DOES NOT DELETE. Reversing the opening entry now
// would leave the books with NO starting position in between — every report in that window
// wrong in a new way, and permanently so if the person walks away mid-repair.
// `postOpeningBalances` already supersedes the previous entry when a new one is posted, so
// the old position stays live and coherent until a better one replaces it.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★ what it refuses, and why each is different", () => {
  it("a viewer cannot", () => {
    expect(planOpeningRedo({ canEdit: false, openingPosted: true })).toMatchObject({ ok: false, reason: REDO_REFUSED.NOT_PERMITTED });
  });

  it("nothing posted means nothing to redo — and it says that, not 'not allowed'", () => {
    const r = planOpeningRedo({ canEdit: true, openingPosted: false });
    expect(r.reason).toBe(REDO_REFUSED.NOT_POSTED);
    expect(r.message).toMatch(/nothing to redo/);
  });

  it("★★★ a SIGNED month is a harder no than a lock, and the message says whose call it is", () => {
    // The cutoff lock is ours and we may lift it. An accountant's signature is not ours to
    // lift — and 078 would refuse the write anyway, so unlocking would hand someone a thing
    // they then could not change.
    const r = planOpeningRedo({ canEdit: true, openingPosted: true, cutoffDate: "2026-01-15", signedPeriodOf: () => "January 2026" });
    expect(r.reason).toBe(REDO_REFUSED.SIGNED_PERIOD);
    expect(r.message).toMatch(/January 2026/);
    expect(r.message).toMatch(/They'd need to reopen that month/);
  });
});

describe("★★★ the confirmation says what SURVIVES, not just what changes", () => {
  const r = planOpeningRedo({ canEdit: true, openingPosted: true, cutoffDate: "2026-01-01" });

  it("it is allowed when the month is open", () => {
    expect(r.ok).toBe(true);
  });

  it("★★★ and it promises the books do not go blank", () => {
    // "Are you sure?" tells someone nothing. The thing they actually need to know is that
    // their starting position stays until they replace it.
    expect(r.message).toMatch(/stays in the books until you replace it/);
    expect(r.message).toMatch(/nothing is removed now/);
  });

  it("★ it names the date being unlocked, so they can tell it is the right one", () => {
    expect(r.message).toContain("2026-01-01");
  });

  it("★ the audit line describes the same thing the person was promised", () => {
    expect(redoAuditDetail({ cutoffDate: "2026-01-01" })).toMatch(/stays until it is replaced/);
    expect(redoAuditDetail({ cutoffDate: "2026-01-01" })).toContain("2026-01-01");
  });
});

describe("★★ it unlocks rather than deleting, in the code as well as the copy", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const fn = app.slice(app.indexOf("const redoOpeningSetup = async"), app.indexOf("const redoOpeningSetup = async") + 1800);

  it("★★★ it never touches the journal entry", () => {
    // The whole point. If this ever soft-deletes the opening entry, the books lose their
    // starting position the moment someone clicks it.
    expect(fn).not.toMatch(/journal_entries/);
    expect(fn).not.toMatch(/deleted_at/);
  });

  it("★★ it clears the posted flag through a CHECKED write", () => {
    expect(fn).toMatch(/checkedIdsUpdate\(\{/);
    expect(fn).toMatch(/patch: \{ posted: false \}/);
    expect(fn).toMatch(/if \(!r\.ok\)/);
  });

  it("★ a failed unlock says nothing changed, and does not repaint", () => {
    const fail = fn.slice(fn.indexOf("if (!r.ok)"));
    expect(fail.slice(0, 300)).toMatch(/nothing was changed/);
    expect(fn.indexOf("if (!r.ok)")).toBeLessThan(fn.indexOf("setOpeningBalances(prev"));
  });

  it("★★ the control sits beside the lock it lifts, not four screens away", () => {
    // O129's lesson: a repair that exists with no button is invisible; one that asks for a
    // database id is unusable. This is next to the padlock.
    const view = fs.readFileSync(path.join(process.cwd(), "src/components/views/OpeningBalancesView.jsx"), "utf8");
    const lock = view.indexOf("locked — opening balances posted");
    const button = view.indexOf("start again");
    expect(lock).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(lock);
    expect(button - lock).toBeLessThan(1600);
    expect(view).toMatch(/setDeleteConfirm\(\{/);   // confirmed, never one click
  });
});
