// ─────────────────────────────────────────────────────────────────────────────
// O14 — A SCREEN COULD CRASH WITH A GREEN SUITE.
//
// Every test in this repo exercises LOGIC. Nothing has ever rendered a screen, so a view
// could throw on its first paint — a null read, a renamed context key, a `.map` on
// something that is no longer an array — and the whole suite would stay green.
//
// ★ ZERO NEW DEPENDENCIES, DELIBERATELY. `react-dom/server`'s `renderToString` ships with
// React and needs no DOM, no jsdom and no testing-library. It runs the render pass, which
// is exactly where the crashes this is meant to catch happen. It does NOT run effects or
// events, so this is a SMOKE test — it proves a screen paints, never that it works.
//
// The context is a Proxy rather than a hand-written object because `erpCtx` has ~300 keys
// and a fixture listing them would be a second copy of the app's state shape, stale within
// a week. Unknown keys return an empty array: arrays answer `.length`, `.map`, `.filter`,
// `.find`, spread and iteration, which is most of what a view asks of its data.
// ─────────────────────────────────────────────────────────────────────────────
import React from "react";
import { renderToString } from "react-dom/server";
import { ERPContext } from "../../src/components/ERPContext";

// ★ THE LOOKAHEAD IS LOAD-BEARING. Without `(?=[A-Z])` this matched `filteredInvoices`
// ("filter…"), `openingBalances` ("open…") and `signoffs` ("sign…"), handing a view a
// function where it expected an array — seven false failures that looked like real crashes.
// A camelCase verb prefix is only a verb when a capital follows it.
const VERB = /^(set|on|handle|run|load|persist|book|mark|dismiss|open|close|show|add|delete|soft|reset|apply|approve|reject|create|save|toggle|go|enter|exit|resolve|reconcile|sign|reopen|offer|log|classify|process|check|accept|confirm|cancel|clear|update|remove|attach|export|import|navigate|fetch|refresh|send|post|void|restore|bump|seed|preview|complete|start|stop|pick|choose|select|search|sort|format|render|draft|ask|answer|submit|upload|download|print|copy|edit|view|switch|use|get|is|can|has|should|make|build|compute|derive|find|sum|count|guard|route|plan|drain|reevaluate)(?=[A-Z])/;

// Callables whose names carry no verb prefix at all — a view CALLS these, so returning an
// array would fail with "not a function". Listed explicitly because there is no rule that
// distinguishes them from data by name.
const CALLABLES = new Set([
  "flagsForReview", "signOffReadinessFor", "glCashOnHand", "glAccountBalance",
  "accountHasTransactions", "removalPlanFor", "vendorSummary", "glBreakdown",
  "rc", "rn", "esc", "fmt",
]);

// Values a view is likely to dereference further (`currentCompany.id`), or to compare.
const OVERRIDES = {
  currentCompany: { id: "co_test", name: "Test Co", cutoff_date: "2026-01-01" },
  companySettings: { name: "Test Co" },
  session: { user: { id: "u_test", email: "test@example.com" } },
  view: "dashboard", persistedView: "dashboard", navSeat: "cockpit",
  userRole: "admin", isOwner: true, isAdmin: true, isReviewer: true, isMember: false, isViewer: false,
  supportMode: false, companyDataLoaded: true, notification: null,
  inputStyle: {}, labelStyle: {},
  controlTotals: { checks: [], failed: [], allTie: true },
  ownerTrust: { state: "all_clear", lines: [], headline: "", sub: "" },
  bankMatch: { overdue: false, days: null },
  reviewFlagSummary: { count: 0, total: 0 },
  drainStatus: null, aiDegraded: null, reconcileOffer: null,
  pendingSignedPeriodBooking: null, pendingOpeningProposal: null, openingDiscrepancyFlag: null,
  pendingImportFile: null, pendingAIActions: null, deleteConfirm: null, docsPreview: null,
  selectedInvoice: null, selectedContract: null, activeRecon: null, returnTo: null,
  glDrilldown: null, plDrill: null, drill: null, drillSel: null, aiSuggestion: null, aiStep: null,
  form: {}, settingsDraft: {}, coaAddDraft: {}, coaEditDraft: {}, recurringNewRec: {},
  qboMapping: {}, qboPreview: null, qboData: null, sentInvoiceDraft: null, sendInvoiceDraftState: {},
  reportRange: "ytd", reportType: "pl", basisMode: "accrual", booksFilter: "all", apView: "list", arView: "list",
  contractView: "list", docsFilterType: "all", checkRunMode: null, legalTab: "terms",
  reconStatementBalance: "", reconAccount: null, bankStep: 1, qboStep: 1, uploadedFile: null,
  vendorFilter: "", auditSearch: "", auditActionFilter: "all", chatInput: "", askDraft: "",
  netIncome: 0, totalRevenue: 0, totalExpenses: 0, glCash: 0, cashFromBanks: 0,
  reviewedThrough: null, openingBalAsOfDate: null, cutoffDate: "2026-01-01",
  openingPosted: false, preCutoffActivity: false, hasUnread: false, notifOpen: false,
  chatOpen: false, chatLoading: false, isAILoading: false, uploadProcessing: false,
  bankProcessing: false, matchProcessing: false, payrollProcessing: false, qboProcessing: false,
  contractProcessing: false, dragOver: false, universalDragOver: false, bankDragOver: false,
  payrollDragOver: false, contractDragOver: false, qboDragOver: false,
  settingsSaved: false, settingsLogoPreview: null, businessModalOpen: false,
  accountantDismissed: false, onboardingUploadDone: false, statementExceptionsLoadFailed: false,
  chatBottomRef: { current: null }, chatInputRef: { current: null }, mainContentRef: { current: null },
  fileStoreRef: { current: {} }, uploadActiveRef: { current: false },
  AP_PRIORITY: [], CHART_OF_ACCOUNTS: [], CONTRACT_TYPES: [],
};

const noop = () => undefined;

// ★ WHAT A PARTICULAR SCREEN GENUINELY REQUIRES, stated per screen rather than piled into
// the shared default. A detail panel with no selected transaction, or a trust panel with no
// trust state, is not a screen anyone can reach — giving them the data here documents the
// precondition instead of pretending they render from nothing.
const trustLine = { state: "ok", text: "" };
export const VIEW_CONTEXT = {
  "DashboardView.jsx": { ownerTrust: { state: "all_clear", headline: "", sub: "", lines: { captured: trustLine, reviewed: trustLine, correct: trustLine } } },
  "TrustPanel.jsx":    { ownerTrust: { state: "all_clear", headline: "", sub: "", lines: { captured: trustLine, reviewed: trustLine, correct: trustLine } } },
  "ReviewView.jsx":    { signOffReadinessFor: () => ({ ok: false, blockers: [] }) },
  "SendInvoiceView.jsx": { sentInvoiceDraft: { line_items: [], vendor: "", customer: "" }, sendInvoiceDraftState: { line_items: [] } },
  "DetailView.jsx":    { selectedInvoice: { id: "i1", vendor: "Test Vendor", amount: 100, date: "2026-08-01", gl_code: "6100", gl_name: "Rent", line_items: [] } },
};

export function emptyERPContext(extra = {}) {
  const base = { ...OVERRIDES, ...extra };
  return new Proxy(base, {
    has: () => true,
    get(target, key) {
      if (key in target) return target[key];
      if (typeof key !== "string") return undefined;
      if (VERB.test(key) || CALLABLES.has(key)) return noop;   // handler-shaped: callable and inert
      return [];                             // everything else: an empty collection
    },
  });
}

// Renders one view inside the context. Returns the thrown Error, or null on success.
export function renderViewError(Component, extra = {}) {
  try {
    renderToString(
      React.createElement(ERPContext.Provider, { value: emptyERPContext(extra) },
        React.createElement(Component, null)));
    return null;
  } catch (e) {
    return e;
  }
}
