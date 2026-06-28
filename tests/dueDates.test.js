import { describe, it, expect } from "vitest";
import { termsToDays, deriveDueDate } from "../src/lib/format.js";

describe("termsToDays — payment terms → net days (O11)", () => {
  it("parses Net N", () => {
    expect(termsToDays("Net 30")).toBe(30);
    expect(termsToDays("net15")).toBe(15);
    expect(termsToDays("NET 60")).toBe(60);
  });
  it("due-on-receipt / COD / immediate → 0", () => {
    expect(termsToDays("Due on receipt")).toBe(0);
    expect(termsToDays("COD")).toBe(0);
    expect(termsToDays("due immediately")).toBe(0);
  });
  it("early-pay discount terms use the NET term", () => {
    expect(termsToDays("2/10 Net 30")).toBe(30);
  });
  it("'N days' phrasing", () => {
    expect(termsToDays("45 days")).toBe(45);
  });
  it("unparseable / empty → null (don't guess)", () => {
    expect(termsToDays("")).toBe(null);
    expect(termsToDays(null)).toBe(null);
    expect(termsToDays("whenever")).toBe(null);
  });
});

describe("deriveDueDate — issue date + terms → due date", () => {
  it("Net 30 adds 30 days", () => {
    expect(deriveDueDate("2026-06-01", "Net 30")).toBe("2026-07-01");
  });
  it("Net 15 across a month boundary", () => {
    expect(deriveDueDate("2026-06-20", "Net 15")).toBe("2026-07-05");
  });
  it("Due on receipt → same day", () => {
    expect(deriveDueDate("2026-06-01", "Due on receipt")).toBe("2026-06-01");
  });
  it("returns null when terms don't parse or no date", () => {
    expect(deriveDueDate("2026-06-01", "")).toBe(null);
    expect(deriveDueDate("2026-06-01", "whenever")).toBe(null);
    expect(deriveDueDate("", "Net 30")).toBe(null);
    expect(deriveDueDate("not-a-date", "Net 30")).toBe(null);
  });
});
