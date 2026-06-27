import { describe, it, expect } from "vitest";
import { pickActiveCompany } from "../src/lib/companies.js";

// Shakedown BUG 2: on refresh the app reset to the first company ("Test Corp ONE")
// instead of restoring the one the user was working in — a data-integrity hazard (a
// multi-company user could enter data against the wrong company's books). The active
// company is now persisted per user and restored via pickActiveCompany.
const cos = [
  { id: "one", name: "Test Corp ONE" },
  { id: "two", name: "Shadow Test Co 2" },
  { id: "three", name: "Third" },
];

describe("pickActiveCompany — restore the last-selected company on load", () => {
  it("restores the last-selected company (not the first) when it's still in the list", () => {
    expect(pickActiveCompany(cos, "two").id).toBe("two");
    expect(pickActiveCompany(cos, "three").id).toBe("three");
  });
  it("falls back to the first company when there's no saved selection", () => {
    expect(pickActiveCompany(cos, null).id).toBe("one");
    expect(pickActiveCompany(cos, "").id).toBe("one");
  });
  it("falls back to the first when the saved company is no longer accessible (access changed)", () => {
    expect(pickActiveCompany(cos, "removed-id").id).toBe("one");
  });
  it("matches on id regardless of string/number type", () => {
    expect(pickActiveCompany([{ id: 42, name: "Num" }, { id: 7 }], "42").id).toBe(42);
  });
  it("empty / missing list → null (no company)", () => {
    expect(pickActiveCompany([], "two")).toBe(null);
    expect(pickActiveCompany(null, "two")).toBe(null);
  });
});
