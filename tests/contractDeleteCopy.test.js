import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C447 — the contract-delete confirmation said "permanently … removes it from the database
// permanently" over a soft delete that offers Undo.
describe("C447", () => {
  it("the confirmation describes the soft delete it performs", () => {
    const src = fs.readFileSync("src/components/views/ContractsView.jsx", "utf8");
    expect(src).not.toMatch(/Permanently delete|database permanently/);
    expect(src).toMatch(/The agreement stays in your audit trail — you can undo this right after/);
    // C721 — and it no longer claims the recorded entries leave the books; it says they stay, and where to delete them
    expect(src).not.toMatch(/It leaves your books/);
    expect(src).toMatch(/already recorded from it stay in your books — delete/);
    expect(src).toMatch(/Nothing from it has been recorded in your books yet\./);
    const app = fs.readFileSync("src/App.jsx", "utf8");
    const i = app.indexOf("const softDeleteContracts = ");
    expect(app.slice(i, i + 3000)).toMatch(/deleted_at: new Date\(\)\.toISOString\(\)/);
  });
});
