import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// C613 — review findings F12 and U4: work that finished after a company switch landed in the
// company now on screen.
const app = readFileSync("src/App.jsx", "utf8");
const slice = (from, to) => app.slice(app.indexOf(from), app.indexOf(to, app.indexOf(from)));

describe("work started in one company never lands in another", () => {
  it("★ the company load's tail stops if the company changed during its helper loads", () => {
    const tail = slice("const helpers = await Promise.allSettled([", "setOnboardingUploadDone(");
    expect(tail).toMatch(/\]\);\s*\n(?:\s*\/\/[^\n]*\n)*\s*if \(!stillOn\(cid\)\) return;\s*\n\s*if \(helpers\[1\]\.status === "fulfilled"\) clientProfileRef\.current = helpers\[1\]\.value;/);
  });

  it("★ a chat answer that returns after a switch is dropped before any action runs", () => {
    const chat = slice("const handleChatSend = async", "// Execute actions");
    expect(chat).toMatch(/const sentCid = currentCompany\?\.id;/);
    expect(chat).toMatch(/if \(!stillOn\(sentCid\)\) \{ setChatLoading\(false\); return false; \}/);
  });

  it("chat history read late is not shown", () => {
    expect(slice("const loadChatHistory = async", "setChatHistory([")).toMatch(/if \(!stillOn\(cid\)\) return;/);
  });

  it("★ a contract read that finishes after a switch is not saved, and says so", () => {
    const c = slice("const handleContractFile = async", "const contract = aiJson(data1, {});");
    expect(c).toMatch(/const contractCid = currentCompany\?\.id;/);
    expect(c).toMatch(/if \(!stillOn\(contractCid\)\) \{[\s\S]*?setContractProcessing\(false\);\s*\n\s*return;/);
  });

  it("★ an upload read during a switch stops before it books or asks anything", () => {
    const u = slice("const processUploadItem = async", "const highConfidence = [];");
    expect(u).toMatch(/const itemCid = currentCompanyIdRef\.current;/);
    expect(u).toMatch(/if \(!stillOn\(itemCid\)\) \{\s*\n\s*logAudit\("upload_paused_company_switch"/);
  });

  it("★ learning is applied and saved only for the company still on screen, from a snapshot", () => {
    const l = slice("const recordBookingLearning = ", "// ── RECURRING EXPENSE DETECTION");
    expect(l).toMatch(/if \(!stillOn\(cid\)\) return;\s*\n\s*clientProfileRef\.current = learnFromBooking/);
    expect(l).toMatch(/if \(stillOn\(cid\)\) persistClientProfile\(supabase, cid, snapshot\);/);
    expect(l).not.toMatch(/persistClientProfile\(supabase, cid, clientProfileRef\.current\)/);
  });
});
