// ─────────────────────────────────────────────────────────────────────────────
// C369 — A DOCUMENT WE COULD NOT READ IS NOT "ACCOUNTED FOR".
//
// Three hold paths park a file a person has to deal with; each wrote a sentence to the
// intake row and nothing read it. HELD is terminal, so after a reload the trust panel said
// "Everything you sent is accounted for — nothing missing" over a file that had become
// nothing at all. The row is the record; the card and the trust line read it.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { heldUnreadableRows, heldUnreadableCopy, isUnreadableHoldDetail, EXTRACT_FAILED_DETAIL, NOTHING_EXTRACTED_DETAIL, UNREADABLE_HOLD_PREFIX, CLARIFICATION_HOLD_DETAIL } from "../src/lib/waitingOnYou.js";
import { ownerTrustState } from "../src/lib/ownerTrust.js";
import { renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";
import DashboardView from "../src/components/views/DashboardView.jsx";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const row = (over = {}) => ({ id: "r1", status: "held_for_review", detail: EXTRACT_FAILED_DETAIL, filename: "blurry.jpg", document_id: "d1", ...over });

describe("heldUnreadableRows reads the three hold sentences and nothing else", () => {
  it("all three kinds are held-unreadable; a question, a payroll hold and a stash are not", () => {
    expect(heldUnreadableRows([row()])).toHaveLength(1);
    expect(heldUnreadableRows([row({ detail: NOTHING_EXTRACTED_DETAIL })])).toHaveLength(1);
    expect(heldUnreadableRows([row({ detail: `${UNREADABLE_HOLD_PREFIX}the file is corrupt` })])[0].reason).toBe("the file is corrupt");
    expect(heldUnreadableRows([row({ detail: CLARIFICATION_HOLD_DETAIL })])).toHaveLength(0);
    expect(heldUnreadableRows([row({ detail: "payroll register held for a person: x" })])).toHaveLength(0);
    expect(heldUnreadableRows([row({ status: "recorded" })])).toHaveLength(0);
    expect(isUnreadableHoldDetail("AI service error (429)")).toBe(false);
  });
  it("a row whose upload tile is on screen this session is left to the tile", () => {
    expect(heldUnreadableRows([row()], { uploadQueue: [{ id: 1, intake_id: "r1", status: "error" }] })).toHaveLength(0);
    expect(heldUnreadableRows([row()], { uploadQueue: [{ id: 1, intake_id: "r1", status: "processing" }] })[0].loading).toBe(true);
  });
  it("no stored file → not reloadable; the sentence names the files", () => {
    expect(heldUnreadableRows([row({ document_id: null })])[0].reloadable).toBe(false);
    expect(heldUnreadableCopy(heldUnreadableRows([row()]))).toBe("We couldn't read blurry.jpg — it isn't in your books. Try again, or send a clearer copy.");
    expect(heldUnreadableCopy(heldUnreadableRows([row(), row({ id: "r2", filename: "x.pdf" })]))).toMatch(/2 documents \(blurry\.jpg, x\.pdf\)/);
    expect(heldUnreadableCopy([])).toBe("");
  });
});

describe("the trust panel", () => {
  const base = { controlTotals: { failed: [], allTie: true }, intakeRows: [{ id: "r1", status: "recorded", journal_entry_ids: ["je1"] }], completenessChecked: true, reviewedThrough: "2026-07", hasBooks: true, setupComplete: true };
  it("reads 'accounted for' with no unreadable hold, and NOT with one", () => {
    const ok = ownerTrustState(base);
    expect(ok.lines.captured.text).toMatch(/accounted for/);
    const bad = ownerTrustState({ ...base, heldUnreadable: 1 });
    expect(bad.lines.captured.text).toBe("We couldn't read 1 document you sent — it isn't in your books yet.");
    expect(bad.lines.captured.state).toBe("attention");
    expect(bad.lines.captured.ok).toBe(false);
    expect(bad.overall).toBe("attention");
  });
});

describe("the wiring (source)", () => {
  const app = read("src/App.jsx");
  it("the three hold sites write the constants, and only a PERMANENT failure gets the unreadable prefix", () => {
    expect(app).toMatch(/INTAKE_STATUS\.HELD, \{ detail: EXTRACT_FAILED_DETAIL \}/);
    expect(app).toMatch(/INTAKE_STATUS\.HELD, \{ detail: NOTHING_EXTRACTED_DETAIL \}/);
    expect(app).toMatch(/detail: transient \? \(ai \? `\$\{ai\.kind\}: \$\{ai\.operator\}` : errMsg\) : `\$\{UNREADABLE_HOLD_PREFIX\}\$\{ai \? ai\.owner : errMsg\}`/);
    expect(app).not.toMatch(/detail: "couldn't extract invoice data — held for review"/);
    expect(app).not.toMatch(/detail: "no transaction extracted — needs review"/);
  });
  it("the trust panel is handed the count", () => {
    expect(app).toMatch(/heldUnreadable: heldUnreadable\.length,/);
    expect(app).toMatch(/const heldUnreadable = useMemo\(\(\) => heldUnreadableRows\(intakeRows, \{ uploadQueue \}\)/);
  });
});

describe("Home renders the card with the queue EMPTY (the state after a reload)", () => {
  const ctx = (heldUnreadable) => ({ ...POPULATED, ...VIEW_CONTEXT["DashboardView.jsx"], heldUnreadable });
  const strip = (h) => h.replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
  it("sentence + Try again for a reloadable row", () => {
    expect((POPULATED.uploadQueue || []).length).toBe(0);
    const html = strip(renderViewHtml(DashboardView, ctx(heldUnreadableRows([row()]))));
    expect(html).toContain("We couldn't read blurry.jpg");
    expect(html).toContain("Try again");
  });
  it("sentence and NO button when there is no stored file", () => {
    const html = strip(renderViewHtml(DashboardView, ctx(heldUnreadableRows([row({ document_id: null })]))));
    expect(html).toContain("We couldn't read blurry.jpg");
    expect(html).not.toContain(">Try again<");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C372 — a document WITH THE ACCOUNTANT to decide (a refused payroll register, a question the
// owner set aside) is not the owner's task, and not in the books either. The owner's line
// said "nothing missing" over it and the header could read all-clear.
// ─────────────────────────────────────────────────────────────────────────────
describe("C372 — accountant-held documents are not 'accounted for' either", () => {
  const base = { controlTotals: { failed: [], allTie: true }, intakeRows: [{ id: "r1", status: "recorded", journal_entry_ids: ["je1"] }], completenessChecked: true, reviewedThrough: "2026-07", hasBooks: true, setupComplete: true };
  it("the captured line names them and the header is not all-clear", () => {
    const t = ownerTrustState({ ...base, heldForAccountant: 2 });
    expect(t.lines.captured.text).toBe("2 documents are with your accountant to decide — not in your books yet.");
    expect(t.lines.captured.ok).toBe(false);
    expect(t.overall).toBe("attention");
    expect(t.nudge).toBeNull();   // not the owner's task — no button to press
    expect(ownerTrustState(base).lines.captured.text).toMatch(/accounted for/);
  });
  it("App feeds it from the same card builders Review renders (one definition of 'held for a person')", () => {
    const app = read("src/App.jsx");
    expect(app).toMatch(/heldForAccountant: heldPayrollCards\(intakeRows\)\.length \+ deferredToAccountantCards\(intakeRows\)\.length \+ signedPeriodHoldCards\(intakeRows\)\.length \+ pendingStatementStashes\(intakeRows\)\.length,/);   // C391 added the stash
  });
});
