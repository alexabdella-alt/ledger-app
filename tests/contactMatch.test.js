// ─────────────────────────────────────────────────────────────────────────────
// C366 — AN EXTRACTED VENDOR NAME FINDS ITS CONTACT BY EXACT KEY, NEVER BY CONTAINMENT.
//
// The old rule (reproduced below, verbatim) is what `createOrUpdateContact` shipped with.
// It found "SYSCO" for an invoice from "SYSCO FUEL" — the pair vendorIdentity.test.js has
// forbidden merging since C202 — and enriched the wrong contact instead of creating one.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { findContactForName, contactKeyFor } from "../src/lib/contactMatch.js";
import { buildAliasIndex } from "../src/lib/vendorAlias.js";

const oldRule = (contacts, name) => {
  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const n = norm(name);
  return contacts.find((c) => { const cn = norm(c.name); return cn && (cn === n || cn.includes(n) || n.includes(cn)); }) || null;
};
const contacts = [{ id: 1, name: "SYSCO" }, { id: 2, name: "Lone Star" }, { id: 3, name: "Hill Country Milling Co." }, { id: 4, name: "Franklin Ave Properties", aliases: ["FRANKLIN AVE PROPERTIES LP RENT"] }];

describe("the anti-merge pairs the identity tests forbid are not merged here either", () => {
  it("the shipped rule DID merge them — demonstrated, not argued", () => {
    expect(oldRule(contacts, "SYSCO FUEL")?.name).toBe("SYSCO");
    expect(oldRule(contacts, "Lone Star Restaurant Supply")?.name).toBe("Lone Star");
  });
  it("the new rule does not", () => {
    expect(findContactForName(contacts, "SYSCO FUEL")).toBeNull();
    expect(findContactForName(contacts, "Lone Star Restaurant Supply")).toBeNull();
  });
});

describe("and it still finds the contact it should", () => {
  it("the same business under the spellings the resolver already unifies", () => {
    expect(findContactForName(contacts, "Sysco")?.id).toBe(1);
    expect(findContactForName(contacts, "Hill Country Milling")?.id).toBe(3);     // trailing Co. normalises away
    expect(findContactForName(contacts, "HILL COUNTRY MILLING CO")?.id).toBe(3);
  });
  it("a person-asserted alias joins (O111), which containment never could for a purpose word", () => {
    const idx = buildAliasIndex(contacts);
    expect(findContactForName(contacts, "ACH DEBIT - FRANKLIN AVE PROPERTIES LP RENT", idx)?.id).toBe(4);
    expect(findContactForName(contacts, "FRANKLIN AVE PROPERTIES LP RENT")).toBeNull();     // without the alias: two businesses until a person says otherwise
  });
  it("a name with no key finds nothing", () => {
    expect(findContactForName(contacts, "")).toBeNull();
    expect(contactKeyFor("   ")).toBeNull();
  });
});

describe("the writer uses it (source)", () => {
  it("createOrUpdateContact resolves through findContactForName and carries no containment rule", () => {
    const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
    const i = app.indexOf("const createOrUpdateContact = (data) => {");
    const body = app.slice(i, i + 1500);
    expect(body).toMatch(/const existing = findContactForName\(contacts, name, aliasIndex\);/);
    expect(body).not.toMatch(/cn\.includes\(n\) \|\| n\.includes\(cn\)/);
  });
});
