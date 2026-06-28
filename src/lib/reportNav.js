// ─────────────────────────────────────────────────────────────────────────────
// Report drill-down navigation — Back pops EXACTLY ONE level (the prior single
// returnTo pointer skipped the intermediate line-item list). The navigation "stack"
// is encoded in the nav state itself: (view + reportType + plDrill + drill). Each
// drill deeper is one level; reportNavBack returns the immediately-previous level.
//
// Levels for the Income Statement path (the repro):
//   report  →  account list (plDrill rev-acct / exp-acct)  →  [vendor list (exp-vendor)]  →  transaction detail
// Back retraces it one level per press: detail → line-item list → (vendor list →) report.
//
// State shape:
//   { view: "reports"|"detail", reportType, plDrill, drill }
//     plDrill: { type: "rev-acct"|"exp-acct"|"exp-vendor", code, name, vendor? }
//     drill:   { scope: "vendor"|"gl"|"cashflow"|"project"|"bsacct", value, label }
// Returns the previous-level state, or null when already at the report top (the caller
// then falls back to returnTo / the tab).
// ─────────────────────────────────────────────────────────────────────────────
export function reportNavBack(state = {}) {
  const { view, reportType, plDrill, drill } = state;

  // Deepest level: a single transaction's detail → back to the line-item LIST it came from.
  // The drill (plDrill/drill) is preserved, so we land on the list, NOT the report top.
  if (view === "detail") {
    return { view: "reports", reportType, plDrill: plDrill || null, drill: drill || null };
  }

  // Income-Statement drill levels.
  if (plDrill) {
    if (plDrill.type === "exp-vendor") {
      // A vendor's transaction list → the account's vendor list (one level up).
      return { view: "reports", reportType, plDrill: { type: "exp-acct", code: plDrill.code, name: plDrill.name }, drill: null };
    }
    // A revenue/expense account's transaction (or vendor) list → the report top.
    return { view: "reports", reportType, plDrill: null, drill: null };
  }

  // Other-report drill (Balance Sheet account / by-vendor / by-category / cash-flow / project) → report top.
  if (drill) return { view: "reports", reportType, plDrill: null, drill: null };

  // Already at the report top — nothing to pop here.
  return null;
}

// Breadcrumb trail (root → current) for display, e.g. ["Income Statement","Revenue","Service Revenue"].
export function reportBreadcrumb(state = {}, reportLabel = "Report") {
  const { plDrill, drill, view } = state;
  const trail = [reportLabel];
  if (plDrill) {
    if (plDrill.type === "rev-acct") trail.push("Revenue", plDrill.name);
    else { trail.push(plDrill.name); if (plDrill.type === "exp-vendor" && plDrill.vendor) trail.push(plDrill.vendor); }
  } else if (drill) {
    trail.push(drill.label);
  }
  if (view === "detail") trail.push("Transaction");
  return trail;
}
