// ─────────────────────────────────────────────────────────────────────────────
// C362 — FIVE MORE "✓" SENTENCES NOW READ THE WRITE THEY DESCRIBE.
//
// Continuing the C360/C361 audit of every success toast for what gates it:
//   · Home's "Yes, set it up" recurring card was a setRecurring with a ✓ — the THIRD add-a-
//     recurring path that never wrote a row (chat: C112, screen: C360, this one: now)
//   · the GAAP card's "book as is" and the manual-entry form fired `bookToDb` unawaited and
//     said "Booked ✓" — over the writer's own refusal when the month was signed or the RPC failed
//   · a contract entry's posted-marker was painted, then persisted unawaited by a function that
//     returned nothing; a lost marker re-offered the entry on reload (the C207 double-post shape)
//   · `softDeleteContracts` removed rows from screen, ran an UNCHECKED update per row, audited
//     each as deleted before writing, and said "Deleted — tap Undo" whatever happened (O124(c))
//
// Structure-pinned (C238/C240): the ✓ / the paint must FOLLOW the awaited verdict, and a
// refusal must return before it. Presence of a call survives `if (false)`; ordering does not.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
const fn = (start, endMarker, len = 4000) => {
  const i = app.indexOf(start);
  expect(i, `${start} not found`).toBeGreaterThan(0);
  const j = endMarker ? app.indexOf(endMarker, i) : i + len;
  return app.slice(i, j > i ? j : i + len);
};
const ordered = (body, ...marks) => {
  let at = -1;
  for (const m of marks) {
    const n = body.indexOf(m, at + 1);
    expect(n, `"${m}" must follow "${marks[marks.indexOf(m) - 1] || "start"}"`).toBeGreaterThan(at);
    at = n;
  }
};

describe("Home's recurring suggestion card persists through the one writer", () => {
  const body = fn("const acceptRecurringSuggestionOnce = async (s) => {", "const dismissRecurringSuggestion");
  it("writes through persistChatRecurring, and the ✓ follows the verdict", () => {
    ordered(body, "const res = await persistChatRecurring({", "if (!res?.ok) {", "nothing was created", "return;", "showNotification(`Recurring set up:");
  });
  it("no in-memory rule is minted any more", () => {
    expect(body).not.toMatch(/setRecurring\(prev => \[newRec/);
    expect(body).not.toMatch(/id: Date\.now\(\) \+ Math\.random\(\)/);
  });
  it("the profile rule and the dismissal happen only after the row exists", () => {
    ordered(body, "if (!res?.ok) {", "addCustomRule(", "dismissedRecurringRef.current.add(");
  });
});

describe("booking ✓ sentences follow the awaited write", () => {
  it("GAAP card — book as is", () => {
    const body = fn("if (opt.bookAsIs) {", "// Capitalize →");
    ordered(body, "setInvoices(prev => [ri, ...prev]);", "const jeId = await bookToDb(ri);", "if (!jeId) return;", "showNotification(`Booked to ${ri.gl_name} ✓`)");
  });
  it("manual entry — the form is cleared and Home is shown only once the entry is in the books", () => {
    const body = fn("const doBook = async () => {", "// Duplicate invoice number check");
    ordered(body, "const jeId = await bookToDb(invoice);", "if (!jeId) return;", "setForm({", 'setView("home")', "showNotification(`Booked to ${aiSuggestion.gl_name} ✓`)");
  });
});

describe("persistContract returns a verdict and its update is checked", () => {
  const body = fn("const persistContract = async (contract) => {", "\n  };\n");
  it("the update carries .select() and treats zero rows as a failure", () => {
    expect(body).toMatch(/\.update\(payload\)\.eq\("id", contract\.db_id\)\.eq\("company_id", currentCompany\.id\)\.select\("id"\)/);
    expect(body).toMatch(/if \(!\(data \|\| \[\]\)\.length\) \{[^}]*return \{ ok: false/);
  });
  it("every exit is a verdict", () => {
    expect(body).not.toMatch(/return;\s*\n/);
    expect((body.match(/return \{ ok: /g) || []).length).toBeGreaterThanOrEqual(5);
  });
  it("the unchecked-write guard no longer excuses contracts", () => {
    const guard = fs.readFileSync(path.join(process.cwd(), "tests/uncheckedWrites.test.js"), "utf8");
    expect(guard).not.toMatch(/^\s*contracts:/m);
  });
});

describe("a contract entry's posted-marker is awaited, and a lost marker is said", () => {
  it("single post", () => {
    const body = fn("const postContractEntryOnce = async", "const postAllContractEntries");
    ordered(body, "const jeId = await persistMultiLineEntry(je);", "const marker = await persistContract(updatedContract);", "if (!marker?.ok) {", "Don't post this entry again", "return;", "showNotification(`Journal entry posted to ledger ✓`)");
  });
  it("post all", () => {
    const body = fn("const postAllContractEntriesOnce = async", "\n  };\n");
    ordered(body, "const marker = await persistContract(updatedContract);", "if (!marker?.ok) {", "Don't post them again", "return;", "showNotification(`✓ Posted ${posted.length}");
  });
  it("a contract that could not be saved after analysis says it will be gone on reload", () => {
    const body = fn("const kept = await persistContract(saved);", null, 700);
    ordered(body, "if (!kept?.ok) {", "gone if you reload", "return;", "Agreement read —");
  });
});

describe("softDeleteContracts writes first, removes only what landed, audits after", () => {
  const body = fn("const softDeleteContracts = async (list, byAI=false) => {", "const softDeleteContract = ");
  it("each delete is a checked row update", () => {
    expect(body).toMatch(/checkedRowUpdate\(\{\s*supabase, table: "contracts", id: s\.db_id/);
    expect(body).not.toMatch(/\.update\(\{ deleted_at: new Date\(\)\.toISOString\(\), deleted_by: uid \}\)\s*\.eq/);
  });
  it("the screen, the audit row and the toast all follow the write and cover only `gone`", () => {
    ordered(body, "const r = await checkedRowUpdate({", "if (!r.ok) { anyError = true; continue; }", "gone.push(s);",
      'gone.forEach(s => logAudit("contract_deleted"', "const idset = new Set(gone.map(", "setContracts(prev => prev.filter(", "if (anyError) {", "nothing was changed", "showNotification(`Deleted ${label} — tap Undo to restore`");
    expect(body).not.toMatch(/snaps\.forEach\(s => logAudit\("contract_deleted"/);
  });
  it("a total failure returns before any Undo toast is offered", () => {
    ordered(body, "if (!gone.length) return { ok: false, committed: 0 };", "tap Undo to restore");
  });
  it("the Undo restores only what was actually deleted", () => {
    const undo = body.slice(body.indexOf("tap Undo to restore"));
    expect(undo).toMatch(/const dbIds = gone\.map\(/);
    expect(undo).toMatch(/\[\.\.\.gone\.filter\(/);
    expect(undo).not.toMatch(/snaps\.filter\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C371 — three more bookings fired and forgotten, found by grepping `bookToDb(` for the
// call sites nobody awaited: the pipeline's bank-line batch (its tile counted the ATTEMPT),
// Send Invoice's legacy mark-paid, and Reconcile's "add to books" (which matched the bank
// line to an entry that might never have posted).
// ─────────────────────────────────────────────────────────────────────────────
describe("C371 — no booking is fired and forgotten", () => {
  it("every bookToDb call site in src/ is awaited or returned", () => {
    const files = ["src/App.jsx", "src/components/views/SendInvoiceView.jsx", "src/components/views/ReconView.jsx", "src/components/ClarificationFlow.jsx", "src/components/views/ReviewView.jsx", "src/components/views/RecurringView.jsx"];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8").replace(/\/\/[^\n]*/g, "");
      const calls = src.match(/[^\w.]bookToDb(?:\s*&&\s*bookToDb)?\s*\(/g) || [];
      for (const c of calls) {
        const at = src.indexOf(c);
        const before = src.slice(Math.max(0, at - 40), at + 1);
        expect(before, `${f}: ${before.trim()}`).toMatch(/(await|return|=>|\?)\s*$|\.map\($/);
      }
    }
  });
  it("the bank-line batch counts what LANDED, audits and says a shortfall", () => {
    const body = fn("const unmatchedTxns = plan.standalone;", "const matchedCount = autoCleared.length");
    ordered(body, "const landed = await Promise.all(newInvoices.map(inv => bookToDb(inv)));", "bookedNew = landed.filter(Boolean).length;", 'logAudit("bank_lines_not_booked"', "couldn't be booked");
    expect(app).toMatch(/newBooked: bookedNew, notBooked: refusedNew,/);
    expect(app).not.toMatch(/newBooked: newInvoices\.length/);
  });
  it("Send Invoice's legacy mark-paid and Reconcile's add-to-books gate on the id", () => {
    const send = fs.readFileSync(path.join(process.cwd(), "src/components/views/SendInvoiceView.jsx"), "utf8");
    ordered(send, "const jeId = await bookToDb(entry);", "if (!jeId) return;", 'logAudit("invoice_paid"', "marked paid ✓");
    const recon = fs.readFileSync(path.join(process.cwd(), "src/components/views/ReconView.jsx"), "utf8");
    ordered(recon, "const addToBooks = async (t, gl) => {", "const jeId = bookToDb ? await bookToDb(inv) : null;", "if (!jeId) {", "still unmatched", "return; }", "_matchBook:inv.id");
  });
});
