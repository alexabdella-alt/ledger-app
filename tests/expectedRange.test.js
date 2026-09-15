import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { runAnomalyDetection } from "../src/lib/insights.js";
import { CARD_TAXONOMY } from "../src/lib/cardRate.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// C474 — "MIN EXPECTED ($)" / "MAX EXPECTED ($)" ON THE VENDORS AND CUSTOMERS FORMS WERE
// SAVED, LOADED, DISPLAYED, AND READ BY NOTHING. A person's stated band for a supplier is
// exactly the kind of fact a detector should prefer over a statistic; it has a reader now.
// ═════════════════════════════════════════════════════════════════════════════
const row = (id, vendor, amount, date, gl_code = "5010") => ({ id, db_entry_id: id, vendor, amount, date, gl_code, status: "posted", source: "universal_upload", type: gl_code[0] === "4" ? "revenue" : "expense", debit_credit: gl_code[0] === "4" ? "credit" : "debit" });
const now = new Date("2026-09-15T12:00:00Z");
const contacts = [{ name: "Sysco", type: "vendor", min_expected: 400, max_expected: 900 }, { name: "Acme Events", type: "customer", min_expected: 1000, max_expected: null }];

describe("C474 · outside_expected_range", () => {
  it("fires on a charge outside the declared band, with the band in the sentence", () => {
    const out = runAnomalyDetection([row("a", "Sysco", 2400, "2026-09-10"), row("b", "Sysco", 500, "2026-09-03")], [], now, { contacts });
    const hits = out.filter((x) => x.type === "outside_expected_range");
    expect(hits).toHaveLength(1);
    expect(hits[0].description).toMatch(/\$400\.00–\$900\.00/);
    expect(hits[0].invoice_ids).toEqual(["a"]);
    expect(hits[0].severity).toBe("medium");
    expect(containsOwnerJargon(hits[0].title)).toBe(false);
    expect(containsOwnerJargon(hits[0].description)).toBe(false);
  });
  it("a customer's band is checked against revenue rows; a one-sided band reads 'at least'", () => {
    const out = runAnomalyDetection([row("s", "Acme Events", 250, "2026-09-10", "4000")], [], now, { contacts });
    const hits = out.filter((x) => x.type === "outside_expected_range");
    expect(hits).toHaveLength(1);
    expect(hits[0].description).toMatch(/at least \$1,000\.00/);
  });
  it("silent without a band, without contacts, and inside the band", () => {
    expect(runAnomalyDetection([row("a", "Sysco", 2400, "2026-09-10")], [], now, {}).filter((x) => x.type === "outside_expected_range")).toEqual([]);
    expect(runAnomalyDetection([row("a", "Roma", 2400, "2026-09-10")], [], now, { contacts }).filter((x) => x.type === "outside_expected_range")).toEqual([]);
    expect(runAnomalyDetection([row("a", "Sysco", 850, "2026-09-10")], [], now, { contacts }).filter((x) => x.type === "outside_expected_range")).toEqual([]);
  });
  it("the runner is handed the contacts, the type is in the taxonomy, and the labels say what the band means", () => {
    const app = fs.readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/runAnomalyDetection\(invoicesRef\.current, recurringRef\.current, new Date\(\), \{ apCode: rc\("accounts_payable"\) \|\| null, contacts: contactsRef\.current \|\| \[\] \}\)/);
    expect(CARD_TAXONOMY.outside_expected_range).toBeTruthy();
    expect(fs.readFileSync("src/components/views/VendorsView.jsx", "utf8")).toMatch(/Usually charges at least/);
    expect(fs.readFileSync("src/components/views/CustomersView.jsx", "utf8")).toMatch(/Usually pays at least/);
  });
});
