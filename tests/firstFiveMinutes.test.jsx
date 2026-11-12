import { describe, it, expect } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "fs";
import AuthScreen from "../src/components/AuthScreen.jsx";
import CompanySetup from "../src/components/CompanySetup.jsx";
import {
  AUTH_TAGLINE, AUTH_FEATURES, AUTH_FOOTER, AUTH_HEADINGS, inviteRoleLabel, authFormProblem, confirmEmailCopy,
  companySetupCopy, CHECKLIST_COPY, BUSINESS_MODAL_INTRO, DROPZONE_COPY,
} from "../src/lib/firstRun.js";

const text = (h) => h.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const JARGON = /\b(GL|ledger|journal|ASC ?842|RLS|tenant|burn rate|runway|P&L|controller|accrual|debit|credit|workspace|fiscal|chart of accounts|reconcil\w*|posted?)\b/i;

describe("C583 — the sign-in page speaks to a business owner", () => {
  it("nothing it says about the product uses an accounting or engineering term", () => {
    for (const s of [AUTH_TAGLINE, AUTH_FOOTER, ...AUTH_FEATURES.flat(), ...Object.values(AUTH_HEADINGS).flatMap((h) => [h.title, h.sub])]) expect(s).not.toMatch(JARGON);
  });
  it("makes no compliance claim nobody has certified", () => {
    const page = text(renderToStaticMarkup(<AuthScreen onAuth={() => {}} invite={null} />));
    expect(page).not.toMatch(/compliant|ASC|RLS|tamper/i);
    expect(page).toContain(AUTH_FOOTER);
    expect(page).toContain(AUTH_FEATURES[0][0]);
  });
  it("an invite names the role as the person will hold it", () => {
    expect(inviteRoleLabel("accountant")).toBe("their accountant");
    expect(inviteRoleLabel("viewer")).toBe("a view-only member");
    expect(inviteRoleLabel("admin")).toBe("an admin");
    expect(inviteRoleLabel(undefined)).toBe("a member");
    const page = text(renderToStaticMarkup(<AuthScreen onAuth={() => {}} invite={{ status: "pending", companyName: "Riverside Bakery", role: "accountant" }} />));
    expect(page).toMatch(/invited to join Riverside Bakery as their accountant/);
  });
  it("an invited person lands on sign-up, with the password rule shown before they hit it", () => {
    const html = renderToStaticMarkup(<AuthScreen onAuth={() => {}} invite={{ status: "pending", companyName: "X", role: "viewer" }} />);
    expect(html).toContain("data-pw-hint");
    expect(text(html)).toMatch(/At least 6 characters\./);
    expect(html).toMatch(/autoComplete="new-password"|autocomplete="new-password"/i);
    expect(html).toMatch(/aria-label="Show password"/);
  });
  it("sign-in shows no password rule, and fills from a password manager", () => {
    const html = renderToStaticMarkup(<AuthScreen onAuth={() => {}} invite={null} />);
    expect(html).not.toContain("data-pw-hint");
    expect(html).toMatch(/autocomplete="current-password"/i);
    expect(html).toMatch(/autocomplete="email"/i);
  });
});

describe("C583 — on a phone the sign-in form comes first", () => {
  it("the two halves wrap in reverse, so the form is on top when they stack; a small logo shows only then", () => {
    const html = renderToStaticMarkup(<AuthScreen onAuth={() => {}} invite={null} />);
    expect(html).toMatch(/data-auth-layout[^>]*flex-wrap:wrap-reverse/);
    expect(html).toMatch(/\.sc-auth-mini\{display:none\}@media \(max-width:839px\)\{\.sc-auth-mini\{display:flex\}\}/);
    // the hero is still first in the markup — side by side on a wide screen, it stays on the left
    expect(html.indexOf("sc-float")).toBeLessThan(html.indexOf("sc-auth-mini"));
  });
});

describe("C583 — a form problem is said before the request, as what it is", () => {
  it("empty and malformed fields", () => {
    expect(authFormProblem({ mode: "login", email: "", password: "" })).toBe("Enter your email address first.");
    expect(authFormProblem({ mode: "login", email: "jane", password: "x" })).toMatch(/doesn't look like an email/);
    expect(authFormProblem({ mode: "login", email: "jane@x.co", password: "" })).toBe("Enter your password.");
    expect(authFormProblem({ mode: "signup", email: "jane@x.co", password: "" })).toMatch(/Choose a password/);
    expect(authFormProblem({ mode: "signup", email: "jane@x.co", password: "12345" })).toBe("Password must be at least 6 characters.");
  });
  it("a good form passes; a reset needs only the email; sign-in never judges password length", () => {
    expect(authFormProblem({ mode: "signup", email: " jane@x.co ", password: "123456" })).toBeNull();
    expect(authFormProblem({ mode: "reset", email: "jane@x.co" })).toBeNull();
    expect(authFormProblem({ mode: "login", email: "jane@x.co", password: "abc" })).toBeNull();
  });
  it("the screen asks it first, and after a sign-up that needs confirming it becomes the sign-in form", () => {
    const src = readFileSync("src/components/AuthScreen.jsx", "utf8");
    expect(src.indexOf("authFormProblem({ mode, email, password })")).toBeLessThan(src.indexOf("supabase.auth.signInWithPassword"));
    // …and a problem STOPS the request: nothing is sent, and the loading state never starts.
    expect(src).toMatch(/const problem = authFormProblem\(\{ mode, email, password \}\);\s*if \(problem\) \{ setError\(problem\); return; \}\s*setLoading\(true\);/);
    expect(src).toMatch(/setMode\("login"\); setPassword\(""\);\s*setMessage\(confirmEmailCopy\(email\)\);/);
    expect(confirmEmailCopy("jane@x.co")).toMatch(/confirmation link to jane@x\.co\. Click it, then sign in here/);
  });
});

describe("C583 — naming the business has a way out, and fits a phone", () => {
  const session = { user: { email: "jane@x.co" } };
  it("first time: asks what the business is called, and offers a way out of the wrong account", () => {
    const html = renderToStaticMarkup(<CompanySetup session={session} onComplete={() => {}} first onSignOut={() => {}} />);
    const t = text(html);
    expect(t).toContain(companySetupCopy({ first: true }).title);
    expect(t).toMatch(/Signed in as jane@x\.co\. Not you\? Sign out/);
    expect(html).not.toContain("data-setup-cancel");
    expect(t).not.toMatch(/Create your company|Acme Corp/);
  });
  it("adding another business: a way back to the books you were in", () => {
    const html = renderToStaticMarkup(<CompanySetup session={session} onComplete={() => {}} first={false} onCancel={() => {}} />);
    expect(text(html)).toMatch(/Add another business/);
    expect(text(html)).toMatch(/← Back to your books/);
    expect(html).not.toContain("data-setup-signout");
  });
  it("the card is as wide as the screen allows, never a fixed 440px", () => {
    const html = renderToStaticMarkup(<CompanySetup session={session} onComplete={() => {}} />);
    expect(html).toMatch(/width:100%;max-width:440px/);
  });
  it("the app passes both doors, by whether the person already has a business open", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/onCancel=\{hasCompany \? \(\) => setShowCompanySetup\(false\) : null\}/);
    expect(app).toMatch(/onSignOut=\{hasCompany \? null : handleSignOut\}/);
  });
});

describe("C583 — the first-run checklist and the upload box", () => {
  const home = readFileSync("src/components/views/DashboardView.jsx", "utf8");
  it("★ 'Upload your first bank statement' scrolls to the VISIBLE box — it used to target the hidden file input and do nothing", () => {
    expect(home).toMatch(/const scrollToUploadZone = \(\) => document\.getElementById\("universal-upload-zone"\)\?\.scrollIntoView/);
    expect(home).toMatch(/\.\.\.ONBOARDING_STEP_COPY\.upload,\s+go:\(\)=>scrollToUploadZone\(\)/);
    expect(home).not.toMatch(/getElementById\("universal-upload"\)\?\.scrollIntoView/);
    expect(home).toMatch(/id="universal-upload-zone"/);
  });
  it("each setup step says why it's asked; the questions say what they're for", () => {
    expect(CHECKLIST_COPY.biz.hint).toMatch(/right categories/);
    expect(CHECKLIST_COPY.bank.hint).toMatch(/which account a statement belongs to/);
    expect(BUSINESS_MODAL_INTRO).toMatch(/change them later in Settings/);
    for (const s of [CHECKLIST_COPY.biz.hint, CHECKLIST_COPY.bank.hint, BUSINESS_MODAL_INTRO, ...Object.values(DROPZONE_COPY)]) expect(s).not.toMatch(JARGON);
    expect(home).not.toMatch(/>Fiscal year end</);
  });
  it("a Save that can't be pressed looks it, and says what's missing", () => {
    expect(home).toMatch(/data-biz-save-hint/);
    expect(home).toMatch(/\?"var\(--sc-gold\)":"var\(--sc-border-2\)", border:"none", cursor:\(bizType\|\|companySettings\.businessType\)\?"pointer":"not-allowed"/);
  });
  it("the upload box says it can be clicked — a phone cannot drop", () => {
    expect(DROPZONE_COPY.choose).toMatch(/click to choose files/);
    expect(home).toMatch(/data-dropzone-choose[^>]*>\{DROPZONE_COPY\.choose\}/);
    expect(home).not.toMatch(/PROCESSING QUEUE/);
  });
});
