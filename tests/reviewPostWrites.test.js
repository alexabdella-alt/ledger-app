// ─────────────────────────────────────────────────────────────────────────────
// C363 — THE REVIEW SCREEN'S "POST" BUTTONS WRITE THE ENTRY; A PREPAID SPREAD SAYS WHAT DID NOT POST.
//
// The Unclassified-documents section on Review carries an AI-drafted entry and a Post button.
// Both Post buttons (the document's entry, and a watch-trigger match's suggested entry) put the
// entry in React state and said "Entry posted ✓" — `bookToDb` was destructured and never
// called. The C288 `voidBook` / C360 `runRecurring` shape, on the CPA's own review screen.
//
// And `bookPrepaid` posted its amortization schedule in a loop whose results nobody read: a
// month that failed left its share stranded in Prepaid while the ✓ said the spread was recorded.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (p) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
const ordered = (body, ...marks) => {
  let at = -1;
  for (const m of marks) {
    const n = body.indexOf(m, at + 1);
    expect(n, `"${m}" must follow the previous mark`).toBeGreaterThan(at);
    at = n;
  }
};

describe("Review — the document's Post button", () => {
  const view = read("src/components/views/ReviewView.jsx");
  it("awaits bookToDb and says ✓ only when the ledger has the entry", () => {
    const i = view.indexOf("const postEntry = async () => {");
    expect(i).toBeGreaterThan(0);
    const body = view.slice(i, view.indexOf("showNotification(`Entry posted: ${doc.document_type} · ", i) + 80);
    ordered(body, "setInvoices(prev => [newInvoice, ...prev]);", "const jeId = await bookToDb(newInvoice);", "if (!jeId) return;",
      "setUnknownDocs(prev => prev.map(d => d.id===doc.id ? {...d, posted:true} : d));", "showNotification(`Entry posted: ${doc.document_type} · ");
  });
  it("the watch-trigger match's Post button takes the same gate", () => {
    const i = view.indexOf("// Post the suggested entry for this match");
    expect(i).toBeGreaterThan(0);
    const body = view.slice(i, view.indexOf("watch trigger ✓`)", i) + 20);
    ordered(body, "setInvoices(prev => [newInvoice, ...prev]);", "const jeId = await bookToDb(newInvoice);", "if (!jeId) return;",
      "const nextMatches = (doc.watch_matches || []).map(", "showNotification(`Entry posted: ${doc.document_type} watch trigger ✓`)");
    // and the handler is async, or the await is a syntax error the build would catch — but
    // pin it: a sync handler with a stray `await` removed would fire-and-forget again
    expect(view.slice(i - 120, i)).toMatch(/onClick=\{async \(\) => \{/);
  });
  it("exactly two Post paths exist in the section and both call bookToDb (anti-vacuity)", () => {
    const start = view.indexOf("Unclassified documents");
    const end = view.indexOf("function ShadowCalibrationPanel", start) > 0 ? view.indexOf("function ShadowCalibrationPanel", start) : view.length;
    const section = view.slice(start, end);
    expect((section.match(/Entry posted: /g) || []).length).toBe(2);
    expect((section.match(/await bookToDb\(newInvoice\)/g) || []).length).toBe(2);
  });
});

describe("bookPrepaid reads each schedule row's result", () => {
  const app = read("src/App.jsx");
  const i = app.indexOf("const bookPrepaid = async (inv, months, opt = {}) => {");
  const body = app.slice(i, app.indexOf("\n  };\n", i));
  it("a failed month is counted, the stranded amount is named, and no ✓ is said", () => {
    expect(body).not.toMatch(/for \(const je of sched\.entries\) \{ await persistMultiLineEntry\(je\); \}/);
    ordered(body, "const id = await persistMultiLineEntry(je); if (!id) missed.push(je);", "if (missed.length) {",
      'logAudit("prepaid_schedule_incomplete"', "will stay in Prepaid", "return;", "showNotification(`Recorded as prepaid — spread over ${months} months ✓`)");
  });
  it("the stranded figure is summed from the rows that did not post, not re-derived from the total", () => {
    expect(body).toMatch(/const stranded = missed\.reduce\(/);
  });
});
