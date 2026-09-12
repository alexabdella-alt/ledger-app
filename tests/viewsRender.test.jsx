import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { renderViewError, renderViewHtml, VIEW_CONTEXT } from "./helpers/renderView.jsx";
import { POPULATED } from "./helpers/populatedFixture.js";

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ O14 — "A SCREEN CAN CRASH WITH A GREEN SUITE." NOT ANY MORE.
//
// Every other test here exercises LOGIC. Nothing had ever rendered a screen, so a view
// could throw on its first paint — a null read, a context key renamed under it, a `.map`
// on something that stopped being an array — and 2,400 passing tests would say nothing.
// That is not hypothetical: today alone, three of this session's commits renamed or moved
// context values that views consume.
//
// ★ WHAT THIS PROVES, EXACTLY: every screen PAINTS with an empty company. It does not run
// effects, does not click anything, and does not check that a screen is CORRECT. It is a
// smoke test and is written to be honest about that — the value is that the class of
// failure it catches (a crash on open) was previously invisible to every check we had.
//
// ★★ AND IT COSTS NO DEPENDENCY. `renderToString` ships with React and needs no DOM. A
// jsdom + testing-library setup would test more and was not worth the two packages and the
// config to a project that has deliberately stayed at six dependencies.
// ═════════════════════════════════════════════════════════════════════════════

const viewsDir = path.join(process.cwd(), "src/components/views");
const viewFiles = fs.readdirSync(viewsDir).filter((f) => f.endsWith(".jsx")).sort();

// Top-level components that take no props and read the same context.
const TOP_LEVEL = ["ClarificationFlow.jsx", "CompanySwitcher.jsx", "LegalView.jsx"];

describe("★★★ every screen renders without throwing", () => {
  it("there are screens to test — a sweep over an empty list is a vacuous pass", () => {
    // The C195(7) lesson: a guard whose input is always empty is indistinguishable from a
    // clean queue. If a rename empties this list, the suite must fail rather than pass.
    expect(viewFiles.length).toBeGreaterThanOrEqual(30);
  });

  for (const f of viewFiles) {
    it(`renders ${f}`, async () => {
      const mod = await import(path.join(viewsDir, f));
      expect(typeof mod.default, `${f} has no default export`).toBe("function");
      const err = renderViewError(mod.default, VIEW_CONTEXT[f] || {});
      expect(err && `${f} threw on render: ${err.message}`).toBeNull();
    });
  }

  for (const f of TOP_LEVEL) {
    it(`renders ${f}`, async () => {
      const mod = await import(path.join(process.cwd(), "src/components", f));
      if (typeof mod.default !== "function") return;
      const err = renderViewError(mod.default, VIEW_CONTEXT[f] || {});
      expect(err && `${f} threw on render: ${err.message}`).toBeNull();
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// C319 — AND AGAIN, WITH DATA IN THE COMPANY.
//
// ★★★ THE SWEEP ABOVE HANDS EVERY COLLECTION AN EMPTY ARRAY, SO NO ROW EVER
// RENDERS. It catches a screen that throws on open — which it did, twice, on the
// day it shipped — and leaves the majority of every screen unexercised: the row
// bodies, the contact↔ledger joins, the per-row conditionals. C246 named that
// limit in its own comment; this is the other half of it.
//
// ★★ THE FIXTURE IS SMALL AND DERIVED. Only the collections that drive rows are
// populated; everything else still falls through to the Proxy, so this does not
// become the "second copy of the app's state shape" the harness warns about. And
// `vendorSummary` comes from the REAL builder over the REAL invoices, so a change
// to grouping cannot leave a hand-written fixture quietly disagreeing with it.
// ════════════════════════════════════════════════════════════════════════════
describe("★★★ every screen renders with a company that has data in it", () => {
  it("the fixture actually contains rows — an empty one would repeat the sweep above", () => {
    expect(POPULATED.invoices.length).toBeGreaterThanOrEqual(5);
    expect(POPULATED.contacts.length).toBeGreaterThanOrEqual(3);
    // The C317 case is in there on purpose: two spellings of one supplier, so the join
    // path runs rather than being skipped for want of a second row.
    expect(POPULATED.vendorSummary.length).toBeLessThan(POPULATED.invoices.length);
  });

  // ★★★ BOTH SEATS, BECAUSE SINCE C313–C315 THE SEAT DECIDES WHAT A SCREEN RENDERS. A
  // client sees different copy on Vendors and Customers, and BooksView hides three whole
  // blocks from them. Rendering one seat leaves the other branch unexecuted — and the
  // fixture had `navSeat` as the string "cockpit" (stale since C312 made it an object), so
  // `navSeat.isReviewerSeat` read undefined and every screen was quietly being rendered in
  // its CLIENT branch while the fixture claimed the opposite.
  const SEATS = {
    reviewer: { seat: "reviewer", isReviewerSeat: true, sections: [], viewIds: ["home", "books", "ap", "ar", "vendors", "customers", "docs", "reports", "detail", "review", "bank", "recon", "matching", "payroll", "contracts", "add"] },
    client: { seat: "client", isReviewerSeat: false, sections: [], viewIds: ["home", "books", "ap", "ar", "vendors", "customers", "docs", "reports", "detail"] },
  };

  for (const [seatName, navSeat] of Object.entries(SEATS)) {
    for (const f of viewFiles) {
      it(`renders ${f} with data — ${seatName} seat`, async () => {
        const mod = await import(path.join(viewsDir, f));
        const err = renderViewError(mod.default, { ...POPULATED, navSeat, ...(VIEW_CONTEXT[f] || {}) });
        expect(err && `${f} threw rendering real rows (${seatName}): ${err.stack?.split("\n").slice(0, 4).join(" | ")}`).toBeNull();
      });
    }

    for (const f of TOP_LEVEL) {
      it(`renders ${f} with data — ${seatName} seat`, async () => {
        const mod = await import(path.join(process.cwd(), "src/components", f));
        if (typeof mod.default !== "function") return;
        const err = renderViewError(mod.default, { ...POPULATED, navSeat, ...(VIEW_CONTEXT[f] || {}) });
        expect(err && `${f} threw rendering real rows (${seatName}): ${err.stack?.split("\n").slice(0, 4).join(" | ")}`).toBeNull();
      });
    }
  }

  // ★★★ THE ANTI-VACUITY CHECK, AND IT IS THE ONE THAT ACTUALLY EARNED ITS PLACE. "It did
  // not throw" is satisfied just as well by a screen that rendered the WRONG BRANCH and drew
  // nothing — which is exactly what was happening: `vendorsSelectedContact` was absent, the
  // Proxy answered `[]`, `[]` is truthy, and every Vendors render took the detail pane. A
  // crash planted in the row body survived the sweep. These assert the fixture's data
  // reaches the page, so "the rows ran" is a fact rather than an assumption.
  const REACHES = [
    ["VendorsView.jsx", "Hill Country Milling"],
    ["CustomersView.jsx", "Corner Market Catering"],
    ["BooksView.jsx", "Bluebonnet Linen Service"],
    ["DocsView.jsx", "invoice-jan.pdf"],
    ["AuditView.jsx", "Hill Country Milling"],
    ["ContractsView.jsx", "Franklin Ave Properties"],
    ["RulesView.jsx", "Hill Country Milling"],
    ["RecurringView.jsx", "Bluebonnet Linen Service"],
  ];
  for (const [f, needle] of REACHES) {
    it(`★ ${f} actually renders its rows (not an empty or wrong branch)`, async () => {
      const mod = await import(path.join(viewsDir, f));
      const html = renderViewHtml(mod.default, { ...POPULATED, navSeat: SEATS.reviewer, ...(VIEW_CONTEXT[f] || {}) });
      expect(html).toContain(needle);
    });
  }

  it("★★★ C317 reaches the SCREEN — one row for one supplier, carrying the whole total", () => {
    // ★★ "IT PAINTED" IS NOT "IT SHOWED THE RIGHT NUMBER". The sweep above is satisfied by a
    // screen that drew a row with the wrong figure in it, so this asserts the figure. The
    // fixture's two Hill Country spellings sum to $1,736.90, which exists only if the rows
    // were grouped by key rather than by display name.
    return import(path.join(viewsDir, "VendorsView.jsx")).then((mod) => {
      const html = renderViewHtml(mod.default, { ...POPULATED, navSeat: SEATS.reviewer });
      expect(html).toContain("1,736.90");                 // 824.60 + 912.30, grouped
      expect(html).not.toContain("824.60");               // …not one half of it
      // …and ONE row for that supplier, not a contact row plus a ledger-only row (the C317
      // symptom, which is invisible to a totals check because each row's own sum is right).
      expect(html.split("Hill Country Milling").length - 1).toBe(1);
    });
  });

  // ★ WHAT THIS PAIR OF ASSERTIONS DOES NOT COVER, SAID PLAINLY: mutating the CONTACT↔LEDGER
  // join (`ledger: undefined`) survives them, because `v.ledger` turns out to feed exactly
  // one thing — a `lastDate` fallback. The figures on that screen come from `txnsForVendor`,
  // which is C317's other half and is what these kill. Recorded rather than papered over: an
  // assertion aimed at the wrong half is the ·3a shape, and I wrote one before checking.

  it("★★ C334 — the Review screen's sign-off card carries the month's card rate (structure, not render)", () => {
    // The sign-off card renders only after `refreshDropped()` resolves in an effect
    // (`ready = companyDataLoaded && droppedLoaded`), and renderToString runs no effects —
    // so this sweep has never drawn that card and cannot draw this line. Pinned as
    // STRUCTURE instead: the reader call sits inside `signOffCard`, and its sentence is
    // rendered from the report it computed (§9), not composed beside it.
    const src = fs.readFileSync(path.join(viewsDir, "ReviewView.jsx"), "utf8");
    const card = src.slice(src.indexOf("const signOffCard = ("), src.indexOf("{ready && signOffCard}"));
    expect(card).toMatch(/const r = cardRateForPeriod\(\{ anomalies, clarificationQueue, intakeRows, period: signOffMonth/);
    expect(card).toMatch(/subjectPeriodOf: \(a\) => anomalySubjectPeriod\(a, invoices\)/);
    expect(card).toMatch(/\{cardRateCopy\(r\)\}/);
  });

  it("★★ C326 — the Documents card names the entry a file became and offers the door, on the CLIENT seat", () => {
    // The fixture's document is linked to `je_i1`, which is invoice i1's durable id. The
    // card must name that entry and offer to open it — and `detail` is in the client's
    // view set, so the door is a real one for an owner, not a locked room (C321's lesson).
    return import(path.join(viewsDir, "DocsView.jsx")).then((mod) => {
      const html = renderViewHtml(mod.default, { ...POPULATED, navSeat: SEATS.client });
      expect(html).toContain("Open the transaction");
      expect(html).toContain("Hill Country Milling Co.");
      expect(SEATS.client.viewIds).toContain("detail");
    });
  });

  it("★★ an OWNER sees the 'Send an invoice' door on Money owed to you (C321)", () => {
    // Permission without a door is a locked room. `send-invoice` is in the client's view
    // set; this asserts the button that reaches it actually renders for the CLIENT seat —
    // a source grep sees `setView("send-invoice")` whether or not it sits behind
    // `cockpit &&`, so only the rendered page can tell the two apart. A mutation gating
    // the button back to the CPA survived every other test before this one existed.
    return import(path.join(viewsDir, "ArView.jsx")).then((mod) => {
      const html = renderViewHtml(mod.default, { ...POPULATED, navSeat: SEATS.client });
      expect(html).toContain("Send an invoice");
    });
  });

  it("★★ O135 — a held register with no in-memory copy is SHOWN on Payroll, from the durable row", () => {
    // The Review card points here. Before this, the screen said "No payroll imports yet"
    // over a register that was held for a decision — the link opened onto nothing.
    return import(path.join(viewsDir, "PayrollView.jsx")).then((mod) => {
      const intakeRows = [{ id: "i7", status: "held_for_review", filename: "gusto-0831.csv", document_id: "d7",
        detail: "payroll register held for a person: The register doesn't foot: gross $4,000.00 less withholdings $850.00 is $3,150.00, but it states net pay of $3,200.00." }];
      const html = renderViewHtml(mod.default, { ...POPULATED, intakeRows, payrollImports: [], navSeat: SEATS.reviewer });
      expect(html).toContain("gusto-0831.csv");
      expect(html).toContain("doesn&#x27;t foot");          // the gate's own reason, escaped by React
      expect(html).toContain("Load it to decide");
      expect(html).not.toContain("No payroll imports yet");  // the empty state must not contradict the card above it
    });
  });

  it("★ the two seats are genuinely different, or this loop is one sweep run twice", () => {
    expect(SEATS.reviewer.isReviewerSeat).not.toBe(SEATS.client.isReviewerSeat);
    expect(SEATS.reviewer.viewIds.length).toBeGreaterThan(SEATS.client.viewIds.length);
  });
});

describe("★ the harness itself cannot pass vacuously", () => {
  it("a component that throws IS caught", () => {
    // Without this, a harness that swallowed errors would report 33 green screens forever.
    const Boom = () => { throw new Error("boom"); };
    const err = renderViewError(Boom);
    expect(err).toBeTruthy();
    expect(err.message).toBe("boom");
  });

  it("★ the verb lookahead is what keeps data from arriving as functions", () => {
    // `filteredInvoices` starts with "filter" and `openingBalances` with "open". Without
    // the `(?=[A-Z])` lookahead both came back as functions, producing seven failures that
    // looked exactly like real crashes.
    const src = fs.readFileSync(path.join(process.cwd(), "tests/helpers/renderView.jsx"), "utf8");
    expect(src).toMatch(/\(\?=\[A-Z\]\)/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★ THE SECOND HALF, AND IT EXISTS BECAUSE A MUTATION ESCAPED THE FIRST.
//
// Renaming a context key a view depends on did NOT fail the render sweep — the fixture
// hands back an empty array for any key it does not know, so the screen paints, empty and
// wrong. That is the harness being permissive on purpose (a strict fixture would be a
// second copy of the app's 300-key state shape, stale within a week), but it means:
//
//   ★ THE RENDER SWEEP CATCHES A SCREEN THAT CRASHES. IT DOES NOT CATCH A SCREEN THAT
//     SILENTLY RENDERS EMPTY — which is the quieter and more likely failure.
//
// So this checks the CONTRACT instead: every name a view pulls out of `useERP()` must
// actually be provided by `erpCtx`. That is a real defect class — three commits in this
// session alone renamed or moved context values — and it needs no fixture at all.
// ═════════════════════════════════════════════════════════════════════════════
describe("★★ every key a screen destructures from useERP() is actually provided", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "src/App.jsx"), "utf8");

  // The single `const erpCtx = { … }` literal.
  const ctxStart = app.indexOf("const erpCtx = {");
  const ctxBody = app.slice(ctxStart, app.indexOf("\n", ctxStart));
  const provided = new Set(
    ctxBody
      .replace(/^const erpCtx = \{/, "")
      .replace(/\};?\s*$/, "")
      .split(",")
      .map((p) => p.split(":")[0].trim())
      .filter(Boolean)
  );

  it("the provided set was actually parsed — an empty set would pass everything", () => {
    expect(provided.size).toBeGreaterThan(200);
    expect(provided.has("invoices")).toBe(true);
    expect(provided.has("currentCompany")).toBe(true);
  });

  const componentFiles = [
    ...viewFiles.map((f) => path.join("src/components/views", f)),
    ...["ClarificationFlow.jsx", "CompanySwitcher.jsx", "TransactionDetailPanel.jsx", "DocumentPreviewModal.jsx", "ChatRichOutput.jsx"]
      .map((f) => path.join("src/components", f)),
  ];

  for (const rel of componentFiles) {
    const full = path.join(process.cwd(), rel);
    if (!fs.existsSync(full)) continue;
    it(`${path.basename(rel)} asks only for things that exist`, () => {
      const src = fs.readFileSync(full, "utf8");
      const missing = [];
      // `const { a, b, c } = useERP();` — possibly spanning many lines.
      // ★ THE INNER CLASS EXCLUDES `{}();` DELIBERATELY. A `[\s\S]*?` body matched from the
      // FIRST `const {` in the file all the way to a `useERP()` hundreds of lines later in
      // `ClarificationFlow.jsx`, so every local variable, style property and comment word in
      // between was reported as a missing context key — 173 "findings", five of them real.
      // A destructure of context is a plain identifier list; anything with a brace, a call
      // or a semicolon in it is not one.
      for (const m of src.matchAll(/const\s*\{([^{}();]*?)\}\s*=\s*useERP\(\)/g)) {
        for (const raw of m[1].split(",")) {
          // `a: b` renames on destructure; the KEY is what must exist.
          const key = raw.split(":")[0].replace(/[\s\n]/g, "").split("=")[0];
          if (!key || key.startsWith("...")) continue;
          if (!provided.has(key)) missing.push(key);
        }
      }
      expect(missing, `${rel} destructures keys erpCtx does not provide`).toEqual([]);
    });
  }
});
