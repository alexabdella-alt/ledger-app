import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { chatContactPatch } from "../src/lib/chatContactPatch";

// C609 — review finding F7: a vendor rule set through the assistant wiped the contact's details.
describe("an assistant write to an existing contact", () => {
  // Exactly the payload the save builds when the assistant gives a name and a category only.
  const fromRule = { company_id: "c1", name: "Ace Plumbing", type: "vendor", email: null, phone: null, payment_terms: null, notes: null, tags: [], expected_min: null, expected_max: null };

  it("★ a vendor rule (name + category only) changes NOTHING on the contact", () => {
    expect(chatContactPatch(fromRule, { typeGiven: false })).toEqual({});
  });

  it("only what was said is written", () => {
    expect(chatContactPatch({ ...fromRule, email: "ap@ace.example", tags: ["plumber"] }, { typeGiven: false }))
      .toEqual({ email: "ap@ace.example", tags: ["plumber"] });
  });

  it("the type changes only when one was stated", () => {
    expect(chatContactPatch({ ...fromRule, type: "customer" }, { typeGiven: true })).toEqual({ type: "customer" });
  });

  it("★ the save uses it for an existing contact, and a no-change write only reads the row back", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/const writePayload = existing && !updates \? chatContactPatch\(payload, \{ typeGiven: !!contact_type \}\) : payload;/);
    expect(app).toMatch(/if \(existing && !Object\.keys\(writePayload\)\.length\) \(\{ data: row, error \} = await supabase\.from\("contacts"\)\.select\("\*"\)\.eq\("id", existing\.id\)\.single\(\)\);\s*\n\s*else if \(existing\) \(\{ data: row, error \} = await supabase\.from\("contacts"\)\.update\(writePayload\)/);
  });
});
