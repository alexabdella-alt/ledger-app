// ★ C773 — THE FREE TRIAL IS 30 DAYS, everywhere it is set or promised; and the billing Terms are published.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TRIAL_DAYS } from "../src/lib/billing.js";

describe("C773 — 30 days, said the same way everywhere", () => {
  it("★★★ the app, the database trigger and the Terms agree", () => {
    expect(TRIAL_DAYS).toBe(30);
    expect(readFileSync("src/components/CompanySetup.jsx", "utf8")).toContain("trial_ends_at: new Date(Date.now() + TRIAL_DAYS*24*60*60*1000)");
    expect(readFileSync("supabase/migrations/103_trial_30_days.sql", "utf8")).toContain("now() + interval '30 days'");
    const terms = readFileSync("src/components/LegalView.jsx", "utf8");
    expect(terms).toContain("New accounts start with a 30-day free trial.");
    expect(terms).not.toMatch(/14-day free trial/);
  });
  it("★★ 103 is 102's function with only the interval changed", () => {
    const fn = (f) => { const s = readFileSync(f, "utf8"); return s.slice(s.indexOf("create or replace function public.start_company_trial()"), s.indexOf("$fn$;", s.indexOf("create or replace function public.start_company_trial()"))); };
    expect(fn("supabase/migrations/103_trial_30_days.sql")).toBe(fn("supabase/migrations/102_subscriptions_stripe_only.sql").replace("interval '14 days'", "interval '30 days'"));
  });
});

describe("C773 — the published billing Terms", () => {
  const t = readFileSync("src/components/LegalView.jsx", "utf8");
  it("★★ every decided term is there, and the 'will be finalized' placeholder is gone", () => {
    for (const x of ["7. Plans, trial and billing", "$25,000 in monthly business spending", "catch-up", "billed monthly in advance", "Cancellation takes effect at the end of the period you've paid for", "We don't give refunds or credits for partial months.", "within 14 days, your account may become read-only", "at least 30 days' notice"]) expect(t).toContain(x);
    expect(t).not.toContain("will be finalized here when paid plans launch");
  });
});
