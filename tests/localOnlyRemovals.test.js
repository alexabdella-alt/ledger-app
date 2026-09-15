import { describe, it, expect } from "vitest";
import fs from "fs";

// ═════════════════════════════════════════════════════════════════════════════
// C398 — A REMOVAL A PERSON CLICKS IS A WRITE. Four controls filtered React state and
// nothing else: the Recurring screen's Pause/Resume and Delete (the delete even wrote an
// audit row), the bank-account × on Settings, and Review's Dismiss on an unclassified
// document. Each came back on reload; a "deleted" recurring charge kept posting.
// ═════════════════════════════════════════════════════════════════════════════
const read = (f) => fs.readFileSync(f, "utf8");
const app = read("src/App.jsx");
const gate = (src, start, gateText, endText) => {
  const i = src.indexOf(start); expect(i, start).toBeGreaterThan(-1);
  const body = src.slice(i, src.indexOf(endText, i));
  const g = body.indexOf(gateText); expect(g, gateText).toBeGreaterThan(-1);   // present BEFORE comparing (the −1 trap)
  return { body, g };
};

describe("★★ no view removes a persisted row from local state alone", () => {
  it("the four filters are gone", () => {
    expect(read("src/components/views/RecurringView.jsx")).not.toMatch(/setRecurring\(prev=>prev\.(filter|map)/);
    expect(read("src/components/views/SettingsView.jsx")).not.toMatch(/setBankAccounts\(prev=>prev\.filter/);
    expect(read("src/components/views/ReviewView.jsx")).not.toMatch(/const dismiss = \(\) => setUnknownDocs\(prev => prev\.filter/);
  });
  it("Recurring: pause/resume and delete go through verified writers, and the state moves only on ok", () => {
    const { body, g } = gate(app, "const setRecurringActive = async (r, active) => {", "if (res.ok) setRecurring(", "const removeRecurring");
    expect(body).toMatch(/updateVerified\(supabase, "recurring_transactions", r\.id, \{ active: !!active \}\)/);
    expect(g).toBeGreaterThan(body.indexOf("await updateVerified("));
    const d = gate(app, "const removeRecurring = async (r) => {", "if (res.ok) { setRecurring(", "const removeBankAccount");
    expect(d.body).toMatch(/deleteVerified\(supabase, "recurring_transactions", \{ id: r\.id, company_id: currentCompany\?\.id \}\)/);
    expect(d.g).toBeGreaterThan(d.body.indexOf("await deleteVerified("));
    expect(d.body.indexOf('logAudit("recurring_deleted"')).toBeGreaterThan(d.g);   // audit AFTER the write landed
  });
  it("Settings: a saved bank account is deactivated with a checked write (the load reads active=true)", () => {
    const { body, g } = gate(app, "const removeBankAccount = async (ba) => {", "if (r.ok) { setBankAccounts(", "// pause_recurring");
    expect(body).toMatch(/checkedRowUpdate\(\{ supabase, table: "bank_accounts", id: ba\.id, companyId: currentCompany\?\.id, patch: \{ active: false \}/);
    expect(g).toBeGreaterThan(body.indexOf("await checkedRowUpdate("));
    expect(app).toMatch(/\.from\("bank_accounts"\)\.select\("[^"]*"\)\.eq\("company_id", cid\)\.eq\("active", true\)/);   // the select string contains a ")" — accounts(code)
  });
  it("Review: dismiss writes dismissed:true through persistUnknownDocPatch before the row leaves the screen", () => {
    const v = read("src/components/views/ReviewView.jsx");
    const { body, g } = gate(v, "const dismiss = async () => {", "if (!r?.ok) {", "return (");
    expect(body).toMatch(/persistUnknownDocPatch\(doc, \{ dismissed: true \}\)/);
    expect(g).toBeLessThan(body.indexOf("setUnknownDocs(prev => prev.filter"));
  });
});

// C399 — the same shape with a paint-before-write instead of a paint-without-write.
describe("★ Send Invoice: the list reads paid only after the payment landed", () => {
  it("both branches call paintPaid() AFTER their write's verdict", () => {
    const v = read("src/components/views/SendInvoiceView.jsx");
    const i = v.indexOf("const markInvoicePaid = async (inv) => {"); expect(i).toBeGreaterThan(-1);
    const body = v.slice(i, v.indexOf("marked paid ✓", i));
    expect((body.match(/paintPaid\(\);/g) || []).length).toBe(2);
    const ar = body.indexOf("const ok = await markBillPaid("); expect(ar).toBeGreaterThan(-1);
    expect(body.indexOf("if (!ok) return;", ar)).toBeGreaterThan(ar);
    expect(body.indexOf("paintPaid();", ar)).toBeGreaterThan(body.indexOf("if (!ok) return;", ar));
    const legacy = body.indexOf("const jeId = await bookToDb(entry);"); expect(legacy).toBeGreaterThan(-1);
    expect(body.indexOf("paintPaid();", legacy)).toBeGreaterThan(body.indexOf("if (!jeId) return;", legacy));
    expect(body).not.toMatch(/markInvoicePaid = async \(inv\) => \{\s*setSentInvoices/);
  });
});

