import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C462 — the Settings screen summed bank_accounts.current_balance under "Total cash across
// accounts" — the one figure §12 says must never be shown as cash on hand (C331 removed the
// helper that did this). The line says what it is now, and points at the books.
describe("C462", () => {
  it("no screen labels the sum of stated bank balances as cash", () => {
    const sv = fs.readFileSync("src/components/views/SettingsView.jsx", "utf8");
    expect(sv).not.toMatch(/Total cash across accounts/);
    expect(sv).toMatch(/Statement balances you entered, added up/);
    expect(sv).toMatch(/Your cash on hand on Home comes from your books/);
  });
});
