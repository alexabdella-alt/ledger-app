import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { invoiceOutcomeCopy, attachPhrase } from "../src/lib/uploadOutcome.js";
import { plainCategoryPhrase, describeBooking, roleFromAccount } from "../src/lib/clarify.js";

// ═════════════════════════════════════════════════════════════════════════════
// THE "DESCRIBE FROM THE RECORD" BATCH — O115, O128, O124(c), O126(A).
//
// ★★ ONE DEFECT, FOUR SURFACES (CLAUDE.md §9). A user-facing string about what the system
// did must be GENERATED FROM THE RECORDED OUTCOME. A description assembled in parallel with
// the work CAN diverge from it — and when it does, THE BOOKS ARE RIGHT AND THE USER IS
// MISINFORMED, which is the worst combination available: nothing is broken, so nothing
// gets fixed.
//
// ★ THE CHECK, APPLIED BELOW TO EVERY CLAUSE: name the field of the OUTCOME it reads. A
// clause computed from the INPUT is a parallel description and WILL diverge; the only
// question is when.
// ═════════════════════════════════════════════════════════════════════════════

describe("★★ O115 — the phrase describes the ACCOUNT, not what the vendor's name looks like", () => {
  it("THE LIVE SPECIMEN: Lone Star on 5000 is cost of goods, NOT 'a client meal'", () => {
    // Reproduced from the August drive. The queue told the owner this was booked "as a
    // client meal" while the ledger correctly said 5000 Cost of Goods Sold — because
    // MEALS_RE matched "Lone Star **Restaurant** Supply", a restaurant SUPPLIER.
    const lone = { vendor: "Lone Star Restaurant Supply", description: "kitchen supplies",
                   gl_code: "5000", gl_name: "Cost of Goods Sold", amount: 1344.85 };
    expect(plainCategoryPhrase(lone)).toBe("cost of goods");
    expect(describeBooking(lone)).not.toMatch(/client meal/);
  });

  it("★ nor does a caterer's NAME override a non-meal account", () => {
    // The general form: any vendor whose name trips the meals words, booked somewhere else.
    for (const code of ["5000", "6100", "6500", "6250"]) {
      const inv = { vendor: "Bella Vita Catering", gl_code: code };
      expect(plainCategoryPhrase(inv)).not.toBe("a client meal");
    }
  });

  it("★★ BUT TEXT MAY STILL REFINE **WITHIN** AN ACCOUNT — that is the real distinction", () => {
    // 6400 Travel & Entertainment genuinely spans two everyday things, so calling a
    // caterer on that account "a client meal" NARROWS the account rather than
    // contradicting it. Killing this would have been an over-fix: the owner-facing
    // sentence should say which of the two it was.
    expect(plainCategoryPhrase({ vendor: "Bella Vita Catering", gl_code: "6400", gl_name: "Travel & Entertainment" })).toBe("a client meal");
    expect(plainCategoryPhrase({ vendor: "Acme", gl_code: "6400", meals_pct: 50 })).toBe("a client meal");
    // …and with no meal signal, the account's own phrase stands.
    expect(plainCategoryPhrase({ vendor: "Delta Air Lines", gl_code: "6400" })).toBe("a meal or travel expense");
  });

  it("★ refinement is opt-in PER ROLE — a role with no entry keeps its own phrase", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/clarify.js"), "utf8");
    const table = src.slice(src.indexOf("const ROLE_REFINEMENTS"), src.indexOf("const MEALS_RE"));
    // Exactly one role may be refined today. Widening this silently is how the vendor's
    // name gets back to overruling the account its money is sitting in.
    const roles = [...table.matchAll(/^\s{2}(\w+):\s*\[/gm)].map((m) => m[1]);
    expect(roles).toEqual(["travel_entertainment"]);
  });

  it("resolves the account by NAME when the chart was renumbered", () => {
    expect(plainCategoryPhrase({ vendor: "Bella Vita Catering", gl_code: "9987", gl_name: "Cost of Goods Sold" })).toBe("cost of goods");
    expect(roleFromAccount({ gl_code: "9987", gl_name: "Cost of Goods Sold" })).toBe("cogs");
  });

  it("★ roleFromAccount reads ONLY the account — never the vendor or description", () => {
    // The split exists so "what is this probably?" and "what was it booked as?" cannot be
    // confused again. Given a meal-shaped vendor and NO account, it must answer nothing.
    expect(roleFromAccount({ vendor: "Joe's Diner", description: "team lunch" })).toBe(null);
  });

  it("an uncoded entry still guesses from text — that IS the ask path's job", () => {
    // No account to read, so there is no answer sitting three feet away being ignored.
    expect(plainCategoryPhrase({ vendor: "Joe's Diner", description: "client lunch" })).toBe("a client meal");
  });

  it("the 5xxx range resolves at all — its absence was half the bug", () => {
    expect(roleFromAccount({ gl_code: "5000" })).toBe("cogs");
    expect(roleFromAccount({ gl_code: "6250" })).toBe("repairs_maintenance");
    expect(roleFromAccount({ gl_code: "6520" })).toBe("merchant_processing_fees");
  });
});

describe("★★ O128 — the best outcome this feature has is no longer announced as a zero", () => {
  it("THE LIVE LINE: three invoices filed against payments we already had", () => {
    // Was: "✓ 0 invoices booked · $0.00 total" — technically true, read as nothing
    // happened, at the moment the most valuable thing the feature does had occurred.
    const copy = invoiceOutcomeCopy({ invoiceCount: 0, amount: 0, needsClarification: 0,
                                      attachedCount: 3, attachedAmount: 1439.05 });
    expect(copy).not.toMatch(/0 invoices booked/);
    expect(copy).not.toMatch(/\$0\.00/);
    expect(copy).toMatch(/3 invoices filed with payments we already had/);
    expect(copy).toMatch(/\$1,439\.05/);
    // It says the CONSEQUENCE — which is the part that makes it good news.
    expect(copy).toMatch(/not counted twice/);
  });

  it("one attach names the vendor", () => {
    const copy = invoiceOutcomeCopy({ invoiceCount: 0, needsClarification: 0,
                                      attachedCount: 1, attachedAmount: 462.85, attachedVendor: "Toast" });
    expect(copy).toBe("✓ Toast · $462.85 — filed with the payment we already had, not counted twice");
  });

  it("★ an attach ALONGSIDE bookings is still reported — not swallowed by the headline", () => {
    const copy = invoiceOutcomeCopy({ invoiceCount: 2, amount: 800, needsClarification: 0,
                                      attachedCount: 1, attachedAmount: 100, attachedVendor: "Roma" });
    expect(copy).toMatch(/2 invoices booked/);
    expect(copy).toMatch(/Roma .* filed with the payment we already had/);
  });

  it("★ and alongside a QUESTION, where it used to be lost entirely", () => {
    const copy = invoiceOutcomeCopy({ invoiceCount: 0, needsClarification: 1, reviewVendor: "Hill Country",
                                      attachedCount: 1, attachedAmount: 425, attachedVendor: "Alamo Fire" },
                                     { pendingReview: true });
    expect(copy).toMatch(/Needs your input/);
    expect(copy).toMatch(/Alamo Fire/);
  });

  it("no attach → the phrase is absent, not an empty clause", () => {
    expect(attachPhrase({ attachedCount: 0 })).toBe(null);
    expect(invoiceOutcomeCopy({ invoiceCount: 1, amount: 50, vendor: "Acme", bookedAs: "software" }))
      .toBe("✓ Booked: Acme · $50.00 as software");
  });

  it("★ every clause reads a field of the OUTCOME — none is recomputed from the invoice", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/lib/uploadOutcome.js"), "utf8");
    const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    // It must not reach for the categoriser, the chart, or the raw invoice — the whole
    // point is that it describes what was RECORDED.
    for (const forbidden of ["plainCategoryPhrase", "inferRole", "gl_code", "supabase", "CHART_OF_ACCOUNTS"]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("★★ O124(c) — 'Deleted' is claimed only when something was deleted", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");
  const body = src.slice(src.indexOf("const softDeleteInvoices"), src.indexOf("const softDeleteInvoice ="));

  it("finds the delete path", () => { expect(body.length).toBeGreaterThan(400); });

  it("★ checks the result before the success toast", () => {
    // `softDeleteJournalEntry` returns [] on a signed-period block or a DB error, and this
    // function's OWN comment records that callers gate "✓ done" on a non-empty result
    // (O78) — while its toast never looked. C194 class, one surface over.
    const guard = body.indexOf("if (!allIds.length)");
    const toast = body.indexOf("Deleted ${label} — tap Undo to restore");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(toast);
  });

  it("★★ and PUTS THE ROWS BACK — the optimistic removal made a failed delete LOOK done", () => {
    // Rows were filtered out of `invoices` before the write, so a refused delete also
    // vanished from the screen while remaining in the books. The next reload resurrects
    // an entry the user believes they removed.
    const fail = body.slice(body.indexOf("if (!allIds.length)"), body.indexOf("showNotification(`Deleted"));
    expect(fail).toMatch(/setInvoices\(/);
    expect(fail).toMatch(/invoice_delete_failed/);
    expect(fail).toMatch(/still in your books/);
    expect(fail).toMatch(/return \[\]/);
  });

  it("the failure sentence assumes no accounting knowledge", () => {
    const fail = body.slice(body.indexOf("if (!allIds.length)"), body.indexOf("showNotification(`Deleted"));
    const msg = (fail.match(/showNotification\(`([^`]+)`/) || [])[1] || "";
    expect(msg.length).toBeGreaterThan(20);
    for (const jargon of ["journal", "ledger", "RLS", "row", "null", "constraint"]) {
      expect(msg.toLowerCase()).not.toContain(jargon.toLowerCase());
    }
  });
});

describe("★ O126(A) — delete is on the surface you reach by clicking the thing", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/TransactionDetailPanel.jsx"), "utf8");

  it("the detail panel offers Delete, not only Void", () => {
    // `softDeleteInvoice` was wired to exactly ONE control in the app — four steps deep,
    // behind a label that reads as a filter. So a user who opened an entry to deal with it
    // was offered only the button that compounded O123 into three reversals.
    expect(src).toMatch(/softDeleteInvoice/);
    expect(src).toMatch(/const doDelete/);
    expect(src).toMatch(/>Delete</);
  });

  it("★ it is confirm-guarded, and the confirmation says undo is available", () => {
    const fn = src.slice(src.indexOf("const doDelete"), src.indexOf("const doVoid"));
    expect(fn).toMatch(/setDeleteConfirm/);
    expect(fn).toMatch(/undo/i);
    expect(fn).toMatch(/softDeleteInvoice/);
  });
});
