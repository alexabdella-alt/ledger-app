import { describe, it, expect } from "vitest";
import fs from "node:fs";
// C424 scoped the "add your accountant" dismissal per company. ★ C739 — the step itself is gone (the
// Shadow team is every client's reviewer), so the dismissal state and its storage key went with it.
const src = fs.readFileSync("src/App.jsx", "utf8");
describe("C424 → C739", () => {
  it("no accountant-step dismissal is kept anywhere", () => {
    expect(src).not.toMatch(/accountantDismissKey|setAccountantDismissed|dismissAccountantStep/);
  });
});
