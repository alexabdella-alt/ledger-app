import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CLIENT_VIEW_IDS, visibleNav } from "../src/lib/nav.js";
import { containsOwnerJargon } from "../src/lib/clarify.js";

// ════════════════════════════════════════════════════════════════════════════
// C315 — THE SCREENS BEHIND THE CLIENT'S NAV ROWS.
//
// ★★★ C313/C314 WIDENED THE CLIENT SEAT FROM TWO SCREENS TO EIGHT, AND EVERY ONE
// OF THE SIX IT ADDED WAS WRITTEN FOR A CPA. Moving a wall is one commit; what is
// on the other side of it is six files nobody re-read. This suite is the check
// that was missing — it asks, of every view a client can open:
//
//   (1) does any control on it lead somewhere this seat cannot go?
//   (2) does its user-visible copy assume accounting knowledge?
//
// ★★ IT IMMEDIATELY FOUND ONE THAT PREDATES THE WIDENING. `DetailView` has been
// client-visible since C197, and its "View all invoices for X" button pointed at
// `invoices` — a view NO seat has a nav row for, so a client was bounced Home and
// a CPA landed somewhere the sidebar could not highlight. Dead for months, in a
// file two people had edited since, because nothing ever asked the question.
// ════════════════════════════════════════════════════════════════════════════

const VIEW_DIR = "src/components/views";
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

// Which component file renders which view id. Only the ids a CLIENT may open —
// the cockpit's screens are deliberately not held to the jargon bar (§9 exempts
// reviewer-facing copy, and a CPA reading "Bills to pay" is being talked down to).
const CLIENT_SCREENS = {
  books: "BooksView", ap: "ApView", ar: "ArView",
  customers: "CustomersView", vendors: "VendorsView", docs: "DocsView",
  detail: "DetailView", reports: "ReportsView",
  "send-invoice": "SendInvoiceView",   // an owner action as of C321 — so its copy and links are held to the bar too
};

const read = (name) => strip(fs.readFileSync(path.join(process.cwd(), VIEW_DIR, `${name}.jsx`), "utf8"));

describe("(1) no client-visible screen offers a control the client cannot follow", () => {
  it("every setView target in a client screen is either client-openable or gated on the seat", () => {
    const offenders = [];
    for (const [viewId, file] of Object.entries(CLIENT_SCREENS)) {
      const src = read(file);
      src.split("\n").forEach((line, i) => {
        for (const m of line.matchAll(/setView\("([a-z:-]+)"\)/g)) {
          if (CLIENT_VIEW_IDS.includes(m[1])) continue;
          // A cockpit-only destination is fine PROVIDED the file gates on the seat —
          // "unreachable by accident of the nav" is not a guarantee, so the code has
          // to say so and this check has to be able to read it.
          if (/const cockpit = navSeat/.test(src)) continue;
          offenders.push(`${file} (view "${viewId}") line ${i + 1} → setView("${m[1]}")`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("★ the screens that DO reach the cockpit derive the seat from navSeat, not from a role", () => {
    // A role check would drift from the seat the moment "preview as owner" is used —
    // the toggle changes the seat and not the role, so a role-gated panel would stay
    // visible in a preview that is supposed to be exact.
    for (const file of ["BooksView", "ArView", "VendorsView", "CustomersView"]) {
      const src = read(file);
      expect([file, /const cockpit = navSeat \? navSeat\.isReviewerSeat : true;/.test(src)]).toEqual([file, true]);
    }
  });

  it("★ BooksView's three cockpit surfaces are gated — add-entry, reconciliation history, contracts", () => {
    const src = read("BooksView");
    expect(src).toMatch(/\{cockpit && <button onClick=\{\(\)=>setView && setView\("add"\)\}/);
    expect(src).toMatch(/\{cockpit && \(reconciliations\|\|\[\]\)\.length>0 && \(/);
    expect(src).toMatch(/\{cockpit && filter==="contracts" && \(/);
    expect(src).toMatch(/\{cockpit && selContract && \(/);
  });

  it("★ DetailView's vendor link goes to a screen that HAS a nav row (it went to one with none)", () => {
    const src = read("DetailView");
    expect(src).toMatch(/setVendorFilter\(selectedInvoice\.vendor\);[\s\S]{0,80}setView\("books"\)/);
    expect(src).not.toMatch(/setView\("invoices"\)/);
    // …and "books" is genuinely a row on both sidebars, which is the property that matters.
    const rows = (nav) => nav.sections.flatMap((s) => s.items.map(([id]) => id));
    expect(rows(visibleNav({ role: "owner" }))).toContain("books");
    expect(rows(visibleNav({ role: "accountant" }))).toContain("books");
  });
});

describe("(2) client-visible copy assumes zero accounting knowledge", () => {
  // Strings a person actually reads: JSX text nodes, and quoted phrases (a quoted
  // multi-word literal in one of these files is a label, not an identifier).
  const visibleStrings = (src) => {
    const out = new Set();
    for (const m of src.matchAll(/>([^<>{}]{4,110})</g)) out.add(m[1].trim());
    // ★ WALK EVERY STRING LITERAL IN ORDER — double, single AND template — rather than
    // pairing `"` characters naively. One `"` inside a '…' string or a template earlier in
    // the file shifted every later pair by one, and the slide-in panel's `"GL account"`
    // label came out as the gap BETWEEN two labels: a mutation restoring it survived.
    for (const m of src.matchAll(/"((?:[^"\\\n]|\\.){4,110})"|'((?:[^'\\\n]|\\.){4,110})'|`(?:[^`\\]|\\.)*`/g)) {
      const lit = m[1] ?? m[2];
      if (lit != null && /\s/.test(lit)) out.add(lit.trim());
    }
    // ★ A LABEL NEVER CONTAINS CODE PUNCTUATION. The quoted-literal sweep otherwise picks
    // up whatever sits between two unrelated quote characters — a run of style props came
    // back as `, fontSize:13 }}>{a.credit?fmt(a.credit):` and was reported as owner jargon
    // because it contains the word "credit". Filtering by SHAPE keeps the check mechanical;
    // adding that string to the allow-list would have hidden a class of noise instead.
    // …and a fragment that BEGINS with a comma is the gap between two object-literal
    // values (`"By Vendor", gl:"By Category"` yields `, gl:`), never a label. Same noise
    // class, filtered by shape for the same reason.
    return [...out].filter((t) => t && !/[{}<>=;]/.test(t) && !/^\s*,/.test(t));
  };

  // ★★ WHAT COUNTS AS "CLIENT COPY" — two things a client never sees have to come out
  // first, or the check reports the FIX as the defect:
  //   · a `cockpit ? … : …` ternary — the CPA half legitimately says "Open payables";
  //   · a whole `{cockpit && ( … )}` block — BooksView's reconciliation history and its
  //     ASC 842 contract detail are gated that way, and their copy is CPA copy.
  // The block strip is brace-matched rather than regex'd, because a JSX block contains
  // braces and a lazy match would stop at the first one and silently keep the rest.
  const stripCockpitBlocks = (src) => {
    let out = "", i = 0;
    for (;;) {
      const at = src.indexOf("{cockpit &&", i);
      if (at < 0) return out + src.slice(i);
      out += src.slice(i, at);
      let depth = 0, j = at;
      for (; j < src.length; j++) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") { depth--; if (!depth) break; }
      }
      i = j + 1;
    }
  };
  const clientHalf = (src) =>
    visibleStrings(stripCockpitBlocks(src).replace(/cockpit \? "[^"]*" : /g, "").replace(/cockpit \? "[^"]*"/g, ""));

  // ★★★ PRE-EXISTING DEBT, EXEMPTED BY EXACT STRING AND EACH ONE SAYING WHY. These are
  // client-facing today and were BEFORE C313 — Reports and the transaction drill have
  // been the client's since C197 — so they are not this change's to fix, and quietly
  // widening the check to swallow them would retire a guard on its first day. An
  // unexplained allow-list is the same as no rule; this one has a perimeter and a home.
  const KNOWN_DEBT = {
    // A balance sheet is CALLED a balance sheet. Renaming a financial statement to avoid
    // the word would leave a client unable to ask their accountant for it by name — the
    // Cardinal Principle is about not assuming CONCEPTS, not about refusing proper nouns.
    "Balance Sheet": "the statement's actual name",
    "Accrual basis": "the statement's actual name",
    // (TIER 1 #7a's four — "Trial Balance", the two TOTAL OUTSTANDING headings and
    // "AI Confidence" — were paid off in C327. An exemption whose string is gone is a
    // licence left lying open, and the REACHED check below is what made them leave.)
  };

  for (const [viewId, file] of Object.entries(CLIENT_SCREENS)) {
    it(`${file} (client view "${viewId}") — no owner jargon in the client half of its copy`, () => {
      const hits = clientHalf(read(file))
        .filter((t) => containsOwnerJargon(t))
        .filter((t) => !Object.keys(KNOWN_DEBT).some((k) => t.includes(k)));
      expect(hits).toEqual([]);
    });
  }

  // ★★ C330 — THE SLIDE-IN PANEL IS NOT A VIEW, AND THE OPERATOR'S SCREENSHOT WAS OF IT.
  // Every client screen passed this bar while the panel a client actually opens from
  // Transactions read "GL account · Offset account · AI confidence · AI REASONING ·
  // Recode GL account". A component rendered INSIDE a client view is a client surface.
  // (TrustPanel lives under views/ and is a client screen's own child; it is scanned here
  // by path rather than added to CLIENT_SCREENS, which is keyed by view id.)
  const CLIENT_COMPONENTS = ["TransactionDetailPanel", "ClarificationFlow", "DocumentPreviewModal", "ChatRichOutput", "views/TrustPanel"];
  const readComponent = (name) => strip(fs.readFileSync(path.join(process.cwd(), "src/components", `${name}.jsx`), "utf8"));
  for (const file of CLIENT_COMPONENTS) {
    it(`${file} (rendered inside client views) — no owner jargon in the client half of its copy`, () => {
      const hits = clientHalf(readComponent(file))
        .filter((t) => containsOwnerJargon(t))
        .filter((t) => !Object.keys(KNOWN_DEBT).some((k) => t.includes(k)));
      expect(hits).toEqual([]);
    });
  }

  it("★ every exemption is still REACHED — a stale allow-list is a licence left lying open", () => {
    // The same rule C249 applied to excused tables: an exemption nobody needs any more is
    // permission sitting there for the next person. If a debt string is fixed, its entry
    // must go, and this fails until it does.
    const all = Object.values(CLIENT_SCREENS).flatMap((f) => clientHalf(read(f)));
    for (const k of Object.keys(KNOWN_DEBT))
      expect([k, all.some((t) => t.includes(k))]).toEqual([k, true]);
  });

  it("★ the check can actually fail — a planted string is caught", () => {
    // Anti-vacuity: a jargon scan that matches nothing is indistinguishable from clean
    // copy, and this whole repo has been bitten by that shape more than once.
    const planted = ['<div>Open receivables aged 30 days</div>', '<span>ASC 842 schedule</span>'];
    for (const p of planted) expect(clientHalf(p).some((t) => containsOwnerJargon(t))).toBe(true);
    // …and the block strip removes exactly the block, not the rest of the file.
    const gated = '<a>keep me</a>{cockpit && (<div>Open receivables {x} here</div>)}<b>and me</b>';
    expect(clientHalf(gated).some((t) => containsOwnerJargon(t))).toBe(false);
    expect(clientHalf(gated)).toContain("keep me");
    expect(clientHalf(gated)).toContain("and me");
  });

  it("★★ 'Credit Card' is a payment method, not accounting jargon", () => {
    // OWNER_JARGON_RE's `\bcredit(ed|s)?\b` matched the payment-method list on two
    // screens. A guard that fails for a reason it does not mean is a guard nobody
    // trusts — the seventh time in this repo, and the first fixed in the regex itself.
    expect(containsOwnerJargon("Credit Card")).toBe(false);
    expect(containsOwnerJargon("ACH / Bank Transfer")).toBe(false);
    // …and the accounting sense still trips it.
    expect(containsOwnerJargon("we credited the account")).toBe(true);
    expect(containsOwnerJargon("debits and credits")).toBe(true);
  });
});

// ── C340 — THE DIRECTION ANSWER'S OFFSET COMES FROM THE CHART, NOT FROM A TYPED CODE ──
// Found by the jargon guard reading `"Accounts Receivable"` / `"Accounts Payable"` as copy:
// they were the NAMES beside `"1100"` / `"2000"` typed into the clarification flow — §4's
// one rule, broken on the card an owner answers. A renumbered A/R would have sent every
// "we sent it" answer to a code the company does not have.
describe("C340 — the clarification flow resolves the offset account by role", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/ClarificationFlow.jsx"), "utf8");
  it("secondary_gl_code / name come from getAccountByRole", () => {
    expect(src).toMatch(/secondary_gl_code: \(getAccountByRole\?\.\(isRev \? "accounts_receivable" : "accounts_payable"\)\?\.code\)/);
    expect(src).toMatch(/secondary_gl_name: \(getAccountByRole\?\.\(isRev \? "accounts_receivable" : "accounts_payable"\)\?\.name\)/);
  });
});
