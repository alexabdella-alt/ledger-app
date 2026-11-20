// ★ C736 — phone-first: a photo or a screenshot goes straight in. On a phone the drop box offers
// "Take a photo" (the camera) and "Choose a screenshot or file" (the library); an oversized or HEIC
// photo is redrawn as a readable JPEG before the size/type check; the app installs to a home screen.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { shrinkPlan, shrunkName, isImageFile, SHRINK_MAX_EDGE } from "../src/lib/phoneImage.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { CLIENT_VIEW_IDS } from "../src/lib/nav.js";

describe("shrinking a phone photo", () => {
  it("★ a 12-megapixel photo comes down to the long edge, keeping its shape", () => {
    expect(shrinkPlan({ width: 4032, height: 3024, size: 4_000_000, type: "image/jpeg" })).toEqual({ shrink: true, width: 2400, height: 1800 });
    expect(shrinkPlan({ width: 3024, height: 4032, size: 4_000_000, type: "image/jpeg" })).toEqual({ shrink: true, width: 1800, height: 2400 });
  });
  it("a small image is left alone; a small but heavy one is re-encoded at its size", () => {
    expect(shrinkPlan({ width: 1200, height: 900, size: 300_000, type: "image/jpeg" })).toEqual({ shrink: false });
    expect(shrinkPlan({ width: 2000, height: 1500, size: 5_000_000, type: "image/png" })).toEqual({ shrink: true, width: 2000, height: 1500 });
  });
  it("★ an iPhone HEIC photo is always converted, even when small", () => {
    expect(shrinkPlan({ width: 1000, height: 800, size: 200_000, type: "image/heic" })).toEqual({ shrink: true, width: 1000, height: 800 });
    expect(shrinkPlan({ width: 1000, height: 800, size: 200_000, type: "", name: "IMG_1.HEIC" }).shrink).toBe(true);
  });
  it("unknown dimensions: left alone (the guard decides)", () => {
    expect(shrinkPlan({ width: 0, height: 0, size: 9_000_000 })).toEqual({ shrink: false });
  });
  it("names and kinds", () => {
    expect(shrunkName("IMG_2041.HEIC")).toBe("IMG_2041.jpg");
    expect(isImageFile({ type: "image/png" })).toBe(true);
    expect(isImageFile({ type: "application/pdf", name: "bill.pdf" })).toBe(false);
    expect(SHRINK_MAX_EDGE).toBe(2400);
  });
  it("★ the upload door shrinks BEFORE the size/type guard, and after the view-only refusal", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    const body = app.slice(app.indexOf("const handleUniversalUpload = async (files) => {"));
    const viewer = body.indexOf("if (isViewer)"), shrink = body.indexOf("shrinkImageFile(f)"), guard = body.indexOf('validateUpload(f, "universal")');
    expect(viewer).toBeGreaterThan(-1);
    expect(shrink).toBeGreaterThan(viewer);
    expect(guard).toBeGreaterThan(shrink);
  });
});

describe("the drop box on a phone", () => {
  const h = renderViewHtml(DashboardView, { ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], navSeat: { seat: "client", isReviewerSeat: false, sections: [], viewIds: CLIENT_VIEW_IDS }, companyDataLoaded: true });
  it("★ a camera input and two buttons — Take a photo, Choose a screenshot or file — shown on touch screens only", () => {
    expect(h).toMatch(/<input id="universal-camera" type="file" accept="image\/\*" capture="environment"/);
    expect(h).toContain("Take a photo");   // C762 — the camera is an icon, not 📷
    expect(h).toContain('data-icon="camera"');
    expect(h).toContain("Choose a screenshot or file");
    expect(h).toMatch(/data-phone-upload="?[^>]*class="sc-phone-only"|class="sc-phone-only"[^>]*data-phone-upload/);
    expect(h).toContain("@media (pointer: coarse)");
  });
  it("the file picker takes iPhone HEIC too", () => {
    expect(h).toMatch(/accept="[^"]*\.heic,\.heif/);
  });
});

describe("installable", () => {
  it("★ a manifest with icons, linked from the page", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(m.name).toBe("Shadow");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    for (const i of m.icons) expect([i.src, existsSync(`public${i.src}`)]).toEqual([i.src, true]);
    expect(m.icons.some((i) => i.purpose === "maskable")).toBe(true);
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).not.toMatch(/black-translucent/);   // would slide the page under the phone's status bar
    expect(html).not.toMatch(/autonomous AI controller/);
  });
});
