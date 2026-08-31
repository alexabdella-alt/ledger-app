// ─────────────────────────────────────────────────────────────────────────────
// O122 — HOW MANY QUESTIONS IS TOO MANY, AND NOBODY WAS COUNTING.
//
// Every drive, every suite and every acceptance doc in this repo scores INDIVIDUAL
// behaviours. So we can end with every behaviour correct and a screen carrying nine cards —
// which is not a usable product. The promise is *"drop anything here — your AI controller
// handles the rest"*, and that sentence implies a CARD RATE. Nothing measured it.
//
// ★★ THE TARGET IS NOT ZERO — IT IS THE CONTROLLER'S OWN QUESTION RATE. A controller who
// asks nothing is rubber-stamping; one who asks nine questions about a 60-document month is
// drowning the client. The test for any INDIVIDUAL card is: **would a competent controller
// have asked this, of this client, this month?**
//
// ★★★ AND THE RULE THAT DOES THE WORK:
//        "A CARD THE USER SEES EVERY MONTH IS A BUG WEARING A QUESTION MARK."
// Any card that can recur monthly for the same vendor on the same question is a design
// defect BY DEFINITION — not a tuning preference, not a P3. That rule retroactively
// reclassified two known items, and it needed no theory of confidence to do it.
//
// ★ THE SPLIT IS THE DELIVERABLE, NOT THE TOTAL. A falling total with a flat category 2
// means the teaching is not sticking, and that is invisible in an aggregate.
//
// Pure.
// ─────────────────────────────────────────────────────────────────────────────

export const CARD_CATEGORY = {
  BUG: 1,        // we got it wrong. Expected rate: ZERO. A fix, not a design question.
  TEACHING: 2,   // asked ONCE, on day one, and never again. Onboarding cost, not monthly cost.
  JUDGMENT: 3,   // a real bookkeeper stops on this. Forever, and RARE.
};

export const CATEGORY_LABEL = {
  1: "we got this wrong",
  2: "teaching us something, once",
  3: "a judgment call worth making",
};

// ── THE TAXONOMY ────────────────────────────────────────────────────────────
// Every card kind the product can emit, with the reason for its category. Kinds are the
// anomaly `type`s (insights.js) and the lifecycle `ASK_REASON`s (invoicePayment.js).
//
// ★ SEVERAL ENTRIES CHANGED CATEGORY AS BUGS WERE FIXED, and the note says so — a taxonomy
// that silently re-grades itself would hide exactly the improvement it is meant to show.
export const CARD_TAXONOMY = {
  // ── lifecycle asks ──
  amount_differs: { category: CARD_CATEGORY.JUDGMENT, why: "an invoice and its payment differ by a real amount — a bookkeeper stops on that" },
  identity_differs: { category: CARD_CATEGORY.TEACHING, why: "one supplier under two names; asked once, then remembered (O111)" },
  multiple_candidates: { category: CARD_CATEGORY.JUDGMENT, why: "genuinely several payments it could belong to" },
  period_count_mismatch: { category: CARD_CATEGORY.JUDGMENT, why: "a flat-fee vendor's period does not balance — five invoices against four charges" },
  // ★ NOT a judgment about the ledger at all: a report that WE failed to record something.
  // It is category 1 because its expected rate is zero and every occurrence is our defect.
  record_failed: { category: CARD_CATEGORY.BUG, why: "we couldn't save the link — our failure, never the client's question" },

  // ── anomalies ──
  duplicate_payment: { category: CARD_CATEGORY.JUDGMENT, why: "a true double-payment is worth stopping on (was category 1 on lifecycle pairs and weekly vendors until O114/O117)" },
  large_transaction: { category: CARD_CATEGORY.JUDGMENT, why: "capitalize-or-expense on a big charge (was category 1 while it fired on payroll — fixed)" },
  round_number: { category: CARD_CATEGORY.JUDGMENT, why: "an exact round amount can be an estimate booked as an actual (was category 1 while it fired on payroll — fixed)" },
  missing_recurring: { category: CARD_CATEGORY.JUDGMENT, why: "a regular supplier stopped billing (was category 1 while it measured against wall-clock instead of the books' period — fixed)" },
  category_spike: { category: CARD_CATEGORY.JUDGMENT, why: "spending in a category jumped" },
  vendor_spike: { category: CARD_CATEGORY.JUDGMENT, why: "one supplier's charges jumped" },
  rapid_sequential: { category: CARD_CATEGORY.JUDGMENT, why: "several charges from one supplier in quick succession" },

  // ── clarifications ──
  gl: { category: CARD_CATEGORY.JUDGMENT, why: "which account this belongs to — shrinks toward category 2 as vendors become known" },
  gaap: { category: CARD_CATEGORY.JUDGMENT, why: "capitalize or expense — a real accounting judgment" },
  direction: { category: CARD_CATEGORY.TEACHING, why: "money in or out; the company's own identity settles it once" },
};

// A card's kind, from whichever shape it arrives in.
export function cardKind(card = {}) {
  return card.kind || card.type || card.reason || card.subject || null;
}

// ★★ AN UNRECOGNISED CARD IS REPORTED AS UNRECOGNISED, NEVER DEFAULTED. Bucketing it into
// "judgment" would flatter the number by exactly the amount we do not understand — and a
// new card kind nobody classified is the most likely place for a category-1 defect to hide.
export function categoryOf(card = {}) {
  const kind = cardKind(card);
  const hit = kind ? CARD_TAXONOMY[kind] : null;
  if (!hit) return { kind, category: null, why: "not in the taxonomy — classify it before trusting the rate" };
  return { kind, ...hit };
}

// ── THE REPORT ───────────────────────────────────────────────────────────────
// `mode` separates steady state from onboarding on purpose: conflating them would either
// make onboarding look broken or make steady state look fine.
export const RATE_MODE = { STEADY: "steady", ONBOARDING: "onboarding" };
export const STEADY_TARGET_RATE = 0.05;   // under 5% of documents. A working number, named as one.

export function cardRateReport({ cards = [], documentCount = 0, mode = RATE_MODE.STEADY } = {}) {
  const byCategory = { 1: [], 2: [], 3: [] };
  const unclassified = [];
  for (const c of cards || []) {
    const r = categoryOf(c);
    if (r.category == null) unclassified.push(r.kind || "(no kind)");
    else byCategory[r.category].push(r.kind);
  }
  const total = (cards || []).length;
  const docs = Number(documentCount) || 0;
  const rate = docs > 0 ? total / docs : null;

  // ★ CATEGORY 1 IS A DEFECT COUNT, NOT A RATE. Its expected value is zero, so it is
  // reported on its own and never averaged into the percentage — averaging is how a bug
  // becomes "within tolerance".
  const bugs = byCategory[1].length;

  return {
    mode, total, documentCount: docs, rate,
    bugs,
    teaching: byCategory[2].length,
    judgment: byCategory[3].length,
    unclassified,
    byCategory,
    // Only steady state has a target. Onboarding gets its own number and does not have one
    // yet — saying so is better than borrowing this one.
    withinTarget: mode === RATE_MODE.STEADY && rate != null ? (bugs === 0 && rate <= STEADY_TARGET_RATE) : null,
  };
}

// ── THE SENTENCE ─────────────────────────────────────────────────────────────
// Reads the report, so it cannot describe a split that is not the one measured (§9). It
// leads with the split because the total is the least informative number in it.
export function cardRateCopy(report = {}) {
  const { total = 0, documentCount = 0, bugs = 0, teaching = 0, judgment = 0, unclassified = [], rate, mode, withinTarget } = report;
  if (!documentCount) return "No documents in this run, so there is no rate to report.";

  const pct = rate == null ? "—" : `${(rate * 100).toFixed(1)}%`;
  const parts = [`${total} card${total === 1 ? "" : "s"} across ${documentCount} document${documentCount === 1 ? "" : "s"} (${pct})`];
  parts.push(`${bugs} we got wrong · ${teaching} teaching · ${judgment} judgment`);
  if (unclassified.length) parts.push(`${unclassified.length} not classified — the rate is unreliable until they are`);
  if (bugs > 0) parts.push(`${bugs} card${bugs === 1 ? " is" : "s are"} a defect, not a question`);
  else if (mode === RATE_MODE.STEADY && withinTarget === false) parts.push(`above the ${(STEADY_TARGET_RATE * 100).toFixed(0)}% steady-state target`);
  else if (mode === RATE_MODE.ONBOARDING) parts.push("onboarding — no target set for this mode yet");
  return parts.join(" · ");
}
