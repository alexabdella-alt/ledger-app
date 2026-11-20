// ★ C770 — "PUT SHADOW ON YOUR HOME SCREEN": a card on Home, on a phone only, until installed or dismissed.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { phonePlatform, shouldOfferInstall, A2HS_COPY } from "../src/lib/installApp.js";

describe("C770 — when the card shows", () => {
  it("★★ which phone", () => {
    expect(phonePlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari" })).toBe("ios");
    expect(phonePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", maxTouchPoints: 5 })).toBe("ios");   // iPadOS
    expect(phonePlatform({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120" })).toBe("android");
    expect(phonePlatform({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome" })).toBe("other");
  });
  it("★★★ only on a phone, not once installed, not once dismissed", () => {
    const base = { isPhone: true, standalone: false, dismissed: false, platform: "ios" };
    expect(shouldOfferInstall(base)).toBe(true);
    expect(shouldOfferInstall({ ...base, isPhone: false })).toBe(false);
    expect(shouldOfferInstall({ ...base, standalone: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, dismissed: true })).toBe(false);
    expect(shouldOfferInstall({ ...base, platform: "other" })).toBe(false);
  });
  it("★ the steps name the real buttons", () => {
    expect(A2HS_COPY.ios.map((s) => s.text).join(" ")).toMatch(/Share.*Add to Home Screen.*Add/);
    expect(A2HS_COPY.android.map((s) => s.text).join(" ")).toMatch(/⋮.*Add to Home screen/);
  });
  it("★★ on Home; Android's one-tap install is used when the browser offers it; 'Not now' is remembered", () => {
    expect(readFileSync("src/components/views/DashboardView.jsx", "utf8")).toContain("<AddToHomeScreen />");
    const c = readFileSync("src/components/AddToHomeScreen.jsx", "utf8");
    expect(c).toContain('window.addEventListener("beforeinstallprompt"');
    expect(c).toContain("deferredPrompt.prompt()");
    expect(c).toContain('window.localStorage.setItem(A2HS_DISMISS_KEY, "1")');
  });
});
