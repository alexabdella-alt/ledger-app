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
import { statementAccountQuestion, heldStatementAddCopy, cardStatementQuestion } from "./statementLifecycle.js";
import { countByUrgency, queueBannerCopy } from "./cardUrgency";
import { heldQuestionsCopy, heldUnreadableCopy, heldPartialCopy } from "./waitingOnYou";
import { unknownSenderCopy } from "../../supabase/functions/_shared/mailChannel.js";
import { fmtMoney } from "./format";
import { owedAmount } from "./reports.js";

export const WAIT = { STOPS: 0, NOW: 1, SOON: 2, INFO: 3 };
const money = (n) => fmtMoney(Number(n) || 0);

import { bankLinesWaitingCopy } from "./statementQuestions.js";

// C675 — "2 bills are due in the next 7 days ($1,240.00). Next: Adobe, $59.99, due Mon Nov 16."
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dueSoonCopy({ n = 0, total = 0, next = null } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(next?.due_date || ""));
  const when = m ? `${DOW[new Date(+m[1], +m[2] - 1, +m[3]).getDay()]} ${MON[+m[2] - 1]} ${+m[3]}` : "soon";
  const head = n === 1 ? `1 bill is due in the next 7 days (${fmtMoney(total)}).` : `${n} bills are due in the next 7 days (${fmtMoney(total)}).`;
  return next ? `${head} ${n === 1 ? "It's" : "Next:"} ${next.vendor || "a bill"}, ${fmtMoney(owedAmount(next))}, due ${when}.` : head;   // C725 — what's left on it
}

// ★ C702 — CUSTOMERS WHO ARE LATE PAYING YOU. Home spoke up about bills YOU owe (C675) and said
// nothing about money owed to YOU — the reminder email existed (C574) but only on the "owed to you"
// screen. One customer: their name, how late, and the reminder one tap away. Several: the count,
// the total, and the list. `late` rows: { customer, amount, daysLate, mailto }.
export function lateCustomersItem(late = []) {
  const rows = (late || []).filter((r) => r && Number(r.amount) > 0 && Number(r.daysLate) > 0);
  if (!rows.length) return null;
  const total = rows.reduce((t, r) => t + Number(r.amount), 0);
  const people = new Set(rows.map((r) => String(r.customer || "").trim().toLowerCase()));
  if (rows.length === 1) {
    const r = rows[0];
    return { id: "late_customers", urgency: WAIT.SOON,
      text: `${r.customer || "A customer"} is ${r.daysLate} day${r.daysLate === 1 ? "" : "s"} late paying you ${money(r.amount)}.`,
      link: r.mailto ? { label: "Send a reminder", url: r.mailto } : null,
      actions: [{ kind: "nav", label: "See who owes you", view: "ar", secondary: !!r.mailto }] };
  }
  const n = people.size;
  return { id: "late_customers", urgency: WAIT.SOON,
    text: `${n > 1 ? `${n} customers are` : `${rows[0].customer || "A customer"} is`} late paying you — ${money(total)} in total.`,
    actions: [{ kind: "nav", label: "Send reminders", view: "ar" }] };
}

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
  dueSoonBills = [],         // C675 — open A/P rows due in the next 7 days (not yet past due)
  lateInvoices = [],         // C702 — invoices customers are late paying: { customer, amount, daysLate, mailto }
  recurringSuggestions = [],
  uploadQueue = [],          // for the contract / unknown-doc prompts
  heldStatements = [],       // C588 — heldStatementQuestions(...): statements stored and waiting, from the record
  ownerBankLines = 0,        // C641 — bank lines the app couldn't categorise that an owner with no accountant can answer
  cockpit = false,           // reviewer seat: the accountant-side actions are theirs
  canInvite = true,          // C706 — a view-only teammate can't invite anyone (Team says "only the owner")
  hasAccountant = true,      // C574 — false: nobody else is on this company, so "your accountant will…" is a promise nobody keeps
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
  { const late = lateCustomersItem(lateInvoices); if (late) items.push(late); }   // C702
  // ★ C675 — BILLS COMING DUE, BEFORE THEY ARE LATE. Home only spoke up once a bill was already
  // overdue. The next seven days, with the soonest named, so paying on time needs no searching.
  if ((dueSoonBills || []).length) {
    const list = [...dueSoonBills].sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
    const n = list.length, total = list.reduce((t, i) => t + owedAmount(i), 0), next = list[0];   // C725
    items.push({
      id: "bills_due_soon", urgency: WAIT.SOON,
      text: dueSoonCopy({ n, total, next }),
      actions: [{ kind: "nav", label: "Pay or mark paid", view: "ap" }],
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

  // ── C587 — which account is this statement from? One item per waiting statement. ──
  for (const s of (uploadQueue || [])) {
    if (!s || s.status !== "done" || s.result?.to !== "choose" || !(s.result.accounts || []).length) continue;
    items.push({ id: `statement_account:${s.id}`, urgency: WAIT.NOW, text: s.result.cardHint ? cardStatementQuestion(s.name) : statementAccountQuestion(s.name),   // C708
      actions: s.result.accounts.map((a) => ({ kind: "statement_account", label: a.label, itemId: s.id, accountId: a.id, secondary: true })) });
  }

  // C588 — and the ones whose tile is gone (a reload, another device): asked from the held row.
  for (const h of (cockpit ? [] : heldStatements || [])) {
    if (!h || !(h.accounts || []).length) continue;
    items.push({ id: `statement_held:${h.intakeId}`, urgency: WAIT.NOW,
      text: h.mode === "choose" ? statementAccountQuestion(h.fileName) : heldStatementAddCopy(h.fileName),
      actions: h.accounts.map((a) => ({ kind: "statement_held", label: a.label, intakeId: h.intakeId, accountId: a.id, secondary: h.mode === "choose" })) });
  }

  // ── INFO (an accountant's job; the owner may look) ──
  // C574 — a solo owner was told "your accountant will…" with no buttons: a dead end dressed
  // as reassurance. Without an accountant the line says so and offers the way to get one.
  const invite = { kind: "nav", label: "Invite your accountant", view: "team" };
  const solo = !cockpit && !hasAccountant;
  const inviteIf = () => (canInvite ? [invite] : []);   // C706
  // C641 — an owner with no accountant answers their own uncategorised bank lines.
  if (solo && ownerBankLines > 0) {
    items.push({ id: "bank_answer", urgency: WAIT.NOW, text: bankLinesWaitingCopy(ownerBankLines),
      actions: [{ kind: "bank_answer", label: "Answer these" }] });
  }
  const q = uploadQueue || [];
  if (q.some((x) => x && x.status === "done" && x.type === "contract")) {
    items.push({ id: "contract_ready", urgency: WAIT.INFO,
      text: cockpit ? "A contract is ready to record." : solo ? "We've read your agreement and saved it in Documents. Recording a contract in your books is an accountant's job — invite yours and they'll take it from there." : "We've read your agreement — your accountant will record it.",
      actions: cockpit ? [{ kind: "nav", label: "Open Contracts", view: "contracts" }] : solo ? inviteIf() : [] });
  }
  if (q.some((x) => x && x.status === "done" && x.type === "unknown")) {
    items.push({ id: "unknown_doc", urgency: WAIT.INFO,
      text: cockpit ? "Some documents need accountant review." : solo ? "We couldn't tell what one of your files was. It's saved in Documents — an accountant can file it for you." : "We couldn't tell what one of your files was — your accountant will take a look.",
      actions: cockpit ? [{ kind: "nav", label: "Open Review", view: "review" }] : solo ? [{ kind: "nav", label: "Open Documents", view: "docs", secondary: true }, ...inviteIf()] : [] });
  }
  if (!(solo && ownerBankLines > 0) && q.some((x) => x && x.status === "done" && x.type === "bank_statement" && x.result?.needsReview > 0)) {   // C641 — not twice
    items.push({ id: "bank_review", urgency: cockpit ? WAIT.NOW : WAIT.INFO,
      text: cockpit ? "Some bank transactions need your review before they're added." : solo ? "A few things from your statement need a second look before they're added. An accountant reviews these — invite yours to finish them." : "A few things from your statement need a second look — your accountant is on it.",
      actions: cockpit ? [{ kind: "nav", label: "Review matches", view: "matching" }] : solo ? inviteIf() : [] });
  }

  // Stable: urgency first, then the order the inputs arrived in.
  return items.map((it, i) => ({ ...it, _i: i })).sort((a, b) => a.urgency - b.urgency || a._i - b._i).map(({ _i, ...it }) => it);
}

export function waitingHeadline(items = []) {
  const n = (items || []).length;
  if (!n) return null;
  const stops = items.filter((i) => i.urgency === WAIT.STOPS).length;
  const now = items.filter((i) => i.urgency <= WAIT.NOW).length;
  // ★ C642 — THE HEADLINE ACCOUNTS FOR EVERY ROW UNDER IT. It counted only the urgent rows, so
  // "1 thing is waiting on you" sat above two (the second only worth a look). The rest is said too.
  const rest = n - now;
  const more = now && rest ? ` · ${rest} more worth a look` : "";
  if (stops) return `${now} ${now === 1 ? "thing needs" : "things need"} an answer from you${more}`;
  if (now) return `${now} ${now === 1 ? "thing is" : "things are"} waiting on you${more}`;
  return `${n} ${n === 1 ? "thing" : "things"} worth a look`;
}
