// ★ C734 — the chat's first words to a new owner: no "burn rate", "P&L", "AI Controller" or "AI CFO".
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { containsOwnerJargon } from "../src/lib/clarify.js";

const app = readFileSync("src/App.jsx", "utf8");
const greeting = (app.match(/const CHAT_GREETING = "([^"]+)";/) || [])[1] || "";

describe("the chat's first words", () => {
  it("★ the greeting is in an owner's words", () => {
    expect(greeting.length).toBeGreaterThan(40);
    expect(greeting).not.toMatch(/burn rate|P&L|runway|\bGL\b/i);
    expect(containsOwnerJargon(greeting)).toBe(false);
    expect(greeting).toMatch(/what you're spending, whether you made money, who owes you/);
  });
  it("the header and the info panel say what it is, not a job title", () => {
    expect(app).not.toMatch(/Your AI Controller|Your AI CFO/);
    expect(app).toContain("● Online · Your bookkeeping assistant");
  });
});
