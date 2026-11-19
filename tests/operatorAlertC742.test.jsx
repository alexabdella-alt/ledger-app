// ★ C742 — the operator hears about a hole without going to look. (1) A status change meaning "this
// upload didn't reach the books and the owner can't fix it" raises an alert (Sentry → the operator's
// alert rule emails them) — after the write lands, with ids only. (2) A top-bar badge for the platform
// admin: "⚠ N clients need you", and a failed check reads "Couldn't check", never all-clear.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { intakeAlertKind, setIntakeAlertHandler, setIntakeStatus, INTAKE_STATUS } from "../src/lib/documentIntake.js";
import { operatorBadgeState } from "../src/components/OperatorAlertBadge.jsx";

const db = (row) => ({ from: () => { const q = { update: () => q, eq: () => q, select: () => q, single: async () => ({ data: row, error: null }) }; return q; } });
afterEach(() => setIntakeAlertHandler(null));

describe("which status changes alert the operator", () => {
  it("★ failed, given up after hours, and unreadable — nothing else", () => {
    expect(intakeAlertKind(INTAKE_STATUS.FAILED, "bank parse error: x")).toBe("upload_failed");
    expect(intakeAlertKind(INTAKE_STATUS.HELD, "Still not processed 37 hours after it arrived — handed to our team rather than retried again.")).toBe("upload_stale");
    expect(intakeAlertKind(INTAKE_STATUS.HELD, "couldn't extract invoice data — held for review")).toBe("upload_unreadable");
    expect(intakeAlertKind(INTAKE_STATUS.HELD, "1 question waiting")).toBe(null);
    expect(intakeAlertKind(INTAKE_STATUS.RECORDED)).toBe(null);
  });
  it("★ the alert fires after the write lands, with ids only (no filename)", async () => {
    const seen = [];
    setIntakeAlertHandler((a) => seen.push(a));
    const r = await setIntakeStatus(db({ id: "i1", company_id: "c1", status: "failed", filename: "Bank of X - Jane Doe.pdf" }), "i1", INTAKE_STATUS.FAILED, { detail: "bank parse error" });
    expect(r.ok).toBe(true);
    expect(seen).toEqual([{ kind: "upload_failed", intakeId: "i1", companyId: "c1" }]);
  });
  it("no alert when the write didn't land", async () => {
    const seen = [];
    setIntakeAlertHandler((a) => seen.push(a));
    const r = await setIntakeStatus(db({ id: "i1", company_id: "c1", status: "received" }), "i1", INTAKE_STATUS.FAILED, { detail: "x" });
    expect(r.ok).toBe(false);
    expect(seen).toEqual([]);
  });
  it("★ a handler that throws never breaks the write", async () => {
    setIntakeAlertHandler(() => { throw new Error("sentry down"); });
    const r = await setIntakeStatus(db({ id: "i1", company_id: "c1", status: "failed" }), "i1", INTAKE_STATUS.FAILED, { detail: "x" });
    expect(r.ok).toBe(true);
  });
  it("the app sends it to Sentry, one issue per company and kind, no filename", () => {
    const app = readFileSync("src/App.jsx", "utf8");
    expect(app).toMatch(/Sentry\.captureMessage\("upload_not_recorded", \{ level: "error", fingerprint: \["upload_not_recorded", kind, String\(companyId \|\| "unknown"\)\]/);
    const handler = app.slice(app.indexOf("setIntakeAlertHandler(({ kind, intakeId, companyId })"), app.indexOf("return () => setIntakeAlertHandler(null);"));
    expect(handler).not.toMatch(/filename|file_name|name:/);
  });
});

describe("the operator's top-bar badge", () => {
  const rep = (statuses) => ({ report: statuses.map((s, i) => ({ companyId: `c${i}`, name: `Co ${i}`, status: s, items: [], months: [] })) });
  it("★ says how many clients have something missing; nothing when none do", () => {
    expect(operatorBadgeState(rep(["problem", "problem", "complete"]))).toEqual({ tone: "problem", text: "⚠ 2 clients need you" });
    expect(operatorBadgeState(rep(["problem"]))).toEqual({ tone: "problem", text: "⚠ 1 client needs you" });
    expect(operatorBadgeState(rep(["attention", "complete"]))).toBe(null);
  });
  it("★ a check that couldn't run says so — never all-clear", () => {
    expect(operatorBadgeState({ failed: ["uploads (boom)"] })).toEqual({ tone: "unknown", text: "Couldn't check clients" });
    expect(operatorBadgeState({ loading: true })).toBe(null);
  });
  it("only the platform admin sees it, and not while previewing as the owner", () => {
    expect(readFileSync("src/App.jsx", "utf8")).toMatch(/\{isPlatformAdmin && !previewAsOwner && <span className="sc-hide-narrow"><OperatorAlertBadge supabase=\{supabase\} onOpen=\{\(\) => setView\("admin"\)\} \/><\/span>\}/);
  });
});
