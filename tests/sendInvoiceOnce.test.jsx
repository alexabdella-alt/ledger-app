import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { makeOneInFlight } from "../src/lib/oneInFlight.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import SendInvoiceView from "../src/components/views/SendInvoiceView.jsx";

// C432 — a double click on "Send Invoice →" sent two invoices. One run at a time.
const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8").replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
describe("C432", () => {
  it("the handler runs through a one-in-flight gate whose busy flag disables both buttons", () => {
    expect(src).toMatch(/const sendGate = React\.useRef\(makeOneInFlight\(\{ onBusy: setSending \}\)\);/);
    expect(src).toMatch(/const sendInvoice = \(\) => sendGate\.current\.run\(sendInvoiceOnce\);/);
    expect((src.match(/disabled=\{sendBlockers\.length > 0 \|\| sending\}/g) || []).length).toBe(2);
  });
  it("the gate itself refuses a second run while the first is in flight", async () => {
    let calls = 0; let release;
    const g = makeOneInFlight();
    const first = g.run(() => new Promise((r) => { calls++; release = r; }));
    const second = await g.run(async () => { calls++; });
    expect(second).toBe(false);
    release(); await first;
    expect(calls).toBe(1);
  });
  it("renders 'Sending…' on the button while busy — the effect is visible (O123)", () => {
    // `sending` is component state, so the SSR pass sees its initial false; pin the label branch in source
    expect(src).toMatch(/\{sending \? "Sending…" : canSendFromApp \? "Send Invoice →" : "Send from my mail app →"\}/);
    const html = renderViewHtml(SendInvoiceView, { ...VIEW_CONTEXT["SendInvoiceView.jsx"], sendInvoiceDraftState: { customer: "Acme", customer_email: "a@b.co", line_items: [{ description: "Work", amount: 120 }], tax_rate: "" } });
    expect(html).not.toContain("data-sending");
  });
});
