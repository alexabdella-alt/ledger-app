import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { PAYROLL_HOLD_PREFIX, payrollHoldDetail, heldPayrollCards, matchingCard, waitingOnYou, waitingCopy, heldRegistersToReload } from "../src/lib/waitingOnYou.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C322 — THE ISSUE LINKS TO THE TOOL. Review used to carry a four-button strip
// (C320) because Payroll had no other door; the operator's call was "get rid of
// the strip, link from the issues instead." These pin the cards that replaced it.
// ════════════════════════════════════════════════════════════════════════════

const gate = [{ text: "The register doesn't foot: gross $4,000.00 less withholdings $850.00 is $3,150.00, but it states net pay of $3,200.00." }];

describe("a held payroll register is an ISSUE on Review, read from the durable row", () => {
  it("the hold path's detail round-trips into a card carrying the gate's own reasons", () => {
    const detail = payrollHoldDetail(gate);
    const cards = heldPayrollCards([{ id: "i9", status: "held_for_review", detail, filename: "gusto-0831.csv", received_at: "2026-09-01T00:00:00Z" }]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ kind: "payroll_held", goTo: "payroll", filename: "gusto-0831.csv" });
    expect(cards[0].reasons).toBe(gate[0].text);              // the recorded words, not re-derived
  });

  it("★★ the WRITER in App.jsx uses the same function — one contract, not two strings (·3a)", () => {
    // The hold path used to write "payroll imported — review/post in Payroll" and put WHY
    // only in the audit log. A reader matching that string and a writer emitting it would
    // each pass their own test while the reasons never reached the record.
    const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    expect(app).toMatch(/INTAKE_STATUS\.HELD, \{ detail: payrollHoldDetail\(gate\.reasons\) \}/);
    expect(app).not.toMatch(/payroll imported — review\/post in Payroll/);
  });

  it("a HELD row written by any OTHER path is not a payroll card, however it is worded", () => {
    const rows = [
      { id: "a", status: "held_for_review", detail: "awaiting clarification in review queue" },
      { id: "b", status: "held_for_review", detail: "routed to payroll importer" },   // says "payroll", is not the hold path
      { id: "c", status: "recorded", detail: PAYROLL_HOLD_PREFIX + "x" },              // right prefix, wrong status
    ];
    expect(heldPayrollCards(rows)).toEqual([]);
  });

  it("a hold with no stated reason still says something true", () => {
    expect(payrollHoldDetail([])).toBe(`${PAYROLL_HOLD_PREFIX}the register did not pass every shape check.`);
  });
});

describe("★★ the fetch carries every column the card reads — or the card silently never appears", () => {
  it("fetchIntakeRows selects id, status, detail, filename and received_at", () => {
    // A mutation dropping `detail` from the select left the whole suite green: the DDL guard
    // (C308) proves the columns EXIST, not that the reader's columns are FETCHED. With
    // `detail` absent every held register reads as "not a payroll hold", no card renders,
    // and Payroll's only door vanishes with nothing on any screen to say so. The reader
    // names what it needs; the query must carry it.
    const src = fs.readFileSync(new URL("../src/lib/documentIntake.js", import.meta.url), "utf8");
    const m = src.match(/export async function fetchIntakeRows[\s\S]*?\.select\("([^"]+)"\)/);
    expect(m).not.toBeNull();
    const cols = m[1].split(",").map((c) => c.trim());
    for (const need of ["id", "status", "detail", "filename", "received_at"]) expect([need, cols.includes(need)]).toEqual([need, true]);
  });
});

describe("pending matches are one card with a count, linking to Matching", () => {
  it("counts the unresolved lines and links", () => {
    const c = matchingCard([{ id: 1 }, { id: 2, resolved: true }, { id: 3, dismissed: true }, { id: 4 }]);
    expect(c).toMatchObject({ kind: "matching_pending", count: 2, goTo: "matching" });
  });
  it("nothing pending → no card (an empty section is not a card that says 'nothing')", () => {
    expect(matchingCard([])).toBeNull();
    expect(matchingCard([{ id: 1, resolved: true }])).toBeNull();
    expect(waitingOnYou({})).toEqual([]);
  });
});

describe("the copy is derived from the card, and assumes no accounting knowledge", () => {
  it("names the file and quotes the reason", () => {
    const [c] = heldPayrollCards([{ id: "i", status: "held_for_review", detail: payrollHoldDetail(gate), filename: "gusto.csv" }]);
    const s = waitingCopy(c);
    expect(s).toContain("gusto.csv");
    expect(s).toContain("doesn't foot");
  });
  it("passes the jargon bar on every card kind", () => {
    const cards = waitingOnYou({
      intakeRows: [{ id: "i", status: "held_for_review", detail: payrollHoldDetail([{ text: "Gross pay of $12,000.00 is well outside this company's usual $4,000.00 a run." }]), filename: "g.csv" }],
      matchQueue: [{ id: 1 }],
    });
    expect(cards).toHaveLength(2);
    for (const c of cards) expect([c.kind, containsOwnerJargon(waitingCopy(c))]).toEqual([c.kind, false]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// O135 — A HELD REGISTER THAT IS NOT IN MEMORY ANY MORE. The Review card is durable;
// the parsed register was not. The Payroll screen now lists every held row with no
// in-memory register and rebuilds it from the stored file on request.
// ════════════════════════════════════════════════════════════════════════════
describe("O135 — which held registers need rebuilding from their stored file", () => {
  const held = (id, filename) => ({ id, status: "held_for_review", detail: payrollHoldDetail(gate), filename, document_id: `doc_${id}` });

  it("a held row with NO in-memory register is offered for reload", () => {
    const r = heldRegistersToReload({ intakeRows: [held("i1", "aug.csv")], payrollImports: [], uploadQueue: [] });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ intake_id: "i1", filename: "aug.csv", loading: false });
    expect(r[0].reasons).toBe(gate[0].text);
  });

  it("★ a held row whose register IS in memory is NOT offered — that would be a second copy of the same hold", () => {
    const r = heldRegistersToReload({ intakeRows: [held("i1", "aug.csv")], payrollImports: [{ id: 1, _intakeId: "i1" }], uploadQueue: [] });
    expect(r).toEqual([]);
  });

  it("★ a row already being re-read shows as loading, not as a button to press again (the O123 shape)", () => {
    const r = heldRegistersToReload({ intakeRows: [held("i1", "aug.csv")], payrollImports: [], uploadQueue: [{ id: 9, intake_id: "i1", status: "processing" }] });
    expect(r[0].loading).toBe(true);
    // …and a FINISHED queue item does not count as in flight.
    const done = heldRegistersToReload({ intakeRows: [held("i1", "aug.csv")], payrollImports: [], uploadQueue: [{ id: 9, intake_id: "i1", status: "done" }] });
    expect(done[0].loading).toBe(false);
  });

  it("★★ the reload goes through the stored file and the ORIGINAL intake id — no second arrival row", () => {
    // A second `logIntake` for the same document would corrupt the population the
    // completeness ledger independently owns (O60). `enqueueDrainedItem` carries the
    // original id, and the reload must use it rather than starting a fresh arrival.
    const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
    const fn = app.slice(app.indexOf("const reloadHeldIntake = async"), app.indexOf("const [shadowResult"));
    expect(fn).toMatch(/fetchStoredFile\(\{ supabase, documentId: row\.document_id \}\)/);
    expect(fn).toMatch(/enqueueDrainedItem\(\{ intakeId: row\.id,/);
    expect(fn).not.toMatch(/logIntake\(/);
    // …and it refuses, with a stated reason, when there is no stored file to rebuild from.
    expect(fn).toMatch(/if \(!row\.document_id\) return \{ ok: false/);
  });

  it("★★ the fetch carries document_id, or the reload can never find the bytes", () => {
    const src = fs.readFileSync(new URL("../src/lib/documentIntake.js", import.meta.url), "utf8");
    const m = src.match(/export async function fetchIntakeRows[\s\S]*?\.select\("([^"]+)"\)/);
    expect(m[1].split(",").map((c) => c.trim())).toContain("document_id");
  });
});
