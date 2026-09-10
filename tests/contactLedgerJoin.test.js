import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { buildVendorSummary } from "../src/lib/vendorSummary.js";
import { vendorGroupKey, entityKeyFor } from "../src/lib/vendorIdentity.js";
import { buildAliasIndex, applyAlias } from "../src/lib/vendorAlias.js";

// ════════════════════════════════════════════════════════════════════════════
// C317 — JOINING A CONTACT TO ITS LEDGER SPEND.
//
// ★★★ `buildVendorSummary` GROUPS ON `vendor_key` AND LABELS EACH GROUP WITH THE
// MOST RECENT DISPLAY NAME (C210). So the label is a REAL string a person has
// seen — and it is not stable: a supplier billed as "Hill Country Milling Co." in
// January and "Hill Country Milling" in March is ONE group carrying the March
// spelling. Joining a contact to that by raw lower-cased name missed, and the
// Vendors screen rendered the supplier TWICE — once as a contact with no spend,
// once as a ledger group with no contact details.
//
// ★★ IT IS C316'S ASYMMETRY IN A SECOND PLACE: one side canonical, one side raw.
// The instability is what makes it worse than a merely narrow match — WHICH
// contacts join depends on which spelling happened to arrive last.
// ════════════════════════════════════════════════════════════════════════════

const row = (vendor, amount, date, extra = {}) => ({
  id: `${vendor}-${date}`, vendor, vendor_key: vendorGroupKey(vendor),
  amount, date, gl_code: "5010", type: "expense", status: "booked", ...extra,
});

describe("the join finds the spend", () => {
  it("★★ two spellings, one group, and the contact joins to it", () => {
    const rows = [row("Hill Country Milling Co.", 800, "2026-01-05"), row("Hill Country Milling", 900, "2026-03-05")];
    const summary = buildVendorSummary(rows, null);
    expect(summary).toHaveLength(1);
    expect(summary[0].name).toBe("Hill Country Milling");   // the March spelling — unstable by design
    expect(summary[0].total).toBe(1700);

    const contact = { id: "c1", name: "Hill Country Milling Co.", type: "vendor" };
    // What the screen did before: raw lower-case on both sides. It MISSES.
    expect(summary.find((v) => v.name?.toLowerCase() === contact.name?.toLowerCase())).toBeUndefined();
    // What it does now: the group's own key against the contact's key.
    const keyOf = (x) => vendorGroupKey(x) || String(x || "").trim().toLowerCase();
    const joined = summary.find((v) => v.key === keyOf(contact.name));
    expect(joined?.total).toBe(1700);
  });

  it("★★★ the alias index is honoured on BOTH sides, or a hand-made merge is exactly what breaks", () => {
    // O111: the operator asserts "FRANKLIN AVE PROPERTIES LP RENT" is Franklin Ave
    // Properties. `buildVendorSummary` applies that before grouping, so the group's key is
    // the CONTACT's key — and a join that skipped applyAlias would miss the one vendor a
    // person took the trouble to merge, which is the most visible way to be wrong.
    const contacts = [{ id: "c1", name: "Franklin Ave Properties", type: "vendor", aliases: ["Franklin Ave Properties LP Rent"] }];
    const idx = buildAliasIndex(contacts);
    const rows = [row("Franklin Ave Properties LP Rent", 2400, "2026-02-01")];
    const summary = buildVendorSummary(rows, idx);
    expect(summary).toHaveLength(1);
    const keyOf = (x) => applyAlias(vendorGroupKey(x) || String(x || "").trim().toLowerCase(), idx);
    expect(summary[0].key).toBe(keyOf(contacts[0].name));
    expect(summary.find((v) => v.key === keyOf(contacts[0].name))?.total).toBe(2400);
    // …and WITHOUT applyAlias on the contact side it still joins (a contact's own name is
    // not an alias) — the direction that breaks is the ROW side, which is why the summary
    // applies it there and this test uses the summary's own key rather than re-deriving it.
    expect(summary[0].key).not.toBe(vendorGroupKey("Franklin Ave Properties LP Rent"));
  });

  it("★ a genuinely different vendor still does NOT join — the merge stays a one-way door", () => {
    const summary = buildVendorSummary([row("Sysco", 500, "2026-01-01"), row("Sysco Fuel", 300, "2026-01-02")], null);
    expect(summary).toHaveLength(2);
    const keyOf = (x) => vendorGroupKey(x);
    expect(summary.find((v) => v.key === keyOf("Sysco"))?.total).toBe(500);
    expect(summary.find((v) => v.key === keyOf("Sysco Fuel"))?.total).toBe(300);
  });

  it("★★ the assumption the alias join rests on: a contact name keys the same way both helpers key it", () => {
    // `buildAliasIndex` uses `entityKeyFor(c.name)`; the views use `vendorGroupKey(c.name)`.
    // They agree for a bare name — which is what a contact name is — and the join is only
    // sound because they do. Pinned rather than assumed.
    for (const n of ["Hill Country Milling Co.", "Roma Cheese & Dairy Co.", "Sysco", "Alamo Ice & Beverage"])
      expect([n, vendorGroupKey(n)]).toEqual([n, entityKeyFor(n)]);
  });
});

describe("the screens are wired to it", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
  const v = strip(fs.readFileSync(new URL("../src/components/views/VendorsView.jsx", import.meta.url), "utf8"));
  const c = strip(fs.readFileSync(new URL("../src/components/views/CustomersView.jsx", import.meta.url), "utf8"));

  it("★ neither screen joins a contact to the ledger by raw lower-cased name any more", () => {
    for (const [name, src] of [["VendorsView", v], ["CustomersView", c]]) {
      expect([name, /c\.name\?\.toLowerCase\(\)\s*===\s*v\.name\?\.toLowerCase\(\)/.test(src)]).toEqual([name, false]);
      expect([name, /v\.name\?\.toLowerCase\(\)\s*===\s*c\.name\?\.toLowerCase\(\)/.test(src)]).toEqual([name, false]);
      expect([name, /c\.name\?\.toLowerCase\(\)\s*===\s*name\?\.toLowerCase\(\)/.test(src)]).toEqual([name, false]);
    }
  });

  it("★ both derive the key through applyAlias, so a hand-made merge survives the join", () => {
    for (const [name, src] of [["VendorsView", v], ["CustomersView", c]]) {
      expect([name, /applyAlias\(vendorGroupKey\(x\)/.test(src)]).toEqual([name, true]);
      expect([name, /aliasIndex/.test(src)]).toEqual([name, true]);
    }
  });

  it("★ the dead `ledgerVendors` filter is gone, not repaired", () => {
    expect(v).not.toMatch(/const ledgerVendors =/);
  });
});
