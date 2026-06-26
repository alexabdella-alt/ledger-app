import { describe, it, expect } from "vitest";
import { enterSupportState, exitSupportState } from "../src/lib/supportMode.js";

const admin = { id: "admin", name: "My Admin Co" };
const clientX = { id: "x", name: "Client X" };
const clientY = { id: "y", name: "Client Y" };

describe("support mode — Exit always returns to the admin's OWN company (O54b)", () => {
  it("entering support captures the current (admin) company as adminCompany", () => {
    const s = enterSupportState(null, clientX, admin);
    expect(s).toEqual({ company: clientX, adminCompany: admin });
  });

  it("exit resolves back to the captured admin company", () => {
    const s = enterSupportState(null, clientX, admin);
    expect(exitSupportState(s)).toEqual({ back: admin, supportMode: null });
  });

  it("NESTED entry (support→support) preserves the ORIGINAL admin, not a client (the bug)", () => {
    const s1 = enterSupportState(null, clientX, admin);      // admin → client X
    // While in support (currentCompany is now client X), enter support for client Y.
    const s2 = enterSupportState(s1, clientY, clientX);
    expect(s2.company).toBe(clientY);
    expect(s2.adminCompany).toBe(admin);                     // NOT clientX
    expect(exitSupportState(s2).back).toBe(admin);           // exit still returns to admin
  });

  it("a missing/invalid company is a no-op (keeps prev state)", () => {
    expect(enterSupportState(null, null, admin)).toBe(null);
    const s = enterSupportState(null, clientX, admin);
    expect(enterSupportState(s, {}, clientX)).toBe(s);
  });

  it("exit with no captured admin returns back:null (caller surfaces a fallback)", () => {
    expect(exitSupportState(null)).toEqual({ back: null, supportMode: null });
  });
});
