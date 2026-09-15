import { describe, it, expect } from "vitest";
import fs from "fs";

// C397 — the Supplier rules screen's Remove button writes through the same verified
// delete the chat's delete_rule uses. It was `setRules(r => r.filter(...))` — the row
// vanished, came back on reload, and kept coding that supplier's invoices meanwhile.
const view = fs.readFileSync("src/components/views/RulesView.jsx", "utf8");
const app = fs.readFileSync("src/App.jsx", "utf8");
describe("★ Remove on the rules screen is a write", () => {
  it("no local-only rule removal remains", () => {
    expect(view).not.toMatch(/setRules\(r=>r\.filter/);
  });
  it("the button awaits removeRule and gates the ✓ and the audit row on r.ok", () => {
    const btn = view.slice(view.indexOf("const r = await removeRule(rule.vendor);"), view.indexOf("Rule for ${rule.vendor} removed ✓"));
    expect(btn.length).toBeGreaterThan(50);
    const gate = btn.indexOf("if (!r?.ok) {");
    expect(gate).toBeGreaterThan(-1);   // -1 sorts before everything (the C393 trap)
    expect(gate).toBeLessThan(btn.indexOf('logAudit("rule_deleted"'));
    expect(btn).toMatch(/return; \}/);
  });
  it("removeRule IS the chat's deleteChatRule (one writer), which deletes through deleteVerified", () => {
    expect(app).toMatch(/removeRule: deleteChatRule,/);
    const fn = app.slice(app.indexOf("const deleteChatRule = async (vendor) => {"), app.indexOf("const persistChatRecurring"));
    expect(fn).toMatch(/deleteVerified\(supabase, "vendor_rules"/);
  });
});
