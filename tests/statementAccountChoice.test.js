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
    expect(app).toMatch(/const accountChoices = navSeat\.isReviewerSeat \? \[\] : cardHint \? \[[^\n]*\] : statementAccountChoices\(bankAccounts\);/);   // C708 — or the card question
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

import { heldStatementQuestions, heldStatementAddCopy, buildStashDetail } from "../src/lib/statementLifecycle.js";
import { keepUnanswered } from "../src/lib/uploadQueueTile.js";

describe("C588 — a held statement is asked about again, from the record", () => {
  const held = (n, name) => ({ id: `in${n}`, status: "held_for_review", document_id: `doc${n}`, filename: name, detail: buildStashDetail({ fileName: name }), received_at: `2026-11-0${n}T00:00:00Z` });
  it("two accounts: the same question, per waiting statement, newest first", () => {
    const qs = heldStatementQuestions({ intakeRows: [held(1, "feb.pdf"), held(2, "mar.pdf")], bankAccounts: [checking, card] });
    expect(qs.map((q) => [q.intakeId, q.mode, q.accounts.length])).toEqual([["in2", "choose", 2], ["in1", "choose", 2]]);
    const items = homeWaitingList({ heldStatements: qs });
    expect(items[0]).toMatchObject({ id: "statement_held:in2", urgency: WAIT.NOW, text: statementAccountQuestion("mar.pdf") });
    expect(items[0].actions[1]).toEqual({ kind: "statement_held", label: "Amex (····1009 · credit card)", intakeId: "in2", accountId: id(2), secondary: true });
  });
  it("one account: nothing to choose — one button that adds it", () => {
    const qs = heldStatementQuestions({ intakeRows: [held(1, "feb.pdf")], bankAccounts: [checking] });
    expect(qs).toEqual([{ intakeId: "in1", fileName: "feb.pdf", mode: "add", accounts: [{ id: id(1), label: "Add it to my books" }] }]);
    const [item] = homeWaitingList({ heldStatements: qs });
    expect(item.text).toBe(heldStatementAddCopy("feb.pdf"));
    expect(item.actions).toEqual([{ kind: "statement_held", label: "Add it to my books", intakeId: "in1", accountId: id(1), secondary: false }]);
  });
  it("a statement whose tile is still on screen is left to the tile — one question, not two", () => {
    expect(heldStatementQuestions({ intakeRows: [held(1, "feb.pdf")], bankAccounts: [checking, card], uploadQueue: [{ id: "q1", intake_id: "in1" }] })).toEqual([]);
  });
  it("only statements STILL held and stored count; no usable account → nothing is offered", () => {
    const recorded = { ...held(1, "feb.pdf"), status: "recorded" };
    const inReview = { ...held(2, "mar.pdf"), detail: "bank statement parsed — 20 line(s) in Bank Import review" };
    const noFile = { ...held(3, "apr.pdf"), document_id: null };
    expect(heldStatementQuestions({ intakeRows: [recorded, inReview, noFile], bankAccounts: [checking, card] })).toEqual([]);
    expect(heldStatementQuestions({ intakeRows: [held(1, "feb.pdf")], bankAccounts: [{ id: "default", name: "Primary Checking" }] })).toEqual([]);
  });
  it("the accountant's seat is not asked on Home — they pick it up in Bank Import", () => {
    const qs = heldStatementQuestions({ intakeRows: [held(1, "feb.pdf")], bankAccounts: [checking, card] });
    expect(homeWaitingList({ heldStatements: qs, cockpit: true })).toEqual([]);
  });
  it("Clear × keeps a tile that is still waiting for its answer, and nothing else", () => {
    const q = [{ id: "a", status: "done", result: { to: "pipeline" } }, { id: "b", status: "done", result: { to: "choose", accounts: [] } }, { id: "c", status: "error" }];
    expect(keepUnanswered(q).map((x) => x.id)).toEqual(["b"]);
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toMatch(/setUploadQueue\(prev => keepUnanswered\(prev\)\)/);
  });
  it("the app files it from the stored copy, under the SAME intake row, one run at a time", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    const i = app.indexOf("const fileHeldStatementTo = async (intakeId, accountId) => {");
    const fn = app.slice(i, app.indexOf("const processUploadItem", i));
    expect(fn).toMatch(/fetchStoredFile\(\{ supabase, documentId: row\.document_id \}\)/);
    expect(fn).toMatch(/await handleBankFile\(got\.file, account, \{ intakeId: row\.id \}\);/);
    expect(fn).toMatch(/if \(heldStatementRuns\.current\.has\(String\(intakeId\)\)\) return/);
    expect(fn).toMatch(/finally \{ heldStatementRuns\.current\.delete\(String\(intakeId\)\); \}/);
    const home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
    expect(home).toMatch(/a\.kind === "statement_held"\) await fileHeldStatementTo\(a\.intakeId, a\.accountId\)/);
    expect(home).toMatch(/heldStatements: cockpit \? \[\] : heldStatementQuestions\(/);
  });
});
