import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { routeAIActions, replacesSavedValue, buildPendingConfirmation } from "../src/lib/aiActionGate";

// C633 — review finding S7: the assistant replaced rules / overwrote contact details / paused
// recurring charges with no confirm card.
const rules = [{ vendor: "Ace Plumbing", gl_code: "6250", gl_name: "Repairs" }];
const contacts = [{ name: "Ace Plumbing", email: "ap@ace.example", phone: "" }];
const route = (a) => routeAIActions([a], { rules, contacts });

describe("an action that replaces something saved asks first", () => {
  it("★ a DIFFERENT rule for a vendor that has one is staged, and the card says what changes", () => {
    const a = { type: "add_rule", vendor: "ACE PLUMBING", gl_code: "6800", gl_name: "Professional Services" };
    expect(route(a).stage).toEqual([a]);
    expect(buildPendingConfirmation([a], { rules, contactsList: contacts }).items[0].description).toBe("Change the rule for ACE PLUMBING from Repairs to Professional Services.");
  });
  it("the same rule again, or a rule for a new vendor, runs straight through", () => {
    expect(route({ type: "add_rule", vendor: "Ace Plumbing", gl_code: "6250" }).execute).toHaveLength(1);
    expect(route({ type: "add_rule", vendor: "New Co", gl_code: "6250" }).execute).toHaveLength(1);
  });
  it("★ changing a filled-in contact field is staged; filling an empty one is not", () => {
    expect(route({ type: "update_contact", name: "Ace Plumbing", updates: { email: "other@x.example" } }).stage).toHaveLength(1);
    expect(route({ type: "update_contact", name: "Ace Plumbing", updates: { phone: "555-0100" } }).execute).toHaveLength(1);
    expect(replacesSavedValue({ type: "update_contact", name: "Ace Plumbing", updates: { email: "other@x.example" } }, { contacts }).what).toBe("Change Ace Plumbing's saved email.");
  });
  it("★ pausing a recurring charge always asks", () => {
    expect(route({ type: "pause_recurring", name: "Adobe" }).stage).toHaveLength(1);
  });
  it("a blocked batch stages nothing (the reply refuses)", () => {
    expect(routeAIActions([{ type: "pause_recurring", name: "Adobe" }], { blocked: true, rules, contacts }).stage).toEqual([]);
  });
  it("★ the chat routes with the saved rules and contacts, and confirmed actions run through the same writers", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/routeAIActions\(result\.actions \|\| \[\], \{ blocked: gateBlocked, rules, contacts \}\)/);
    const exec = app.slice(app.indexOf("const executeDestructiveAction = async"), app.indexOf("const executeDestructiveAction = async") + 2500);
    for (const t of ["add_rule", "set_contact_rule", "update_contact", "pause_recurring"]) expect(exec).toMatch(new RegExp(`if \\(action\\.type === "${t}"\\) \\{`));
  });
});
