// ─────────────────────────────────────────────────────────────────────────────
// AN EXTRACTED DOCUMENT BECOMES A BOOKABLE ROW — the decision, on its own.
//
// `O89`'s census found `processUploadItem` at 920 lines, and argued AGAINST a general split:
// the median declaration in that file is 14 lines and 225 of 237 are unremarkable. **It is a
// normal component with a dozen very large functions in it**, so the useful move is to lift
// the DECISION out of the biggest one and leave the I/O where it is.
//
// ★★ THIS IS THE HIGHEST-TRAFFIC DECISION IN THE PRODUCT AND IT COULD NOT BE TESTED. Every
// invoice a client drops runs through it, and it was a closure inside a 920-line function
// reading `rc`, `rn`, `Date.now()` and the surrounding scope — so the rules below could only
// be verified by reading them.
//
// ★ THREE OF THEM ARE LOAD-BEARING AND NOW PINNED:
//   · **a vendor rule beats the model** — that is what a rule IS, and it carries 99 rather
//     than the model's score so the confidence gate lets it through;
//   · **`type` is classified from the GL CODE, never from the model's own `type` field** —
//     the same basis `flattenJournalEntries` uses, so an odd AI answer cannot mis-slot the
//     row out of the transactions tab the moment it books;
//   · **the fallback is Miscellaneous** — which is exactly the account `autoBookDecision`
//     refuses to auto-book into when the vendor has a name (the cold-start hard fail). The
//     fallback is correct HERE; it is the booking gate's job to stop it, and the two together
//     are what turn "we couldn't tell" into a question rather than a silent wrong bucket.
//
// Pure: `id` and `bookedAt` are injected rather than read from the clock, so the same
// document always produces the same row and a test can assert every field.
// ─────────────────────────────────────────────────────────────────────────────

import { glIsRevenue, glIsExpense } from "./gl.js";
import { deriveDueDate } from "./format.js";

export function buildUploadedInvoice({
  extracted = {}, coding = {}, rule = null, rc, rn, id, bookedAt, today,
} = {}) {
  const isRevenue = extracted.type === "revenue";
  // A rule is a human's standing instruction, so it outranks the model AND carries a
  // confidence the gate will pass. 75 is the floor the model is given when it offers none.
  const confidence = rule ? 99 : (coding.confidence || 75);
  const finalCode = rule ? rule.gl_code : (coding.gl_code || (isRevenue ? rc("product_revenue") : rc("miscellaneous_expense")));
  const finalName = rule ? rule.gl_name : (coding.gl_name || (isRevenue ? rn("product_revenue") : rn("miscellaneous_expense")));

  const invoice = {
    id,
    vendor: extracted.vendor?.trim() || "Unknown",
    description: extracted.description || "",
    amount: parseFloat(extracted.amount) || 0,
    // Sales tax pulled from the invoice → split to Sales Tax Payable (2350) at
    // booking for revenue invoices (persistJournalEntry), never lumped into revenue.
    tax_amount: parseFloat(extracted.tax_amount) || 0,
    date: extracted.date || today,
    // Classify `type` from the GL code (same basis as flattenJournalEntries +
    // the canonical layer) so the in-session row is never mis-slotted by an odd
    // AI `type` and always shows in the transactions tab the moment it's booked.
    type: glIsRevenue(finalCode) ? "revenue" : glIsExpense(finalCode) ? "expense" : (extracted.type || "expense"),
    notes: extracted.notes || "",
    invoice_number: extracted.invoice_number || "",
    // O11: carry the extracted payment terms + derive a due date (Net 30 → date+30,
    // Due on receipt → date). Shown on the row immediately and persisted by
    // persistJournalEntry; AR/AP aging then ages from the real due date.
    payment_terms: extracted.payment_terms || "",
    due_date: deriveDueDate(extracted.date || today, extracted.payment_terms) || null,
    project: rule?.project || "General",
    gl_code: finalCode,
    gl_name: finalName,
    secondary_gl_code: rule ? rc("accounts_payable") : (coding.secondary_gl_code || (isRevenue ? rc("accounts_receivable") : rc("accounts_payable"))),
    secondary_gl_name: rule ? rn("accounts_payable") : (coding.secondary_gl_name || (isRevenue ? rn("accounts_receivable") : rn("accounts_payable"))),
    debit_credit: isRevenue ? "credit" : "debit",
    confidence,
    // Use the AI's reasoning; if it omitted one, build a descriptive fallback
    // from the extracted data (never a bare "Auto-coded").
    reasoning: rule
      ? `Applied your vendor rule for ${extracted.vendor?.trim() || "this vendor"} → ${finalName} (${finalCode}).`
      : (coding.reasoning?.trim()
          || `Coded to ${finalName} (${finalCode}) — ${(extracted.description || extracted.vendor || "this purchase").toString().slice(0, 80)} from ${extracted.vendor?.trim() || "the vendor"}.`),
    status: "booked",
    booked_at: bookedAt,
    source: "universal_upload",
    // Plain-English clarifying questions the AI raised for the conversational flow
    questions: Array.isArray(extracted.questions) ? extracted.questions : [],
    confidence_score: extracted.confidence_score ?? null,
    // Auto-create/update contact from the extracted details after booking
    _contact: {
      name: extracted.vendor?.trim() || "",
      type: isRevenue ? "customer" : "vendor",
      address: extracted.vendor_address || "", email: extracted.vendor_email || "",
      phone: extracted.vendor_phone || "", website: extracted.vendor_website || "",
      payment_terms: extracted.payment_terms || "", account_number: extracted.account_number || "",
      tax_id: extracted.tax_id || "", gl_code: finalCode, gl_name: finalName,
    },
  };

  return { invoice, finalCode, finalName, confidence, isRevenue };
}
