// ★ C765 — MORE LOGOS, STILL NO GUESSING: a saved email's domain (not a free mailbox), and a logo-only
// list of national brands matched strictly. A local supplier keeps its initials. Google's 16px "no icon"
// globe is treated as no logo. Logos also on the Money list and the transaction panel.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { vendorDomain, domainFromEmail, brandDomain, brandKey, domainFromWebsite } from "../src/lib/vendorLogo.js";
import VendorAvatar from "../src/components/VendorAvatar.jsx";

describe("C765 — where a domain comes from", () => {
  it("★★ a saved email's domain — but never a free mailbox", () => {
    expect(domainFromEmail("billing@acmeplumbing.com")).toBe("acmeplumbing.com");
    expect(domainFromEmail("ap@mail.sysco.com")).toBe("sysco.com");
    expect(domainFromEmail("someone@gmail.com")).toBeNull();
    expect(domainFromEmail("owner@icloud.com")).toBeNull();
    expect(domainFromEmail("not an email")).toBeNull();
    expect(vendorDomain({ name: "Acme Plumbing", email: "billing@acmeplumbing.com" })).toEqual({ domain: "acmeplumbing.com", source: "email" });
  });
  it("★★★ well-known brands — strictly: a one-word brand is the whole name; a longer one leads it", () => {
    expect(brandDomain("Apple Inc.")).toBe("apple.com");
    expect(brandDomain("Nike, Inc.")).toBe("nike.com");
    expect(brandDomain("Domino's Pizza")).toBe("dominos.com");
    expect(brandDomain("THE HOME DEPOT #4512")).toBe("homedepot.com");
    expect(brandDomain("Home Depot 4512 Austin TX")).toBe("homedepot.com");
    expect(brandDomain("Apple Bee Farms")).toBeNull();          // not Apple
    expect(brandDomain("Target Marketing Group")).toBeNull();   // not Target
    expect(brandDomain("Delta Plumbing")).toBeNull();           // not Delta
    expect(brandDomain("Hill Country Milling Co.")).toBeNull(); // a local supplier keeps its initials
    expect(brandKey("The Home Depot, Inc.")).toBe("home depot");
  });
  it("★★ the order: a person's website, then their email, then the directory, then the brand list", () => {
    expect(vendorDomain({ name: "Apple Inc.", website: "apple-reseller.example.org" }).source).toBe("contact");
    expect(vendorDomain({ name: "Apple Inc.", email: "x@reseller.biz" }).source).toBe("email");
    expect(vendorDomain({ name: "Apple Inc." })).toEqual({ domain: "apple.com", source: "brand" });
  });
  it("★ reserved names never belong to a real company", () => {
    expect(domainFromWebsite("hcm.test")).toBeNull();
    expect(domainFromEmail("ap@hcm.test")).toBeNull();
  });
});

describe("C765 — the avatar", () => {
  it("★★ a logo on a white tile, a crisp 128px image, the generic globe rejected, initials otherwise", () => {
    const h = renderToStaticMarkup(<VendorAvatar vendor={{ name: "Apple Inc." }} size={28} />);
    expect(h).toContain('data-vendor-logo="apple.com"');
    expect(h).toContain("sz=128");
    expect(h).toContain("background:#ffffff");
    expect(renderToStaticMarkup(<VendorAvatar vendor={{ name: "Hill Country Milling Co." }} />)).toContain('data-vendor-initials="HC"');
    expect(readFileSync("src/components/VendorAvatar.jsx", "utf8")).toContain("if ((e.currentTarget.naturalWidth || 0) <= 16) setFailed(true);");
  });
  it("★★ also on the Money list and the transaction panel", () => {
    expect(readFileSync("src/components/views/BooksView.jsx", "utf8")).toContain("<VendorAvatar vendor={contactByName.get(String(party||\"\").trim().toLowerCase()) || { name: party }} size={28}");
    expect(readFileSync("src/components/TransactionDetailPanel.jsx", "utf8")).toMatch(/<VendorAvatar vendor=\{\(contacts \|\| \[\]\)\.find/);
  });
});
