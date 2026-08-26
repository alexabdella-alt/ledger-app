import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  planInvoiceArrival, settlementCandidates, amountRelation, identityRelation,
  digitsPermuted, isCashSettled, hasAttachedInvoice, matchResolutionFacts,
  AMOUNT_RELATION, IDENTITY_RELATION, ARRIVAL, ASK_REASON, MATCH_EXCEPTION_KIND,
} from "../src/lib/invoicePayment.js";
import { buildBankLineEntry } from "../src/lib/bankMatch.js";
import { DIRECTORY_SEED } from "../src/lib/vendorDirectory.js";

// ═════════════════════════════════════════════════════════════════════════════
// O114 — the invoice and the payment are one event.
//
// The specimens are the SIX REAL PAIRS from the August drive, every one of which
// currently produces a false `duplicate_payment` card. The expected column comes
// from the spec, not from what the code happens to do.
//
// The load-bearing test is ORDER INDEPENDENCE (bottom of the file): the same pair
// booked in both orders must leave the same trial balance. That is the defect
// restated as an assertion — the bug was never the flag, it was that the books'
// final state depended on which document arrived first.
// ═════════════════════════════════════════════════════════════════════════════

const CASH = ["1000"];
const ctx = { cashCodes: CASH, directory: DIRECTORY_SEED };

// A booked bank line, as `buildBankLineEntry` actually shapes one: descriptor is
// `"Resolved Vendor – RAW BANK TEXT"`, source normalises to `bank_import`.
const payment = (vendor, raw, amount, date, over = {}) => ({
  id: `p:${vendor}:${date}`, status: "posted", deleted_at: null,
  description: `${vendor} – ${raw}`, source: "bank_import",
  amount, date, gl_code: "5000", secondary_gl_code: "1000", ...over,
});

// An arriving invoice, before booking: a CLEAN vendor field, not a composed string.
const invoice = (vendor, amount, date, over = {}) => ({
  id: `i:${vendor}:${date}`, vendor, amount, date, source: "universal_upload", ...over,
});

describe("★ the module cannot book — it decides and returns", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/lib/invoicePayment.js"), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("performs NO I/O and reaches no booking primitive by name", () => {
    expect(code).not.toMatch(/supabase|fetch\(|logAudit|createClient/);
    for (const forbidden of ["persistJournalEntry", "persistMultiLineEntry", "post_journal_entry",
                             "bookToDb", "buildAccountInsert", "ensureAccount", "markBillPaid"]) {
      expect(code, forbidden).not.toMatch(new RegExp(forbidden));
    }
  });

  it("★ never reaches the absorber — no role fallback can materialise an account", () => {
    expect(code).not.toMatch(/DEFAULT_BY_ROLE|getAccountByRole/);
  });
});

describe("the NEAR band — two named rules, not one magic number", () => {
  it("★ HILL COUNTRY: 468.50 vs 486.50 is NEAR by digit permutation, not by percent", () => {
    const r = amountRelation(468.5, 486.5);
    expect(r.relation).toBe(AMOUNT_RELATION.NEAR);
    expect(r.basis).toBe("digits_permuted");        // 18.00 is 3.7% — OUTSIDE the 2% rule
    expect(r.diff).toBeCloseTo(18, 2);
  });

  it("a percentage band scales in both tails, where a flat dollar band does not", () => {
    expect(amountRelation(12, 12.2).relation).toBe(AMOUNT_RELATION.NEAR);      // 1.7%
    expect(amountRelation(12, 30).relation).toBe(AMOUNT_RELATION.NONE);        // a flat $25 band would have said NEAR
    expect(amountRelation(12000, 12200).relation).toBe(AMOUNT_RELATION.NEAR);  // 1.7%
    expect(amountRelation(12000, 12600).relation).toBe(AMOUNT_RELATION.NONE);  // 5% — a 5% band would have said NEAR
  });

  it("★ digit permutation is the REAL transposition test, not divisible-by-9", () => {
    expect(digitsPermuted(468.5, 486.5)).toBe(true);
    // 27 apart and divisible by 9, but NOT the same digits — the CPA shortcut fires,
    // the real test does not. 1 in 9 arbitrary differences pass the 9-test.
    expect(468.5 - 441.5).toBe(27);
    expect(digitsPermuted(468.5, 441.5)).toBe(false);
    expect(amountRelation(468.5, 441.5).relation).toBe(AMOUNT_RELATION.NONE);
  });

  it("a decimal-point move is a magnitude error, never a permutation", () => {
    expect(digitsPermuted(46.85, 468.5)).toBe(false);
    expect(digitsPermuted(100, 1000)).toBe(false);
  });

  it("exact is one cent — the same tolerance the bank rail already uses", () => {
    expect(amountRelation(534.8, 534.81).relation).toBe(AMOUNT_RELATION.EXACT);
    expect(amountRelation(534.8, 534.83).relation).toBe(AMOUNT_RELATION.NEAR);
  });

  it("an unreadable amount is NONE, never a match", () => {
    expect(amountRelation(null, 100).relation).toBe(AMOUNT_RELATION.NONE);
    expect(amountRelation(0, 0).relation).toBe(AMOUNT_RELATION.NONE);
  });
});

describe("★★ identity — EXACT to attach, NEAR only to ask, and the anti-merge cases hold", () => {
  it("★ FRANKLIN AVE: the purpose suffix makes it NEAR, never EXACT", () => {
    expect(identityRelation("franklin ave properties", "franklin ave properties rent"))
      .toBe(IDENTITY_RELATION.NEAR);
  });

  it("★ REGRESSION — sysco foods and sysco fuel must never relate, at any tier", () => {
    // `tests/vendorIdentity.test.js` asserts these must never merge, and C202's seed
    // re-opened that door once through a PREFIX pattern. A token-boundary prefix rule
    // keeps it shut: neither token sequence is a prefix of the other.
    expect(identityRelation("sysco foods", "sysco fuel")).toBe(IDENTITY_RELATION.NONE);
  });

  it("prefix is TOKEN-boundary — `toast` does not relate to `toaster supply`", () => {
    expect(identityRelation("toast", "toaster supply")).toBe(IDENTITY_RELATION.NONE);
    expect(identityRelation("toast", "toast merchant fees")).toBe(IDENTITY_RELATION.NEAR);
  });

  it("a missing key relates to nothing", () => {
    expect(identityRelation(null, "roma cheese and dairy")).toBe(IDENTITY_RELATION.NONE);
    expect(identityRelation("", "")).toBe(IDENTITY_RELATION.NONE);
  });
});

describe("★★★ THE SIX AUGUST SPECIMENS — every one of them a false duplicate card today", () => {
  it("ROMA — exact identity, exact amount, one candidate → ATTACH", () => {
    const p = payment("Roma Cheese & Dairy Co", "ACH DEBIT - ROMA CHEESE & DAIRY CO", 534.8, "2026-08-04");
    const r = planInvoiceArrival(invoice("Roma Cheese & Dairy Co.", 534.8, "2026-08-04"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.ATTACH);
    expect(r.candidate.entry.id).toBe(p.id);
  });

  it("TOAST — same day, exact → ATTACH", () => {
    const p = payment("Toast Inc", "ACH DEBIT - TOAST INC MERCHANT FEES AUG", 228.91, "2026-08-21");
    const r = planInvoiceArrival(invoice("Toast Inc", 228.91, "2026-08-21"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.ATTACH);
  });

  it("ALAMO FIRE — four days apart, exact → ATTACH", () => {
    const p = payment("Alamo Fire & Safety LLC", "ACH DEBIT - ALAMO FIRE SAFETY LLC", 425, "2026-08-24");
    const r = planInvoiceArrival(invoice("Alamo Fire & Safety LLC", 425, "2026-08-20"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.ATTACH);
    expect(r.candidate.gapDays).toBe(4);
  });

  it("★★ FRANKLIN AVE — amount matches exactly, identity does NOT → ASK, never attach", () => {
    // The operator's call, 2026-08-26: this is the CORRECT failure. Failing to attach
    // asks a question; wrongly attaching suppresses a real charge silently.
    const p = payment("Franklin Ave Properties LP", "ACH DEBIT - FRANKLIN AVE PROPERTIES LP RENT", 2400, "2026-08-03");
    const r = planInvoiceArrival(invoice("Franklin Ave Properties LP", 2400, "2026-08-01"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.ASK);
    expect(r.reason).toBe(ASK_REASON.IDENTITY_DIFFERS);
    expect(r.candidates[0].identity).toBe(IDENTITY_RELATION.NEAR);
  });

  it("★★ FRANKLIN AVE auto-attaches once O111 lands — the alias closes the last mile", () => {
    // Pinned so the alias feature has a passing target, and so nobody "fixes" the case
    // by widening the rail-strip, which would also eat "Lone Star Restaurant SUPPLY".
    const p = payment("Franklin Ave Properties LP", "ACH DEBIT - FRANKLIN AVE PROPERTIES LP", 2400, "2026-08-03");
    const r = planInvoiceArrival(invoice("Franklin Ave Properties LP", 2400, "2026-08-01"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.ATTACH);
  });

  it("★★ HILL COUNTRY — exact identity, ±$18 → ASK, and NEVER silent in either direction", () => {
    const p = payment("Hill Country Milling Co", "ACH DEBIT - HILL COUNTRY MILLING", 486.5, "2026-08-24");
    const r = planInvoiceArrival(invoice("Hill Country Milling Co.", 468.5, "2026-08-20"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.ASK);
    expect(r.reason).toBe(ASK_REASON.AMOUNT_DIFFERS);
    expect(r.basis).toBe("digits_permuted");
    // It is NOT booked as a payable and NOT attached — both would be silent.
    expect(r.candidate.entry.id).toBe(p.id);
  });

  it("★ BLUEBONNET IS NOT FIXED BY THIS AND MUST NOT LOOK FIXED — see O117", () => {
    // Four weekly $145 deliveries with no payment to attach to. This module returns
    // BOOK_PAYABLE for all of them, correctly — and `findDuplicate`'s 7-day window
    // still flags each against the last, because a weekly vendor hits `gap <= 7` by
    // construction. That is a SEPARATE failure mode (O117), and shipping O114 must not
    // be mistaken for fixing the detector.
    const weekly = ["2026-08-07", "2026-08-14", "2026-08-21", "2026-08-28"]
      .map((d) => planInvoiceArrival(invoice("Bluebonnet Linen Service", 145, d), [], ctx));
    expect(weekly.every((r) => r.action === ARRIVAL.BOOK_PAYABLE)).toBe(true);
  });
});

describe("only one side ever arrives", () => {
  it("an invoice with no payment books a payable — unchanged, and it must stay visible", () => {
    const r = planInvoiceArrival(invoice("Guadalupe Produce", 310.4, "2026-08-12"), [], ctx);
    expect(r.action).toBe(ARRIVAL.BOOK_PAYABLE);
    expect(r.basis).toBe("no_candidate");
  });

  it("a payment with no invoice is not this module's business at all", () => {
    // Silence is the design: money moved and was recorded. The invoice is missing
    // DOCUMENTATION, not a missing entry, and most small-business spend never
    // produces paperwork the owner keeps.
    const p = payment("Capital City Supply", "ACH DEBIT - CAPITAL CITY SUPPLY", 88.2, "2026-08-09");
    const r = planInvoiceArrival(invoice("Someone Else Entirely", 88.2, "2026-08-09"), [p], ctx);
    expect(r.action).toBe(ARRIVAL.BOOK_PAYABLE);
    expect(r.excludedBy.identity_none).toBe(1);
  });
});

describe("candidacy is bounded, and every exclusion is COUNTED", () => {
  const p = () => payment("Roma Cheese & Dairy Co", "ACH DEBIT - ROMA CHEESE & DAIRY CO", 534.8, "2026-08-04");
  const inv = () => invoice("Roma Cheese & Dairy Co.", 534.8, "2026-08-04");

  it("★ a candidate list with no denominator cannot tell 'nothing matched' from 'nothing examined'", () => {
    const { excludedBy } = settlementCandidates(inv(), [
      { ...p(), id: "d", deleted_at: "2026-08-05" },
      { ...p(), id: "a", import_metadata: { invoice_attached: true } },
      { ...p(), id: "o", date: "2026-11-30" },
      { ...p(), id: "ap", secondary_gl_code: "2000" },
    ], ctx);
    expect(excludedBy).toMatchObject({ not_live: 1, already_attached: 1, outside_window: 1, not_cash_settled: 1 });
  });

  it("an OPEN payable is not a settlement — it has no cash leg", () => {
    expect(isCashSettled({ gl_code: "5000", secondary_gl_code: "2000" }, ctx)).toBe(false);
    expect(isCashSettled({ gl_code: "5000", secondary_gl_code: "1000" }, ctx)).toBe(true);
  });

  it("★ two invoices cannot claim one payment", () => {
    expect(hasAttachedInvoice({ import_metadata: { attached_invoice_id: "i1" } })).toBe(true);
    const r = planInvoiceArrival(inv(), [{ ...p(), import_metadata: { invoice_attached: true } }], ctx);
    expect(r.action).toBe(ARRIVAL.BOOK_PAYABLE);
  });

  it("the window is ASYMMETRIC — net-60 forward, only a week back", () => {
    const at = (d) => planInvoiceArrival(invoice("Roma Cheese & Dairy Co.", 534.8, d), [p()], ctx).action;
    expect(at("2026-06-20")).toBe(ARRIVAL.ATTACH);        // payment 45d AFTER — net-45 terms, inside
    expect(at("2026-06-01")).toBe(ARRIVAL.BOOK_PAYABLE);  // 64d after — past net-60
    expect(at("2026-08-08")).toBe(ARRIVAL.ATTACH);        // payment 4d BEFORE — inside the 7d back-window
    expect(at("2026-08-20")).toBe(ARRIVAL.BOOK_PAYABLE);  // payment 16d before — a prepayment, outside
  });

  it("★ an UNRECOGNISED source is excluded and counted, never guessed at", () => {
    const { excludedBy } = settlementCandidates(inv(), [{ ...p(), source: "some_new_rail" }], ctx);
    expect(excludedBy.entry_source_some_new_rail).toBe(1);
  });

  it("payroll is excluded by the source strategy, so a net-pay debit cannot absorb an invoice", () => {
    const { excludedBy } = settlementCandidates(inv(), [{ ...p(), source: "payroll" }], ctx);
    expect(excludedBy.entry_source_payroll).toBe(1);
  });

  it("two equally-exact candidates ASK rather than picking the first one", () => {
    const r = planInvoiceArrival(inv(), [{ ...p(), id: "x" }, { ...p(), id: "y" }], ctx);
    expect(r.action).toBe(ARRIVAL.ASK);
    expect(r.reason).toBe(ASK_REASON.MULTIPLE_CANDIDATES);
    expect(r.candidate).toBe(null);
  });
});

describe("★★ the attestation boundary — matching is not attesting", () => {
  it("a match records attests_mapping FALSE, and a recode records TRUE", () => {
    const f = matchResolutionFacts({ entryId: "e1", invoiceId: "i1", answer: "same" });
    expect(f.match.kind).toBe(MATCH_EXCEPTION_KIND);
    expect(f.match.attests_mapping).toBe(false);
    expect(f.recode).toBe(null);

    const g = matchResolutionFacts({ entryId: "e1", invoiceId: "i1", answer: "same", recodedAccountId: "acct-cogs" });
    expect(g.match.attests_mapping).toBe(false);   // still false — two facts, not one
    expect(g.recode.attests_mapping).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ★★★ THE INVARIANT — ORDER INDEPENDENCE.
//
// This is the defect restated as an assertion. Book each pair invoice-first and
// payment-first, and assert the resulting per-account totals are IDENTICAL. It
// fails loudly on exactly the bug that produced the spec, and it needs no judgment
// to read: one number per account, two orders, equal or not.
// ═════════════════════════════════════════════════════════════════════════════

// A minimal ledger: apply an entry's two legs to a per-account balance map.
const apply = (bal, { gl_code, secondary_gl_code, amount, debit_credit }) => {
  const sign = debit_credit === "credit" ? -1 : 1;
  bal[gl_code] = (bal[gl_code] || 0) + sign * amount;
  bal[secondary_gl_code] = (bal[secondary_gl_code] || 0) - sign * amount;
  return bal;
};

// The two rails, as the app actually builds them.
const bookPayment = (bal, p) =>
  apply(bal, { ...buildBankLineEntry({ ...p, type: "expense", gl_code: p.gl_code }, { offsetCode: "1000", offsetName: "Cash" }), amount: p.amount });
const bookPayable = (bal, inv, code) =>
  apply(bal, { gl_code: code, secondary_gl_code: "2000", amount: inv.amount, debit_credit: "debit" });
const clearPayable = (bal, inv) =>
  apply(bal, { gl_code: "2000", secondary_gl_code: "1000", amount: inv.amount, debit_credit: "debit" });

describe("★★★ ORDER INDEPENDENCE — the same pair, both orders, the same books", () => {
  const PAIRS = [
    ["Roma Cheese & Dairy", "ACH DEBIT - ROMA CHEESE & DAIRY CO", "Roma Cheese & Dairy Co.", 534.8, "2026-08-04", "2026-08-04"],
    ["Toast Inc", "ACH DEBIT - TOAST INC MERCHANT FEES AUG", "Toast Inc", 228.91, "2026-08-21", "2026-08-21"],
    ["Alamo Fire & Safety LLC", "ACH DEBIT - ALAMO FIRE SAFETY LLC", "Alamo Fire & Safety LLC", 425, "2026-08-20", "2026-08-24"],
  ];

  for (const [payVendor, raw, invVendor, amount, invDate, payDate] of PAIRS) {
    it(`${invVendor} — invoice-first and payment-first agree to the cent`, () => {
      const p = payment(payVendor, raw, amount, payDate);
      const inv = invoice(invVendor, amount, invDate);

      // ORDER A — invoice first. Books a payable (no settlement exists yet), and the
      // bank rail then clears it, exactly as it does today.
      const a = {};
      expect(planInvoiceArrival(inv, [], ctx).action).toBe(ARRIVAL.BOOK_PAYABLE);
      bookPayable(a, inv, "5000");
      clearPayable(a, inv);

      // ORDER B — payment first. The bank line books straight to cash; the invoice
      // then ATTACHES and posts nothing. This is the order the drive hit.
      const b = {};
      bookPayment(b, p);
      expect(planInvoiceArrival(inv, [p], ctx).action).toBe(ARRIVAL.ATTACH);

      for (const code of new Set([...Object.keys(a), ...Object.keys(b)])) {
        expect(Number((a[code] || 0).toFixed(2)), `account ${code}`)
          .toBe(Number((b[code] || 0).toFixed(2)));
      }
      expect(Number((b["5000"] || 0).toFixed(2))).toBe(amount);   // expense booked ONCE
      expect(Number((b["2000"] || 0).toFixed(2))).toBe(0);        // nothing left owed
    });
  }

  it("★ THE BUG ITSELF — booking the invoice as a payable in order B doubles the expense", () => {
    // The mutation this suite exists to catch, run as an assertion rather than
    // asserted about. If `planInvoiceArrival` ever returns BOOK_PAYABLE where it
    // should ATTACH, THIS is what lands in the books.
    const p = payment("Roma Cheese & Dairy", "ACH DEBIT - ROMA CHEESE & DAIRY CO", 534.8, "2026-08-04");
    const inv = invoice("Roma Cheese & Dairy Co.", 534.8, "2026-08-04");
    const wrong = {};
    bookPayment(wrong, p);
    bookPayable(wrong, inv, "5000");
    expect(Number(wrong["5000"].toFixed(2))).toBe(1069.6);        // 2x the charge
    expect(Number(wrong["2000"].toFixed(2))).toBe(-534.8);        // and a payable that will never clear
  });
});
