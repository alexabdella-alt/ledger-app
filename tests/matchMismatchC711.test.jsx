// C711 — the bank-match screen says a different amount before the click, and Confirm is off.
import { describe, it, expect, vi } from "vitest";
vi.mock("react-dom", async (orig) => ({ ...(await orig()), createPortal: (c) => c }));
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import MatchingView from "../src/components/views/MatchingView.jsx";

const bill = { id: "b1", vendor: "Acme", amount: 1000, date: "2026-05-01", type: "expense" };
const match = (amt) => ({ id: "m1", invoice_ids: ["b1"], match_type: "ap_clear", bank_txn: { amount: -amt, vendor: "ACME", description: "ACME", date: "2026-05-03" }, reasoning: "same vendor", confidence: 90 });
const render = (m) => renderViewHtml(MatchingView, { ...(VIEW_CONTEXT["MatchingView.jsx"] || {}), invoices: [bill], matchQueue: [m], matchHistory: [] }).replace(/<!-- -->/g, "");

describe("C711", () => {
  it("$980 against $1,000: the difference is said and Confirm is disabled", () => {
    const html = render(match(980));
    expect(html).toMatch(/data-amount-mismatch/);
    expect(html).toMatch(/The bank shows \$980\.00/);
    expect(html).toMatch(/<button disabled=""[^>]*>[^<]*✓ Confirm Match/);
  });
  it("equal amounts: no warning, Confirm enabled", () => {
    const html = render(match(1000));
    expect(html).not.toMatch(/data-amount-mismatch/);
    expect(html).not.toMatch(/<button disabled=""[^>]*>[^<]*✓ Confirm Match/);
  });
});
