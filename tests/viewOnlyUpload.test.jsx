import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";
import { VIEW_ONLY_UPLOAD_COPY } from "../src/lib/constants.js";

// C681 — a view-only teammate cannot record entries (098), so Home doesn't offer them a drop box that fails.
const render = (isViewer) => renderViewHtml(DashboardView, { ...POPULATED, ...(VIEW_CONTEXT["DashboardView.jsx"] || {}), isViewer, companyDataLoaded: true });
describe("★ the drop box and a view-only teammate", () => {
  it("a view-only teammate sees why, not a drop box", () => {
    const h = render(true);
    expect(h).toMatch(/data-view-only-upload/);
    expect(h).not.toMatch(/id="universal-upload-zone"/);
  });
  it("everyone else still has the drop box", () => {
    const h = render(false);
    expect(h).toMatch(/id="universal-upload-zone"/);
    expect(h).not.toMatch(/data-view-only-upload/);
  });
  it("and a file a viewer drops anyway is refused up front, before anything is queued", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/const handleUniversalUpload = \(files\) => \{\s*\n\s*if \(!files\?\.length\) return;[\s\S]{0,400}if \(isViewer\) \{ showNotification\(VIEW_ONLY_UPLOAD_COPY, "error"\); return; \}/);
    expect(VIEW_ONLY_UPLOAD_COPY).toMatch(/view-only access/);
  });
});
