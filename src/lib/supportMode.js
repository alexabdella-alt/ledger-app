// ─────────────────────────────────────────────────────────────────────────────
// Platform-admin Support Mode — pure state transitions (O54). Keeping the
// enter/exit reducers pure makes the two correctness invariants unit-testable:
//   (1) Exit ALWAYS returns to the admin's OWN company — even if support was entered
//       again from within support (nested): the ORIGINAL admin company is preserved,
//       never overwritten by a client company.
//   (2) Exit reads the return target directly (no side effects buried in a setState
//       updater).
// The component wires these to onSwitchCompany + resetCompanyState + UI clears.
// ─────────────────────────────────────────────────────────────────────────────

// Next supportMode value when entering support for `company`. `prev` is the current
// supportMode (null if not in support). `currentCompany` is who's active right now.
// adminCompany = the REAL admin company: preserve prev.adminCompany if already in
// support (nested entry), else the current company.
export function enterSupportState(prev, company, currentCompany) {
  if (!company || !company.id) return prev || null;
  const adminCompany = (prev && prev.adminCompany) || currentCompany || null;
  return { company, adminCompany };
}

// Resolve the exit: who to switch back to. Always the captured admin company.
export function exitSupportState(prev) {
  return { back: (prev && prev.adminCompany) || null, supportMode: null };
}
