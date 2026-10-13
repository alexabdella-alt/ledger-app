// ─────────────────────────────────────────────────────────────────────────────
// C574 — ONE "SEND REMINDER" EMAIL, WHEREVER AN OVERDUE INVOICE IS SHOWN.
//
// The only way to chase a customer lived inside Reports → aging. Home's "Chase overdue
// invoices" opened a plain list with no chase action, and Money owed to you's "Follow Up →"
// only switched tabs to a table whose one action was "✓ Collected". Three doors marked
// "chase", one of which chased. The email the Reports row already wrote is now this function,
// and every overdue-invoice row offers it.
//
// It opens the owner's own mail app with the message written; nothing is sent by us, so it
// works before the app's own email channel is switched on. Pure.
// ─────────────────────────────────────────────────────────────────────────────

import { fmtMoney as money } from "./format.js";

export function reminderEmail({ customer = "", amount = 0, daysOverdue = 0, companyName = "" } = {}) {
  const who = String(customer || "").trim() || "there";
  const late = daysOverdue > 0 ? `is now ${daysOverdue} day${daysOverdue === 1 ? "" : "s"} past due` : "is due";
  return {
    subject: `Payment reminder from ${companyName || "us"}`,
    body: `Hi ${who},\n\nA friendly reminder that ${money(amount)} ${late}. Could you let us know when we can expect payment?\n\nThank you,\n${companyName || ""}`,
  };
}

export function reminderMailto({ email = "", ...rest } = {}) {
  const { subject, body } = reminderEmail(rest);
  return `mailto:${encodeURIComponent(String(email || "").trim()).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// The customer's email, from the contacts list by name (case-insensitive). "" when unknown —
// the mail app then opens with the To line empty, which is still one step from sent.
export function customerEmail(contacts = [], name = "") {
  const n = String(name || "").trim().toLowerCase();
  if (!n) return "";
  const c = (contacts || []).find((x) => x && String(x.name || "").trim().toLowerCase() === n && x.email);
  return c ? String(c.email) : "";
}
