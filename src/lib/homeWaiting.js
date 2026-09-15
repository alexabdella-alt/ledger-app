// ─────────────────────────────────────────────────────────────────────────────
// ONE LIST OF THINGS WAITING ON YOU (U1, C375).
//
// Home stacked nine differently-styled banners — a questions banner, a bank-match reminder, a
// contract prompt, an unknown-document prompt, a held-email line, "questions from earlier",
// "we couldn't read", a tax-deadline alert, unpaid-bill cards — each written at a different
// time with its own colour and its own button. A person reading Home had to triage the
// styling before the content. This builds ONE ranked list from the same inputs: one sentence
// and one (at most two) actions per item, the risky ones first (C264's order, kept), the
// informational ones last. Pure — the screen renders it and dispatches the actions.
//
// Urgency, in order: STOPS (a wrong answer books silently wrong) · NOW (not in the books
// until you act) · SOON (a date is coming) · INFO (someone else will handle it; you may look).
// ─────────────────────────────────────────────────────────────────────────────
import { countByUrgency, queueBannerCopy } from "./cardUrgency";
import { heldQuestionsCopy, heldUnreadableCopy, heldPartialCopy } from "./waitingOnYou";
import { unknownSenderCopy } from "../../supabase/functions/_shared/mailChannel.js";
import { fmtMoney } from "./format";

export const WAIT = { STOPS: 0, NOW: 1, SOON: 2, INFO: 3 };
const money = (n) => fmtMoney(Number(n) || 0);

export function homeWaitingList({
  openCards = [],            // unresolved clarification cards (this session)
  heldQuestions = [],        // C365 rows
  heldUnreadable = [],       // C369 rows
  heldPartial = [],          // C390 rows
  heldInbound = [],          // O82 messages the sender wall held
  canDecideMail = false,
  bankMatch = null,          // { overdue, days }
  taxDeadline = null,        // nextUrgentDeadline(...) result, with .plain .days .url .est
  taxEstimateText = "",      // "" or " — estimated amount $X"
  overdueBills = [],         // open A/P rows past due
  overdueTotal = 0,
  recurringSuggestions = [],
  uploadQueue = [],          // for the contract / unknown-doc prompts
  cockpit = false,           // reviewer seat: the accountant-side actions are theirs
} = {}) {
  const items = [];

  // ── STOPS / questions ──
  const cards = (openCards || []).filter((c) => c && !c.resolved);
  if (cards.length) {
    const { stops } = countByUrgency(cards);
    items.push({
      id: "questions", urgency: stops > 0 ? WAIT.STOPS : WAIT.NOW,
      text: queueBannerCopy(cards),
      actions: [{ kind: "stepper", label: stops > 0 ? "Answer these" : "Have a look" }],
    });
  }

  // ── NOW ──
  if ((heldQuestions || []).length) {
    const reloadable = heldQuestions.filter((h) => h.reloadable && !h.loading);
    items.push({
      id: "held_questions", urgency: WAIT.NOW, text: heldQuestionsCopy(heldQuestions),
      actions: reloadable.length ? [{ kind: "reload", label: heldQuestions.some((h) => h.loading) ? "Bringing the questions back…" : "Bring the questions back", intakeIds: reloadable.map((h) => h.intake_id), busy: heldQuestions.some((h) => h.loading) }] : [],
    });
  }
  if ((heldUnreadable || []).length) {
    const reloadable = heldUnreadable.filter((h) => h.reloadable && !h.loading);
    items.push({
      id: "held_unreadable", urgency: WAIT.NOW, text: heldUnreadableCopy(heldUnreadable),
      actions: reloadable.length ? [{ kind: "reload", label: heldUnreadable.some((h) => h.loading) ? "Trying again…" : "Try again", intakeIds: reloadable.map((h) => h.intake_id), busy: heldUnreadable.some((h) => h.loading) }] : [],
    });
  }
  if ((heldPartial || []).length) {
    const reloadable = heldPartial.filter((h) => h.reloadable && !h.loading);
    items.push({
      id: "held_partial", urgency: WAIT.NOW, text: heldPartialCopy(heldPartial),
      actions: reloadable.length ? [{ kind: "reload", label: heldPartial.some((h) => h.loading) ? "Bringing it back…" : "Bring it back", intakeIds: reloadable.map((h) => h.intake_id), busy: heldPartial.some((h) => h.loading) }] : [],
    });
  }
  for (const m of heldInbound || []) {
    const kept = m.attachment_count > 0 ? ` ${m.attachment_count} attachment${m.attachment_count === 1 ? "" : "s"} kept, not read.` : "";
    items.push({
      id: `mail:${m.id}`, urgency: WAIT.NOW,
      text: `${unknownSenderCopy({ from: m.from_email, subject: m.subject })}${kept}`,
      actions: canDecideMail
        ? [{ kind: "mail_allow", label: "Allow this sender", message: m }, { kind: "mail_ignore", label: "Ignore", message: m, secondary: true }]
        : [],
      note: canDecideMail ? null : "An owner or admin can allow or ignore it.",
    });
  }
  if (bankMatch && bankMatch.overdue) {
    items.push({
      id: "bank_match", urgency: WAIT.NOW,
      text: bankMatch.days == null
        ? "Your books haven't been matched to your bank yet — drop your latest statement and we'll do it."
        : `Your books haven't been matched to your bank in ${bankMatch.days} days — drop your latest statement and we'll do it.`,
      actions: [{ kind: "upload", label: "Upload statement" }],
    });
  }

  // ── SOON ──
  if (taxDeadline) {
    const when = taxDeadline.days === 0 ? "due today" : `in ${taxDeadline.days} day${taxDeadline.days === 1 ? "" : "s"}`;
    items.push({
      id: "tax_deadline", urgency: taxDeadline.days <= 14 ? WAIT.NOW : WAIT.SOON,
      text: `${taxDeadline.plain} ${when}${taxEstimateText || ""}.`,
      actions: [{ kind: "nav", label: "Open Taxes", view: "tax" }],
      link: taxDeadline.url ? { label: "Pay or file", url: taxDeadline.url } : null,
    });
  }
  if ((overdueBills || []).length) {
    const n = overdueBills.length;
    items.push({
      id: "overdue_bills", urgency: WAIT.SOON,
      text: `${n} bill${n === 1 ? " is" : "s are"} past due — ${money(overdueTotal)} in total.`,
      actions: [{ kind: "nav", label: "See bills to pay", view: "ap" }],
    });
  }
  for (const s of recurringSuggestions || []) {
    const flat = Math.abs((s.maxAmount || 0) - (s.minAmount || 0)) < 0.5;
    const range = flat ? money(s.avgAmount) : `${money(s.minAmount)}–${money(s.maxAmount)}`;
    items.push({
      id: `recurring:${s.vendorKey || s.id}`, urgency: WAIT.SOON,
      text: `${s.vendor} has charged you ${range} every month for the last ${s.count} months. Set it up as a regular charge, so it's always expected?`,
      actions: [{ kind: "recurring_yes", label: "Yes, set it up", suggestion: s }, { kind: "recurring_no", label: "No thanks", suggestion: s, secondary: true }],
    });
  }

  // ── INFO (an accountant's job; the owner may look) ──
  const q = uploadQueue || [];
  if (q.some((x) => x && x.status === "done" && x.type === "contract")) {
    items.push({ id: "contract_ready", urgency: WAIT.INFO,
      text: cockpit ? "A contract is ready to record." : "We've read your agreement — your accountant will record it.",
      actions: cockpit ? [{ kind: "nav", label: "Open Contracts", view: "contracts" }] : [] });
  }
  if (q.some((x) => x && x.status === "done" && x.type === "unknown")) {
    items.push({ id: "unknown_doc", urgency: WAIT.INFO,
      text: cockpit ? "Some documents need accountant review." : "We couldn't tell what one of your files was — your accountant will take a look.",
      actions: cockpit ? [{ kind: "nav", label: "Open Review", view: "review" }] : [] });
  }
  if (q.some((x) => x && x.status === "done" && x.type === "bank_statement" && x.result?.needsReview > 0)) {
    items.push({ id: "bank_review", urgency: cockpit ? WAIT.NOW : WAIT.INFO,
      text: cockpit ? "Some bank transactions need your review before they're added." : "A few things from your statement need a second look — your accountant is on it.",
      actions: cockpit ? [{ kind: "nav", label: "Review matches", view: "matching" }] : [] });
  }

  // Stable: urgency first, then the order the inputs arrived in.
  return items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => a.urgency - b.urgency || a._i - b._i).map(({ _i, ...it }) => it);
}

export function waitingHeadline(items = []) {
  const n = (items || []).length;
  if (!n) return null;
  const stops = items.filter((i) => i.urgency === WAIT.STOPS).length;
  const now = items.filter((i) => i.urgency <= WAIT.NOW).length;
  if (stops) return `${now} ${now === 1 ? "thing needs" : "things need"} an answer from you`;
  if (now) return `${now} ${now === 1 ? "thing is" : "things are"} waiting on you`;
  return `${n} ${n === 1 ? "thing" : "things"} worth a look`;
}
