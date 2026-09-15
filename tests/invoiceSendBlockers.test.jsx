import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { invoiceSendBlockers } from "../src/lib/invoiceDraft.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import SendInvoiceView from "../src/components/views/SendInvoiceView.jsx";

// ═════════════════════════════════════════════════════════════════════════════
// C412 — THE SEND BUTTON SAYS WHAT IS MISSING BEFORE THE CLICK, AND IS DISABLED UNTIL NOTHING IS.
// It was enabled over an incomplete draft and refused on click with a toast — O124.
// ═════════════════════════════════════════════════════════════════════════════
describe("invoiceSendBlockers", () => {
  it("names each missing thing in the owner's words, and is empty for a sendable draft", () => {
    const b = invoiceSendBlockers({ customer: "", customer_email: "" }, 0);
    expect(b).toHaveLength(3);
    for (const t of b) expect(containsOwnerJargon(t), t).toBe(false);
    expect(invoiceSendBlockers({ customer: "Acme", customer_email: "a@b.co" }, 120)).toEqual([]);
    expect(invoiceSendBlockers({ customer: "Acme", customer_email: "  " }, 120)).toEqual(["Add the customer's email address."]);
  });
});

describe("★★ rendered: the blockers are on screen and the button is disabled; a complete draft enables it", () => {
  const base = VIEW_CONTEXT["SendInvoiceView.jsx"];
  it("incomplete draft", () => {
    const html = renderViewHtml(SendInvoiceView, { ...base, sendInvoiceDraftState: { customer: "", customer_email: "", line_items: [{ description: "", amount: 0 }], tax_rate: "" } });
    expect(html).toContain("data-send-blockers");
    expect(html).toMatch(/Before you can send:/);
    expect(html).toMatch(/Add the customer(&#x27;|')s name\./);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-send-blocked="true"/);
  });
  it("complete draft", () => {
    const html = renderViewHtml(SendInvoiceView, { ...base, sendInvoiceDraftState: { customer: "Acme", customer_email: "a@b.co", line_items: [{ description: "Work", amount: 120 }], tax_rate: "" } });
    expect(html).not.toContain("data-send-blockers");
    expect(html).not.toContain('data-send-blocked="true"');
    expect(html).toMatch(/Send from my mail app →|Send Invoice →/);
  });
  it("the handler's guard is the same list (one function, two readers)", () => {
    const src = fs.readFileSync("src/components/views/SendInvoiceView.jsx", "utf8");
    const i = src.indexOf("const sendInvoice = async () => {");
    expect(i).toBeGreaterThan(-1);
    expect(src.slice(i, i + 300)).toMatch(/if \(sendBlockers\.length\) \{ showNotification\(sendBlockers\[0\], "error"\); return; \}/);
    expect(src).not.toMatch(/Add a customer name first/);
    // both Send buttons (form and preview) are disabled by the same list — the preview site
    // does not render in SSR (showPreview is state), so it is held by count
    expect((src.match(/disabled=\{sendBlockers\.length > 0\} data-send-blocked=/g) || []).length).toBe(2);
  });
});
