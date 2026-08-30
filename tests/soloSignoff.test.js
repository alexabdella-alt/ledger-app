import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { canAttestPeriod, companyHasAttester } from "../src/lib/signoff";
import { ownerTrustState } from "../src/lib/ownerTrust";

const OWNER = { role: "owner", accepted_at: "2026-01-01" };
const ACCOUNTANT = { role: "accountant", accepted_at: "2026-01-01" };
const ADMIN = { role: "admin", accepted_at: "2026-01-01" };
const VIEWER = { role: "viewer", accepted_at: "2026-01-01" };

describe("O131 — who can actually sign a month off", () => {
  it("★ a solo owner's company has nobody who can — which is the whole finding", () => {
    expect(companyHasAttester([OWNER])).toBe(false);
    expect(canAttestPeriod("owner")).toBe(false);
  });

  it("an admin or an accountant counts; a viewer does not", () => {
    expect(companyHasAttester([OWNER, ACCOUNTANT])).toBe(true);
    expect(companyHasAttester([OWNER, ADMIN])).toBe(true);
    expect(companyHasAttester([OWNER, VIEWER])).toBe(false);
  });

  it("★ an UNACCEPTED invite is not a person — otherwise the promise returns with an extra step", () => {
    expect(companyHasAttester([OWNER, { role: "accountant", accepted_at: null }])).toBe(false);
  });

  it("an empty or malformed list is not an attester", () => {
    expect(companyHasAttester([])).toBe(false);
    expect(companyHasAttester([null, undefined, {}])).toBe(false);
    expect(companyHasAttester()).toBe(false);
  });
});

describe("O131 — the panel stops promising a review that cannot arrive", () => {
  const base = { controlTotals: { failed: [], allTie: true }, hasBooks: true, setupComplete: true };
  const lineFor = (over) => {
    const st = ownerTrustState({ ...base, ...over });
    return (st.lines.reviewed && (st.lines.reviewed.text || st.lines.reviewed)) || "";
  };

  it("★ a solo owner is told the position and the one thing that changes it", () => {
    const text = String(lineFor({ hasAttester: false, reviewedThrough: null }));
    expect(text).toMatch(/add your accountant/i);
    expect(text).not.toMatch(/awaiting your accountant/i);
  });

  it("★★ and it does NOT imply the books are wrong — nobody has reviewed them is a different fact", () => {
    const text = String(lineFor({ hasAttester: false, reviewedThrough: null }));
    expect(text).not.toMatch(/wrong|error|problem|incorrect|unreviewed risk/i);
  });

  it("★ an accountant-led company is untouched — without this, the fix is just deleting a sentence", () => {
    expect(String(lineFor({ hasAttester: true, reviewedThrough: null }))).toMatch(/awaiting your accountant/i);
  });

  it("★ the default is the OLD sentence, so a caller that has not checked cannot accidentally claim you have no accountant", () => {
    expect(String(lineFor({ reviewedThrough: null }))).toMatch(/awaiting your accountant/i);
  });

  it("what IS signed stays a fact even with no attester left", () => {
    // A company whose accountant has gone still genuinely had those months reviewed.
    expect(String(lineFor({ hasAttester: false, reviewedThrough: "2026-03" }))).toMatch(/signed off through/i);
  });
});

describe("the failure direction is pinned in the caller", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  const code = app.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

  it("★★ a FAILED membership query must not be read as 'you have no accountant'", () => {
    const at = code.indexOf("companyHasAttester(mem.data)");
    expect(at).toBeGreaterThan(-1);
    const around = code.slice(at - 200, at + 120);
    expect(around).toContain("!mem.error");                 // the error is checked…
    expect(code.slice(at, at + 160)).toContain("setHasAttester(true)");  // …and doubt keeps the old sentence
  });
});
