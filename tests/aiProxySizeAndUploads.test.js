import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C634 — review finding S8 (security). Edge-function code: takes effect only when deployed.
const src = readFileSync("supabase/functions/ai-proxy/index.ts", "utf8");
const handler = src.slice(src.indexOf("serve(async (req) => {"));

describe("the AI service bounds a request and charges files as uploads", () => {
  it("★ the body is read once and refused above the ceiling, BEFORE the limiter charges anything", () => {
    expect(handler).toMatch(/const rawBody = await req\.text\(\);\s*\n\s*if \(rawBody\.length > MAX_REQUEST_CHARS\) \{\s*\n\s*return json\(\{ error: "That request is too large\. Please upload a smaller file\." \}, 413\);/);
    expect(handler.indexOf("MAX_REQUEST_CHARS")).toBeLessThan(handler.indexOf('admin.rpc("consume_rate_limit"'));
    expect((handler.match(/await req\.text\(\)/g) || []).length).toBe(1);
  });
  it("the ceiling is above the app's largest file as base64, and not far above", () => {
    const m = src.match(/const MAX_REQUEST_CHARS = (\d+) \* 1024 \* 1024;/);
    const cap = Number(m[1]);
    expect(cap * 1024 * 1024).toBeGreaterThan(15 * 1024 * 1024 * 4 / 3);
    expect(cap).toBeLessThanOrEqual(30);
  });
  it("★ a call carrying a document or image is an upload, whatever its headers say", () => {
    expect(handler).toMatch(/const isUpload = \(req\.headers\.get\("x-rate-kind"\) \|\| ""\)\.toLowerCase\(\) === "upload" \|\| carriesFile\(clientBody\);/);
    expect(src).toMatch(/return t === "document" \|\| t === "image";/);
  });
});
