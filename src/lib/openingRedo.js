// ─────────────────────────────────────────────────────────────────────────────
// "REDO OPENING SETUP" — the way out of a starting position that was set up wrong.
//
// The cutoff (Day One) LOCKS once opening balances are posted, and that is right: the whole
// starting position is one balanced entry dated at the cutoff, and moving it afterwards
// would silently re-date every pre-cutoff assumption. §12 deferred an escape hatch for the
// case it creates — **someone sets up with the wrong date or the wrong figures, posts, and
// is then stuck permanently.** For a first client that is a plausible week-one mistake with
// no way back.
//
// ★★★ THE DESIGN DECISION THAT MATTERS: IT UNLOCKS, IT DOES NOT DELETE.
// The obvious implementation — reverse the opening entry now, let them start again — leaves
// the books with NO opening position in between. Every report in that window would be wrong
// in a new way, and if they walk away mid-repair it stays wrong. `postOpeningBalances`
// already supersedes the previous entry when a new one is posted (tested, and hardened
// today), so the honest move is to **unlock the cutoff and let the existing, proven path
// replace the entry when the new one is ready.** The old position stays live and coherent
// until a better one exists.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const REDO_REFUSED = {
  NOT_POSTED: "not_posted",         // nothing to redo
  SIGNED_PERIOD: "signed_period",   // the cutoff sits inside a month someone attested
  NOT_PERMITTED: "not_permitted",   // viewer/member
};

// `signedPeriodForDate` is passed in rather than imported, so this stays pure and the
// caller supplies the company's real sign-off state.
export function planOpeningRedo({ openingPosted = false, cutoffDate = null, canEdit = false, signedPeriodOf = () => null } = {}) {
  if (!canEdit) {
    return { ok: false, reason: REDO_REFUSED.NOT_PERMITTED, message: "Only an owner or admin can change the starting position." };
  }
  if (!openingPosted) {
    return { ok: false, reason: REDO_REFUSED.NOT_POSTED, message: "There's nothing to redo — no starting balances have been recorded yet." };
  }
  // ★ A SIGNED MONTH IS A HARDER NO THAN A LOCK. The cutoff lock is ours and we may lift it;
  // an accountant's signature is not ours to lift, and `078` would refuse the write anyway —
  // better to say so here than to unlock something that cannot then be changed.
  const signed = cutoffDate ? signedPeriodOf(cutoffDate) : null;
  if (signed) {
    return {
      ok: false, reason: REDO_REFUSED.SIGNED_PERIOD,
      message: `Your starting balances sit in ${signed}, which your accountant has signed off. They'd need to reopen that month before this can change.`,
    };
  }
  return {
    ok: true, reason: null,
    // ★★ THE CONFIRMATION SAYS WHAT SURVIVES, NOT JUST WHAT CHANGES. "Are you sure?" tells
    // someone nothing; the thing they actually need to know is that their books do not go
    // blank in the meantime.
    message: `This unlocks your start date${cutoffDate ? ` (currently ${cutoffDate})` : ""} so you can enter your starting balances again. Your current starting position stays in the books until you replace it — nothing is removed now.`,
    confirmLabel: "Unlock and start again",
  };
}

// What the audit row should say. Reads the plan, so it cannot describe a redo that was
// refused (§9).
export function redoAuditDetail({ cutoffDate }) {
  return `Unlocked the start date${cutoffDate ? ` (was ${cutoffDate})` : ""} so the starting balances can be entered again — the existing opening entry stays until it is replaced`;
}
