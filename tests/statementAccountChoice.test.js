import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { statementAccountChoices, statementAccountQuestion, autoBindAccount } from "../src/lib/statementLifecycle.js";
import { homeWaitingList, WAIT } from "../src/lib/homeWaiting.js";
import { queueItemTone, queueItemChip, queueCensus, queueSummaryCopy, QUEUE_TONE } from "../src/lib/uploadQueueTile.js";

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const checking = { id: id(1), name: "Chase Checking", type: "checking", last4: "4321" };
const card = { id: id(2), name: "Amex", type: "credit_card", last4: "1009" };
const savings = { id: id(3), name: "Rainy day", type: "savings" };

describe("C587 — with more than one account, Home asks which one a statement is from", () => {
  it("one account: nothing to ask — it is filed automatically, as before", () => {
    expect(statementAccountChoices([checking])).toEqual([]);
    expect(autoBindAccount([checking])).toBe(checking);
  });
  it("two or more: one choice per account, named so they can be told apart", () => {
    const c = statementAccountChoices([checking, card, savings]);
    expect(c).toEqual([
      { id: id(1), label: "Chase Checking (····4321)" },          // the name already says "checking"
      { id: id(2), label: "Amex (····1009 · credit card)" },
      { id: id(3), label: "Rainy day (savings)" },
    ]);
  });
  it("an account that has not loaded properly (no real id) is never offered", () => {
    expect(statementAccountChoices([checking, { id: "default", name: "Primary Checking" }])).toEqual([]);
    expect(statementAccountChoices([checking, card, { id: "default", name: "x" }]).map((c) => c.id)).toEqual([id(1), id(2)]);
  });

  const waiting = { id: "q1", name: "march.pdf", status: "done", type: "bank_statement", result: { routed: true, to: "choose", accounts: statementAccountChoices([checking, card]) } };
  it("the question is in Home's one list, with a button per account that carries the statement and the account", () => {
    const items = homeWaitingList({ uploadQueue: [waiting] });
    const q = items.find((i) => i.id === "statement_account:q1");
    expect(q.urgency).toBe(WAIT.NOW);
    expect(q.text).toBe(statementAccountQuestion("march.pdf"));
    expect(q.text).toMatch(/Which account is “march\.pdf” from\?/);
    expect(q.actions).toEqual([
      { kind: "statement_account", label: "Chase Checking (····4321)", itemId: "q1", accountId: id(1), secondary: true },
      { kind: "statement_account", label: "Amex (····1009 · credit card)", itemId: "q1", accountId: id(2), secondary: true },
    ]);
  });
  it("and it is NOT also told 'your accountant will…' — the generic statement line stays out of it", () => {
    const items = homeWaitingList({ uploadQueue: [waiting], hasAccountant: false });
    expect(items.map((i) => i.id)).toEqual(["statement_account:q1"]);
  });
  it("once answered (the tile moves on) the question is gone", () => {
    expect(homeWaitingList({ uploadQueue: [{ ...waiting, status: "processing", result: { to: "pipeline" } }] })).toEqual([]);
    expect(homeWaitingList({ uploadQueue: [{ ...waiting, result: { to: "pipeline", total: 20 } }] })).toEqual([]);
    // even if the list of accounts were still attached, a statement that has moved on asks nothing
    expect(homeWaitingList({ uploadQueue: [{ ...waiting, result: { ...waiting.result, to: "pipeline" } }] })).toEqual([]);
  });
  it("the tile reads as a question, not as finished — and the batch summary says so", () => {
    const tone = queueItemTone(waiting);
    expect(tone).toBe(QUEUE_TONE.REVIEW);
    expect(queueItemChip(tone, waiting)).toBe("Needs your answer");
    expect(queueSummaryCopy(queueCensus([waiting]))).toBe("1 document handled · 1 has a question for you");
    expect(queueItemChip(QUEUE_TONE.REVIEW, { result: {} })).toBe("⚠ Needs Review");   // the other kind of question is unchanged
  });

  const app = readFileSync("src/App.jsx", "utf8");
  it("the app: owners are asked (the accountant keeps Bank Import), the file is kept for the answer, and the statement is stored first", () => {
    expect(app).toMatch(/const accountChoices = navSeat\.isReviewerSeat \? \[\] : statementAccountChoices\(bankAccounts\);/);
    const stash = app.indexOf("markIntake(item.intake_id, INTAKE_STATUS.HELD, { detail: buildStashDetail(");
    const ask = app.indexOf("statementChoiceFilesRef.current[item.id] = file;");
    expect(stash).toBeGreaterThan(0);
    expect(ask).toBeGreaterThan(stash);      // stored and held BEFORE the question — an unanswered question loses nothing
  });
  it("the answer runs the SAME routine a single-account statement does, once", () => {
    expect(app).toMatch(/await fileDroppedStatement\(item, file, soleAccount\);/);
    expect(app).toMatch(/delete statementChoiceFilesRef\.current\[itemId\];\s*\/\/ one answer, one run[\s\S]{0,400}await fileDroppedStatement\(item, file, account\);/);
    expect(app).toMatch(/if \(!file \|\| !account \|\| !item\) \{ showNotification\("We couldn't find that statement any more/);
    const home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(home).toMatch(/a\.kind === "statement_account"\) await fileStatementTo\(a\.itemId, a\.accountId\)/);
  });
});
