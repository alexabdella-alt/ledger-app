// ─────────────────────────────────────────────────────────────────────────────
// WHICH DATABASE ROW A CONTACT OBJECT STANDS FOR (C361).
//
// `persistContact` decides UPDATE-or-UPSERT on `contact.db_id`. A contact created in this
// session gets `db_id` stamped when its insert resolves; a contact LOADED from the database
// arrived with `id` = the row's uuid and no `db_id` at all — the load mapping never set it,
// from the first commit. So from 2026-06-06 (when a bare insert became an upsert with
// ignoreDuplicates) every edit to a loaded contact took the upsert path, hit the
// (company_id, name_key) unique index, was DROPPED by `ON CONFLICT DO NOTHING`, and came
// back with the OLD row and `ok: true`. Vendor terms, emails, O111 aliases, 1099 business
// types, "marked 1099 sent" — saved on screen, gone on reload, reported as saved.
//
// One resolver, so the answer cannot be re-derived differently per caller (C353 had its own
// inline copy in SendInvoiceView — the tell that the class existed and was patched once).
// ─────────────────────────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isDbId = (id) => typeof id === "string" && UUID_RE.test(id);

// The row id this contact is backed by, or null for a contact that only exists in-session.
// `db_id` wins when present; a uuid `id` is the loaded-row case.
export function contactDbId(contact) {
  if (!contact) return null;
  if (isDbId(contact.db_id)) return contact.db_id;
  if (isDbId(contact.id)) return contact.id;
  return null;
}
