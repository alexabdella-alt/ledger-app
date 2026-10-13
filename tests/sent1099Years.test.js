import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { sent1099For, verdictFor, plan1099ForYear, VERDICT } from "../src/lib/form1099.js";

describe("C573 — a 1099 marked sent is sent for THAT year, not every year", () => {
  it("last year's 2025 mark does not count as sent for 2026", () => {
    expect(sent1099For({ sent_1099_2025: true }, 2025)).toBe(true);
    expect(sent1099For({ sent_1099_2025: true }, 2026)).toBe(false);
  });
  it("the years list answers for each year it holds", () => {
    const c = { sent_1099_years: [2025, 2026] };
    expect(sent1099For(c, 2026)).toBe(true);
    expect(sent1099For(c, 2027)).toBe(false);
  });
  it("no year → not sent: a mark that can't say which year can't answer the question", () => {
    expect(sent1099For({ sent_1099_2025: true, sent_1099_years: [2025] }, null)).toBe(false);
  });
  it("a vendor sent a 1099 for 2025 is owed one again for 2026", () => {
    const contact = { name: "Ana Design", type: "vendor", business_type: "individual", sent_1099_2025: true };
    const payments = { byKind: { services: 2000 }, total: 2000 };
    expect(verdictFor(contact, payments, { year: 2025 }).verdict).toBe(VERDICT.ALREADY_SENT);
    expect(verdictFor(contact, payments, { year: 2026 }).verdict).not.toBe(VERDICT.ALREADY_SENT);
  });
  it("the yearly plan passes its year through", () => {
    const contacts = [{ name: "Ana Design", type: "vendor", business_type: "individual", sent_1099_years: [2025] }];
    const invoices = [{ vendor: "Ana Design", date: "2026-03-01", amount: 2000, gl_code: "6800" }];
    const chart = [{ code: "6800", system_role: "professional_services" }];
    const p = plan1099ForYear({ invoices, contacts, chart, year: 2026 });
    expect(p.rows[0].verdict).not.toBe(VERDICT.ALREADY_SENT);
    const p25 = plan1099ForYear({ invoices: [{ ...invoices[0], date: "2025-03-01" }], contacts, chart, year: 2025 });
    expect(p25.rows[0].verdict).toBe(VERDICT.ALREADY_SENT);
  });
  it("the screens and the chat read the year, never the 2025 flag directly", () => {
    for (const f of ["src/components/views/Tax1099View.jsx", "src/components/views/VendorsView.jsx", "src/lib/ai.js"]) {
      const src = readFileSync(f, "utf8").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/c\.sent_1099_2025\s*\?/);
    }
    const v = readFileSync("src/components/views/Tax1099View.jsx", "utf8");
    expect(v).toMatch(/sent1099For\(c, taxYear\)/);
    expect(v).toMatch(/if \(!sent1099For\(r\.row \|\| \{\}, taxYear\)\)/);   // reads the SAVED row
    const vendors = readFileSync("src/components/views/VendorsView.jsx", "utf8");
    expect(vendors).toMatch(/verdictFor\(vendor, reportablePayments\(rows, roleOfCode\), \{ year: year1099 \}\)/);
    expect(vendors).toMatch(/startsWith\(String\(year1099\)\)/);
  });
  it("migration 094 adds the list and carries every 2025 mark into it", () => {
    const m = readFileSync("supabase/migrations/094_contacts_1099_sent_years.sql", "utf8");
    expect(m).toMatch(/add column if not exists sent_1099_years integer\[\] not null default '\{\}'/);
    expect(m).toMatch(/where sent_1099_2025 is true/);
  });
});
