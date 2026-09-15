import { describe, it, expect } from "vitest";
import fs from "fs";
import { domainFromWebsite, logoUrlFor, vendorDomain, vendorLogo } from "../src/lib/vendorLogo.js";
import { DIRECTORY_SEED } from "../src/lib/vendorDirectory.js";
import { renderViewHtml } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import VendorsView from "../src/components/views/VendorsView.jsx";
import VendorAvatar from "../src/components/VendorAvatar.jsx";
import React from "react";
import { renderToString } from "react-dom/server";

// ═════════════════════════════════════════════════════════════════════════════
// C395 — A LOGO ONLY WHERE THE DOMAIN IS KNOWN, NEVER GUESSED FROM A NAME.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ domains come from two places and nowhere else", () => {
  it("a directory vendor resolves to its curated domain", () => {
    expect(vendorDomain({ name: "ACH DEBIT - SYSCO FOODS #4417" })).toEqual({ domain: "sysco.com", source: "directory" });
    expect(vendorDomain({ name: "SQUAREUP INC" })?.domain).toBe("squareup.com");
  });
  it("a contact's typed website wins, however it was typed", () => {
    expect(vendorDomain({ name: "Hill Country Milling", website: "https://www.hillcountrymilling.com/about" })).toEqual({ domain: "hillcountrymilling.com", source: "contact" });
    expect(domainFromWebsite("Sysco.COM/")).toBe("sysco.com");
    expect(domainFromWebsite("not a website")).toBeNull();
    expect(domainFromWebsite("")).toBeNull();
  });
  it("★ an unknown vendor with no website gets NO domain — the name is never turned into one", () => {
    expect(vendorDomain({ name: "Hill Country Milling Co." })).toBeNull();
    expect(vendorLogo({ name: "Culinary Edge Consulting" })).toBeNull();
    // and the anti-merge pairs the directory refuses stay refused here too
    expect(vendorDomain({ name: "SYSCO FUEL" })).toBeNull();
    expect(vendorDomain({ name: "SQUARE DANCE HALL" })).toBeNull();
  });
  it("every directory row carries a real domain (a national vendor without one is a curation gap)", () => {
    for (const e of DIRECTORY_SEED) expect(domainFromWebsite(e.domain), e.entity_key).toBeTruthy();
  });
  it("the URL carries only the domain, encoded", () => {
    expect(logoUrlFor("sysco.com")).toBe("https://www.google.com/s2/favicons?domain=sysco.com&sz=64");
    expect(logoUrlFor("junk")).toBeNull();
    expect(vendorLogo({ name: "Sysco" }).url).not.toMatch(/amount|company|Sysco/);
  });
});

describe("★ the avatar renders a logo for a known vendor and initials for the rest", () => {
  const text = (h) => h;
  it("known → <img> from the domain; unknown → initials", () => {
    const known = renderToString(React.createElement(VendorAvatar, { vendor: { name: "Sysco" } }));
    expect(known).toMatch(/<img[^>]+sysco\.com/);
    expect(known).toContain('data-vendor-logo="sysco.com"');
    const unknown = renderToString(React.createElement(VendorAvatar, { vendor: { name: "Hill Country Milling" } }));
    expect(unknown).not.toContain("<img");
    expect(unknown).toContain('data-vendor-initials="HC"');
  });
  it("the Vendors tab renders through the component (both the list and the detail header)", () => {
    const src = fs.readFileSync("src/components/views/VendorsView.jsx", "utf8");
    expect((src.match(/<VendorAvatar /g) || []).length).toBe(2);
    expect(src).not.toMatch(/initials\(v\.name\)/);
    const html = text(renderViewHtml(VendorsView, { ...POPULATED }));
    expect(html).toMatch(/data-vendor-(initials|logo)=/);
  });
});
