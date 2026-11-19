// ★ C747 — the owner's "What's changed" feed, read on the live app (2026-11-18): old payment rows said
// "<email> paid Nike, Inc. · $151.55 via BANK_TRANSFER" (a collection, a raw code), "… auto-matched &
// marked collected from bank statement (n/a)", and "paid Google LLC · $99.59" twice — the second one a
// click on a bill that was already paid, which recorded nothing new but logged a payment anyway.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ownerActivityText, plainPaymentWords } from "../src/lib/activityFeed.js";

const me = "owner@example.com";
describe("C747 — old payment lines in plain words", () => {
  it("★★ the reader is 'You'; Support Mode is 'Our team'; a teammate keeps their address", () => {
    expect(plainPaymentWords("owner@example.com paid Slack · $28.42 via ACH / Bank Transfer", { viewerEmail: "Owner@Example.com" })).toBe("You paid Slack · $28.42 via ACH / Bank Transfer");
    expect(plainPaymentWords("Platform Admin - ops@x.com paid Slack · $1.00", { viewerEmail: me })).toBe("Our team paid Slack · $1.00");
    expect(plainPaymentWords("pat@example.com paid Slack · $1.00", { viewerEmail: me })).toBe("pat@example.com paid Slack · $1.00");
  });
  it("★★ a raw method code reads as words; a pretty one is left alone", () => {
    expect(plainPaymentWords("You paid X · $1.00 via BANK_TRANSFER")).toBe("You paid X · $1.00 by bank transfer");
    expect(plainPaymentWords("You paid X · $1.00 via CHECK")).toBe("You paid X · $1.00 by check");
    expect(plainPaymentWords("You paid X · $1.00 via SOME_NEW_THING")).toBe("You paid X · $1.00 by some new thing");
    expect(plainPaymentWords("You paid X · $1.00 via ACH / Bank Transfer")).toBe("You paid X · $1.00 via ACH / Bank Transfer");
  });
  it("★★★ a collection is 'received a payment from', never 'paid'", () => {
    expect(ownerActivityText({ action: "invoice_collected", detail: `${me} paid Nike, Inc. · $151.55 via BANK_TRANSFER` }, { viewerEmail: me }))
      .toBe("You received a payment from Nike, Inc. · $151.55 by bank transfer");
    expect(ownerActivityText({ action: "invoice_paid", detail: `${me} paid Google LLC · $99.59 via ACH / Bank Transfer` }, { viewerEmail: me }))
      .toBe("You paid Google LLC · $99.59 via ACH / Bank Transfer");
  });
  it("★★ the auto-match line loses its jargon and its '(n/a)'", () => {
    expect(plainPaymentWords("Nike, Inc. · $151.55 auto-matched & marked collected from bank statement (n/a)"))
      .toBe("Nike, Inc. · $151.55 matched to your bank statement and marked received");
    expect(plainPaymentWords("Sysco · $9.00 auto-matched & marked paid from bank statement (n/a)"))
      .toBe("Sysco · $9.00 matched to your bank statement and marked paid");
  });
  it("★ anything else is untouched", () => {
    expect(plainPaymentWords("Recoded Sysco to Food Cost")).toBe("Recoded Sysco to Food Cost");
  });
});

describe("C747 — an already-paid click logs that nothing happened", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("★★★ it returns before the 'paid' log line, with its own action the owner's feed doesn't show", () => {
    const i = app.indexOf('logAudit("payment_already_recorded"');
    const j = app.indexOf('logAudit(side === "ar" ? "invoice_collected" : "invoice_paid"');
    expect(i).toBeGreaterThan(0);
    expect(j).toBeGreaterThan(i);
    expect(app.slice(i, j)).toMatch(/nothing new was recorded`[\s\S]*return "already";\s*\}/);
    expect(/paid|approv|reject|recode|void|flag|info_requested/i.test("payment_already_recorded")).toBe(false);   // Home's feed admits by these words
  });
  it("Home passes the reader's address", () => {
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toContain('ownerActivityText(a, { viewerEmail: session?.user?.email || "" })');
  });
});
