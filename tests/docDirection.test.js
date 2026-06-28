import { describe, it, expect } from "vitest";
import { normalizeName, companyIdentityNames, matchesIdentity, classifyDocDirection } from "../src/lib/docDirection.js";

// O75: anchor invoice direction on the company's own identity. Shakedown: with the
// company = "Northwind Studio", its OWN outgoing invoices were booked as expenses
// because nothing told the AI which party was "us".

describe("normalizeName — suffix/punctuation-insensitive identity matching", () => {
  it("strips legal suffixes + punctuation + case", () => {
    expect(normalizeName("Northwind Studio, LLC")).toBe("northwind studio");
    expect(normalizeName("Northwind Studio Inc.")).toBe("northwind studio");
    expect(normalizeName("ACME CORP")).toBe("acme");
  });
});

describe("companyIdentityNames — name + aliases", () => {
  it("includes the legal name and aliases (array or string)", () => {
    expect(companyIdentityNames({ name: "Northwind Studio", aliases: ["NWS", "Northwind"] }))
      .toEqual(expect.arrayContaining(["northwind studio", "nws", "northwind"]));
    expect(companyIdentityNames({ name: "Northwind Studio", aliases: "NWS, Northwind Design" }))
      .toEqual(expect.arrayContaining(["northwind studio", "nws", "northwind design"]));
  });
  it("empty when no name/aliases", () => {
    expect(companyIdentityNames({})).toEqual([]);
  });
});

describe("classifyDocDirection — the core fix", () => {
  const ids = companyIdentityNames({ name: "Northwind Studio" });

  it("invoice issued BY the company → revenue / AR (the shakedown bug)", () => {
    // Northwind's own invoice TO Acme — was wrongly booked as an expense.
    const d = classifyDocDirection({ issuer: "Northwind Studio", recipient: "Acme Corp", identityNames: ids });
    expect(d.direction).toBe("revenue");
    expect(d.side).toBe("ar");
  });

  it("bill addressed TO the company → expense / AP", () => {
    const d = classifyDocDirection({ issuer: "Verizon", recipient: "Northwind Studio LLC", identityNames: ids });
    expect(d.direction).toBe("expense");
    expect(d.side).toBe("ap");
  });

  it("same parties, opposite role → opposite direction (same-PDF problem)", () => {
    const asNorthwind = companyIdentityNames({ name: "Northwind Studio" });
    const asAcme = companyIdentityNames({ name: "Acme Corp" });
    const doc = { issuer: "Northwind Studio", recipient: "Acme Corp" };
    expect(classifyDocDirection({ ...doc, identityNames: asNorthwind }).direction).toBe("revenue");
    expect(classifyDocDirection({ ...doc, identityNames: asAcme }).direction).toBe("expense");
  });

  it("matches via an alias / partial name", () => {
    const aliased = companyIdentityNames({ name: "Northwind Studio", aliases: ["Northwind"] });
    expect(classifyDocDirection({ issuer: "Northwind", recipient: "Meridian Group", identityNames: aliased }).direction).toBe("revenue");
  });

  it("neither party is us → ambiguous (hold for review)", () => {
    expect(classifyDocDirection({ issuer: "Stripe", recipient: "Acme Corp", identityNames: ids }).direction).toBe("ambiguous");
  });

  it("no company identity configured → ambiguous (falls back to AI guess, current behavior)", () => {
    expect(classifyDocDirection({ issuer: "X", recipient: "Y", identityNames: [] }).direction).toBe("ambiguous");
    expect(classifyDocDirection({ issuer: "X", recipient: "Y", identityNames: [] }).reason).toBe("no_company_identity");
  });
});
