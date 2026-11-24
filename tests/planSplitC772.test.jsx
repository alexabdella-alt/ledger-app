// ★ C772 — STARTER / PRO, DEFINED BY WHERE THE OPERATOR'S TIME GOES (2026-11-21): Starter $99 is kept
// automatically (our team steps in only on what can't be answered automatically — no monthly review);
// Pro $279 adds the monthly review and close. Size limit $25,000/month; bigger gets a quote.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml } from "./helpers/renderView.jsx";
import BillingView from "../src/components/views/BillingView.jsx";
import { PLANS, PLAN_SPEND_LIMIT, sizeLimitCopy, PLANS_EXCLUDE } from "../src/lib/billing.js";
import { planBadge } from "../src/components/views/AdminView.jsx";

const starter = PLANS.find((p) => p.id === "starter");
const pro = PLANS.find((p) => p.id === "pro");

describe("C772 — the plans", () => {
  it("★★★ $99 and $279", () => {
    expect([starter.price, pro.price]).toEqual([99, 279]);
  });
  it("★★★ Starter promises NO monthly review; Pro does", () => {
    const s = starter.includes.join(" "), p = pro.includes.join(" ");
    expect(s).not.toMatch(/monthly review|every month/i);
    expect(s).toMatch(/steps in when something can't be answered automatically/);
    expect(p).toMatch(/monthly review and close/);
    expect(p).toMatch(/Year-end books ready/);
  });
  it("★★ the size limit and what neither plan includes", () => {
    expect(PLAN_SPEND_LIMIT).toBe(25000);
    expect(sizeLimitCopy()).toBe("For businesses spending up to $25,000 a month. Bigger business? Contact us for a quote.");
    expect(PLANS_EXCLUDE).toMatch(/filing tax returns, payroll, and catching up past years/);
  });
});

describe("C772 — the page", () => {
  it("★★ prices, each plan's list, the size limit and the exclusions", () => {
    const h = renderViewHtml(BillingView, { subscription: { status: "trialing", trial_ends_at: new Date(Date.now() + 9 * 86400000).toISOString() }, startCheckout: () => {}, openBillingPortal: () => {}, isOwner: true })
      .replace(/&#x27;/g, "'").replace(/<!-- -->/g, "");
    expect(h).toMatch(/\$99<span[^>]*> \/ month/);
    expect(h).toMatch(/\$279<span[^>]*> \/ month/);
    expect((h.match(/data-billing-includes/g) || []).length).toBe(2);
    expect(h).toContain("A monthly review and close of your books by our accounting team");
    expect(h).toContain("For businesses spending up to $25,000 a month.");
    expect(h).toContain('href="mailto:alexabdella@gmail.com?subject=Quote%20for%20a%20larger%20business"');   // C774
    expect(h).toContain("Not included in either plan");
  });
});

describe("C772 — the assistant says the same", () => {
  const g = readFileSync("supabase/functions/ai-proxy/aiProfiles.js", "utf8");
  it("★★★ 'who checks my books?' depends on the plan — no blanket 'checks every month'", () => {
    expect(g).not.toContain("our team (the Shadow team) checks every month");
    expect(g).toMatch(/On Starter \(\$99\/month\) the books are kept automatically .* there is no monthly review/);
    expect(g).toMatch(/On Pro \(\$279\/month\) our accounting team reviews and closes the books every month/);
  });
});

describe("C772 — the operator sees each client's plan", () => {
  const NOW = new Date("2026-11-21T12:00:00Z");
  it("★★ Pro / Starter / trial days / trial ended / canceled / past due", () => {
    expect(planBadge({ status: "active", plan: "pro" }, NOW)).toMatchObject({ t: "Pro", pro: true, warn: false });
    expect(planBadge({ status: "active", plan: "starter" }, NOW)).toMatchObject({ t: "Starter", pro: false });
    expect(planBadge({ status: "past_due", plan: "pro" }, NOW)).toMatchObject({ t: "Pro", warn: true });
    expect(planBadge({ status: "trialing", trial_ends_at: "2026-11-30T12:00:00Z" }, NOW)).toMatchObject({ t: "Trial · 9d", warn: false });
    expect(planBadge({ status: "trialing", trial_ends_at: "2026-01-01T00:00:00Z" }, NOW)).toMatchObject({ t: "Trial ended", warn: true });
    expect(planBadge({ status: "canceled" }, NOW)).toMatchObject({ t: "Canceled", warn: true });
    expect(planBadge(null)).toBeNull();
  });
  it("★ read on its own — a failed read shows no badge, never breaks the page", () => {
    const a = readFileSync("src/components/views/AdminView.jsx", "utf8");
    expect(a).toContain("if (off || !res || res.error) return;");
    expect(a).toContain("data-plan-badge");
  });
});
