// ★ C758 — a "Full access" teammate (role `admin`: a partner or assistant) gets the OWNER'S app, not
// the accountant's workbench; and the operator's owner preview is remembered on the device.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { isReviewerSeat, visibleNav, navRedirect, REVIEWER_SEAT_ROLES } from "../src/lib/nav.js";

describe("C758 — who sits in the cockpit", () => {
  it("★★★ an admin teammate gets the owner's menu (Home · Money · Taxes · Reports · Ask)", () => {
    const nav = visibleNav({ role: "admin" });
    expect(nav.seat).toBe("client");
    expect(nav.sections.find((s) => s.id === "main").items.map(([id]) => id)).toEqual(["home", "money", "tax", "reports", "ask"]);
  });
  it("★★ and a workbench link sends them Home, like any owner", () => {
    expect(navRedirect("review", { role: "admin" })).toBe("home");
    expect(navRedirect("bank", { role: "admin" })).toBe("home");
  });
  it("★★ the cockpit is the accountant role and the Shadow team — exactly", () => {
    expect(REVIEWER_SEAT_ROLES).toEqual(["accountant"]);
    expect(isReviewerSeat({ role: "accountant" })).toBe(true);
    expect(isReviewerSeat({ role: "owner", isPlatformAdmin: true })).toBe(true);
    expect(isReviewerSeat({ role: "admin", isPlatformAdmin: true, previewAsOwner: true })).toBe(false);
  });
  it("★ the Team screen's 'Full access' is the admin role (the reason for this change)", () => {
    expect(readFileSync("src/components/views/TeamView.jsx", "utf8")).toContain('<option value="admin">Full access — a partner or assistant who helps run the books</option>');
  });
});

describe("C758 — the owner preview is remembered on this device", () => {
  const app = readFileSync("src/App.jsx", "utf8");
  it("★★ read on load and written on change, guarded (storage can be blocked)", () => {
    expect(app).toContain('useState(() => { try { return window.localStorage.getItem("sc_previewAsOwner") === "1"; } catch { return false; } })');
    expect(app).toContain('try { window.localStorage.setItem("sc_previewAsOwner", previewAsOwner ? "1" : "0"); } catch');
  });
});
